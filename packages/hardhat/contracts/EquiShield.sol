// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint64, externalEuint64, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

/**
 * @title EquiShield
 * @notice FHE-encrypted cap table management for startups on Sepolia testnet.
 *         All share counts, prices, and vesting data remain encrypted on-chain.
 *         Built for Zama Developer Program Season 2 Hackathon (Builder Track).
 */
contract EquiShield is ZamaEthereumConfig {
    address public owner;
    address public regulator;

    struct ShareHolder {
        address holder;
        euint64 encryptedShares;
        euint64 encryptedVestedShares;
        euint64 encryptedPricePerShare;
        bool isActive;
    }

    mapping(address => ShareHolder) public shareholders;
    address[] public shareholderList;

    // votes[proposalId][voter] = encrypted voting weight
    mapping(uint256 => mapping(address => euint64)) public votes;

    // Track whether an address has voted on a proposal
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    event SharesIssued(address indexed holder, uint256 timestamp);
    event SharesVested(address indexed holder, uint256 timestamp);
    event SharesTransferred(address indexed from, address indexed to, uint256 timestamp);
    event Voted(uint256 indexed proposalId, address indexed voter);
    event RegulatorGranted(address indexed regulatorAddr);

    modifier onlyOwner() {
        require(msg.sender == owner, "EquiShield: Not owner");
        _;
    }

    modifier onlyActiveShareholder() {
        require(shareholders[msg.sender].isActive, "EquiShield: Not an active shareholder");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /**
     * @notice Admin issues encrypted shares to a holder at an encrypted price per share.
     * @param holder         Address of the new shareholder
     * @param inputShares    Encrypted share count (externalEuint64)
     * @param proof          ZK proof for inputShares
     * @param inputPrice     Encrypted price per share (externalEuint64)
     * @param priceProof     ZK proof for inputPrice
     */
    function issueShares(
        address holder,
        externalEuint64 inputShares,
        bytes calldata proof,
        externalEuint64 inputPrice,
        bytes calldata priceProof
    ) external onlyOwner {
        require(holder != address(0), "EquiShield: Zero address");
        require(!shareholders[holder].isActive, "EquiShield: Holder already exists");

        euint64 encShares = FHE.fromExternal(inputShares, proof);
        euint64 encPrice  = FHE.fromExternal(inputPrice, priceProof);
        euint64 encVested = FHE.asEuint64(0);

        FHE.allowThis(encShares);
        FHE.allow(encShares, holder);

        FHE.allowThis(encPrice);
        FHE.allow(encPrice, holder);

        FHE.allowThis(encVested);
        FHE.allow(encVested, holder);

        shareholders[holder] = ShareHolder({
            holder: holder,
            encryptedShares: encShares,
            encryptedVestedShares: encVested,
            encryptedPricePerShare: encPrice,
            isActive: true
        });

        shareholderList.push(holder);

        emit SharesIssued(holder, block.timestamp);
    }

    /**
     * @notice Admin vests an encrypted amount of shares for a holder.
     * @param holder              Address of the shareholder
     * @param inputVestedAmount   Encrypted amount to vest
     * @param proof               ZK proof for inputVestedAmount
     */
    function vestShares(
        address holder,
        externalEuint64 inputVestedAmount,
        bytes calldata proof
    ) external onlyOwner {
        require(shareholders[holder].isActive, "EquiShield: Not a shareholder");

        euint64 encVestedAmount = FHE.fromExternal(inputVestedAmount, proof);
        euint64 newVested = FHE.add(shareholders[holder].encryptedVestedShares, encVestedAmount);

        FHE.allowThis(newVested);
        FHE.allow(newVested, holder);

        shareholders[holder].encryptedVestedShares = newVested;

        emit SharesVested(holder, block.timestamp);
    }

    /**
     * @notice Shareholder transfers an encrypted amount of their shares to another address.
     *         Uses FHE.sub() on sender and FHE.add() on receiver — no plaintext amounts revealed.
     * @param to          Recipient address
     * @param inputAmount Encrypted amount to transfer
     * @param proof       ZK proof for inputAmount
     */
    function transferShares(
        address to,
        externalEuint64 inputAmount,
        bytes calldata proof
    ) external onlyActiveShareholder {
        require(to != address(0), "EquiShield: Zero address");
        require(to != msg.sender, "EquiShield: Self-transfer");

        euint64 encAmount = FHE.fromExternal(inputAmount, proof);

        // Subtract from sender
        euint64 newSenderShares = FHE.sub(shareholders[msg.sender].encryptedShares, encAmount);
        FHE.allowThis(newSenderShares);
        FHE.allow(newSenderShares, msg.sender);
        shareholders[msg.sender].encryptedShares = newSenderShares;

        // If recipient is new, initialize their entry
        if (!shareholders[to].isActive) {
            euint64 encZero = FHE.asEuint64(0);
            FHE.allowThis(encZero);
            FHE.allow(encZero, to);

            shareholders[to] = ShareHolder({
                holder: to,
                encryptedShares: encZero,
                encryptedVestedShares: encZero,
                encryptedPricePerShare: shareholders[msg.sender].encryptedPricePerShare,
                isActive: true
            });
            shareholderList.push(to);
        }

        // Add to receiver
        euint64 newReceiverShares = FHE.add(shareholders[to].encryptedShares, encAmount);
        FHE.allowThis(newReceiverShares);
        FHE.allow(newReceiverShares, to);
        shareholders[to].encryptedShares = newReceiverShares;

        emit SharesTransferred(msg.sender, to, block.timestamp);
    }

    /**
     * @notice Returns the caller's encrypted share handle.
     *         Only resolves if the caller was granted FHE access.
     */
    function getMyShares() external view returns (euint64) {
        return shareholders[msg.sender].encryptedShares;
    }

    /**
     * @notice Returns the caller's encrypted vested share handle.
     */
    function getMyVestedShares() external view returns (euint64) {
        return shareholders[msg.sender].encryptedVestedShares;
    }

    /**
     * @notice Shareholder votes on a proposal with encrypted weight.
     * @param proposalId  Identifier for the governance proposal
     * @param inputWeight Encrypted voting weight
     * @param proof       ZK proof for inputWeight
     */
    function vote(
        uint256 proposalId,
        externalEuint64 inputWeight,
        bytes calldata proof
    ) external onlyActiveShareholder {
        require(!hasVoted[proposalId][msg.sender], "EquiShield: Already voted");

        euint64 encWeight = FHE.fromExternal(inputWeight, proof);
        FHE.allowThis(encWeight);
        FHE.allow(encWeight, msg.sender);
        FHE.allow(encWeight, owner);

        votes[proposalId][msg.sender] = encWeight;
        hasVoted[proposalId][msg.sender] = true;

        emit Voted(proposalId, msg.sender);
    }

    /**
     * @notice Owner-only: returns all encrypted handles for a holder for compliance/audit.
     *         Also grants access to the designated regulator if set.
     * @param holder Address of the shareholder to inspect
     */
    function regulatorView(address holder)
        external
        onlyOwner
        returns (
            euint64 encShares,
            euint64 encVestedShares,
            euint64 encPrice
        )
    {
        require(shareholders[holder].isActive, "EquiShield: Not a shareholder");

        ShareHolder storage sh = shareholders[holder];

        if (regulator != address(0)) {
            FHE.allow(sh.encryptedShares, regulator);
            FHE.allow(sh.encryptedVestedShares, regulator);
            FHE.allow(sh.encryptedPricePerShare, regulator);
        }

        return (sh.encryptedShares, sh.encryptedVestedShares, sh.encryptedPricePerShare);
    }

    /**
     * @notice Owner grants the regulator role to an address for audit access.
     */
    function grantRegulator(address _regulator) external onlyOwner {
        require(_regulator != address(0), "EquiShield: Zero address");
        regulator = _regulator;
        emit RegulatorGranted(_regulator);
    }

    /**
     * @notice Returns the total number of shareholders ever added.
     */
    function getShareholderCount() external view returns (uint256) {
        return shareholderList.length;
    }

    /**
     * @notice Returns whether an address is an active shareholder.
     */
    function isActiveShareholder(address holder) external view returns (bool) {
        return shareholders[holder].isActive;
    }

    /**
     * @notice Returns the shareholder address at index i in the list.
     */
    function getShareholderAt(uint256 i) external view returns (address) {
        require(i < shareholderList.length, "EquiShield: Out of bounds");
        return shareholderList[i];
    }
}
