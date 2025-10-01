// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title MerkleRegistry
 * @dev Simple registry contract for storing merkle tree snapshots
 * Used by PIPTip for publishing balance snapshots to Abstract Chain
 */
contract MerkleRegistry {
    struct Snapshot {
        bytes32 merkleRoot;
        string ipfsHash;
        uint256 timestamp;
        address publisher;
    }

    // Storage
    Snapshot public latestSnapshot;
    mapping(bytes32 => bool) public publishedSnapshots;
    mapping(address => bool) public authorizedPublishers;
    address public owner;

    // Events
    event SnapshotPublished(
        bytes32 indexed merkleRoot,
        string ipfsHash,
        uint256 timestamp,
        address indexed publisher
    );
    event PublisherAuthorized(address indexed publisher);
    event PublisherRevoked(address indexed publisher);

    // Modifiers
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call this function");
        _;
    }

    modifier onlyAuthorized() {
        require(
            authorizedPublishers[msg.sender] || msg.sender == owner,
            "Not authorized to publish snapshots"
        );
        _;
    }

    constructor() {
        owner = msg.sender;
        authorizedPublishers[msg.sender] = true;
    }

    /**
     * @dev Publish a new merkle tree snapshot
     * @param merkleRoot The root hash of the merkle tree
     * @param ipfsHash The IPFS hash containing the full tree data
     * @param timestamp The timestamp when the snapshot was created
     */
    function publishSnapshot(
        bytes32 merkleRoot,
        string calldata ipfsHash,
        uint256 timestamp
    ) external onlyAuthorized {
        require(merkleRoot != bytes32(0), "Invalid merkle root");
        require(bytes(ipfsHash).length > 0, "IPFS hash cannot be empty");
        require(timestamp > 0, "Invalid timestamp");
        require(!publishedSnapshots[merkleRoot], "Snapshot already published");

        // Store the snapshot
        latestSnapshot = Snapshot({
            merkleRoot: merkleRoot,
            ipfsHash: ipfsHash,
            timestamp: timestamp,
            publisher: msg.sender
        });

        // Mark as published
        publishedSnapshots[merkleRoot] = true;

        emit SnapshotPublished(merkleRoot, ipfsHash, timestamp, msg.sender);
    }

    /**
     * @dev Get the latest snapshot
     * @return merkleRoot The merkle root of the latest snapshot
     * @return ipfsHash The IPFS hash of the latest snapshot
     * @return timestamp The timestamp of the latest snapshot
     */
    function getLatestSnapshot()
        external
        view
        returns (
            bytes32 merkleRoot,
            string memory ipfsHash,
            uint256 timestamp
        )
    {
        return (
            latestSnapshot.merkleRoot,
            latestSnapshot.ipfsHash,
            latestSnapshot.timestamp
        );
    }

    /**
     * @dev Check if a snapshot has been published
     * @param merkleRoot The merkle root to check
     * @return true if the snapshot exists
     */
    function isValidSnapshot(bytes32 merkleRoot) external view returns (bool) {
        return publishedSnapshots[merkleRoot];
    }

    /**
     * @dev Authorize an address to publish snapshots
     * @param publisher The address to authorize
     */
    function authorizePublisher(address publisher) external onlyOwner {
        require(publisher != address(0), "Invalid publisher address");
        authorizedPublishers[publisher] = true;
        emit PublisherAuthorized(publisher);
    }

    /**
     * @dev Revoke authorization for an address
     * @param publisher The address to revoke
     */
    function revokePublisher(address publisher) external onlyOwner {
        require(publisher != owner, "Cannot revoke owner");
        authorizedPublishers[publisher] = false;
        emit PublisherRevoked(publisher);
    }

    /**
     * @dev Check if an address is authorized to publish
     * @param publisher The address to check
     * @return true if authorized
     */
    function isAuthorizedPublisher(address publisher) external view returns (bool) {
        return authorizedPublishers[publisher] || publisher == owner;
    }

    /**
     * @dev Get snapshot count (approximation based on latest)
     * @return count The number of published snapshots
     */
    function getSnapshotCount() external view returns (uint256) {
        return latestSnapshot.timestamp > 0 ? 1 : 0;
    }
}