import { ethers } from "hardhat";
import { expect } from "chai";
import type { JanusSplit } from "../typechain-types";
import type { MockAUSD } from "../typechain-types";

/**
 * Hardhat / Ethers.js test suite for JanusSplit.sol
 * Mirrors the Foundry tests but uses Chai + ethers.js style assertions.
 * Run: npx hardhat test
 */
describe("JanusSplit — Hardhat suite", function () {
  let settler: JanusSplit;
  let ausd: MockAUSD;

  let alice: ReturnType<typeof ethers.provider.getSigner> extends Promise<infer R> ? R : never;
  let bob:   ReturnType<typeof ethers.provider.getSigner> extends Promise<infer R> ? R : never;
  let carol: ReturnType<typeof ethers.provider.getSigner> extends Promise<infer R> ? R : never;
  let dave:  ReturnType<typeof ethers.provider.getSigner> extends Promise<infer R> ? R : never;
  let eve:   ReturnType<typeof ethers.provider.getSigner> extends Promise<infer R> ? R : never;

  const AUSD_6 = 1_000_000n; // 1 AUSD with 6 decimals

  function splitId(label: string): string {
    return ethers.keccak256(ethers.toUtf8Bytes(label));
  }

  beforeEach(async function () {
    [alice, bob, carol, dave, eve] = await ethers.getSigners();

    const MockAUSDFactory = await ethers.getContractFactory("MockAUSD");
    ausd = (await MockAUSDFactory.deploy()) as MockAUSD;
    await ausd.waitForDeployment();

    const JanusSplitFactory = await ethers.getContractFactory("JanusSplit");
    settler = (await JanusSplitFactory.deploy(await ausd.getAddress())) as JanusSplit;
    await settler.waitForDeployment();

    // Fund & approve
    for (const signer of [alice, bob, carol, dave]) {
      await ausd.mint(await signer.getAddress(), 1000n * AUSD_6);
      await ausd.connect(signer).approve(await settler.getAddress(), ethers.MaxUint256);
    }
  });

  // ─── Deployment ─────────────────────────────────────────────────────────

  it("sets correct AUSD token address", async function () {
    expect(await settler.ausdToken()).to.equal(await ausd.getAddress());
  });

  it("reverts with zero token address", async function () {
    const Factory = await ethers.getContractFactory("JanusSplit");
    await expect(Factory.deploy(ethers.ZeroAddress))
      .to.be.revertedWith("JanusSplit: zero token address");
  });

  // ─── createSplit ────────────────────────────────────────────────────────

  it("creates a split and stores correct data", async function () {
    const id = splitId("ht-dinner-1");
    await settler.connect(alice).createSplit(id, 60n * AUSD_6, 3n, "Dinner");

    const s = await settler.getSplit(id);
    expect(s.requester).to.equal(await alice.getAddress());
    expect(s.totalAmount).to.equal(60n * AUSD_6);
    expect(s.amountPerPayer).to.equal(20n * AUSD_6);
    expect(s.numPayers).to.equal(3n);
    expect(s.settledCount).to.equal(0n);
    expect(s.status).to.equal(0n); // Active
    expect(s.memo).to.equal("Dinner");
  });

  it("emits SplitCreated event", async function () {
    const id = splitId("ht-event-1");
    await expect(settler.connect(alice).createSplit(id, 60n * AUSD_6, 3n, "Dinner"))
      .to.emit(settler, "SplitCreated")
      .withArgs(id, await alice.getAddress(), 60n * AUSD_6, 3n, "Dinner");
  });

  it("reverts on zero total amount", async function () {
    await expect(settler.connect(alice).createSplit(splitId("zero"), 0n, 3n, "Bad"))
      .to.be.revertedWithCustomError(settler, "InvalidAmount");
  });

  it("reverts on zero payers", async function () {
    await expect(settler.connect(alice).createSplit(splitId("zerop"), 60n * AUSD_6, 0n, "Bad"))
      .to.be.revertedWithCustomError(settler, "InvalidNumPayers");
  });

  // ─── settleSplit ────────────────────────────────────────────────────────

  it("transfers amountPerPayer from payer to requester", async function () {
    const id = splitId("ht-settle-1");
    await settler.connect(alice).createSplit(id, 60n * AUSD_6, 3n, "Dinner");

    const aliceBefore = await ausd.balanceOf(await alice.getAddress());
    const bobBefore   = await ausd.balanceOf(await bob.getAddress());

    await settler.connect(bob).settleSplit(id);

    expect(await ausd.balanceOf(await alice.getAddress())).to.equal(aliceBefore + 20n * AUSD_6);
    expect(await ausd.balanceOf(await bob.getAddress())).to.equal(bobBefore - 20n * AUSD_6);
  });

  it("emits PaymentSettled on settle", async function () {
    const id = splitId("ht-emit-settle");
    await settler.connect(alice).createSplit(id, 60n * AUSD_6, 3n, "Dinner");

    await expect(settler.connect(bob).settleSplit(id))
      .to.emit(settler, "PaymentSettled")
      .withArgs(id, await bob.getAddress(), await alice.getAddress(), 20n * AUSD_6, "Dinner");
  });

  it("emits SplitFullySettled when all payers settle", async function () {
    const id = splitId("ht-full-settle");
    await settler.connect(alice).createSplit(id, 30n * AUSD_6, 2n, "Dinner");

    await settler.connect(bob).settleSplit(id);

    await expect(settler.connect(carol).settleSplit(id))
      .to.emit(settler, "SplitFullySettled")
      .withArgs(id);

    expect((await settler.getSplit(id)).status).to.equal(1n); // Settled
  });

  it("reverts AlreadyPaid on double pay", async function () {
    const id = splitId("ht-double");
    await settler.connect(alice).createSplit(id, 60n * AUSD_6, 3n, "Dinner");
    await settler.connect(bob).settleSplit(id);

    await expect(settler.connect(bob).settleSplit(id))
      .to.be.revertedWithCustomError(settler, "AlreadyPaid");
  });

  it("reverts SplitNotActive on cancelled split", async function () {
    const id = splitId("ht-cancel-settle");
    await settler.connect(alice).createSplit(id, 60n * AUSD_6, 3n, "Dinner");
    await settler.connect(alice).cancelSplit(id);

    await expect(settler.connect(bob).settleSplit(id))
      .to.be.revertedWithCustomError(settler, "SplitNotActive");
  });

  // ─── settleDirectTransfer ───────────────────────────────────────────────

  it("direct transfer: moves AUSD between accounts", async function () {
    const id = splitId("ht-direct-1");
    const aliceBefore = await ausd.balanceOf(await alice.getAddress());

    await settler.connect(bob).settleDirectTransfer(id, await alice.getAddress(), 25n * AUSD_6, "Coffee");

    expect(await ausd.balanceOf(await alice.getAddress())).to.equal(aliceBefore + 25n * AUSD_6);
  });

  it("direct transfer: reverts on zero amount", async function () {
    await expect(
      settler.connect(bob).settleDirectTransfer(splitId("dt-zero"), await alice.getAddress(), 0n, "Bad")
    ).to.be.revertedWithCustomError(settler, "InvalidAmount");
  });

  it("direct transfer: reverts on zero address", async function () {
    await expect(
      settler.connect(bob).settleDirectTransfer(splitId("dt-addr"), ethers.ZeroAddress, 10n * AUSD_6, "Bad")
    ).to.be.revertedWithCustomError(settler, "InvalidRecipient");
  });

  // ─── settleBatch ────────────────────────────────────────────────────────

  it("batch settlement distributes to all recipients", async function () {
    const id = splitId("ht-batch-1");
    const recipients = [await alice.getAddress(), await carol.getAddress(), await dave.getAddress()];
    const amounts    = [20n * AUSD_6, 15n * AUSD_6, 10n * AUSD_6];

    const aliceBefore = await ausd.balanceOf(await alice.getAddress());
    const carolBefore = await ausd.balanceOf(await carol.getAddress());
    const daveBefore  = await ausd.balanceOf(await dave.getAddress());
    const bobBefore   = await ausd.balanceOf(await bob.getAddress());

    await settler.connect(bob).settleBatch(id, recipients, amounts, "Dinner");

    expect(await ausd.balanceOf(await alice.getAddress())).to.equal(aliceBefore + 20n * AUSD_6);
    expect(await ausd.balanceOf(await carol.getAddress())).to.equal(carolBefore + 15n * AUSD_6);
    expect(await ausd.balanceOf(await dave.getAddress())).to.equal(daveBefore  + 10n * AUSD_6);
    expect(await ausd.balanceOf(await bob.getAddress())).to.equal(bobBefore   - 45n * AUSD_6);
  });

  it("batch: emits BatchSettled", async function () {
    const id = splitId("ht-batch-event");
    const recipients = [await alice.getAddress(), await carol.getAddress()];
    const amounts    = [10n * AUSD_6, 10n * AUSD_6];

    await expect(settler.connect(bob).settleBatch(id, recipients, amounts, "Split"))
      .to.emit(settler, "BatchSettled")
      .withArgs(id, await bob.getAddress(), 20n * AUSD_6, 2n);
  });

  it("batch: reverts on empty arrays", async function () {
    await expect(settler.connect(bob).settleBatch(splitId("empty"), [], [], "Empty"))
      .to.be.revertedWithCustomError(settler, "ArrayLengthMismatch");
  });

  it("batch: reverts on mismatched arrays", async function () {
    const r = [await alice.getAddress(), await carol.getAddress()];
    const a = [10n * AUSD_6];
    await expect(settler.connect(bob).settleBatch(splitId("mismatch"), r, a, "Bad"))
      .to.be.revertedWithCustomError(settler, "ArrayLengthMismatch");
  });

  // ─── cancelSplit ────────────────────────────────────────────────────────

  it("requester can cancel active split", async function () {
    const id = splitId("ht-cancel-ok");
    await settler.connect(alice).createSplit(id, 60n * AUSD_6, 3n, "Dinner");

    await expect(settler.connect(alice).cancelSplit(id))
      .to.emit(settler, "SplitCancelled")
      .withArgs(id, await alice.getAddress());

    expect((await settler.getSplit(id)).status).to.equal(2n); // Cancelled
  });

  it("reverts NotRequester if non-requester tries to cancel", async function () {
    const id = splitId("ht-cancel-unauth");
    await settler.connect(alice).createSplit(id, 60n * AUSD_6, 3n, "Dinner");

    await expect(settler.connect(eve).cancelSplit(id))
      .to.be.revertedWithCustomError(settler, "NotRequester");
  });

  // ─── View functions ─────────────────────────────────────────────────────

  it("remainingPayers decreases as payers settle", async function () {
    const id = splitId("ht-remaining");
    await settler.connect(alice).createSplit(id, 60n * AUSD_6, 3n, "Dinner");

    expect(await settler.remainingPayers(id)).to.equal(3n);
    await settler.connect(bob).settleSplit(id);
    expect(await settler.remainingPayers(id)).to.equal(2n);
    await settler.connect(carol).settleSplit(id);
    expect(await settler.remainingPayers(id)).to.equal(1n);
    await settler.connect(dave).settleSplit(id);
    expect(await settler.remainingPayers(id)).to.equal(0n);
  });

  it("payerHasSettled returns false before payment", async function () {
    const id = splitId("ht-not-paid");
    await settler.connect(alice).createSplit(id, 20n * AUSD_6, 1n, "Test");
    expect(await settler.payerHasSettled(id, await bob.getAddress())).to.be.false;
  });

  // ─── Scenario: Full Monad dinner split ─────────────────────────────────

  it("E2E: $60 AUSD dinner split across 3 people settles correctly", async function () {
    const TOTAL = 60n * AUSD_6;
    const PER_PERSON = 20n * AUSD_6;
    const id = splitId("monad-dinner-e2e");

    // Alice creates the split
    await settler.connect(alice).createSplit(id, TOTAL, 3n, "Monad Metropolis Hackathon Dinner");

    // Initial balances
    const aliceStart = await ausd.balanceOf(await alice.getAddress());

    // Three payers settle one by one
    await settler.connect(bob).settleSplit(id);
    await settler.connect(carol).settleSplit(id);

    let record = await settler.getSplit(id);
    expect(record.settledCount).to.equal(2n);
    expect(record.status).to.equal(0n); // Still Active

    await expect(settler.connect(dave).settleSplit(id))
      .to.emit(settler, "SplitFullySettled").withArgs(id);

    record = await settler.getSplit(id);
    expect(record.settledCount).to.equal(3n);
    expect(record.status).to.equal(1n); // Settled

    // Alice received exactly $60 AUSD
    expect(await ausd.balanceOf(await alice.getAddress())).to.equal(aliceStart + TOTAL);

    // Each payer paid exactly $20 AUSD
    for (const signer of [bob, carol, dave]) {
      expect(await ausd.balanceOf(await signer.getAddress())).to.equal(1000n * AUSD_6 - PER_PERSON);
    }
  });
});
