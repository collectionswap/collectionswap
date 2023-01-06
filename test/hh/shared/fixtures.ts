import { time } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";

import { config, CURVE_TYPE, PoolType } from "./constants";
import { createPoolEth, getPoolAddress, mintRandomNfts } from "./helpers";
import { randomAddress, randomEthValue } from "./random";
import { getSigners } from "./signers";

import type {
  ICurve,
  IERC721,
  CollectionPoolETH,
  CollectionPoolFactory,
  Test721,
  Test721Enumerable,
  Test721EnumerableRoyalty,
  Test721Royalty,
} from "../../../typechain-types";
import type { curveType } from "./constants";
import type { IERC721Mintable } from "./types";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import type { Contract, BigNumber } from "ethers";

const NUM_REWARD_TOKENS = 2;
const DAY_DURATION = 86400;
const REWARD_DURATION = DAY_DURATION;
const REWARDS = [ethers.utils.parseEther("5"), ethers.utils.parseEther("7")];
export const DEFAULT_VALID_ROYALTY = ethers.utils.parseUnits("1", 15);

type EthPoolParams = {
  nft: string;
  bondingCurve: any;
  assetRecipient: string;
  poolType: number;
  delta: BigNumber;
  fee: BigNumber;
  spotPrice: BigNumber;
  props: any;
  state: any;
  royaltyNumerator: BigNumber;
  royaltyRecipientFallback: string;
  receiver: string;
};

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
  royaltyNumerator: string;
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
    royaltyNumerator,
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
    royaltyNumerator,
  };
}

export async function integrationFixture() {
  const { owner, protocol, user } = await getSigners();
  const { factory, collectionstaker, curve } = await collectionstakerFixture();
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
    royaltyNumerator,
  } = getCurveParameters();

  return {
    factory: factory.connect(user),
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
    royaltyNumerator,
  };
}

export async function factoryFixture() {
  const { collection } = await getSigners();

  const { curve, factory } = await deployPoolContracts();

  return { curve, factory, collection };
}

export async function collectionstakerFixture() {
  const { factory, collection, curve } = await factoryFixture();
  const Collectionstaker = await ethers.getContractFactory("Collectionstaker");
  const collectionstaker = await Collectionstaker.connect(collection).deploy(
    factory.address
  );
  return { factory, collectionstaker, curve, collection };
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

export async function test20Fixture() {
  const Test20 = await ethers.getContractFactory("Test20");
  return Test20.deploy();
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

export type NFTFixture = () => Promise<{ nft: IERC721Mintable }>;

export async function test721Fixture(): Promise<{ nft: Test721 }> {
  const Test721 = await ethers.getContractFactory("Test721");
  const test721 = await Test721.deploy();
  return { nft: test721 };
}

export async function test721EnumerableFixture(): Promise<{
  nft: Test721Enumerable;
}> {
  const Test721Enumerable = await ethers.getContractFactory(
    "Test721Enumerable"
  );
  const test721Enumerable = await Test721Enumerable.deploy();
  return { nft: test721Enumerable };
}

export async function test721EnumerableRoyaltyFixture(): Promise<{
  nft: Test721EnumerableRoyalty;
}> {
  const Test721EnumerableRoyalty = await ethers.getContractFactory(
    "Test721EnumerableRoyalty"
  );
  const test721EnumerableRoyalty = await Test721EnumerableRoyalty.deploy();
  return { nft: test721EnumerableRoyalty };
}

export async function test721RoyaltyFixture(): Promise<{
  nft: Test721Royalty;
}> {
  const Test721Royalty = await ethers.getContractFactory("Test721Royalty");
  const test721Royalty = await Test721Royalty.deploy();
  return { nft: test721Royalty };
}

export async function non2981NftFixture() {
  const MyERC721 = await ethers.getContractFactory("Test721Non2981");
  const myERC721 = await MyERC721.deploy();
  return { nft: myERC721 };
}

export async function nftFixture() {
  const { nft: test721 } = await test721Fixture();
  const { nft: test721Enumerable } = await test721EnumerableFixture();
  const { nft: test721Royalty } = await test721RoyaltyFixture();
  const { nft: test721EnumerableRoyalty } =
    await test721EnumerableRoyaltyFixture();
  const MyERC721 = await ethers.getContractFactory("Test721EnumerableRoyalty");
  const myERC721 = await MyERC721.deploy();
  return {
    nft: myERC721,
    test721,
    test721Enumerable,
    test721EnumerableRoyalty,
    test721Royalty,
  };
}

export async function deployCurveContracts(): Promise<{
  [key in curveType | "test"]: Contract;
}> {
  const { collectionDeployer } = await getSigners();

  const ExponentialCurve = await ethers.getContractFactory(
    "ExponentialCurve",
    collectionDeployer
  );
  const exponentialCurve = await ExponentialCurve.deploy();

  const LinearCurve = await ethers.getContractFactory(
    "LinearCurve",
    collectionDeployer
  );
  const linearCurve = await LinearCurve.deploy();

  const SigmoidCurve = await ethers.getContractFactory(
    "SigmoidCurve",
    collectionDeployer
  );
  const sigmoidCurve = await SigmoidCurve.deploy();

  const TestCurve = await ethers.getContractFactory(
    "TestCurve",
    collectionDeployer
  );
  const testCurve = await TestCurve.deploy();

  return {
    linear: linearCurve,
    exponential: exponentialCurve,
    sigmoid: sigmoidCurve,
    test: testCurve,
  };
}

export async function deployPoolContracts() {
  const { collectionDeployer } = await getSigners();

  const CollectionPoolEnumerableETH = await ethers.getContractFactory(
    "CollectionPoolEnumerableETH",
    collectionDeployer
  );
  const collectionPoolEnumerableETH =
    await CollectionPoolEnumerableETH.deploy();

  const CollectionPoolMissingEnumerableETH = await ethers.getContractFactory(
    "CollectionPoolMissingEnumerableETH",
    collectionDeployer
  );
  const collectionPoolMissingEnumerableETH =
    await CollectionPoolMissingEnumerableETH.deploy();

  const CollectionPoolEnumerableERC20 = await ethers.getContractFactory(
    "CollectionPoolEnumerableERC20",
    collectionDeployer
  );
  const collectionPoolEnumerableERC20 =
    await CollectionPoolEnumerableERC20.deploy();

  const CollectionPoolMissingEnumerableERC20 = await ethers.getContractFactory(
    "CollectionPoolMissingEnumerableERC20",
    collectionDeployer
  );
  const collectionPoolMissingEnumerableERC20 =
    await CollectionPoolMissingEnumerableERC20.deploy();

  const protocolFeeRecipient = randomAddress();
  const protocolFeeMultiplier = randomEthValue(0.1);
  const carryFeeMultiplier = randomEthValue(0.5);

  const CollectionPoolFactory = await ethers.getContractFactory(
    "CollectionPoolFactory",
    collectionDeployer
  );
  const collectionPoolFactory = await CollectionPoolFactory.deploy(
    collectionPoolEnumerableETH.address,
    collectionPoolMissingEnumerableETH.address,
    collectionPoolEnumerableERC20.address,
    collectionPoolMissingEnumerableERC20.address,
    protocolFeeRecipient,
    protocolFeeMultiplier,
    carryFeeMultiplier
  );

  const curves = await deployCurveContracts();
  for (const curve of Object.values(curves)) {
    await collectionPoolFactory.setBondingCurveAllowed(curve.address, true);
  }

  return {
    collectionDeployer,
    curve: curves[CURVE_TYPE!],
    curves,
    factory: collectionPoolFactory,
    protocolFeeMultiplier,
    carryFeeMultiplier,
  };
}

function stringToBigNumber(value: string): BigNumber {
  return ethers.BigNumber.from(value);
}

/**
 * Has everything needed for DeployCollectionSet suite. Trim down when we have
 * time, but convenient for now.
 */
export async function everythingFixture() {
  const CollectionPoolEnumerableETH = await ethers.getContractFactory(
    "CollectionPoolEnumerableETH"
  );
  const collectionPoolEnumerableETH =
    await CollectionPoolEnumerableETH.deploy();

  const CollectionPoolMissingEnumerableETH = await ethers.getContractFactory(
    "CollectionPoolMissingEnumerableETH"
  );
  const collectionPoolMissingEnumerableETH =
    await CollectionPoolMissingEnumerableETH.deploy();

  const CollectionPoolEnumerableERC20 = await ethers.getContractFactory(
    "CollectionPoolEnumerableERC20"
  );
  const collectionPoolEnumerableERC20 =
    await CollectionPoolEnumerableERC20.deploy();

  const CollectionPoolMissingEnumerableERC20 = await ethers.getContractFactory(
    "CollectionPoolMissingEnumerableERC20"
  );
  const collectionPoolMissingEnumerableERC20 =
    await CollectionPoolMissingEnumerableERC20.deploy();
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
    royaltyNumerator,
  } = getCurveParameters();

  const CollectionPoolFactory = await ethers.getContractFactory(
    "CollectionPoolFactory"
  );
  const collectionPoolFactory = await CollectionPoolFactory.deploy(
    collectionPoolEnumerableETH.address,
    collectionPoolMissingEnumerableETH.address,
    collectionPoolEnumerableERC20.address,
    collectionPoolMissingEnumerableERC20.address,
    payoutAddress,
    stringToBigNumber(bigPctProtocolFee),
    stringToBigNumber(bigPctCarryFee)
  );
  // Console.log(`CollectionPoolFactory deployed to ${collectionPoolFactory.address}`)

  const [
    otherAccount0,
    otherAccount1,
    otherAccount2,
    otherAccount3,
    otherAccount4,
    otherAccount5,
  ] = await ethers.getSigners();
  // Console.log([otherAccount0.address, otherAccount1.address, otherAccount2.address, otherAccount3.address, otherAccount4.address])

  const MyERC721 = await ethers.getContractFactory("Test721EnumerableRoyalty");
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
  const poolType = PoolType.TRADE;

  const initialNFTIDs = [...Array(3).keys()].map((num) => num + 1234);
  await collectionPoolFactory.setBondingCurveAllowed(curve.address, true);

  const delta = stringToBigNumber(bigDelta);
  const fee = stringToBigNumber(bigPctFee);
  const spotPrice = stringToBigNumber(bigSpot);

  const ret = {
    collectionPoolFactory,
    collectionPoolEnumerableETH,
    collectionPoolMissingEnumerableETH,
    collectionPoolEnumerableERC20,
    collectionPoolMissingEnumerableERC20,
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
    royaltyNumerator,
    otherAccount0,
    otherAccount1,
    otherAccount2,
    otherAccount3,
    otherAccount4,
    otherAccount5,
    nftContractCollection1155,
    // Intentionally left out initialNFTIDs. Set NFT IDs explicitly to prevent
    // screwups
    ethPoolParams: {
      nft: nftContractCollection.address,
      bondingCurve: curve.address,
      assetRecipient,
      receiver: otherAccount0.address,
      poolType,
      delta,
      fee,
      spotPrice,
      props,
      state,
      royaltyNumerator: ethers.BigNumber.from(royaltyNumerator),
      royaltyRecipientFallback: ethers.constants.AddressZero,
    },
  };

  return ret;
}

export function makeRewardVaultFixture(nftFixture: NFTFixture) {
  // eslint-disable-next-line func-names
  return async function rewardVaultFixture() {
    const { owner, user, user1, collection } = await getSigners();

    let { factory, curve } = await factoryFixture();
    const { monotonicIncreasingValidator } = await validatorFixture();
    const allRewardTokens = await rewardTokenFixture();
    const rewardTokens = allRewardTokens.slice(0, NUM_REWARD_TOKENS);
    let { nft } = await nftFixture();

    const startTime = (await time.latest()) + 1000;
    const endTime = startTime + REWARD_DURATION;
    const rewardRates = REWARDS.map((reward) =>
      reward.div(endTime - startTime)
    );
    // EndTime = startTime - 1000
    // console.log(rewardTokens.map((rewardToken) => rewardToken.address))
    const { delta, fee, spotPrice, props, state, royaltyNumerator } =
      getCurveParameters();

    const RewardVault = await ethers.getContractFactory("RewardVaultETH");
    let rewardVault = await RewardVault.connect(factory.signer).deploy();

    const Clones = await ethers.getContractFactory("TestClones");
    const clones = await Clones.deploy();
    const rewardVaultAddress = await clones.callStatic.clone(
      rewardVault.address
    );
    await clones.clone(rewardVault.address);
    rewardVault = RewardVault.attach(rewardVaultAddress);

    await rewardVault.initialize(
      collection.address,
      owner.address,
      factory.address,
      monotonicIncreasingValidator.address,
      nft.address,
      curve.address,
      { spotPrice: 0, delta, props: [], state: [] },
      fee,
      royaltyNumerator,
      ethers.constants.HashZero,
      rewardTokens.map((rewardToken) => rewardToken.address),
      rewardRates,
      startTime,
      endTime
    );

    for (let i = 0; i < NUM_REWARD_TOKENS; i++) {
      await rewardTokens[i].mint(rewardVault.address, REWARDS[i]);
    }

    const nftTokenIds = await mintRandomNfts(nft, user.address);
    const nftTokenIds1 = await mintRandomNfts(nft, user1.address);

    factory = factory.connect(user);
    nft = nft.connect(user);
    rewardVault = rewardVault.connect(user);

    const supportsERC2981 = await nft.supportsInterface("0x2a55205a");
    const params = {
      bondingCurve: curve as unknown as ICurve,
      delta,
      fee,
      spotPrice,
      props,
      state,
      royaltyNumerator,
      royaltyRecipientFallback:
        supportsERC2981 || royaltyNumerator === "0"
          ? ethers.constants.AddressZero
          : ethers.Wallet.createRandom().address,
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

    return {
      factory,
      monotonicIncreasingValidator,
      allRewardTokens,
      rewardTokens,
      rewards: REWARDS,
      nft,
      curve,
      lpTokenId,
      lpTokenId1,
      rewardVault,
      owner,
      user,
      user1,
      collection,
      params,
    };
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

/**
 * A fixture providing an array of n NFTs and n royaltyRecipients. Note that
 * the ERC2981 royaltyInfo for this collection always returns 0 for amount as
 * it is not used.
 *
 * Also provides a non 2981 NFT to swap into params
 */
export async function royaltyFixture(): Promise<{
  nft2981: Test721EnumerableRoyalty;
  nftNon2981: IERC721;
  initialOwner: SignerWithAddress;
  recipients: SignerWithAddress[];
  royaltyRecipientFallback: SignerWithAddress;
  tokenIdsWithRoyalty: string[];
  tokenIdsWithoutRoyalty: string[];
  collectionPoolFactory: CollectionPoolFactory;
  otherAccount1: SignerWithAddress;
  ethPoolParams: EthPoolParams;
  fee: BigNumber;
  protocolFee: BigNumber;
  royaltyNumerator: BigNumber;
}> {
  // Generic NFT collection implementing 2981 and allowing recipient setting
  const { nft } = await nftFixture();
  // Tokens will be minted to `owner` and royalties awardable to royaltyRecipients
  const {
    owner,
    royaltyRecipient0,
    royaltyRecipient1,
    royaltyRecipientFallback,
  } = await getSigners();

  const nftsWithRoyalty = await mintRandomNfts(nft, owner.address, 4);
  const { fee, protocolFee } = getCurveParameters();

  const nftNon2981 = (await non2981NftFixture()).nft as unknown as IERC721;
  const nftsWithoutRoyalty = await mintRandomNfts(
    nftNon2981 as any,
    owner.address,
    3
  );

  // Assign royalty recipients. Exclude some to test fallback
  const recipients = [royaltyRecipient0, royaltyRecipient1];
  await Promise.all(
    recipients.map(async (recipient, index) =>
      nft.setTokenRoyalty(nftsWithRoyalty[index], recipient.address)
    )
  );

  const { collectionPoolFactory, otherAccount1, ethPoolParams } =
    (await everythingFixture()) as any;

  // Approve all tokenids
  for (const id of nftsWithRoyalty) {
    await nft.connect(owner).approve(collectionPoolFactory.address, id);
  }

  for (const id of nftsWithoutRoyalty) {
    await nftNon2981.connect(owner).approve(collectionPoolFactory.address, id);
  }

  return {
    nft2981: nft,
    nftNon2981,
    initialOwner: owner,
    recipients,
    tokenIdsWithRoyalty: nftsWithRoyalty,
    tokenIdsWithoutRoyalty: nftsWithoutRoyalty,
    collectionPoolFactory,
    otherAccount1,
    ethPoolParams,
    royaltyRecipientFallback,
    fee: ethers.BigNumber.from(fee),
    protocolFee: ethers.BigNumber.from(protocolFee),
    royaltyNumerator: DEFAULT_VALID_ROYALTY,
  };
}

/**
 * A royalty fixture meant for testing transactions with a successfully created
 * pool. To this end, this fixture doesn't provide the non-2981 NFT contract and
 * ids. Instead, it provides the pool which will be traded against.
 *
 * Also returns an enumerateTrader function which returns all tokenIds held by
 * the trader
 */
export async function royaltyWithPoolFixture(): Promise<{
  nft2981: Test721EnumerableRoyalty;
  initialOwner: SignerWithAddress;
  recipients: SignerWithAddress[];
  royaltyRecipientFallback: SignerWithAddress;
  tokenIdsWithRoyalty: string[];
  collectionPoolFactory: CollectionPoolFactory;
  otherAccount1: SignerWithAddress;
  ethPoolParams: EthPoolParams;
  collectionPoolETH: CollectionPoolETH;
  traderNfts: string[];
  fee: BigNumber;
  protocolFee: BigNumber;
  royaltyNumerator: BigNumber;
  enumerateTrader: () => Promise<BigNumber[]>;
}> {
  const {
    nft2981,
    initialOwner,
    recipients,
    tokenIdsWithRoyalty,
    collectionPoolFactory,
    otherAccount1,
    ethPoolParams,
    royaltyRecipientFallback,
    fee,
    protocolFee,
    royaltyNumerator,
  } = await royaltyFixture();

  const collectionPoolETHContractTx = await collectionPoolFactory.createPoolETH(
    {
      ...ethPoolParams,
      nft: nft2981.address,
      royaltyNumerator: ethers.BigNumber.from(royaltyNumerator),
      royaltyRecipientFallback: ethers.constants.AddressZero,
      initialNFTIDs: tokenIdsWithRoyalty,
    },
    {
      value: ethers.BigNumber.from(`${8e18}`),
      gasLimit: 1000000,
    }
  );
  const { newPoolAddress } = await getPoolAddress(collectionPoolETHContractTx);
  const collectionPoolETH = await ethers.getContractAt(
    "CollectionPoolETH",
    newPoolAddress
  );

  // Give the trader some nfts so both directions can be tested
  const traderNfts = await mintRandomNfts(nft2981, otherAccount1.address, 4);

  // Approve all for trading with the pool
  await nft2981
    .connect(otherAccount1)
    .setApprovalForAll(collectionPoolETH.address, true);

  // Assign royalty recipients. Exclude some to test fallback
  const { royaltyRecipient3, royaltyRecipient4 } = await getSigners();
  const recipients2 = [royaltyRecipient3, royaltyRecipient4];
  await Promise.all(
    recipients2.map(async (recipient, index) =>
      nft2981.setTokenRoyalty(traderNfts[index], recipient.address)
    )
  );

  const enumerateTrader: () => Promise<BigNumber[]> = async () => {
    const balance = (await nft2981.balanceOf(otherAccount1.address)).toNumber();
    const output = [];
    for (let i = 0; i < balance; i++) {
      output.push(await nft2981.tokenOfOwnerByIndex(otherAccount1.address, i));
    }

    return output;
  };

  return {
    nft2981,
    initialOwner,
    recipients,
    tokenIdsWithRoyalty,
    collectionPoolFactory,
    otherAccount1,
    ethPoolParams,
    collectionPoolETH,
    traderNfts,
    fee,
    protocolFee,
    royaltyNumerator,
    enumerateTrader,
    royaltyRecipientFallback,
  };
}

export async function royaltyWithPoolAndFallbackFixture(): Promise<{
  nft2981: Test721Enumerable;
  initialOwner: SignerWithAddress;
  recipients: SignerWithAddress[];
  royaltyRecipientFallback: SignerWithAddress;
  tokenIdsWithRoyalty: string[];
  collectionPoolFactory: CollectionPoolFactory;
  otherAccount1: SignerWithAddress;
  ethPoolParams: EthPoolParams;
  collectionPoolETH: CollectionPoolETH;
  traderNfts: string[];
  fee: BigNumber;
  protocolFee: BigNumber;
  royaltyNumerator: BigNumber;
}> {
  const {
    nft2981,
    initialOwner,
    recipients,
    tokenIdsWithRoyalty,
    collectionPoolFactory,
    otherAccount1,
    ethPoolParams,
    royaltyRecipientFallback,
  } = await royaltyFixture();

  const royaltyNumerator = DEFAULT_VALID_ROYALTY;

  const collectionPoolETHContractTx = await collectionPoolFactory.createPoolETH(
    {
      ...ethPoolParams,
      nft: nft2981.address,
      royaltyNumerator: ethers.BigNumber.from(royaltyNumerator),
      royaltyRecipientFallback: royaltyRecipientFallback.address,
      initialNFTIDs: tokenIdsWithRoyalty,
    },
    {
      value: ethers.BigNumber.from(`${8e18}`),
      gasLimit: 1000000,
    }
  );
  const { newPoolAddress } = await getPoolAddress(collectionPoolETHContractTx);
  const collectionPoolETH = await ethers.getContractAt(
    "CollectionPoolETH",
    newPoolAddress
  );

  // Give the trader some nfts so both directions can be tested
  const traderNfts = await mintRandomNfts(nft2981, otherAccount1.address, 4);

  // Approve all for trading with the pool
  await nft2981
    .connect(otherAccount1)
    .setApprovalForAll(collectionPoolETH.address, true);

  // Assign royalty recipients. Exclude some so we can test fallback
  const { royaltyRecipient3, royaltyRecipient4 } = await getSigners();
  const recipients2 = [royaltyRecipient3, royaltyRecipient4];
  await Promise.all(
    recipients2.map(async (recipient, index) =>
      nft2981.setTokenRoyalty(traderNfts[index], recipient.address)
    )
  );

  const { fee, protocolFee } = getCurveParameters();

  return {
    nft2981,
    initialOwner,
    recipients,
    tokenIdsWithRoyalty,
    collectionPoolFactory,
    otherAccount1,
    ethPoolParams,
    collectionPoolETH,
    traderNfts,
    fee: ethers.BigNumber.from(fee),
    protocolFee: ethers.BigNumber.from(protocolFee),
    royaltyNumerator,
    royaltyRecipientFallback,
  };
}
