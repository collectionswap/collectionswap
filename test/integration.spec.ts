import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import {
  collectionstakerFixture,
  nftFixture,
  rewardTokenFixture,
} from "./shared/fixtures";
import { createIncentiveEth, createPairEth, mintNfts } from "./shared/helpers";
import { getSigners } from "./shared/signers";

import type { ICurve, IERC721 } from "../typechain-types";

describe("integration", function () {
  // removing the last few digits when comparing, since we have 18
  // so this should be fine
  const removePrecision = 1000000;

  const numRewardTokens = 2;

  async function integrationFixture() {
    const { owner, protocol, user } = await getSigners();
    const { collectionswap, collectionstaker, exponentialCurve } =
      await collectionstakerFixture();
    const rewardTokens = (await rewardTokenFixture()).slice(0, numRewardTokens);
    const rewards = [
      ethers.utils.parseEther("3.14159"),
      ethers.utils.parseEther("2.71828"),
    ];
    const { nft } = await nftFixture();

    for (let i = 0; i < numRewardTokens; i++) {
      await rewardTokens[i].mint(protocol.address, rewards[i]);
    }

    return {
      collectionswap: collectionswap.connect(user),
      collectionstaker: collectionstaker.connect(protocol),
      exponentialCurve: exponentialCurve as unknown as ICurve,
      rewardTokens: rewardTokens.map((rewardToken) =>
        rewardToken.connect(protocol)
      ),
      rewards,
      nft,
      owner,
      protocol,
      user,
    };
  }
  it("Should integrate", async function () {
    const {
      collectionswap,
      collectionstaker,
      exponentialCurve,
      rewardTokens,
      rewards,
      nft,
      owner,
      protocol,
      user,
    } = await loadFixture(integrationFixture);

    const initialNftTokenIds = await mintNfts(nft, user.address);
    const initialETH = ethers.utils.parseEther("5");

    // user should have the eth and nfts
    expect(
      await ethers.provider.getBalance(user.address)
    ).to.greaterThanOrEqual(initialETH);
    for (const nftTokenId of initialNftTokenIds) {
      expect(await nft.ownerOf(nftTokenId)).to.equal(user.address);
    }

    let prevBalance = await user.getBalance();
    const delta = ethers.utils.parseEther("1.05");
    const fee = ethers.utils.parseEther("0.01");
    const params = {
      nft: nft.connect(user),
      bondingCurve: exponentialCurve,
      delta,
      fee,
    };
    const result = await createPairEth(collectionswap, {
      ...params,
      spotPrice: ethers.utils.parseEther("25"),
      nftTokenIds: initialNftTokenIds,
      value: initialETH,
    });
    const { lpTokenId, pairAddress } = result;
    let dBalance = result.dBalance;

    // user decrease in eth should be equal to eth deposited
    expect(prevBalance.sub(await user.getBalance()).sub(dBalance)).to.equal(
      initialETH
    );

    // sudoswap should now have the eth and nfts
    expect(await ethers.provider.getBalance(pairAddress)).to.equal(initialETH);
    for (const nftTokenId of initialNftTokenIds) {
      expect(await nft.ownerOf(nftTokenId)).to.equal(pairAddress);
    }

    // user should be minted an lp token
    expect(await collectionswap.ownerOf(lpTokenId)).to.equal(user.address);

    // protocol should have the reward tokens
    for (let i = 0; i < numRewardTokens; i++) {
      expect(await rewardTokens[i].balanceOf(protocol.address)).to.equal(
        rewards[i]
      );
    }

    const startTime = (await time.latest()) + 10;
    const endTime = startTime + 3600;
    let { rewardPool } = await createIncentiveEth(collectionstaker, {
      ...params,
      rewardTokens,
      rewards,
      startTime,
      endTime,
    });

    // reward pool should now have the reward tokens
    for (let i = 0; i < numRewardTokens; i++) {
      expect(await rewardTokens[i].balanceOf(rewardPool.address)).to.equal(
        rewards[i]
      );
      expect(await rewardTokens[i].balanceOf(protocol.address)).to.equal(0);
    }

    rewardPool = rewardPool.connect(user);

    // user should have the lp token
    expect(await collectionswap.ownerOf(lpTokenId)).to.equal(user.address);

    await collectionswap.approve(rewardPool.address, lpTokenId);
    await rewardPool.stake(lpTokenId);

    // reward pool should now have the lp token
    expect(await collectionswap.ownerOf(lpTokenId)).to.equal(
      rewardPool.address
    );

    // time passes to halfway of incentive
    const period = endTime - startTime;
    await time.increaseTo(startTime + period / 2 - 1);

    await rewardPool.getReward();

    // user should get half the rewards
    for (let i = 0; i < numRewardTokens; i++) {
      const rewardRate = await rewardPool.rewardRates(rewardTokens[i].address);
      expect(await rewardTokens[i].balanceOf(user.address)).to.approximately(
        rewardRate.mul(period).div(2),
        removePrecision
      );
    }

    // time passes to end of incentive
    await time.increaseTo(endTime);

    await rewardPool.exit(lpTokenId);

    // user should get back lp token
    expect(await collectionswap.ownerOf(lpTokenId)).to.equal(user.address);

    // user should get all the rewards
    for (let i = 0; i < numRewardTokens; i++) {
      const rewardRate = await rewardPool.rewardRates(rewardTokens[i].address);
      expect(await rewardTokens[i].balanceOf(user.address)).to.approximately(
        rewardRate.mul(period),
        removePrecision
      );
    }

    prevBalance = await user.getBalance();
    const response = await collectionswap.useLPTokenToDestroyDirectPairETH(
      lpTokenId
    );
    const receipt = await response.wait();
    dBalance = receipt.cumulativeGasUsed.mul(receipt.effectiveGasPrice);

    // lp token should be burnt
    await expect(collectionswap.ownerOf(lpTokenId)).to.be.revertedWith(
      "ERC721: invalid token ID"
    );

    // user should get back eth and nfts
    expect((await user.getBalance()).sub(prevBalance).add(dBalance)).to.equal(
      initialETH
    );
    for (const nftTokenId of initialNftTokenIds) {
      expect(await nft.ownerOf(nftTokenId)).to.equal(user.address);
    }
  });
});
