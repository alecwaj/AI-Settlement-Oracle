// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {SettlementOracle} from "../src/SettlementOracle.sol";

/// @notice Deploys SettlementOracle and authorizes the oracle signing key.
/// Env: ORACLE_ADDRESS (required), RETRY_DELAY_SECONDS (default 3600).
/// Markets are registered by the oracle service from its market definitions.
contract Deploy is Script {
    function run() external returns (SettlementOracle oracle) {
        address oracleAddress = vm.envAddress("ORACLE_ADDRESS");
        uint64 retryDelay = uint64(vm.envOr("RETRY_DELAY_SECONDS", uint256(3600)));
        vm.startBroadcast();
        oracle = new SettlementOracle(oracleAddress, retryDelay);
        vm.stopBroadcast();
        console2.log("SettlementOracle:", address(oracle));
        console2.log("Authorized oracle:", oracleAddress);
    }
}
