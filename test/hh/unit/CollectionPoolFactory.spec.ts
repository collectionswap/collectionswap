import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { TokenIDs } from "filter_code";
import { ethers } from "hardhat";

import { NUM_INITIAL_NFTS } from "../shared/constants";
import {
  collectionFixture,
  nftFixture,
  test20Fixture,
} from "../shared/fixtures";
import {
  expectAddressToOwnNFTs,
  getPoolAddress,
  mintAndApproveRandomNfts,
  mintAndApproveRandomAmountToken,
  pickRandomElements,
  mintAndApproveNfts,
  toBigInt,
} from "../shared/helpers";
import {
  randomAddress,
  randomBigNumbers,
  randomEthValue,
} from "../shared/random";
import { getSigners } from "../shared/signers";

import type {
  NoopCurve,
  Test20,
  Test721,
  Test721Royalty,
} from "../../../typechain-types";
import type {
  CollectionPoolFactory,
  ICollectionPoolFactory,
} from "../../../typechain-types/contracts/pools/CollectionPoolFactory";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import type { BigNumber, ContractTransaction } from "ethers";

const DEFAULT_CREATE_ETH_POOL_PARAMS: ICollectionPoolFactory.CreateETHPoolParamsStruct =
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
    royaltyRecipientOverride: ethers.constants.AddressZero,
    initialNFTIDs: [],
  };
const DEFAULT_CREATE_ERC20_POOL_PARAMS: ICollectionPoolFactory.CreateERC20PoolParamsStruct =
  {
    ...DEFAULT_CREATE_ETH_POOL_PARAMS,
    token: ethers.constants.AddressZero,
    initialTokenBalance: ethers.constants.Zero,
  };

describe("CollectionPoolFactory", function () {
  let collectionPoolFactory: CollectionPoolFactory;
  let noopCurve: NoopCurve;
  let test20: Test20;
  let test721: Test721;
  let test721Royalty: Test721Royalty;
  let user: SignerWithAddress;

  before("Get signers", async function () {
    ({ user } = await getSigners());
  });

  beforeEach("Load collectionFixture", async function () {
    ({
      factory: collectionPoolFactory,
      curves: { noop: noopCurve },
      test20,
      test721,
      test721Royalty,
    } = await loadFixture(collectionPoolFactoryFixture));
    collectionPoolFactory = collectionPoolFactory.connect(user);
  });

  describe("Create Pools", function () {
    describe("#createPoolETH", function () {
      testCreatePoolETH();
    });

    describe("#createPoolETHFiltered", function () {
      testCreatePoolETH(true);

      testFilter("ETH");
    });

    describe("#createPoolERC20", function () {
      testCreatePoolERC20();
    });

    describe("#createPoolERC20Filtered", function () {
      testCreatePoolERC20(true);

      testFilter("ERC20");
    });

    function testCreatePoolETH(filtered = false) {
      beforeEach("Reset createETHPoolParams", function () {
        this.createETHPoolParams = {
          ...DEFAULT_CREATE_ETH_POOL_PARAMS,
          nft: test721.address,
          bondingCurve: noopCurve.address,
          receiver: randomAddress(),
        };
      });

      it("Should transfer ETH to pool", async function () {
        const value = randomEthValue();
        const tx = await collectionPoolFactory.createPoolETH(
          this.createETHPoolParams,
          {
            value,
          }
        );
        const { newPoolAddress } = await getPoolAddress(tx);
        await expect(tx).changeEtherBalances(
          [user, newPoolAddress],
          [value.mul(-1), value]
        );
      });

      testCreatePool("ETH", filtered);
    }

    function testCreatePoolERC20(filtered = false) {
      beforeEach("Reset createERC20PoolParams", function () {
        this.createERC20PoolParams = {
          ...DEFAULT_CREATE_ERC20_POOL_PARAMS,
          token: test20.address,
          nft: test721.address,
          bondingCurve: noopCurve.address,
          receiver: randomAddress(),
        };
      });

      it("Should transfer ERC20 to pool", async function () {
        const amount = await mintAndApproveRandomAmountToken(
          test20,
          user,
          collectionPoolFactory.address
        );

        const tx = await collectionPoolFactory.createPoolERC20({
          ...this.createERC20PoolParams,
          initialTokenBalance: amount,
        });
        const { newPoolAddress } = await getPoolAddress(tx);
        await expect(tx).changeTokenBalances(
          test20,
          [user, newPoolAddress],
          [amount.mul(-1), amount]
        );
      });

      testCreatePool("ERC20", filtered);
    }

    function testCreatePool(key: "ETH" | "ERC20", filtered = false) {
      describe("Bonding Curve", function () {
        context("With whitelisted bonding curve", function () {
          it("Should not revert", async function () {
            await expect(createPool.bind(this)()).not.to.be.reverted;
          });
        });

        context("With non-whitelisted bonding curve", function () {
          it("Should revert", async function () {
            this[`create${key}PoolParams`].bondingCurve =
              ethers.constants.AddressZero;

            await expect(createPool.bind(this)()).to.be.revertedWith(
              "Bonding curve not whitelisted"
            );
          });
        });
      });

      describe("LP Token", function () {
        context("With zero address receiver", function () {
          it("Should revert", async function () {
            this[`create${key}PoolParams`].receiver =
              ethers.constants.AddressZero;

            await expect(createPool.bind(this)()).to.be.revertedWith(
              "ERC721: mint to the zero address"
            );
          });
        });

        context("With non-zero address receiver", function () {
          it("Should not revert", async function () {
            await expect(createPool.bind(this)()).not.to.be.reverted;
          });
        });

        it("Should emit lp token to receiver", async function () {
          const tx = await createPool.bind(this)();
          const { newTokenId } = await getPoolAddress(tx);
          expect(await collectionPoolFactory.ownerOf(newTokenId)).to.equal(
            this[`create${key}PoolParams`].receiver
          );
        });

        it("Should increment lp token id", async function () {
          const tx = await createPool.bind(this)();
          const { newTokenId } = await getPoolAddress(tx);
          expect((await callStaticCreatePool.bind(this)()).tokenId).to.equal(
            newTokenId.add(ethers.constants.One)
          );
        });
      });

      describe("Royalties", function () {
        context("With valid royalty state", function () {
          beforeEach("Make royalty state valid", function () {
            if (Math.random() < 0.5) {
              this[`create${key}PoolParams`].nft = test721Royalty.address;
            } else {
              this[`create${key}PoolParams`].royaltyRecipientOverride =
                randomAddress();
            }
          });

          context("With non-zero royalty numerator = 1e18", function () {
            it("should revert", async function () {
              this[`create${key}PoolParams`].royaltyNumerator =
                ethers.utils.parseEther("1");

              await expect(createPool.bind(this)()).to.be.revertedWith(
                "royaltyNumerator must be < 1e18"
              );
            });
          });

          context("With non-zero royalty numerator >= 1e18", function () {
            it("should revert", async function () {
              this[`create${key}PoolParams`].royaltyNumerator =
                ethers.constants.MaxUint256.sub(randomEthValue(1));

              await expect(createPool.bind(this)()).to.be.revertedWith(
                "royaltyNumerator must be < 1e18"
              );
            });
          });
        });

        describe("Royalty state", function () {
          withRoyaltyNumerator(function () {
            withERC2981(withRoyaltyRecipientOverride(shouldRevert))();
            withRoyaltyRecipientOverride(withERC2981(shouldRevert))();
          })();
          withERC2981(function () {
            withRoyaltyNumerator(withRoyaltyRecipientOverride(shouldRevert))();
            withRoyaltyRecipientOverride(withRoyaltyNumerator(shouldRevert))();
          })();
          withRoyaltyRecipientOverride(function () {
            withERC2981(withRoyaltyNumerator(shouldRevert))();
            withRoyaltyNumerator(withERC2981(shouldRevert))();
          })();

          function withRoyaltyNumerator(fn: () => void) {
            return function () {
              context("With zero royalty numerator", function () {
                it("Should not revert", async function () {
                  await expect(createPool.bind(this)()).not.to.be.reverted;
                });
              });

              context("With non-zero royalty numerator < 1e18", function () {
                beforeEach("Set random royalty numerator < 1e18", function () {
                  const royaltyNumerator = randomEthValue(1);
                  expect(royaltyNumerator).to.lessThan(
                    ethers.utils.parseEther("1")
                  );
                  this[`create${key}PoolParams`].royaltyNumerator =
                    royaltyNumerator;
                });

                fn();
              });
            };
          }

          function withERC2981(fn: () => void) {
            return function () {
              context("With ERC2981", function () {
                it("Should not revert", async function () {
                  this[`create${key}PoolParams`].nft = test721Royalty.address;

                  await expect(createPool.bind(this)()).not.to.be.reverted;
                });
              });

              context("With non-ERC2981", function () {
                fn();
              });
            };
          }

          function withRoyaltyRecipientOverride(fn: () => void) {
            return function () {
              context("With royalty recipient override", function () {
                it("Should not revert", async function () {
                  this[`create${key}PoolParams`].royaltyRecipientOverride =
                    randomAddress();

                  await expect(createPool.bind(this)()).not.to.be.reverted;
                });
              });

              context("Without royalty recipient override", function () {
                fn();
              });
            };
          }

          function shouldRevert() {
            it("Should revert", async function () {
              await expect(createPool.bind(this)()).to.be.revertedWith(
                "Nonzero royalty for non ERC2981 without override"
              );
            });
          }
        });
      });

      it("Should emit NewPool event", async function () {
        const { pool, tokenId } = await callStaticCreatePool.bind(this)();
        await expect(createPool.bind(this)())
          .to.emit(collectionPoolFactory, "NewPool")
          .withArgs(pool, tokenId);
      });

      it("Should transfer NFTs to pool", async function () {
        const tokenIds = await mintAndApproveRandomNfts(
          test721,
          user,
          collectionPoolFactory.address,
          NUM_INITIAL_NFTS
        );
        await expectAddressToOwnNFTs(user.address, test721, tokenIds);
        this[`create${key}PoolParams`].initialNFTIDs = tokenIds;

        const tx = await createPool.bind(this)();
        const { newPoolAddress } = await getPoolAddress(tx);
        await expectAddressToOwnNFTs(newPoolAddress, test721, tokenIds);
      });

      async function createPool(): Promise<ContractTransaction> {
        if (filtered) {
          return collectionPoolFactory[`createPool${key}Filtered`](
            this[`create${key}PoolParams`],
            this.filterParams
          );
        }

        return collectionPoolFactory[`createPool${key}`](
          this[`create${key}PoolParams`]
        );
      }

      async function callStaticCreatePool(): Promise<{
        pool: string;
        tokenId: BigNumber;
      }> {
        if (filtered) {
          return collectionPoolFactory.callStatic[`createPool${key}Filtered`](
            this[`create${key}PoolParams`],
            this.filterParams
          );
        }

        return collectionPoolFactory.callStatic[`createPool${key}`](
          this[`create${key}PoolParams`]
        );
      }
    }

    function testFilter(key: "ETH" | "ERC20") {
      beforeEach("Reset filterParams", function () {
        this.filterParams = {
          merkleRoot: ethers.constants.HashZero,
          encodedTokenIDs: ethers.constants.HashZero,
          initialProof: [],
          initialProofFlags: [],
        };
      });

      context("With filter", function () {
        beforeEach("Set filter", function () {
          this.tokenIds = randomBigNumbers(NUM_INITIAL_NFTS);
          this.tokenIDs = new TokenIDs(this.tokenIds.map(toBigInt));
          this.filterParams.merkleRoot = this.tokenIDs.root();
          this.filterParams.encodedTokenIDs = this.tokenIDs.encode();
        });

        context("With initial nft ids as proof", function () {
          context("With empty", function () {
            it("Should not revert", async function () {
              const { proof: initialProof, proofFlags: initialProofFlags } =
                this.tokenIDs.proof([]);

              await expect(
                collectionPoolFactory[`createPool${key}Filtered`](
                  this[`create${key}PoolParams`],
                  {
                    ...this.filterParams,
                    initialProof,
                    initialProofFlags,
                  }
                )
              ).not.to.be.reverted;
            });
          });

          context("With a non-empty subset", function () {
            it("Should not revert", async function () {
              const tokenIds = pickRandomElements<BigNumber>(
                this.tokenIds,
                this.tokenIds.length / 2
              );
              await mintAndApproveNfts(
                test721,
                user,
                collectionPoolFactory.address,
                tokenIds
              );

              const biTokenIds = tokenIds.map(toBigInt);
              const { proof: initialProof, proofFlags: initialProofFlags } =
                this.tokenIDs.proof(biTokenIds);

              await expect(
                collectionPoolFactory[`createPool${key}Filtered`](
                  {
                    ...this[`create${key}PoolParams`],
                    initialNFTIDs: this.tokenIDs.sort(biTokenIds),
                  },
                  {
                    ...this.filterParams,
                    initialProof,
                    initialProofFlags,
                  }
                )
              ).not.to.be.reverted;
            });
          });

          context("With the full set", function () {
            it("Should not revert", async function () {
              await mintAndApproveNfts(
                test721,
                user,
                collectionPoolFactory.address,
                this.tokenIds
              );

              const biTokenIds = this.tokenIds.map(toBigInt);
              const { proof: initialProof, proofFlags: initialProofFlags } =
                this.tokenIDs.proof(biTokenIds);

              await expect(
                collectionPoolFactory[`createPool${key}Filtered`](
                  {
                    ...this[`create${key}PoolParams`],
                    initialNFTIDs: this.tokenIDs.sort(biTokenIds),
                  },
                  {
                    ...this.filterParams,
                    initialProof,
                    initialProofFlags,
                  }
                )
              ).not.to.be.reverted;
            });
          });

          context("With a superset", function () {
            it("Should not be able to get proof", async function () {
              const tokenIds = [
                ...randomBigNumbers(NUM_INITIAL_NFTS),
                ...this.tokenIds,
              ] as BigNumber[];
              await mintAndApproveNfts(
                test721,
                user,
                collectionPoolFactory.address,
                tokenIds
              );

              const biTokenIds = tokenIds.map(toBigInt);
              expect(() => this.tokenIDs.proof(biTokenIds)).to.throw(
                "Leaf is not in tree"
              );
            });
          });

          context("With union of non-empty subsets", function () {
            it("Should not be able to get proof", async function () {
              const randomTokenIds = randomBigNumbers(NUM_INITIAL_NFTS);
              const tokenIds = [
                ...pickRandomElements(
                  randomTokenIds,
                  randomTokenIds.length / 2
                ),
                ...pickRandomElements(this.tokenIds, this.tokenIds.length / 2),
              ] as BigNumber[];
              await mintAndApproveNfts(
                test721,
                user,
                collectionPoolFactory.address,
                tokenIds
              );

              const biTokenIds = tokenIds.map(toBigInt);
              expect(() => this.tokenIDs.proof(biTokenIds)).to.throw(
                "Leaf is not in tree"
              );
            });
          });

          context("With non-empty subset of complement", function () {
            it("Should not be able to get proof", async function () {
              const tokenIds = await mintAndApproveRandomNfts(
                test721,
                user,
                collectionPoolFactory.address,
                NUM_INITIAL_NFTS
              );

              const biTokenIds = tokenIds.map(toBigInt);
              expect(() => this.tokenIDs.proof(biTokenIds)).to.throw(
                "Leaf is not in tree"
              );
            });
          });
        });
      });
    }
  });
});

async function collectionPoolFactoryFixture() {
  return {
    ...(await collectionFixture()),
    ...(await nftFixture()),
    test20: await test20Fixture(),
  };
}
