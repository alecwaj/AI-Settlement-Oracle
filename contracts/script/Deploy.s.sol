// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {SettlementOracle} from "../src/SettlementOracle.sol";

/// forge script script/Deploy.s.sol --rpc-url $RPC_URL --private-key $DEPLOYER_KEY --broadcast
/// Timing params are env-overridable so a local demo can use short windows.
contract Deploy is Script {
    function run() external returns (SettlementOracle oracle) {
        uint256 bond = vm.envOr("PROPOSAL_BOND_WEI", uint256(0.1 ether));
        uint256 minStake = vm.envOr("MIN_EVIDENCE_STAKE_WEI", uint256(0.01 ether));
        uint64 liveness = uint64(vm.envOr("LIVENESS_SECONDS", uint256(2 hours)));
        uint64 evidenceWindow = uint64(vm.envOr("EVIDENCE_WINDOW_SECONDS", uint256(1 days)));
        uint64 delayPeriod = uint64(vm.envOr("DELAY_PERIOD_SECONDS", uint256(6 hours)));
        uint8 maxDelays = uint8(vm.envOr("MAX_DELAYS", uint256(3)));

        vm.startBroadcast();
        oracle = new SettlementOracle(bond, minStake, liveness, evidenceWindow, delayPeriod, maxDelays);
        vm.stopBroadcast();
        console.log("SettlementOracle deployed at", address(oracle));
    }
}
