// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/SettlementOracle.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract SettlementOracleTest is Test {
    SettlementOracle oracle;
    
    address owner = address(1);
    address resolver = address(2);
    address user = address(3);
    
    uint256 resolverKey = 0xabc123;
    
    bytes32 marketId;
    
    function setUp() public {
        vm.prank(owner);
        oracle = new SettlementOracle();
        
        // Authorize resolver
        vm.prank(owner);
        oracle.authorizeResolver(resolver);
    }
    
    function test_CreateMarket() public {
        vm.prank(user);
        bytes32 id = oracle.createMarket(
            "Will ETH exceed $5000 by end of 2024?",
            "Resolve YES if ETH price > $5000 on Coinbase at 23:59 UTC Dec 31 2024",
            block.timestamp + 30 days
        );
        
        SettlementOracle.Market memory market = oracle.getMarket(id);
        assertEq(market.question, "Will ETH exceed $5000 by end of 2024?");
        assertFalse(market.resolved);
    }
    
    function test_ResolveWithAttestation() public {
        // Create market
        vm.prank(user);
        bytes32 id = oracle.createMarket(
            "Will ETH exceed $5000?",
            "Resolve based on Coinbase price",
            block.timestamp + 1
        );
        
        // Warp past resolution time
        vm.warp(block.timestamp + 2);
        
        // Create EIP-712 signature
        bytes32 outcome = keccak256("YES");
        string memory reasoning = "ETH price was $5200 on Coinbase at resolution time";
        
        // Build domain separator and type hash
        bytes32 domainSeparator = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("SettlementOracle")),
            keccak256(bytes("1")),
            block.chainid,
            address(oracle)
        ));
        
        bytes32 resolutionTypeHash = keccak256(
            "Resolution(bytes32 marketId,bytes32 outcome,uint256 timestamp,string reasoning)"
        );
        
        bytes32 structHash = keccak256(abi.encode(
            resolutionTypeHash,
            id,
            outcome,
            block.timestamp,
            keccak256(bytes(reasoning))
        ));
        
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(resolverKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);
        
        // Resolve
        vm.prank(resolver);
        oracle.resolveWithAttestation(id, outcome, reasoning, signature);
        
        // Verify
        SettlementOracle.Market memory market = oracle.getMarket(id);
        assertTrue(market.resolved);
        assertEq(market.outcome, outcome);
    }
    
    function test_VerifyAttestation() public {
        // Create and resolve market
        vm.prank(user);
        bytes32 id = oracle.createMarket(
            "Will ETH exceed $5000?",
            "Resolve based on Coinbase price",
            block.timestamp + 1
        );
        
        vm.warp(block.timestamp + 2);
        
        bytes32 outcome = keccak256("YES");
        string memory reasoning = "ETH price was $5200";
        
        // Sign
        bytes32 domainSeparator = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("SettlementOracle")),
            keccak256(bytes("1")),
            block.chainid,
            address(oracle)
        ));
        
        bytes32 resolutionTypeHash = keccak256(
            "Resolution(bytes32 marketId,bytes32 outcome,uint256 timestamp,string reasoning)"
        );
        
        bytes32 structHash = keccak256(abi.encode(
            resolutionTypeHash,
            id,
            outcome,
            block.timestamp,
            keccak256(bytes(reasoning))
        ));
        
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(resolverKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);
        
        vm.prank(resolver);
        oracle.resolveWithAttestation(id, outcome, reasoning, signature);
        
        // Verify
        bool valid = oracle.verifyAttestation(id, outcome);
        assertTrue(valid);
        
        // Wrong outcome should fail
        bool invalid = oracle.verifyAttestation(id, keccak256("NO"));
        assertFalse(invalid);
    }
    
    function test_RevertUnauthorizedResolver() public {
        vm.prank(user);
        bytes32 id = oracle.createMarket(
            "Will ETH exceed $5000?",
            "Resolve based on Coinbase price",
            block.timestamp + 1
        );
        
        vm.warp(block.timestamp + 2);
        
        // Try to resolve with unauthorized address
        vm.prank(address(99));
        vm.expectRevert(SettlementOracle.UnauthorizedResolver.selector);
        oracle.resolveWithAttestation(id, keccak256("YES"), "test", "");
    }
    
    function test_RevertDoubleResolution() public {
        // Create, resolve, then try to resolve again
        vm.prank(user);
        bytes32 id = oracle.createMarket(
            "Will ETH exceed $5000?",
            "Resolve based on Coinbase price",
            block.timestamp + 1
        );
        
        vm.warp(block.timestamp + 2);
        
        bytes32 outcome = keccak256("YES");
        string memory reasoning = "ETH price was $5200";
        
        // Sign
        bytes32 domainSeparator = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("SettlementOracle")),
            keccak256(bytes("1")),
            block.chainid,
            address(oracle)
        ));
        
        bytes32 resolutionTypeHash = keccak256(
            "Resolution(bytes32 marketId,bytes32 outcome,uint256 timestamp,string reasoning)"
        );
        
        bytes32 structHash = keccak256(abi.encode(
            resolutionTypeHash,
            id,
            outcome,
            block.timestamp,
            keccak256(bytes(reasoning))
        ));
        
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(resolverKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);
        
        vm.prank(resolver);
        oracle.resolveWithAttestation(id, outcome, reasoning, signature);
        
        // Try again
        vm.prank(resolver);
        vm.expectRevert(SettlementOracle.MarketAlreadyResolved.selector);
        oracle.resolveWithAttestation(id, outcome, reasoning, signature);
    }
}
