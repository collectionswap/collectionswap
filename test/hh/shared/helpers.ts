import { expect } from "chai";
import { BigNumber } from "ethers";
import { formatEther, formatUnits } from "ethers/lib/utils";
import { assert, ethers } from "hardhat";

import { CURVE_TYPE, FEE_DECIMALS, PoolType } from "./constants";
import { randomBigNumber } from "./random";

import type {
  CollectionPoolFactory,
  ICollectionPoolFactory,
  ICurve,
  Collectionstaker,
  IERC20,
  RewardVaultETH,
  IValidator,
  Test721Enumerable,
  CollectionPool,
  CollectionPoolETH,
} from "../../../typechain-types";
import type { PromiseOrValue } from "../../../typechain-types/common";
import type { IERC20Mintable, IERC721, IERC721Mintable } from "./types";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import type {
  BigNumberish,
  Contract,
  providers,
  Signer,
  Wallet,
  ContractTransaction,
  Event,
} from "ethers";

const SIGMOID_NORMALIZATION_CONSTANT = 1024;

export async function mintNfts(
  nft: IERC721Mintable,
  to: string,
  tokenIds: BigNumber[]
): Promise<BigNumber[]> {
  await Promise.all(tokenIds.map(async (tokenId) => nft.mint(to, tokenId)));

  return tokenIds;
}

export async function mintRandomNfts(
  nft: IERC721Mintable,
  to: string,
  n = 1
): Promise<BigNumber[]> {
  return Promise.all(
    new Array(n).fill(0).map(async () => {
      const id = randomBigNumber();
      await nft.mint(to, id);
      return id;
    })
  );
}

export async function mintAndApproveNfts(
  nft: IERC721Mintable,
  to: SignerWithAddress,
  approveTo: string,
  tokenIds: BigNumber[]
): Promise<BigNumber[]> {
  await mintNfts(nft, to.address, tokenIds);
  await approveNfts(nft, to, approveTo, tokenIds);
  return tokenIds;
}

export async function mintAndApproveRandomNfts(
  nft: IERC721Mintable,
  to: SignerWithAddress,
  approveTo: string,
  n = 1
): Promise<BigNumber[]> {
  const tokenIds = await mintRandomNfts(nft, to.address, n);
  await approveNfts(nft, to, approveTo, tokenIds);
  return tokenIds;
}

async function approveNfts(
  nft: IERC721,
  to: SignerWithAddress,
  approveTo: string,
  tokenIds: BigNumber[]
) {
  nft = nft.connect(to) as IERC721;
  return Promise.all(
    tokenIds.map(async (tokenId) => nft.approve(approveTo, tokenId))
  );
}

export async function mintAndApproveAmountToken(
  token: IERC20Mintable,
  to: SignerWithAddress,
  approveTo: string,
  amount: BigNumber
): Promise<BigNumber> {
  await token.mint(to.address, amount);
  await token.connect(to).approve(approveTo, amount);
  return amount;
}

export async function mintAndApproveRandomAmountToken(
  token: IERC20Mintable,
  to: SignerWithAddress,
  approveTo: string
): Promise<BigNumber> {
  return mintAndApproveAmountToken(token, to, approveTo, randomBigNumber());
}

interface Params {
  nft: IERC721;
  bondingCurve: ICurve;
  delta: BigNumberish;
  fee: BigNumberish;
  royaltyNumerator: BigNumberish;
}

export async function createIncentiveEth(
  collectionstaker: Collectionstaker,
  {
    validator,
    nft,
    bondingCurve,
    delta,
    fee,
    royaltyNumerator,
    rewardTokens,
    rewards,
    startTime,
    endTime,
  }: Params & {
    validator: IValidator;
    rewardTokens: IERC20[];
    rewards: BigNumberish[];
    startTime: BigNumberish;
    endTime: BigNumberish;
  }
): Promise<{ dBalance: BigNumberish; rewardVault: RewardVaultETH }> {
  let dBalance = BigNumber.from(0);
  for (let i = 0; i < rewardTokens.length; i++) {
    const response = await rewardTokens[i].approve(
      collectionstaker.address,
      rewards[i]
    );
    const receipt = await response.wait();
    dBalance = dBalance.add(
      receipt.cumulativeGasUsed.mul(receipt.effectiveGasPrice)
    );
  }

  const response = await collectionstaker.createIncentiveETH(
    validator.address,
    nft.address,
    bondingCurve.address,
    { spotPrice: 0, delta, props: [], state: [] },
    fee,
    royaltyNumerator,
    ethers.constants.HashZero,
    rewardTokens.map((rewardToken) => rewardToken.address),
    rewards,
    startTime,
    endTime
  );
  const receipt = await response.wait();
  dBalance = dBalance.add(
    receipt.cumulativeGasUsed.mul(receipt.effectiveGasPrice)
  );

  const events = receipt.events!;
  const { poolAddress } = events.at(-1)!.args!;

  const rewardVault = await ethers.getContractAt("RewardVaultETH", poolAddress);
  return {
    dBalance,
    rewardVault,
  };
}

export async function createPoolEth(
  factory: CollectionPoolFactory,
  {
    nft,
    bondingCurve,
    delta,
    fee,
    spotPrice,
    props,
    state,
    nftTokenIds,
    value,
    royaltyNumerator,
    royaltyRecipientFallback,
  }: Params & {
    spotPrice: BigNumberish;
    nftTokenIds: BigNumberish[];
    value: BigNumberish;
    props: any;
    state: any;
    royaltyNumerator: BigNumberish;
    royaltyRecipientFallback: string;
  }
): Promise<{
  dBalance: BigNumberish;
  poolAddress: string;
  lpTokenId: BigNumberish;
}> {
  let response = await nft.setApprovalForAll(factory.address, true);
  let receipt = await response.wait();
  let dBalance = receipt.cumulativeGasUsed.mul(receipt.effectiveGasPrice);

  const params: ICollectionPoolFactory.CreateETHPoolParamsStruct = {
    nft: nft.address,
    bondingCurve: bondingCurve.address,
    assetRecipient: ethers.constants.AddressZero,
    receiver: await factory.signer.getAddress(),
    poolType: PoolType.TRADE,
    delta,
    fee,
    spotPrice,
    props,
    state,
    royaltyNumerator,
    royaltyRecipientFallback,
    initialNFTIDs: nftTokenIds,
  };

  response = await factory.createPoolETH(params, { value });
  receipt = await response.wait();
  dBalance = dBalance.add(
    receipt.cumulativeGasUsed.mul(receipt.effectiveGasPrice)
  );
  const { newPoolAddress: poolAddress, newTokenId: lpTokenId } =
    await getPoolAddress(response);
  return {
    dBalance,
    poolAddress,
    lpTokenId,
  };
}

export async function expectAddressToOwnNFTs(
  address: string,
  nft: IERC721,
  tokenIds: PromiseOrValue<BigNumberish>[]
): Promise<void> {
  for (const tokenId of tokenIds) {
    expect(await nft.ownerOf(tokenId)).to.equal(address);
  }
}

export async function expectNFTsToBeApprovedTo(
  nft: IERC721,
  tokenIds: BigNumber[],
  address: string
): Promise<void> {
  for (const tokenId of tokenIds) {
    expect(await nft.getApproved(tokenId)).to.equal(address);
  }
}

// Balance change utility from hardhat chai matcher library
export async function getBalanceChanges(
  transaction:
    | providers.TransactionResponse
    | Promise<providers.TransactionResponse>,
  accounts: Array<Account | string>,
  options?: BalanceChangeOptions
): Promise<BigNumber[]> {
  const txResponse = await transaction;

  const txReceipt = await txResponse.wait();
  const txBlockNumber = txReceipt.blockNumber;

  const balancesAfter = await getBalances(accounts, txBlockNumber);
  const balancesBefore = await getBalances(accounts, txBlockNumber - 1);

  const txFees = await getTxFees(accounts, txResponse, options);

  return balancesAfter.map((balance, ind) =>
    balance.add(txFees[ind]).sub(balancesBefore[ind])
  );
}

async function getTxFees(
  accounts: Array<Account | string>,
  txResponse: providers.TransactionResponse,
  options?: BalanceChangeOptions
) {
  return Promise.all(
    accounts.map(async (account) => {
      if (
        options?.includeFee !== true &&
        (await getAddressOf(account)) === txResponse.from
      ) {
        const txReceipt = await txResponse.wait();
        const gasPrice = txReceipt.effectiveGasPrice ?? txResponse.gasPrice;
        const { gasUsed } = txReceipt;
        const txFee = gasPrice.mul(gasUsed);

        return txFee;
      }

      return 0;
    })
  );
}

export interface BalanceChangeOptions {
  includeFee?: boolean;
}

export async function getAddresses(accounts: Array<Account | string>) {
  return Promise.all(accounts.map(async (account) => getAddressOf(account)));
}

export async function getBalances(
  accounts: Array<Account | string>,
  blockNumber?: number
) {
  const { BigNumber } = await import("ethers");
  const hre = await import("hardhat");
  const { provider } = hre.ethers;

  return Promise.all(
    accounts.map(async (account) => {
      const address = await getAddressOf(account);
      const result = await provider.send("eth_getBalance", [
        address,
        `0x${blockNumber?.toString(16) ?? 0}`,
      ]);
      return BigNumber.from(result);
    })
  );
}

export type Account = Signer | Contract;

export function isAccount(account: Account): account is Contract | Wallet {
  return account instanceof ethers.Contract || account instanceof ethers.Wallet;
}

export async function getAddressOf(account: Account | string) {
  if (typeof account === "string") {
    assert(/^0x[0-9a-fA-F]{40}$/.test(account), `Invalid address ${account}`);
    return account;
  }

  if (isAccount(account)) {
    return account.address;
  }

  return account.getAddress();
}
// End code from hardhat chai matchers library

export function convertToBigNumber(value: number): BigNumber {
  return ethers.BigNumber.from(`${value * 1e18}`);
}

export function closeEnough(a: BigNumber, b: BigNumber): boolean {
  if (a.gte(b)) {
    return a.sub(b).abs().lte(convertToBigNumber(1e-6));
  }

  return b.sub(a).abs().lte(convertToBigNumber(1e-6));
}

export async function changesEtherBalancesFuzzy(
  tx: providers.TransactionResponse | Promise<providers.TransactionResponse>,
  addresses: Array<Account | string>,
  amounts: BigNumber[]
): Promise<boolean> {
  if (addresses.length !== amounts.length) {
    throw new Error(
      "changesEtherBalancesFuzzy: `addresses` and `amounts` lengths dont match."
    );
  }

  const changes = await getBalanceChanges(tx, addresses);

  for (let index = 0; index < amounts.length; index++) {
    const change = changes[index];
    if (!closeEnough(change, amounts[index])) {
      console.log(
        `changeEtherBalancesFuzzy: Change at index ${index} was not close enough. Got ${change}. Expected ${amounts[index]}. Address: ${addresses[index]}`
      );
      return false;
    }
  }

  return true;
}

/**
 * Same idea as changesEtherBalancesFuzzy but takes an array of transactions
 */
export async function changesEtherBalancesFuzzyMultipleTransactions(
  txs:
    | providers.TransactionResponse[]
    | Promise<providers.TransactionResponse[]>,
  addresses: Array<Account | string>,
  amounts: BigNumber[]
): Promise<boolean> {
  if (addresses.length !== amounts.length) {
    throw new Error(
      "changesEtherBalancesFuzzy: `addresses` and `amounts` lengths dont match."
    );
  }

  const totalChanges = addresses.map((_) => ethers.BigNumber.from("0"));
  for (const tx of await txs) {
    const changes = await getBalanceChanges(tx, addresses);
    for (let i = 0; i < changes.length; i++) {
      const balanceChange = changes[i];
      totalChanges[i] = totalChanges[i].add(balanceChange);
    }
  }

  for (let index = 0; index < amounts.length; index++) {
    const change = totalChanges[index];
    if (!closeEnough(change, amounts[index])) {
      console.log(
        `changeEtherBalancesFuzzyMultipleTransactions: Change at index ${index} was not close enough. Got ${change}. Expected ${amounts[index]}. Address: ${addresses[index]}`
      );
      return false;
    }
  }

  return true;
}

/**
 * K is already normalized by dividing by 16
 */
export function parseSigmoidParams(
  _delta: BigNumber,
  props: any
): {
  k: number;
  pMin: number;
  deltaP: number;
} {
  const k = _delta.toNumber() / SIGMOID_NORMALIZATION_CONSTANT;
  const [pMin, deltaP] = ethers.utils.defaultAbiCoder
    .decode(["uint256", "uint256"], props)
    .map((bn: BigNumber) => Number(ethers.utils.formatEther(bn)));
  return { k, pMin, deltaP };
}

export async function sellToPool(
  collectionPoolETH: CollectionPoolETH,
  externalTrader: SignerWithAddress,
  nftToSell: number
) {
  const [
    _bidError,
    _bidNewParams,
    _bidTotalAmount,
    bidInputAmount,
    _bidTradeFee,
    _bidProtocolFee,
    _bidnObj,
  ] = await collectionPoolETH.getSellNFTQuote(1);
  // Console.log([bidError, bidNewSpotPrice, bidNewDelta, bidInputAmount, bidProtocolFee, bidnObj])
  await collectionPoolETH.connect(externalTrader).swapNFTsForToken(
    {
      ids: [nftToSell],
      proof: [],
      proofFlags: [],
    },
    bidInputAmount,
    externalTrader.address,
    false,
    ethers.constants.AddressZero,
    []
  );
}

export async function buyFromPool(
  collectionPoolETH: CollectionPoolETH,
  externalTrader: SignerWithAddress,
  nftToBuy: number
) {
  const [
    _askError,
    _askNewParams,
    _askTotalAmount,
    askOutputAmount,
    _askTradeFee,
    _askProtocolFee,
    _asknObj,
  ] = await collectionPoolETH.getBuyNFTQuote(1);

  await collectionPoolETH
    .connect(externalTrader)
    .swapTokenForSpecificNFTs(
      [nftToBuy],
      askOutputAmount,
      externalTrader.address,
      false,
      ethers.constants.AddressZero,
      { value: askOutputAmount }
    );
}

export async function hasProtocolFee(pool: CollectionPool): Promise<boolean> {
  const poolType = await pool.poolType();
  return [PoolType.NFT, PoolType.TOKEN].includes(poolType);
}

export async function poolParamsToNumbers(
  pool: CollectionPool,
  _spot: BigNumber,
  _delta: BigNumber,
  _props: any,
  _fee: BigNumber,
  _protocolFee: BigNumber,
  royaltyNumerator: number
): Promise<{
  spot: number;
  delta: number;
  fee: number;
  protocolFee: number;
  royaltyMultiplier: number;
}> {
  const [spot, delta] = [_spot, _delta].map((bigNumber) => {
    return Number(formatEther(bigNumber));
  });

  const fee = Number(formatUnits(_fee, FEE_DECIMALS));

  const protocolFee = (await hasProtocolFee(pool))
    ? Number(formatUnits(_protocolFee, FEE_DECIMALS))
    : 0;

  const royaltyMultiplier = royaltyNumerator / 10 ** FEE_DECIMALS;

  return { spot, delta, fee, protocolFee, royaltyMultiplier };
}

/**
 * @notice spot, delta, props should all be taken from the pool at creation
 * time. This function accounts for all variable changes due to buying/selling
 * @return A tuple of the final amount payable, and the royalty awardable.
 */
export async function calculateAsk(
  changeInItemsInPool: number,
  pool: CollectionPool,
  _spot: BigNumber,
  _delta: BigNumber,
  _props: any,
  _fee: BigNumber,
  _protocolFee: BigNumber,
  royaltyNumerator: number
): Promise<[number, number]> {
  const { spot, delta, fee, protocolFee, royaltyMultiplier } =
    await poolParamsToNumbers(
      pool,
      _spot,
      _delta,
      _props,
      _fee,
      _protocolFee,
      royaltyNumerator
    );
  const finalMultiplier =
    1 + fee + protocolFee + royaltyNumerator / 10 ** FEE_DECIMALS;

  // Use quantity as -changeInItemsInPool since asks decrease the number in the pool
  if (CURVE_TYPE === "exponential") {
    const rawPrice = delta ** (-changeInItemsInPool + 1) * spot;
    return [finalMultiplier * rawPrice, royaltyMultiplier * rawPrice];
  }

  if (CURVE_TYPE === "linear") {
    const rawPrice = spot + delta * (-changeInItemsInPool + 1);
    return [finalMultiplier * rawPrice, royaltyMultiplier * rawPrice];
  }

  if (CURVE_TYPE === "sigmoid") {
    const { k, pMin, deltaP } = parseSigmoidParams(_delta, _props);
    const rawPrice =
      pMin + deltaP / (1 + 2 ** -(k * (-changeInItemsInPool + 1)));
    return [finalMultiplier * rawPrice, royaltyMultiplier * rawPrice];
  }

  throw new Error(`Unrecognized curve type: ${CURVE_TYPE}`);
}

/**
 * @notice spot, delta, props should all be taken from the pool at creation
 * time. This function accounts for all variable changes due to buying/selling
 * @return A tuple of the final amount payable, and the royalty awardable.
 */
export async function calculateBid(
  changeInItemsInPool: number,
  pool: CollectionPool,
  _spot: BigNumber,
  _delta: BigNumber,
  _props: any,
  _fee: BigNumber,
  _protocolFee: BigNumber,
  royaltyNumerator: number
): Promise<[number, number]> {
  const { spot, delta, fee, protocolFee, royaltyMultiplier } =
    await poolParamsToNumbers(
      pool,
      _spot,
      _delta,
      _props,
      _fee,
      _protocolFee,
      royaltyNumerator
    );
  const finalMultiplier =
    1 - fee - protocolFee - royaltyNumerator / 10 ** FEE_DECIMALS;

  if (CURVE_TYPE === "exponential") {
    const rawPrice = spot / delta ** changeInItemsInPool;
    return [finalMultiplier * rawPrice, royaltyMultiplier * rawPrice];
  }

  if (CURVE_TYPE === "linear") {
    const rawPrice = spot - delta * changeInItemsInPool;
    return [finalMultiplier * rawPrice, royaltyMultiplier * rawPrice];
  }

  if (CURVE_TYPE === "sigmoid") {
    const { k, pMin, deltaP } = parseSigmoidParams(_delta, _props);
    const rawPrice =
      pMin + deltaP / (1 + 2 ** -(k * -(changeInItemsInPool + 1)));
    return [finalMultiplier * rawPrice, royaltyMultiplier * rawPrice];
  }

  throw new Error(`Unrecognized curve type: ${CURVE_TYPE}`);
}

/**
 * Returns the sum of `fn(i, ...args)` for i in [`initialValue`, `initialValue` + `count`)
 */
export async function cumulativeSum(
  fn: (
    i: number,
    ...args: any[]
  ) => [number, number] | Promise<[number, number]>,
  initialValue: number,
  count: number,
  increment: number,
  ...args: any[]
): Promise<number> {
  let out = 0;
  let i = initialValue;
  for (let iteration = 0; iteration < count; iteration++) {
    out += (await fn(i, ...args))[0];
    i += increment;
  }

  return out;
}

/**
 * @return An array where the first value is the total input/output value. There
 * will be `count` additional values in the array returned where the i-th entry
 * of the array is the royalty amount awardable to the recipient of the i-th
 * NFT's royalties.
 */
export async function cumulativeSumWithRoyalties(
  fn: (
    i: number,
    ...args: any[]
  ) => [number, number] | Promise<[number, number]>,
  initialValue: number,
  count: number,
  increment: number,
  ...args: any[]
): Promise<number[]> {
  const out = [0];
  let i = initialValue;
  for (let iteration = 0; iteration < count; iteration++) {
    const [itemCost, royalty] = await fn(i, ...args);
    out[0] += itemCost;
    out.push(royalty);
    i += increment;
  }

  return out;
}

/**
 * Returns the expected values for a pool interaction along with the transaction
 * to test
 */
export async function prepareQuoteValues(
  side: "buy" | "sell" | "ask" | "bid",
  pool: CollectionPoolETH,
  spotPrice: BigNumber,
  delta: BigNumber,
  props: any,
  fee: BigNumber,
  protocolFee: BigNumber,
  royaltyNumerator: BigNumber,
  trader: SignerWithAddress,
  quantityOrIds: number | (string | BigNumber)[],
  changeInNftsInPoolSinceCreation: number
) {
  const isSell = ["bid", "sell"].includes(side);
  const isRandom = !Array.isArray(quantityOrIds);
  const numberOfNfts = isRandom ? quantityOrIds : quantityOrIds.length;

  if (isSell && isRandom)
    throw new Error("You can't sell random NFTS to pools");

  const [
    _error,
    _newParams,
    _totalAmount,
    quote,
    { protocol: protocolFeeAmount },
  ] = isSell
    ? await pool.getSellNFTQuote(numberOfNfts)
    : await pool.getBuyNFTQuote(numberOfNfts);

  const amounts = await cumulativeSumWithRoyalties(
    isSell ? calculateBid : calculateAsk,
    changeInNftsInPoolSinceCreation,
    numberOfNfts,
    isSell ? 1 : -1,
    pool,
    spotPrice,
    delta,
    props,
    fee,
    protocolFee,
    royaltyNumerator
  );

  const expectedRoyalties = amounts.slice(1, undefined);
  let totalRoyalties = 0;
  expectedRoyalties.forEach((royalty) => {
    totalRoyalties += royalty;
  });

  const tx = await (isSell
    ? // Sell to pool
      pool.connect(trader).swapNFTsForToken(
        {
          ids: quantityOrIds as string[],
          proof: [],
          proofFlags: [],
        },
        quote,
        trader.address,
        false,
        ethers.constants.AddressZero,
        []
      )
    : isRandom
    ? // Buy random NFTs from pool
      pool
        .connect(trader)
        .swapTokenForAnyNFTs(
          quantityOrIds,
          quote,
          trader.address,
          false,
          ethers.constants.AddressZero,
          { value: quote }
        )
    : // Buy specific NFTs from pool
      pool
        .connect(trader)
        .swapTokenForSpecificNFTs(
          quantityOrIds,
          quote,
          trader.address,
          false,
          ethers.constants.AddressZero,
          { value: quote }
        ));

  return {
    tx,
    quote,
    protocolFeeAmount,
    expectedQuote: amounts[0],
    expectedRoyalties,
    totalRoyalties,
  };
}

/**
 * Inclusive min and max
 */
export function getRandomInt(min: number, max: number): number {
  if (min > max) {
    throw new Error(
      `Called getRandomInt with min > max (${min} and ${max}, respectively)`
    );
  }

  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function pickRandomElements<ElemType>(
  array: ElemType[],
  n: number
): ElemType[] {
  if (n > array.length) throw new Error("pickRandomElements: n > array.length");
  // Shuffle array
  const shuffled = array.slice().sort(() => 0.5 - Math.random());

  // Get sub-array of first n elements after shuffled
  return shuffled.slice(0, n);
}

export async function enumerateAddress(
  nft: Test721Enumerable,
  address: string
): Promise<string[]> {
  const balance = (await nft.balanceOf(address)).toNumber();
  const output = [];
  for (let i = 0; i < balance; i++) {
    output.push(await nft.tokenOfOwnerByIndex(address, i));
  }

  return output.map((bn) => bn.toString());
}

export async function checkOwnershipERC721List(
  nftAddressList: string[],
  nftIdList: string[],
  ownerAddress: string
) {
  for (let i = 0; i < nftAddressList.length; i++) {
    const nftAddress = nftAddressList[i];
    const nftId = nftIdList[i];
    const nft = await ethers.getContractAt("IERC721", nftAddress);
    expect(await nft.ownerOf(nftId)).to.equal(ownerAddress);
  }
}

export async function checkSufficiencyERC20List(
  tokenAddressList: string[],
  tokenAmountList: BigNumber[],
  ownerAddress: string
) {
  for (let i = 0; i < tokenAddressList.length; i++) {
    const tokenAddress = tokenAddressList[i];
    const tokenAmount = tokenAmountList[i];
    const token = await ethers.getContractAt("IERC20", tokenAddress);
    expect(await token.balanceOf(ownerAddress)).to.be.at.least(tokenAmount);
  }
}

export async function getPoolAddress(
  tx: ContractTransaction,
  showGas = false
): Promise<{ newPoolAddress: string; newTokenId: BigNumber }> {
  const receipt = await tx.wait();
  if (showGas) {
    console.log("gas used:", receipt.cumulativeGasUsed);
  }

  const newPoolEvent = receipt.events?.find(
    (event) => event.event === "NewPool"
  );
  const { poolAddress: newPoolAddress } = newPoolEvent!.args!;
  const newTokenId = BigNumber.from(newPoolAddress);
  return { newPoolAddress, newTokenId };
}

export async function getNftTransfers(
  tx: ContractTransaction,
  nft: IERC721,
  from?: string,
  to?: string
): Promise<BigNumber[]> {
  const receipt = await tx.wait();
  return receipt
    .events!.filter((event) => event.address === nft.address)
    .map((event) => nft.interface.parseLog(event))
    .filter(
      (description) =>
        description.name === "Transfer" &&
        (!from || description.args.from === from) &&
        (!to || description.args.to === to)
    )
    .map((description) => description.args.tokenId);
}

export async function getNftTransfersTo(
  tx: ContractTransaction,
  nft: IERC721,
  to: string
): Promise<BigNumber[]> {
  return getNftTransfers(tx, nft, undefined, to);
}

// Helper methods to interop with the fummpel library

export function toBigInt(bn: BigNumber): bigint {
  return bn.toBigInt();
}

function toString(bn: BigNumber): string {
  return bn.toString();
}

export function toBigNumber(bi: bigint): BigNumber {
  return BigNumber.from(bi);
}

/**
 * Returns the difference of S and T. i.e. All the elements in S that are not in T.
 */
export function difference(S: BigNumber[], T: BigNumber[]) {
  const set = new Set(T.map(toString));
  return S.map(toString)
    .filter((x) => !set.has(x))
    .map((x) => BigNumber.from(x));
}

export function byEvent(eventName: string): (event: Event) => boolean {
  return (event: Event): boolean => event.event === eventName;
}

export async function gasUsed(
  txOrReceipt: ContractTransaction
): Promise<BigNumber> {
  return (await txOrReceipt.wait()).cumulativeGasUsed;
}
