import { expect } from "chai";
import { BigNumber } from "ethers";
import { assert, ethers } from "hardhat";

import type {
  LSSVMPairFactory,
  ILSSVMPairFactory,
  ICurve,
  Collectionstaker,
  IERC20,
  IERC721,
  RewardPoolETH,
  ERC721,
  IValidator,
  Test721Enumerable,
  LSSVMPair,
  LSSVMPairETH,
} from "../../../typechain-types";
import type { BigNumberish, Contract, providers, Signer, Wallet } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { formatEther } from "ethers/lib/utils";
import { CURVE_TYPE } from "./constants";

const SIGMOID_NORMALIZATION_CONSTANT = 1024;

enum PoolType {
  TOKEN,
  NFT,
  TRADE,
}

let nextTokenId = 0;

export async function mintNfts(
  nft: Test721Enumerable,
  to: string,
  n = 1
): Promise<string[]> {
  return Promise.all(
    new Array(n).fill(0).map(async () => {
      const id = String(nextTokenId++);
      await nft.mint(to, id);
      return id;
    })
  );
}

interface Params {
  user: string;
  nft: IERC721;
  bondingCurve: ICurve;
  delta: BigNumberish;
  fee: BigNumberish;
}

export async function createIncentiveEth(
  collectionstaker: Collectionstaker,
  {
    user,
    validator,
    nft,
    bondingCurve,
    delta,
    fee,
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
): Promise<{ dBalance: BigNumberish; rewardPool: RewardPoolETH }> {
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

  const rewardPool = await ethers.getContractAt("RewardPoolETH", poolAddress);
  return {
    dBalance,
    rewardPool,
  };
}

export async function createPairEth(
  factory: LSSVMPairFactory,
  {
    user,
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
  }: Params & {
    spotPrice: BigNumberish;
    nftTokenIds: BigNumberish[];
    value: BigNumberish;
    props: any;
    state: any;
    royaltyNumerator: BigNumberish;
  }
): Promise<{
  dBalance: BigNumberish;
  pairAddress: string;
  lpTokenId: BigNumberish;
}> {
  let response = await nft.setApprovalForAll(factory.address, true);
  let receipt = await response.wait();
  let dBalance = receipt.cumulativeGasUsed.mul(receipt.effectiveGasPrice);

  let params: ILSSVMPairFactory.CreateETHPairParamsStruct = {
    nft: nft.address,
    bondingCurve: bondingCurve.address,
    assetRecipient: ethers.constants.AddressZero,
    receiver: factory.signer.address,
    poolType: 2, // TRADE
    delta: delta,
    fee: fee,
    spotPrice: spotPrice,
    props: props,
    state: state,
    royaltyNumerator: royaltyNumerator,
    initialNFTIDs: nftTokenIds
  };

  response = await factory.createPairETH(params, { value });
  receipt = await response.wait();
  dBalance = dBalance.add(
    receipt.cumulativeGasUsed.mul(receipt.effectiveGasPrice)
  );
  const events = receipt.events!;
  return {
    dBalance,
    pairAddress: events[5].args!.poolAddress,
    lpTokenId: events[0].args!.tokenId,
  };
}

export async function expectAddressToOwnNFTs(
  address: string,
  nft: ERC721,
  tokenIds: string[]
): Promise<void> {
  for (const tokenId of tokenIds) {
    expect(await nft.ownerOf(tokenId)).to.equal(address);
  }
}

// Balance change utility from hardhat chai matcher library
export async function getBalanceChanges(
  transaction:
    | providers.TransactionResponse
    | Promise<providers.TransactionResponse>,
  accounts: Array<Account | string>,
  options?: BalanceChangeOptions
) {
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
  changes.forEach((change, index) => {
    if (!closeEnough(change, amounts[index])) {
      console.log(
        `changeEtherBalancesFuzzy: Change at index ${index} was not close enough. Got ${change}. Expected ${amounts[index]}`
      );
      return false;
    }
  });

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
  lssvmPairETH: LSSVMPairETH,
  externalTrader: SignerWithAddress,
  nftToSell: number
) {
  const [
    _bidError,
    _bidNewSpotPrice,
    _bidNewDelta,
    _bidNewState,
    bidInputAmount,
    _bidTradeFee,
    _bidProtocolFee,
    _bidnObj,
  ] = await lssvmPairETH.getSellNFTQuote(1);
  // Console.log([bidError, bidNewSpotPrice, bidNewDelta, bidInputAmount, bidProtocolFee, bidnObj])
  await lssvmPairETH
    .connect(externalTrader)
    .swapNFTsForToken(
      [nftToSell],
      [],
      [],
      bidInputAmount,
      externalTrader.address,
      false,
      ethers.constants.AddressZero
    );
}

export async function buyFromPool(
  lssvmPairETH: LSSVMPairETH,
  externalTrader: SignerWithAddress,
  nftToBuy: number
) {
  const [
    _askError,
    _askNewSpotPrice,
    _askNewDelta,
    _askNewState,
    askOutputAmount,
    _askTradeFee,
    _askProtocolFee,
    _asknObj,
  ] = await lssvmPairETH.getBuyNFTQuote(1);

  await lssvmPairETH
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

export async function hasProtocolFee(pair: LSSVMPair): Promise<boolean> {
  const poolType = await pair.poolType();
  return [PoolType.NFT, PoolType.TOKEN].includes(poolType);
}

/**
 * @return A tuple of the final amount payable, and the royalty awardable.
 */
export async function calculateAsk(
  changeInItemsInPool: number,
  pair: LSSVMPair,
  _spot: BigNumber,
  _delta: BigNumber,
  _props: any,
  _fee: BigNumber,
  _protocolFee: BigNumber,
  royaltyNumerator: number
): Promise<[number, number]> {
  const [spot, delta, fee] = [_spot, _delta, _fee].map((bigNumber) => {
    return Number(formatEther(bigNumber));
  });

  const protocolFee = (await hasProtocolFee(pair))
    ? Number(formatEther(_protocolFee))
    : 0;

  const royaltyMultiplier = royaltyNumerator / 1e18;
  const finalMultiplier = 1 + fee + protocolFee + royaltyNumerator / 1e18;

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
 * @return A tuple of the final amount payable, and the royalty awardable.
 */
export async function calculateBid(
  changeInItemsInPool: number,
  pair: LSSVMPair,
  _spot: BigNumber,
  _delta: BigNumber,
  _props: any,
  _fee: BigNumber,
  _protocolFee: BigNumber,
  royaltyNumerator: number
): Promise<[number, number]> {
  const [spot, delta, fee] = [_spot, _delta, _fee].map((bigNumber) => {
    return Number(formatEther(bigNumber));
  });

  const protocolFee = (await hasProtocolFee(pair))
    ? Number(formatEther(_protocolFee))
    : 0;

  const royaltyMultiplier = royaltyNumerator / 1e18;
  const finalMultiplier = 1 - fee - protocolFee - royaltyNumerator / 1e18;

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
