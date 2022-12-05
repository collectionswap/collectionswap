import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { collectionstakerWithRewardsFixture } from "../shared/fixtures";
import { getSigners } from "../shared/signers";

describe("Collectionstaker", function () {
  describe("Deployment", function () {
    it("Should deploy", async function () {
      await loadFixture(collectionstakerWithRewardsFixture);
    });

    it("Should have the correct owner", async function () {
      const { collection, collectionstaker } = await loadFixture(
        collectionstakerWithRewardsFixture
      );
      expect(await collectionstaker.owner()).to.be.equal(collection.address);
    });
  });

  describe("Incentive", function () {
    it("Should create a reward pool", async function () {
      const { owner } = await getSigners();
      const {
        collectionstaker,
        monotonicIncreasingValidator,
        rewardTokens,
        rewards,
        nft,
        curve,
        protocol,
        numRewardTokens,
      } = await loadFixture(collectionstakerWithRewardsFixture);

      for (let i = 0; i < numRewardTokens; i++) {
        const rewardToken = rewardTokens[i];
        const reward = rewards[i];

        await rewardToken.connect(owner).mint(protocol.address, reward);
        await rewardToken
          .connect(protocol)
          .approve(collectionstaker.address, reward);
      }

      const startTime = (await time.latest()) + 5; // Buffer so that startTime > block.timestamp;
      const endTime = startTime + 86400;
      await collectionstaker.createIncentiveETH(
        monotonicIncreasingValidator.address,
        nft.address,
        curve.address,
        {
          spotPrice: 0,
          delta: ethers.utils.parseEther("1.5"),
          props: [],
          state: [],
        },
        ethers.BigNumber.from("200000000000000000"),
        ethers.constants.HashZero,
        rewardTokens.map((rewardToken) => rewardToken.address),
        rewards,
        startTime,
        endTime
      );
    });
  });
});
