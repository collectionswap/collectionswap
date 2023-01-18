import { TokenIDs } from "filter_code";
import { ethers } from "hardhat";

import {
  DEFAULT_CREATE_ETH_POOL_PARAMS,
  NUM_INITIAL_NFTS,
  PoolType,
  PoolVariant,
} from "../constants";
import {
  difference,
  getPoolAddress,
  mintAndApproveNfts,
  mintAndApproveRandomNfts,
  pickRandomElements,
  toBigInt,
  toBigNumber,
} from "../helpers";
import { randomBigNumbers, randomElement } from "../random";

import type { ICurve } from "../../../../typechain-types/contracts/bonding-curves";
import type {
  CollectionPool,
  ICollectionPool,
} from "../../../../typechain-types/contracts/pools/CollectionPool";
import type {
  CollectionPoolFactory,
  ICollectionPoolFactory,
} from "../../../../typechain-types/contracts/pools/CollectionPoolFactory";
import type {
  Test20,
  Test721,
  Test721Enumerable,
  Test721EnumerableRoyalty,
  Test721Royalty,
} from "../../../../typechain-types/contracts/test/mocks";
import type { IERC721Mintable } from "../types";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import type { BigNumber, ContractTransaction } from "ethers";

interface NFTContracts {
  test721: Test721;
  test721Enumerable: Test721Enumerable;
  test721EnumerableRoyalty: Test721EnumerableRoyalty;
  test721Royalty: Test721Royalty;
}
export interface CollectionPoolContracts {
  collectionPoolFactory: CollectionPoolFactory;
  curve: ICurve;
}

export interface CreatePoolContext
  extends CollectionPoolContracts,
    NFTContracts {
  test20: Test20;
  poolOwner: SignerWithAddress;
  user: SignerWithAddress;
}

export interface CreatePoolOverrides {
  poolType: PoolType;
  poolOwner?: SignerWithAddress;
}

export interface CreatePoolOptions {
  filtered: boolean;
  enumerable: boolean;
  royalty: boolean;
}

export type TokenType = "ETH" | "ERC20";

export type AnyNFT =
  | Test721
  | Test721Enumerable
  | Test721EnumerableRoyalty
  | Test721Royalty;

export interface Pool {
  collectionPool: CollectionPool;
  nft: AnyNFT;
  heldIds: BigNumber[];
  tokenIDFilter?: TokenIDs;
}

/**
 * Creates a pool specifically for calling swapNFTsForToken
 */
export async function createPoolToSwapNFTs(
  ctx: CreatePoolContext,
  tokenType: TokenType,
  overrides?: Partial<CreatePoolOverrides>,
  options?: Partial<CreatePoolOptions>
) {
  return createPool(
    ctx,
    tokenType,
    {
      ...overrides,
      poolType:
        overrides?.poolType ?? randomElement(PoolType.TOKEN, PoolType.TRADE),
    },
    options
  );
}

/**
 * Creates a pool specifically for calling swapTokenForSpecificNFTs or swapTokenForAnyNFTs
 */
export async function createPoolToSwapToken(
  ctx: CreatePoolContext,
  tokenType: TokenType,
  overrides?: Partial<CreatePoolOverrides>,
  options?: Partial<CreatePoolOptions>
) {
  return createPool(
    ctx,
    tokenType,
    {
      ...overrides,
      poolType:
        overrides?.poolType ?? randomElement(PoolType.NFT, PoolType.TRADE),
    },
    options
  );
}

/**
 * Returns a pool that can be configured to the token type, filtered, enumerable, royalty.
 */
async function createPool(
  {
    collectionPoolFactory,
    curve,
    test20,
    test721,
    test721Enumerable,
    test721EnumerableRoyalty,
    test721Royalty,
    poolOwner: _poolOwner,
    user,
  }: CreatePoolContext,
  tokenType: TokenType,
  overrides: CreatePoolOverrides,
  options?: Partial<CreatePoolOptions>
): Promise<{
  collectionPool: CollectionPool;
  tokenType: TokenType;
  nft: AnyNFT;
  heldIds: BigNumber[];
  tokenIDFilter?: TokenIDs;
}> {
  const nft = getNFT(
    { test721, test721Enumerable, test721EnumerableRoyalty, test721Royalty },
    options?.enumerable,
    options?.royalty
  );
  const poolOwner = overrides?.poolOwner ?? _poolOwner;

  const heldIds = await mintAndApproveRandomNfts(
    nft,
    poolOwner,
    collectionPoolFactory.address,
    NUM_INITIAL_NFTS
  );

  const poolParams:
    | ICollectionPoolFactory.CreateETHPoolParamsStruct
    | ICollectionPoolFactory.CreateERC20PoolParamsStruct = {
    ...DEFAULT_CREATE_ETH_POOL_PARAMS,
    nft: nft.address,
    bondingCurve: curve.address,
    receiver: poolOwner.address,
    poolType: overrides.poolType,
    initialNFTIDs: heldIds,
  };
  if (tokenType === "ERC20") {
    // @ts-ignore
    poolParams.token = test20.address;
    // @ts-ignore
    poolParams.initialTokenBalance = 0;
  }

  let tx: ContractTransaction;
  let tokenIDFilter;
  if (options?.filtered ?? Math.random() < 0.5) {
    tokenIDFilter = new TokenIDs(
      [...heldIds, ...randomBigNumbers(NUM_INITIAL_NFTS)].map(toBigInt)
    );

    const biTokenIds = heldIds.map(toBigInt);
    // @ts-ignore
    poolParams.initialNFTIDs = tokenIDFilter.sort(biTokenIds);
    const { proof: initialProof, proofFlags: initialProofFlags } =
      tokenIDFilter.proof(biTokenIds);

    tx = await collectionPoolFactory
      .connect(poolOwner)
      [`createPool${tokenType}Filtered`](
        // @ts-ignore
        poolParams,
        {
          merkleRoot: tokenIDFilter.root(),
          encodedTokenIDs: tokenIDFilter.encode(),
          initialProof,
          initialProofFlags,
        }
      );
  } else {
    tx = await collectionPoolFactory.connect(poolOwner)[
      `createPool${tokenType}`
      // @ts-ignore
    ](poolParams);
  }

  const enumerable = [test721Enumerable, test721EnumerableRoyalty].includes(
    // @ts-ignore
    nft
  );
  const { newPoolAddress } = await getPoolAddress(tx);
  const collectionPool = (await ethers.getContractAt(
    `CollectionPool${enumerable ? "" : "Missing"}Enumerable${tokenType}`,
    newPoolAddress,
    user
  )) as CollectionPool;

  return { collectionPool, tokenType, nft, heldIds, tokenIDFilter };
}

/**
 * Returns an nft contract that is one of {missing enumerable, enumerable} x {missing royalty, royalty}
 * @param enumerable {boolean} If enumerable is true, then contract will be enumerable. Else if false, then not enumerable. Else, at random.
 * @param royalty {boolean} If royalty is true, then contract will be royalty. Else if false, then not royalty. Else, at random.
 */
function getNFT(
  {
    test721,
    test721Enumerable,
    test721EnumerableRoyalty,
    test721Royalty,
  }: NFTContracts,
  enumerable?: boolean,
  royalty?: boolean
) {
  if (enumerable === true && royalty === true) {
    return test721EnumerableRoyalty;
  }

  if (enumerable === true) {
    if (royalty === false) {
      // enumerable: true, royalty: false
      return test721Enumerable;
    }

    // enumerable: true, royalty: ?
    return randomElement(test721Enumerable, test721EnumerableRoyalty);
  }

  if (royalty === true) {
    if (enumerable === false) {
      // enumerable: false, royalty: true
      return test721Royalty;
    }

    // enumerable: ?, royalty: true
    return randomElement(test721EnumerableRoyalty, test721Royalty);
  }

  if (enumerable === false) {
    // enumerable: false, royalty: false
    if (royalty === false) {
      return test721;
    }

    // enumerable: false, royalty: ?
    return randomElement(test721, test721Royalty);
  }

  if (royalty === false) {
    if (enumerable === false) {
      // enumerable: false, royalty: false
      return test721;
    }

    // enumerable: ?, royalty: false
    return randomElement(test721, test721Enumerable);
  }

  // enumerable: ?, royalty: ?
  return randomElement(
    test721,
    test721Enumerable,
    test721EnumerableRoyalty,
    test721Royalty
  );
}

/**
 * Returns the quote amount and nfts to buy.
 * @param collectionPool The pool to buy from.
 * @param heldIds The nft ids held by the pool. Should be equivalent to collectionPool.getAllHeldIds().
 * @param any If true, only numNFTs is returned. Otherwise, the nft ids are returned as well.
 */
export async function getBuyNFTQuote(
  collectionPool: CollectionPool,
  heldIds: BigNumber[],
  any: boolean
): Promise<{
  inputAmount: BigNumber;
  numNFTs: number;
  nftIds: BigNumber[] | undefined;
}> {
  const numNFTs = heldIds.length / 2;
  const nftIds = any ? undefined : pickRandomElements(heldIds, numNFTs);

  const { inputAmount } = await collectionPool.getBuyNFTQuote(numNFTs);

  return { inputAmount, numNFTs, nftIds };
}

export function getTokenType(poolVariant: number): TokenType {
  if (
    poolVariant === PoolVariant.ENUMERABLE_ETH ||
    poolVariant === PoolVariant.MISSING_ENUMERABLE_ETH
  ) {
    return "ETH";
  }

  if (
    poolVariant === PoolVariant.ENUMERABLE_ERC20 ||
    poolVariant === PoolVariant.MISSING_ENUMERABLE_ERC20
  ) {
    return "ERC20";
  }

  throw new Error(`Unknown pool variant: ${poolVariant}`);
}

/**
 * Returns the quote amount and nfts to sell.
 * @param collectionPool The pool to sell to.
 * @param nft The nft of the pool. Should be equivalent to collectionPool.nft().
 * @param heldIds The nft ids held by the pool. Should be equivalent to collectionPool.getAllHeldIds().
 * @param to The address to receive the nfts to be sold to the pool.
 * @param tokenIDFilter The tokenIDFilter of the pool if it exists.
 * @param _approveTo The address to approve to spend the nfts. If omitted, then it is the pool.
 */
export async function getSellNFTQuoteAndMintNFTs(
  collectionPool: CollectionPool,
  nft: IERC721Mintable,
  heldIds: BigNumber[],
  to: SignerWithAddress,
  tokenIDFilter?: TokenIDs,
  _approveTo?: string
): Promise<{
  totalAmount: BigNumber;
  outputAmount: BigNumber;
  nfts: ICollectionPool.NFTsStruct;
}> {
  const approveTo = _approveTo ?? collectionPool.address;
  let nfts;
  if (tokenIDFilter) {
    let tokenIds = difference(tokenIDFilter.tokens().map(toBigNumber), heldIds);
    tokenIds = await mintAndApproveNfts(
      nft,
      to,
      approveTo,
      pickRandomElements(tokenIds, tokenIds.length / 2)
    );
    const biTokenIds = tokenIds.map(toBigInt);

    const { proof, proofFlags } = tokenIDFilter.proof(biTokenIds);
    nfts = {
      ids: tokenIDFilter.sort(biTokenIds),
      proof,
      proofFlags,
    };
  } else {
    const tokenIds = await mintAndApproveRandomNfts(
      nft,
      to,
      approveTo,
      NUM_INITIAL_NFTS / 2
    );
    nfts = {
      ids: tokenIds,
      proof: [],
      proofFlags: [],
    };
  }

  const { totalAmount, outputAmount } = await collectionPool.getSellNFTQuote(
    nfts.ids.length
  );

  return { totalAmount, outputAmount, nfts };
}
