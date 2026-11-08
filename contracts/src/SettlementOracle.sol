// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title SettlementOracle
 * @notice Settles prediction markets from signed AI oracle reports.
 *
 * Every submission is an EIP-712 `Resolution` signed by an authorized oracle key. The signature
 * binds the decision to:
 *   - the exact settlement rules the oracle read (`rulesHash`, checked against the stored rules),
 *   - the exact evidence it judged (`evidenceHash`, recomputed here from the posted sources),
 *   - the exact decision logic it produced (`reasoningHash`, recomputed from the posted reasoning),
 *   - the full off-chain report (`reportHash`).
 *
 * The decision logic and every source (URL + SHA-256 of the text the model read) are emitted in
 * events, so the full audit trail lives on-chain. Anyone may relay a signed report; the signature,
 * not `msg.sender`, is the authority.
 *
 * Ambiguity handling: an INSUFFICIENT_EVIDENCE decision, or a confidence below the market's
 * threshold, delays the market. After MAX_DELAYS delays it pauses for a manual decision.
 */
contract SettlementOracle is Ownable, EIP712 {
    // ============ Types ============

    enum Status {
        NONE,
        OPEN,
        DELAYED,
        RESOLVED,
        PAUSED
    }

    /// @dev Outcome a market settles to. Decision values in a Resolution use the same numbering,
    ///      with 0 meaning "insufficient evidence" (no outcome).
    enum Outcome {
        NONE,
        YES,
        NO
    }

    uint8 public constant DECISION_INSUFFICIENT = 0;
    uint8 public constant DECISION_YES = 1;
    uint8 public constant DECISION_NO = 2;

    uint16 public constant BPS = 10_000;
    uint8 public constant MAX_DELAYS = 3;
    /// @dev Signed timestamps may be at most this far ahead of the block (clock skew allowance).
    uint64 public constant MAX_FUTURE_SKEW = 5 minutes;

    struct Market {
        string question;
        string rules; // canonical settlement-conditions document the oracle must apply
        bytes32 rulesHash; // keccak256(bytes(rules))
        uint64 resolutionTime; // earliest time a resolution may be based on
        uint16 confidenceThresholdBps; // e.g. 7000 = 0.70
        Status status;
        Outcome outcome;
        uint8 delayCount;
        uint64 delayedUntil;
        uint32 attempts; // number of accepted submissions (used as a replay nonce)
        address creator;
    }

    struct Resolution {
        uint256 marketId;
        uint32 attempt; // must equal market.attempts at submission time
        uint8 decision; // DECISION_*
        uint16 confidenceBps;
        bytes32 rulesHash;
        bytes32 evidenceHash;
        bytes32 reasoningHash;
        bytes32 reportHash;
        uint64 timestamp; // when the oracle produced the decision
    }

    struct Source {
        string url;
        bytes32 contentHash; // SHA-256 of the exact text given to the model
    }

    struct ResolutionRecord {
        Resolution resolution;
        address signer;
        uint64 postedAt;
    }

    // ============ Errors ============

    error MarketNotFound();
    error InvalidThreshold();
    error NotAcceptingResolutions(Status status);
    error TooEarly(uint64 notBefore);
    error StaleAttempt(uint32 expected, uint32 got);
    error RulesMismatch();
    error EvidenceMismatch();
    error ReasoningMismatch();
    error InvalidDecision();
    error InvalidConfidence();
    error TimestampOutOfRange();
    error UnauthorizedSigner(address signer);
    error NotPaused();
    error InvalidOutcome();

    // ============ EIP-712 ============

    bytes32 public constant RESOLUTION_TYPEHASH = keccak256(
        "Resolution(uint256 marketId,uint32 attempt,uint8 decision,uint16 confidenceBps,bytes32 rulesHash,bytes32 evidenceHash,bytes32 reasoningHash,bytes32 reportHash,uint64 timestamp)"
    );

    // ============ State ============

    mapping(uint256 => Market) private _markets;
    mapping(uint256 => ResolutionRecord) private _latest;
    mapping(address => bool) public authorizedOracles;
    uint256 public marketCount;
    uint64 public retryDelay;

    // ============ Events ============

    event MarketCreated(
        uint256 indexed marketId, string question, bytes32 rulesHash, uint64 resolutionTime, uint16 thresholdBps
    );
    event OracleAuthorized(address indexed oracle, bool authorized);
    event RetryDelayUpdated(uint64 retryDelay);

    /// @notice Full decision record. `reasoning` is the oracle's decision logic (canonical JSON).
    event ResolutionPosted(
        uint256 indexed marketId,
        uint32 indexed attempt,
        address indexed signer,
        uint8 decision,
        uint16 confidenceBps,
        bytes32 evidenceHash,
        bytes32 reasoningHash,
        bytes32 reportHash,
        string reasoning
    );
    event EvidenceSource(uint256 indexed marketId, uint32 indexed attempt, uint256 index, bytes32 contentHash, string url);
    event MarketResolved(uint256 indexed marketId, Outcome outcome, uint16 confidenceBps);
    event ResolutionDelayed(uint256 indexed marketId, uint8 delayCount, uint64 retryAt, uint8 decision, uint16 confidenceBps);
    event MarketPaused(uint256 indexed marketId, uint8 delayCount);
    event ManualResolution(uint256 indexed marketId, Outcome outcome, string reason);

    // ============ Constructor ============

    constructor(address initialOracle, uint64 retryDelay_) Ownable(msg.sender) EIP712("SettlementOracle", "1") {
        retryDelay = retryDelay_;
        if (initialOracle != address(0)) {
            authorizedOracles[initialOracle] = true;
            emit OracleAuthorized(initialOracle, true);
        }
    }

    // ============ Admin ============

    function setOracle(address oracle, bool authorized) external onlyOwner {
        authorizedOracles[oracle] = authorized;
        emit OracleAuthorized(oracle, authorized);
    }

    function setRetryDelay(uint64 retryDelay_) external onlyOwner {
        retryDelay = retryDelay_;
        emit RetryDelayUpdated(retryDelay_);
    }

    /// @notice Manual decision for a market that exhausted its automatic retries.
    function manualResolve(uint256 marketId, Outcome outcome, string calldata reason) external onlyOwner {
        Market storage m = _market(marketId);
        if (m.status != Status.PAUSED) revert NotPaused();
        if (outcome == Outcome.NONE) revert InvalidOutcome();
        m.status = Status.RESOLVED;
        m.outcome = outcome;
        emit ManualResolution(marketId, outcome, reason);
        emit MarketResolved(marketId, outcome, 0);
    }

    // ============ Markets ============

    function createMarket(
        string calldata question,
        string calldata rules,
        uint64 resolutionTime,
        uint16 confidenceThresholdBps
    ) external returns (uint256 marketId) {
        if (confidenceThresholdBps == 0 || confidenceThresholdBps > BPS) revert InvalidThreshold();
        marketId = ++marketCount;
        bytes32 rulesHash = keccak256(bytes(rules));
        _markets[marketId] = Market({
            question: question,
            rules: rules,
            rulesHash: rulesHash,
            resolutionTime: resolutionTime,
            confidenceThresholdBps: confidenceThresholdBps,
            status: Status.OPEN,
            outcome: Outcome.NONE,
            delayCount: 0,
            delayedUntil: 0,
            attempts: 0,
            creator: msg.sender
        });
        emit MarketCreated(marketId, question, rulesHash, resolutionTime, confidenceThresholdBps);
    }

    // ============ Resolution ============

    /**
     * @notice Post a signed oracle decision together with its decision logic and sources.
     * @param r         The signed resolution.
     * @param reasoning Decision logic; must hash to r.reasoningHash.
     * @param sources   Evidence the oracle judged; must hash to r.evidenceHash.
     * @param signature EIP-712 signature over r by an authorized oracle.
     */
    function submitResolution(
        Resolution calldata r,
        string calldata reasoning,
        Source[] calldata sources,
        bytes calldata signature
    ) external {
        Market storage m = _market(r.marketId);

        if (m.status != Status.OPEN && m.status != Status.DELAYED) revert NotAcceptingResolutions(m.status);
        if (m.status == Status.DELAYED && block.timestamp < m.delayedUntil) revert TooEarly(m.delayedUntil);
        if (r.attempt != m.attempts) revert StaleAttempt(m.attempts, r.attempt);
        if (r.decision > DECISION_NO) revert InvalidDecision();
        if (r.confidenceBps > BPS) revert InvalidConfidence();
        if (r.timestamp < m.resolutionTime || r.timestamp > block.timestamp + MAX_FUTURE_SKEW) {
            revert TimestampOutOfRange();
        }
        if (r.rulesHash != m.rulesHash) revert RulesMismatch();
        if (keccak256(bytes(reasoning)) != r.reasoningHash) revert ReasoningMismatch();
        if (computeEvidenceHash(sources) != r.evidenceHash) revert EvidenceMismatch();

        address signer = ECDSA.recover(hashResolution(r), signature);
        if (!authorizedOracles[signer]) revert UnauthorizedSigner(signer);

        uint32 attempt = m.attempts;
        m.attempts = attempt + 1;
        _latest[r.marketId] = ResolutionRecord({resolution: r, signer: signer, postedAt: uint64(block.timestamp)});

        _emitRecord(r, attempt, signer, reasoning, sources);
        _applyDecision(m, r);
    }

    function _emitRecord(
        Resolution calldata r,
        uint32 attempt,
        address signer,
        string calldata reasoning,
        Source[] calldata sources
    ) private {
        emit ResolutionPosted(
            r.marketId, attempt, signer, r.decision, r.confidenceBps, r.evidenceHash, r.reasoningHash, r.reportHash, reasoning
        );
        for (uint256 i = 0; i < sources.length; i++) {
            emit EvidenceSource(r.marketId, attempt, i, sources[i].contentHash, sources[i].url);
        }
    }

    function _applyDecision(Market storage m, Resolution calldata r) private {
        if (r.decision == DECISION_INSUFFICIENT || r.confidenceBps < m.confidenceThresholdBps) {
            m.delayCount += 1;
            if (m.delayCount >= MAX_DELAYS) {
                m.status = Status.PAUSED;
                m.delayedUntil = 0;
                emit ResolutionDelayed(r.marketId, m.delayCount, 0, r.decision, r.confidenceBps);
                emit MarketPaused(r.marketId, m.delayCount);
            } else {
                m.status = Status.DELAYED;
                m.delayedUntil = uint64(block.timestamp) + retryDelay;
                emit ResolutionDelayed(r.marketId, m.delayCount, m.delayedUntil, r.decision, r.confidenceBps);
            }
        } else {
            m.status = Status.RESOLVED;
            m.outcome = Outcome(r.decision);
            emit MarketResolved(r.marketId, m.outcome, r.confidenceBps);
        }
    }

    // ============ Views ============

    /// @notice EIP-712 digest of a resolution (what the oracle signs).
    function hashResolution(Resolution calldata r) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    RESOLUTION_TYPEHASH,
                    r.marketId,
                    r.attempt,
                    r.decision,
                    r.confidenceBps,
                    r.rulesHash,
                    r.evidenceHash,
                    r.reasoningHash,
                    r.reportHash,
                    r.timestamp
                )
            )
        );
    }

    /// @notice evidenceHash = keccak256(concat(keccak256(abi.encode(keccak256(url), contentHash)) for each source))
    function computeEvidenceHash(Source[] calldata sources) public pure returns (bytes32) {
        bytes memory packed = new bytes(sources.length * 32);
        for (uint256 i = 0; i < sources.length; i++) {
            bytes32 leaf = keccak256(abi.encode(keccak256(bytes(sources[i].url)), sources[i].contentHash));
            assembly {
                mstore(add(add(packed, 32), mul(i, 32)), leaf)
            }
        }
        return keccak256(packed);
    }

    /// @notice Check a signature without submitting. Returns the recovered signer and whether it is authorized.
    function verifyResolution(Resolution calldata r, bytes calldata signature)
        external
        view
        returns (bool valid, address signer)
    {
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(hashResolution(r), signature);
        if (err != ECDSA.RecoverError.NoError) return (false, address(0));
        return (authorizedOracles[recovered], recovered);
    }

    function getMarket(uint256 marketId) external view returns (Market memory) {
        return _market(marketId);
    }

    function latestResolution(uint256 marketId) external view returns (ResolutionRecord memory) {
        _market(marketId);
        return _latest[marketId];
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function _market(uint256 marketId) private view returns (Market storage m) {
        m = _markets[marketId];
        if (m.status == Status.NONE) revert MarketNotFound();
    }
}
