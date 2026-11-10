// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title SettlementOracle
 * @notice Optimistic prediction-market resolution with a TEE-attested AI arbiter for escalated disputes.
 *
 * Flow (mirrors ORA's "AI Settlement Oracle" design):
 *   1. Business as usual  — someone proposes an outcome with a bond; if nobody disputes within the
 *                           liveness window, anyone can `settle` and the proposal becomes final.
 *   2. Single challenge   — the first dispute resets the market so a fresh proposal can be made.
 *   3. Double challenge   — a second dispute escalates the market. Instead of a token-holder vote
 *                           deciding the outcome, staked participants submit evidence + a verdict,
 *                           and an AI running inside a TEE weighs everything and issues the final,
 *                           signed resolution. Participants whose verdict matches the AI are rewarded
 *                           from the stakes of those who were wrong.
 *
 * Ambiguity handling: if the AI's confidence is below the market's threshold, the resolution is
 * *delayed* and the evidence window re-opens. After `maxDelays` low-confidence rounds the market is
 * paused for manual resolution by the owner (the accountable party).
 *
 * Trust: only signatures from enclave signer keys registered by the owner are accepted. Each key is
 * derived inside an Intel TDX confidential VM, and its TDX quote (which binds the key address and the
 * measured code) is recorded here by hash so anyone can audit it off-chain.
 */
contract SettlementOracle is Ownable, EIP712, ReentrancyGuard {
    // ============ Types ============

    enum Outcome {
        None,
        Yes,
        No,
        Invalid
    }

    enum Status {
        Open, // waiting for a proposal (after resolutionTime)
        Proposed, // proposal live; disputable until livenessEnd
        Escalated, // double-challenged; evidence window / awaiting AI
        Resolved, // final outcome set; claims open
        PausedForManual // AI stayed below confidence threshold too many times
    }

    struct Market {
        string question;
        string resolutionCriteria;
        uint64 resolutionTime;
        uint16 confidenceThresholdBps; // e.g. 7000 = 70%
        Status status;
        Outcome proposedOutcome;
        Outcome finalOutcome;
        uint8 disputeCount;
        uint8 aiRound; // number of AI rounds that ended in a delay
        address proposer;
        uint64 livenessEnd;
        uint64 evidenceDeadline;
        uint256 yesPool;
        uint256 noPool;
        bytes32 submissionsHash; // rolling hash over all evidence submissions
        address creator;
    }

    struct Submission {
        address submitter;
        Outcome verdict;
        uint256 stake;
        string evidenceURI;
        bytes32 contentHash; // keccak256 of the evidence content as seen by the submitter
        uint64 timestamp;
    }

    struct Position {
        uint256 yes;
        uint256 no;
        bool claimed;
    }

    struct EnclaveSigner {
        bool active;
        bytes32 composeHash; // dstack app compose hash (measured code identity)
        bytes32 quoteHash; // keccak256 of the raw TDX quote whose report_data binds this signer
    }

    // ============ Errors ============

    error MarketNotFound();
    error WrongStatus(Status expected, Status actual);
    error TooEarly();
    error TooLate();
    error InvalidOutcome();
    error WrongBond(uint256 expected, uint256 sent);
    error StakeTooLow(uint256 minimum, uint256 sent);
    error AlreadySubmitted();
    error UnknownEnclaveSigner(address recovered);
    error SubmissionsMismatch();
    error ReasoningMismatch();
    error NothingToClaim();
    error AlreadyClaimed();
    error TransferFailed();
    error BadThreshold();

    // ============ Events ============

    event MarketCreated(
        uint256 indexed marketId, address indexed creator, string question, uint64 resolutionTime
    );
    event OutcomeProposed(uint256 indexed marketId, address indexed proposer, Outcome outcome, uint64 livenessEnd);
    event ProposalDisputed(uint256 indexed marketId, address indexed disputer, uint8 disputeCount);
    event MarketEscalated(uint256 indexed marketId, uint64 evidenceDeadline);
    event EvidenceSubmitted(
        uint256 indexed marketId,
        address indexed submitter,
        Outcome verdict,
        uint256 stake,
        string evidenceURI,
        bytes32 contentHash
    );
    event MarketSettled(uint256 indexed marketId, Outcome outcome);
    event AIResolved(
        uint256 indexed marketId,
        Outcome outcome,
        uint16 confidenceBps,
        address indexed enclaveSigner,
        bytes32 transcriptHash,
        string reasoning
    );
    event ResolutionDelayed(
        uint256 indexed marketId,
        uint8 aiRound,
        uint16 confidenceBps,
        uint64 newEvidenceDeadline,
        bytes32 transcriptHash,
        string reasoning
    );
    event MarketPausedForManual(uint256 indexed marketId);
    event ManuallyResolved(uint256 indexed marketId, Outcome outcome);
    event Claimed(uint256 indexed marketId, address indexed account, uint256 amount);
    event EnclaveSignerRegistered(address indexed signer, bytes32 composeHash, bytes32 quoteHash);
    event EnclaveSignerRevoked(address indexed signer);

    // ============ EIP-712 ============

    bytes32 public constant RESOLUTION_TYPEHASH = keccak256(
        "Resolution(uint256 marketId,uint8 outcome,uint16 confidenceBps,bytes32 submissionsHash,bytes32 reasoningHash,bytes32 transcriptHash,uint8 round)"
    );

    // ============ Config ============

    uint256 public immutable proposalBond;
    uint256 public immutable minEvidenceStake;
    uint64 public immutable liveness;
    uint64 public immutable evidenceWindow;
    uint64 public immutable delayPeriod;
    uint8 public immutable maxDelays;

    // ============ State ============

    uint256 public marketCount;
    mapping(uint256 => Market) internal _markets;
    mapping(uint256 => Submission[]) internal _submissions;
    mapping(uint256 => mapping(address => bool)) public hasSubmitted;
    mapping(uint256 => mapping(address => Position)) public positions;
    mapping(address => EnclaveSigner) public enclaveSigners;

    constructor(
        uint256 _proposalBond,
        uint256 _minEvidenceStake,
        uint64 _liveness,
        uint64 _evidenceWindow,
        uint64 _delayPeriod,
        uint8 _maxDelays
    ) Ownable(msg.sender) EIP712("SettlementOracle", "1") {
        proposalBond = _proposalBond;
        minEvidenceStake = _minEvidenceStake;
        liveness = _liveness;
        evidenceWindow = _evidenceWindow;
        delayPeriod = _delayPeriod;
        maxDelays = _maxDelays;
    }

    // ============ Admin ============

    function registerEnclaveSigner(address signer, bytes32 composeHash, bytes32 quoteHash) external onlyOwner {
        enclaveSigners[signer] = EnclaveSigner({active: true, composeHash: composeHash, quoteHash: quoteHash});
        emit EnclaveSignerRegistered(signer, composeHash, quoteHash);
    }

    function revokeEnclaveSigner(address signer) external onlyOwner {
        enclaveSigners[signer].active = false;
        emit EnclaveSignerRevoked(signer);
    }

    /// @notice Last-resort resolution after the AI stayed below the confidence threshold `maxDelays` times.
    function manualResolve(uint256 marketId, Outcome outcome) external onlyOwner {
        Market storage m = _market(marketId);
        _requireStatus(m, Status.PausedForManual);
        if (outcome == Outcome.None) revert InvalidOutcome();
        m.status = Status.Resolved;
        m.finalOutcome = outcome;
        emit ManuallyResolved(marketId, outcome);
    }

    // ============ Market lifecycle ============

    function createMarket(
        string calldata question,
        string calldata resolutionCriteria,
        uint64 resolutionTime,
        uint16 confidenceThresholdBps
    ) external returns (uint256 marketId) {
        if (confidenceThresholdBps == 0 || confidenceThresholdBps > 10_000) revert BadThreshold();
        marketId = ++marketCount;
        Market storage m = _markets[marketId];
        m.question = question;
        m.resolutionCriteria = resolutionCriteria;
        m.resolutionTime = resolutionTime;
        m.confidenceThresholdBps = confidenceThresholdBps;
        m.creator = msg.sender;
        emit MarketCreated(marketId, msg.sender, question, resolutionTime);
    }

    function propose(uint256 marketId, Outcome outcome) external payable {
        Market storage m = _market(marketId);
        _requireStatus(m, Status.Open);
        if (block.timestamp < m.resolutionTime) revert TooEarly();
        if (outcome != Outcome.Yes && outcome != Outcome.No) revert InvalidOutcome();
        if (msg.value != proposalBond) revert WrongBond(proposalBond, msg.value);

        _addPosition(marketId, m, msg.sender, outcome, msg.value);
        m.status = Status.Proposed;
        m.proposedOutcome = outcome;
        m.proposer = msg.sender;
        m.livenessEnd = uint64(block.timestamp) + liveness;
        emit OutcomeProposed(marketId, msg.sender, outcome, m.livenessEnd);
    }

    function dispute(uint256 marketId) external payable {
        Market storage m = _market(marketId);
        _requireStatus(m, Status.Proposed);
        if (block.timestamp >= m.livenessEnd) revert TooLate();
        if (msg.value != proposalBond) revert WrongBond(proposalBond, msg.value);

        Outcome opposite = m.proposedOutcome == Outcome.Yes ? Outcome.No : Outcome.Yes;
        _addPosition(marketId, m, msg.sender, opposite, msg.value);
        m.disputeCount += 1;
        emit ProposalDisputed(marketId, msg.sender, m.disputeCount);

        if (m.disputeCount == 1) {
            // Single challenge: reset and allow a fresh proposal. Bonds stay escrowed on their sides.
            m.status = Status.Open;
            m.proposedOutcome = Outcome.None;
            m.proposer = address(0);
            m.livenessEnd = 0;
        } else {
            // Double challenge: escalate to the evidence round + AI arbiter.
            m.status = Status.Escalated;
            m.evidenceDeadline = uint64(block.timestamp) + evidenceWindow;
            emit MarketEscalated(marketId, m.evidenceDeadline);
        }
    }

    function settle(uint256 marketId) external {
        Market storage m = _market(marketId);
        _requireStatus(m, Status.Proposed);
        if (block.timestamp < m.livenessEnd) revert TooEarly();
        m.status = Status.Resolved;
        m.finalOutcome = m.proposedOutcome;
        emit MarketSettled(marketId, m.finalOutcome);
    }

    function submitEvidence(uint256 marketId, Outcome verdict, string calldata evidenceURI, bytes32 contentHash)
        external
        payable
    {
        Market storage m = _market(marketId);
        _requireStatus(m, Status.Escalated);
        if (block.timestamp >= m.evidenceDeadline) revert TooLate();
        if (verdict != Outcome.Yes && verdict != Outcome.No) revert InvalidOutcome();
        if (msg.value < minEvidenceStake) revert StakeTooLow(minEvidenceStake, msg.value);
        if (hasSubmitted[marketId][msg.sender]) revert AlreadySubmitted();

        hasSubmitted[marketId][msg.sender] = true;
        _addPosition(marketId, m, msg.sender, verdict, msg.value);
        _submissions[marketId].push(
            Submission({
                submitter: msg.sender,
                verdict: verdict,
                stake: msg.value,
                evidenceURI: evidenceURI,
                contentHash: contentHash,
                timestamp: uint64(block.timestamp)
            })
        );
        m.submissionsHash = keccak256(
            abi.encode(m.submissionsHash, msg.sender, verdict, msg.value, keccak256(bytes(evidenceURI)), contentHash)
        );
        emit EvidenceSubmitted(marketId, msg.sender, verdict, msg.value, evidenceURI, contentHash);
    }

    /**
     * @notice Apply an AI resolution signed by a registered enclave key. Permissionless: anyone may relay.
     * @param reasoning Full reasoning text; its hash must match the signed `reasoningHash`.
     * @param transcriptHash keccak256 of the full oracle transcript (prompt, evidence, model response),
     *        published by the oracle for audit.
     */
    function resolveWithAttestation(
        uint256 marketId,
        Outcome outcome,
        uint16 confidenceBps,
        bytes32 submissionsHash,
        string calldata reasoning,
        bytes32 transcriptHash,
        bytes calldata signature
    ) external {
        Market storage m = _market(marketId);
        _requireStatus(m, Status.Escalated);
        if (block.timestamp < m.evidenceDeadline) revert TooEarly();
        if (outcome == Outcome.None) revert InvalidOutcome();
        if (submissionsHash != m.submissionsHash) revert SubmissionsMismatch();

        bytes32 digest = resolutionDigest(
            marketId, outcome, confidenceBps, submissionsHash, keccak256(bytes(reasoning)), transcriptHash, m.aiRound
        );
        address signer = ECDSA.recover(digest, signature);
        if (!enclaveSigners[signer].active) revert UnknownEnclaveSigner(signer);

        if (confidenceBps < m.confidenceThresholdBps) {
            m.aiRound += 1;
            if (m.aiRound > maxDelays) {
                m.status = Status.PausedForManual;
                emit ResolutionDelayed(marketId, m.aiRound, confidenceBps, 0, transcriptHash, reasoning);
                emit MarketPausedForManual(marketId);
            } else {
                m.evidenceDeadline = uint64(block.timestamp) + delayPeriod;
                emit ResolutionDelayed(marketId, m.aiRound, confidenceBps, m.evidenceDeadline, transcriptHash, reasoning);
            }
            return;
        }

        m.status = Status.Resolved;
        m.finalOutcome = outcome;
        emit AIResolved(marketId, outcome, confidenceBps, signer, transcriptHash, reasoning);
    }

    /**
     * @notice Withdraw bond/stake after resolution. Winners split the losing side's pool pro rata;
     *         INVALID (or a winning side nobody backed) refunds everyone.
     */
    function claim(uint256 marketId) external nonReentrant returns (uint256 amount) {
        Market storage m = _market(marketId);
        _requireStatus(m, Status.Resolved);
        Position storage p = positions[marketId][msg.sender];
        if (p.claimed) revert AlreadyClaimed();

        amount = claimable(marketId, msg.sender);
        if (amount == 0) revert NothingToClaim();
        p.claimed = true;

        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Claimed(marketId, msg.sender, amount);
    }

    // ============ Views ============

    function claimable(uint256 marketId, address account) public view returns (uint256) {
        Market storage m = _markets[marketId];
        Position storage p = positions[marketId][account];
        if (m.status != Status.Resolved || p.claimed) return 0;

        Outcome f = m.finalOutcome;
        uint256 winPool = f == Outcome.Yes ? m.yesPool : f == Outcome.No ? m.noPool : 0;
        if (f == Outcome.Invalid || winPool == 0) return p.yes + p.no;

        uint256 losePool = f == Outcome.Yes ? m.noPool : m.yesPool;
        uint256 mine = f == Outcome.Yes ? p.yes : p.no;
        return mine + (mine * losePool) / winPool;
    }

    function resolutionDigest(
        uint256 marketId,
        Outcome outcome,
        uint16 confidenceBps,
        bytes32 submissionsHash,
        bytes32 reasoningHash,
        bytes32 transcriptHash,
        uint8 round
    ) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    RESOLUTION_TYPEHASH,
                    marketId,
                    outcome,
                    confidenceBps,
                    submissionsHash,
                    reasoningHash,
                    transcriptHash,
                    round
                )
            )
        );
    }

    function getMarket(uint256 marketId) external view returns (Market memory) {
        return _markets[marketId];
    }

    function getSubmissions(uint256 marketId) external view returns (Submission[] memory) {
        return _submissions[marketId];
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ============ Internal ============

    function _market(uint256 marketId) internal view returns (Market storage m) {
        m = _markets[marketId];
        if (m.creator == address(0)) revert MarketNotFound();
    }

    function _requireStatus(Market storage m, Status expected) internal view {
        if (m.status != expected) revert WrongStatus(expected, m.status);
    }

    function _addPosition(uint256 marketId, Market storage m, address who, Outcome side, uint256 amount) internal {
        Position storage p = positions[marketId][who];
        if (side == Outcome.Yes) {
            p.yes += amount;
            m.yesPool += amount;
        } else {
            p.no += amount;
            m.noPool += amount;
        }
    }
}
