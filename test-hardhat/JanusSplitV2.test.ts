import { ethers } from "hardhat";
import { expect } from "chai";

describe("JanusSplitV2", function () {
  const AUSD_6 = 1_000_000n;

  it("keeps normal one-payment protection and allows an explicit covered share", async function () {
    const [organizer, firstPayer, coveringPayer] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("MockAUSD");
    const token = await Token.deploy();
    await token.waitForDeployment();

    const Factory = await ethers.getContractFactory("JanusSplitV2");
    const split = await Factory.deploy(await token.getAddress());
    await split.waitForDeployment();

    for (const payer of [firstPayer, coveringPayer]) {
      await token.mint(await payer.getAddress(), 100n * AUSD_6);
      await token.connect(payer).approve(await split.getAddress(), ethers.MaxUint256);
    }

    const id = ethers.keccak256(ethers.toUtf8Bytes("v2-cover-share"));
    await split.connect(organizer).createSplit(id, 20n * AUSD_6, 2n, "Dinner");

    await split.connect(firstPayer).settleSplit(id);
    await expect(split.connect(firstPayer).settleSplit(id))
      .to.be.revertedWithCustomError(split, "AlreadyPaid");

    await expect(split.connect(coveringPayer).settleAdditionalShare(id))
      .to.emit(split, "SplitFullySettled");

    const record = await split.getSplit(id);
    expect(record.settledCount).to.equal(2n);
    expect(record.status).to.equal(1n); // Settled
  });
});
