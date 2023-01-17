import BN from "bn.js";
import { BigNumber, constants, utils, Wallet } from "ethers";

import { FEE_DECIMALS } from "./constants";

import type { BigNumberish } from "@ethersproject/bignumber/src.ts/bignumber";

/**
 * Returns an element at random with equal probabilities
 */
export function randomElement<T>(...elements: T[]): T {
  const n = elements.length;
  const r = Math.random();
  const i = Math.floor(r * n);
  return elements[i];
}

export function randomAddress(): string {
  return Wallet.createRandom().address;
}

/***
 * Returns a random value up to 2^256.
 */
export function randomBigNumber(): BigNumber;

/***
 * Returns a random value up to max.
 *
 * Does not guarantee that max can be generated
 */
export function randomBigNumber(max: BigNumber): BigNumber;

export function randomBigNumber(max?: BigNumber): BigNumber {
  if (max && max.isZero()) {
    return constants.Zero;
  }

  const byteLength = max ? toBN(max).byteLength() - 1 : 32;
  return BigNumber.from(utils.randomBytes(byteLength));
}

export function randomBigNumbers(n: number): BigNumber[] {
  return [...Array(n).keys()].map(() => randomBigNumber());
}

/***
 * Returns a random value up to 10000 ETH, the default minted by hardhat.
 *
 * Does not guarantee that 10000 ETH can be generated
 */
export function randomEthValue(): BigNumber;

/***
 * Returns a random value up to max ETH.
 *
 * Does not guarantee that max ETH can be generated
 */
export function randomEthValue(max: number): BigNumber;

/***
 * Returns a random value from min to max ETH.
 *
 * Does not guarantee that min and max ETH can be generated
 */
export function randomEthValue(minOrMax?: number, max?: number): BigNumber {
  if (minOrMax && !max) {
    max = minOrMax;
    const numBits = Math.floor(Math.log2(max) + 59.794705708); // log2(1e18) ~= 59.794705708
    return BigNumber.from(utils.randomBytes(numBits / 8));
  }

  max ??= 10000;
  const min = minOrMax ?? 0;

  return randomEthValue(max - min).add(utils.parseEther(min.toString()));
}

function toBN(value: BigNumberish): BN {
  const hex = BigNumber.from(value).toHexString();
  if (hex[0] === "-") {
    return new BN("-" + hex.substring(3), 16);
  }

  return new BN(hex.substring(2), 16);
}

export function randomFee(max: number): BigNumber {
  return randomEthValue(max / 10 ** (18 - FEE_DECIMALS));
}
