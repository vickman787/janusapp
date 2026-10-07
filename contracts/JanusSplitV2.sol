// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./JanusSplit.sol";

/**
 * @title JanusSplitV2
 * @notice Additive version of JanusSplit with explicit share coverage.
 *
 * The original JanusSplit contract is intentionally left unchanged. Existing
 * split IDs and payer links continue to use that deployed contract. V2 keeps
 * all original functions and adds settleAdditionalShare for a payer who
 * deliberately covers another unpaid share.
 */
contract JanusSplitV2 is JanusSplit {
    error AllSharesPaid();

    constructor(address _ausdToken) JanusSplit(_ausdToken) {}

    /**
     * @notice Pay one additional share for an active split.
     * @dev This is intentionally separate from settleSplit. A normal retry or
     *      double-click still reverts with AlreadyPaid; this function is the
     *      explicit user choice to cover another share.
     */
    function settleAdditionalShare(bytes32 splitId)
        external
        splitExists(splitId)
        splitIsActive(splitId)
    {
        SplitRecord storage split = splits[splitId];
        if (split.settledCount >= split.numPayers) revert AllSharesPaid();

        bool success = IERC20(ausdToken).transferFrom(
            msg.sender,
            split.requester,
            split.amountPerPayer
        );
        if (!success) revert TransferFailed();

        split.settledCount++;
        emit PaymentSettled(
            splitId,
            msg.sender,
            split.requester,
            split.amountPerPayer,
            split.memo
        );

        if (split.settledCount == split.numPayers) {
            split.status = SplitStatus.Settled;
            emit SplitFullySettled(splitId);
        }
    }
}
