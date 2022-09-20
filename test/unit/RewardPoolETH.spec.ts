import {
  loadFixture,
  mine,
  time,
  mineUpTo,
} from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import {
  collectionswapFixture,
  rewardTokenFixture,
  nftFixture,
} from "../shared/fixtures";
import { createPairEth, mintNfts } from "../shared/helpers";
import { getSigners } from "../shared/signers";

import type {
  Collectionswap,
  ExponentialCurve,
  ICurve,
  IERC20,
  IERC721,
  RewardPoolETH,
} from "../../typechain-types";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import type { BigNumberish } from "ethers";

describe("RewardPoolETH", function () {
  let collectionswap: Collectionswap;
  let rewardTokens: IERC20[];
  let rewards: BigNumberish[];
  let nft: IERC721;
  let exponentialCurve: ExponentialCurve;
  let lpTokenId: BigNumberish;
  let lpTokenId1: BigNumberish;
  let rewardPool: RewardPoolETH;
  let owner: SignerWithAddress;
  let user: SignerWithAddress;
  let user1: SignerWithAddress;

  const numRewardTokens = 2;
  const dayDuration = 86400;
  // removing the last few digits when comparing, since we have 18
  // so this should be fine
  const removePrecision = 1000000;

  const rewardDuration = dayDuration;

  beforeEach(async function () {
    ({
      collectionswap,
      rewardTokens,
      rewards,
      nft,
      exponentialCurve,
      lpTokenId,
      lpTokenId1,
      rewardPool,
      owner,
      user,
      user1,
    } = await loadFixture(rewardPoolFixture));
  });

  async function rewardPoolFixture() {
    const { owner, user, user1 } = await getSigners();

    let { collectionswap, exponentialCurve } = await collectionswapFixture();
    const rewardTokens = (await rewardTokenFixture()).slice(0, numRewardTokens);
    let { nft } = await nftFixture();

    const rewards = [
      ethers.utils.parseEther("5"),
      ethers.utils.parseEther("7"),
    ];
    const startTime = (await time.latest()) + 1000;
    const endTime = startTime + rewardDuration;
    const rewardRates = rewards.map((reward) =>
      reward.div(endTime - startTime)
    );

    const RewardPool = await ethers.getContractFactory("RewardPoolETH");
    let rewardPool = await RewardPool.connect(collectionswap.signer).deploy(
      owner.address,
      collectionswap.address,
      nft.address,
      exponentialCurve.address,
      ethers.utils.parseEther("1.5"),
      ethers.BigNumber.from("200000000000000000"),
      rewardTokens.map((rewardToken) => rewardToken.address),
      rewardRates,
      startTime,
      endTime
    );

    for (let i = 0; i < numRewardTokens; i++) {
      await rewardTokens[i].mint(rewardPool.address, rewards[i]);
    }
    const nftTokenIds = await mintNfts(nft, user.address);
    const nftTokenIds1 = await mintNfts(nft, user1.address);

    collectionswap = collectionswap.connect(user);
    nft = nft.connect(user);
    rewardPool = rewardPool.connect(user);

    const params = {
      bondingCurve: exponentialCurve as unknown as ICurve,
      delta: ethers.utils.parseEther("1.5"),
      fee: ethers.BigNumber.from("200000000000000000"),
      spotPrice: ethers.BigNumber.from("16493775933609955"),
      value: ethers.utils.parseEther("2"),
    };

    const { lpTokenId } = await createPairEth(collectionswap, {
      ...params,
      nft,
      nftTokenIds,
    });

    const { lpTokenId: lpTokenId1 } = await createPairEth(
      collectionswap.connect(user1),
      {
        ...params,
        nft: nft.connect(user1),
        nftTokenIds: nftTokenIds1,
      }
    );

    return {
      collectionswap,
      rewardTokens,
      rewards,
      nft,
      exponentialCurve,
      lpTokenId,
      lpTokenId1,
      rewardPool,
      owner,
      user,
      user1,
    };
  }

  describe("Deployment", function () {
    it("Should deploy", async function () {
      await loadFixture(rewardPoolFixture);
    });
  });

  describe("Stake", function () {
    it("Should mint contribution", async function () {
      await collectionswap.approve(rewardPool.address, lpTokenId);

      await rewardPool.stake(lpTokenId);
      expect(await collectionswap.ownerOf(lpTokenId)).to.equal(
        rewardPool.address
      );
      expect(await rewardPool.balanceOf(user.address)).to.not.equal(0);
    });
  });

  describe("Withdraw", function () {
    it("Should burn contribution", async function () {
      await collectionswap.approve(rewardPool.address, lpTokenId);
      await rewardPool.stake(lpTokenId);

      await rewardPool.withdraw(lpTokenId);
      expect(await collectionswap.ownerOf(lpTokenId)).to.equal(user.address);
      expect(await rewardPool.balanceOf(user.address)).to.equal(0);
    });
  });

  describe("GetReward", function () {
    it("Should be entitled to full rewards if staked before rewards start", async function () {
      await collectionswap.approve(rewardPool.address, lpTokenId);
      await rewardPool.stake(lpTokenId);

      // mine to after rewards finish
      await time.increase(2 * rewardDuration);
      await rewardPool.exit(lpTokenId);
      for (let i = 0; i < numRewardTokens; i++) {
        const reward = rewards[i];
        const userReward = await rewardTokens[i].balanceOf(user.address);
        expect(userReward).to.approximately(reward, removePrecision);
      }
    });

    it("Should get 0 rewards if exit before rewards start", async function () {
      await collectionswap.approve(rewardPool.address, lpTokenId);
      await rewardPool.stake(lpTokenId);

      // mine to before rewards start
      await time.setNextBlockTimestamp(await rewardPool.lastUpdateTime());
      await rewardPool.exit(lpTokenId);
      for (let i = 0; i < numRewardTokens; i++) {
        expect(await rewardTokens[i].balanceOf(user.address)).to.equal(0);
      }
    });

    it("Should get reward after staking", async function () {
      await collectionswap.approve(rewardPool.address, lpTokenId);
      await rewardPool.stake(lpTokenId);

      // mine to after start time
      await time.increaseTo((await rewardPool.lastUpdateTime()).add(1));
      await rewardPool.getReward();
      for (let i = 0; i < numRewardTokens; i++) {
        expect(await rewardTokens[i].balanceOf(user.address)).to.not.equal(0);
      }
    });

    it("Should not get reward after exit", async function () {
      await collectionswap.approve(rewardPool.address, lpTokenId);
      await rewardPool.stake(lpTokenId);
      await rewardPool.exit(lpTokenId);

      const response = await rewardPool.getReward();
      const receipt = await response.wait();
      expect(receipt.events).to.be.empty;
    });

    it("Should not be able to get reward if pool not started", async function () {
      await collectionswap.approve(rewardPool.address, lpTokenId);
      await rewardPool.stake(lpTokenId);

      // The user should still be able to stake and see his stake
      expect(await rewardPool.balanceOf(user.address)).to.not.equal(0);

      // time passes
      await time.increase(300);
      const startingBlock = await time.latestBlock();
      const endBlock = startingBlock + 100;
      await mineUpTo(endBlock);

      // but there's no reward after exit.
      await rewardPool.exit(lpTokenId);
      for (let i = 0; i < numRewardTokens; i++) {
        expect(await rewardTokens[i].balanceOf(user.address)).to.equal(0);
      }
    });

    it("One single stake. User takes every reward after the duration is over", async function () {
      await collectionswap.approve(rewardPool.address, lpTokenId);
      await rewardPool.stake(lpTokenId);
      // The user should still be able to stake and see his stake
      expect(await rewardPool.balanceOf(user.address)).to.not.equal(0);

      // time passes
      await mine();
      await time.increase(2 * rewardDuration);
      await mine();

      // get the reward period
      const period = rewardDuration;

      // make sure the time has passed
      expect(await time.latest()).to.greaterThan(
        await rewardPool.periodFinish()
      );

      // the only user should get most rewards
      // there will be some dust in the contract
      await rewardPool.exit(lpTokenId);

      for (let i = 0; i < numRewardTokens; i++) {
        const rewardToken = rewardTokens[i];
        const rewardRate = await rewardPool.rewardRates(rewardToken.address);

        const userReward = await rewardToken.balanceOf(user.address);

        const reward = rewardRate.mul(period);
        expect(userReward).to.approximately(reward, removePrecision);
      }
    });

    it("Two users who staked the same amount right from the beginning", async function () {
      await collectionswap.approve(rewardPool.address, lpTokenId);
      await rewardPool.stake(lpTokenId);
      await collectionswap
        .connect(user1)
        .approve(rewardPool.address, lpTokenId1);
      await rewardPool.connect(user1).stake(lpTokenId1);
      // The user should still be able to stake and see his stake
      expect(await rewardPool.balanceOf(user.address)).to.not.equal(0);
      expect(await rewardPool.balanceOf(user1.address)).to.not.equal(0);

      // time passes
      await mine();
      await time.increase(rewardDuration * 2);
      await mine();

      // get the reward period
      const period = rewardDuration;

      // make sure the time has passed
      expect(await time.latest()).to.greaterThan(
        await rewardPool.periodFinish()
      );

      // the only user should get most rewards
      // there will be some dust in the contract
      await rewardPool.exit(lpTokenId);
      await rewardPool.connect(user1).exit(lpTokenId1);

      for (let i = 0; i < numRewardTokens; i++) {
        const rewardToken = rewardTokens[i];
        const rewardRate = await rewardPool.rewardRates(rewardToken.address);

        const userReward = await rewardToken.balanceOf(user.address);
        const userReward1 = await rewardToken.balanceOf(user1.address);

        const reward = rewardRate.mul(period).div(2);
        expect(userReward).to.approximately(reward, removePrecision);
        expect(userReward1).to.approximately(reward, removePrecision);
      }
    });
  });

  it("Two users who staked the same amount, but one later.", async function () {
    await collectionswap.approve(rewardPool.address, lpTokenId);
    await rewardPool.stake(lpTokenId);
    // The user should still be able to stake and see his stake
    expect(await rewardPool.balanceOf(user.address)).to.not.equal(0);

    const poolStartTime = (await rewardPool.lastUpdateTime()).toNumber();

    // time passes
    await mine();
    await time.increase(rewardDuration / 2);
    await mine();

    await collectionswap.connect(user1).approve(rewardPool.address, lpTokenId1);
    await rewardPool.connect(user1).stake(lpTokenId1);
    const user1StakeTime = await time.latest();
    expect(await rewardPool.balanceOf(user1.address)).to.not.equal(0);

    await mine();
    await time.increase(rewardDuration);
    await mine();

    // get the reward period
    const period = rewardDuration;
    const periodFinish = (await rewardPool.periodFinish()).toNumber();

    const phase1 = user1StakeTime - poolStartTime;
    const phase2 = periodFinish - user1StakeTime;

    // make sure the time has passed
    expect(await time.latest()).to.greaterThan(await rewardPool.periodFinish());

    // the only user should get most rewards
    // there will be some dust in the contract
    await rewardPool.exit(lpTokenId);
    await rewardPool.connect(user1).exit(lpTokenId1);

    for (let i = 0; i < numRewardTokens; i++) {
      const rewardToken = rewardTokens[i];
      const rewardRate = await rewardPool.rewardRates(rewardToken.address);

      const userReward = await rewardToken.balanceOf(user.address);
      const userReward1 = await rewardToken.balanceOf(user1.address);

      const reward1 = rewardRate.mul(phase2).div(2);
      const reward = rewardRate.mul(phase1).add(reward1);
      expect(userReward).to.approximately(reward, removePrecision);
      expect(userReward1).to.approximately(reward1, removePrecision);
    }
  });

  describe("Sweep", function () {
    it("should not allow non-deployer to sweep rewards", async function () {
      await expect(rewardPool.sweepRewards()).to.be.revertedWith(
        "Not authorized"
      );
    });

    it("should prevent deployer from sweeping rewards early", async function () {
      await expect(rewardPool.connect(owner).sweepRewards()).to.be.revertedWith(
        "Too early"
      );
      // set block timestamp to just before rewardSweepTime
      await time.setNextBlockTimestamp(
        (await rewardPool.rewardSweepTime()).sub(1)
      );
      await expect(rewardPool.connect(owner).sweepRewards()).to.be.revertedWith(
        "Too early"
      );
    });

    it("should allow deployer to sweep rewards", async function () {
      await time.setNextBlockTimestamp(await rewardPool.rewardSweepTime());
      for (let i = 0; i < numRewardTokens; i++) {
        const rewardToken = rewardTokens[i];
        await expect(
          rewardPool.connect(owner).sweepRewards()
        ).to.changeTokenBalance(
          rewardToken,
          owner.address,
          await rewardToken.balanceOf(rewardPool.address)
        );
      }
    });

    it("should revert if user tries to exit but successfully withdraw", async function () {
      await collectionswap.approve(rewardPool.address, lpTokenId);
      await rewardPool.stake(lpTokenId);
      await time.setNextBlockTimestamp(await rewardPool.rewardSweepTime());
      await rewardPool.connect(owner).sweepRewards();

      await expect(rewardPool.exit(lpTokenId)).to.be.revertedWith(
        "ERC20: transfer amount exceeds balance"
      );

      await rewardPool.withdraw(lpTokenId);
      expect(await collectionswap.ownerOf(lpTokenId)).to.equal(user.address);
      expect(await rewardPool.balanceOf(user.address)).to.equal(0);
    });
  });
});
