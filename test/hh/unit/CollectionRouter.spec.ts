import {
  loadFixture,
  setBalance,
} from "@nomicfoundation/hardhat-network-helpers";
import { latest } from "@nomicfoundation/hardhat-network-helpers/dist/src/helpers/time";
import { BigNumber, constants } from "ethers";
import { ethers, expect } from "hardhat";

import {
  createPoolToSwapNFTs,
  createPoolToSwapToken,
  getBuyNFTQuote,
  getSellNFTQuoteAndMintNFTs,
  getTokenType,
} from "../shared/fixtures/CollectionPool";
import {
  expectAddressToOwnNFTs,
  getNftTransfers,
  mintAndApproveAmountToken,
} from "../shared/helpers";
import {
  randomAddress,
  randomBigNumber,
  randomElement,
  randomInt,
} from "../shared/random";
import { getSigners } from "../shared/signers";

import { collectionPoolFixture } from "./pools/CollectionPool";

import type {
  CollectionPool,
  ICollectionPool,
} from "../../../typechain-types/contracts/pools/CollectionPool";
import type { CollectionRouter } from "../../../typechain-types/contracts/routers/CollectionRouter";
import type {
  TokenType,
  Pool,
  AnyNFT,
} from "../shared/fixtures/CollectionPool";
import type { BigNumberish } from "ethers";
import type { Context } from "mocha";

describe("CollectionRouter", function () {
  let collectionRouter: CollectionRouter;

  before("Get signers", async function () {
    ({ user: this.user } = await getSigners());
  });

  beforeEach("Load fixture", async function () {
    ({
      collectionPoolFactory: this.collectionPoolFactory,
      protocolFeeMultiplier: this.protocolFeeMultiplier,
      carryFeeMultiplier: this.carryFeeMultiplier,
      curve: this.curve,
      test20: this.test20,
      test721: this.test721,
      test721Enumerable: this.test721Enumerable,
      test721EnumerableRoyalty: this.test721EnumerableRoyalty,
      test721Royalty: this.test721Royalty,
      collectionRouter,
    } = await loadFixture(collectionRouterFixture));
  });

  describe("#swapETHForAnyNFTs", function () {
    testSwapToken("ETH", true);
  });

  describe("#swapETHForSpecificNFTs", function () {
    testSwapToken("ETH", false);
  });

  describe("#swapERC20ForAnyNFTs", function () {
    testSwapToken("ERC20", true);
  });

  describe("#swapERC20ForSpecificNFTs", function () {
    testSwapToken("ERC20", false);
  });

  describe("#swapNFTsForToken", function () {
    testSwapNFTsForToken();
  });

  function testSwapToken(tokenType: TokenType, any: boolean) {
    interface Swap {
      pool: string;
      inputAmount: BigNumber;
      nft: AnyNFT;
      numNFTs: number;
      nftIds: BigNumber[] | undefined;
    }

    let pools: Pool[];

    /** The number of nfts and specific nft ids in each pool to swap for */
    let swaps: Swap[];

    /** the recipient of the unspent eth */
    let ethRecipient: string;

    /** the recipient of the nfts */
    let nftRecipient: string;

    /** the total cost to swap all the nfts */
    let totalInputAmount: BigNumber;

    let deadline: BigNumberish;

    beforeEach("Set recipients", function () {
      ethRecipient = randomAddress();
      nftRecipient = randomAddress();
    });

    beforeEach("Set deadline", async function () {
      deadline = constants.MaxUint256.sub(
        randomBigNumber(BigNumber.from(await latest()))
      );
    });

    beforeEach("Set collection pools", async function () {
      ({ pools } = await createPools.call(this));

      ({ swaps, totalInputAmount } = await getBuyNFTQuotesAndMintToken.call(
        this
      ));
    });

    it(`Should transfer ${
      any ? "any" : "the specific"
    } NFTs to the nft recipients`, async function () {
      const tx = await swapToken();

      const nftToIds = new Map();
      for (let {
        pool,
        nft,
        nftIds: swapNftIds,
        numNFTs: swapNumNFTs,
      } of swaps) {
        if (any) {
          swapNftIds = await getNftTransfers(tx, nft, pool, nftRecipient);
          expect(swapNftIds.length).to.equal(swapNumNFTs);
        }

        let nftIds = nftToIds.get(nft) ?? [];
        nftIds = nftIds.concat(swapNftIds);
        nftToIds.set(nft, nftIds);
      }

      for (const [nft, nftIds] of nftToIds) {
        await expectAddressToOwnNFTs(nftRecipient, nft, nftIds!);
      }
    });

    context("With deadline < block.timestamp", function () {
      it("Should revert", async function () {
        deadline = randomInt(0, await latest());

        await expect(swapToken()).to.be.revertedWith("Deadline passed");
      });
    });

    context(`With not enough ${tokenType}`, function () {
      it("Should revert", async function () {
        const { test20, user } = this;
        if (tokenType === "ETH") {
          await expect(
            swapToken({
              value: totalInputAmount.sub(constants.One),
            })
          ).to.be.revertedWithoutReason();
        } else if (tokenType === "ERC20") {
          await test20.burn(user.address, constants.One);
          await expect(swapToken()).to.be.revertedWith("TRANSFER_FROM_FAILED");
        }
      });
    });

    async function swapToken(
      overrides?: Partial<{
        maxExpectedTokenInput?: BigNumber;
        value?: BigNumber;
      }>
    ) {
      const swapList = any
        ? (swaps.map(({ pool, numNFTs }) => ({
            pool,
            numItems: numNFTs,
          })) as CollectionRouter.PoolSwapAnyStruct[])
        : (swaps.map(({ pool, nftIds }) => ({
            pool,
            nftIds,
            proof: [],
            proofFlags: [],
          })) as CollectionRouter.PoolSwapSpecificStruct[]);
      let args: any[];
      if (tokenType === "ETH") {
        args = [
          swapList,
          ethRecipient,
          nftRecipient,
          deadline,
          {
            value:
              overrides?.value ??
              totalInputAmount.add(randomBigNumber(totalInputAmount)), // give excess ETH to trigger refund
          },
        ];
      } else if (tokenType === "ERC20") {
        args = [swapList, totalInputAmount, nftRecipient, deadline];
      }

      // @ts-ignore
      return collectionRouter[
        `swap${tokenType}For${any ? "Any" : "Specific"}NFTs`
        // @ts-ignore
      ].apply(this, args);
    }

    async function getBuyNFTQuotesAndMintToken(this: Context): Promise<{
      swaps: Swap[];
      totalInputAmount: BigNumber;
    }> {
      const { test20, user } = this;

      const swaps = [];
      let totalInputAmount = constants.Zero;

      for (const { collectionPool, nft, heldIds } of pools) {
        const { inputAmount, numNFTs, nftIds } = await getBuyNFTQuote(
          collectionPool,
          heldIds,
          any
        );

        swaps.push({
          pool: collectionPool.address,
          nft,
          numNFTs,
          nftIds,
          inputAmount,
        });
        totalInputAmount = totalInputAmount.add(inputAmount);
      }

      if (tokenType === "ETH") {
        await setBalance(user.address, totalInputAmount.mul(2));
      } else if (tokenType === "ERC20") {
        await mintAndApproveAmountToken(
          test20,
          user,
          collectionRouter.address,
          totalInputAmount
        );
      }

      return { swaps, totalInputAmount };
    }

    async function createPools(this: Context) {
      const { poolOwners } = await getSigners();
      const pools = await Promise.all(
        poolOwners.map(async (poolOwner) =>
          // @ts-ignore
          createPoolToSwapToken(this, tokenType, { poolOwner })
        )
      );
      return { pools };
    }
  }

  function testSwapNFTsForToken() {
    interface Swap {
      collectionPool: CollectionPool;
      nft: AnyNFT;
      nfts: ICollectionPool.NFTsStruct;
    }
    let pools: Pool[];

    /** The number of nfts and specific nft ids in each pool to swap for */
    let swaps: Swap[];

    /** The recipient of the ETH / ERC20 tokens */
    let tokenRecipient: string;

    /** The total amount of ETH / ERC20 tokens to receive */
    let totalOutputAmount: BigNumber;

    let deadline: BigNumberish;

    beforeEach("Set token recipient", function () {
      tokenRecipient = randomAddress();
    });

    beforeEach("Set deadline", async function () {
      deadline = constants.MaxUint256.sub(
        randomBigNumber(BigNumber.from(await latest()))
      );
    });

    beforeEach("Set collection pools", async function () {
      ({ pools } = await createPools.call(this));

      ({ swaps, totalOutputAmount } = await getSellNFTQuotesAndMint.call(this));
    });

    it("Should transfer the NFTs to the pools", async function () {
      await swapNFTsForToken();

      for (const { collectionPool, nft, nfts } of swaps) {
        await expectAddressToOwnNFTs(collectionPool.address, nft, nfts.ids);
      }
    });

    context("With minExpectedTokenOutput > output amount", function () {
      it("Should revert", async function () {
        await expect(
          swapNFTsForToken({
            minOutput: totalOutputAmount.add(constants.One),
          })
        ).to.be.revertedWith("outputAmount too low");
      });
    });

    async function swapNFTsForToken(
      overrides?: Partial<{
        minOutput: BigNumber;
      }>
    ) {
      const swapList = swaps.map(
        ({ collectionPool, nfts: { ids, proof, proofFlags } }) => ({
          pool: collectionPool.address,
          nftIds: ids,
          proof,
          proofFlags,
        })
      );
      return collectionRouter.swapNFTsForToken(
        swapList,
        overrides?.minOutput || totalOutputAmount,
        tokenRecipient,
        deadline
      );
    }

    async function getSellNFTQuotesAndMint(this: Context): Promise<{
      swaps: Swap[];
      totalOutputAmount: BigNumber;
    }> {
      const { test20, user } = this;

      const swaps = [];
      let totalOutputAmount = constants.Zero;

      for (const { collectionPool, nft, heldIds, tokenIDFilter } of pools) {
        const { totalAmount, outputAmount, nfts } =
          await getSellNFTQuoteAndMintNFTs(
            collectionPool,
            nft,
            heldIds,
            user,
            tokenIDFilter,
            collectionRouter.address
          );
        totalOutputAmount = totalOutputAmount.add(outputAmount);

        swaps.push({
          collectionPool,
          nft,
          nfts,
        });

        const poolVariant = await collectionPool.poolVariant();
        const tokenType = getTokenType(poolVariant);
        if (tokenType === "ETH") {
          await setBalance(collectionPool.address, totalAmount);
        } else if (tokenType === "ERC20") {
          await test20.mint(collectionPool.address, totalAmount);
        }
      }

      return { swaps, totalOutputAmount };
    }

    async function createPools(this: Context) {
      const { poolOwners } = await getSigners();
      const pools = await Promise.all(
        poolOwners.map(async (poolOwner) => {
          const tokenType = randomElement("ETH", "ERC20");
          // @ts-ignore
          return createPoolToSwapNFTs(this, tokenType, { poolOwner });
        })
      );
      return { pools };
    }
  }
});

async function collectionRouterFixture() {
  const { safeOwner, user } = await getSigners();
  const fixture = await collectionPoolFixture();
  const { collectionPoolFactory } = fixture;

  const CollectionRouter = await ethers.getContractFactory(
    "CollectionRouter",
    safeOwner
  );
  const collectionRouter = await CollectionRouter.deploy(
    collectionPoolFactory.address
  );
  await collectionRouter.deployed();

  await collectionPoolFactory
    .connect(safeOwner)
    .setRouterAllowed(collectionRouter.address, true);

  return {
    ...fixture,
    collectionRouter: collectionRouter.connect(user),
  };
}
