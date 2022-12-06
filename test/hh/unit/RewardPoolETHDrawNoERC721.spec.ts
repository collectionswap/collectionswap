import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import {
  rewardTokenFixture,
  nftFixture,
  collectionstakerFixture,
  getCurveParameters,
  validatorFixture,
} from "../shared/fixtures";
import { createPairEth, mintNfts } from "../shared/helpers";
import { getSigners } from "../shared/signers";

import type {
  ILSSVMPairFactory,
  ICurve,
  IERC20,
  IERC721,
  RewardPoolETH,
  RewardPoolETHDraw,
} from "../../../typechain-types";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import type { BigNumberish, ContractTransaction } from "ethers";

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

async function checkOwnershipERC721List(
  nftAddressList,
  nftIdList,
  ownerAddress
) {
  for (let i = 0; i < nftAddressList.length; i++) {
    const nftAddress = nftAddressList[i];
    const nftId = nftIdList[i];
    const nft = await ethers.getContractAt("IERC721", nftAddress);
    expect(await nft.ownerOf(nftId)).to.equal(ownerAddress);
  }
}

async function checkSufficiencyERC20List(
  tokenAddressList,
  tokenAmountList,
  ownerAddress
) {
  for (let i = 0; i < tokenAddressList.length; i++) {
    const tokenAddress = tokenAddressList[i];
    const tokenAmount = tokenAmountList[i];
    const token = await ethers.getContractAt("IERC20", tokenAddress);
    expect(await token.balanceOf(ownerAddress)).to.be.at.least(tokenAmount);
  }
}

async function getPrizesPerWinnerFromSet(tx: ContractTransaction) {
  const receipt = await tx.wait();
  // console.log(receipt)
  const event = receipt.events?.find(
    (e) => e.event === "PrizesPerWinnerUpdated"
  );
  console.log(event?.args)
  const epoch = event?.args?.epoch;
  const numPrizesPerWinner = event?.args?.numPrizesPerWinner;
  return { numPrizesPerWinner, epoch };
}

async function getDrawWinnersFromResolve(tx: ContractTransaction) {
  const receipt = await tx.wait();
  const event = receipt.events?.find((e) => e.event === "DrawResolved");
  const winners = event?.args?.winners;
  const epoch = event?.args?.epoch;
  return { winners, epoch };
}

// Two participant draw
// NB: both tokens are staked, but user's token is not staked for the full duration.
async function runTwoParticipantDraw(
  factory: ILSSVMPairFactory,
  user: SignerWithAddress,
  user1: SignerWithAddress,
  rewardPool: RewardPoolETHDraw,
  lpTokenId: BigNumberish,
  lpTokenId1: BigNumberish,
  rewardDuration: number,
  startTime: number,

  epoch?: number
) {
  await factory.connect(user).setApprovalForAll(rewardPool.address, true);
  await rewardPool.connect(user).stake(lpTokenId);
  await factory.connect(user1).setApprovalForAll(rewardPool.address, true);
  await rewardPool.connect(user1).stake(lpTokenId1);

  if (epoch) {
    // Console.log(startTime, await rewardPool.epochToStartTime(epoch));
    expect(startTime).to.be.equal(await rewardPool.epochToStartTime(epoch));
  }

  const actualEpoch = await rewardPool.thisEpoch();

  //   Const periodFinish = await rewardPool.periodFinish();
  const periodFinish = await rewardPool.epochToFinishTime(actualEpoch);
  const balance = await rewardPool.balanceOf(user.address);
  const balance1 = await rewardPool.balanceOf(user1.address);

  expect(balance).to.not.equal(0);
  expect(balance1).to.not.equal(0);

  // Mine to halfway through
  await time.increase(rewardDuration / 2);
  await rewardPool.exit(lpTokenId);
  expect(await rewardPool.balanceOf(user.address)).to.equal(0);
  //   Const lastUpdateTime2 = await rewardPool.lastUpdateTime();

  const lastUpdateTime2 = (await rewardPool.lastTWAPObservation(user.address))
    .timestamp;

  //   Expect(lastUpdateTime2).to.be.gt(lastUpdateTime);
  //   expect(lastUpdateTime2).to.be.gt(startTime);

  const isBeforeStart = lastUpdateTime2.eq(startTime);

  const expectedEndContribution = lastUpdateTime2.sub(startTime).mul(balance);
  const expectedEndContribution1 = periodFinish.sub(startTime).mul(balance1);

  expect(await factory.ownerOf(lpTokenId)).to.equal(user.address);
  expect(await rewardPool.balanceOf(user.address)).to.equal(0);

  expect(await factory.ownerOf(lpTokenId1)).to.equal(rewardPool.address);
  expect(await rewardPool.balanceOf(user1.address)).to.not.equal(0);

  const chances = await rewardPool.viewChanceOfDraw(user.address);
  const numerator = chances[0];
  const denominator = chances[1];

  const chances1 = await rewardPool.viewChanceOfDraw(user1.address);
  const numerator1 = chances1[0];

  expect(isBeforeStart).to.be.false;
  if (isBeforeStart) {
    expect(numerator).to.equal(0);
    expect(numerator1).to.equal(0);
  } else {
    expect(numerator).to.equal(expectedEndContribution); // Twap
    expect(numerator1).to.equal(expectedEndContribution1); // Twap
  }

  expect(numerator.add(numerator1)).to.equal(denominator.sub(1));
  //   Expect(numerator).to.equal(denominator.sub(1));
}

async function setUpNewPrizeERC20(
  targetOwner: SignerWithAddress,
  targetPool: RewardPoolETHDraw,
  rewardTokenAmount: BigNumberish
) {
  // Mint the erc20
  const rewardTokensNew = await rewardTokenFixture();
  const rewardTokenAmountList = new Array(rewardTokensNew.length).fill(
    rewardTokenAmount
  );
  for (let i = 0; i < rewardTokensNew.length; i++) {
    await rewardTokensNew[i].mint(targetOwner.address, rewardTokenAmount);
  }

  // Approve the erc20
  for (let i = 0; i < rewardTokensNew.length; i++) {
    await rewardTokensNew[i].approve(targetPool.address, rewardTokenAmount);
  }

  return { rewardTokensNew, rewardTokenAmountList };
}

async function setUpNewPrizeNFT(
  numNewPrizes: number,
  targetOwner: SignerWithAddress,
  targetPool: RewardPoolETHDraw
) {
  const { nft: newPrizeNFT } = await nftFixture();
  const newPrizeTokenIds = await mintNfts(
    newPrizeNFT,
    targetOwner.address,
    numNewPrizes
  );
  const newPrizeNFTAddresses = new Array(newPrizeTokenIds.length).fill(
    newPrizeNFT.address
  );
  await newPrizeNFT
    .connect(targetOwner)
    .setApprovalForAll(targetPool.address, true);

  return { newPrizeNFT, newPrizeNFTAddresses, newPrizeTokenIds };
}

describe("RewardPoolETHDraw", function () {
  let factory: ILSSVMPairFactory;
  let collectionstaker: Collectionstaker;
  let allRewardTokens: IERC20[];
  let rewardTokens: IERC20[];
  let rewards: BigNumberish[];
  let lpTokenId: BigNumberish;
  let lpTokenId1: BigNumberish;
  let rewardPool: RewardPoolETH;
  let owner: SignerWithAddress;
  let user: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let collection: SignerWithAddress;
  let rng: any;
  let protocolFactorySigner: SignerWithAddress;
  let startTime: number;
  let endTime: number;
  let distinctNFTs: IERC721[];
  //   Let rewardDuration: number;

  const prizesPerWinner = 1;
  const numRewardTokens = 2;
  const numDrawERC20Tokens = 2;
  const numDistinctERC721Tokens = 3;
  const numPerERC721Token = 10;

  const drawStatusOpen = 0;
  const drawStatusClosed = 1;
  const drawStatusResolved = 2;

  const dayDuration = 86400;
  // Removing the last few digits when comparing, since we have 18
  // so this should be fine

  const rewardDuration = dayDuration;

  beforeEach(async function () {
    ({
      factory,
      collectionstaker,
      allRewardTokens,
      rewardTokens,
      rewards,
      lpTokenId,
      lpTokenId1,
      owner,
      user,
      user1,
      user2,
      collection,
      protocolFactorySigner,
      startTime,
      endTime,
      rng,
      //   RewardDuration,
    } = await loadFixture(rewardPoolDrawFixture));
  });

  async function rewardPoolDrawFixture() {
    const { owner, user, user1, user2, collection } = await getSigners();

    let { factory, collectionstaker, curve } = await collectionstakerFixture();
    const { monotonicIncreasingValidator } = await validatorFixture();
    const allRewardTokens = await rewardTokenFixture();
    const rewardTokens = allRewardTokens.slice(0, numRewardTokens);
    let { nft } = await nftFixture();

    const rewards = [
      ethers.utils.parseEther("5"),
      ethers.utils.parseEther("7"),
    ];
    const startTime = (await time.latest()) + 1000;
    const endTime = startTime + rewardDuration;

    const RNGServiceMockChainlink = await ethers.getContractFactory(
      "RNGServiceMockChainlink"
    );
    const rng = await RNGServiceMockChainlink.deploy();
    await collectionstaker.connect(collection).setRNG(rng.address);

    const drawERC20TokensContract = (await rewardTokenFixture()).slice(
      0,
      numDrawERC20Tokens
    );
    const drawERC20Tokens = drawERC20TokensContract.map(
      (token) => token.address
    );
    const drawERC20TokenAmounts = drawERC20TokensContract.map(() =>
      ethers.utils.parseEther("1000")
    );

    // Const protocolFactorySigner = factory.signer;
    // const protocolFactoryAddress = await factory.signer.getAddress();

    // const protocolFactorySigner = hypotheticalProtocolFactory;
    // const protocolFactoryAddress = hypotheticalProtocolFactory.address;

    const protocolFactoryAddress = collectionstaker.address;

    // Const RewardPool = await ethers.getContractFactory("RewardPoolETHDraw");

    // Go through rewardTokens and approve the collectionstakerfactory
    for (let i = 0; i < rewardTokens.length; i++) {
      const rewardToken = rewardTokens[i];
      const reward = rewards[i];

      await rewardToken.connect(owner).mint(owner.address, reward);
      await rewardToken
        .connect(owner)
        .approve(collectionstaker.address, reward);
    }

    // Mint the draw ERC20 tokens
    for (let i = 0; i < numDrawERC20Tokens; i++) {
      const drawERC20Token = drawERC20TokensContract[i];
      const drawERC20TokenAmount = drawERC20TokenAmounts[i];

      await drawERC20Token
        .connect(owner)
        .mint(owner.address, drawERC20TokenAmount);
      await drawERC20Token
        .connect(owner)
        .approve(protocolFactoryAddress, drawERC20TokenAmount);
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
        owner.address,
        numPerERC721Token
      );

      // Iterate through TokenIds and add to possibleShuffledNFTTuples
      for (const tokenId of tokenIds) {
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
        .connect(owner)
        .setApprovalForAll(protocolFactoryAddress, true);
    }

    const tx = await collectionstaker.connect(owner).createIncentiveETHDraw(
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
      endTime,
      drawERC20Tokens,
      drawERC20TokenAmounts,
      [], //shuffledNFTAddresses,
      [], //shuffledNFTTokenIds,
      prizesPerWinner,
      startTime,
      endTime
    );
    const { poolAddress: rewardPoolAddress } = await getVaultAddress(tx);
    let rewardPool = await ethers.getContractAt(
      "RewardPoolETHDraw",
      rewardPoolAddress
    );

    const nftTokenIds = await mintNfts(nft, user.address);
    const nftTokenIds1 = await mintNfts(nft, user1.address);

    factory = factory.connect(user);
    nft = nft.connect(user);
    rewardPool = rewardPool.connect(user);

    const { delta, fee, spotPrice, props, state, royaltyNumerator } =
      getCurveParameters();
    const params = {
      bondingCurve: curve as unknown as ICurve,
      delta,
      fee,
      spotPrice,
      props,
      state,
      royaltyNumerator,
      royaltyRecipientOverride: ethers.constants.AddressZero,
      value: ethers.utils.parseEther("2"),
    };

    const { lpTokenId } = await createPairEth(factory, {
      ...params,
      nft: nft as unknown as IERC721,
      nftTokenIds,
    });

    const { lpTokenId: lpTokenId1 } = await createPairEth(
      factory.connect(user1),
      {
        ...params,
        nft: nft.connect(user1) as unknown as IERC721,
        nftTokenIds: nftTokenIds1,
      }
    );

    // Iterate through shuffledNFTAddresses and shuffledNFTTokenIds and check that they are owned by reward pool

    // await checkOwnershipERC721List(
    //   shuffledNFTAddresses,
    //   shuffledNFTTokenIds,
    //   rewardPool.address
    // );

    // Console.log(shuffledNFTAddresses,shuffledNFTTokenIds)

    // Iterate through drawERC20Tokens and drawERC20TokenAmounts and check that they are owned by reward pool
    await checkSufficiencyERC20List(
      drawERC20Tokens,
      drawERC20TokenAmounts,
      rewardPool.address
    );

    // Console.log(startTime, endTime);

    return {
      factory,
      collectionstaker,
      allRewardTokens,
      rewardTokens,
      rewards,
      nft,
      curve,
      lpTokenId,
      lpTokenId1,
      rewardPool,
      owner,
      user,
      user1,
      user2,
      collection,
      protocolFactorySigner,
      startTime,
      endTime,
      rng,
      distinctNFTs,
      //   RewardDuration,
    };
  }

  describe("Deployment", function () {
    it("Should deploy", async function () {
      await loadFixture(rewardPoolDrawFixture);
    });

    it("Should have correct state variables", async function () {
      const { rewardPool, user } = await loadFixture(rewardPoolDrawFixture);

      // Expect rewardPool to have drawOpen status
      expect(await rewardPool.drawStatus()).to.equal(drawStatusOpen);

      const epoch = await rewardPool.thisEpoch();
      const prizeSet = await rewardPool.epochPrizeSets(epoch);
      expect(prizeSet.numERC721Prizes).to.equal(
        0
        // numPerERC721Token * numDistinctERC721Tokens
      );

      const chances = await rewardPool.viewChanceOfDraw(user.address);
      const numerator = chances[0];
      const denominator = chances[1];

      expect(numerator).to.equal(0);
      expect(denominator).to.equal(1);
    });
  });

  describe("Stake/Withdraw", function () {
    it("Can stake and acquire chances", async function () {
      const { rewardPool, lpTokenId, user } = await loadFixture(
        rewardPoolDrawFixture
      );
      await factory.connect(user).setApprovalForAll(rewardPool.address, true);

      await rewardPool.stake(lpTokenId);

      const lastUpdateTime = await rewardPool.lastUpdateTime();
      const periodFinish = await rewardPool.periodFinish();
      const balance = await rewardPool.balanceOf(user.address);

      const expectedEndContribution = periodFinish
        .sub(lastUpdateTime)
        .mul(balance);

      expect(await factory.ownerOf(lpTokenId)).to.equal(rewardPool.address);
      expect(await rewardPool.balanceOf(user.address)).to.not.equal(0);

      const chances = await rewardPool.viewChanceOfDraw(user.address);
      const numerator = chances[0];
      const denominator = chances[1];

      // Expect numerator to be greater than 0
      expect(numerator).to.not.equal(0);
      expect(numerator).to.be.equal(expectedEndContribution);

      // Expect numerator = denominator -1
      expect(numerator).to.equal(denominator.sub(1));
    });

    it("One can stake, withdraw before pool start (chances)", async function () {
      const { rewardPool, lpTokenId, user } = await loadFixture(
        rewardPoolDrawFixture
      );
      await factory.approve(rewardPool.address, lpTokenId);

      await rewardPool.stake(lpTokenId);
      const lastUpdateTime = await rewardPool.lastUpdateTime();
      await rewardPool.withdraw(lpTokenId);
      const lastUpdateTime2 = await rewardPool.lastUpdateTime();

      const isBeforeStart = lastUpdateTime.eq(lastUpdateTime2);

      expect(await factory.ownerOf(lpTokenId)).to.equal(user.address);
      expect(await rewardPool.balanceOf(user.address)).to.equal(0);

      const chances = await rewardPool.viewChanceOfDraw(user.address);
      const numerator = chances[0];
      const denominator = chances[1];

      expect(isBeforeStart).to.be.true;
      if (isBeforeStart) {
        expect(numerator).to.equal(0);
      } else {
        expect(numerator).to.not.equal(0); // Twap
      }

      expect(numerator).to.equal(denominator.sub(1));
    });

    it("One can stake, withdraw midway through (chances)", async function () {
      const { rewardPool, lpTokenId, user } = await loadFixture(
        rewardPoolDrawFixture
      );
      await factory.approve(rewardPool.address, lpTokenId);

      await rewardPool.stake(lpTokenId);
      const lastUpdateTime = await rewardPool.lastUpdateTime();
      const balance = await rewardPool.balanceOf(user.address);

      // Mine to halfway through
      await time.increase(rewardDuration / 2);
      await rewardPool.withdraw(lpTokenId);
      const lastUpdateTime2 = await rewardPool.lastUpdateTime();

      const isBeforeStart = lastUpdateTime.eq(lastUpdateTime2);

      const expectedEndContribution = lastUpdateTime2
        .sub(lastUpdateTime)
        .mul(balance);

      expect(await factory.ownerOf(lpTokenId)).to.equal(user.address);
      expect(await rewardPool.balanceOf(user.address)).to.equal(0);

      const chances = await rewardPool.viewChanceOfDraw(user.address);
      const numerator = chances[0];
      const denominator = chances[1];
      expect(isBeforeStart).to.be.false;
      if (isBeforeStart) {
        expect(numerator).to.equal(0);
      } else {
        expect(numerator).to.equal(expectedEndContribution); // Twap
      }

      expect(numerator).to.equal(denominator.sub(1));
    });

    it("One can stake, withdraw after pool end (chances)", async function () {
      const { rewardPool, lpTokenId, user } = await loadFixture(
        rewardPoolDrawFixture
      );
      await factory.approve(rewardPool.address, lpTokenId);

      await rewardPool.stake(lpTokenId);
      const lastUpdateTime = await rewardPool.lastUpdateTime();
      const periodFinish = await rewardPool.periodFinish();
      const balance = await rewardPool.balanceOf(user.address);

      // Mine to after rewards finish
      await time.increase(2 * rewardDuration);
      await rewardPool.withdraw(lpTokenId);
      const lastUpdateTime2 = await rewardPool.lastUpdateTime();

      const isBeforeStart = lastUpdateTime.eq(lastUpdateTime2);

      const expectedEndContribution = periodFinish
        .sub(lastUpdateTime)
        .mul(balance);

      expect(await factory.ownerOf(lpTokenId)).to.equal(user.address);
      expect(await rewardPool.balanceOf(user.address)).to.equal(0);

      const chances = await rewardPool.viewChanceOfDraw(user.address);
      const numerator = chances[0];
      const denominator = chances[1];

      expect(isBeforeStart).to.be.false;
      if (isBeforeStart) {
        expect(numerator).to.equal(0);
      } else {
        expect(numerator).to.equal(expectedEndContribution); // Twap
      }

      expect(numerator).to.equal(denominator.sub(1));
    });

    it("Two can stake, one withdraw midway through (chances: check no effect of one's actions on the other)", async function () {
      const { rewardPool, lpTokenId, lpTokenId1, user, user1, startTime } =
        await loadFixture(rewardPoolDrawFixture);

      await runTwoParticipantDraw(
        factory,
        user,
        user1,
        rewardPool,
        lpTokenId,
        lpTokenId1,
        rewardDuration,
        startTime
      );
    });
  });

  describe("Resolving draw close", function () {
    it("Should be able to close and resolve (sweep remainder)", async function () {
      const {
        rewardPool,
        lpTokenId,
        lpTokenId1,
        user,
        user1,
        user2,
        startTime,
        rng,
        distinctNFTs,
      } = await loadFixture(rewardPoolDrawFixture);

      await runTwoParticipantDraw(
        factory,
        user,
        user1,
        rewardPool,
        lpTokenId,
        lpTokenId1,
        rewardDuration,
        startTime
      );

      const thisPrizePerWinner = 7;
      await rewardPool.connect(owner).setPrizePerWinner(thisPrizePerWinner); // 30 % 7 == 2
      const thisRemainder =
        (numPerERC721Token * numDistinctERC721Tokens) % thisPrizePerWinner;

      await time.increase(rewardDuration);

      await rewardPool.connect(user1).closeDraw();
      await rng.setRandomNumber(999);
      const tx = await rewardPool.connect(user1).resolveDrawResults();
      const { winners, epoch } = await getDrawWinnersFromResolve(tx);
      // Loop through distinctNFTs
      let beforeBalance = ethers.utils.parseEther("0");
      for (let i = 0; i < distinctNFTs.length; i++) {
        // Check balance of owner
        beforeBalance = beforeBalance.add(
          await distinctNFTs[i].balanceOf(owner.address)
        );
      }

      // can only sweep after reward sweep time
      let rewardSweepTime = await rewardPool.rewardSweepTime();
      await time.increaseTo(rewardSweepTime);

      // get numPrizes
      const {
        hasNFTPrizes,
        numberOfDrawWinners,
        numberOfPrizesPerWinner,
        remainder,
      } = await rewardPool.getDrawDistribution(epoch);
      let numNFTPrizes = (await rewardPool.epochPrizeSets(epoch)).numERC721Prizes;
      // NFTs are swept from the back
      let remainderNfts = [];
      for (let i = 0; i < remainder; ++i) {
        remainderNfts.push(numNFTPrizes.sub(i));
      }

      await rewardPool.connect(owner).sweepUnclaimedNfts(epoch, remainderNfts);
      // Loop through distinctNFTs
      let afterBalance = ethers.utils.parseEther("0");
      for (let i = 0; i < distinctNFTs.length; i++) {
        // Check balance of owner
        afterBalance = afterBalance.add(
          await distinctNFTs[i].balanceOf(owner.address)
        );
      }

      expect(afterBalance.sub(beforeBalance)).to.equal(remainder);

      // Cannot call it again for the same epoch
      if (numNFTPrizes>0) {
        await expect(
          rewardPool.connect(owner).sweepUnclaimedNfts(epoch, remainderNfts)
        ).to.be.revertedWith("ERC721: caller is not token owner nor approved");
      }
    });

    it("Should be able to close and resolve", async function () {
      const {
        rewardPool,
        lpTokenId,
        lpTokenId1,
        user,
        user1,
        user2,
        startTime,
        rng,
        distinctNFTs,
        owner
      } = await loadFixture(rewardPoolDrawFixture);

      await runTwoParticipantDraw(
        factory,
        user,
        user1,
        rewardPool,
        lpTokenId,
        lpTokenId1,
        rewardDuration,
        startTime
      );

      await time.increase(rewardDuration);
      await rewardPool.connect(owner).setPrizePerWinner(40) // this sets the divisbility of the prize

      await rewardPool.connect(user1).closeDraw();
      await rng.setRandomNumber(999);
      const tx = await rewardPool.connect(user1).resolveDrawResults();
      const { winners, epoch } = await getDrawWinnersFromResolve(tx);

      // console.log(winners, epoch);
      console.log(await rewardPool.getDrawDistribution(epoch));

      // Probabilistic if RNG were not set, which it is. = 999
      const numberWinners = (
        await rewardPool.connect(user).epochWinnerConfigs(epoch)
      ).numberOfDrawWinners;
      expect(winners.length).to.equal(numberWinners);
      expect(winners).to.include(user.address);
      expect(winners).to.include(user1.address);
      expect(epoch).to.equal(1);

      expect(await rewardPool.isPrizeClaimable(epoch, user.address)).to.be.true;
      await rewardPool.connect(user).claimMyShare(epoch);
      expect(await rewardPool.isPrizeClaimable(epoch, user.address)).to.be
        .false;

      expect(await rewardPool.isPrizeClaimable(epoch, user1.address)).to.be
        .true;
      await rewardPool.connect(user1).claimMyShare(epoch);
      expect(await rewardPool.isPrizeClaimable(epoch, user1.address)).to.be
        .false;

      await expect(
        rewardPool.connect(user1).claimMyShare(epoch)
      ).to.be.revertedWithCustomError(rewardPool, "NoClaimableShare");
      await expect(
        rewardPool.connect(user2).claimMyShare(epoch)
      ).to.be.revertedWithCustomError(rewardPool, "NoClaimableShare");

      let totalNFTs = ethers.utils.parseEther("0");
      for (let i = 0; i < distinctNFTs.length; i++) {
        // RewardPool should have 0
        expect(await distinctNFTs[i].balanceOf(rewardPool.address)).to.equal(0);
        // Add the balances of user and user1 to totalNFTs
        totalNFTs = totalNFTs.add(
          await distinctNFTs[i].balanceOf(user.address)
        );
        totalNFTs = totalNFTs.add(
          await distinctNFTs[i].balanceOf(user1.address)
        );
      }

      // Expect totalNFTs to equal numDistinctERC721Tokens * numPerERC721Token
      expect(totalNFTs).to.equal(0);
    });

    it("Balance changes (staking/burning) that occur while the draw is closed are reflected in the next epoch (e.g. epoch 1 > balance change > epoch 2", async function () {
      let balance;
      let balance1;

      const {
        rewardPool,
        lpTokenId,
        lpTokenId1,
        owner,
        user,
        user1,
        startTime,
        rng,
      } = await loadFixture(rewardPoolDrawFixture);

      await runTwoParticipantDraw(
        factory,
        user,
        user1,
        rewardPool,
        lpTokenId,
        lpTokenId1,
        rewardDuration,
        startTime
      );
      await time.increase(rewardDuration);
      await rewardPool.connect(user1).closeDraw();
      balance = await rewardPool.balanceOf(user.address);
      balance1 = await rewardPool.balanceOf(user1.address);
      expect(balance).to.equal(0);
      expect(balance1).to.not.equal(0);
      expect(await rewardPool.drawStatus()).to.equal(drawStatusClosed);
      await rng.setRandomNumber(999);
      const tx = await rewardPool.connect(user1).resolveDrawResults();
      await getDrawWinnersFromResolve(tx);
      expect(await rewardPool.drawStatus()).to.equal(drawStatusResolved);

      // User1 withdraws his LP tokens in the close period
      await rewardPool.connect(user1).withdraw(lpTokenId1);
      await rewardPool.connect(user).stake(lpTokenId);

      const numIncrementalPrizes = 10;
      const { newPrizeNFTAddresses, newPrizeTokenIds } = await setUpNewPrizeNFT(
        numIncrementalPrizes,
        owner,
        rewardPool
      );
      const rewardTokenAmount = ethers.utils.parseEther("1000");
      const { rewardTokensNew, rewardTokenAmountList } =
        await setUpNewPrizeERC20(owner, rewardPool, rewardTokenAmount);

      const startTime2 = (await time.latest()) + 1000;
      const endTime2 = startTime2 + rewardDuration;

      await checkOwnershipERC721List(
        newPrizeNFTAddresses,
        newPrizeTokenIds,
        owner.address
      );

      await rewardPool.connect(owner).addNewPrizes(
        newPrizeNFTAddresses,
        newPrizeTokenIds,
        rewardTokensNew.map((t) => t.address),
        rewardTokenAmountList,
        prizesPerWinner,
        startTime2,
        endTime2
      );
      await checkOwnershipERC721List(
        newPrizeNFTAddresses,
        newPrizeTokenIds,
        rewardPool.address
      );
      balance = await rewardPool.balanceOf(user.address);
      balance1 = await rewardPool.balanceOf(user1.address);
      expect(balance).to.not.equal(0);
      expect(balance1).to.equal(0);
      //   Console.log("abc");
      //   Console.log(balance)
      const expectedEndContribution = balance.mul(rewardDuration);

      const chances = await rewardPool.viewChanceOfDraw(user.address);
      const numerator = chances[0];
      const denominator = chances[1];

      const chances1 = await rewardPool.viewChanceOfDraw(user1.address);
      const numerator1 = chances1[0];
      const denominator1 = chances1[1];

      expect(numerator).to.equal(expectedEndContribution);
      expect(numerator).to.equal(denominator.sub(1));

      expect(numerator1).to.equal(0);
      expect(denominator).to.equal(denominator1);

      await time.increase(rewardDuration * 2);
      await rewardPool.connect(user).closeDraw();
      expect(await rewardPool.drawStatus()).to.equal(drawStatusClosed);
      await rng.setRandomNumber(999);

      const tx2 = await rewardPool.connect(user1).resolveDrawResults(); // Any tom dick or harry can resolve the draw
      const { epoch: epoch2 } =
        await getDrawWinnersFromResolve(tx2);

      await rewardPool.connect(user).claimMyShare(epoch2);
      await checkOwnershipERC721List(
        newPrizeNFTAddresses,
        newPrizeTokenIds,
        user.address
      );
      expect(await rewardPool.drawStatus()).to.equal(drawStatusResolved);
    });
  });

  describe("Multiple rounds of running a draw", function () {
    it("It should be able to go through multiple rounds of draw, without rewards programme (same)", async function () {
      const {
        owner,
        rewardPool,
        factory,
        user,
        user1,
        lpTokenId,
        lpTokenId1,
        startTime,
        rng,
      } = await loadFixture(rewardPoolDrawFixture);

      let thisStartTime = startTime;
      // Iterate through 10 rounds
      for (let i = 0; i < 3; i++) {
        const expectedEpoch = i + 1;
        // Stake LP tokens and they have the correct amount
        await runTwoParticipantDraw(
          factory,
          user,
          user1,
          rewardPool,
          lpTokenId,
          lpTokenId1,
          rewardDuration,
          thisStartTime,
          expectedEpoch
        );

        // Close the draw
        await time.increase(rewardDuration);
        if (expectedEpoch === 1) {
          const settx = await rewardPool.connect(owner).setPrizePerWinner(40) // this sets the divisbility of the prize
          // console.log(await getPrizesPerWinnerFromSet(settx))
        }

        await rewardPool.connect(user1).closeDraw();
        expect(await rewardPool.drawStatus()).to.equal(drawStatusClosed);

        // Withdraw LP tokens
        await rewardPool.connect(user1).exit(lpTokenId1);
        await rng.setRandomNumber(999 + i);

        // Resolve the draw
        const tx = await rewardPool.connect(user1).resolveDrawResults();
        const { winners, epoch } = await getDrawWinnersFromResolve(tx);
        // console.log(winners,epoch)
        expect(await rewardPool.drawStatus()).to.equal(drawStatusResolved);
        
        // Expect winners to be ok
        const numberWinners = (
          await rewardPool.connect(user).epochWinnerConfigs(epoch)
          ).numberOfDrawWinners;
        // console.log(11)
        expect(winners.length).to.equal(numberWinners);
        expect(winners).to.include(user.address);
        expect(winners).to.include(user1.address);
        expect(epoch).to.equal(expectedEpoch);

        // Recharge the vault
        const numNewPrizesThisEpoch = 50;
        const { newPrizeNFTAddresses, newPrizeTokenIds } =
          await setUpNewPrizeNFT(numNewPrizesThisEpoch, owner, rewardPool);
        // console.log(newPrizeNFTAddresses, newPrizeTokenIds,newPrizeTokenIds.length);
        const rewardTokenAmount = ethers.utils.parseEther("1000");
        const { rewardTokensNew, rewardTokenAmountList } =
          await setUpNewPrizeERC20(owner, rewardPool, rewardTokenAmount);
        thisStartTime = (await time.latest()) + 1000;
        await rewardPool.connect(owner).addNewPrizes(
          newPrizeNFTAddresses,
          newPrizeTokenIds,
          rewardTokensNew.map((t) => t.address),
          rewardTokenAmountList,
          prizesPerWinner,
          thisStartTime,
          thisStartTime + rewardDuration
        );
        // console.log(12)
        let empiricalEpoch = await rewardPool.thisEpoch();
        // console.log('empirical',empiricalEpoch,expectedEpoch)
        // console.log('def',await rewardPool.epochPrizeSets(empiricalEpoch));
      }
    }).timeout(100000);

    it("It should be able to go through multiple rounds of draw + rewards programme (same)", async function () {
      const {
        owner,
        rewardPool,
        factory,
        user,
        user1,
        lpTokenId,
        lpTokenId1,
        startTime,
        rng,
        rewardTokens,
      } = await loadFixture(rewardPoolDrawFixture);

      let thisStartTime = startTime;
      let balanceTracking = [];
      // Iterate through rewardTokens
      for (let i = 0; i < rewardTokens.length; i++) {
        const rewardToken = rewardTokens[i];
        const myBalance = await rewardToken.balanceOf(user.address);
        const myBalance1 = await rewardToken.balanceOf(user1.address);
        balanceTracking.push(myBalance.add(myBalance1));
      }

      let prevBalanceTracking = balanceTracking;

      // Iterate through 3 rounds
      for (let i = 0; i < 3; i++) {
        const expectedEpoch = i + 1;
        // Stake LP tokens and they have the correct amount
        await runTwoParticipantDraw(
          factory,
          user,
          user1,
          rewardPool,
          lpTokenId,
          lpTokenId1,
          rewardDuration,
          thisStartTime,
          expectedEpoch
        );

        // Close the draw
        await time.increase(rewardDuration);
        if (expectedEpoch === 1) {
          const settx = await rewardPool.connect(owner).setPrizePerWinner(40) // this sets the divisbility of the prize
          // console.log(await getPrizesPerWinnerFromSet(settx))
        }
        await rewardPool.connect(user1).closeDraw();
        expect(await rewardPool.drawStatus()).to.equal(drawStatusClosed);

        // Withdraw LP tokens
        await rewardPool.connect(user1).exit(lpTokenId1);
        await rng.setRandomNumber(999 + i);

        // Resolve the draw
        const tx = await rewardPool.connect(user1).resolveDrawResults();
        const { winners, epoch } = await getDrawWinnersFromResolve(tx);
        expect(await rewardPool.drawStatus()).to.equal(drawStatusResolved);

        // Expect winners to be ok
        const numberWinners = (
          await rewardPool.connect(user).epochWinnerConfigs(epoch)
        ).numberOfDrawWinners;

        expect(winners.length).to.equal(numberWinners);
        expect(winners).to.include(user.address);
        expect(winners).to.include(user1.address);
        expect(epoch).to.equal(expectedEpoch);

        // Recharge the vault
        const numNewPrizesThisEpoch = 50;
        const { newPrizeNFTAddresses, newPrizeTokenIds } =
          await setUpNewPrizeNFT(numNewPrizesThisEpoch, owner, rewardPool);
        const drawTokenAmount = ethers.utils.parseEther("1000");
        const {
          rewardTokensNew: drawTokensNew,
          rewardTokenAmountList: drawTokenAmountList,
        } = await setUpNewPrizeERC20(owner, rewardPool, drawTokenAmount);
        thisStartTime = (await time.latest()) + 1000;
        const thisEndTime = thisStartTime + rewardDuration;
        await rewardPool.connect(owner).addNewPrizes(
          newPrizeNFTAddresses,
          newPrizeTokenIds,
          drawTokensNew.map((t) => t.address),
          drawTokenAmountList,
          prizesPerWinner,
          thisStartTime,
          thisEndTime
        );

        const newRewardAmount = ethers.utils.parseEther("1000");
        balanceTracking = [];
        for (let i = 0; i < rewardTokens.length; i++) {
          const rewardToken = rewardTokens[i];
          const myBalance = await rewardToken.balanceOf(user.address);
          const myBalance1 = await rewardToken.balanceOf(user1.address);
          balanceTracking.push(myBalance.add(myBalance1));
        }

        if (epoch > 1) {
          for (let i = 0; i < rewardTokens.length; i++) {
            const rewardToken = rewardTokens[i];
            const prevBalance = prevBalanceTracking[i];
            const balance = balanceTracking[i];
            // Const reward = newRewardAmount
            expect(balance.sub(prevBalance)).to.approximately(
              newRewardAmount,
              newRewardAmount.div(10000)
            );
          }
        }

        prevBalanceTracking = balanceTracking;

        for (let i = 0; i < rewardTokens.length; i++) {
          await rewardTokens[i].mint(owner.address, newRewardAmount);
          await rewardTokens[i].approve(rewardPool.address, newRewardAmount);
        }

        await rewardPool.connect(owner).rechargeRewardPool(
          rewardTokens.map((t) => t.address),
          rewardTokens.map(() => newRewardAmount),
          thisEndTime
        );
      }
    }).timeout(100000);
  });

  describe("Can add prizes (access roles)", function () {
    it("Should be able to add new prizes by the deployer of the vault (assume factory is contract)", async function () {
      const { owner, rewardPool } = await loadFixture(rewardPoolDrawFixture);
      const numNewPrizes = 10;
      const { newPrizeNFTAddresses, newPrizeTokenIds } = await setUpNewPrizeNFT(
        numNewPrizes,
        owner,
        rewardPool
      );

      const rewardTokenAmount = ethers.utils.parseEther("100");
      const { rewardTokensNew, rewardTokenAmountList } =
        await setUpNewPrizeERC20(owner, rewardPool, rewardTokenAmount);

      await rewardPool
        .connect(owner)
        .addNewPrizes(
          newPrizeNFTAddresses,
          newPrizeTokenIds,
          rewardTokensNew.map((rewardToken) => rewardToken.address).slice(0, 2),
          rewardTokenAmountList.slice(0, 2),
          prizesPerWinner,
          0,
          0
        );

      // Check that the new prizes are owned by the reward pool
      await checkOwnershipERC721List(
        newPrizeNFTAddresses,
        newPrizeTokenIds,
        rewardPool.address
      );
      // Check that the new prizes are owned by the reward pool
      await checkSufficiencyERC20List(
        rewardTokensNew.map((rewardToken) => rewardToken.address).slice(0, 2),
        rewardTokenAmountList.slice(0, 2),
        rewardPool.address
      );

      const epoch = await rewardPool.thisEpoch();
      const prizeSet = await rewardPool.epochPrizeSets(epoch);
      expect(prizeSet.numERC721Prizes).to.equal(
        numNewPrizes + 0
      );
    });

    it("Should not be able to add new prizes by any other person", async function () {
      const { rewardPool, user1 } = await loadFixture(rewardPoolDrawFixture);
      //   Const { nft: newPrizeNFT } = await nftFixture();
      const numNewPrizes = 10;
      const newNFTOwner = user1;
      const { newPrizeNFTAddresses, newPrizeTokenIds } = await setUpNewPrizeNFT(
        numNewPrizes,
        newNFTOwner,
        rewardPool
      );

      //   //   Add the erc721

      const rewardTokenAmount = ethers.utils.parseEther("100");
      const { rewardTokensNew, rewardTokenAmountList } =
        await setUpNewPrizeERC20(newNFTOwner, rewardPool, rewardTokenAmount);

      // //   Add the erc20
      await expect(
        rewardPool.connect(newNFTOwner).addNewPrizes(
          newPrizeNFTAddresses,
          newPrizeTokenIds,
          rewardTokensNew.map((rewardToken) => rewardToken.address),
          rewardTokenAmountList,
          prizesPerWinner,
          0,
          0
        )
      ).to.be.revertedWithCustomError(rewardPool, "CallerNotDeployer");
    });

    it("Should not be able to add prizes if the draw is closed+resolved (but okay if just closed and not resolved)", async function () {
      const { rewardPool, lpTokenId, user1, rng } = await loadFixture(
        rewardPoolDrawFixture
      );
      await factory.approve(rewardPool.address, lpTokenId);

      await rewardPool.stake(lpTokenId);
      const periodFinish = await rewardPool.periodFinish();

      // Mine to after rewards finish
      await time.increase(2 * rewardDuration);
      await rewardPool.withdraw(lpTokenId);
      const lastUpdateTime2 = await rewardPool.lastUpdateTime();

      expect(lastUpdateTime2).to.be.gte(periodFinish);
      await expect(
        rewardPool.connect(user1).addNewPrizes([], [], [], [], 1, 0, 0)
      ).to.be.revertedWithCustomError(rewardPool, "CallerNotDeployer");

      await rewardPool.connect(user1).closeDraw();
      const numNewPrizes = 10;
      const { newPrizeNFTAddresses, newPrizeTokenIds } = await setUpNewPrizeNFT(
        numNewPrizes,
        owner,
        rewardPool
      );
      await expect(
        rewardPool
          .connect(owner)
          .addNewPrizes(newPrizeNFTAddresses, newPrizeTokenIds, [], [], 1, 0, 0)
      ).to.not.be.reverted; // Should be okay

      const {
        newPrizeNFTAddresses: newPrizeNFTAddresses2,
        newPrizeTokenIds: newPrizeTokenIds2,
      } = await setUpNewPrizeNFT(numNewPrizes, owner, rewardPool);

      await rng.setRandomNumber(1);
      await rewardPool.connect(user1).resolveDrawResults();

      await expect(
        rewardPool
          .connect(owner)
          .addNewPrizes(
            newPrizeNFTAddresses2,
            newPrizeTokenIds2,
            [],
            [],
            1,
            0,
            0
          )
      ).to.be.revertedWithCustomError(rewardPool, "IncorrectDrawStatus");
    });
  });
});
