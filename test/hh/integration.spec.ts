import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { integrationFixture } from "./shared/fixtures";
import { createPoolEth, mintRandomNfts } from "./shared/helpers";

import type { IERC721 } from "../../typechain-types";

describe("integration", function () {
  it("Should integrate", async function () {
    const {
      factory,
      curve,
      rewardTokens,
      rewards,
      nft,
      protocol,
      user,
      numRewardTokens,
      bigDelta,
      bigSpot,
      bigPctFee,
      props,
      state,
      royaltyNumerator,
    } = await loadFixture(integrationFixture);

    const initialNftTokenIds = await mintRandomNfts(nft, user.address);
    // Note: This must be bigger than the initial price of the pool
    // WHICH SHOULD NOT BE ASSUMED TO BE SPOT PRICE.
    const initialETH = ethers.utils.parseEther("25");

    // User should have the eth and nfts
    expect(
      await ethers.provider.getBalance(user.address)
    ).to.greaterThanOrEqual(initialETH);
    for (const nftTokenId of initialNftTokenIds) {
      expect(await nft.ownerOf(nftTokenId)).to.equal(user.address);
    }

    let prevBalance = await user.getBalance();
    const delta = bigDelta;
    const fee = bigPctFee;
    const params = {
      nft: nft.connect(user) as unknown as IERC721,
      bondingCurve: curve,
      delta,
      fee,
      royaltyNumerator,
    };
    const result = await createPoolEth(factory, {
      ...params,
      spotPrice: bigSpot,
      nftTokenIds: initialNftTokenIds,
      value: initialETH,
      props,
      state,
      royaltyNumerator,
      royaltyRecipientFallback: user.address,
    });
    const { lpTokenId, poolAddress } = result;
    let { dBalance } = result;

    // User decrease in eth should be equal to eth deposited
    expect(prevBalance.sub(await user.getBalance()).sub(dBalance)).to.equal(
      initialETH
    );

    // AMM should now have the eth and nfts
    expect(await ethers.provider.getBalance(poolAddress)).to.equal(initialETH);
    for (const nftTokenId of initialNftTokenIds) {
      expect(await nft.ownerOf(nftTokenId)).to.equal(poolAddress);
    }

    // User should be minted an lp token
    expect(await factory.ownerOf(lpTokenId)).to.equal(user.address);

    // Protocol should have the reward tokens
    for (let i = 0; i < numRewardTokens; i++) {
      expect(await rewardTokens[i].balanceOf(protocol.address)).to.equal(
        rewards[i]
      );
    }

    const startTime = (await time.latest()) + 10;
    const endTime = startTime + 3600;

    // User should have the lp token
    expect(await factory.ownerOf(lpTokenId)).to.equal(user.address);

    // Time passes to halfway of incentive
    const period = endTime - startTime;
    await time.increaseTo(startTime + period / 2 - 1);

    // Time passes to end of incentive
    await time.increaseTo(endTime);

    // User should get back lp token
    expect(await factory.ownerOf(lpTokenId)).to.equal(user.address);

    await factory.setApprovalForAll(factory.address, true);
    prevBalance = await user.getBalance();
    const response = await factory.burn(lpTokenId);
    const receipt = await response.wait();
    dBalance = receipt.cumulativeGasUsed.mul(receipt.effectiveGasPrice);

    // Lp token should be burnt
    await expect(factory.ownerOf(lpTokenId)).to.be.revertedWith(
      "ERC721: invalid token ID"
    );

    // User should get back eth and nfts
    expect((await user.getBalance()).sub(prevBalance).add(dBalance)).to.equal(
      initialETH
    );
    for (const nftTokenId of initialNftTokenIds) {
      expect(await nft.ownerOf(nftTokenId)).to.equal(user.address);
    }
  });
});
