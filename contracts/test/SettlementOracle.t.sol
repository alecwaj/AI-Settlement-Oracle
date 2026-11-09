// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SettlementOracle} from "../src/SettlementOracle.sol";

contract SettlementOracleTest is Test {
    SettlementOracle oracle;

    uint256 constant BOND = 0.1 ether;
    uint256 constant MIN_STAKE = 0.01 ether;
    uint64 constant LIVENESS = 2 hours;
    uint64 constant EVIDENCE_WINDOW = 1 days;
    uint64 constant DELAY = 6 hours;
    uint8 constant MAX_DELAYS = 3;

    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address dave = makeAddr("dave");
    address erin = makeAddr("erin");

    uint256 enclaveKey = 0xE11C1A7E;
    address enclave;

    function setUp() public {
        vm.prank(owner);
        oracle = new SettlementOracle(BOND, MIN_STAKE, LIVENESS, EVIDENCE_WINDOW, DELAY, MAX_DELAYS);
        enclave = vm.addr(enclaveKey);
        vm.prank(owner);
        oracle.registerEnclaveSigner(enclave, keccak256("compose"), keccak256("quote"));

        address[5] memory users = [alice, bob, carol, dave, erin];
        for (uint256 i; i < users.length; i++) {
            vm.deal(users[i], 10 ether);
        }
    }

    // ---------- helpers ----------

    function _create() internal returns (uint256 id) {
        id = oracle.createMarket(
            "Will NASA find definitive evidence of extraterrestrial life in 2025?",
            "YES only for living organisms, fossils or unambiguous biosignatures; precursor molecules => NO.",
            uint64(block.timestamp + 1),
            7000
        );
        vm.warp(block.timestamp + 2);
    }

    function _escalate(uint256 id) internal {
        vm.prank(alice);
        oracle.propose{value: BOND}(id, SettlementOracle.Outcome.Yes);
        vm.prank(bob);
        oracle.dispute{value: BOND}(id); // single challenge -> reset
        vm.prank(carol);
        oracle.propose{value: BOND}(id, SettlementOracle.Outcome.Yes);
        vm.prank(dave);
        oracle.dispute{value: BOND}(id); // double challenge -> escalate
    }

    function _sign(
        uint256 id,
        SettlementOracle.Outcome outcome,
        uint16 conf,
        string memory reasoning,
        bytes32 transcript,
        uint256 key
    ) internal view returns (bytes memory) {
        SettlementOracle.Market memory m = oracle.getMarket(id);
        bytes32 digest = oracle.resolutionDigest(
            id, outcome, conf, m.submissionsHash, keccak256(bytes(reasoning)), transcript, m.aiRound
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _resolve(uint256 id, SettlementOracle.Outcome outcome, uint16 conf) internal {
        string memory reasoning = "Amino acids are precursor molecules, not life.";
        bytes32 transcript = keccak256("transcript");
        bytes memory sig = _sign(id, outcome, conf, reasoning, transcript, enclaveKey);
        bytes32 subs = oracle.getMarket(id).submissionsHash;
        oracle.resolveWithAttestation(id, outcome, conf, subs, reasoning, transcript, sig);
    }

    // ---------- business as usual ----------

    function test_UndisputedProposalSettles() public {
        uint256 id = _create();
        vm.prank(alice);
        oracle.propose{value: BOND}(id, SettlementOracle.Outcome.No);

        vm.expectRevert(SettlementOracle.TooEarly.selector);
        oracle.settle(id);

        vm.warp(block.timestamp + LIVENESS);
        oracle.settle(id);
        assertEq(uint8(oracle.getMarket(id).finalOutcome), uint8(SettlementOracle.Outcome.No));

        uint256 before = alice.balance;
        vm.prank(alice);
        oracle.claim(id);
        assertEq(alice.balance - before, BOND);
    }

    function test_CannotProposeBeforeResolutionTime() public {
        uint256 id = oracle.createMarket("q", "c", uint64(block.timestamp + 1 days), 7000);
        vm.prank(alice);
        vm.expectRevert(SettlementOracle.TooEarly.selector);
        oracle.propose{value: BOND}(id, SettlementOracle.Outcome.Yes);
    }

    function test_WrongBondReverts() public {
        uint256 id = _create();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SettlementOracle.WrongBond.selector, BOND, 1 wei));
        oracle.propose{value: 1 wei}(id, SettlementOracle.Outcome.Yes);
    }

    // ---------- challenge flows ----------

    function test_SingleChallengeResetsMarket() public {
        uint256 id = _create();
        vm.prank(alice);
        oracle.propose{value: BOND}(id, SettlementOracle.Outcome.Yes);
        vm.prank(bob);
        oracle.dispute{value: BOND}(id);

        SettlementOracle.Market memory m = oracle.getMarket(id);
        assertEq(uint8(m.status), uint8(SettlementOracle.Status.Open));
        assertEq(m.disputeCount, 1);
        assertEq(m.yesPool, BOND);
        assertEq(m.noPool, BOND);
    }

    function test_DoubleChallengeEscalates() public {
        uint256 id = _create();
        _escalate(id);
        SettlementOracle.Market memory m = oracle.getMarket(id);
        assertEq(uint8(m.status), uint8(SettlementOracle.Status.Escalated));
        assertEq(m.evidenceDeadline, block.timestamp + EVIDENCE_WINDOW);
    }

    function test_DisputeAfterLivenessReverts() public {
        uint256 id = _create();
        vm.prank(alice);
        oracle.propose{value: BOND}(id, SettlementOracle.Outcome.Yes);
        vm.warp(block.timestamp + LIVENESS);
        vm.prank(bob);
        vm.expectRevert(SettlementOracle.TooLate.selector);
        oracle.dispute{value: BOND}(id);
    }

    // ---------- evidence + AI arbiter ----------

    function test_EvidenceUpdatesRollingHash() public {
        uint256 id = _create();
        _escalate(id);
        bytes32 h0 = oracle.getMarket(id).submissionsHash;
        vm.prank(erin);
        oracle.submitEvidence{value: MIN_STAKE}(id, SettlementOracle.Outcome.No, "https://nasa.gov/x", bytes32(uint256(1)));
        bytes32 expected = keccak256(
            abi.encode(h0, erin, SettlementOracle.Outcome.No, MIN_STAKE, keccak256(bytes("https://nasa.gov/x")), bytes32(uint256(1)))
        );
        assertEq(oracle.getMarket(id).submissionsHash, expected);
        assertEq(oracle.getSubmissions(id).length, 1);

        vm.prank(erin);
        vm.expectRevert(SettlementOracle.AlreadySubmitted.selector);
        oracle.submitEvidence{value: MIN_STAKE}(id, SettlementOracle.Outcome.No, "u", bytes32(0));
    }

    function test_AIResolutionRewardsCorrectSideAndSlashesWrongSide() public {
        uint256 id = _create();
        _escalate(id); // YES: alice, carol (0.2) | NO: bob, dave (0.2)
        vm.prank(erin);
        oracle.submitEvidence{value: 0.2 ether}(id, SettlementOracle.Outcome.No, "https://nasa.gov/bennu", bytes32(0));

        vm.expectRevert(SettlementOracle.TooEarly.selector);
        this.externalResolve(id, SettlementOracle.Outcome.No, 9200);

        vm.warp(block.timestamp + EVIDENCE_WINDOW);
        _resolve(id, SettlementOracle.Outcome.No, 9200);
        assertEq(uint8(oracle.getMarket(id).status), uint8(SettlementOracle.Status.Resolved));

        // NO pool = 0.1 (bob) + 0.1 (dave) + 0.2 (erin) = 0.4; YES pool = 0.2 is slashed and split pro rata.
        assertEq(oracle.claimable(id, erin), 0.2 ether + 0.1 ether);
        assertEq(oracle.claimable(id, bob), 0.1 ether + 0.05 ether);
        assertEq(oracle.claimable(id, alice), 0);

        uint256 before = erin.balance;
        vm.prank(erin);
        oracle.claim(id);
        assertEq(erin.balance - before, 0.3 ether);

        vm.prank(erin);
        vm.expectRevert(SettlementOracle.AlreadyClaimed.selector);
        oracle.claim(id);

        vm.prank(alice);
        vm.expectRevert(SettlementOracle.NothingToClaim.selector);
        oracle.claim(id);
    }

    function externalResolve(uint256 id, SettlementOracle.Outcome outcome, uint16 conf) external {
        _resolve(id, outcome, conf);
    }

    function test_InvalidRefundsEveryone() public {
        uint256 id = _create();
        _escalate(id);
        vm.warp(block.timestamp + EVIDENCE_WINDOW);
        _resolve(id, SettlementOracle.Outcome.Invalid, 9000);
        assertEq(oracle.claimable(id, alice), BOND);
        assertEq(oracle.claimable(id, dave), BOND);
    }

    function test_RejectsUnregisteredSigner() public {
        uint256 id = _create();
        _escalate(id);
        vm.warp(block.timestamp + EVIDENCE_WINDOW);
        uint256 rogueKey = 0xBAD;
        bytes memory sig = _sign(id, SettlementOracle.Outcome.Yes, 9900, "r", bytes32(0), rogueKey);
        bytes32 subs = oracle.getMarket(id).submissionsHash;
        vm.expectRevert(abi.encodeWithSelector(SettlementOracle.UnknownEnclaveSigner.selector, vm.addr(rogueKey)));
        oracle.resolveWithAttestation(id, SettlementOracle.Outcome.Yes, 9900, subs, "r", bytes32(0), sig);
    }

    function test_RejectsTamperedReasoning() public {
        uint256 id = _create();
        _escalate(id);
        vm.warp(block.timestamp + EVIDENCE_WINDOW);
        bytes memory sig = _sign(id, SettlementOracle.Outcome.No, 9000, "original", bytes32(0), enclaveKey);
        bytes32 subs = oracle.getMarket(id).submissionsHash;
        vm.expectRevert(); // recovers a different (unregistered) address
        oracle.resolveWithAttestation(id, SettlementOracle.Outcome.No, 9000, subs, "tampered", bytes32(0), sig);
    }

    function test_RejectsStaleSubmissionsHash() public {
        uint256 id = _create();
        _escalate(id);
        vm.warp(block.timestamp + EVIDENCE_WINDOW);
        bytes memory sig = _sign(id, SettlementOracle.Outcome.No, 9000, "r", bytes32(0), enclaveKey);
        vm.expectRevert(SettlementOracle.SubmissionsMismatch.selector);
        oracle.resolveWithAttestation(id, SettlementOracle.Outcome.No, 9000, bytes32(uint256(42)), "r", bytes32(0), sig);
    }

    function test_RevokedSignerRejected() public {
        uint256 id = _create();
        _escalate(id);
        vm.warp(block.timestamp + EVIDENCE_WINDOW);
        vm.prank(owner);
        oracle.revokeEnclaveSigner(enclave);
        vm.expectRevert(abi.encodeWithSelector(SettlementOracle.UnknownEnclaveSigner.selector, enclave));
        this.externalResolve(id, SettlementOracle.Outcome.No, 9000);
    }

    // ---------- delay / manual fallback ----------

    function test_LowConfidenceDelaysThenPausesForManual() public {
        uint256 id = _create();
        _escalate(id);

        for (uint8 i = 1; i <= MAX_DELAYS; i++) {
            vm.warp(oracle.getMarket(id).evidenceDeadline);
            _resolve(id, SettlementOracle.Outcome.No, 5000);
            SettlementOracle.Market memory m = oracle.getMarket(id);
            assertEq(uint8(m.status), uint8(SettlementOracle.Status.Escalated));
            assertEq(m.aiRound, i);
            assertEq(m.evidenceDeadline, block.timestamp + DELAY);
        }

        // Evidence window re-opened during a delay
        vm.prank(erin);
        oracle.submitEvidence{value: MIN_STAKE}(id, SettlementOracle.Outcome.No, "new", bytes32(0));

        vm.warp(oracle.getMarket(id).evidenceDeadline);
        _resolve(id, SettlementOracle.Outcome.No, 5000);
        assertEq(uint8(oracle.getMarket(id).status), uint8(SettlementOracle.Status.PausedForManual));

        vm.prank(alice);
        vm.expectRevert();
        oracle.manualResolve(id, SettlementOracle.Outcome.No);

        vm.prank(owner);
        oracle.manualResolve(id, SettlementOracle.Outcome.No);
        assertEq(uint8(oracle.getMarket(id).finalOutcome), uint8(SettlementOracle.Outcome.No));
    }

    function test_DelayedSignatureCannotBeReplayed() public {
        uint256 id = _create();
        _escalate(id);
        vm.warp(block.timestamp + EVIDENCE_WINDOW);
        string memory reasoning = "unclear";
        bytes memory sig = _sign(id, SettlementOracle.Outcome.No, 5000, reasoning, bytes32(0), enclaveKey);
        bytes32 subs = oracle.getMarket(id).submissionsHash;
        oracle.resolveWithAttestation(id, SettlementOracle.Outcome.No, 5000, subs, reasoning, bytes32(0), sig);

        vm.warp(oracle.getMarket(id).evidenceDeadline);
        vm.expectRevert(); // round changed => digest differs => unknown signer
        oracle.resolveWithAttestation(id, SettlementOracle.Outcome.No, 5000, subs, reasoning, bytes32(0), sig);
    }
}
