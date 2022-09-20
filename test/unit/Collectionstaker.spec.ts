import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";

import {
  collectionstakerFixture as _collectionstakerFixture,
  rewardTokenFixture,
  nftFixture,
} from "../shared/fixtures";
import { getSigners } from "../shared/signers";

describe("Collectionstaker", function () {
  const numRewardTokens = 2;

  async function collectionstakerFixture() {
    const { protocol } = await getSigners();
    const { collectionstaker, exponentialCurve } =
      await _collectionstakerFixture();
    const rewardTokens = (await rewardTokenFixture()).slice(0, numRewardTokens);
    const { nft } = await nftFixture();

    const rewards = [
      ethers.utils.parseEther("5"),
      ethers.utils.parseEther("7"),
    ];

    return {
      collectionstaker: collectionstaker.connect(protocol),
      exponentialCurve,
      rewardTokens,
      rewards,
      nft,
      protocol,
    };
  }

  describe("Deployment", function () {
    it("Should deploy", async function () {
      await loadFixture(collectionstakerFixture);
    });
  });

  describe("Incentive", function () {
    it("Should create a reward pool", async function () {
      const { owner } = await getSigners();
      const {
        collectionstaker,
        rewardTokens,
        rewards,
        nft,
        exponentialCurve,
        protocol,
      } = await loadFixture(collectionstakerFixture);

      for (let i = 0; i < numRewardTokens; i++) {
        const rewardToken = rewardTokens[i];
        const reward = rewards[i];

        await rewardToken.connect(owner).mint(protocol.address, reward);
        await rewardToken
          .connect(protocol)
          .approve(collectionstaker.address, reward);
      }

      const startTime = (await time.latest()) + 5; // buffer so that startTime > block.timestamp;
      const endTime = startTime + 86400;
      await collectionstaker.createIncentiveETH(
        nft.address,
        exponentialCurve.address,
        ethers.utils.parseEther("1.5"),
        ethers.BigNumber.from("200000000000000000"),
        rewardTokens.map((rewardToken) => rewardToken.address),
        rewards,
        startTime,
        endTime
      );
    });
  });
});
