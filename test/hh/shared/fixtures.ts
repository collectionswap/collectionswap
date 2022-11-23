import { time } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";

import { config, CURVE_TYPE } from "./constants";
import { createPairEth, mintNfts } from "./helpers";
import { getSigners } from "./signers";

import type { ICurve, IERC721 } from "../../../typechain-types";
import type { curveType } from "./constants";
import type { BigNumber } from "ethers";

const NUM_REWARD_TOKENS = 2;
const DAY_DURATION = 86400;
const REWARD_DURATION = DAY_DURATION;
const REWARDS = [ethers.utils.parseEther("5"), ethers.utils.parseEther("7")];

function parsePropsAndState(
  rawPropsTypes: string[],
  rawProps: any[],
  rawStateTypes: string[],
  rawState: any[]
): { props: any; state: any } {
  return {
    props: ethers.utils.defaultAbiCoder.encode(rawPropsTypes, rawProps),
    state: ethers.utils.defaultAbiCoder.encode(rawStateTypes, rawState),
  };
}

export function getCurveParameters(): {
  rawSpot: number;
  spotPrice: string;
  delta: string;
  props: any;
  state: any;
  fee: string;
  protocolFee: string;
  carryFee: string;
} {
  const {
    bigPctProtocolFee,
    bigPctCarryFee,
    bigPctFee,
    bigDelta,
    bigSpot,
    rawSpot,
    rawPropsTypes,
    rawProps,
    rawStateTypes,
    rawState,
  } = config;

  const { props, state } = parsePropsAndState(
    rawPropsTypes,
    rawProps,
    rawStateTypes,
    rawState
  );

  return {
    rawSpot,
    spotPrice: bigSpot,
    delta: bigDelta,
    props,
    state,
    fee: bigPctFee,
    protocolFee: bigPctProtocolFee,
    carryFee: bigPctCarryFee,
  };
}

export async function integrationFixture() {
  const { owner, protocol, user } = await getSigners();
  const { collectionswap, collectionstaker, curve } =
    await collectionstakerFixture();
  const { monotonicIncreasingValidator } = await validatorFixture();
  const rewardTokens = (await rewardTokenFixture()).slice(0, NUM_REWARD_TOKENS);
  const { nft } = await nftFixture();

  for (let i = 0; i < NUM_REWARD_TOKENS; i++) {
    await rewardTokens[i].mint(protocol.address, REWARDS[i]);
  }

  const {
    fee: bigPctFee,
    delta: bigDelta,
    spotPrice: bigSpot,
    props,
    state,
  } = getCurveParameters();

  return {
    collectionswap: collectionswap.connect(user),
    collectionstaker: collectionstaker.connect(protocol),
    monotonicIncreasingValidator,
    curve: curve as unknown as ICurve,
    rewardTokens: rewardTokens.map((rewardToken) =>
      rewardToken.connect(protocol)
    ),
    rewards: REWARDS,
    nft,
    owner,
    protocol,
    user,
    numRewardTokens: NUM_REWARD_TOKENS,
    bigDelta,
    bigSpot,
    bigPctFee,
    props,
    state,
  };
}

export async function collectionswapFixture() {
  const { collection } = await getSigners();

  const { curve, lsSVMPairFactory } = await lsSVMFixture();
  const Collectionswap = await ethers.getContractFactory("Collectionswap");
  const collectionswap = await Collectionswap.connect(collection).deploy(
    lsSVMPairFactory.address
  );

  return { curve, collectionswap, collection };
}

export async function collectionstakerFixture() {
  const { collectionswap, collection, curve } = await collectionswapFixture();
  const Collectionstaker = await ethers.getContractFactory("Collectionstaker");
  const collectionstaker = await Collectionstaker.connect(collection).deploy(
    collectionswap.address
  );
  await collectionswap.connect(collection).setSenderSpecifierOperator(collectionstaker.address, true);
  return { collectionswap, collectionstaker, curve, collection };
}

export async function collectionstakerWithRewardsFixture() {
  const { protocol } = await getSigners();
  const { collectionstaker, curve, collection } =
    await collectionstakerFixture();
  const { monotonicIncreasingValidator } = await validatorFixture();
  const rewardTokens = (await rewardTokenFixture()).slice(0, NUM_REWARD_TOKENS);
  const { nft } = await nftFixture();

  return {
    collectionstaker: collectionstaker.connect(protocol),
    monotonicIncreasingValidator,
    collection,
    curve,
    rewardTokens,
    rewards: REWARDS,
    numRewardTokens: NUM_REWARD_TOKENS,
    nft,
    protocol,
  };
}

export async function rewardTokenFixture() {
  const RewardToken = await ethers.getContractFactory(
    "ERC20PresetMinterPauser"
  );
  return Promise.all(
    [...Array(5).keys()].map(async (_) => {
      return RewardToken.deploy("Reward Token", "RWT");
    })
  );
}

export async function nftFixture() {
  const NFT = await ethers.getContractFactory("ERC721PresetMinterPauserAutoId");
  const nft = await NFT.deploy("NFT", "NFT", "");
  return { nft };
}

export async function lsSVMFixture() {
  const { sudoswap } = await getSigners();

  const LSSVMPairEnumerableETH = await ethers.getContractFactory(
    "LSSVMPairEnumerableETH"
  );
  const lsSVMPairEnumerableETH = await LSSVMPairEnumerableETH.connect(
    sudoswap
  ).deploy();

  const LSSVMPairMissingEnumerableETH = await ethers.getContractFactory(
    "LSSVMPairMissingEnumerableETH"
  );
  const lsSVMPairMissingEnumerableETH =
    await LSSVMPairMissingEnumerableETH.connect(sudoswap).deploy();

  const LSSVMPairEnumerableERC20 = await ethers.getContractFactory(
    "LSSVMPairEnumerableERC20"
  );
  const lsSVMPairEnumerableERC20 = await LSSVMPairEnumerableERC20.connect(
    sudoswap
  ).deploy();

  const LSSVMPairMissingEnumerableERC20 = await ethers.getContractFactory(
    "LSSVMPairMissingEnumerableERC20"
  );
  const lsSVMPairMissingEnumerableERC20 =
    await LSSVMPairMissingEnumerableERC20.connect(sudoswap).deploy();

  const protocolFeeRecipient = ethers.constants.AddressZero;
  const protocolFeeMultiplier = ethers.utils.parseEther("0.05");
  const carryFeeMultiplier = ethers.utils.parseEther("0.05");

  const LSSVMPairFactory = await ethers.getContractFactory("LSSVMPairFactory");
  const lsSVMPairFactory = await LSSVMPairFactory.connect(sudoswap).deploy(
    lsSVMPairEnumerableETH.address,
    lsSVMPairMissingEnumerableETH.address,
    lsSVMPairEnumerableERC20.address,
    lsSVMPairMissingEnumerableERC20.address,
    protocolFeeRecipient,
    protocolFeeMultiplier,
    carryFeeMultiplier
  );

  // Deploy all contract types and set them allowed. Return only the desired
  // curve
  const ExponentialCurve = await ethers.getContractFactory("ExponentialCurve");
  const exponentialCurve = await ExponentialCurve.connect(sudoswap).deploy();
  await lsSVMPairFactory.setBondingCurveAllowed(exponentialCurve.address, true);

  const LinearCurve = await ethers.getContractFactory("LinearCurve");
  const linearCurve = await LinearCurve.connect(sudoswap).deploy();
  await lsSVMPairFactory.setBondingCurveAllowed(linearCurve.address, true);

  const SigmoidCurve = await ethers.getContractFactory("SigmoidCurve");
  const sigmoidCurve = await SigmoidCurve.connect(sudoswap).deploy();
  await lsSVMPairFactory.setBondingCurveAllowed(sigmoidCurve.address, true);

  const map: { [key in curveType]: any } = {
    linear: linearCurve,
    exponential: exponentialCurve,
    sigmoid: sigmoidCurve,
  };

  return {
    curve: map[CURVE_TYPE!],
    lsSVMPairFactory,
  };
}

function stringToBigNumber(value: string): BigNumber {
  return ethers.BigNumber.from(value);
}

/**
 * Has everything needed for DeployCollectionSwap suite. Trim down when we have
 * time, but convenient for now.
 */
export async function everythingFixture() {
  const LSSVMPairEnumerableETH = await ethers.getContractFactory(
    "LSSVMPairEnumerableETH"
  );
  const lssvmPairEnumerableETH = await LSSVMPairEnumerableETH.deploy();

  const LSSVMPairMissingEnumerableETH = await ethers.getContractFactory(
    "LSSVMPairMissingEnumerableETH"
  );
  const lssvmPairMissingEnumerableETH =
    await LSSVMPairMissingEnumerableETH.deploy();

  const LSSVMPairEnumerableERC20 = await ethers.getContractFactory(
    "LSSVMPairEnumerableERC20"
  );
  const lssvmPairEnumerableERC20 = await LSSVMPairEnumerableERC20.deploy();

  const LSSVMPairMissingEnumerableERC20 = await ethers.getContractFactory(
    "LSSVMPairMissingEnumerableERC20"
  );
  const lssvmPairMissingEnumerableERC20 =
    await LSSVMPairMissingEnumerableERC20.deploy();
  const payoutAddress = ethers.constants.AddressZero;

  const {
    protocolFee: bigPctProtocolFee,
    carryFee: bigPctCarryFee,
    fee: bigPctFee,
    delta: bigDelta,
    spotPrice: bigSpot,
    rawSpot,
    props,
    state,
  } = getCurveParameters();

  const LSSVMPairFactory = await ethers.getContractFactory("LSSVMPairFactory");
  const lssvmPairFactory = await LSSVMPairFactory.deploy(
    lssvmPairEnumerableETH.address,
    lssvmPairMissingEnumerableETH.address,
    lssvmPairEnumerableERC20.address,
    lssvmPairMissingEnumerableERC20.address,
    payoutAddress,
    stringToBigNumber(bigPctProtocolFee),
    stringToBigNumber(bigPctCarryFee)
  );
  // Console.log(`LSSVMPairFactory deployed to ${lssvmPairFactory.address}`)

  const [
    otherAccount0,
    otherAccount1,
    otherAccount2,
    otherAccount3,
    otherAccount4,
    otherAccount5,
  ] = await ethers.getSigners();
  // Console.log([otherAccount0.address, otherAccount1.address, otherAccount2.address, otherAccount3.address, otherAccount4.address])

  const MyERC721 = await ethers.getContractFactory("Test721Enumerable");
  const myERC721 = await MyERC721.deploy();

  const MyERC1155 = await ethers.getContractFactory("Test1155");
  const myERC1155 = await MyERC1155.deploy();

  // Deploy all curve contracts and assign the desired curve to `curve`
  const LinearCurve = await ethers.getContractFactory("LinearCurve");
  const linearCurve = await LinearCurve.deploy();

  const ExponentialCurve = await ethers.getContractFactory("ExponentialCurve");
  const exponentialCurve = await ExponentialCurve.deploy();

  const SigmoidCurve = await ethers.getContractFactory("SigmoidCurve");
  const sigmoidCurve = await SigmoidCurve.deploy();

  const map: { [key in curveType]: any } = {
    linear: linearCurve,
    exponential: exponentialCurve,
    sigmoid: sigmoidCurve,
  };
  const curve = map[CURVE_TYPE!];

  const nftContractCollection = myERC721;
  const nftContractCollection1155 = myERC1155;
  const assetRecipient = ethers.constants.AddressZero;
  const poolType = 2; // TRADE

  const initialNFTIDs = [...Array(3).keys()].map((num) => num + 1234);
  await lssvmPairFactory.setBondingCurveAllowed(curve.address, true);

  const Collectionswap = await ethers.getContractFactory("Collectionswap");
  const collectionswap = await Collectionswap.deploy(lssvmPairFactory.address);
  // Console.log(`Collectionswap deployed to ${collectionswap.address}`)

  const ret = {
    collectionswap,
    lssvmPairFactory,
    lssvmPairEnumerableETH,
    lssvmPairMissingEnumerableETH,
    lssvmPairEnumerableERC20,
    lssvmPairMissingEnumerableERC20,
    curve,
    nftContractCollection,
    assetRecipient,
    poolType,
    bigPctProtocolFee: stringToBigNumber(bigPctProtocolFee),
    delta: stringToBigNumber(bigDelta),
    fee: stringToBigNumber(bigPctFee),
    spotPrice: stringToBigNumber(bigSpot),
    initialNFTIDs,
    rawSpot,
    props,
    state,
    otherAccount0,
    otherAccount1,
    otherAccount2,
    otherAccount3,
    otherAccount4,
    otherAccount5,
    nftContractCollection1155,
  };

  return ret;
}

export async function rewardPoolETHAtomicFixture() {
  // Let lpTokenId: BigNumberish;
  // let lpTokenId1: BigNumberish;
  const { owner, user, user1, collection } = await getSigners();

  let { collectionswap, curve } = await collectionswapFixture();
  const allRewardTokens = await rewardTokenFixture();
  const rewardTokens = allRewardTokens.slice(0, NUM_REWARD_TOKENS);
  let { nft } = await nftFixture();

  const startTime = (await time.latest()) + 1000;
  const endTime = startTime + REWARD_DURATION;
  const rewardRates = REWARDS.map((reward) => reward.div(endTime - startTime));
  // EndTime = startTime - 1000
  // console.log(rewardTokens.map((rewardToken) => rewardToken.address))

  const RewardPool = await ethers.getContractFactory("RewardPoolETH");
  let rewardPool = await RewardPool.connect(collectionswap.signer).deploy();

  const { delta, fee, spotPrice, props, state } = getCurveParameters();
  await rewardPool.initialize(
    collection.address,
    owner.address,
    collectionswap.address,
    nft.address,
    curve.address,
    delta,
    fee,
    rewardTokens.map((rewardToken) => rewardToken.address),
    rewardRates,
    startTime,
    endTime
  );

  for (let i = 0; i < NUM_REWARD_TOKENS; i++) {
    await rewardTokens[i].mint(rewardPool.address, REWARDS[i]);
  }

  const nftTokenIds = await mintNfts(nft, user.address);

  collectionswap = collectionswap.connect(user);
  nft = nft.connect(user);
  rewardPool = rewardPool.connect(user);

  const params = {
    bondingCurve: curve as unknown as ICurve,
    delta,
    fee,
    spotPrice,
    props,
    state,
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
    rewards: REWARDS,
    nft,
    curve,
    params,
    // LpTokenId,
    // lpTokenId1,
    rewardPool,
    owner,
    user,
    user1,
    collection,
    nftTokenIds,
  };
}

export async function rewardPoolFixture() {
  const { owner, user, user1, collection } = await getSigners();

  let { collectionswap, curve } = await collectionswapFixture();
  const { monotonicIncreasingValidator } = await validatorFixture();
  const allRewardTokens = await rewardTokenFixture();
  const rewardTokens = allRewardTokens.slice(0, NUM_REWARD_TOKENS);
  let { nft } = await nftFixture();

  const startTime = (await time.latest()) + 1000;
  const endTime = startTime + REWARD_DURATION;
  const rewardRates = REWARDS.map((reward) => reward.div(endTime - startTime));
  // EndTime = startTime - 1000
  // console.log(rewardTokens.map((rewardToken) => rewardToken.address))
  const { delta, fee, spotPrice, props, state } = getCurveParameters();

  const RewardPool = await ethers.getContractFactory("RewardPoolETH");
  let rewardPool = await RewardPool.connect(collectionswap.signer).deploy();

  const Clones = await ethers.getContractFactory("TestClones");
  const clones = await Clones.deploy();
  const rewardPoolAddress = await clones.callStatic.clone(rewardPool.address);
  await clones.clone(rewardPool.address);
  rewardPool = RewardPool.attach(rewardPoolAddress);

  await rewardPool.initialize(
    collection.address,
    owner.address,
    collectionswap.address,
    monotonicIncreasingValidator.address,
    nft.address,
    curve.address,
    { spotPrice: 0, delta, props: [], state: [] },
    fee,
    rewardTokens.map((rewardToken) => rewardToken.address),
    rewardRates,
    startTime,
    endTime
  );

  for (let i = 0; i < NUM_REWARD_TOKENS; i++) {
    await rewardTokens[i].mint(rewardPool.address, REWARDS[i]);
  }

  const nftTokenIds = await mintNfts(nft, user.address);
  const nftTokenIds1 = await mintNfts(nft, user1.address);

  collectionswap = collectionswap.connect(user);
  nft = nft.connect(user);
  rewardPool = rewardPool.connect(user);

  const params = {
    bondingCurve: curve as unknown as ICurve,
    delta,
    fee,
    spotPrice,
    props,
    state,
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
    monotonicIncreasingValidator,
    allRewardTokens,
    rewardTokens,
    rewards: REWARDS,
    nft,
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

export async function validatorFixture() {
  const MonotonicIncreasingValidator = await ethers.getContractFactory(
    "MonotonicIncreasingValidator"
  );
  const monotonicIncreasingValidator =
    await MonotonicIncreasingValidator.deploy();

  return { monotonicIncreasingValidator };
}
