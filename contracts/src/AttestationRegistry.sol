// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title AttestationRegistry
 * @notice Batch attestation verification using Merkle trees
 * @dev Optimized for verifying many AI resolutions efficiently
 */
contract AttestationRegistry {
    // ============ Errors ============
    error InvalidMerkleProof();
    error BatchAlreadySubmitted();
    error EmptyBatch();
    
    // ============ Types ============
    struct AttestationEntry {
        bytes32 marketId;
        bytes32 outcomeHash;
        uint256 timestamp;
        address resolver;
    }
    
    struct Batch {
        bytes32 merkleRoot;
        uint256 timestamp;
        uint256 entryCount;
        bool verified;
    }
    
    // ============ State ============
    mapping(bytes32 => Batch) public batches;
    mapping(bytes32 => bool) public processedAttestations;
    bytes32[] public batchRoots;
    
    // ============ Events ============
    event BatchSubmitted(bytes32 indexed merkleRoot, uint256 entryCount);
    event AttestationVerified(bytes32 indexed marketId, bytes32 indexed batchRoot);
    
    // ============ Functions ============
    function submitBatch(
        bytes32 merkleRoot,
        uint256 entryCount
    ) external returns (bool) {
        if (entryCount == 0) revert EmptyBatch();
        if (batches[merkleRoot].timestamp != 0) revert BatchAlreadySubmitted();
        
        batches[merkleRoot] = Batch({
            merkleRoot: merkleRoot,
            timestamp: block.timestamp,
            entryCount: entryCount,
            verified: false
        });
        
        batchRoots.push(merkleRoot);
        
        emit BatchSubmitted(merkleRoot, entryCount);
        return true;
    }
    
    function verifyAttestationInBatch(
        bytes32 merkleRoot,
        AttestationEntry calldata entry,
        bytes32[] calldata merkleProof
    ) external returns (bool) {
        Batch storage batch = batches[merkleRoot];
        if (batch.timestamp == 0) revert InvalidMerkleProof();
        
        bytes32 leaf = keccak256(abi.encode(entry));
        
        if (!MerkleProof.verify(merkleProof, merkleRoot, leaf)) {
            revert InvalidMerkleProof();
        }
        
        bytes32 attestationId = keccak256(abi.encode(entry.marketId, merkleRoot));
        processedAttestations[attestationId] = true;
        
        emit AttestationVerified(entry.marketId, merkleRoot);
        return true;
    }
    
    function isAttestationProcessed(
        bytes32 marketId,
        bytes32 merkleRoot
    ) external view returns (bool) {
        bytes32 attestationId = keccak256(abi.encode(marketId, merkleRoot));
        return processedAttestations[attestationId];
    }
    
    function getBatchCount() external view returns (uint256) {
        return batchRoots.length;
    }
    
    function generateLeafHash(AttestationEntry calldata entry) external pure returns (bytes32) {
        return keccak256(abi.encode(entry));
    }
}
