import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { TokenIDs } from "filter_code";
import { ethers, expect } from "hardhat";

import {
  DEFAULT_CREATE_ERC20_POOL_PARAMS,
  NUM_INITIAL_NFTS,
  PoolType,
} from "../shared/constants";
import {
  deployPoolContracts,
  nftFixture,
  test20Fixture,
} from "../shared/fixtures";
import {
  byEvent,
  expectAddressToOwnNFTs,
  getPoolAddress,
  mintAndApproveAmountToken,
  mintAndApproveNfts,
  mintAndApproveRandomNfts,
  pickRandomElements,
  toBigInt,
  toBigNumber,
} from "../shared/helpers";
import {
  randomAddress,
  randomBigNumbers,
  randomElement,
  randomEthValue,
} from "../shared/random";
import { getSigners } from "../shared/signers";

import type {
  CollectionPoolFactory,
  Test20,
  Test721,
  Test721Enumerable,
  Test721EnumerableRoyalty,
  Test721Royalty,
} from "../../../typechain-types";
import type {
  CollectionPool,
  ICollectionPool,
  SwapNFTInPoolEventObject,
  SwapNFTOutPoolEventObject,
} from "../../../typechain-types/contracts/pools/CollectionPool";
import type { IERC721Mintable } from "../shared/types";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import type { BigNumber, Contract, ContractTransaction } from "ethers";

describe("CollectionPoolERC20", function () {
  let collectionPoolFactory: CollectionPoolFactory;
  let protocolFeeMultiplier: BigNumber;
  let carryFeeMultiplier: BigNumber;
  let curve: Contract;
  let test20: Test20;
  let test721: Test721;
  let test721Enumerable: Test721Enumerable;
  let test721EnumerableRoyalty: Test721EnumerableRoyalty;
  let test721Royalty: Test721Royalty;
  let collectionPool: CollectionPool;
  let nft: IERC721Mintable;
  let poolOwner: SignerWithAddress;
  let user: SignerWithAddress;

  before("Get signers", async function () {
    ({ user, poolOwner } = await getSigners());
  });

  beforeEach("Load fixture", async function () {
    ({
      collectionPoolFactory,
      protocolFeeMultiplier,
      carryFeeMultiplier,
      curve,
      test20,
      test721,
      test721Enumerable,
      test721EnumerableRoyalty,
      test721Royalty,
    } = await loadFixture(collectionPoolFixture));
  });

  describe("#swapTokenForSpecificNFTs", function () {
    /** The token ids in the pool */
    let tokenIds: BigNumber[];

    /** The specific nft ids in the pool to swap for */
    let nftIds: BigNumber[];

    /** the recipient of the nfts */
    let nftRecipient: string;

    /** the cost to swap the nfts */
    let inputAmount: BigNumber;

    context("With TOKEN pool type", function () {
      it("Should revert", async function () {
        ({ collectionPool } = await createPoolERC20({
          poolType: PoolType.TOKEN,
        }));

        nftIds = [];
        inputAmount = ethers.constants.Zero;
        nftRecipient = ethers.constants.AddressZero;

        await expect(swapTokenForSpecificNFTs()).to.revertedWith(
          "Wrong Pool type"
        );
      });
    });

    context("With NFT pool type", function () {
      beforeEach("Set collection pool to NFT pool type", async function () {
        ({ collectionPool, tokenIds } = await createPoolERC20({
          poolType: PoolType.NFT,
        }));

        nftIds = pickRandomElements(tokenIds, tokenIds.length / 2);
        nftRecipient = randomAddress();

        inputAmount = await getBuyNFTQuoteAndMintTest20();
      });

      it("Should have no trade fee and transfer ERC20 to the respective recipients", async function () {
        const tx = await swapTokenForSpecificNFTs();

        const { tradeFee, protocolFee } = await getSwapNFTOutPoolEventArgs(tx);
        expect(await collectionPool.accruedTradeFee()).to.equal(tradeFee);

        const inputAmountWithoutFee = inputAmount
          .sub(tradeFee)
          .sub(protocolFee);

        // Make sure there's carry fee multiplier, but it doesn't affect NFT pools
        expect(carryFeeMultiplier).greaterThan(0);
        const expectedProtocolFee = inputAmountWithoutFee
          .mul(protocolFeeMultiplier)
          .div(ethers.constants.WeiPerEther);
        expect(protocolFee).to.equal(expectedProtocolFee);

        expect(tradeFee).to.equal(0);

        await expect(tx).to.changeTokenBalances(
          test20,
          [collectionPool, collectionPoolFactory, user],
          [
            inputAmountWithoutFee.add(tradeFee),
            protocolFee,
            inputAmount.mul(-1),
          ]
        );
      });
    });

    context("With TRADE pool type", function () {
      let feeMultiplier: BigNumber;

      beforeEach("Set collection pool to TRADE pool type", async function () {
        ({ collectionPool, tokenIds } = await createPoolERC20({
          poolType: PoolType.TRADE,
        }));

        feeMultiplier = randomEthValue(0.9);
        await collectionPool.connect(poolOwner).changeFee(feeMultiplier);

        nftIds = pickRandomElements(tokenIds, tokenIds.length / 2);
        nftRecipient = randomAddress();

        inputAmount = await getBuyNFTQuoteAndMintTest20();
      });

      it("Should accrue trade fee and transfer ERC20 to the respective recipients", async function () {
        const tx = await swapTokenForSpecificNFTs();

        const { tradeFee, protocolFee } = await getSwapNFTOutPoolEventArgs(tx);
        expect(await collectionPool.accruedTradeFee()).to.equal(tradeFee);

        const inputAmountWithoutFee = inputAmount
          .sub(tradeFee)
          .sub(protocolFee);

        // Make sure there's protocol fee multiplier, but it doesn't affect TRADE pools
        expect(protocolFeeMultiplier).greaterThan(0);
        const expectedProtocolFee = inputAmountWithoutFee
          .mul(feeMultiplier)
          .mul(carryFeeMultiplier)
          .div(ethers.constants.WeiPerEther)
          .div(ethers.constants.WeiPerEther);
        expect(protocolFee).to.equal(expectedProtocolFee);

        const expectedTradeFee = inputAmountWithoutFee
          .mul(feeMultiplier)
          .div(ethers.constants.WeiPerEther)
          .sub(protocolFee);
        expect(tradeFee).to.equal(expectedTradeFee);
        expect(tradeFee).to.greaterThan(0);

        await expect(tx).to.changeTokenBalances(
          test20,
          [collectionPool, collectionPoolFactory, user],
          [
            inputAmountWithoutFee.add(tradeFee),
            protocolFee,
            inputAmount.mul(-1),
          ]
        );
      });
    });

    context("With any valid pool", function () {
      beforeEach("Set collection pool", async function () {
        ({ collectionPool, tokenIds, nft } = await createPoolERC20());

        nftIds = pickRandomElements(tokenIds, tokenIds.length / 2);
        nftRecipient = randomAddress();

        inputAmount = await getBuyNFTQuoteAndMintTest20();
      });

      it("Should transfer the specific NFTs to the nft recipient", async function () {
        await swapTokenForSpecificNFTs();
        await expectAddressToOwnNFTs(nftRecipient, nft, nftIds);
      });

      context("With maxExpectedTokenInput < input amount", function () {
        it("Should revert", async function () {
          await expect(
            swapTokenForSpecificNFTs({
              maxExpectedTokenInput: inputAmount.sub(ethers.constants.One),
            })
          ).to.be.revertedWith("In too many tokens");
        });
      });
    });

    describe("Royalties", function () {
      let royaltyNumerator: BigNumber;
      let royaltyRecipients: string[];

      context("With ERC2981", function () {
        beforeEach("Set collection pool", async function () {
          ({ collectionPool, tokenIds, nft } = await createPoolERC20({
            nft: randomElement(test721EnumerableRoyalty, test721Royalty),
          }));

          nftIds = pickRandomElements(tokenIds, tokenIds.length / 2);
          nftRecipient = randomAddress();
        });

        beforeEach("Set royalty numerator", async function () {
          royaltyNumerator = randomEthValue(1);
          await collectionPool
            .connect(poolOwner)
            .changeRoyaltyNumerator(royaltyNumerator);

          inputAmount = await getBuyNFTQuoteAndMintTest20();
        });

        context("With token royalty", function () {
          beforeEach("Set token royalty", async function () {
            royaltyRecipients = [];

            for (const id of nftIds) {
              const address = randomAddress();
              await nft.setTokenRoyalty(id, address);
              royaltyRecipients.push(address);
            }
          });

          shouldHaveRoyaltiesAndTransferERC20();
        });

        context("With no token royalty", function () {
          context("With royalty recipient fallback", function () {
            beforeEach("Set royalty recipient fallback", async function () {
              const royaltyRecipientFallback = randomAddress();
              await collectionPool
                .connect(poolOwner)
                .changeRoyaltyRecipientFallback(royaltyRecipientFallback);
              royaltyRecipients = nftIds.map(() => royaltyRecipientFallback);
            });

            shouldHaveRoyaltiesAndTransferERC20();
          });

          context("With no royalty recipient fallback", function () {
            beforeEach("Unset royalty recipient fallback", async function () {
              await collectionPool
                .connect(poolOwner)
                .changeRoyaltyRecipientFallback(ethers.constants.AddressZero);
              royaltyRecipients = nftIds.map(() => collectionPool.address);
            });

            shouldHaveRoyaltiesAndTransferERC20();
          });
        });
      });

      context("With non-ERC2981 and royalty recipient fallback", function () {
        beforeEach("Set collection pool", async function () {
          ({ collectionPool, tokenIds, nft } = await createPoolERC20({
            nft: randomElement(test721, test721Enumerable),
          }));

          const royaltyRecipientFallback = randomAddress();
          await collectionPool
            .connect(poolOwner)
            .changeRoyaltyRecipientFallback(royaltyRecipientFallback);
          royaltyRecipients = nftIds.map(() => royaltyRecipientFallback);

          await collectionPool
            .connect(poolOwner)
            .changeRoyaltyNumerator(randomEthValue(1));

          nftIds = pickRandomElements(tokenIds, tokenIds.length / 2);
          nftRecipient = randomAddress();

          inputAmount = await getBuyNFTQuoteAndMintTest20();
        });

        shouldHaveRoyaltiesAndTransferERC20();
      });

      function shouldHaveRoyaltiesAndTransferERC20() {
        it("Should have royalties and transfer ERC20 to the respective recipients", async function () {
          const tx = await swapTokenForSpecificNFTs();

          const { tradeFee, protocolFee, royaltyDue } =
            await getSwapNFTOutPoolEventArgs(tx);
          const royaltyAmounts = royaltyDue.map((royalty) => royalty.amount);
          const totalRoyalty = royaltyAmounts.reduce(
            (total: BigNumber, amount: BigNumber) => total.add(amount),
            ethers.constants.Zero
          );

          expect(await collectionPool.royaltyNumerator()).to.greaterThan(0);
          expect(totalRoyalty).to.greaterThan(0);

          const inputAmountWithoutFee = inputAmount
            .sub(tradeFee)
            .sub(protocolFee)
            .sub(totalRoyalty);

          expect(royaltyRecipients.length).to.equal(royaltyAmounts.length);
          const recipientToAmount = new Map<string, BigNumber>([
            // Royalties can go back to the pool if it's 2981 and no royal recipient fallback
            [collectionPool.address, inputAmountWithoutFee.add(tradeFee)],
          ]);

          // Sum up the amounts for each recipient
          for (let i = 0; i < royaltyRecipients.length; i++) {
            const recipient = royaltyRecipients[i];
            recipientToAmount.set(
              recipient,
              royaltyAmounts[i].add(
                recipientToAmount.get(recipient) ?? ethers.constants.Zero
              )
            );
          }

          await expect(tx).to.changeTokenBalances(
            test20,
            [collectionPoolFactory, user, ...recipientToAmount.keys()],
            [protocolFee, inputAmount.mul(-1), ...recipientToAmount.values()]
          );
        });
      }
    });

    async function swapTokenForSpecificNFTs(
      overrides?: Partial<{ maxExpectedTokenInput: BigNumber }>
    ) {
      const maxExpectedTokenInput =
        overrides?.maxExpectedTokenInput || inputAmount;
      return collectionPool.swapTokenForSpecificNFTs(
        nftIds,
        maxExpectedTokenInput,
        nftRecipient,
        false,
        ethers.constants.AddressZero
      );
    }

    async function getBuyNFTQuoteAndMintTest20(): Promise<BigNumber> {
      const { inputAmount } = await collectionPool.getBuyNFTQuote(
        nftIds.length
      );
      await mintAndApproveAmountToken(
        test20,
        user,
        collectionPool.address,
        inputAmount
      );

      return inputAmount;
    }

    async function createPoolERC20(
      overrides?: Partial<{ nft: IERC721Mintable; poolType: number }>
    ) {
      const nft =
        overrides?.nft ??
        randomElement(
          test721,
          test721Enumerable,
          test721Royalty,
          test721EnumerableRoyalty
        );
      const tokenIds = await mintAndApproveRandomNfts(
        nft,
        poolOwner,
        collectionPoolFactory.address,
        NUM_INITIAL_NFTS
      );

      const poolType =
        overrides?.poolType ?? randomElement(PoolType.NFT, PoolType.TRADE);
      const tx = await collectionPoolFactory.createPoolERC20({
        ...DEFAULT_CREATE_ERC20_POOL_PARAMS,
        token: test20.address,
        nft: nft.address,
        bondingCurve: curve.address,
        receiver: poolOwner.address,
        poolType,
        initialNFTIDs: tokenIds,
      });

      const { newPoolAddress } = await getPoolAddress(tx);
      const collectionPool = await ethers.getContractAt(
        "CollectionPoolMissingEnumerableERC20",
        newPoolAddress,
        user
      );

      return { collectionPool, nft, tokenIds };
    }
  });

  describe("#swapNFTsForToken", function () {
    /** The nfts from the user to swap for */
    let nfts: ICollectionPool.NFTsStruct;

    /** The recipient of the ERC20 tokens */
    let tokenRecipient: string;

    /** The amount of ERC20 tokens to receive */
    let outputAmount: BigNumber;

    /** The token ID filter set on the pool */
    let tokenIDFilter: TokenIDs | undefined;

    beforeEach("Set token recipient", function () {
      tokenRecipient = randomAddress();
    });

    context("With NFT pool type", function () {
      it("Should revert", async function () {
        ({ collectionPool, tokenIDFilter } = await createPoolERC20({
          poolType: PoolType.NFT,
        }));

        nfts = {
          ids: [],
          proof: [],
          proofFlags: [],
        };
        outputAmount = ethers.constants.Zero;
        tokenRecipient = ethers.constants.AddressZero;

        await expect(swapNFTsForToken()).to.revertedWith("Wrong Pool type");
      });
    });

    context("With TOKEN pool type", function () {
      beforeEach("Set collection pool to TOKEN pool type", async function () {
        ({ collectionPool, nft, tokenIDFilter } = await createPoolERC20({
          poolType: PoolType.TOKEN,
        }));

        ({ outputAmount, nfts } = await getSellNFTQuoteAndMint());
      });

      it("Should not revert", async function () {
        await expect(swapNFTsForToken()).not.to.be.reverted;
      });

      it("Should have no trade fee and transfer ERC20 to the respective recipients", async function () {
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
          .div(ethers.constants.WeiPerEther);
        expect(protocolFee).to.equal(expectedProtocolFee);

        expect(tradeFee).to.equal(0);

        await expect(tx).to.changeTokenBalances(
          test20,
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
        ({ collectionPool, nft, tokenIDFilter } = await createPoolERC20({
          poolType: PoolType.TRADE,
        }));

        feeMultiplier = randomEthValue(0.9);
        await collectionPool.connect(poolOwner).changeFee(feeMultiplier);

        ({ outputAmount, nfts } = await getSellNFTQuoteAndMint());
      });

      it("Should not revert", async function () {
        await expect(swapNFTsForToken()).not.to.be.reverted;
      });

      it("Should accrue trade fee and transfer ERC20 to the respective recipients", async function () {
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
          .div(ethers.constants.WeiPerEther)
          .div(ethers.constants.WeiPerEther);
        expect(protocolFee).to.equal(expectedProtocolFee);

        const expectedTradeFee = outputAmountWithoutFee
          .mul(feeMultiplier)
          .div(ethers.constants.WeiPerEther)
          .sub(protocolFee);
        expect(tradeFee).to.equal(expectedTradeFee);
        expect(tradeFee).to.greaterThan(0);

        await expect(tx).to.changeTokenBalances(
          test20,
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
        ({ collectionPool, nft, tokenIDFilter } = await createPoolERC20());

        ({ outputAmount, nfts } = await getSellNFTQuoteAndMint());
      });

      it("Should transfer the NFTs to the pool", async function () {
        await swapNFTsForToken();
        await expectAddressToOwnNFTs(collectionPool.address, nft, nfts.ids);
      });

      context("With minExpectedTokenOutput > output amount", function () {
        it("Should revert", async function () {
          await expect(
            swapNFTsForToken({
              minExpectedTokenOutput: outputAmount.add(ethers.constants.One),
            })
          ).to.be.revertedWith("Out too little tokens");
        });
      });
    });

    describe("Royalties", function () {
      let royaltyNumerator: BigNumber;
      let royaltyRecipients: string[];

      context("With ERC2981", function () {
        beforeEach("Set collection pool", async function () {
          ({ collectionPool, nft, tokenIDFilter } = await createPoolERC20({
            nft: randomElement(test721EnumerableRoyalty, test721Royalty),
          }));
        });

        beforeEach("Set royalty numerator", async function () {
          royaltyNumerator = randomEthValue(1);
          await collectionPool
            .connect(poolOwner)
            .changeRoyaltyNumerator(royaltyNumerator);

          ({ outputAmount, nfts } = await getSellNFTQuoteAndMint());
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

          shouldHaveRoyaltiesAndTransferERC20();
        });

        context("With no token royalty", function () {
          context("With royalty recipient fallback", function () {
            beforeEach("Set royalty recipient fallback", async function () {
              const royaltyRecipientFallback = randomAddress();
              await collectionPool
                .connect(poolOwner)
                .changeRoyaltyRecipientFallback(royaltyRecipientFallback);
              royaltyRecipients = nfts.ids.map(() => royaltyRecipientFallback);
            });

            shouldHaveRoyaltiesAndTransferERC20();
          });

          context("With no royalty recipient fallback", function () {
            beforeEach("Unset royalty recipient fallback", async function () {
              await collectionPool
                .connect(poolOwner)
                .changeRoyaltyRecipientFallback(ethers.constants.AddressZero);
              royaltyRecipients = nfts.ids.map(() => collectionPool.address);
            });

            shouldHaveRoyaltiesAndTransferERC20();
          });
        });
      });

      context("With non-ERC2981 and royalty recipient fallback", function () {
        beforeEach("Set collection pool", async function () {
          ({ collectionPool, nft, tokenIDFilter } = await createPoolERC20({
            nft: randomElement(test721, test721Enumerable),
          }));

          const royaltyRecipientFallback = randomAddress();
          await collectionPool
            .connect(poolOwner)
            .changeRoyaltyRecipientFallback(royaltyRecipientFallback);
          royaltyRecipients = nfts.ids.map(() => royaltyRecipientFallback);

          await collectionPool
            .connect(poolOwner)
            .changeRoyaltyNumerator(randomEthValue(1));

          ({ outputAmount, nfts } = await getSellNFTQuoteAndMint());
        });

        shouldHaveRoyaltiesAndTransferERC20();
      });

      function shouldHaveRoyaltiesAndTransferERC20() {
        it("Should have royalties and transfer ERC20 to the respective recipients", async function () {
          const tx = await swapNFTsForToken();

          const { tradeFee, protocolFee, royaltyDue } =
            await getSwapNFTInPoolEventArgs(tx);
          const royaltyAmounts = royaltyDue.map((royalty) => royalty.amount);
          const totalRoyalty = royaltyAmounts.reduce(
            (total: BigNumber, amount: BigNumber) => total.add(amount),
            ethers.constants.Zero
          );

          expect(await collectionPool.royaltyNumerator()).to.greaterThan(0);
          expect(totalRoyalty).to.greaterThan(0);

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
          for (let i = 0; i < royaltyRecipients.length; i++) {
            const recipient = royaltyRecipients[i];
            recipientToAmount.set(
              recipient,
              royaltyAmounts[i].add(
                recipientToAmount.get(recipient) ?? ethers.constants.Zero
              )
            );
          }

          await expect(tx).to.changeTokenBalances(
            test20,
            [
              collectionPoolFactory,
              tokenRecipient,
              ...recipientToAmount.keys(),
            ],
            [protocolFee, outputAmount, ...recipientToAmount.values()]
          );
        });
      }
    });

    describe("Filtered", function () {
      context("With token id filter", function () {
        beforeEach("Set collection pool", async function () {
          ({ collectionPool, nft, tokenIDFilter } = await createPoolERC20({
            filtered: true,
          }));

          ({ outputAmount, nfts } = await getSellNFTQuoteAndMint());
        });

        context("With valid proofs but different nfts.ids", function () {
          it("Should revert", async function () {
            await expect(
              swapNFTsForToken({
                nfts: { ...nfts, ids: randomBigNumbers(nfts.ids.length) },
              })
            ).to.be.revertedWith("NFT not allowed");
          });
        });

        context("With invalid proofs but same nfts.ids", function () {
          it("Should revert", async function () {
            const tokenIds = randomBigNumbers(nfts.ids.length);
            const tokenIDFilter = new TokenIDs(tokenIds.map(toBigInt));
            await collectionPool
              .connect(poolOwner)
              .setTokenIDFilter(tokenIDFilter.root(), tokenIDFilter.encode());

            await expect(swapNFTsForToken()).to.be.revertedWith(
              "NFT not allowed"
            );
          });
        });
      });
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
        ethers.constants.AddressZero
      );
    }

    async function getSellNFTQuoteAndMint(): Promise<{
      outputAmount: BigNumber;
      nfts: ICollectionPool.NFTsStruct;
    }> {
      let nfts;
      if (tokenIDFilter) {
        const tokenIds = await mintAndApproveNfts(
          nft,
          user,
          collectionPool.address,
          pickRandomElements(
            tokenIDFilter.tokens().map(toBigNumber),
            NUM_INITIAL_NFTS
          )
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
          user,
          collectionPool.address,
          NUM_INITIAL_NFTS
        );
        nfts = {
          ids: tokenIds,
          proof: [],
          proofFlags: [],
        };
      }

      const { totalAmount, outputAmount } =
        await collectionPool.getSellNFTQuote(nfts.ids.length);
      await test20.mint(collectionPool.address, totalAmount);

      return { outputAmount, nfts };
    }

    async function createPoolERC20(
      overrides?: Partial<{
        nft: IERC721Mintable;
        poolType: number;
        filtered: boolean;
      }>
    ) {
      const nft =
        overrides?.nft ??
        randomElement(
          test721,
          test721Enumerable,
          test721EnumerableRoyalty,
          test721Royalty
        );

      const poolType =
        overrides?.poolType ?? randomElement(PoolType.TOKEN, PoolType.TRADE);
      const tx = await collectionPoolFactory.createPoolERC20({
        ...DEFAULT_CREATE_ERC20_POOL_PARAMS,
        token: test20.address,
        nft: nft.address,
        bondingCurve: curve.address,
        receiver: poolOwner.address,
        poolType,
        initialNFTIDs: [],
      });

      const { newPoolAddress } = await getPoolAddress(tx);
      const collectionPool = await ethers.getContractAt(
        "CollectionPoolMissingEnumerableERC20",
        newPoolAddress,
        user
      );

      let tokenIDFilter;
      if (overrides?.filtered ?? Math.random() < 0.5) {
        tokenIDFilter = new TokenIDs(
          randomBigNumbers(NUM_INITIAL_NFTS * 2).map(toBigInt)
        );
        await collectionPool
          .connect(poolOwner)
          .setTokenIDFilter(tokenIDFilter.root(), tokenIDFilter.encode());
      }

      return { collectionPool, nft, tokenIDFilter };
    }
  });
});

async function collectionPoolFixture() {
  const {
    factory: collectionPoolFactory,
    protocolFeeMultiplier,
    carryFeeMultiplier,
    curves: { test: testCurve },
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
