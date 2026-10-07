// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title JanusSplit
 * @notice Gas-efficient group bill-splitting & direct-transfer settlement contract
 *         for the Agora AUSD stablecoin on Monad Testnet (Chain ID: 10143).
 *
 * Features:
 *  - settleSplit       : Single payer pays their share directly to the requester.
 *  - settleBatch       : Multiple recipients receive proportional shares in one tx.
 *  - settleWithPermit  : EIP-2612 gasless permit + transfer in a single call.
 *  - cancelSplit       : Requester can mark a split as cancelled on-chain.
 *  - Split state tracking via splitId (bytes32 keccak hash).
 */

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IERC20Permit {
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

interface IJanusSplitEvents {
    event SplitCreated(
        bytes32 indexed splitId,
        address indexed requester,
        uint256 totalAmount,
        uint256 numPayers,
        string memo
    );

    event PaymentSettled(
        bytes32 indexed splitId,
        address indexed payer,
        address indexed recipient,
        uint256 amount,
        string memo
    );

    event BatchSettled(
        bytes32 indexed splitId,
        address indexed payer,
        uint256 totalDistributed,
        uint256 recipientCount
    );

    event SplitCancelled(
        bytes32 indexed splitId,
        address indexed requester
    );

    event SplitFullySettled(
        bytes32 indexed splitId
    );
}

contract JanusSplit is IJanusSplitEvents {
    // ─────────────────────────── State ───────────────────────────────────────

    /// @notice The AUSD ERC-20 token address (Agora testnet deployment)
    address public immutable ausdToken;

    /// @notice Contract deployer / admin address
    address public immutable owner;

    enum SplitStatus { Active, Settled, Cancelled }

    struct SplitRecord {
        address requester;
        uint256 totalAmount;
        uint256 amountPerPayer;
        uint256 numPayers;
        uint256 settledCount;
        SplitStatus status;
        string memo;
    }

    /// @dev splitId → SplitRecord
    mapping(bytes32 => SplitRecord) public splits;

    /// @dev splitId → payer address → has paid
    mapping(bytes32 => mapping(address => bool)) public hasPaid;

    // ─────────────────────────── Events ──────────────────────────────────────
    // (Inherited from IJanusSplitEvents)

    // ─────────────────────────── Errors ──────────────────────────────────────

    error InvalidAmount();
    error InvalidRecipient();
    error InvalidNumPayers();
    error TransferFailed();
    error SplitNotActive();
    error AlreadyPaid();
    error NotRequester();
    error SplitDoesNotExist();
    error SplitAlreadyExists();
    error ArrayLengthMismatch();
    error PermitDeadlineExpired();

    // ─────────────────────────── Modifiers ───────────────────────────────────

    modifier splitExists(bytes32 splitId) {
        if (splits[splitId].requester == address(0)) revert SplitDoesNotExist();
        _;
    }

    modifier splitIsActive(bytes32 splitId) {
        if (splits[splitId].status != SplitStatus.Active) revert SplitNotActive();
        _;
    }

    // ─────────────────────────── Constructor ─────────────────────────────────

    constructor(address _ausdToken) {
        require(_ausdToken != address(0), "JanusSplit: zero token address");
        ausdToken = _ausdToken;
        owner = msg.sender;
    }

    // ─────────────────────────── Core Functions ───────────────────────────────

    /**
     * @notice Register a new bill split on-chain.
     * @param splitId       Unique identifier (keccak256 of UUID from frontend).
     * @param totalAmount   Total bill amount in AUSD (6 decimals).
     * @param numPayers     Number of people splitting the bill (≥ 1).
     * @param memo          Human-readable description (e.g. "Dinner at Nobu").
     * @return amountPerPayer The per-person share (totalAmount / numPayers).
     */
    function createSplit(
        bytes32 splitId,
        uint256 totalAmount,
        uint256 numPayers,
        string calldata memo
    ) public returns (uint256 amountPerPayer) {
        if (totalAmount == 0) revert InvalidAmount();
        if (numPayers == 0) revert InvalidNumPayers();
        if (splits[splitId].requester != address(0)) revert SplitAlreadyExists();

        amountPerPayer = totalAmount / numPayers;
        if (amountPerPayer == 0) revert InvalidAmount();

        splits[splitId] = SplitRecord({
            requester:      msg.sender,
            totalAmount:    totalAmount,
            amountPerPayer: amountPerPayer,
            numPayers:      numPayers,
            settledCount:   0,
            status:         SplitStatus.Active,
            memo:           memo
        });

        emit SplitCreated(splitId, msg.sender, totalAmount, numPayers, memo);
    }

    /**
     * @notice Spec Section 5.1 Alias: createBill
     */
    function createBill(
        bytes32 billId,
        string calldata title,
        uint256 totalAmount,
        uint256 participantsCount
    ) external returns (uint256) {
        return createSplit(billId, totalAmount, participantsCount, title);
    }

    /**
     * @notice Settle a single payer's share for an on-chain registered split.
     * @dev Payer must have approved this contract for at least amountPerPayer.
     * @param splitId  The registered split identifier.
     */
    function settleSplit(bytes32 splitId)
        public
        splitExists(splitId)
        splitIsActive(splitId)
    {
        SplitRecord storage s = splits[splitId];

        if (hasPaid[splitId][msg.sender]) revert AlreadyPaid();

        hasPaid[splitId][msg.sender] = true;
        s.settledCount++;

        bool success = IERC20(ausdToken).transferFrom(
            msg.sender,
            s.requester,
            s.amountPerPayer
        );
        if (!success) revert TransferFailed();

        emit PaymentSettled(splitId, msg.sender, s.requester, s.amountPerPayer, s.memo);

        // Auto-mark as fully settled
        if (s.settledCount == s.numPayers) {
            s.status = SplitStatus.Settled;
            emit SplitFullySettled(splitId);
        }
    }

    /**
     * @notice Spec Section 5.1 Alias: settleShare
     */
    function settleShare(bytes32 billId) external {
        settleSplit(billId);
    }

    /**
     * @notice Direct ad-hoc settlement (no prior createSplit required).
     *         Used for simple peer-to-peer AUSD transfers from the Janus UI.
     * @param splitId   Off-chain UUID encoded as bytes32 (for event correlation).
     * @param recipient Address receiving the AUSD.
     * @param amount    Amount in AUSD base units.
     * @param memo      Short description.
     */
    function settleDirectTransfer(
        bytes32 splitId,
        address recipient,
        uint256 amount,
        string calldata memo
    ) external {
        if (amount == 0) revert InvalidAmount();
        if (recipient == address(0)) revert InvalidRecipient();

        bool success = IERC20(ausdToken).transferFrom(msg.sender, recipient, amount);
        if (!success) revert TransferFailed();

        emit PaymentSettled(splitId, msg.sender, recipient, amount, memo);
    }

    /**
     * @notice Batch distribute AUSD from a single payer to multiple recipients.
     *         Useful when one person front-loads the whole bill and needs to be
     *         reimbursed — or when an organizer distributes amounts to N addresses.
     * @param splitId     Off-chain identifier for event correlation.
     * @param recipients  Array of recipient addresses.
     * @param amounts     Corresponding AUSD amounts per recipient.
     * @param memo        Bill description.
     */
    function settleBatch(
        bytes32 splitId,
        address[] calldata recipients,
        uint256[] calldata amounts,
        string calldata memo
    ) external {
        uint256 len = recipients.length;
        if (len == 0 || len != amounts.length) revert ArrayLengthMismatch();

        uint256 totalDistributed;
        for (uint256 i; i < len; ) {
            if (recipients[i] == address(0)) revert InvalidRecipient();
            if (amounts[i] == 0) revert InvalidAmount();

            bool success = IERC20(ausdToken).transferFrom(
                msg.sender,
                recipients[i],
                amounts[i]
            );
            if (!success) revert TransferFailed();

            totalDistributed += amounts[i];
            unchecked { ++i; }
        }

        emit BatchSettled(splitId, msg.sender, totalDistributed, len);
    }

    /**
     * @notice EIP-2612 gasless permit + settle in one call.
     *         The payer must submit this call directly because msg.sender is the permit owner.
     * @param splitId   Registered split ID (must have been created with createSplit).
     * @param deadline  Permit signature expiry timestamp.
     * @param v, r, s   ECDSA signature components.
     */
    function settleWithPermit(
        bytes32 splitId,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external splitExists(splitId) splitIsActive(splitId) {
        if (block.timestamp > deadline) revert PermitDeadlineExpired();

        SplitRecord storage split = splits[splitId];
        if (hasPaid[splitId][msg.sender]) revert AlreadyPaid();

        // Execute EIP-2612 permit to approve this contract
        IERC20Permit(ausdToken).permit(
            msg.sender,
            address(this),
            split.amountPerPayer,
            deadline,
            v, r, s
        );

        hasPaid[splitId][msg.sender] = true;
        split.settledCount++;

        bool success = IERC20(ausdToken).transferFrom(
            msg.sender,
            split.requester,
            split.amountPerPayer
        );
        if (!success) revert TransferFailed();

        emit PaymentSettled(splitId, msg.sender, split.requester, split.amountPerPayer, split.memo);

        if (split.settledCount == split.numPayers) {
            split.status = SplitStatus.Settled;
            emit SplitFullySettled(splitId);
        }
    }

    /**
     * @notice Cancel an active split. Only the requester can cancel.
     * @param splitId The split to cancel.
     */
    function cancelSplit(bytes32 splitId)
        external
        splitExists(splitId)
        splitIsActive(splitId)
    {
        SplitRecord storage s = splits[splitId];
        if (msg.sender != s.requester) revert NotRequester();

        s.status = SplitStatus.Cancelled;
        emit SplitCancelled(splitId, msg.sender);
    }

    // ─────────────────────────── View Functions ───────────────────────────────

    /**
     * @notice Returns the full record for a split.
     */
    function getSplit(bytes32 splitId) external view returns (SplitRecord memory) {
        return splits[splitId];
    }

    /**
     * @notice Check whether a given payer has settled their share.
     */
    function payerHasSettled(bytes32 splitId, address payer) external view returns (bool) {
        return hasPaid[splitId][payer];
    }

    /**
     * @notice Returns remaining unpaid count for a split.
     */
    function remainingPayers(bytes32 splitId)
        external
        view
        splitExists(splitId)
        returns (uint256)
    {
        SplitRecord storage s = splits[splitId];
        return s.numPayers - s.settledCount;
    }
}
