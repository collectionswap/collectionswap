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
  collectionstakerFixture,
} from "../shared/fixtures";
import { createPairEth, mintNfts } from "../shared/helpers";
import { getSigners } from "../shared/signers";

import type {
  Collectionswap,
  ERC721PresetMinterPauserAutoId,
  ICurve,
  IERC20,
  IERC721,
  RewardPoolETH,
} from "../../typechain-types";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import type { BigNumberish } from "ethers";

async function getPoolAddress(tx: ContractTransaction, showGas = false) {
  const receipt = await tx.wait();
  if (showGas) {
    console.log("gas used:", receipt.cumulativeGasUsed);
  }

  // // Iterate through all events and try to find the one with a NewTokenId
  // for (let i = 0; i < receipt.events.length; i++) {
  //   console.log(i, receipt.events[i].args?.tokenId);
  // }

  const event = receipt.events!.find((event) => event.event === "Staked");
  expect(event).to.exist;
  const stakedTokenId = event!.args!.tokenId;

  const newPoolEvent = receipt.events?.find(
    (event) => event.event === "NewPair"
  );
  let newPairAddress = newPoolEvent?.args?.poolAddress;

  const newTokenId = receipt.events[8].args?.tokenId;

  expect(stakedTokenId).to.equal(newTokenId);

  if (!newPairAddress) {
    // Check event.topcs contains '0xf5bdc103c3e68a20d5f97d2d46792d3fdddfa4efeb6761f8141e6a7b936ca66c'
    const thisEvent = receipt.events?.find(
      (event) =>
        event.topics[0] ===
        "0xf5bdc103c3e68a20d5f97d2d46792d3fdddfa4efeb6761f8141e6a7b936ca66c"
    );
    expect(thisEvent).to.exist;
    // Get last 40 characters
    // newPairAddress = '0x' + thisEvent?.topics[1].slice(-40)
    newPairAddress = "0x" + thisEvent!.data.slice(-40);
  }

  return { newPairAddress, newTokenId };
}

describe("RewardPoolETH", function () {
  let collectionswap: Collectionswap;
  let allRewardTokens: IERC20[];
  let rewardTokens: IERC20[];
  let rewards: BigNumberish[];
  let lpTokenId: BigNumberish;
  let lpTokenId1: BigNumberish;
  let rewardPool: RewardPoolETH;
  let owner: SignerWithAddress;
  let user: SignerWithAddress;
  let user1: SignerWithAddress;
  let collection: SignerWithAddress;
  let nft: ERC721PresetMinterPauserAutoId;
  // Let nftTokenIds: BigNumberish[];
  let params: any;

  const numRewardTokens = 2;
  const dayDuration = 86400;
  // Removing the last few digits when comparing, since we have 18
  // so this should be fine
  const removePrecision = 1000000;

  const rewardDuration = dayDuration;

  beforeEach(async function () {
    ({
      collectionswap,
      allRewardTokens,
      rewardTokens,
      rewards,
      nft,
      // NftTokenIds,
      lpTokenId,
      lpTokenId1,
      rewardPool,
      owner,
      user,
      user1,
      collection,
      params,
    } = await loadFixture(rewardPoolFixture));
  });

  async function rewardPoolFixture() {
    const { owner, user, user1, collection } = await getSigners();

    // Let { collectionswap, curve } = await collectionswapFixture();
    let { collectionswap, curve, collectionstaker } =
      await collectionstakerFixture();
    const allRewardTokens = await rewardTokenFixture();
    const rewardTokens = allRewardTokens.slice(0, numRewardTokens);
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
    // EndTime = startTime - 1000
    // console.log(rewardTokens.map((rewardToken) => rewardToken.address))

    const RewardPool = await ethers.getContractFactory("RewardPoolETH");
    const rewardPoolAlone = await RewardPool.connect(
      collectionswap.signer
    ).deploy();
    // Console.log('xxx',collectionswap.address)
    // console.log(0);
    await expect(
      rewardPoolAlone.initialize(
        collection.address,
        owner.address,
        collectionswap.address,
        nft.address,
        curve.address,
        ethers.utils.parseEther("1.5"),
        ethers.BigNumber.from("200000000000000000"),
        rewardTokens.map((rewardToken) => rewardToken.address),
        rewardRates,
        startTime,
        endTime
      )
    ).to.be.revertedWith("Initializable: contract is already initialized");

    // Console.log(1);
    for (let i = 0; i < numRewardTokens; i++) {
      await rewardTokens[i].mint(owner.address, rewards[i]);
      await rewardTokens[i]
        .connect(owner)
        .approve(collectionstaker.address, rewards[i]);
    }

    // Console.log(2);

    const tx = await collectionstaker.connect(owner).createIncentiveETH(
      nft.address,
      curve.address,
      ethers.utils.parseEther("1.5"),
      ethers.BigNumber.from("200000000000000000"),
      rewardTokens.map((rewardToken) => rewardToken.address),
      rewards,
      startTime,
      endTime
    );
    const receipt = await tx.wait();
    const event = receipt.events?.find(
      (event) => event.event === "IncentiveETHCreated"
    );
    const rewardPoolAddress = event?.args?.poolAddress;
    console.log(rewardPoolAddress);
    let rewardPool = RewardPool.attach(rewardPoolAddress) as RewardPoolETH;

    const nftTokenIds = await mintNfts(nft, user.address);
    const nftTokenIds1 = await mintNfts(nft, user1.address);

    collectionswap = collectionswap.connect(user);
    nft = nft.connect(user);
    rewardPool = rewardPool.connect(user);

    const params = {
      bondingCurve: curve as unknown as ICurve,
      delta: ethers.utils.parseEther("1.5"),
      fee: ethers.BigNumber.from("200000000000000000"),
      spotPrice: ethers.BigNumber.from("16493775933609955"),
      value: ethers.utils.parseEther("2"),
    };

    const { lpTokenId } = await createPairEth(collectionswap, {
      ...params,
      nft: nft as unknown as IERC721,
      nftTokenIds,
    });

    const { lpTokenId: lpTokenId1 } = await createPairEth(
      collectionswap.connect(user1),
      {
        ...params,
        nft: nft.connect(user1) as unknown as IERC721,
        nftTokenIds: nftTokenIds1,
      }
    );

    return {
      collectionswap,
      allRewardTokens,
      rewardTokens,
      rewards,
      nft,
      nftTokenIds,
      curve,
      lpTokenId,
      lpTokenId1,
      rewardPool,
      owner,
      user,
      user1,
      collection,
      params,
    };
  }

  describe("Deployment", function () {
    it("Should deploy", async function () {
      await loadFixture(rewardPoolFixture);
    });
  });

  describe("Initialize", function () {
    it("Should throw if initialize twice", async function () {
      const { nft } = await nftFixture();
      const { collectionswap, curve } = await collectionswapFixture();
      const rewards = [
        ethers.utils.parseEther("5"),
        ethers.utils.parseEther("7"),
      ];
      const startTime = (await time.latest()) + 1000;
      const endTime = startTime + rewardDuration;
      const rewardRates = rewards.map((reward) =>
        reward.div(endTime - startTime)
      );
      await expect(
        rewardPool.initialize(
          collection.address,
          owner.address,
          collectionswap.address,
          nft.address,
          curve.address,
          ethers.utils.parseEther("1.5"),
          ethers.BigNumber.from("200000000000000000"),
          rewardTokens.map((rewardToken) => rewardToken.address),
          rewardRates,
          startTime,
          endTime
        )
      ).to.be.revertedWith("Initializable: contract is already initialized");
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
      await collectionswap.connect(user).approve(rewardPool.address, lpTokenId);
      await rewardPool.connect(user).stake(lpTokenId);

      // Mine to after rewards finish
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

      // Mine to before rewards start
      await time.setNextBlockTimestamp(await rewardPool.lastUpdateTime());
      await rewardPool.exit(lpTokenId);
      for (let i = 0; i < numRewardTokens; i++) {
        expect(await rewardTokens[i].balanceOf(user.address)).to.equal(0);
      }
    });

    it("Should get reward after staking", async function () {
      await collectionswap.approve(rewardPool.address, lpTokenId);
      await rewardPool.stake(lpTokenId);

      // Mine to after start time
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

      // Time passes
      await time.increase(300);
      const startingBlock = await time.latestBlock();
      const endBlock = startingBlock + 100;
      await mineUpTo(endBlock);

      // But there's no reward after exit.
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

      // Time passes
      await mine();
      await time.increase(2 * rewardDuration);
      await mine();

      // Get the reward period
      const period = rewardDuration;

      // Make sure the time has passed
      expect(await time.latest()).to.greaterThan(
        await rewardPool.periodFinish()
      );

      // The only user should get most rewards
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

      // Time passes
      await mine();
      await time.increase(rewardDuration * 2);
      await mine();

      // Get the reward period
      const period = rewardDuration;

      // Make sure the time has passed
      expect(await time.latest()).to.greaterThan(
        await rewardPool.periodFinish()
      );

      // The only user should get most rewards
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

    // Time passes
    await mine();
    await time.increase(rewardDuration / 2);
    await mine();

    await collectionswap.connect(user1).approve(rewardPool.address, lpTokenId1);
    await rewardPool.connect(user1).stake(lpTokenId1);
    const user1StakeTime = await time.latest();

    await mine();
    await time.increase(rewardDuration);
    await mine();

    // Get the reward period
    const periodFinish = (await rewardPool.periodFinish()).toNumber();

    const phase1 = user1StakeTime - poolStartTime;
    const phase2 = periodFinish - user1StakeTime;

    // Make sure the time has passed
    expect(await time.latest()).to.greaterThan(await rewardPool.periodFinish());

    // The only user should get most rewards
    // there will be some dust in the contract
    // await rewardPool.connect(owner).exit(lpTokenId);
    await expect(rewardPool.connect(user1).exit(lpTokenId)).to.be.revertedWith(
      "Not owner"
    );
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

  describe("Recharging the pool", function () {
    for (let extra = 1; extra <= 1; extra++) {
      it(`Recharge the pool with 2+${extra} same tokens (from 0 index) should fail due to bad config (from collection AKA protocol owner)`, async function () {
        await collectionswap.approve(rewardPool.address, lpTokenId);
        await rewardPool.stake(lpTokenId);
        const startIndex = 0;
        const lengthTokens = extra;
        const endIndex = startIndex + lengthTokens;
        const otherRewardTokens = allRewardTokens.slice(startIndex, endIndex);
        // Console.log(otherRewardTokens.map(token => token.address))
        const newRewardAmount = ethers.utils.parseEther("69");
        const newRewardsList = [];
        for (let i = startIndex; i < endIndex; i++) {
          const rewardToken = allRewardTokens[i];
          newRewardsList.push(newRewardAmount);
          // @ts-ignore
          await rewardToken.mint(collection.address, newRewardAmount);
          await rewardToken
            .connect(collection)
            .approve(rewardPool.address, newRewardAmount);
        }

        const otherRewards = otherRewardTokens.map((_) =>
          ethers.utils.parseEther("69")
        );
        await mine();
        await time.increase(rewardDuration * 2);
        await mine();
        expect(await time.latest()).to.greaterThan(
          await rewardPool.periodFinish()
        );
        const newEndTime = (await time.latest()) + 1000 + rewardDuration;
        await expect(
          rewardPool.connect(collection).rechargeRewardPool(
            otherRewardTokens.map((token) => token.address),
            otherRewards,
            newEndTime
          )
        ).to.be.revertedWith("Bad token config");
      });
    }

    for (let extra = 2; extra <= 5; extra++) {
      it(`Recharge the pool with 2+${extra} same tokens (from 0 index) should succeed (from collection AKA protocol owner)`, async function () {
        await collectionswap.approve(rewardPool.address, lpTokenId);
        await rewardPool.stake(lpTokenId);
        const startIndex = 0;
        const lengthTokens = extra;
        const endIndex = startIndex + lengthTokens;
        const otherRewardTokens = allRewardTokens.slice(startIndex, endIndex);
        // Console.log(otherRewardTokens.map(token => token.address))
        const newRewardAmount = ethers.utils.parseEther("69");
        const newRewardsList = [];
        for (let i = startIndex; i < endIndex; i++) {
          const rewardToken = allRewardTokens[i];
          newRewardsList.push(newRewardAmount);
          // @ts-ignore
          await rewardToken.mint(collection.address, newRewardAmount);
          await rewardToken
            .connect(collection)
            .approve(rewardPool.address, newRewardAmount);
        }

        const otherRewards = otherRewardTokens.map((_) =>
          ethers.utils.parseEther("69")
        );
        await mine();
        await time.increase(rewardDuration * 2);
        await mine();
        expect(await time.latest()).to.greaterThan(
          await rewardPool.periodFinish()
        );
        const newEndTime = (await time.latest()) + 1000 + rewardDuration;

        await rewardPool.connect(collection).rechargeRewardPool(
          otherRewardTokens.map((token) => token.address),
          otherRewards,
          newEndTime
        );

        // Concat rewards and tokens
        const expectedRewardTokens = [];
        // Get the max of rewards.length and lengthTokens
        for (let i = 0; i < Math.max(rewards.length, lengthTokens); i++) {
          let n = ethers.utils.parseEther("0");
          if (i < rewards.length) {
            n = n.add(rewards[i]);
          }

          if (i < lengthTokens) {
            n = n.add(newRewardsList[i]);
          }

          expectedRewardTokens.push(n);
        }

        await mine();
        await time.increase(rewardDuration * 2);
        await mine();
        await rewardPool.getReward();
        for (let i = 0; i < expectedRewardTokens.length; i++) {
          // Console.log(await allRewardTokens[i].balanceOf(user.address))
          // console.log(expectedRewardTokens[i])
          expect(
            await allRewardTokens[i].balanceOf(user.address)
          ).to.approximately(expectedRewardTokens[i], removePrecision);
          // Console.log(await rewardTokens(i))
          // try { console.log(await rewardPool.rewardTokens(i)) } catch (error) {}
        }
      });
    }

    for (let extra = 2; extra <= 5; extra++) {
      it(`Recharge the pool with 2+${extra} same tokens (from 0 index) should succeed (from pool deployer)`, async function () {
        for (let i = 0; i < 5; i++) {
          // Try { console.log(await rewardPool.rewardTokens(i)) } catch (error) {}
        }

        await collectionswap.approve(rewardPool.address, lpTokenId);
        await rewardPool.stake(lpTokenId);
        const startIndex = 0;
        const lengthTokens = extra;
        const endIndex = startIndex + lengthTokens;
        const otherRewardTokens = allRewardTokens.slice(startIndex, endIndex);
        // Console.log(otherRewardTokens.map(token => token.address))
        const newRewardAmount = ethers.utils.parseEther("69");
        const newRewardsList = [];
        for (let i = startIndex; i < endIndex; i++) {
          const rewardToken = allRewardTokens[i];
          newRewardsList.push(newRewardAmount);
          // @ts-ignore
          await rewardToken.mint(owner.address, newRewardAmount);
          await rewardToken.approve(rewardPool.address, newRewardAmount);
        }

        const otherRewards = otherRewardTokens.map((_) =>
          ethers.utils.parseEther("69")
        );
        await mine();
        await time.increase(rewardDuration * 2);
        await mine();
        expect(await time.latest()).to.greaterThan(
          await rewardPool.periodFinish()
        );
        const newEndTime = (await time.latest()) + 1000 + rewardDuration;
        // Console.log(otherRewardTokens.map(token => token.address))
        await rewardPool.connect(owner).rechargeRewardPool(
          otherRewardTokens.map((token) => token.address),
          otherRewards,
          newEndTime
        );
        // Concat rewards and tokens
        const expectedRewardTokens = [];
        // Get the max of rewards.length and lengthTokens
        for (let i = 0; i < Math.max(rewards.length, lengthTokens); i++) {
          let n = ethers.utils.parseEther("0");
          if (i < rewards.length) {
            n = n.add(rewards[i]);
          }

          if (i < lengthTokens) {
            n = n.add(newRewardsList[i]);
          }

          expectedRewardTokens.push(n);
        }

        // Console.log(expectedRewardTokens);

        await mine();
        await time.increase(rewardDuration * 2);
        await mine();
        await rewardPool.getReward();
        for (let i = 0; i < expectedRewardTokens.length; i++) {
          // Console.log(await allRewardTokens[i].balanceOf(user.address))
          // console.log(expectedRewardTokens[i])
          expect(
            await allRewardTokens[i].balanceOf(user.address)
          ).to.approximately(expectedRewardTokens[i], removePrecision);
          // Console.log(await rewardTokens(i))
          // try { console.log(await rewardPool.rewardTokens(i)) } catch (error) {}
        }
      });
    }

    // MAX_REWARD_TOKENS capped at 5
    // for (let extra = 6; extra <= 10; extra++) {
    //   it(`Recharge the pool with 2+${extra} same tokens (from 0 index) should fail`, async function () {
    //     for (let i = 0; i < 5; i++) {
    //       // Try { console.log(await rewardPool.rewardTokens(i)) } catch (error) {}
    //     }

    //     await collectionswap.approve(rewardPool.address, lpTokenId);
    //     await rewardPool.stake(lpTokenId);
    //     const startIndex = 0;
    //     const lengthTokens = extra;
    //     const endIndex = startIndex + lengthTokens;
    //     const otherRewardTokens = allRewardTokens.slice(startIndex, endIndex);
    //     const newRewardAmount = ethers.utils.parseEther("69");
    //     const newRewardsList = [];
    //     for (let i = startIndex; i < endIndex; i++) {
    //       const rewardToken = allRewardTokens[i];
    //       newRewardsList.push(newRewardAmount);
    //       // @ts-ignore
    //       await rewardToken.mint(owner.address, newRewardAmount);
    //       await rewardToken.approve(rewardPool.address, newRewardAmount);
    //     }

    //     const otherRewards = otherRewardTokens.map((_) =>
    //       ethers.utils.parseEther("69")
    //     );
    //     await mine();
    //     await time.increase(rewardDuration * 2);
    //     await mine();
    //     expect(await time.latest()).to.greaterThan(
    //       await rewardPool.periodFinish()
    //     );
    //     const newEndTime = (await time.latest()) + 1000 + rewardDuration;
    //     // Console.log(otherRewardTokens.map(token => token.address))
    //     await expect(
    //       rewardPool.connect(owner).rechargeRewardPool(
    //         otherRewardTokens.map((token) => token.address),
    //         otherRewards,
    //         newEndTime
    //       )
    //     ).to.be.revertedWith("Exceed max tokens");
    //   });
    // }

    it(`Duplicate reward tokens are not allowed`, async function () {
      for (let i = 0; i < 5; i++) {
        // Try { console.log(await rewardPool.rewardTokens(i)) } catch (error) {}
      }

      const extra = 3;
      await collectionswap.approve(rewardPool.address, lpTokenId);
      await rewardPool.stake(lpTokenId);
      const startIndex = 0;
      const lengthTokens = extra;
      const endIndex = startIndex + lengthTokens;
      let otherRewardTokens = allRewardTokens.slice(startIndex, endIndex);
      otherRewardTokens = otherRewardTokens
        .slice(0, extra - 1)
        .concat([otherRewardTokens[1]]);
      // Console.log(otherRewardTokens.map(token => token.address))
      // console.log(otherRewardTokens.length)

      const newRewardAmount = ethers.utils.parseEther("69");
      const newRewardsList = [];
      for (let i = startIndex; i < endIndex; i++) {
        const rewardToken = allRewardTokens[i];
        newRewardsList.push(newRewardAmount);
        // @ts-ignore
        await rewardToken.mint(owner.address, newRewardAmount.mul(2));
        await rewardToken.approve(rewardPool.address, newRewardAmount.mul(2));
      }

      const otherRewards = otherRewardTokens.map((_) =>
        ethers.utils.parseEther("69")
      );
      await mine();
      await time.increase(rewardDuration * 2);
      await mine();
      expect(await time.latest()).to.greaterThan(
        await rewardPool.periodFinish()
      );
      const newEndTime = (await time.latest()) + 1000 + rewardDuration;
      // Console.log(otherRewardTokens.map(token => token.address))
      await expect(
        rewardPool.connect(owner).rechargeRewardPool(
          otherRewardTokens.map((token) => token.address),
          otherRewards,
          newEndTime
        )
      ).to.be.revertedWith("Repeated token");
    });

    it("Recharge the pool halfway should fail", async function () {
      await collectionswap.approve(rewardPool.address, lpTokenId);
      await rewardPool.stake(lpTokenId);

      const poolStartTime = (await rewardPool.lastUpdateTime()).toNumber();
      const endTime = (await rewardPool.periodFinish()).toNumber();
      // Time passes
      await mine();
      await time.increase(rewardDuration / 2);
      await mine();
      // Assuming a 50% time extension at halftime, with 1.5 times the original tokens.
      // so the remaining time has 2x the token rate
      // at original endTime, we should have 150% of what we expect

      const midPoint = await time.latest();
      // Need to updateReward? via getReward()???
      await rewardPool.connect(owner).getReward();
      // Console.log('debug',midPoint,await rewardPool.lastUpdateTime())
      const fractionElapsed = (midPoint - poolStartTime) / rewardDuration;
      // Console.log('fraction elapsed', fractionElapsed,(midPoint - poolStartTime));

      const newEndTime = endTime + (endTime - poolStartTime) / 2;
      const additionalRewardQuantum = 2.5;
      const expectedEndAmount =
        (0.5 + additionalRewardQuantum) / 2 + fractionElapsed;
      const additionalRewards = rewards.map((reward) =>
        reward
          // @ts-ignore
          .mul(ethers.utils.parseEther(additionalRewardQuantum.toString()))
          .div(ethers.utils.parseEther("1"))
      );
      rewards.map((reward) =>
        reward
          // @ts-ignore
          .mul(ethers.utils.parseEther(expectedEndAmount.toString()))
          .div(ethers.utils.parseEther("1"))
      );

      for (let i = 0; i < numRewardTokens; i++) {
        const rewardToken = rewardTokens[i];

        // @ts-ignore
        await rewardToken.mint(owner.address, additionalRewards[i]);
        await rewardTokens[i].approve(rewardPool.address, additionalRewards[i]);
      }

      // Get rewardRates

      const phase1Rewards = [];
      for (const rewardToken of rewardTokens) {
        const rewardRates = await rewardPool.rewardRates(rewardToken.address);
        // Console.log('reward rate', rewardRates.toString());
        phase1Rewards.push(rewardRates.mul(midPoint - poolStartTime));
      }

      // Recharge the pool
      await expect(
        rewardPool.connect(owner).rechargeRewardPool(
          rewardTokens.map((token) => token.address),
          additionalRewards,
          newEndTime
        )
      ).to.be.revertedWith("Ongoing rewards");
    });

    it("Recharge: Two users who staked the same amount, both claim at end of first epoch. ", async function () {
      await collectionswap.approve(rewardPool.address, lpTokenId);
      await rewardPool.stake(lpTokenId);

      await collectionswap
        .connect(user1)
        .approve(rewardPool.address, lpTokenId1);
      await rewardPool.connect(user1).stake(lpTokenId1);

      await mine();
      await time.increase(rewardDuration * 2);
      await mine();

      await rewardPool.getReward();
      await rewardPool.connect(user1).getReward();

      await Promise.all(
        rewardTokens.map(async (token) => token.balanceOf(rewardPool.address))
      );

      // Iterate through reward tokens and mint a bit more

      const newRewardAmount = ethers.utils.parseEther("69");
      for (let i = 0; i < numRewardTokens; i++) {
        const rewardToken = rewardTokens[i];
        // @ts-ignore
        await rewardToken.mint(owner.address, newRewardAmount);
        await rewardTokens[i].approve(rewardPool.address, newRewardAmount);
      }

      // Recharge the pool
      const newEndTime = (await time.latest()) + 1000 + rewardDuration;
      // Balances before, map through rewardtokens
      await Promise.all(
        rewardTokens.map(async (token) => token.balanceOf(rewardPool.address))
      );
      await rewardPool.connect(owner).rechargeRewardPool(
        rewardTokens.map((token) => token.address),
        rewardTokens.map((_) => newRewardAmount),
        newEndTime
      );

      const userBalanceBefore = [];
      for (const thisUser of [user, user1]) {
        userBalanceBefore.push(
          await Promise.all(
            rewardTokens.map(async (token) => token.balanceOf(thisUser.address))
          )
        );
      }

      await mine();
      await time.increase(rewardDuration / 2);
      await mine();

      // Do fucky stuff
      expect(await time.latest()).to.lessThan(await rewardPool.periodFinish());
      await rewardPool.connect(user).getReward();
      await rewardPool.connect(user1).getReward();

      await mine();
      await time.increase(rewardDuration * 2);
      await mine();

      for (const thisUser of [user, user1]) {
        // Console.log('user',thisUser.address)

        // get balances before
        // const balancesBefore = await Promise.all(
        //   rewardTokens.map((token) => token.balanceOf(thisUser.address))
        // );
        const balancesBefore =
          userBalanceBefore[[user, user1].indexOf(thisUser)];

        await rewardPool.connect(thisUser).getReward();

        // Get balances after
        const balancesAfter = await Promise.all(
          rewardTokens.map(async (token) => token.balanceOf(thisUser.address))
        );

        // Balances after, map through rewardtokens
        for (let i = 0; i < numRewardTokens; i++) {
          const diff = balancesAfter[i].sub(balancesBefore[i]);
          const expectedAmount = newRewardAmount.div(2);

          // // user1 did not claim, expect him to get it by the end of next epoch
          // if (thisUser.address === user1.address) {
          //   expectedAmount = expectedAmount.add(rewardTokenPoolBalancePrevEpoch[i])
          // }

          // console.log('diff',rewardTokens[i].address,diff,balancesAfter[i],balancesBefore[i],(newRewardAmount.div(2)),(newRewardAmount.div(2)).add(rewardTokenPoolBalancePrevEpoch[i]))
          expect(diff).to.approximately(expectedAmount, removePrecision);
        }
      }
    });

    it("Recharge: Two users who staked the same amount, both did not claim at end of first epoch. ", async function () {
      await collectionswap.approve(rewardPool.address, lpTokenId);
      await rewardPool.stake(lpTokenId);

      await collectionswap
        .connect(user1)
        .approve(rewardPool.address, lpTokenId1);
      await rewardPool.connect(user1).stake(lpTokenId1);

      await mine();
      await time.increase(rewardDuration * 2);
      await mine();

      // Await rewardPool.getReward();
      // await rewardPool.connect(user1).getReward();

      const rewardTokenPoolBalancePrevEpoch = await Promise.all(
        rewardTokens.map(async (token) => token.balanceOf(rewardPool.address))
      );

      // Console.log(rewardTokenPoolBalancePrevEpoch)

      // iterate through reward tokens and mint a bit more

      const newRewardAmount = ethers.utils.parseEther("69");
      for (let i = 0; i < numRewardTokens; i++) {
        const rewardToken = rewardTokens[i];
        // @ts-ignore
        await rewardToken.mint(owner.address, newRewardAmount);
        await rewardTokens[i].approve(rewardPool.address, newRewardAmount);
      }

      // Recharge the pool
      const newEndTime = (await time.latest()) + 1000 + rewardDuration;
      // Balances before, map through rewardtokens
      await Promise.all(
        rewardTokens.map(async (token) => token.balanceOf(rewardPool.address))
      );
      // Console.log(rewardTokens.map((token) => token.address))
      // console.log(rewardTokens.map((token) => newRewardAmount))
      // console.log(newEndTime)
      await rewardPool.connect(owner).rechargeRewardPool(
        rewardTokens.map((token) => token.address),
        rewardTokens.map((_) => newRewardAmount),
        newEndTime
      );

      const userBalanceBefore = [];
      for (const thisUser of [user, user1]) {
        userBalanceBefore.push(
          await Promise.all(
            rewardTokens.map(async (token) => token.balanceOf(thisUser.address))
          )
        );
      }

      await mine();
      await time.increase(rewardDuration / 2);
      await mine();

      // Do fucky stuff
      expect(await time.latest()).to.lessThan(await rewardPool.periodFinish());
      await rewardPool.connect(user).getReward();
      await rewardPool.connect(user1).getReward();

      await mine();
      await time.increase(rewardDuration * 2);
      await mine();

      for (const thisUser of [user, user1]) {
        // Console.log('user',thisUser.address)

        // get balances before
        const balancesBefore =
          userBalanceBefore[[user, user1].indexOf(thisUser)];

        await rewardPool.connect(thisUser).getReward();

        // Get balances after
        const balancesAfter = await Promise.all(
          rewardTokens.map(async (token) => token.balanceOf(thisUser.address))
        );

        // Balances after, map through rewardtokens
        for (let i = 0; i < numRewardTokens; i++) {
          const diff = balancesAfter[i].sub(balancesBefore[i]);
          let expectedAmount = newRewardAmount.div(2);

          // Both users did not claim, expect him to get it by the end of next epoch
          expectedAmount = expectedAmount.add(
            rewardTokenPoolBalancePrevEpoch[i].div(2)
          );

          // Console.log('diff',rewardTokens[i].address,diff,balancesAfter[i],balancesBefore[i],(newRewardAmount.div(2)),(newRewardAmount.div(2)).add(rewardTokenPoolBalancePrevEpoch[i]))
          expect(diff).to.approximately(expectedAmount, removePrecision);
        }
      }
    });

    it("Recharge: Two users who staked the same amount, one didn't claim at end of first epoch. He gets the token balance he didn't claim at the end of next epoch.", async function () {
      await collectionswap.approve(rewardPool.address, lpTokenId);
      await rewardPool.stake(lpTokenId);
      // The user should still be able to stake and see his stake
      expect(await rewardPool.balanceOf(user.address)).to.not.equal(0);

      const poolStartTime = (await rewardPool.lastUpdateTime()).toNumber();

      // Time passes
      await mine();
      await time.increase(rewardDuration / 2);
      await mine();

      await collectionswap
        .connect(user1)
        .approve(rewardPool.address, lpTokenId1);
      await rewardPool.connect(user1).stake(lpTokenId1);
      const user1StakeTime = await time.latest();
      expect(await rewardPool.balanceOf(user1.address)).to.not.equal(0);

      await mine();
      await time.increase(rewardDuration);
      await mine();

      // Get the reward period
      const periodFinish = (await rewardPool.periodFinish()).toNumber();

      const phase1 = user1StakeTime - poolStartTime;
      const phase2 = periodFinish - user1StakeTime;

      // Make sure the time has passed
      expect(await time.latest()).to.greaterThan(
        await rewardPool.periodFinish()
      );

      // The only user should get most rewards
      // there will be some dust in the contract
      await rewardPool.getReward();
      //   Await rewardPool.connect(user1).getReward();

      for (let i = 0; i < numRewardTokens; i++) {
        const rewardToken = rewardTokens[i];
        const rewardRate = await rewardPool.rewardRates(rewardToken.address);
        const userReward = await rewardToken.balanceOf(user.address);
        const reward1 = rewardRate.mul(phase2).div(2);
        const reward = rewardRate.mul(phase1).add(reward1);
        expect(userReward).to.approximately(reward, removePrecision);
        // Expect(userReward1).to.approximately(reward1, removePrecision);
      }

      // Get balances
      const rewardTokenPoolBalancePrevEpoch = await Promise.all(
        rewardTokens.map(async (token) => token.balanceOf(rewardPool.address))
      );
      // Console.log(rewardTokenPoolBalancePrevEpoch)

      // iterate through reward tokens and mint a bit more

      const newRewardAmount = ethers.utils.parseEther("69");
      for (let i = 0; i < numRewardTokens; i++) {
        const rewardToken = rewardTokens[i];
        // @ts-ignore
        await rewardToken.mint(owner.address, newRewardAmount);
        await rewardTokens[i].approve(rewardPool.address, newRewardAmount);
      }

      // Recharge the pool
      const newEndTime = (await time.latest()) + 1000 + rewardDuration;

      await expect(
        rewardPool.connect(user).rechargeRewardPool(
          rewardTokens.map((token) => token.address),
          rewardTokens.map((_) => newRewardAmount),
          newEndTime
        )
      ).to.be.revertedWith("Not authorized");

      // Balances before, map through rewardtokens
      const balancesBefore = await Promise.all(
        rewardTokens.map(async (token) => token.balanceOf(rewardPool.address))
      );

      await rewardPool.connect(owner).rechargeRewardPool(
        rewardTokens.map((token) => token.address),
        rewardTokens.map((_) => newRewardAmount),
        newEndTime
      );

      const balancesAfter = await Promise.all(
        rewardTokens.map(async (token) => token.balanceOf(rewardPool.address))
      );

      // Balances after, map through rewardtokens
      for (let i = 0; i < numRewardTokens; i++) {
        expect(balancesAfter[i]).to.equal(
          balancesBefore[i].add(newRewardAmount)
        );
        // Console.log(rewardTokens[i].address,balancesAfter[i],balancesBefore[i],(newRewardAmount))
      }

      const userBalanceBefore = [];
      for (const thisUser of [user, user1]) {
        userBalanceBefore.push(
          await Promise.all(
            rewardTokens.map(async (token) => token.balanceOf(thisUser.address))
          )
        );
      }

      await mine();
      await time.increase(rewardDuration / 2);
      await mine();

      // Do fucky stuff
      expect(await time.latest()).to.lessThan(await rewardPool.periodFinish());
      await rewardPool.connect(user).getReward();
      // Await rewardPool.connect(user1).getReward();

      await mine();
      await time.increase(rewardDuration * 2);
      await mine();
      // Make sure the time has passed
      expect(await time.latest()).to.greaterThan(
        await rewardPool.periodFinish()
      );

      for (const thisUser of [user, user1]) {
        // Console.log('user',thisUser.address)

        // get balances before
        const balancesBefore =
          userBalanceBefore[[user, user1].indexOf(thisUser)];
        await rewardPool.connect(thisUser).getReward();

        // Get balances after
        const balancesAfter = await Promise.all(
          rewardTokens.map(async (token) => token.balanceOf(thisUser.address))
        );

        // Balances after, map through rewardtokens
        for (let i = 0; i < numRewardTokens; i++) {
          const diff = balancesAfter[i].sub(balancesBefore[i]);
          let expectedAmount = newRewardAmount.div(2);

          // User1 did not claim, expect him to get it by the end of next epoch
          if (thisUser.address === user1.address) {
            expectedAmount = expectedAmount.add(
              rewardTokenPoolBalancePrevEpoch[i]
            );
          }

          // Console.log('diff',rewardTokens[i].address,diff,balancesAfter[i],balancesBefore[i],(newRewardAmount.div(2)),(newRewardAmount.div(2)).add(rewardTokenPoolBalancePrevEpoch[i]))
          expect(diff).to.approximately(expectedAmount, removePrecision);
        }
      }

      // // iterate through rewardTokens, check pool balance
      //   for (let i = 0; i < numRewardTokens; i++) {
      //       const rewardToken = rewardTokens[i];
      //       // const poolBalance = await rewardToken.balanceOf(rewardPool.address);
      //       console.log('token',rewardToken.address,
      //           await rewardToken.balanceOf(rewardPool.address), // pool balance
      //           await rewardToken.balanceOf(owner.address),
      //           await rewardToken.balanceOf(user.address),
      //           await rewardToken.balanceOf(user1.address),

      //       )
      //       // expect(poolBalance).to.equal(newRewardAmount.div(2));
      //   }
    });
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
      // Set block timestamp to just before rewardSweepTime
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
        // Console.log(
        //   rewardToken.address,
        //   owner.address,
        //   await rewardToken.balanceOf(rewardPool.address)
        // );
        const expectedChange = await rewardToken.balanceOf(rewardPool.address);

        await expect(
          rewardPool.connect(owner).sweepRewards()
        ).to.changeTokenBalance(rewardToken, owner.address, expectedChange);
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

  describe("Atomic transactions", function () {
    it("Atomic entry, piecemeal exit", async function () {
      //   Await nft.connect(user).setApprovalForAll(rewardPool.address, true);

      // console.log(1);
      const newNftTokenIds = await mintNfts(nft.connect(owner), user.address);
      await nft.connect(user).setApprovalForAll(collectionswap.address, true);
      // Console.log(nft.address);
      // console.log(collectionswap.address);
      // console.log(rewardPool.address);
      // console.log(2);
      await collectionswap
        .connect(user)
        .setApprovalForAll(rewardPool.address, true);
      // Console.log(3);
      const currTokenIdTx = await rewardPool
        .connect(user)
        .atomicPoolAndVault(
          nft.address,
          params.bondingCurve.address,
          params.delta,
          params.fee,
          params.spotPrice,
          newNftTokenIds,
          { value: params.value }
        );
      // Console.log(4);
      const currTokenIdResp = await currTokenIdTx.wait();
      expect(currTokenIdResp.events).to.exist;
      const currTokenIdEvent = currTokenIdResp
        .events!.map((event) => {
          try {
            return collectionswap.interface.parseLog(event);
          } catch (e) {
            return null;
          }
        })
        .find(
          (description) => description && description.name === "NewTokenId"
        );
      expect(currTokenIdEvent).to.exist;
      const currTokenId = currTokenIdEvent!.args.tokenId;

      await rewardPool.exit(currTokenId);
      await collectionswap.useLPTokenToDestroyDirectPairETH(currTokenId);
    });

    it("Atomic entry, atomic exit", async function () {
      //   Await nft.connect(user).setApprovalForAll(rewardPool.address, true);
      const newNftTokenIds = await mintNfts(nft.connect(owner), user.address);
      await nft.connect(user).setApprovalForAll(collectionswap.address, true);
      await collectionswap
        .connect(user)
        .setApprovalForAll(rewardPool.address, true);
      const currTokenIdTx = await rewardPool
        .connect(user)
        .atomicPoolAndVault(
          nft.address,
          params.bondingCurve.address,
          params.delta,
          params.fee,
          params.spotPrice,
          newNftTokenIds,
          { value: params.value }
        );

      //   Console.log("nft.ownerOf", await nft.ownerOf(nftTokenIds[0]));

      const { newPairAddress, newTokenId } = await getPoolAddress(
        currTokenIdTx
      );
      console.log(newPairAddress, newTokenId);
      expect((await nft.ownerOf(newNftTokenIds[0])).toLowerCase()).to.equal(
        newPairAddress.toLowerCase()
      );
      const currTokenId = newTokenId;

      await expect(
        rewardPool.atomicExitAndUnpool(currTokenId)
      ).to.changeEtherBalances(
        [user, newPairAddress],
        [params.value, params.value.mul(-1)]
      );

      // Check for each nftTokenIds, user owns them
      for (let i = 0; i < newNftTokenIds.length; i++) {
        expect(await nft.ownerOf(newNftTokenIds[i])).to.equal(user.address);
      }
    });
  });
});
