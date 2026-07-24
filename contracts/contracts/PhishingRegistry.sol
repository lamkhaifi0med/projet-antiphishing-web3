// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title PhishingRegistry
/// @notice Permissioned, on-chain blacklist of phishing URL hashes and EVM wallets.
/// @dev URLs must be normalized off-chain according to the project specification before hashing.
contract PhishingRegistry is Ownable {
    enum Category {
        FakeExchange,
        WalletDrainer,
        FakeAirdrop,
        FakeSupport,
        Ponzi,
        Other
    }

    struct Entry {
        Category category;
        uint8 score;
        uint40 timestamp;
        address reporter;
        bool active;
    }

    mapping(bytes32 urlHash => Entry entry) private urlEntries;
    mapping(address wallet => Entry entry) private walletEntries;
    mapping(address reporter => bool allowed) public reporters;

    error UnauthorizedReporter(address caller);
    error InvalidReporter(address reporter);
    error InvalidWallet(address wallet);
    error InvalidScore(uint8 score);
    error EntryAlreadyActive(bytes32 key);
    error EntryNotActive(bytes32 key);

    event URLReported(bytes32 indexed urlHash, Category category, uint8 score, address indexed reporter);
    event WalletReported(address indexed wallet, Category category, uint8 score, address indexed reporter);
    event EntryRemoved(bytes32 indexed key, bool isWallet);
    event ReporterUpdated(address indexed reporter, bool allowed);

    modifier onlyReporter() {
        if (!reporters[msg.sender]) {
            revert UnauthorizedReporter(msg.sender);
        }
        _;
    }

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice Adds or removes an address that may report malicious entries.
    function setReporter(address reporter, bool allowed) external onlyOwner {
        if (reporter == address(0)) {
            revert InvalidReporter(address(0));
        }

        reporters[reporter] = allowed;
        emit ReporterUpdated(reporter, allowed);
    }

    /// @notice Adds a normalized URL hash to the blacklist.
    function reportURL(bytes32 urlHash, Category category, uint8 score) external onlyReporter {
        _validateScore(score);
        if (urlEntries[urlHash].active) {
            revert EntryAlreadyActive(urlHash);
        }

        urlEntries[urlHash] = Entry({
            category: category,
            score: score,
            timestamp: uint40(block.timestamp),
            reporter: msg.sender,
            active: true
        });

        emit URLReported(urlHash, category, score, msg.sender);
    }

    /// @notice Adds an EVM wallet address to the blacklist.
    function reportWallet(address wallet, Category category, uint8 score) external onlyReporter {
        if (wallet == address(0)) {
            revert InvalidWallet(wallet);
        }
        _validateScore(score);
        if (walletEntries[wallet].active) {
            revert EntryAlreadyActive(bytes32(uint256(uint160(wallet))));
        }

        walletEntries[wallet] = Entry({
            category: category,
            score: score,
            timestamp: uint40(block.timestamp),
            reporter: msg.sender,
            active: true
        });

        emit WalletReported(wallet, category, score, msg.sender);
    }

    function isBlacklistedURL(bytes32 urlHash) external view returns (bool) {
        return urlEntries[urlHash].active;
    }

    function isBlacklistedWallet(address wallet) external view returns (bool) {
        return walletEntries[wallet].active;
    }

    function getURLEntry(bytes32 urlHash) external view returns (Entry memory) {
        return urlEntries[urlHash];
    }

    function getWalletEntry(address wallet) external view returns (Entry memory) {
        return walletEntries[wallet];
    }

    /// @notice Deactivates a URL entry. The historical report remains available in transaction logs.
    function removeURL(bytes32 urlHash) external onlyOwner {
        if (!urlEntries[urlHash].active) {
            revert EntryNotActive(urlHash);
        }

        urlEntries[urlHash].active = false;
        emit EntryRemoved(urlHash, false);
    }

    /// @notice Deactivates a wallet entry. The historical report remains available in transaction logs.
    function removeWallet(address wallet) external onlyOwner {
        bytes32 key = bytes32(uint256(uint160(wallet)));
        if (!walletEntries[wallet].active) {
            revert EntryNotActive(key);
        }

        walletEntries[wallet].active = false;
        emit EntryRemoved(key, true);
    }

    function _validateScore(uint8 score) private pure {
        if (score > 100) {
            revert InvalidScore(score);
        }
    }
}
