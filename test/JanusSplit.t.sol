// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/JanusSplit.sol";

// ─────────────────────────────────────────────────────────────────────────────
// Mock AUSD ERC-20 with EIP-2612 Permit support
// ─────────────────────────────────────────────────────────────────────────────

contract MockAUSD {
    string public name = "Agora USD";
    string public symbol = "AUSD";
    uint8  public decimals = 6;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    // EIP-2612
    bytes32 public DOMAIN_SEPARATOR;
    // keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)")
    bytes32 public constant PERMIT_TYPEHASH =
        0x6e71edae12b1b97f4d1f60370fef10105fa2faae0126114a169c64845d6126c9;
    mapping(address => uint256) public nonces;

    constructor() {
        uint256 chainId;
        assembly { chainId := chainid() }
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes("1")),
                chainId,
                address(this)
            )
        );
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "AUSD: insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "AUSD: insufficient balance");
        require(allowance[from][msg.sender] >= amount, "AUSD: insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function permit(
        address owner_,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(block.timestamp <= deadline, "AUSD: permit expired");
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                keccak256(abi.encode(PERMIT_TYPEHASH, owner_, spender, value, nonces[owner_]++, deadline))
            )
        );
        address signer = ecrecover(digest, v, r, s);
        require(signer == owner_ && signer != address(0), "AUSD: invalid signature");
        allowance[owner_][spender] = value;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

// Simulate a revert-on-transfer token (for failure path tests)
contract RevertingToken {
    function transferFrom(address, address, uint256) external pure returns (bool) {
        revert("always fails");
    }
    function transfer(address, uint256) external pure returns (bool) { return false; }
    function balanceOf(address) external pure returns (uint256) { return type(uint256).max; }
}

// ─────────────────────────────────────────────────────────────────────────────
// JanusSplit Test Suite
// ─────────────────────────────────────────────────────────────────────────────

contract JanusSplitTest is Test, IJanusSplitEvents {
    MockAUSD  public ausd;
    JanusSplit public settler;

    // Fixed test accounts
    address internal alice   = makeAddr("alice");   // requester / bill creator
    address internal bob     = makeAddr("bob");     // payer 1
    address internal carol   = makeAddr("carol");   // payer 2
    address internal dave    = makeAddr("dave");    // payer 3
    address internal eve     = makeAddr("eve");     // unauthorised party
    uint256 internal bobKey  = uint256(keccak256("bob-private-key"));

    // AUSD uses 6 decimals — same as USDC
    uint256 internal constant AUSD_6 = 1e6;

    function setUp() public {
        ausd    = new MockAUSD();
        settler = new JanusSplit(address(ausd));

        // Fund everyone with 1000 AUSD
        ausd.mint(alice, 1000 * AUSD_6);
        ausd.mint(bob,   1000 * AUSD_6);
        ausd.mint(carol, 1000 * AUSD_6);
        ausd.mint(dave,  1000 * AUSD_6);

        // Pre-approve the settler (simulates UI-side approve step)
        vm.prank(bob);   ausd.approve(address(settler), type(uint256).max);
        vm.prank(carol); ausd.approve(address(settler), type(uint256).max);
        vm.prank(dave);  ausd.approve(address(settler), type(uint256).max);
        vm.prank(alice); ausd.approve(address(settler), type(uint256).max);
    }

    // ─── helpers ─────────────────────────────────────────────────────────────

    function _makeSplitId(string memory label) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(label));
    }

    function _createSplit(
        address requester,
        bytes32 splitId,
        uint256 total,
        uint256 numPayers,
        string memory memo
    ) internal {
        vm.prank(requester);
        settler.createSplit(splitId, total, numPayers, memo);
    }

    // ─── Deployment ───────────────────────────────────────────────────────────

    function test_DeploymentSetsCorrectToken() public view {
        assertEq(settler.ausdToken(), address(ausd));
    }

    function test_DeploymentSetsOwner() public view {
        assertEq(settler.owner(), address(this));
    }

    function test_CannotDeployWithZeroToken() public {
        vm.expectRevert("JanusSplit: zero token address");
        new JanusSplit(address(0));
    }

    // ─── createSplit ─────────────────────────────────────────────────────────

    function test_CreateSplit_Basic() public {
        bytes32 id = _makeSplitId("dinner-1");
        uint256 total = 60 * AUSD_6;
        uint256 payers = 3;

        vm.prank(alice);
        uint256 perPayer = settler.createSplit(id, total, payers, "Dinner at Nobu");

        assertEq(perPayer, 20 * AUSD_6);

        JanusSplit.SplitRecord memory s = settler.getSplit(id);
        assertEq(s.requester, alice);
        assertEq(s.totalAmount, total);
        assertEq(s.amountPerPayer, 20 * AUSD_6);
        assertEq(s.numPayers, 3);
        assertEq(s.settledCount, 0);
        assertEq(uint8(s.status), uint8(JanusSplit.SplitStatus.Active));
        assertEq(s.memo, "Dinner at Nobu");
    }

    function test_CreateSplit_EmitsEvent() public {
        bytes32 id = _makeSplitId("event-test");
        vm.expectEmit(true, true, false, true);
        emit SplitCreated(id, alice, 60 * AUSD_6, 3, "Dinner");
        vm.prank(alice);
        settler.createSplit(id, 60 * AUSD_6, 3, "Dinner");
    }

    function test_CreateSplit_RevertsOnZeroAmount() public {
        bytes32 id = _makeSplitId("zero-amount");
        vm.prank(alice);
        vm.expectRevert(JanusSplit.InvalidAmount.selector);
        settler.createSplit(id, 0, 3, "Bad");
    }

    function test_CreateSplit_RevertsOnZeroPayers() public {
        bytes32 id = _makeSplitId("zero-payers");
        vm.prank(alice);
        vm.expectRevert(JanusSplit.InvalidNumPayers.selector);
        settler.createSplit(id, 60 * AUSD_6, 0, "Bad");
    }

    function test_CreateSplit_RevertsOnDuplicateId() public {
        bytes32 id = _makeSplitId("dup-id");
        vm.prank(alice);
        settler.createSplit(id, 60 * AUSD_6, 3, "Dinner");
        // Trying to create again with the same id
        vm.prank(alice);
        vm.expectRevert(JanusSplit.SplitDoesNotExist.selector);
        settler.createSplit(id, 90 * AUSD_6, 3, "Lunch");
    }

    function test_CreateSplit_SinglePayer() public {
        bytes32 id = _makeSplitId("solo-split");
        vm.prank(alice);
        uint256 perPayer = settler.createSplit(id, 20 * AUSD_6, 1, "Solo Dinner");
        assertEq(perPayer, 20 * AUSD_6);
    }

    // ─── settleSplit ─────────────────────────────────────────────────────────

    function test_SettleSplit_TransfersCorrectAmount() public {
        bytes32 id = _makeSplitId("settle-1");
        _createSplit(alice, id, 60 * AUSD_6, 3, "Dinner");

        uint256 aliceBefore = ausd.balanceOf(alice);
        uint256 bobBefore   = ausd.balanceOf(bob);

        vm.prank(bob);
        settler.settleSplit(id);

        assertEq(ausd.balanceOf(alice), aliceBefore + 20 * AUSD_6, "alice received 20 AUSD");
        assertEq(ausd.balanceOf(bob),   bobBefore   - 20 * AUSD_6, "bob paid 20 AUSD");
    }

    function test_SettleSplit_MarksPayerAsPaid() public {
        bytes32 id = _makeSplitId("mark-paid");
        _createSplit(alice, id, 60 * AUSD_6, 3, "Dinner");

        assertFalse(settler.payerHasSettled(id, bob));
        vm.prank(bob);
        settler.settleSplit(id);
        assertTrue(settler.payerHasSettled(id, bob));
    }

    function test_SettleSplit_EmitsPaymentSettled() public {
        bytes32 id = _makeSplitId("emit-settled");
        _createSplit(alice, id, 60 * AUSD_6, 3, "Dinner");

        vm.expectEmit(true, true, true, true);
        emit PaymentSettled(id, bob, alice, 20 * AUSD_6, "Dinner");
        vm.prank(bob);
        settler.settleSplit(id);
    }

    function test_SettleSplit_FullSettlement_ThreePayers() public {
        bytes32 id = _makeSplitId("full-settle");
        _createSplit(alice, id, 60 * AUSD_6, 3, "Dinner");

        vm.prank(bob);   settler.settleSplit(id);
        vm.prank(carol); settler.settleSplit(id);

        // Before last payer — not yet Settled
        assertEq(uint8(settler.getSplit(id).status), uint8(JanusSplit.SplitStatus.Active));

        // Last payer triggers SplitFullySettled
        vm.expectEmit(true, false, false, false);
        emit SplitFullySettled(id);
        vm.prank(dave); settler.settleSplit(id);

        assertEq(uint8(settler.getSplit(id).status), uint8(JanusSplit.SplitStatus.Settled));
        assertEq(settler.getSplit(id).settledCount, 3);
    }

    function test_SettleSplit_RevertsIfAlreadyPaid() public {
        bytes32 id = _makeSplitId("double-pay");
        _createSplit(alice, id, 60 * AUSD_6, 3, "Dinner");

        vm.prank(bob); settler.settleSplit(id);

        vm.prank(bob);
        vm.expectRevert(JanusSplit.AlreadyPaid.selector);
        settler.settleSplit(id);
    }

    function test_SettleSplit_RevertsIfCancelled() public {
        bytes32 id = _makeSplitId("cancelled-settle");
        _createSplit(alice, id, 60 * AUSD_6, 3, "Dinner");

        vm.prank(alice); settler.cancelSplit(id);
        vm.prank(bob);
        vm.expectRevert(JanusSplit.SplitNotActive.selector);
        settler.settleSplit(id);
    }

    function test_SettleSplit_RevertsOnNonExistentSplit() public {
        bytes32 bad = _makeSplitId("does-not-exist");
        vm.prank(bob);
        vm.expectRevert(JanusSplit.SplitDoesNotExist.selector);
        settler.settleSplit(bad);
    }

    function test_SettleSplit_RevertsIfSplitAlreadyFullySettled() public {
        bytes32 id = _makeSplitId("post-settled");
        _createSplit(alice, id, 20 * AUSD_6, 1, "Solo");
        vm.prank(bob); settler.settleSplit(id); // fully settles

        vm.prank(carol);
        vm.expectRevert(JanusSplit.SplitNotActive.selector);
        settler.settleSplit(id);
    }

    // ─── settleDirectTransfer ─────────────────────────────────────────────────

    function test_DirectTransfer_Basic() public {
        bytes32 id = _makeSplitId("direct-1");
        uint256 amount = 25 * AUSD_6;

        uint256 aliceBefore = ausd.balanceOf(alice);
        uint256 bobBefore   = ausd.balanceOf(bob);

        vm.prank(bob);
        settler.settleDirectTransfer(id, alice, amount, "Dinner payment");

        assertEq(ausd.balanceOf(alice), aliceBefore + amount);
        assertEq(ausd.balanceOf(bob),   bobBefore   - amount);
    }

    function test_DirectTransfer_EmitsEvent() public {
        bytes32 id = _makeSplitId("direct-event");
        uint256 amount = 10 * AUSD_6;

        vm.expectEmit(true, true, true, true);
        emit PaymentSettled(id, bob, alice, amount, "Coffee");
        vm.prank(bob);
        settler.settleDirectTransfer(id, alice, amount, "Coffee");
    }

    function test_DirectTransfer_RevertsOnZeroAmount() public {
        bytes32 id = _makeSplitId("direct-zero");
        vm.prank(bob);
        vm.expectRevert(JanusSplit.InvalidAmount.selector);
        settler.settleDirectTransfer(id, alice, 0, "Bad");
    }

    function test_DirectTransfer_RevertsOnZeroRecipient() public {
        bytes32 id = _makeSplitId("direct-zero-addr");
        vm.prank(bob);
        vm.expectRevert(JanusSplit.InvalidRecipient.selector);
        settler.settleDirectTransfer(id, address(0), 10 * AUSD_6, "Bad");
    }

    function test_DirectTransfer_DoesNotRequireRegistration() public {
        // No createSplit needed — just transfers immediately
        bytes32 random = keccak256(abi.encodePacked(block.timestamp, "random"));
        vm.prank(bob);
        settler.settleDirectTransfer(random, alice, 5 * AUSD_6, "Quick pay");
        // No revert = pass
    }

    // ─── settleBatch ─────────────────────────────────────────────────────────

    function test_SettleBatch_DistributesToMultipleRecipients() public {
        bytes32 id = _makeSplitId("batch-1");
        address[] memory recipients = new address[](3);
        uint256[] memory amounts    = new uint256[](3);

        recipients[0] = alice;
        recipients[1] = carol;
        recipients[2] = dave;
        amounts[0]    = 20 * AUSD_6;
        amounts[1]    = 15 * AUSD_6;
        amounts[2]    = 10 * AUSD_6;

        uint256 aliceBefore = ausd.balanceOf(alice);
        uint256 carolBefore = ausd.balanceOf(carol);
        uint256 daveBefore  = ausd.balanceOf(dave);
        uint256 bobBefore   = ausd.balanceOf(bob);

        vm.prank(bob);
        settler.settleBatch(id, recipients, amounts, "Batch dinner split");

        assertEq(ausd.balanceOf(alice), aliceBefore + 20 * AUSD_6);
        assertEq(ausd.balanceOf(carol), carolBefore + 15 * AUSD_6);
        assertEq(ausd.balanceOf(dave),  daveBefore  + 10 * AUSD_6);
        assertEq(ausd.balanceOf(bob),   bobBefore   - 45 * AUSD_6);
    }

    function test_SettleBatch_EmitsBatchSettled() public {
        bytes32 id = _makeSplitId("batch-event");
        address[] memory recipients = new address[](2);
        uint256[] memory amounts    = new uint256[](2);
        recipients[0] = alice; amounts[0] = 10 * AUSD_6;
        recipients[1] = carol; amounts[1] = 10 * AUSD_6;

        vm.expectEmit(true, true, false, true);
        emit BatchSettled(id, bob, 20 * AUSD_6, 2);
        vm.prank(bob);
        settler.settleBatch(id, recipients, amounts, "Split");
    }

    function test_SettleBatch_RevertsOnEmptyArray() public {
        bytes32 id = _makeSplitId("batch-empty");
        address[] memory r = new address[](0);
        uint256[] memory a = new uint256[](0);
        vm.prank(bob);
        vm.expectRevert(JanusSplit.ArrayLengthMismatch.selector);
        settler.settleBatch(id, r, a, "Empty");
    }

    function test_SettleBatch_RevertsOnMismatchedArrays() public {
        bytes32 id = _makeSplitId("batch-mismatch");
        address[] memory r = new address[](2);
        uint256[] memory a = new uint256[](3);
        vm.prank(bob);
        vm.expectRevert(JanusSplit.ArrayLengthMismatch.selector);
        settler.settleBatch(id, r, a, "Mismatch");
    }

    function test_SettleBatch_RevertsOnZeroRecipient() public {
        bytes32 id = _makeSplitId("batch-zero-addr");
        address[] memory r = new address[](2);
        uint256[] memory a = new uint256[](2);
        r[0] = alice; a[0] = 10 * AUSD_6;
        r[1] = address(0); a[1] = 10 * AUSD_6;

        vm.prank(bob);
        vm.expectRevert(JanusSplit.InvalidRecipient.selector);
        settler.settleBatch(id, r, a, "Bad addr");
    }

    function test_SettleBatch_RevertsOnZeroAmount() public {
        bytes32 id = _makeSplitId("batch-zero-amt");
        address[] memory r = new address[](2);
        uint256[] memory a = new uint256[](2);
        r[0] = alice; a[0] = 10 * AUSD_6;
        r[1] = carol; a[1] = 0;

        vm.prank(bob);
        vm.expectRevert(JanusSplit.InvalidAmount.selector);
        settler.settleBatch(id, r, a, "Zero amt");
    }

    function test_SettleBatch_SingleRecipient() public {
        bytes32 id = _makeSplitId("batch-single");
        address[] memory r = new address[](1);
        uint256[] memory a = new uint256[](1);
        r[0] = alice; a[0] = 30 * AUSD_6;

        vm.prank(bob);
        settler.settleBatch(id, r, a, "Single batch");
        assertEq(ausd.balanceOf(alice), 1000 * AUSD_6 + 30 * AUSD_6);
    }

    // ─── settleWithPermit ─────────────────────────────────────────────────────

    function test_SettleWithPermit_Success() public {
        uint256 payerKey = 0xBEEF;
        address payer = vm.addr(payerKey);
        ausd.mint(payer, 100 * AUSD_6);

        bytes32 id = _makeSplitId("permit-1");
        _createSplit(alice, id, 20 * AUSD_6, 1, "Permit test");

        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                ausd.DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                        payer,
                        address(settler),
                        20 * AUSD_6,
                        ausd.nonces(payer),
                        deadline
                    )
                )
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(payerKey, digest);

        uint256 aliceBefore = ausd.balanceOf(alice);

        vm.prank(payer);
        settler.settleWithPermit(id, deadline, v, r, s);

        assertEq(ausd.balanceOf(alice), aliceBefore + 20 * AUSD_6, "alice received funds");
        assertEq(ausd.balanceOf(payer), 80 * AUSD_6, "payer sent funds");
        assertTrue(settler.payerHasSettled(id, payer));
    }

    function test_SettleWithPermit_RevertsIfDeadlineExpired() public {
        bytes32 id = _makeSplitId("permit-expired");
        _createSplit(alice, id, 20 * AUSD_6, 1, "Expired permit");

        uint256 pastDeadline = block.timestamp - 1;
        vm.prank(bob);
        vm.expectRevert(JanusSplit.PermitDeadlineExpired.selector);
        settler.settleWithPermit(id, pastDeadline, 0, bytes32(0), bytes32(0));
    }

    // ─── cancelSplit ─────────────────────────────────────────────────────────

    function test_CancelSplit_RequesterCanCancel() public {
        bytes32 id = _makeSplitId("cancel-ok");
        _createSplit(alice, id, 60 * AUSD_6, 3, "Dinner");

        vm.expectEmit(true, true, false, false);
        emit SplitCancelled(id, alice);
        vm.prank(alice);
        settler.cancelSplit(id);

        assertEq(uint8(settler.getSplit(id).status), uint8(JanusSplit.SplitStatus.Cancelled));
    }

    function test_CancelSplit_RevertsIfNotRequester() public {
        bytes32 id = _makeSplitId("cancel-unauth");
        _createSplit(alice, id, 60 * AUSD_6, 3, "Dinner");

        vm.prank(eve);
        vm.expectRevert(JanusSplit.NotRequester.selector);
        settler.cancelSplit(id);
    }

    function test_CancelSplit_RevertsIfAlreadyCancelled() public {
        bytes32 id = _makeSplitId("cancel-twice");
        _createSplit(alice, id, 60 * AUSD_6, 3, "Dinner");

        vm.prank(alice); settler.cancelSplit(id);
        vm.prank(alice);
        vm.expectRevert(JanusSplit.SplitNotActive.selector);
        settler.cancelSplit(id);
    }

    function test_CancelSplit_RevertsOnNonExistentSplit() public {
        bytes32 bad = _makeSplitId("cancel-ghost");
        vm.prank(alice);
        vm.expectRevert(JanusSplit.SplitDoesNotExist.selector);
        settler.cancelSplit(bad);
    }

    // ─── View functions ───────────────────────────────────────────────────────

    function test_RemainingPayers_DecreasesOnSettlement() public {
        bytes32 id = _makeSplitId("remaining");
        _createSplit(alice, id, 60 * AUSD_6, 3, "Dinner");

        assertEq(settler.remainingPayers(id), 3);
        vm.prank(bob);   settler.settleSplit(id);
        assertEq(settler.remainingPayers(id), 2);
        vm.prank(carol); settler.settleSplit(id);
        assertEq(settler.remainingPayers(id), 1);
        vm.prank(dave);  settler.settleSplit(id);
        assertEq(settler.remainingPayers(id), 0);
    }

    function test_RemainingPayers_RevertsOnNonExistentSplit() public {
        bytes32 bad = _makeSplitId("no-split");
        vm.expectRevert(JanusSplit.SplitDoesNotExist.selector);
        settler.remainingPayers(bad);
    }

    function test_PayerHasSettled_FalseByDefault() public view {
        bytes32 id = _makeSplitId("payer-false");
        assertFalse(settler.payerHasSettled(id, bob));
    }

    // ─── Fuzz tests ───────────────────────────────────────────────────────────

    /// @dev Fuzz: any valid (amount, numPayers) pair where amount >= numPayers and
    ///            amount is evenly divisible.
    function testFuzz_CreateAndSettleFullSplit(
        uint96 totalRaw,
        uint8 numPayersRaw
    ) public {
        // Constrain to sensible ranges
        uint256 numPayers = bound(uint256(numPayersRaw), 1, 10);
        uint256 total     = bound(uint256(totalRaw), numPayers, 1_000_000 * AUSD_6);
        // Round down so division is exact
        total = (total / numPayers) * numPayers;
        if (total == 0) return;

        bytes32 id = keccak256(abi.encodePacked("fuzz", totalRaw, numPayersRaw));

        // Make payers from deterministic addresses, fund and approve each
        address[] memory payers = new address[](numPayers);
        for (uint256 i; i < numPayers; i++) {
            payers[i] = address(uint160(uint256(keccak256(abi.encodePacked("fuzz-payer", i)))));
            ausd.mint(payers[i], total); // over-fund
            vm.prank(payers[i]);
            ausd.approve(address(settler), type(uint256).max);
        }

        uint256 aliceStart = ausd.balanceOf(alice);

        vm.prank(alice);
        uint256 perPayer = settler.createSplit(id, total, numPayers, "Fuzz split");
        assertEq(perPayer, total / numPayers);

        for (uint256 i; i < numPayers; i++) {
            vm.prank(payers[i]);
            settler.settleSplit(id);
        }

        assertEq(
            ausd.balanceOf(alice),
            aliceStart + total,
            "alice should have received the full total"
        );
        assertEq(uint8(settler.getSplit(id).status), uint8(JanusSplit.SplitStatus.Settled));
    }

    /// @dev Fuzz: direct transfer with random amounts never violates balances
    function testFuzz_DirectTransfer(uint96 amountRaw) public {
        uint256 amount = bound(uint256(amountRaw), 1, 1000 * AUSD_6);
        bytes32 id = keccak256(abi.encodePacked("fuzz-direct", amountRaw));

        uint256 bobBefore   = ausd.balanceOf(bob);
        uint256 aliceBefore = ausd.balanceOf(alice);

        vm.prank(bob);
        settler.settleDirectTransfer(id, alice, amount, "Fuzz direct");

        assertEq(ausd.balanceOf(bob),   bobBefore   - amount);
        assertEq(ausd.balanceOf(alice), aliceBefore + amount);
    }

    // ─── Monad Testnet context (Chain ID 10143) ───────────────────────────────

    /// @dev Verify contract behaves correctly when forked against Chain ID 10143
    function test_ChainIdIs10143InMonadContext() public {
        // Simulate Monad Testnet chain ID
        vm.chainId(10143);
        assertEq(block.chainid, 10143);

        // Basic settlement still works under Monad chain ID
        bytes32 id = _makeSplitId("monad-chain-test");
        _createSplit(alice, id, 30 * AUSD_6, 1, "Monad test");
        vm.prank(bob);
        settler.settleSplit(id);
        assertTrue(settler.payerHasSettled(id, bob));
    }

    // ─── Gas benchmarks (informational) ──────────────────────────────────────

    function test_Gas_CreateSplit() public {
        bytes32 id = _makeSplitId("gas-create");
        vm.prank(alice);
        uint256 gasStart = gasleft();
        settler.createSplit(id, 60 * AUSD_6, 3, "Gas benchmark");
        uint256 gasUsed = gasStart - gasleft();
        // Just log — no hard assertion; benchmark for Monad optimization
        emit log_named_uint("Gas used: createSplit", gasUsed);
    }

    function test_Gas_SettleSplit() public {
        bytes32 id = _makeSplitId("gas-settle");
        _createSplit(alice, id, 60 * AUSD_6, 3, "Gas benchmark");
        vm.prank(bob);
        uint256 gasStart = gasleft();
        settler.settleSplit(id);
        uint256 gasUsed = gasStart - gasleft();
        emit log_named_uint("Gas used: settleSplit", gasUsed);
    }

    function test_Gas_SettleBatch_10Recipients() public {
        bytes32 id = _makeSplitId("gas-batch-10");
        address[] memory r = new address[](10);
        uint256[] memory a = new uint256[](10);
        for (uint256 i; i < 10; i++) {
            r[i] = address(uint160(uint256(keccak256(abi.encodePacked("recv", i)))));
            a[i] = 5 * AUSD_6;
        }
        vm.prank(bob);
        uint256 gasStart = gasleft();
        settler.settleBatch(id, r, a, "Batch gas benchmark");
        uint256 gasUsed = gasStart - gasleft();
        emit log_named_uint("Gas used: settleBatch (10 recipients)", gasUsed);
    }

    // ─── Spec Section 5.1 Aliases: createBill & settleShare ──────────────────

    function test_CreateBill_And_SettleShare_Alias() public {
        bytes32 billId = _makeSplitId("bill-spec-alias");
        vm.prank(alice);
        uint256 perPerson = settler.createBill(billId, "Dinner", 60 * AUSD_6, 3);
        assertEq(perPerson, 20 * AUSD_6);

        uint256 aliceBefore = ausd.balanceOf(alice);
        vm.prank(bob);
        settler.settleShare(billId);
        assertEq(ausd.balanceOf(alice), aliceBefore + 20 * AUSD_6);
        assertTrue(settler.payerHasSettled(billId, bob));
    }
}
