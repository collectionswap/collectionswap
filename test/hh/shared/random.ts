import { ethers } from "hardhat";

import type { BigNumber } from "ethers";

export function randomAddress(): string {
  return ethers.Wallet.createRandom().address;
}

export function randomBigNumber(): BigNumber {
  return ethers.BigNumber.from(ethers.utils.randomBytes(32));
}

export function randomBigNumbers(n: number): BigNumber[] {
  return [...Array(n).keys()].map(randomBigNumber);
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
    return ethers.BigNumber.from(ethers.utils.randomBytes(numBits / 8));
  }

  max ??= 10000;
  const min = minOrMax ?? 0;

  return randomEthValue(max - min).add(ethers.utils.parseEther(min.toString()));
}
