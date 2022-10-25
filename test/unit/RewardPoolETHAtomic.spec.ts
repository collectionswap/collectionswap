import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
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

  const newPoolEvent = receipt.events?.find(
    (event) => event.event === "NewPair"
  );
  let newPairAddress = newPoolEvent?.args?.poolAddress;
  const newTokenEvent = receipt.events?.find(
    (event) => event.event === "NewTokenId"
  );
  const newTokenId = newTokenEvent?.args?.tokenId;

  if (!newPairAddress) {
    // Check event.topcs contains '0xf5bdc103c3e68a20d5f97d2d46792d3fdddfa4efeb6761f8141e6a7b936ca66c'
    const thisEvent = receipt.events?.find(
      (event) =>
        event.topics[0] ===
        "0xf5bdc103c3e68a20d5f97d2d46792d3fdddfa4efeb6761f8141e6a7b936ca66c"
    );
    // Console.log('nnn',thisEvent)
    // get last 40 characters
    // newPairAddress = '0x' + thisEvent?.topics[1].slice(-40)
    newPairAddress = "0x" + thisEvent?.data.slice(-40);
    // Console.log('mmm',newPairAddress)
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
  let params: any;
  let nftTokenIds: BigNumberish[];
  let nft: any;

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
      params,
      lpTokenId,
      lpTokenId1,
      rewardPool,
      owner,
      user,
      user1,
      collection,
      nft,
      nftTokenIds,
    } = await loadFixture(rewardPoolFixture));
  });

  async function rewardPoolFixture() {
    const { owner, user, user1, collection } = await getSigners();

    let { collectionswap, curve } = await collectionswapFixture();
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
    let rewardPool = await RewardPool.connect(collectionswap.signer).deploy();
    await rewardPool.initialize(
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
      bondingCurve: curve as unknown as ICurve,
      delta: ethers.utils.parseEther("1.5"),
      fee: ethers.BigNumber.from("200000000000000000"),
      spotPrice: ethers.BigNumber.from("16493775933609955"),
      value: ethers.utils.parseEther("2"),
    };

    // Const { lpTokenId } = await createPairEth(collectionswap, {
    //   ...params,
    //   nft: nft as unknown as IERC721,
    //   nftTokenIds,
    // });

    // Const { lpTokenId: lpTokenId1 } = await createPairEth(
    //   collectionswap.connect(user1),
    //   {
    //     ...params,
    //     nft: nft.connect(user1) as unknown as IERC721,
    //     nftTokenIds: nftTokenIds1,
    //   }
    // );

    return {
      collectionswap,
      allRewardTokens,
      rewardTokens,
      rewards,
      nft,
      curve,
      params,
      lpTokenId,
      lpTokenId1,
      rewardPool,
      owner,
      user,
      user1,
      collection,
      nft,
      nftTokenIds,
    };
  }

  describe("Atomic transactions", function () {
    it("Atomic entry, piecemeal exit", async function () {
      //   Await nft.connect(user).setApprovalForAll(rewardPool.address, true);
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
          nftTokenIds,
          { value: params.value }
        );
      const currTokenId = 1;

      await rewardPool.exit(currTokenId);
      await collectionswap.useLPTokenToDestroyDirectPairETH(currTokenId);
    });

    it("Atomic entry, atomic exit", async function () {
      //   Await nft.connect(user).setApprovalForAll(rewardPool.address, true);
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
          nftTokenIds,
          { value: params.value }
        );

    //   console.log("nft.ownerOf", await nft.ownerOf(nftTokenIds[0]));

      const { newPairAddress } = await getPoolAddress(currTokenIdTx);
      expect((await nft.ownerOf(nftTokenIds[0])).toLowerCase()).to.equal(
        newPairAddress.toLowerCase()
      );

      // Console.log('zzz', newPairAddress)

      // HARDCODE
      const currTokenId = 1;

      await expect(
        rewardPool.atomicExitAndUnpool(currTokenId)
      ).to.changeEtherBalances(
        [user, newPairAddress],
        [params.value, params.value.mul(-1)]
      );

      // Check for each nftTokenIds, user owns them
      for (let i = 0; i < nftTokenIds.length; i++) {
        expect(await nft.ownerOf(nftTokenIds[i])).to.equal(user.address);
      }
    });
  });
});
