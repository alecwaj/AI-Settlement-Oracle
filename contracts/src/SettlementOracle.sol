// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @title SettlementOracle
 * @notice Verifiable AI oracle for prediction market resolution
 * @dev Uses EIP-712 structured data signing for attestations
 */
contract SettlementOracle is Ownable, EIP712 {
    // ============ Errors ============
    error InvalidAttestation();
    error MarketAlreadyResolved();
    error MarketNotFound();
    error UnauthorizedResolver();
    error ResolutionWindowNotClosed();
    
    // ============ Types ============
    struct Market {
        string question;
        string resolutionCriteria;
        uint256 resolutionTime;
        bool resolved;
        bytes32 outcome;
        bytes attestation;
        address resolver;
    }
    
    struct Resolution {
        bytes32 marketId;
        bytes32 outcome;
        uint256 timestamp;
        string reasoning;
    }
    
    // EIP-712 type hash for Resolution
    bytes32 private constant RESOLUTION_TYPEHASH = keccak256(
        "Resolution(bytes32 marketId,bytes32 outcome,uint256 timestamp,string reasoning)"
    );
    
    // ============ State ============
    mapping(bytes32 => Market) public markets;
    mapping(address => bool) public authorizedResolvers;
    bytes32[] public marketIds;
    
    // ============ Events ============
    event MarketCreated(
        bytes32 indexed marketId,
        string question,
        string resolutionCriteria,
        uint256 resolutionTime
    );
    event MarketResolved(
        bytes32 indexed marketId,
        bytes32 outcome,
        bytes attestation,
        address resolver
    );
    event ResolverAuthorized(address indexed resolver);
    event ResolverRevoked(address indexed resolver);
    
    // ============ Constructor ============
    constructor() Ownable(msg.sender) EIP712("SettlementOracle", "1") {}
    
    // ============ Admin Functions ============
    function authorizeResolver(address resolver) external onlyOwner {
        authorizedResolvers[resolver] = true;
        emit ResolverAuthorized(resolver);
    }
    
    function revokeResolver(address resolver) external onlyOwner {
        authorizedResolvers[resolver] = false;
        emit ResolverRevoked(resolver);
    }
    
    // ============ Market Functions ============
    function createMarket(
        string calldata question,
        string calldata resolutionCriteria,
        uint256 resolutionTime
    ) external returns (bytes32 marketId) {
        marketId = keccak256(abi.encodePacked(
            question,
            resolutionCriteria,
            resolutionTime,
            block.timestamp,
            msg.sender
        ));
        
        if (markets[marketId].resolutionTime != 0) {
            revert MarketAlreadyResolved();
        }
        
        markets[marketId] = Market({
            question: question,
            resolutionCriteria: resolutionCriteria,
            resolutionTime: resolutionTime,
            resolved: false,
            outcome: bytes32(0),
            attestation: "",
            resolver: address(0)
        });
        
        marketIds.push(marketId);
        
        emit MarketCreated(marketId, question, resolutionCriteria, resolutionTime);
    }
    
    // ============ Resolution Functions ============
    function resolveWithAttestation(
        bytes32 marketId,
        bytes32 outcome,
        string calldata reasoning,
        bytes calldata signature
    ) external {
        Market storage market = markets[marketId];
        
        if (market.resolutionTime == 0) revert MarketNotFound();
        if (market.resolved) revert MarketAlreadyResolved();
        if (!authorizedResolvers[msg.sender]) revert UnauthorizedResolver();
        if (block.timestamp < market.resolutionTime) revert ResolutionWindowNotClosed();
        
        // Build and verify EIP-712 signature
        Resolution memory resolution = Resolution({
            marketId: marketId,
            outcome: outcome,
            timestamp: block.timestamp,
            reasoning: reasoning
        });
        
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(
            RESOLUTION_TYPEHASH,
            resolution.marketId,
            resolution.outcome,
            resolution.timestamp,
            keccak256(bytes(resolution.reasoning))
        )));
        
        address signer = ECDSA.recover(digest, signature);
        if (!authorizedResolvers[signer]) revert InvalidAttestation();
        
        // Store resolution
        market.resolved = true;
        market.outcome = outcome;
        market.attestation = abi.encode(resolution, signature);
        market.resolver = msg.sender;
        
        emit MarketResolved(marketId, outcome, market.attestation, msg.sender);
    }
    
    // ============ View Functions ============
    function verifyAttestation(
        bytes32 marketId,
        bytes32 expectedOutcome
    ) external view returns (bool valid) {
        Market memory market = markets[marketId];
        if (!market.resolved) return false;
        
        (Resolution memory resolution, bytes memory signature) = 
            abi.decode(market.attestation, (Resolution, bytes));
        
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(
            RESOLUTION_TYPEHASH,
            resolution.marketId,
            resolution.outcome,
            resolution.timestamp,
            keccak256(bytes(resolution.reasoning))
        )));
        
        address signer = ECDSA.recover(digest, signature);
        return authorizedResolvers[signer] && resolution.outcome == expectedOutcome;
    }
    
    function getMarket(bytes32 marketId) external view returns (Market memory) {
        return markets[marketId];
    }
    
    function getMarketCount() external view returns (uint256) {
        return marketIds.length;
    }
}
