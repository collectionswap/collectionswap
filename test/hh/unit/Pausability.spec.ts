import { expect } from "chai";
import { TokenIDs } from "fummpel";
import { ethers } from "hardhat";

import { PoolType } from "../shared/constants";
import {
  getCurveParameters,
  deployPoolContracts,
  nftFixture,
  test20Fixture,
} from "../shared/fixtures";
import {
  getPoolAddress,
  getRandomInt,
  mintAndApproveRandomNfts,
  mintRandomNfts,
  pickRandomElements,
  toBigInt,
} from "../shared/helpers";
import { getSigners } from "../shared/signers";

import type {
  CollectionPool,
  CollectionPoolEnumerableETH,
  CollectionPoolFactory,
  ICurve,
  IERC721Mintable,
  Test20,
} from "../../../typechain-types";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, ContractTransaction } from "ethers";

describe("Pausability", function () {
  let factory: CollectionPoolFactory;
  let curve: ICurve;
  let collectionDeployer: SignerWithAddress;
  let nft: IERC721Mintable;
  let test20: Test20;

  async function getPoolCreationTx(
    factory: CollectionPoolFactory,
    curve: ICurve,
    poolCreator: SignerWithAddress,
    nft: IERC721Mintable,
    isFiltered: boolean,
    isERC20?: boolean
  ): Promise<ContractTransaction> {
    const { delta, spotPrice, props, state, royaltyNumerator, protocolFee } =
      getCurveParameters();
    const initialTokenBalance = ethers.utils.parseEther("10");
    await test20.mint(poolCreator.address, initialTokenBalance);
    await test20
      .connect(poolCreator)
      .approve(factory.address, initialTokenBalance);
    const nftTokenIds = await mintAndApproveRandomNfts(
      nft,
      poolCreator,
      factory.address,
      getRandomInt(1, 10)
    );
    const poolType = PoolType.TRADE;

    const functionName = `createPool${isERC20 ? "ERC20" : "ETH"}${
      isFiltered ? "Filtered" : ""
    }`;

    const createPoolParams = {
      nft: nft.address,
      bondingCurve: curve.address,
      assetRecipient: ethers.constants.AddressZero,
      receiver: poolCreator.address,
      poolType,
      delta,
      fee: protocolFee,
      spotPrice,
      props,
      state,
      royaltyNumerator,
      royaltyRecipientFallback: ethers.constants.AddressZero,
      initialNFTIDs: nftTokenIds,
      ...(isERC20
        ? {
            token: test20.address,
            initialTokenBalance,
          }
        : undefined),
    };

    const params: any[] = [createPoolParams];
    if (isFiltered) {
      const filter = new TokenIDs(nftTokenIds.map(toBigInt));
      const {
        proof: initialProof,
        proofFlags: initialProofFlags,
        leaves,
      } = filter.proof(nftTokenIds.map(toBigInt));
      createPoolParams.initialNFTIDs = leaves.map(BigNumber.from);
      params.push({
        merkleRoot: filter.root(),
        encodedTokenIDs: filter.encode(),
        initialProof,
        initialProofFlags,
      });
    }

    // @ts-ignore
    return factory.connect(poolCreator).functions[functionName](...params);
  }

  before("Get NFT and ERC20", async function () {
    ({ nft } = await nftFixture());
    test20 = await test20Fixture();
  });

  before("Get factory", async function () {
    ({ curve, factory, collectionDeployer } = await deployPoolContracts());
  });

  describe("Checking that contract pause variables are updated correctly", function () {
    describe("Checking factory pause variables", function () {
      const pausableFunctionGroup = ["creation", "swap"];
      const pauseVariables = {
        creation: false,
        swap: false,
      };

      async function checkVariables(factory: CollectionPoolFactory) {
        expect(await factory.creationPaused()).to.equal(
          pauseVariables.creation
        );
        expect(await factory.swapPaused()).to.equal(pauseVariables.swap);
      }

      it(`Should only flip the desired pause variable when calling the relevant function. Randomized testing for view function and event emission`, async function () {
        console.log("        Should initialize with all variables unpaused");
        await checkVariables(factory);
        for (let i = 0; i < 30; i++) {
          const variableToFlip = pickRandomElements(
            pausableFunctionGroup,
            1
          )[0];
          const currentlyPaused = // @ts-ignore
            (await factory.functions[`${variableToFlip}Paused`]())[0];

          // pause/unpause the function group. Capitalize the function group's first char
          const capitalizedFunctionGroup = `${variableToFlip
            .charAt(0)
            .toUpperCase()}${variableToFlip.slice(1, undefined)}`;
          const flipFunction = `${
            currentlyPaused ? "un" : ""
          }pause${capitalizedFunctionGroup}`;

          console.log(
            `        Testing ${flipFunction} when initial state was ${JSON.stringify(
              pauseVariables
            )}.`
          );
          // @ts-ignore
          pauseVariables[variableToFlip] = !pauseVariables[variableToFlip];
          // @ts-ignore
          const tx = await factory.connect(collectionDeployer)[flipFunction]();
          const expectedEventName = `${capitalizedFunctionGroup}${
            // @ts-ignore
            pauseVariables[variableToFlip] ? "P" : "Unp"
          }aused`;
          await expect(tx).to.emit(factory, expectedEventName);
          await checkVariables(factory);
        }
      });
    });

    describe("Checking pool pause variable", function () {
      let pool1: CollectionPool;
      let pool2: CollectionPool;

      beforeEach(async function () {
        await Promise.all([
          factory.unpauseSwap(),
          pool1.unpausePoolSwaps(),
          pool2.unpausePoolSwaps(),
        ]);
      });

      before(async function () {
        await Promise.all([factory.unpauseCreation(), factory.unpauseSwap()]);

        const tx1 = await getPoolCreationTx(
          factory,
          curve as ICurve,
          collectionDeployer,
          nft,
          false,
          true
        );

        const { newPoolAddress: newPoolAddress1 } = await getPoolAddress(tx1);
        pool1 = (await ethers.getContractAt(
          `CollectionPoolEnumerableETH`,
          newPoolAddress1,
          collectionDeployer
        )) as CollectionPoolEnumerableETH;

        const tx2 = await getPoolCreationTx(
          factory,
          curve as ICurve,
          collectionDeployer,
          nft,
          false,
          true
        );

        const { newPoolAddress: newPoolAddress2 } = await getPoolAddress(tx2);
        pool2 = (await ethers.getContractAt(
          `CollectionPoolEnumerableETH`,
          newPoolAddress2,
          collectionDeployer
        )) as CollectionPoolEnumerableETH;
      });

      for (const factoryPaused of [true, false]) {
        for (const poolPaused of [true, false]) {
          const poolSwapPaused = factoryPaused || poolPaused;
          it(`Should show poolSwapPaused == ${poolSwapPaused} when factory swaps are ${
            factoryPaused ? "paused" : "unpaused"
          } and pool is ${
            poolPaused ? "paused" : "unpaused"
          }`, async function () {
            if (factoryPaused) await factory.pauseSwap();
            if (poolPaused) await pool1.pausePoolSwaps();
            expect(await pool1.poolSwapsPaused()).to.equal(poolSwapPaused);
          });
        }
      }

      it(`Should allow pool level swap pauses without affecting other pools`, async function () {
        await pool1.pausePoolSwaps();
        const tokenIds = await mintRandomNfts(
          nft,
          collectionDeployer.address,
          1
        );
        await nft
          .connect(collectionDeployer)
          .setApprovalForAll(pool2.address, true);

        const quote = (await pool2.getSellNFTQuote(1))[3];
        // Check functionality is consistent with state
        await expect(
          pool2
            .connect(collectionDeployer)
            .swapNFTsForToken(
              { ids: tokenIds, proof: [], proofFlags: [] },
              quote,
              collectionDeployer.address,
              false,
              ethers.constants.AddressZero
            )
        ).to.emit(pool2, "SwapNFTInPool");
      });
    });
  });

  describe("Checking that contract pause variables imply the relevant functions are blocked", function () {
    beforeEach(async function () {
      await Promise.all([
        factory.connect(collectionDeployer).unpauseCreation(),
        factory.connect(collectionDeployer).unpauseSwap(),
      ]);
    });

    describe("Testing creation pause", function () {
      for (const isERC20 of [true, false]) {
        for (const isFiltered of [true, false]) {
          const poolType = `${isERC20 ? "ERC20" : "ETH"}${
            isFiltered ? "Filtered" : ""
          }`;
          describe(`Testing ${poolType}`, function () {
            it(`Should allow creation of pools when unpaused`, async function () {
              const tx = await getPoolCreationTx(
                factory,
                curve as ICurve,
                collectionDeployer,
                nft,
                isFiltered,
                isERC20
              );

              // Check functionality is consistent with state
              await expect(tx).to.emit(factory, "NewPool");
            });

            it(`Should block creation of pools when paused`, async function () {
              await factory.connect(collectionDeployer).pauseCreation();

              await expect(
                getPoolCreationTx(
                  factory,
                  curve as ICurve,
                  collectionDeployer,
                  nft,
                  isFiltered,
                  isERC20
                )
              ).to.be.revertedWith("Pool creation is paused");
            });
          });
        }
      }
    });

    describe("Testing factory swap pause", function () {
      it(`Should allow selling to pools when unpaused`, async function () {
        const tx = await getPoolCreationTx(
          factory,
          curve as ICurve,
          collectionDeployer,
          nft,
          false,
          true
        );

        const { newPoolAddress } = await getPoolAddress(tx);
        const pool = (await ethers.getContractAt(
          `CollectionPoolEnumerableETH`,
          newPoolAddress,
          collectionDeployer
        )) as CollectionPoolEnumerableETH;
        const tokenIds = await mintRandomNfts(
          nft,
          collectionDeployer.address,
          1
        );
        await nft
          .connect(collectionDeployer)
          .setApprovalForAll(newPoolAddress, true);

        const quote = (await pool.getSellNFTQuote(1))[3];
        // Check functionality is consistent with state
        await expect(
          pool
            .connect(collectionDeployer)
            .swapNFTsForToken(
              { ids: tokenIds, proof: [], proofFlags: [] },
              quote,
              collectionDeployer.address,
              false,
              ethers.constants.AddressZero
            )
        ).to.emit(pool, "SwapNFTInPool");
      });

      it(`Should not allow selling to pools when paused`, async function () {
        const tx = await getPoolCreationTx(
          factory,
          curve as ICurve,
          collectionDeployer,
          nft,
          false,
          true
        );
        await factory.pauseSwap();

        const { newPoolAddress } = await getPoolAddress(tx);
        const pool = (await ethers.getContractAt(
          `CollectionPoolEnumerableETH`,
          newPoolAddress,
          collectionDeployer
        )) as CollectionPoolEnumerableETH;
        const tokenIds = await mintRandomNfts(
          nft,
          collectionDeployer.address,
          1
        );
        await nft
          .connect(collectionDeployer)
          .setApprovalForAll(newPoolAddress, true);

        const quote = (await pool.getSellNFTQuote(1))[3];
        // Check functionality is consistent with state
        await expect(
          pool
            .connect(collectionDeployer)
            .swapNFTsForToken(
              { ids: tokenIds, proof: [], proofFlags: [] },
              quote,
              collectionDeployer.address,
              false,
              ethers.constants.AddressZero
            )
        ).to.be.revertedWith("Swaps are paused");
      });

      it(`Should allow buying random from pools when unpaused`, async function () {
        const tx = await getPoolCreationTx(
          factory,
          curve as ICurve,
          collectionDeployer,
          nft,
          false,
          true
        );

        const { newPoolAddress } = await getPoolAddress(tx);
        const pool = (await ethers.getContractAt(
          `CollectionPoolEnumerableETH`,
          newPoolAddress,
          collectionDeployer
        )) as CollectionPoolEnumerableETH;

        const quote = (await pool.getBuyNFTQuote(1))[3];
        await test20.mint(collectionDeployer.address, quote);
        await test20.connect(collectionDeployer).approve(pool.address, quote);
        // Check functionality is consistent with state
        await expect(
          pool
            .connect(collectionDeployer)
            .swapTokenForAnyNFTs(
              1,
              quote,
              collectionDeployer.address,
              false,
              ethers.constants.AddressZero
            )
        ).to.emit(pool, "SwapNFTOutPool");
      });

      it(`Should not allow buying random from pools when paused`, async function () {
        const tx = await getPoolCreationTx(
          factory,
          curve as ICurve,
          collectionDeployer,
          nft,
          false,
          true
        );

        await factory.pauseSwap();

        const { newPoolAddress } = await getPoolAddress(tx);
        const pool = (await ethers.getContractAt(
          `CollectionPoolEnumerableETH`,
          newPoolAddress,
          collectionDeployer
        )) as CollectionPoolEnumerableETH;

        const quote = (await pool.getBuyNFTQuote(1))[3];
        await test20.mint(collectionDeployer.address, quote);
        await test20.connect(collectionDeployer).approve(pool.address, quote);
        // Check functionality is consistent with state
        await expect(
          pool
            .connect(collectionDeployer)
            .swapTokenForAnyNFTs(
              1,
              quote,
              collectionDeployer.address,
              false,
              ethers.constants.AddressZero
            )
        ).to.be.rejectedWith("Swaps are paused");
      });

      it(`Should allow buying specific from pools when unpaused`, async function () {
        const tx = await getPoolCreationTx(
          factory,
          curve as ICurve,
          collectionDeployer,
          nft,
          false,
          true
        );

        const { newPoolAddress } = await getPoolAddress(tx);
        const pool = (await ethers.getContractAt(
          `CollectionPoolEnumerableETH`,
          newPoolAddress,
          collectionDeployer
        )) as CollectionPoolEnumerableETH;

        const quote = (await pool.getBuyNFTQuote(1))[3];
        await test20.mint(collectionDeployer.address, quote);
        await test20.connect(collectionDeployer).approve(pool.address, quote);
        // Check functionality is consistent with state
        await expect(
          pool
            .connect(collectionDeployer)
            .swapTokenForSpecificNFTs(
              [(await pool.getAllHeldIds())[0]],
              quote,
              collectionDeployer.address,
              false,
              ethers.constants.AddressZero
            )
        ).to.emit(pool, "SwapNFTOutPool");
      });

      it(`Should not allow buying specific from pools when paused`, async function () {
        const tx = await getPoolCreationTx(
          factory,
          curve as ICurve,
          collectionDeployer,
          nft,
          false,
          true
        );

        await factory.pauseSwap();

        const { newPoolAddress } = await getPoolAddress(tx);
        const pool = (await ethers.getContractAt(
          `CollectionPoolEnumerableETH`,
          newPoolAddress,
          collectionDeployer
        )) as CollectionPoolEnumerableETH;

        const quote = (await pool.getBuyNFTQuote(1))[3];
        await test20.mint(collectionDeployer.address, quote);
        await test20.connect(collectionDeployer).approve(pool.address, quote);
        // Check functionality is consistent with state
        await expect(
          pool
            .connect(collectionDeployer)
            .swapTokenForSpecificNFTs(
              [(await pool.getAllHeldIds())[0]],
              quote,
              collectionDeployer.address,
              false,
              ethers.constants.AddressZero
            )
        ).to.be.rejectedWith("Swaps are paused");
      });
    });

    describe("Testing pool swap pause", function () {
      it(`Should allow selling to pools when unpaused`, async function () {
        const tx = await getPoolCreationTx(
          factory,
          curve as ICurve,
          collectionDeployer,
          nft,
          false,
          true
        );

        const { newPoolAddress } = await getPoolAddress(tx);
        const pool = (await ethers.getContractAt(
          `CollectionPoolEnumerableETH`,
          newPoolAddress,
          collectionDeployer
        )) as CollectionPoolEnumerableETH;
        const tokenIds = await mintRandomNfts(
          nft,
          collectionDeployer.address,
          1
        );
        await nft
          .connect(collectionDeployer)
          .setApprovalForAll(newPoolAddress, true);

        const quote = (await pool.getSellNFTQuote(1))[3];
        // Check functionality is consistent with state
        await expect(
          pool
            .connect(collectionDeployer)
            .swapNFTsForToken(
              { ids: tokenIds, proof: [], proofFlags: [] },
              quote,
              collectionDeployer.address,
              false,
              ethers.constants.AddressZero
            )
        ).to.emit(pool, "SwapNFTInPool");
      });

      it(`Should not allow selling to pools when paused`, async function () {
        const tx = await getPoolCreationTx(
          factory,
          curve as ICurve,
          collectionDeployer,
          nft,
          false,
          true
        );

        const { newPoolAddress } = await getPoolAddress(tx);
        const pool = (await ethers.getContractAt(
          `CollectionPoolEnumerableETH`,
          newPoolAddress,
          collectionDeployer
        )) as CollectionPoolEnumerableETH;
        await pool.pausePoolSwaps();
        const tokenIds = await mintRandomNfts(
          nft,
          collectionDeployer.address,
          1
        );
        await nft
          .connect(collectionDeployer)
          .setApprovalForAll(newPoolAddress, true);

        const quote = (await pool.getSellNFTQuote(1))[3];
        // Check functionality is consistent with state
        await expect(
          pool
            .connect(collectionDeployer)
            .swapNFTsForToken(
              { ids: tokenIds, proof: [], proofFlags: [] },
              quote,
              collectionDeployer.address,
              false,
              ethers.constants.AddressZero
            )
        ).to.be.revertedWith("Swaps are paused");
      });

      it(`Should allow buying random from pools when unpaused`, async function () {
        const tx = await getPoolCreationTx(
          factory,
          curve as ICurve,
          collectionDeployer,
          nft,
          false,
          true
        );

        const { newPoolAddress } = await getPoolAddress(tx);
        const pool = (await ethers.getContractAt(
          `CollectionPoolEnumerableETH`,
          newPoolAddress,
          collectionDeployer
        )) as CollectionPoolEnumerableETH;

        const quote = (await pool.getBuyNFTQuote(1))[3];
        await test20.mint(collectionDeployer.address, quote);
        await test20.connect(collectionDeployer).approve(pool.address, quote);
        // Check functionality is consistent with state
        await expect(
          pool
            .connect(collectionDeployer)
            .swapTokenForAnyNFTs(
              1,
              quote,
              collectionDeployer.address,
              false,
              ethers.constants.AddressZero
            )
        ).to.emit(pool, "SwapNFTOutPool");
      });

      it(`Should not allow buying random from pools when paused`, async function () {
        const tx = await getPoolCreationTx(
          factory,
          curve as ICurve,
          collectionDeployer,
          nft,
          false,
          true
        );

        const { newPoolAddress } = await getPoolAddress(tx);
        const pool = (await ethers.getContractAt(
          `CollectionPoolEnumerableETH`,
          newPoolAddress,
          collectionDeployer
        )) as CollectionPoolEnumerableETH;
        await pool.pausePoolSwaps();

        const quote = (await pool.getBuyNFTQuote(1))[3];
        await test20.mint(collectionDeployer.address, quote);
        await test20.connect(collectionDeployer).approve(pool.address, quote);
        // Check functionality is consistent with state
        await expect(
          pool
            .connect(collectionDeployer)
            .swapTokenForAnyNFTs(
              1,
              quote,
              collectionDeployer.address,
              false,
              ethers.constants.AddressZero
            )
        ).to.be.rejectedWith("Swaps are paused");
      });

      it(`Should allow buying specific from pools when unpaused`, async function () {
        const tx = await getPoolCreationTx(
          factory,
          curve as ICurve,
          collectionDeployer,
          nft,
          false,
          true
        );

        const { newPoolAddress } = await getPoolAddress(tx);
        const pool = (await ethers.getContractAt(
          `CollectionPoolEnumerableETH`,
          newPoolAddress,
          collectionDeployer
        )) as CollectionPoolEnumerableETH;

        const quote = (await pool.getBuyNFTQuote(1))[3];
        await test20.mint(collectionDeployer.address, quote);
        await test20.connect(collectionDeployer).approve(pool.address, quote);
        // Check functionality is consistent with state
        await expect(
          pool
            .connect(collectionDeployer)
            .swapTokenForSpecificNFTs(
              [(await pool.getAllHeldIds())[0]],
              quote,
              collectionDeployer.address,
              false,
              ethers.constants.AddressZero
            )
        ).to.emit(pool, "SwapNFTOutPool");
      });

      it(`Should not allow buying specific from pools when paused`, async function () {
        const tx = await getPoolCreationTx(
          factory,
          curve as ICurve,
          collectionDeployer,
          nft,
          false,
          true
        );

        const { newPoolAddress } = await getPoolAddress(tx);
        const pool = (await ethers.getContractAt(
          `CollectionPoolEnumerableETH`,
          newPoolAddress,
          collectionDeployer
        )) as CollectionPoolEnumerableETH;
        await pool.pausePoolSwaps();

        const quote = (await pool.getBuyNFTQuote(1))[3];
        await test20.mint(collectionDeployer.address, quote);
        await test20.connect(collectionDeployer).approve(pool.address, quote);
        // Check functionality is consistent with state
        await expect(
          pool
            .connect(collectionDeployer)
            .swapTokenForSpecificNFTs(
              [(await pool.getAllHeldIds())[0]],
              quote,
              collectionDeployer.address,
              false,
              ethers.constants.AddressZero
            )
        ).to.be.rejectedWith("Swaps are paused");
      });
    });
  });

  describe("Checking permissions for changing pause variables", function () {
    let pool: CollectionPool;
    let user: SignerWithAddress;
    beforeEach(async function () {
      await Promise.all([factory.unpauseCreation(), factory.unpauseSwap()]);
      ({ user } = await getSigners());
      const tx = await getPoolCreationTx(
        factory,
        curve as ICurve,
        user,
        nft,
        false,
        true
      );

      const { newPoolAddress } = await getPoolAddress(tx);
      pool = (await ethers.getContractAt(
        `CollectionPoolEnumerableETH`,
        newPoolAddress,
        collectionDeployer
      )) as CollectionPool;
    });

    for (const pauseFunction of ["pauseSwap", "pauseCreation"]) {
      it(`Should revert if ${pauseFunction} is called by non deployer`, async function () {
        // @ts-ignore
        await expect(factory.connect(user)[pauseFunction]()).to.be.revertedWith(
          "Ownable: caller is not the owner"
        );
      });

      const unpauseFunction = `un${pauseFunction}`;
      it(`Should revert if ${unpauseFunction} is called by non deployer`, async function () {
        // @ts-ignore
        await factory[pauseFunction]();
        await expect(
          // @ts-ignore
          factory.connect(user)[unpauseFunction]()
        ).to.be.revertedWith("Ownable: caller is not the owner");
      });
    }

    it("Should revert if anyone but pool owner calls pool level pause", async function () {
      await expect(
        pool.connect(collectionDeployer).pausePoolSwaps()
      ).to.be.revertedWith("not authorized");
    });

    it("Should revert if anyone but pool owner calls pool level unpause", async function () {
      await pool.connect(user).pausePoolSwaps();
      await expect(
        pool.connect(collectionDeployer).unpausePoolSwaps()
      ).to.be.revertedWith("not authorized");
    });
  });
});
