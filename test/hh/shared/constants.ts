import { readFileSync } from "fs";
import * as path from "path";

import { ethers } from "hardhat";

import type { ICollectionPoolFactory } from "../../../typechain-types/contracts/pools/CollectionPoolFactory";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import type { Contract } from "ethers";

const IMPLEMENTED_CURVES = ["linear", "exponential", "sigmoid"] as const;
export type curveType = typeof IMPLEMENTED_CURVES[number];
export const CURVE_TYPE: curveType = process.env.CURVE_TYPE as curveType;
export let config = {} as any;

export const DEFAULT_CREATE_ETH_POOL_PARAMS: ICollectionPoolFactory.CreateETHPoolParamsStruct =
  {
    nft: ethers.constants.AddressZero,
    bondingCurve: ethers.constants.AddressZero,
    assetRecipient: ethers.constants.AddressZero,
    receiver: ethers.constants.AddressZero,
    poolType: 0,
    delta: 0,
    fee: 0,
    spotPrice: 0,
    props: [],
    state: [],
    royaltyNumerator: 0,
    royaltyRecipientFallback: ethers.constants.AddressZero,
    initialNFTIDs: [],
  };
export const DEFAULT_CREATE_ERC20_POOL_PARAMS: ICollectionPoolFactory.CreateERC20PoolParamsStruct =
  {
    ...DEFAULT_CREATE_ETH_POOL_PARAMS,
    token: ethers.constants.AddressZero,
    initialTokenBalance: ethers.constants.Zero,
  };

export const NUM_INITIAL_NFTS = 10;

// copied from ICollectionPool.sol
export enum PoolType {
  TOKEN,
  NFT,
  TRADE,
}

// copied from CollectionPoolFactory.sol
export enum PoolVariant {
  ENUMERABLE_ETH,
  MISSING_ENUMERABLE_ETH,
  ENUMERABLE_ERC20,
  MISSING_ENUMERABLE_ERC20,
}

if (!IMPLEMENTED_CURVES.includes(CURVE_TYPE as any)) {
  console.log(
    `Run the script with CURVE_TYPE environment variable set to one of ${IMPLEMENTED_CURVES.join(
      ", "
    )}`
  );
  process.exit(-1);
}

try {
  config = JSON.parse(
    readFileSync(path.resolve(__dirname, `../config/${CURVE_TYPE}.json`), {
      encoding: "utf8",
      flag: "r",
    })
  );
} catch (err) {
  console.log(err);
}

export async function mintTokensAndApprove(
  initialNFTIDs: number[],
  myERC721: Contract,
  thisAccount: SignerWithAddress,
  collectionPoolFactory: Contract
) {
  for (const nftId of initialNFTIDs) {
    await myERC721.mint(thisAccount.address, nftId);
    await myERC721
      .connect(thisAccount)
      .approve(collectionPoolFactory.address, nftId);
    // Console.log(`owner of ${nftId} is '${await myERC721.ownerOf(nftId)}'`)
  }
}
