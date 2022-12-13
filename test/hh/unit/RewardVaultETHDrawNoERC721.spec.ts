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
import {
  checkOwnershipERC721List,
  checkSufficiencyERC20List,
  createPoolEth,
  mintNfts,
} from "../shared/helpers";
import { getSigners } from "../shared/signers";

import type {
  CollectionPoolFactory,
  ICurve,
  IERC721,
  RewardVaultETHDraw,
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

// Async function getPrizesPerWinnerFromSet(tx: ContractTransaction) {
//   const receipt = await tx.wait();
//   // Console.log(receipt)
//   const event = receipt.events?.find(
//     (e) => e.event === "PrizesPerWinnerUpdated"
//   );
//   console.log(event?.args);
//   const epoch = event?.args?.epoch;
//   const numPrizesPerWinner = event?.args?.numPrizesPerWinner;
//   return { numPrizesPerWinner, epoch };
// }

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
  factory: CollectionPoolFactory,
  user: SignerWithAddress,
  user1: SignerWithAddress,
  rewardVault: RewardVaultETHDraw,
  lpTokenId: BigNumberish,
  lpTokenId1: BigNumberish,
  rewardDuration: number,
  startTime: number,

  epoch?: number
) {
  await factory.connect(user).setApprovalForAll(rewardVault.address, true);
  await rewardVault.connect(user).stake(lpTokenId);
  await factory.connect(user1).setApprovalForAll(rewardVault.address, true);
  await rewardVault.connect(user1).stake(lpTokenId1);

  if (epoch) {
    // Console.log(startTime, await rewardVault.epochToStartTime(epoch));
    expect(startTime).to.be.equal(await rewardVault.epochToStartTime(epoch));
  }

  const actualEpoch = await rewardVault.thisEpoch();

  //   Const periodFinish = await rewardVault.periodFinish();
  const periodFinish = await rewardVault.epochToFinishTime(actualEpoch);
  const balance = await rewardVault.balanceOf(user.address);
  const balance1 = await rewardVault.balanceOf(user1.address);

  expect(balance).to.not.equal(0);
  expect(balance1).to.not.equal(0);

  // Mine to halfway through
  await time.increase(rewardDuration / 2);
  await rewardVault.exit(lpTokenId);
  expect(await rewardVault.balanceOf(user.address)).to.equal(0);
  //   Const lastUpdateTime2 = await rewardVault.lastUpdateTime();

  const lastUpdateTime2 = (await rewardVault.lastTWAPObservation(user.address))
    .timestamp;

  //   Expect(lastUpdateTime2).to.be.gt(lastUpdateTime);
  //   expect(lastUpdateTime2).to.be.gt(startTime);

  const isBeforeStart = lastUpdateTime2.eq(startTime);

  const expectedEndContribution = lastUpdateTime2.sub(startTime).mul(balance);
  const expectedEndContribution1 = periodFinish.sub(startTime).mul(balance1);

  expect(await factory.ownerOf(lpTokenId)).to.equal(user.address);
  expect(await rewardVault.balanceOf(user.address)).to.equal(0);

  expect(await factory.ownerOf(lpTokenId1)).to.equal(rewardVault.address);
  expect(await rewardVault.balanceOf(user1.address)).to.not.equal(0);

  const chances = await rewardVault.viewChanceOfDraw(user.address);
  const numerator = chances[0];
  const denominator = chances[1];

  const chances1 = await rewardVault.viewChanceOfDraw(user1.address);
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
  targetPool: RewardVaultETHDraw,
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
  targetPool: RewardVaultETHDraw
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

describe("RewardVaultETHDraw", function () {
  let factory: CollectionPoolFactory;
  let owner: SignerWithAddress;
  let protocolFactorySigner: SignerWithAddress;

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
    ({ factory, owner, protocolFactorySigner } = await loadFixture(
      rewardVaultDrawFixture
    ));
  });

  async function rewardVaultDrawFixture() {
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

    // Const RewardVault = await ethers.getContractFactory("RewardVaultETHDraw");

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
      0,
      ethers.constants.HashZero,
      rewardTokens.map((rewardToken) => rewardToken.address),
      rewards,
      startTime,
      endTime,
      drawERC20Tokens,
      drawERC20TokenAmounts,
      [], // ShuffledNFTAddresses,
      [], // ShuffledNFTTokenIds,
      prizesPerWinner,
      startTime,
      endTime
    );
    const { poolAddress: rewardVaultAddress } = await getVaultAddress(tx);
    let rewardVault = await ethers.getContractAt(
      "RewardVaultETHDraw",
      rewardVaultAddress
    );

    const nftTokenIds = await mintNfts(nft, user.address);
    const nftTokenIds1 = await mintNfts(nft, user1.address);

    factory = factory.connect(user);
    nft = nft.connect(user);
    rewardVault = rewardVault.connect(user);

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

    const { lpTokenId } = await createPoolEth(factory, {
      ...params,
      nft: nft as unknown as IERC721,
      nftTokenIds,
    });

    const { lpTokenId: lpTokenId1 } = await createPoolEth(
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
    //   rewardVault.address
    // );

    // Console.log(shuffledNFTAddresses,shuffledNFTTokenIds)

    // Iterate through drawERC20Tokens and drawERC20TokenAmounts and check that they are owned by reward pool
    await checkSufficiencyERC20List(
      drawERC20Tokens,
      drawERC20TokenAmounts,
      rewardVault.address
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
      rewardVault,
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
      await loadFixture(rewardVaultDrawFixture);
    });

    it("Should have correct state variables", async function () {
      const { rewardVault, user } = await loadFixture(rewardVaultDrawFixture);

      // Expect rewardVault to have drawOpen status
      expect(await rewardVault.drawStatus()).to.equal(drawStatusOpen);

      const epoch = await rewardVault.thisEpoch();
      const prizeSet = await rewardVault.epochPrizeSets(epoch);
      expect(prizeSet.numERC721Prizes).to.equal(
        0
        // NumPerERC721Token * numDistinctERC721Tokens
      );

      const chances = await rewardVault.viewChanceOfDraw(user.address);
      const numerator = chances[0];
      const denominator = chances[1];

      expect(numerator).to.equal(0);
      expect(denominator).to.equal(1);
    });
  });

  describe("Stake/Withdraw", function () {
    it("Can stake and acquire chances", async function () {
      const { rewardVault, lpTokenId, user } = await loadFixture(
        rewardVaultDrawFixture
      );
      await factory.connect(user).setApprovalForAll(rewardVault.address, true);

      await rewardVault.stake(lpTokenId);

      const lastUpdateTime = await rewardVault.lastUpdateTime();
      const periodFinish = await rewardVault.periodFinish();
      const balance = await rewardVault.balanceOf(user.address);

      const expectedEndContribution = periodFinish
        .sub(lastUpdateTime)
        .mul(balance);

      expect(await factory.ownerOf(lpTokenId)).to.equal(rewardVault.address);
      expect(await rewardVault.balanceOf(user.address)).to.not.equal(0);

      const chances = await rewardVault.viewChanceOfDraw(user.address);
      const numerator = chances[0];
      const denominator = chances[1];

      // Expect numerator to be greater than 0
      expect(numerator).to.not.equal(0);
      expect(numerator).to.be.equal(expectedEndContribution);

      // Expect numerator = denominator -1
      expect(numerator).to.equal(denominator.sub(1));
    });

    it("One can stake, withdraw before pool start (chances)", async function () {
      const { rewardVault, lpTokenId, user } = await loadFixture(
        rewardVaultDrawFixture
      );
      await factory.approve(rewardVault.address, lpTokenId);

      await rewardVault.stake(lpTokenId);
      const lastUpdateTime = await rewardVault.lastUpdateTime();
      await rewardVault.withdraw(lpTokenId);
      const lastUpdateTime2 = await rewardVault.lastUpdateTime();

      const isBeforeStart = lastUpdateTime.eq(lastUpdateTime2);

      expect(await factory.ownerOf(lpTokenId)).to.equal(user.address);
      expect(await rewardVault.balanceOf(user.address)).to.equal(0);

      const chances = await rewardVault.viewChanceOfDraw(user.address);
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
      const { rewardVault, lpTokenId, user } = await loadFixture(
        rewardVaultDrawFixture
      );
      await factory.approve(rewardVault.address, lpTokenId);

      await rewardVault.stake(lpTokenId);
      const lastUpdateTime = await rewardVault.lastUpdateTime();
      const balance = await rewardVault.balanceOf(user.address);

      // Mine to halfway through
      await time.increase(rewardDuration / 2);
      await rewardVault.withdraw(lpTokenId);
      const lastUpdateTime2 = await rewardVault.lastUpdateTime();

      const isBeforeStart = lastUpdateTime.eq(lastUpdateTime2);

      const expectedEndContribution = lastUpdateTime2
        .sub(lastUpdateTime)
        .mul(balance);

      expect(await factory.ownerOf(lpTokenId)).to.equal(user.address);
      expect(await rewardVault.balanceOf(user.address)).to.equal(0);

      const chances = await rewardVault.viewChanceOfDraw(user.address);
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
      const { rewardVault, lpTokenId, user } = await loadFixture(
        rewardVaultDrawFixture
      );
      await factory.approve(rewardVault.address, lpTokenId);

      await rewardVault.stake(lpTokenId);
      const lastUpdateTime = await rewardVault.lastUpdateTime();
      const periodFinish = await rewardVault.periodFinish();
      const balance = await rewardVault.balanceOf(user.address);

      // Mine to after rewards finish
      await time.increase(2 * rewardDuration);
      await rewardVault.withdraw(lpTokenId);
      const lastUpdateTime2 = await rewardVault.lastUpdateTime();

      const isBeforeStart = lastUpdateTime.eq(lastUpdateTime2);

      const expectedEndContribution = periodFinish
        .sub(lastUpdateTime)
        .mul(balance);

      expect(await factory.ownerOf(lpTokenId)).to.equal(user.address);
      expect(await rewardVault.balanceOf(user.address)).to.equal(0);

      const chances = await rewardVault.viewChanceOfDraw(user.address);
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
      const { rewardVault, lpTokenId, lpTokenId1, user, user1, startTime } =
        await loadFixture(rewardVaultDrawFixture);

      await runTwoParticipantDraw(
        factory,
        user,
        user1,
        rewardVault,
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
        rewardVault,
        lpTokenId,
        lpTokenId1,
        user,
        user1,
        startTime,
        rng,
        distinctNFTs,
      } = await loadFixture(rewardVaultDrawFixture);

      await runTwoParticipantDraw(
        factory,
        user,
        user1,
        rewardVault,
        lpTokenId,
        lpTokenId1,
        rewardDuration,
        startTime
      );

      const thisPrizePerWinner = 7;
      await rewardVault.connect(owner).setPrizePerWinner(thisPrizePerWinner); // 30 % 7 == 2

      await time.increase(rewardDuration);

      await rewardVault.connect(user1).closeDraw();
      await rng.setRandomNumber(999);
      const tx = await rewardVault.connect(user1).resolveDrawResults();
      const { epoch } = await getDrawWinnersFromResolve(tx);
      // Loop through distinctNFTs
      let beforeBalance = ethers.utils.parseEther("0");
      for (let i = 0; i < distinctNFTs.length; i++) {
        // Check balance of owner
        beforeBalance = beforeBalance.add(
          await distinctNFTs[i].balanceOf(owner.address)
        );
      }

      // Can only sweep after reward sweep time
      const rewardSweepTime = await rewardVault.rewardSweepTime();
      await time.increaseTo(rewardSweepTime);

      // Get numPrizes
      const { remainder } = await rewardVault.getDrawDistribution(epoch);
      const numNFTPrizes = (await rewardVault.epochPrizeSets(epoch))
        .numERC721Prizes;
      // NFTs are swept from the back
      const remainderNfts = [];
      for (let i = 0; i < remainder.toNumber(); ++i) {
        remainderNfts.push(numNFTPrizes.sub(i));
      }

      await rewardVault.connect(owner).sweepUnclaimedNfts(epoch, remainderNfts);
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
      if (numNFTPrizes.toNumber() > 0) {
        await expect(
          rewardVault.connect(owner).sweepUnclaimedNfts(epoch, remainderNfts)
        ).to.be.revertedWith("ERC721: caller is not token owner nor approved");
      }
    });

    it("Should be able to close and resolve", async function () {
      const {
        rewardVault,
        lpTokenId,
        lpTokenId1,
        user,
        user1,
        user2,
        startTime,
        rng,
        distinctNFTs,
        owner,
      } = await loadFixture(rewardVaultDrawFixture);

      await runTwoParticipantDraw(
        factory,
        user,
        user1,
        rewardVault,
        lpTokenId,
        lpTokenId1,
        rewardDuration,
        startTime
      );

      await time.increase(rewardDuration);
      await rewardVault.connect(owner).setPrizePerWinner(40); // This sets the divisbility of the prize

      await rewardVault.connect(user1).closeDraw();
      await rng.setRandomNumber(999);
      const tx = await rewardVault.connect(user1).resolveDrawResults();
      const { winners, epoch } = await getDrawWinnersFromResolve(tx);

      // Console.log(winners, epoch);
      console.log(await rewardVault.getDrawDistribution(epoch));

      // Probabilistic if RNG were not set, which it is. = 999
      const numberWinners = (
        await rewardVault.connect(user).epochWinnerConfigs(epoch)
      ).numberOfDrawWinners;
      expect(winners.length).to.equal(numberWinners);
      expect(winners).to.include(user.address);
      expect(winners).to.include(user1.address);
      expect(epoch).to.equal(1);

      expect(await rewardVault.isPrizeClaimable(epoch, user.address)).to.be
        .true;
      await rewardVault.connect(user).claimMyShare(epoch);
      expect(await rewardVault.isPrizeClaimable(epoch, user.address)).to.be
        .false;

      expect(await rewardVault.isPrizeClaimable(epoch, user1.address)).to.be
        .true;
      await rewardVault.connect(user1).claimMyShare(epoch);
      expect(await rewardVault.isPrizeClaimable(epoch, user1.address)).to.be
        .false;

      await expect(
        rewardVault.connect(user1).claimMyShare(epoch)
      ).to.be.revertedWithCustomError(rewardVault, "NoClaimableShare");
      await expect(
        rewardVault.connect(user2).claimMyShare(epoch)
      ).to.be.revertedWithCustomError(rewardVault, "NoClaimableShare");

      let totalNFTs = ethers.utils.parseEther("0");
      for (let i = 0; i < distinctNFTs.length; i++) {
        // RewardVault should have 0
        expect(await distinctNFTs[i].balanceOf(rewardVault.address)).to.equal(
          0
        );
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
        rewardVault,
        lpTokenId,
        lpTokenId1,
        owner,
        user,
        user1,
        startTime,
        rng,
      } = await loadFixture(rewardVaultDrawFixture);

      await runTwoParticipantDraw(
        factory,
        user,
        user1,
        rewardVault,
        lpTokenId,
        lpTokenId1,
        rewardDuration,
        startTime
      );
      await time.increase(rewardDuration);
      await rewardVault.connect(user1).closeDraw();
      balance = await rewardVault.balanceOf(user.address);
      balance1 = await rewardVault.balanceOf(user1.address);
      expect(balance).to.equal(0);
      expect(balance1).to.not.equal(0);
      expect(await rewardVault.drawStatus()).to.equal(drawStatusClosed);
      await rng.setRandomNumber(999);
      const tx = await rewardVault.connect(user1).resolveDrawResults();
      await getDrawWinnersFromResolve(tx);
      expect(await rewardVault.drawStatus()).to.equal(drawStatusResolved);

      // User1 withdraws his LP tokens in the close period
      await rewardVault.connect(user1).withdraw(lpTokenId1);
      await rewardVault.connect(user).stake(lpTokenId);

      const numIncrementalPrizes = 10;
      const { newPrizeNFTAddresses, newPrizeTokenIds } = await setUpNewPrizeNFT(
        numIncrementalPrizes,
        owner,
        rewardVault
      );
      const rewardTokenAmount = ethers.utils.parseEther("1000");
      const { rewardTokensNew, rewardTokenAmountList } =
        await setUpNewPrizeERC20(owner, rewardVault, rewardTokenAmount);

      const startTime2 = (await time.latest()) + 1000;
      const endTime2 = startTime2 + rewardDuration;

      await checkOwnershipERC721List(
        newPrizeNFTAddresses,
        newPrizeTokenIds,
        owner.address
      );

      await rewardVault.connect(owner).addNewPrizes(
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
        rewardVault.address
      );
      balance = await rewardVault.balanceOf(user.address);
      balance1 = await rewardVault.balanceOf(user1.address);
      expect(balance).to.not.equal(0);
      expect(balance1).to.equal(0);
      //   Console.log("abc");
      //   Console.log(balance)
      const expectedEndContribution = balance.mul(rewardDuration);

      const chances = await rewardVault.viewChanceOfDraw(user.address);
      const numerator = chances[0];
      const denominator = chances[1];

      const chances1 = await rewardVault.viewChanceOfDraw(user1.address);
      const numerator1 = chances1[0];
      const denominator1 = chances1[1];

      expect(numerator).to.equal(expectedEndContribution);
      expect(numerator).to.equal(denominator.sub(1));

      expect(numerator1).to.equal(0);
      expect(denominator).to.equal(denominator1);

      await time.increase(rewardDuration * 2);
      await rewardVault.connect(user).closeDraw();
      expect(await rewardVault.drawStatus()).to.equal(drawStatusClosed);
      await rng.setRandomNumber(999);

      const tx2 = await rewardVault.connect(user1).resolveDrawResults(); // Any tom dick or harry can resolve the draw
      const { epoch: epoch2 } = await getDrawWinnersFromResolve(tx2);

      await rewardVault.connect(user).claimMyShare(epoch2);
      await checkOwnershipERC721List(
        newPrizeNFTAddresses,
        newPrizeTokenIds,
        user.address
      );
      expect(await rewardVault.drawStatus()).to.equal(drawStatusResolved);
    });
  });

  describe("Multiple rounds of running a draw", function () {
    it("It should be able to go through multiple rounds of draw, without rewards programme (same)", async function () {
      const {
        owner,
        rewardVault,
        factory,
        user,
        user1,
        lpTokenId,
        lpTokenId1,
        startTime,
        rng,
      } = await loadFixture(rewardVaultDrawFixture);

      let thisStartTime = startTime;
      // Iterate through 10 rounds
      for (let i = 0; i < 3; i++) {
        const expectedEpoch = i + 1;
        // Stake LP tokens and they have the correct amount
        await runTwoParticipantDraw(
          factory,
          user,
          user1,
          rewardVault,
          lpTokenId,
          lpTokenId1,
          rewardDuration,
          thisStartTime,
          expectedEpoch
        );

        // Close the draw
        await time.increase(rewardDuration);
        if (expectedEpoch === 1) {
          await rewardVault.connect(owner).setPrizePerWinner(40); // This sets the divisbility of the prize
        }

        await rewardVault.connect(user1).closeDraw();
        expect(await rewardVault.drawStatus()).to.equal(drawStatusClosed);

        // Withdraw LP tokens
        await rewardVault.connect(user1).exit(lpTokenId1);
        await rng.setRandomNumber(999 + i);

        // Resolve the draw
        const tx = await rewardVault.connect(user1).resolveDrawResults();
        const { winners, epoch } = await getDrawWinnersFromResolve(tx);
        expect(await rewardVault.drawStatus()).to.equal(drawStatusResolved);

        // Expect winners to be ok
        const numberWinners = (
          await rewardVault.connect(user).epochWinnerConfigs(epoch)
        ).numberOfDrawWinners;
        expect(winners.length).to.equal(numberWinners);
        expect(winners).to.include(user.address);
        expect(winners).to.include(user1.address);
        expect(epoch).to.equal(expectedEpoch);

        // Recharge the vault
        const numNewPrizesThisEpoch = 50;
        const { newPrizeNFTAddresses, newPrizeTokenIds } =
          await setUpNewPrizeNFT(numNewPrizesThisEpoch, owner, rewardVault);
        const rewardTokenAmount = ethers.utils.parseEther("1000");
        const { rewardTokensNew, rewardTokenAmountList } =
          await setUpNewPrizeERC20(owner, rewardVault, rewardTokenAmount);
        thisStartTime = (await time.latest()) + 1000;
        await rewardVault.connect(owner).addNewPrizes(
          newPrizeNFTAddresses,
          newPrizeTokenIds,
          rewardTokensNew.map((t) => t.address),
          rewardTokenAmountList,
          prizesPerWinner,
          thisStartTime,
          thisStartTime + rewardDuration
        );
        await rewardVault.thisEpoch();
      }
    }).timeout(100000);

    it("It should be able to go through multiple rounds of draw + rewards programme (same)", async function () {
      const {
        owner,
        rewardVault,
        factory,
        user,
        user1,
        lpTokenId,
        lpTokenId1,
        startTime,
        rng,
        rewardTokens,
      } = await loadFixture(rewardVaultDrawFixture);

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
          rewardVault,
          lpTokenId,
          lpTokenId1,
          rewardDuration,
          thisStartTime,
          expectedEpoch
        );

        // Close the draw
        await time.increase(rewardDuration);
        if (expectedEpoch === 1) {
          await rewardVault.connect(owner).setPrizePerWinner(40); // This sets the divisbility of the prize
          // console.log(await getPrizesPerWinnerFromSet(settx))
        }

        await rewardVault.connect(user1).closeDraw();
        expect(await rewardVault.drawStatus()).to.equal(drawStatusClosed);

        // Withdraw LP tokens
        await rewardVault.connect(user1).exit(lpTokenId1);
        await rng.setRandomNumber(999 + i);

        // Resolve the draw
        const tx = await rewardVault.connect(user1).resolveDrawResults();
        const { winners, epoch } = await getDrawWinnersFromResolve(tx);
        expect(await rewardVault.drawStatus()).to.equal(drawStatusResolved);

        // Expect winners to be ok
        const numberWinners = (
          await rewardVault.connect(user).epochWinnerConfigs(epoch)
        ).numberOfDrawWinners;

        expect(winners.length).to.equal(numberWinners);
        expect(winners).to.include(user.address);
        expect(winners).to.include(user1.address);
        expect(epoch).to.equal(expectedEpoch);

        // Recharge the vault
        const numNewPrizesThisEpoch = 50;
        const { newPrizeNFTAddresses, newPrizeTokenIds } =
          await setUpNewPrizeNFT(numNewPrizesThisEpoch, owner, rewardVault);
        const drawTokenAmount = ethers.utils.parseEther("1000");
        const {
          rewardTokensNew: drawTokensNew,
          rewardTokenAmountList: drawTokenAmountList,
        } = await setUpNewPrizeERC20(owner, rewardVault, drawTokenAmount);
        thisStartTime = (await time.latest()) + 1000;
        const thisEndTime = thisStartTime + rewardDuration;
        await rewardVault.connect(owner).addNewPrizes(
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
          await rewardTokens[i].approve(rewardVault.address, newRewardAmount);
        }

        await rewardVault.connect(owner).rechargeRewardVault(
          rewardTokens.map((t) => t.address),
          rewardTokens.map(() => newRewardAmount),
          thisEndTime
        );
      }
    }).timeout(100000);
  });

  describe("Can add prizes (access roles)", function () {
    it("Should be able to add new prizes by the deployer of the vault (assume factory is contract)", async function () {
      const { owner, rewardVault } = await loadFixture(rewardVaultDrawFixture);
      const numNewPrizes = 10;
      const { newPrizeNFTAddresses, newPrizeTokenIds } = await setUpNewPrizeNFT(
        numNewPrizes,
        owner,
        rewardVault
      );

      const rewardTokenAmount = ethers.utils.parseEther("100");
      const { rewardTokensNew, rewardTokenAmountList } =
        await setUpNewPrizeERC20(owner, rewardVault, rewardTokenAmount);

      await rewardVault
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
        rewardVault.address
      );
      // Check that the new prizes are owned by the reward pool
      await checkSufficiencyERC20List(
        rewardTokensNew.map((rewardToken) => rewardToken.address).slice(0, 2),
        rewardTokenAmountList.slice(0, 2),
        rewardVault.address
      );

      const epoch = await rewardVault.thisEpoch();
      const prizeSet = await rewardVault.epochPrizeSets(epoch);
      expect(prizeSet.numERC721Prizes).to.equal(numNewPrizes + 0);
    });

    it("Should not be able to add new prizes by any other person", async function () {
      const { rewardVault, user1 } = await loadFixture(rewardVaultDrawFixture);
      //   Const { nft: newPrizeNFT } = await nftFixture();
      const numNewPrizes = 10;
      const newNFTOwner = user1;
      const { newPrizeNFTAddresses, newPrizeTokenIds } = await setUpNewPrizeNFT(
        numNewPrizes,
        newNFTOwner,
        rewardVault
      );

      //   //   Add the erc721

      const rewardTokenAmount = ethers.utils.parseEther("100");
      const { rewardTokensNew, rewardTokenAmountList } =
        await setUpNewPrizeERC20(newNFTOwner, rewardVault, rewardTokenAmount);

      // //   Add the erc20
      await expect(
        rewardVault.connect(newNFTOwner).addNewPrizes(
          newPrizeNFTAddresses,
          newPrizeTokenIds,
          rewardTokensNew.map((rewardToken) => rewardToken.address),
          rewardTokenAmountList,
          prizesPerWinner,
          0,
          0
        )
      ).to.be.revertedWithCustomError(rewardVault, "CallerNotDeployer");
    });

    it("Should not be able to add prizes if the draw is closed+resolved (but okay if just closed and not resolved)", async function () {
      const { rewardVault, lpTokenId, user1, rng } = await loadFixture(
        rewardVaultDrawFixture
      );
      await factory.approve(rewardVault.address, lpTokenId);

      await rewardVault.stake(lpTokenId);
      const periodFinish = await rewardVault.periodFinish();

      // Mine to after rewards finish
      await time.increase(2 * rewardDuration);
      await rewardVault.withdraw(lpTokenId);
      const lastUpdateTime2 = await rewardVault.lastUpdateTime();

      expect(lastUpdateTime2).to.be.gte(periodFinish);
      await expect(
        rewardVault.connect(user1).addNewPrizes([], [], [], [], 1, 0, 0)
      ).to.be.revertedWithCustomError(rewardVault, "CallerNotDeployer");

      await rewardVault.connect(user1).closeDraw();
      const numNewPrizes = 10;
      const { newPrizeNFTAddresses, newPrizeTokenIds } = await setUpNewPrizeNFT(
        numNewPrizes,
        owner,
        rewardVault
      );
      await expect(
        rewardVault
          .connect(owner)
          .addNewPrizes(newPrizeNFTAddresses, newPrizeTokenIds, [], [], 1, 0, 0)
      ).to.not.be.reverted; // Should be okay

      const {
        newPrizeNFTAddresses: newPrizeNFTAddresses2,
        newPrizeTokenIds: newPrizeTokenIds2,
      } = await setUpNewPrizeNFT(numNewPrizes, owner, rewardVault);

      await rng.setRandomNumber(1);
      await rewardVault.connect(user1).resolveDrawResults();

      await expect(
        rewardVault
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
      ).to.be.revertedWithCustomError(rewardVault, "IncorrectDrawStatus");
    });
  });
});
