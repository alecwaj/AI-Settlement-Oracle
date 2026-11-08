// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SettlementOracle} from "../src/SettlementOracle.sol";

contract SettlementOracleTest is Test {
    SettlementOracle internal oracle;

    address internal owner = makeAddr("owner");
    uint256 internal oraclePk = 0xA11CE;
    address internal oracleSigner;
    uint256 internal attackerPk = 0xBAD;

    string internal constant QUESTION = "Will NASA find definitive evidence of extraterrestrial life in 2025?";
    string internal constant RULES = '{"question":"...","yes":["living organisms"],"no":["precursor molecules only"]}';
    uint64 internal constant RETRY_DELAY = 1 hours;
    uint16 internal constant THRESHOLD = 7000;

    uint256 internal marketId;
    uint64 internal resolutionTime;

    function setUp() public {
        vm.warp(1_760_000_000);
        oracleSigner = vm.addr(oraclePk);
        vm.prank(owner);
        oracle = new SettlementOracle(oracleSigner, RETRY_DELAY);
        resolutionTime = uint64(block.timestamp - 1 days);
        marketId = oracle.createMarket(QUESTION, RULES, resolutionTime, THRESHOLD);
    }

    // ============ Helpers ============

    function _sources() internal pure returns (SettlementOracle.Source[] memory s) {
        s = new SettlementOracle.Source[](2);
        s[0] = SettlementOracle.Source("https://www.theguardian.com/science/a", sha256("article a text"));
        s[1] = SettlementOracle.Source("https://www.nasa.gov/news-release/b", sha256("article b text"));
    }

    function _evidenceHash(SettlementOracle.Source[] memory s) internal pure returns (bytes32) {
        bytes memory packed;
        for (uint256 i = 0; i < s.length; i++) {
            packed = abi.encodePacked(packed, keccak256(abi.encode(keccak256(bytes(s[i].url)), s[i].contentHash)));
        }
        return keccak256(packed);
    }

    function _resolution(uint8 decision, uint16 confidenceBps, string memory reasoning)
        internal
        view
        returns (SettlementOracle.Resolution memory r)
    {
        SettlementOracle.Market memory m = oracle.getMarket(marketId);
        r = SettlementOracle.Resolution({
            marketId: marketId,
            attempt: m.attempts,
            decision: decision,
            confidenceBps: confidenceBps,
            rulesHash: keccak256(bytes(RULES)),
            evidenceHash: _evidenceHash(_sources()),
            reasoningHash: keccak256(bytes(reasoning)),
            reportHash: keccak256("report"),
            timestamp: uint64(block.timestamp)
        });
    }

    function _sign(uint256 pk, SettlementOracle.Resolution memory r) internal view returns (bytes memory) {
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(pk, oracle.hashResolution(r));
        return abi.encodePacked(rr, s, v);
    }

    function _submit(uint8 decision, uint16 confidenceBps) internal {
        string memory reasoning = "{\"decision\":\"x\"}";
        SettlementOracle.Resolution memory r = _resolution(decision, confidenceBps, reasoning);
        oracle.submitResolution(r, reasoning, _sources(), _sign(oraclePk, r));
    }

    // ============ Market creation ============

    function test_CreateMarketStoresRulesAndHash() public view {
        SettlementOracle.Market memory m = oracle.getMarket(marketId);
        assertEq(m.question, QUESTION);
        assertEq(m.rules, RULES);
        assertEq(m.rulesHash, keccak256(bytes(RULES)));
        assertEq(uint8(m.status), uint8(SettlementOracle.Status.OPEN));
        assertEq(m.confidenceThresholdBps, THRESHOLD);
    }

    function test_RevertWhen_ThresholdInvalid() public {
        vm.expectRevert(SettlementOracle.InvalidThreshold.selector);
        oracle.createMarket(QUESTION, RULES, resolutionTime, 0);
        vm.expectRevert(SettlementOracle.InvalidThreshold.selector);
        oracle.createMarket(QUESTION, RULES, resolutionTime, 10_001);
    }

    // ============ EIP-712 ============

    function test_DigestMatchesIndependentEip712Encoding() public view {
        SettlementOracle.Resolution memory r = _resolution(2, 9000, "logic");
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("SettlementOracle"),
                keccak256("1"),
                block.chainid,
                address(oracle)
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "Resolution(uint256 marketId,uint32 attempt,uint8 decision,uint16 confidenceBps,bytes32 rulesHash,bytes32 evidenceHash,bytes32 reasoningHash,bytes32 reportHash,uint64 timestamp)"
                ),
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
        );
        assertEq(oracle.hashResolution(r), keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        assertEq(oracle.domainSeparator(), domain);
    }

    function test_EvidenceHashMatchesSpec() public view {
        assertEq(oracle.computeEvidenceHash(_sources()), _evidenceHash(_sources()));
    }

    function test_VerifyResolution() public view {
        SettlementOracle.Resolution memory r = _resolution(2, 9000, "logic");
        (bool ok, address signer) = oracle.verifyResolution(r, _sign(oraclePk, r));
        assertTrue(ok);
        assertEq(signer, oracleSigner);
        (ok, signer) = oracle.verifyResolution(r, _sign(attackerPk, r));
        assertFalse(ok);
        assertEq(signer, vm.addr(attackerPk));
    }

    // ============ Resolution paths ============

    function test_HighConfidenceResolves() public {
        _submit(2, 9200);
        SettlementOracle.Market memory m = oracle.getMarket(marketId);
        assertEq(uint8(m.status), uint8(SettlementOracle.Status.RESOLVED));
        assertEq(uint8(m.outcome), uint8(SettlementOracle.Outcome.NO));
        assertEq(m.attempts, 1);

        SettlementOracle.ResolutionRecord memory rec = oracle.latestResolution(marketId);
        assertEq(rec.signer, oracleSigner);
        assertEq(rec.resolution.confidenceBps, 9200);
    }

    function test_YesResolves() public {
        _submit(1, 8000);
        assertEq(uint8(oracle.getMarket(marketId).outcome), uint8(SettlementOracle.Outcome.YES));
    }

    function test_EmitsDecisionLogicAndSources() public {
        string memory reasoning = "{\"decision\":\"NO\"}";
        SettlementOracle.Resolution memory r = _resolution(2, 9000, reasoning);
        SettlementOracle.Source[] memory s = _sources();
        bytes memory sig = _sign(oraclePk, r);

        vm.expectEmit(true, true, true, true, address(oracle));
        emit SettlementOracle.ResolutionPosted(
            marketId, 0, oracleSigner, 2, 9000, r.evidenceHash, r.reasoningHash, r.reportHash, reasoning
        );
        vm.expectEmit(true, true, false, true, address(oracle));
        emit SettlementOracle.EvidenceSource(marketId, 0, 0, s[0].contentHash, s[0].url);
        vm.expectEmit(true, true, false, true, address(oracle));
        emit SettlementOracle.EvidenceSource(marketId, 0, 1, s[1].contentHash, s[1].url);
        oracle.submitResolution(r, reasoning, s, sig);
    }

    function test_LowConfidenceDelays() public {
        _submit(2, 6999);
        SettlementOracle.Market memory m = oracle.getMarket(marketId);
        assertEq(uint8(m.status), uint8(SettlementOracle.Status.DELAYED));
        assertEq(m.delayCount, 1);
        assertEq(m.delayedUntil, uint64(block.timestamp) + RETRY_DELAY);
        assertEq(uint8(m.outcome), uint8(SettlementOracle.Outcome.NONE));
    }

    function test_InsufficientEvidenceDelaysEvenAtHighConfidence() public {
        _submit(0, 9500);
        assertEq(uint8(oracle.getMarket(marketId).status), uint8(SettlementOracle.Status.DELAYED));
    }

    function test_RevertWhen_RetryBeforeDelayElapsed() public {
        _submit(0, 0);
        uint64 until = oracle.getMarket(marketId).delayedUntil;
        string memory reasoning = "{\"decision\":\"x\"}";
        SettlementOracle.Resolution memory r = _resolution(2, 9000, reasoning);
        bytes memory sig = _sign(oraclePk, r);
        SettlementOracle.Source[] memory s = _sources();
        vm.expectRevert(abi.encodeWithSelector(SettlementOracle.TooEarly.selector, until));
        oracle.submitResolution(r, reasoning, s, sig);
    }

    function test_DelayThenResolve() public {
        _submit(0, 3000);
        vm.warp(block.timestamp + RETRY_DELAY);
        _submit(2, 8800);
        SettlementOracle.Market memory m = oracle.getMarket(marketId);
        assertEq(uint8(m.status), uint8(SettlementOracle.Status.RESOLVED));
        assertEq(m.delayCount, 1);
        assertEq(m.attempts, 2);
    }

    function test_ThreeDelaysPauseThenManualResolve() public {
        for (uint256 i = 0; i < 3; i++) {
            _submit(0, 2000);
            vm.warp(block.timestamp + RETRY_DELAY);
        }
        SettlementOracle.Market memory m = oracle.getMarket(marketId);
        assertEq(uint8(m.status), uint8(SettlementOracle.Status.PAUSED));
        assertEq(m.delayCount, 3);

        string memory reasoning = "{\"decision\":\"x\"}";
        SettlementOracle.Resolution memory r = _resolution(2, 9000, reasoning);
        bytes memory sig = _sign(oraclePk, r);
        SettlementOracle.Source[] memory s = _sources();
        vm.expectRevert(
            abi.encodeWithSelector(SettlementOracle.NotAcceptingResolutions.selector, SettlementOracle.Status.PAUSED)
        );
        oracle.submitResolution(r, reasoning, s, sig);

        vm.expectRevert();
        oracle.manualResolve(marketId, SettlementOracle.Outcome.NO, "not owner");

        vm.prank(owner);
        oracle.manualResolve(marketId, SettlementOracle.Outcome.NO, "reviewed by operator");
        m = oracle.getMarket(marketId);
        assertEq(uint8(m.status), uint8(SettlementOracle.Status.RESOLVED));
        assertEq(uint8(m.outcome), uint8(SettlementOracle.Outcome.NO));
    }

    // ============ Integrity checks ============

    function test_RevertWhen_SignerUnauthorized() public {
        string memory reasoning = "logic";
        SettlementOracle.Resolution memory r = _resolution(2, 9000, reasoning);
        bytes memory sig = _sign(attackerPk, r);
        SettlementOracle.Source[] memory s = _sources();
        vm.expectRevert(abi.encodeWithSelector(SettlementOracle.UnauthorizedSigner.selector, vm.addr(attackerPk)));
        oracle.submitResolution(r, reasoning, s, sig);
    }

    function test_RevertWhen_DecisionTamperedAfterSigning() public {
        string memory reasoning = "logic";
        SettlementOracle.Resolution memory r = _resolution(2, 9000, reasoning);
        bytes memory sig = _sign(oraclePk, r);
        r.decision = 1; // flip NO -> YES
        SettlementOracle.Source[] memory s = _sources();
        vm.expectPartialRevert(SettlementOracle.UnauthorizedSigner.selector);
        oracle.submitResolution(r, reasoning, s, sig);
    }

    function test_RevertWhen_ReasoningTampered() public {
        SettlementOracle.Resolution memory r = _resolution(2, 9000, "original logic");
        bytes memory sig = _sign(oraclePk, r);
        SettlementOracle.Source[] memory s = _sources();
        vm.expectRevert(SettlementOracle.ReasoningMismatch.selector);
        oracle.submitResolution(r, "edited logic", s, sig);
    }

    function test_RevertWhen_SourcesTampered() public {
        string memory reasoning = "logic";
        SettlementOracle.Resolution memory r = _resolution(2, 9000, reasoning);
        bytes memory sig = _sign(oraclePk, r);
        SettlementOracle.Source[] memory s = _sources();
        s[1].contentHash = sha256("different text");
        vm.expectRevert(SettlementOracle.EvidenceMismatch.selector);
        oracle.submitResolution(r, reasoning, s, sig);
    }

    function test_RevertWhen_RulesHashDoesNotMatchMarket() public {
        string memory reasoning = "logic";
        SettlementOracle.Resolution memory r = _resolution(2, 9000, reasoning);
        r.rulesHash = keccak256("other rules");
        bytes memory sig = _sign(oraclePk, r);
        SettlementOracle.Source[] memory s = _sources();
        vm.expectRevert(SettlementOracle.RulesMismatch.selector);
        oracle.submitResolution(r, reasoning, s, sig);
    }

    function test_RevertWhen_ReplayingOldAttempt() public {
        string memory reasoning = "logic";
        SettlementOracle.Resolution memory r = _resolution(0, 1000, reasoning);
        bytes memory sig = _sign(oraclePk, r);
        SettlementOracle.Source[] memory s = _sources();
        oracle.submitResolution(r, reasoning, s, sig);
        vm.warp(block.timestamp + RETRY_DELAY);
        vm.expectRevert(abi.encodeWithSelector(SettlementOracle.StaleAttempt.selector, uint32(1), uint32(0)));
        oracle.submitResolution(r, reasoning, s, sig);
    }

    function test_RevertWhen_TimestampBeforeResolutionTime() public {
        string memory reasoning = "logic";
        SettlementOracle.Resolution memory r = _resolution(2, 9000, reasoning);
        r.timestamp = resolutionTime - 1;
        bytes memory sig = _sign(oraclePk, r);
        SettlementOracle.Source[] memory s = _sources();
        vm.expectRevert(SettlementOracle.TimestampOutOfRange.selector);
        oracle.submitResolution(r, reasoning, s, sig);
    }

    function test_RevertWhen_AlreadyResolved() public {
        _submit(2, 9000);
        string memory reasoning = "logic";
        SettlementOracle.Resolution memory r = _resolution(1, 9000, reasoning);
        bytes memory sig = _sign(oraclePk, r);
        SettlementOracle.Source[] memory s = _sources();
        vm.expectRevert(
            abi.encodeWithSelector(SettlementOracle.NotAcceptingResolutions.selector, SettlementOracle.Status.RESOLVED)
        );
        oracle.submitResolution(r, reasoning, s, sig);
    }

    function test_AnyoneCanRelayASignedReport() public {
        string memory reasoning = "logic";
        SettlementOracle.Resolution memory r = _resolution(2, 9000, reasoning);
        bytes memory sig = _sign(oraclePk, r);
        SettlementOracle.Source[] memory s = _sources();
        vm.prank(makeAddr("relayer"));
        oracle.submitResolution(r, reasoning, s, sig);
        assertEq(oracle.latestResolution(marketId).signer, oracleSigner);
    }

    function test_RevokedOracleCannotSubmit() public {
        vm.prank(owner);
        oracle.setOracle(oracleSigner, false);
        string memory reasoning = "logic";
        SettlementOracle.Resolution memory r = _resolution(2, 9000, reasoning);
        bytes memory sig = _sign(oraclePk, r);
        SettlementOracle.Source[] memory s = _sources();
        vm.expectRevert(abi.encodeWithSelector(SettlementOracle.UnauthorizedSigner.selector, oracleSigner));
        oracle.submitResolution(r, reasoning, s, sig);
    }
}
