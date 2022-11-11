import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import {
  collectionstakerFixture as _collectionstakerFixture,
  rewardTokenFixture,
  nftFixture,
} from "../shared/fixtures";
import { mintNfts } from "../shared/helpers";
import { getSigners } from "../shared/signers";

import type { ContractTransaction } from "ethers";

async function getVaultAddress(tx: ContractTransaction, showGas = false) {
  const receipt = await tx.wait();
  if (showGas) {
    console.log("gas used:", receipt.cumulativeGasUsed);
  }

  const newPoolEvent = receipt.events?.find(
    (event) => event.event === "IncentiveETHDrawCreated"
  );
  const poolAddress = newPoolEvent?.args?.poolAddress;
  return { poolAddress };
}

describe("Collectionstaker", function () {
  const numRewardTokens = 2;
  const numDrawERC20Tokens = 5;
  const numDistinctERC721Tokens = 3;
  const numPerERC721Token = 10;
  const prizesPerWinner = 1;

  async function collectionstakerFixture() {
    const { protocol, owner } = await getSigners();
    const { collectionstaker, curve, collection } =
      await _collectionstakerFixture();
    const rewardTokens = (await rewardTokenFixture()).slice(0, numRewardTokens);
    const { nft } = await nftFixture();

    const drawERC20Tokens = (await rewardTokenFixture()).slice(
      0,
      numDrawERC20Tokens
    );
    const drawERC20TokenAmounts = drawERC20Tokens.map((token) =>
      ethers.utils.parseEther("1000")
    );

    // Mint the draw ERC20 tokens
    for (let i = 0; i < numDrawERC20Tokens; i++) {
      const drawERC20Token = drawERC20Tokens[i];
      const drawERC20TokenAmount = drawERC20TokenAmounts[i];

      await drawERC20Token
        .connect(owner)
        .mint(protocol.address, drawERC20TokenAmount);
      await drawERC20Token
        .connect(protocol)
        .approve(collectionstaker.address, drawERC20TokenAmount);
    }

    const possibleShuffledNFTTuples = [];
    const distinctNFTs = [];
    // Iterate through distinctive token IDs
    for (let i = 0; i < numDistinctERC721Tokens; i++) {
      // Iterate through number of tokens per ID
      const { nft: thisPrize721 } = await nftFixture();
      distinctNFTs.push(thisPrize721);
      const tokenIds = await mintNfts(
        thisPrize721,
        protocol.address,
        numPerERC721Token
      );

      // Iterate through TokenIds and add to possibleShuffledNFTTuples
      for (const tokenId in tokenIds) {
        possibleShuffledNFTTuples.push([thisPrize721.address, tokenId]);
      }
    }

    // Shuffle possibleShuffledNFTTuples
    const shuffledNFTTuples = possibleShuffledNFTTuples.sort(
      () => Math.random() - 0.5
    );

    // Unzip shuffledNFTTuples
    const shuffledNFTAddresses = shuffledNFTTuples.map((tuple) => tuple[0]);
    const shuffledNFTTokenIds = shuffledNFTTuples.map((tuple) => tuple[1]);

    // For the ERC721s, let protocol approve collectionstaker
    for (let i = 0; i < numDistinctERC721Tokens; i++) {
      const distinctNFT = distinctNFTs[i];
      await distinctNFT
        .connect(protocol)
        .setApprovalForAll(collectionstaker.address, true);
      // Console.log(await distinctNFT.isApprovedForAll(protocol.address, collectionstaker.address))
    }

    const RNGServiceMockChainlink = await ethers.getContractFactory(
      "RNGServiceMockChainlink"
    );
    const rngServiceMockChainlink = await RNGServiceMockChainlink.deploy();

    const rewards = [
      ethers.utils.parseEther("5"),
      ethers.utils.parseEther("7"),
    ];

    return {
      collectionstaker: collectionstaker.connect(protocol),
      collection,
      curve,
      rewardTokens,
      rewards,
      nft,
      protocol,
      drawERC20Tokens,
      drawERC20TokenAmounts,
      shuffledNFTAddresses,
      shuffledNFTTokenIds,
      distinctNFTs,
      rngServiceMockChainlink,
    };
  }

  describe("Deployment", function () {
    it("Should deploy", async function () {
      await loadFixture(collectionstakerFixture);
    });

    it("Should have the correct owner", async function () {
      const { collection, collectionstaker } = await loadFixture(
        collectionstakerFixture
      );
      expect(await collectionstaker.owner()).to.be.equal(collection.address);
    });
  });

  describe("Incentive", function () {
    it("Should create a reward pool", async function () {
      const { owner } = await getSigners();
      const { collectionstaker, rewardTokens, rewards, nft, curve, protocol } =
        await loadFixture(collectionstakerFixture);

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
        nft.address,
        curve.address,
        ethers.utils.parseEther("1.5"),
        ethers.BigNumber.from("200000000000000000"),
        rewardTokens.map((rewardToken) => rewardToken.address),
        rewards,
        startTime,
        endTime
      );
    });
  });

  describe("Incentive RewardPoolETHDraw", function () {
    it("Should create a reward pool", async function () {
      const { owner, collection } = await getSigners();
      const {
        collectionstaker,
        rewardTokens,
        rewards,
        nft,
        curve,
        protocol,
        drawERC20Tokens,
        drawERC20TokenAmounts,
        shuffledNFTAddresses,
        shuffledNFTTokenIds,
        distinctNFTs,
        rngServiceMockChainlink,
      } = await loadFixture(collectionstakerFixture);

      for (let i = 0; i < numRewardTokens; i++) {
        const rewardToken = rewardTokens[i];
        const reward = rewards[i];

        await rewardToken.connect(owner).mint(protocol.address, reward);
        await rewardToken
          .connect(protocol)
          .approve(collectionstaker.address, reward);
      }

      // Console.log(shuffledNFTAddresses,shuffledNFTTokenIds)
      // console.log(collectionstaker.address, 'collectionstaker.address')
      // console.log(collection.address, 'collection.address')
      // console.log(protocol.address, 'protocol.address')

      await collectionstaker
        .connect(collection)
        .setRNG(rngServiceMockChainlink.address);

      const startTime = (await time.latest()) + 5; // Buffer so that startTime > block.timestamp;
      const endTime = startTime + 86400;
      const tx = await collectionstaker
        .connect(protocol)
        .createIncentiveETHDraw(
          nft.address,
          curve.address,
          ethers.utils.parseEther("1.5"),
          ethers.BigNumber.from("200000000000000000"),
          rewardTokens.map((rewardToken) => rewardToken.address),
          rewards,
          startTime,
          endTime,
          drawERC20Tokens.map((drawERC20Token) => drawERC20Token.address),
          drawERC20TokenAmounts,
          shuffledNFTAddresses,
          shuffledNFTTokenIds,
          prizesPerWinner,
          startTime,
          endTime
        );
      const { poolAddress } = await getVaultAddress(tx);

      // Iterate through shuffledNFTAddresses and shuffledNFTTokenIds and check that they are owned by reward pool
      for (let i = 0; i < shuffledNFTAddresses.length; i++) {
        const nftAddress = shuffledNFTAddresses[i];
        const nftTokenId = shuffledNFTTokenIds[i];

        const nftContract = await ethers.getContractAt("ERC721", nftAddress);
        expect(await nftContract.ownerOf(nftTokenId)).to.be.equal(poolAddress);
      }

      // Iterate through drawERC20Tokens and drawERC20TokenAmounts and check that they are owned by reward pool
      for (let i = 0; i < drawERC20Tokens.length; i++) {
        const drawERC20Token = drawERC20Tokens[i];
        const drawERC20TokenAmount = drawERC20TokenAmounts[i];

        expect(await drawERC20Token.balanceOf(poolAddress)).to.be.gte(
          drawERC20TokenAmount
        );
      }
    });

    it("Should create a reward pool (single)", async function () {
      const { owner, collection } = await getSigners();
      const {
        collectionstaker,
        rewardTokens,
        rewards,
        nft,
        curve,
        protocol,
        drawERC20Tokens,
        drawERC20TokenAmounts,
        shuffledNFTAddresses,
        shuffledNFTTokenIds,
        distinctNFTs,
        rngServiceMockChainlink,
      } = await loadFixture(collectionstakerFixture);

      for (let i = 0; i < numRewardTokens; i++) {
        const rewardToken = rewardTokens[i];
        const reward = rewards[i];

        await rewardToken.connect(owner).mint(protocol.address, reward);
        await rewardToken
          .connect(protocol)
          .approve(collectionstaker.address, reward);
      }

      await collectionstaker
        .connect(collection)
        .setRNG(rngServiceMockChainlink.address);

      const startTime = (await time.latest()) + 5; // Buffer so that startTime > block.timestamp;
      const endTime = startTime + 86400;
      const tx = await collectionstaker
        .connect(protocol)
        .createIncentiveETHDraw(
          nft.address,
          curve.address,
          ethers.utils.parseEther("1.5"),
          ethers.BigNumber.from("200000000000000000"),
          rewardTokens.map((rewardToken) => rewardToken.address),
          rewards,
          startTime,
          endTime,
          drawERC20Tokens.map((drawERC20Token) => drawERC20Token.address),
          drawERC20TokenAmounts,
          shuffledNFTAddresses.slice(0, 1),
          shuffledNFTTokenIds.slice(0, 1),
          prizesPerWinner,
          startTime,
          endTime
        );
      const { poolAddress } = await getVaultAddress(tx);

      // Iterate through shuffledNFTAddresses and shuffledNFTTokenIds and check that they are owned by reward pool
      for (let i = 0; i < 1; i++) {
        const nftAddress = shuffledNFTAddresses[i];
        const nftTokenId = shuffledNFTTokenIds[i];

        const nftContract = await ethers.getContractAt("ERC721", nftAddress);
        expect(await nftContract.ownerOf(nftTokenId)).to.be.equal(poolAddress);
      }

      // Iterate through drawERC20Tokens and drawERC20TokenAmounts and check that they are owned by reward pool
      for (let i = 0; i < drawERC20Tokens.length; i++) {
        const drawERC20Token = drawERC20Tokens[i];
        const drawERC20TokenAmount = drawERC20TokenAmounts[i];

        expect(await drawERC20Token.balanceOf(poolAddress)).to.be.gte(
          drawERC20TokenAmount
        );
      }
    });

    it("Should not be able to create a reward pool if NFTs are length 0 ", async function () {
      const { owner, collection } = await getSigners();
      const {
        collectionstaker,
        rewardTokens,
        rewards,
        nft,
        curve,
        protocol,
        drawERC20Tokens,
        drawERC20TokenAmounts,
        shuffledNFTAddresses,
        shuffledNFTTokenIds,
        distinctNFTs,
        rngServiceMockChainlink,
      } = await loadFixture(collectionstakerFixture);

      for (let i = 0; i < numRewardTokens; i++) {
        const rewardToken = rewardTokens[i];
        const reward = rewards[i];

        await rewardToken.connect(owner).mint(protocol.address, reward);
        await rewardToken
          .connect(protocol)
          .approve(collectionstaker.address, reward);
      }

      await collectionstaker
        .connect(collection)
        .setRNG(rngServiceMockChainlink.address);

      const startTime = (await time.latest()) + 5; // Buffer so that startTime > block.timestamp;
      const endTime = startTime + 86400;
      await expect(
        collectionstaker.connect(protocol).createIncentiveETHDraw(
          nft.address,
          curve.address,
          ethers.utils.parseEther("1.5"),
          ethers.BigNumber.from("200000000000000000"),
          rewardTokens.map((rewardToken) => rewardToken.address),
          rewards,
          startTime,
          endTime,
          drawERC20Tokens.map((drawERC20Token) => drawERC20Token.address),
          drawERC20TokenAmounts,
          [],
          [],
          prizesPerWinner,
          startTime,
          endTime
        )
      ).to.be.revertedWith("Min 1 NFT");
    });
  });
});
