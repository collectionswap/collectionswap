/* eslint-disable max-nested-callbacks */
import {
  loadFixture,
  setBalance,
} from "@nomicfoundation/hardhat-network-helpers";
import { constants } from "ethers";
import { TokenIDs } from "fummpel";
import { ethers, expect } from "hardhat";

import {
  FEE_DECIMALS,
  NUM_INITIAL_NFTS,
  PoolType,
} from "../../shared/constants";
import { reportGasCost, setUpGasToCost } from "../../shared/ethGasReporter";
import {
  deployPoolContracts,
  nftFixture,
  test20Fixture,
} from "../../shared/fixtures";
import {
  createPoolToSwapNFTs,
  createPoolToSwapToken,
  getBuyNFTQuote,
  getSellNFTQuoteAndMintNFTs,
} from "../../shared/fixtures/CollectionPool";
import {
  byEvent,
  changesEtherBalancesFuzzy,
  changesTokenBalancesFuzzy,
  expectAddressToOwnNFTs,
  getNftTransfersTo,
  mintAndApproveAmountToken,
  toBigInt,
} from "../../shared/helpers";
import {
  randomAddress,
  randomBigNumber,
  randomBigNumbers,
  randomFee,
} from "../../shared/random";
import { getSigners } from "../../shared/signers";

import type { CollectionPoolFactory } from "../../../../typechain-types";
import type {
  CollectionPool,
  ICollectionPool,
  SwapNFTInPoolEventObject,
  SwapNFTOutPoolEventObject,
} from "../../../../typechain-types/contracts/pools/CollectionPool";
import type { CreatePoolOptions } from "../../shared/fixtures/CollectionPool";
import type { Account } from "../../shared/helpers";
import type { IERC721Mintable } from "../../shared/types";
import type { BigNumber, ContractTransaction } from "ethers";
import type { Context } from "mocha";

const FEE_NORMALIZER = ethers.BigNumber.from(10 ** FEE_DECIMALS);

export function setUpCollectionPoolContext() {
  before("Get signers", async function () {
    ({ user: this.user, poolOwner: this.poolOwner } = await getSigners());
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
      collectionDeployer: this.collectionDeployer,
    } = await loadFixture(collectionPoolFixture));
  });

  setUpGasToCost();
}

export function testSwapTokenForAnyNFTs(
  key: "ETH" | "ERC20",
  enumerable: boolean
) {
  testSwapToken(key, enumerable, true);
}

export function testSwapTokenForSpecificNFTs(
  key: "ETH" | "ERC20",
  enumerable: boolean
) {
  testSwapToken(key, enumerable, false);
}

export function testSwapToken(
  key: "ETH" | "ERC20",
  enumerable: boolean,
  any: boolean
) {
  let collectionPool: CollectionPool;

  let nft: IERC721Mintable;

  /** The nfts held by the pool */
  let heldIds: BigNumber[];

  /** The number of nfts in the pool to swap for */
  let numNFTs: number;

  /** The specific nft ids in the pool to swap for */
  let nftIds: BigNumber[] | undefined;

  /** the recipient of the nfts */
  let nftRecipient: string;

  /** the cost to swap the nfts */
  let inputAmount: BigNumber;

  beforeEach("Set nft recipient", function () {
    nftRecipient = randomAddress();
  });

  context("With TOKEN pool type", function () {
    it("Should revert", async function () {
      ({ collectionPool } = await createPool.call(this, {
        poolType: PoolType.TOKEN,
      }));

      nftIds = [];
      numNFTs = 1;
      inputAmount = constants.Zero;

      await expect(swapToken()).to.revertedWithCustomError(
        collectionPool,
        "InvalidSwap"
      );
    });
  });

  context("With NFT pool type", function () {
    beforeEach("Set collection pool to NFT pool type", async function () {
      ({ collectionPool, heldIds } = await createPool.call(this, {
        poolType: PoolType.NFT,
      }));
      ({ inputAmount, numNFTs, nftIds } = await getBuyNFTQuoteAndMintToken.call(
        this
      ));
    });

    it(`Should have no trade fee and transfer ${key} to the respective recipients`, async function () {
      const tx = await swapToken();

      const { tradeFee, protocolFee } = await getSwapNFTOutPoolEventArgs(tx);
      expect(await collectionPool.accruedTradeFee()).to.equal(tradeFee);

      const inputAmountWithoutFee = inputAmount.sub(tradeFee).sub(protocolFee);

      // Make sure there's carry fee multiplier, but it doesn't affect NFT pools
      expect(this.carryFeeMultiplier).greaterThan(0);
      const expectedProtocolFee = inputAmountWithoutFee
        .mul(this.protocolFeeMultiplier)
        .div(FEE_NORMALIZER);
      expect(protocolFee).to.equal(expectedProtocolFee);

      expect(tradeFee).to.equal(0);

      await expectTxToChangeBalances.call(
        this,
        key,
        tx,
        [collectionPool, this.collectionPoolFactory, this.user],
        [inputAmountWithoutFee.add(tradeFee), protocolFee, inputAmount.mul(-1)]
      );
    });
  });

  context("With TRADE pool type", function () {
    let feeMultiplier: BigNumber;

    beforeEach("Set collection pool to TRADE pool type", async function () {
      ({ collectionPool, heldIds } = await createPool.call(this, {
        poolType: PoolType.TRADE,
      }));

      feeMultiplier = randomFee(0.9);
      await collectionPool.connect(this.poolOwner).changeFee(feeMultiplier);

      ({ inputAmount, numNFTs, nftIds } = await getBuyNFTQuoteAndMintToken.call(
        this
      ));
    });

    it(`Should accrue trade fee and transfer ${key} to the respective recipients`, async function () {
      const {
        collectionPoolFactory,
        protocolFeeMultiplier,
        carryFeeMultiplier,
        user,
      } = this;

      const tx = await swapToken();

      const { tradeFee, protocolFee } = await getSwapNFTOutPoolEventArgs(tx);
      expect(await collectionPool.accruedTradeFee()).to.equal(tradeFee);

      const inputAmountWithoutFee = inputAmount.sub(tradeFee).sub(protocolFee);

      // Make sure there's protocol fee multiplier, but it doesn't affect TRADE pools
      expect(protocolFeeMultiplier).greaterThan(0);
      const expectedProtocolFee = inputAmountWithoutFee
        .mul(feeMultiplier)
        .mul(carryFeeMultiplier)
        .div(FEE_NORMALIZER)
        .div(FEE_NORMALIZER);
      expect(protocolFee).to.closeTo(expectedProtocolFee, 1);

      const expectedTradeFee = inputAmountWithoutFee
        .mul(feeMultiplier)
        .div(FEE_NORMALIZER)
        .sub(protocolFee);
      expect(tradeFee).to.equal(expectedTradeFee);
      expect(tradeFee).to.greaterThan(0);

      await expectTxToChangeBalances.call(
        this,
        key,
        tx,
        [collectionPool, collectionPoolFactory, user],
        [inputAmountWithoutFee.add(tradeFee), protocolFee, inputAmount.mul(-1)]
      );
    });
  });

  context("With any valid pool", function () {
    beforeEach("Set collection pool", async function () {
      ({ collectionPool, heldIds, nft } = await createPool.call(this));

      ({ inputAmount, numNFTs, nftIds } = await getBuyNFTQuoteAndMintToken.call(
        this
      ));
    });

    it(`Should transfer ${
      any ? "any" : "the specific"
    } NFTs to the nft recipient`, async function () {
      const tx = await swapToken();
      if (any) {
        nftIds = await getNftTransfersTo(tx, nft, nftRecipient);
        expect(nftIds.length).to.equal(numNFTs);
      }

      await expectAddressToOwnNFTs(nftRecipient, nft, nftIds!);
    });

    context("With maxExpectedTokenInput < input amount", function () {
      it("Should revert", async function () {
        await expect(
          swapToken({
            maxExpectedTokenInput: inputAmount.sub(constants.One),
          })
        ).to.be.revertedWithCustomError(collectionPool, "SlippageExceeded");
      });
    });

    context(`With not enough ${key}`, function () {
      it("Should revert", async function () {
        const { test20, user } = this;
        if (key === "ETH") {
          await expect(
            swapToken({
              value: inputAmount.sub(constants.One),
            })
          ).to.be.revertedWith("Sent too little ETH");
        } else if (key === "ERC20") {
          await test20.burn(user.address, constants.One);
          await expect(swapToken()).to.be.revertedWith("TRANSFER_FROM_FAILED");
        }
      });
    });

    if (any) {
      context("With 0 numNFTs", function () {
        it("Should revert", async function () {
          numNFTs = 0;

          await expect(swapToken()).to.revertedWithCustomError(
            collectionPool,
            "InvalidSwapQuantity"
          );
        });
      });

      context("With numNFTs > pool's NFTs", function () {
        it("Should revert", async function () {
          numNFTs =
            (await nft.balanceOf(collectionPool.address)).toNumber() + 1;

          await expect(swapToken()).to.revertedWithCustomError(
            collectionPool,
            "InvalidSwapQuantity"
          );
        });
      });
    } else {
      context("With empty nftIds", function () {
        it("Should revert", async function () {
          nftIds = [];

          await expect(swapToken()).to.revertedWithCustomError(
            collectionPool,
            "InvalidSwapQuantity"
          );
        });
      });
    }
  });

  describe("Royalties", function () {
    let royaltyNumerator: BigNumber;

    context("With ERC2981", function () {
      beforeEach("Set collection pool", async function () {
        ({ collectionPool, heldIds, nft } = await createPool.call(
          this,
          undefined,
          {
            royalty: true,
          }
        ));
      });

      beforeEach("Set royalty numerator", async function () {
        royaltyNumerator = randomFee(1);
        await collectionPool
          .connect(this.poolOwner)
          .changeRoyaltyNumerator(royaltyNumerator);

        ({ inputAmount, numNFTs, nftIds } =
          await getBuyNFTQuoteAndMintToken.call(this));
      });

      context("With token royalty", function () {
        beforeEach("Set token royalty", async function () {
          for (const id of heldIds) {
            const address = randomAddress();
            await nft.setTokenRoyalty(id, address);
          }
        });

        shouldHaveRoyaltiesAndTransferToken();
      });

      context("With no token royalty", function () {
        context("With royalty recipient fallback", function () {
          beforeEach("Set royalty recipient fallback", async function () {
            const royaltyRecipientFallback = randomAddress();
            await collectionPool
              .connect(this.poolOwner)
              .changeRoyaltyRecipientFallback(royaltyRecipientFallback);
          });

          shouldHaveRoyaltiesAndTransferToken();
        });

        context("With no royalty recipient fallback", function () {
          beforeEach("Unset royalty recipient fallback", async function () {
            await collectionPool
              .connect(this.poolOwner)
              .changeRoyaltyRecipientFallback(constants.AddressZero);
          });

          shouldHaveRoyaltiesAndTransferToken();
        });
      });
    });

    context("With non-ERC2981 and royalty recipient fallback", function () {
      beforeEach("Set collection pool", async function () {
        const { poolOwner } = this;

        ({ collectionPool, heldIds, nft } = await createPool.call(
          this,
          undefined,
          {
            royalty: false,
          }
        ));

        const royaltyRecipientFallback = randomAddress();
        await collectionPool
          .connect(poolOwner)
          .changeRoyaltyRecipientFallback(royaltyRecipientFallback);

        await collectionPool
          .connect(poolOwner)
          .changeRoyaltyNumerator(randomFee(1));

        ({ inputAmount, numNFTs, nftIds } =
          await getBuyNFTQuoteAndMintToken.call(this));
      });

      shouldHaveRoyaltiesAndTransferToken();
    });

    function shouldHaveRoyaltiesAndTransferToken() {
      it(`Should have royalties and transfer ${key} to factory which can then be withdrawn`, async function () {
        const tx = await swapToken();
        if (any) {
          nftIds = await getNftTransfersTo(tx, nft, nftRecipient);
          expect(nftIds.length).to.equal(numNFTs);
        }

        const { tradeFee, protocolFee, royaltyDue } =
          await getSwapNFTOutPoolEventArgs(tx);
        const royaltyAmounts = royaltyDue.map((royalty) => royalty.amount);
        const totalRoyalty = royaltyAmounts.reduce(
          (total: BigNumber, amount: BigNumber) => total.add(amount),
          constants.Zero
        );

        expect(await collectionPool.royaltyNumerator()).to.greaterThan(0);
        if (
          // Pool only pays royalties to addresses other than itself
          royaltyDue.some(
            (royalty) => royalty.recipient !== collectionPool.address
          )
        ) {
          expect(totalRoyalty).to.greaterThan(0);
        }

        const inputAmountWithoutFee = inputAmount
          .sub(tradeFee)
          .sub(protocolFee)
          .sub(totalRoyalty);

        const royaltyRecipients = await Promise.all(
          nftIds!.map(async (id) => {
            if (nft.royaltyInfo) {
              const [receiver] = await nft.royaltyInfo(id, 0);
              if (receiver !== constants.AddressZero) {
                return receiver;
              }
            }

            const royaltyRecipientFallback =
              await collectionPool.royaltyRecipientFallback();
            return royaltyRecipientFallback === constants.AddressZero
              ? collectionPool.address
              : royaltyRecipientFallback;
          })
        );

        expect(royaltyRecipients.length).to.equal(royaltyAmounts.length);
        const recipientToAmount = new Map<string, BigNumber>([
          // Royalties can go back to the pool if it's 2981 and no royal recipient fallback
          [collectionPool.address, inputAmountWithoutFee.add(tradeFee)],
        ]);

        // Sum up the amounts for each recipient
        let totalRoyaltiesStoredInFactory = constants.Zero;
        for (let i = 0; i < royaltyRecipients.length; i++) {
          const recipient = royaltyRecipients[i];
          recipientToAmount.set(
            recipient,
            royaltyAmounts[i].add(
              recipientToAmount.get(recipient) ?? constants.Zero
            )
          );

          if (recipient !== collectionPool.address) {
            totalRoyaltiesStoredInFactory = totalRoyaltiesStoredInFactory.add(
              royaltyAmounts[i]
            );
          }
        }

        const { collectionPoolFactory, user } = this;
        await expectTxToChangeBalances.call(
          this,
          key,
          tx,
          [collectionPoolFactory, user],
          [protocolFee.add(totalRoyaltiesStoredInFactory), inputAmount.mul(-1)]
        );

        await testRoyaltyWithdrawals.call(
          this,
          key,
          collectionPoolFactory,
          collectionPool,
          recipientToAmount
        );
      });
    }
  });

  describe("Gas", function () {
    for (let i = 1; i <= NUM_INITIAL_NFTS; i++) {
      context(`With ${i} nfts`, function () {
        reportGasCost(async function (this: Context) {
          ({ collectionPool, heldIds, nft } = await createPool.call(this));

          ({ inputAmount, numNFTs, nftIds } =
            await getBuyNFTQuoteAndMintToken.call(this, i));

          return swapToken();
        });
      });
    }
  });

  async function swapToken(
    this: any,
    overrides?: Partial<{
      maxExpectedTokenInput?: BigNumber;
      value?: BigNumber;
    }>
  ) {
    const maxExpectedTokenInput =
      overrides?.maxExpectedTokenInput ?? inputAmount;
    const args: any[] = [
      any ? numNFTs : nftIds,
      maxExpectedTokenInput,
      nftRecipient,
      false,
      constants.AddressZero,
    ];
    if (key === "ETH") {
      args.push({
        value:
          overrides?.value ?? inputAmount.add(randomBigNumber(inputAmount)), // give excess ETH to trigger refund
      });
    }

    // @ts-ignore
    return collectionPool[`swapTokenFor${any ? "Any" : "Specific"}NFTs`].apply(
      this,
      args
    );
  }

  async function getBuyNFTQuoteAndMintToken(
    this: Context,
    _numNFTs?: number
  ): Promise<{
    inputAmount: BigNumber;
    numNFTs: number;
    nftIds: BigNumber[] | undefined;
  }> {
    const { test20, user } = this;

    const { inputAmount, numNFTs, nftIds } = await getBuyNFTQuote(
      collectionPool,
      heldIds,
      any,
      _numNFTs
    );
    if (key === "ETH") {
      await setBalance(user.address, inputAmount.mul(2));
    } else if (key === "ERC20") {
      await mintAndApproveAmountToken(
        test20,
        user,
        collectionPool.address,
        inputAmount
      );
    }

    return { inputAmount, numNFTs, nftIds };
  }

  async function createPool(
    this: Context,
    overrides?: {
      poolType: PoolType;
    },
    options?: Partial<CreatePoolOptions>
  ) {
    return createPoolToSwapToken(
      // @ts-ignore
      this,
      key,
      { poolType: overrides?.poolType },
      {
        ...options,
        enumerable,
      }
    );
  }
}

export function testSwapNFTsForToken(
  key: "ETH" | "ERC20",
  enumerable: boolean
) {
  let collectionPool: CollectionPool;

  let nft: IERC721Mintable;

  /** The nfts held by the pool */
  let heldIds: BigNumber[];

  /** The nfts from the user to swap for */
  let nfts: ICollectionPool.NFTsStruct;

  /** The recipient of the ETH / ERC20 tokens */
  let tokenRecipient: string;

  /** The amount of ETH / ERC20 tokens to receive */
  let outputAmount: BigNumber;

  /** The token ID filter set on the pool */
  let tokenIDFilter: TokenIDs | undefined;

  beforeEach("Set token recipient", function () {
    tokenRecipient = randomAddress();
  });

  context("With NFT pool type", function () {
    it("Should revert", async function () {
      ({ collectionPool } = await createPool.call(this, {
        poolType: PoolType.NFT,
      }));

      nfts = {
        ids: [],
        proof: [],
        proofFlags: [],
      };
      outputAmount = constants.Zero;
      tokenRecipient = constants.AddressZero;

      await expect(swapNFTsForToken()).to.revertedWithCustomError(
        collectionPool,
        "InvalidSwap"
      );
    });
  });

  context("With TOKEN pool type", function () {
    beforeEach("Set collection pool to TOKEN pool type", async function () {
      ({ collectionPool, nft, heldIds, tokenIDFilter } = await createPool.call(
        this,
        {
          poolType: PoolType.TOKEN,
        }
      ));

      ({ outputAmount, nfts } = await getSellNFTQuoteAndMint.call(this));
    });

    it("Should not revert", async function () {
      await expect(swapNFTsForToken()).not.to.be.reverted;
    });

    it(`Should have no trade fee and transfer ${key} to the respective recipients`, async function () {
      const {
        collectionPoolFactory,
        protocolFeeMultiplier,
        carryFeeMultiplier,
      } = this;

      const tx = await swapNFTsForToken();

      const { tradeFee, protocolFee } = await getSwapNFTInPoolEventArgs(tx);
      expect(await collectionPool.accruedTradeFee()).to.equal(tradeFee);

      const outputAmountWithoutFee = outputAmount
        .add(tradeFee)
        .add(protocolFee);

      // Make sure there's carry fee multiplier, but it doesn't affect NFT pools
      expect(carryFeeMultiplier).greaterThan(0);
      const expectedProtocolFee = outputAmountWithoutFee
        .mul(protocolFeeMultiplier)
        .div(FEE_NORMALIZER);
      expect(protocolFee).to.equal(expectedProtocolFee);

      expect(tradeFee).to.equal(0);

      await expectTxToChangeBalances.call(
        this,
        key,
        tx,
        [collectionPool, collectionPoolFactory, tokenRecipient],
        [
          outputAmountWithoutFee.sub(tradeFee).mul(-1),
          protocolFee,
          outputAmount,
        ]
      );
    });
  });

  context("With TRADE pool type", function () {
    let feeMultiplier: BigNumber;

    beforeEach("Set collection pool to TRADE pool type", async function () {
      ({ collectionPool, nft, heldIds, tokenIDFilter } = await createPool.call(
        this,
        {
          poolType: PoolType.TRADE,
        }
      ));

      feeMultiplier = randomFee(0.9);
      await collectionPool.connect(this.poolOwner).changeFee(feeMultiplier);

      ({ outputAmount, nfts } = await getSellNFTQuoteAndMint.call(this));
    });

    it("Should not revert", async function () {
      await expect(swapNFTsForToken()).not.to.be.reverted;
    });

    it(`Should accrue trade fee and transfer ${key} to the respective recipients`, async function () {
      const {
        collectionPoolFactory,
        protocolFeeMultiplier,
        carryFeeMultiplier,
      } = this;

      const tx = await swapNFTsForToken();

      const { tradeFee, protocolFee } = await getSwapNFTInPoolEventArgs(tx);
      expect(await collectionPool.accruedTradeFee()).to.equal(tradeFee);

      const outputAmountWithoutFee = outputAmount
        .add(tradeFee)
        .add(protocolFee);

      // Make sure there's protocol fee multiplier, but it doesn't affect TRADE pools
      expect(protocolFeeMultiplier).greaterThan(0);
      const expectedProtocolFee = outputAmountWithoutFee
        .mul(feeMultiplier)
        .mul(carryFeeMultiplier)
        .div(FEE_NORMALIZER)
        .div(FEE_NORMALIZER);
      expect(protocolFee).to.closeTo(expectedProtocolFee, 1);

      const expectedTradeFee = outputAmountWithoutFee
        .mul(feeMultiplier)
        .div(FEE_NORMALIZER)
        .sub(protocolFee);
      expect(tradeFee).to.equal(expectedTradeFee);
      expect(tradeFee).to.greaterThan(0);

      await expectTxToChangeBalances.call(
        this,
        key,
        tx,
        [collectionPool, collectionPoolFactory, tokenRecipient],
        [
          outputAmountWithoutFee.sub(tradeFee).mul(-1),
          protocolFee,
          outputAmount,
        ]
      );
    });
  });

  context("With any valid pool", function () {
    beforeEach("Set collection pool", async function () {
      ({ collectionPool, nft, heldIds, tokenIDFilter } = await createPool.call(
        this
      ));

      ({ outputAmount, nfts } = await getSellNFTQuoteAndMint.call(this));
    });

    it("Should transfer the NFTs to the pool", async function () {
      await swapNFTsForToken();
      await expectAddressToOwnNFTs(collectionPool.address, nft, nfts.ids);
    });

    context("With minExpectedTokenOutput > output amount", function () {
      it("Should revert", async function () {
        await expect(
          swapNFTsForToken({
            minExpectedTokenOutput: outputAmount.add(constants.One),
          })
        ).to.be.revertedWithCustomError(collectionPool, "SlippageExceeded");
      });
    });

    context("With empty nfts.ids", function () {
      it("Should revert", async function () {
        nfts.ids = [];

        await expect(swapNFTsForToken()).to.revertedWithCustomError(
          collectionPool,
          "InvalidSwapQuantity"
        );
      });
    });
  });

  describe("Royalties", function () {
    let royaltyNumerator: BigNumber;
    let royaltyRecipients: string[];

    context("With ERC2981", function () {
      beforeEach("Set collection pool", async function () {
        ({ collectionPool, nft, heldIds, tokenIDFilter } =
          await createPool.call(this, undefined, {
            royalty: true,
          }));
      });

      beforeEach("Set royalty numerator", async function () {
        royaltyNumerator = randomFee(1);
        await collectionPool
          .connect(this.poolOwner)
          .changeRoyaltyNumerator(royaltyNumerator);

        ({ outputAmount, nfts } = await getSellNFTQuoteAndMint.call(this));
      });

      context("With token royalty", function () {
        beforeEach("Set token royalty", async function () {
          royaltyRecipients = [];

          for (const id of nfts.ids) {
            const address = randomAddress();
            await nft.setTokenRoyalty(id, address);
            royaltyRecipients.push(address);
          }
        });

        shouldHaveRoyaltiesAndTransferToken();
      });

      context("With no token royalty", function () {
        context("With royalty recipient fallback", function () {
          beforeEach("Set royalty recipient fallback", async function () {
            const royaltyRecipientFallback = randomAddress();
            await collectionPool
              .connect(this.poolOwner)
              .changeRoyaltyRecipientFallback(royaltyRecipientFallback);
            royaltyRecipients = nfts.ids.map(() => royaltyRecipientFallback);
          });

          shouldHaveRoyaltiesAndTransferToken();
        });

        context("With no royalty recipient fallback", function () {
          beforeEach("Unset royalty recipient fallback", async function () {
            await collectionPool
              .connect(this.poolOwner)
              .changeRoyaltyRecipientFallback(constants.AddressZero);
            royaltyRecipients = nfts.ids.map(() => collectionPool.address);
          });

          shouldHaveRoyaltiesAndTransferToken();
        });
      });
    });

    context("With non-ERC2981 and royalty recipient fallback", function () {
      beforeEach("Set collection pool", async function () {
        const { poolOwner } = this;

        ({ collectionPool, nft, heldIds, tokenIDFilter } =
          await createPool.call(this, undefined, {
            royalty: false,
          }));

        const royaltyRecipientFallback = randomAddress();
        await collectionPool
          .connect(poolOwner)
          .changeRoyaltyRecipientFallback(royaltyRecipientFallback);
        royaltyRecipients = nfts.ids.map(() => royaltyRecipientFallback);

        await collectionPool
          .connect(poolOwner)
          .changeRoyaltyNumerator(randomFee(1));

        ({ outputAmount, nfts } = await getSellNFTQuoteAndMint.call(this));
      });

      shouldHaveRoyaltiesAndTransferToken();
    });

    function shouldHaveRoyaltiesAndTransferToken() {
      it(`Should have royalties and transfer ${key} to the respective recipients`, async function () {
        const tx = await swapNFTsForToken();

        const { tradeFee, protocolFee, royaltyDue } =
          await getSwapNFTInPoolEventArgs(tx);
        const royaltyAmounts = royaltyDue.map((royalty) => royalty.amount);
        const totalRoyalty = royaltyAmounts.reduce(
          (total: BigNumber, amount: BigNumber) => total.add(amount),
          constants.Zero
        );

        expect(await collectionPool.royaltyNumerator()).to.greaterThan(0);
        if (
          // Pool only pays royalties to addresses other than itself
          royaltyDue.some(
            (royalty) => royalty.recipient !== collectionPool.address
          )
        ) {
          expect(totalRoyalty).to.greaterThan(0);
        }

        const outputAmountWithoutFee = outputAmount
          .add(tradeFee)
          .add(protocolFee)
          .add(totalRoyalty);

        expect(royaltyRecipients.length).to.equal(royaltyAmounts.length);
        const recipientToAmount = new Map<string, BigNumber>([
          // Royalties can go back to the pool if it's 2981 and no royal recipient fallback
          [
            collectionPool.address,
            outputAmountWithoutFee.sub(tradeFee).mul(-1),
          ],
        ]);

        // Sum up the amounts for each recipient
        let totalRoyaltiesStoredInFactory = constants.Zero;
        for (let i = 0; i < royaltyRecipients.length; i++) {
          const recipient = royaltyRecipients[i];
          recipientToAmount.set(
            recipient,
            royaltyAmounts[i].add(
              recipientToAmount.get(recipient) ?? constants.Zero
            )
          );

          if (recipient !== collectionPool.address) {
            totalRoyaltiesStoredInFactory = totalRoyaltiesStoredInFactory.add(
              royaltyAmounts[i]
            );
          }
        }

        await expectTxToChangeBalances.call(
          this,
          key,
          tx,
          [this.collectionPoolFactory, tokenRecipient],
          [protocolFee.add(totalRoyaltiesStoredInFactory), outputAmount]
        );

        await testRoyaltyWithdrawals.call(
          this,
          key,
          this.collectionPoolFactory,
          collectionPool,
          recipientToAmount
        );
      });
    }
  });

  describe("Filtered", function () {
    context("With token id filter", function () {
      beforeEach("Set collection pool", async function () {
        ({ collectionPool, nft, heldIds, tokenIDFilter } =
          await createPool.call(this, undefined, {
            filtered: true,
          }));

        ({ outputAmount, nfts } = await getSellNFTQuoteAndMint.call(this));
      });

      context("With valid proofs but different nfts.ids", function () {
        it("Should revert", async function () {
          await expect(
            swapNFTsForToken({
              nfts: { ...nfts, ids: randomBigNumbers(nfts.ids.length) },
            })
          ).to.be.revertedWithCustomError(collectionPool, "NFTsNotAccepted");
        });
      });

      context("With invalid proofs but same nfts.ids", function () {
        it("Should revert", async function () {
          const tokenIds = randomBigNumbers(nfts.ids.length);
          const tokenIDFilter = new TokenIDs(tokenIds.map(toBigInt));
          const { proof, proofFlags } = tokenIDFilter.proof(
            tokenIds.map(toBigInt)
          );

          await expect(
            swapNFTsForToken({
              nfts: { ...nfts, proof, proofFlags },
            })
          ).to.be.revertedWithCustomError(collectionPool, "NFTsNotAccepted");
        });
      });
    });
  });

  describe("Gas", function () {
    for (let i = 1; i <= NUM_INITIAL_NFTS; i++) {
      context(`With ${i} nfts`, function () {
        reportGasCost(async function (this: Context) {
          ({ collectionPool, nft, heldIds, tokenIDFilter } =
            await createPool.call(this));

          ({ outputAmount, nfts } = await getSellNFTQuoteAndMint.call(this, i));

          return swapNFTsForToken();
        });
      });
    }
  });

  async function swapNFTsForToken(
    overrides?: Partial<{
      minExpectedTokenOutput: BigNumber;
      nfts: ICollectionPool.NFTsStruct;
    }>
  ) {
    return collectionPool.swapNFTsForToken(
      overrides?.nfts || nfts,
      overrides?.minExpectedTokenOutput || outputAmount,
      tokenRecipient,
      false,
      constants.AddressZero,
      []
    );
  }

  async function getSellNFTQuoteAndMint(
    this: Context,
    numNFTs?: number
  ): Promise<{
    outputAmount: BigNumber;
    nfts: ICollectionPool.NFTsStruct;
  }> {
    const { test20, user } = this;

    const { totalAmount, outputAmount, nfts } =
      await getSellNFTQuoteAndMintNFTs(
        collectionPool,
        nft,
        heldIds,
        user,
        tokenIDFilter,
        undefined,
        numNFTs
      );

    if (key === "ETH") {
      await setBalance(collectionPool.address, totalAmount);
    } else if (key === "ERC20") {
      await test20.mint(collectionPool.address, totalAmount);
    }

    return { outputAmount, nfts };
  }

  async function createPool(
    this: Context,
    overrides?: {
      poolType: PoolType;
    },
    options?: Partial<CreatePoolOptions>
  ) {
    return createPoolToSwapNFTs(
      // @ts-ignore
      this,
      key,
      { poolType: overrides?.poolType },
      {
        ...options,
        enumerable,
      }
    );
  }
}

async function expectTxToChangeBalances(
  this: Context,
  key: "ETH" | "ERC20",
  tx: ContractTransaction,
  accounts: (Account | string)[],
  balances: BigNumber[]
) {
  if (key === "ETH") {
    expect(await changesEtherBalancesFuzzy(tx, accounts, balances)).to.be.true;
    // await expect(tx).to.changeEtherBalances(accounts, balances);
  } else if (key === "ERC20") {
    expect(await changesTokenBalancesFuzzy(tx, this.test20, accounts, balances))
      .to.be.true;
  }
}

async function testRoyaltyWithdrawals(
  this: Context,
  key: "ETH" | "ERC20",
  factory: CollectionPoolFactory,
  pool: CollectionPool,
  recipientToAmount: Map<string, BigNumber>
) {
  // Pools automatically get their royalties
  const validRecipientsAndRoyalties = Array.from(
    recipientToAmount.entries()
  ).filter(([recipient]) => recipient !== pool.address);
  const recipients = validRecipientsAndRoyalties.map(
    ([recipient]) => recipient
  );
  const amounts = validRecipientsAndRoyalties.map(([_, amount]) => amount);

  // First withdraw protocol fees to verify protocol owner cannot touch royalties
  if (key === "ETH") {
    await factory.connect(this.collectionDeployer).withdrawETHProtocolFees();
  } else {
    await factory
      .connect(this.collectionDeployer)
      .withdrawERC20ProtocolFees(this.test20.address);
  }

  // Next, verify that correct amount of royalties are sent out
  await expectTxToChangeBalances.call(
    this,
    key,
    await factory.withdrawRoyaltiesMultipleRecipients(
      validRecipientsAndRoyalties.map(([recipient]) => recipient),
      key === "ETH" ? constants.AddressZero : this.test20.address
    ),
    recipients,
    amounts
  );

  // Now ensure that recipients can't withdraw more than what's expected
  await expectTxToChangeBalances.call(
    this,
    key,
    await factory.withdrawRoyaltiesMultipleRecipients(
      validRecipientsAndRoyalties.map(([recipient]) => recipient),
      key === "ETH" ? constants.AddressZero : this.test20.address
    ),
    recipients,
    amounts.map(() => constants.Zero)
  );
}

export async function collectionPoolFixture() {
  const {
    factory: collectionPoolFactory,
    protocolFeeMultiplier,
    carryFeeMultiplier,
    curves: { test: testCurve },
    collectionDeployer,
  } = await deployPoolContracts();
  const test20 = await test20Fixture();

  const { poolOwner } = await getSigners();

  return {
    collectionPoolFactory: collectionPoolFactory.connect(poolOwner),
    protocolFeeMultiplier,
    carryFeeMultiplier,
    curve: testCurve,
    ...(await nftFixture()),
    test20,
    collectionDeployer,
  };
}

async function getSwapNFTOutPoolEventArgs(
  tx: ContractTransaction
): Promise<SwapNFTOutPoolEventObject> {
  const receipt = await tx.wait();
  const event = receipt.events!.find(byEvent("SwapNFTOutPool"))!;
  return event.args as unknown as SwapNFTOutPoolEventObject;
}

async function getSwapNFTInPoolEventArgs(
  tx: ContractTransaction
): Promise<SwapNFTInPoolEventObject> {
  const receipt = await tx.wait();
  const event = receipt.events!.find(byEvent("SwapNFTInPool"))!;
  return event.args as unknown as SwapNFTInPoolEventObject;
}
