import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";

import {
  collectionswapFixture,
  erc20Fixture,
  erc721Fixture,
} from "./shared/fixtures";
import { getSigners } from "./shared/signers";

describe("Collectionstaker", function () {
  const numRewardTokens = 2;

  async function collectionstakerFixture() {
    const { collection, owner, protocol } = await getSigners();
    const { collectionswap, exponentialCurve } = await collectionswapFixture();
    const rewardTokens = (await erc20Fixture()).slice(0, numRewardTokens);
    const { erc721 } = await erc721Fixture();

    const rewards = [
      ethers.utils.parseEther("5"),
      ethers.utils.parseEther("7"),
    ];

    const Collectionstaker = await ethers.getContractFactory(
      "Collectionstaker"
    );
    const collectionstaker = await Collectionstaker.connect(collection).deploy(
      collectionswap.address
    );

    return {
      collectionstaker: collectionstaker.connect(protocol),
      exponentialCurve,
      rewardTokens,
      rewards,
      erc721,
      owner,
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
      const {
        collectionstaker,
        rewardTokens,
        rewards,
        erc721,
        exponentialCurve,
        owner,
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
        erc721.address,
        exponentialCurve.address,
        ethers.utils.parseEther("1.5"),
        ethers.BigNumber.from("200000000000000000"),
        rewardTokens.map((rewardToken) => rewardToken.address),
        rewards,
        startTime,
        endTime,
      );
    });
  });
});
