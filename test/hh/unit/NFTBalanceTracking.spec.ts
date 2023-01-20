import { expect } from "chai";
import { TokenIDs } from "fummpel";
import { ethers } from "hardhat";

import {
  factoryFixture,
  filteredTradingFixture,
  genericTradingFixture,
  getCurveParameters,
  makeRewardVaultFixture,
  test721EnumerableFixture,
  TRADING_QUANTITY,
} from "../shared/fixtures";
import {
  difference,
  gasUsed,
  getPoolAddress,
  mintRandomNfts,
  pickRandomElements,
  toBigInt,
} from "../shared/helpers";
import { getSigners } from "../shared/signers";

import type { NFTFixture } from "../shared/fixtures";
import type { BigNumberish, ContractTransaction } from "ethers";

const gas: { [key: string]: any | any[] } = {};

const LOG_GAS = false;

function logGasUsages() {
  if (LOG_GAS) {
    console.log(JSON.stringify(gas));
  }
}

async function recordGas(
  tx: ContractTransaction,
  functionName: string,
  quantity?: number
) {
  const val = (await gasUsed(tx)).toNumber();

  if (quantity === undefined) {
    // Then we're recording a gas usage which is invariant with quantity. Store
    // as a primative.
    gas[functionName] = val;
    return;
  }

  const arr: any[] = gas[functionName] ?? [];

  arr[quantity] = val;
  gas[functionName] = arr;
}

balanceTrackingSuite(test721EnumerableFixture);

function testPoolCreation(
  isFiltered: boolean,
  numInitialIds: number,
  nftFixture: NFTFixture
) {
  it(`Should increase upon pool creation with ${numInitialIds} initial tokenIds for ${
    isFiltered ? "" : "non-"
  }filtered pools`, async function () {
    const { delta, fee, spotPrice, props, state, royaltyNumerator } =
      getCurveParameters();

    const { factory, curve } = await factoryFixture();
    const { nft } = await nftFixture();
    const { owner } = await getSigners();
    const tokenIds = await mintRandomNfts(
      nft as any,
      owner.address,
      TRADING_QUANTITY
    );
    const initialIds = pickRandomElements(tokenIds, numInitialIds);
    await nft.connect(owner).setApprovalForAll(factory.address, true);

    const poolCreatingFunctionName = isFiltered
      ? "createPoolETHFiltered"
      : "createPoolETH";

    const poolParams = {
      nft: nft.address,
      bondingCurve: curve.address,
      assetRecipient: ethers.constants.AddressZero,
      receiver: owner.address,
      poolType: 2,
      delta,
      fee,
      spotPrice,
      props,
      state,
      royaltyNumerator,
      royaltyRecipientFallback: owner.address,
      initialNFTIDs: initialIds as BigNumberish[],
    };

    const args: any[] = [poolParams];

    if (isFiltered) {
      const tokenIdFilter = new TokenIDs(tokenIds.map(toBigInt));
      const merkleRoot = tokenIdFilter.root();
      const encodedTokenIDs = tokenIdFilter.encode();
      const {
        proof: initialProof,
        proofFlags: initialProofFlags,
        leaves,
      } = tokenIdFilter.proof(initialIds.map(toBigInt));

      // Don't forget to sort the initial token IDs if it's a filtered pool
      poolParams.initialNFTIDs = leaves;

      args.push({
        merkleRoot,
        encodedTokenIDs,
        initialProof,
        initialProofFlags,
      });
    }

    const tx = await factory
      .connect(owner)
      // @ts-ignore
      [poolCreatingFunctionName](...args);
    // const tx = await factory.connect(owner).createPoolETH(poolParams);

    await expect(tx).to.emit(factory, "NewPool");
    const { newPoolAddress } = await getPoolAddress(tx);
    const collectionPoolETH = await ethers.getContractAt(
      "CollectionPoolETH",
      newPoolAddress
    );
    expect((await collectionPoolETH.getAllHeldIds()).slice().sort()).deep.equal(
      initialIds.slice().sort()
    );
    await recordGas(tx, poolCreatingFunctionName, numInitialIds);
  });
}

function testDepositNFTs(
  isFiltered: boolean,
  numDeposited: number,
  nftFixture: NFTFixture
) {
  it(`Should increase upon deposits of ${numDeposited} tokenIds from owner for ${
    isFiltered ? "" : "non-"
  }filtered pools`, async function () {
    const { pool, owner, ownerNfts, nft, factory, filter } = isFiltered
      ? await filteredTradingFixture(nftFixture)
      : await genericTradingFixture(nftFixture);

    const initialBalance = await pool.getAllHeldIds();
    await nft.connect(owner).setApprovalForAll(factory.address, true);
    const tokenIds = pickRandomElements(ownerNfts, numDeposited);
    const multiproof = filter?.proof(tokenIds.map(toBigInt));
    const tx = await factory
      .connect(owner)
      .depositNFTs(
        multiproof?.leaves ?? tokenIds,
        multiproof?.proof ?? [],
        multiproof?.proofFlags ?? [],
        pool.address,
        owner.address
      );
    await expect(tx).to.emit(pool, "NFTDeposit").withArgs(tokenIds.length);
    const finalBalance = await pool.getAllHeldIds();
    expect(finalBalance.slice().sort()).deep.equal(
      initialBalance.concat(tokenIds.map(ethers.BigNumber.from)).slice().sort()
    );
    await recordGas(
      tx,
      `depositNFTs(${isFiltered ? "Filtered" : "Nonfiltered"})`,
      numDeposited
    );
  });

  it(`Should increase upon deposits of ${numDeposited} tokenIds from non-owner for ${
    isFiltered ? "" : "non-"
  }filtered pools`, async function () {
    const { pool, nft, factory, trader, traderNfts, filter } = isFiltered
      ? await filteredTradingFixture(nftFixture)
      : await genericTradingFixture(nftFixture);

    const initialBalance = await pool.getAllHeldIds();
    const tokenIds = pickRandomElements(traderNfts, numDeposited);
    const multiproof = filter?.proof(tokenIds.map(toBigInt));
    await nft.connect(trader).setApprovalForAll(factory.address, true);
    await expect(
      await factory
        .connect(trader)
        .depositNFTs(
          multiproof?.leaves ?? tokenIds,
          multiproof?.proof ?? [],
          multiproof?.proofFlags ?? [],
          pool.address,
          trader.address
        )
    )
      .to.emit(pool, "NFTDeposit")
      .withArgs(tokenIds.length);
    const finalBalance = await pool.getAllHeldIds();
    expect(finalBalance.slice().sort()).deep.equal(
      initialBalance.concat(tokenIds.map(ethers.BigNumber.from)).slice().sort()
    );
  });
}

function testWithdrawERC721(
  isFiltered: boolean,
  numWithdrawn: number,
  invalidIds: number,
  withdrawBeforeTest: boolean,
  nftFixture: NFTFixture
) {
  it(`Should decrease but not underflow upon withdrawals of ${numWithdrawn} tokenIds from a ${
    isFiltered ? "" : "non-"
  }filtered pool with ${invalidIds} invalid ids withdrawn ${
    withdrawBeforeTest ? "before" : "afterwards"
  }`, async function () {
    const { pool, owner, nft, filter, ownerNfts } = isFiltered
      ? await filteredTradingFixture(nftFixture)
      : await genericTradingFixture(nftFixture);

    // Pick the tokenIds to sneak in with a low level transfer
    await nft.connect(owner).setApprovalForAll(pool.address, true);
    const idsToSneakIn = pickRandomElements(ownerNfts, invalidIds);

    // Sneak in the invalid tokenIds
    for (const id of idsToSneakIn) {
      await nft.connect(owner).transferFrom(owner.address, pool.address, id);
    }

    // Store the valid held ids in `poolIds`
    const poolIds = (await pool.getAllHeldIds()).map((bn) => bn.toString());

    const initialBalance = await pool.getAllHeldIds();
    // Pick the legit tokenIds to withdraw
    const tokenIds = pickRandomElements(poolIds, numWithdrawn);

    // Withdraw fakes and do test
    if (withdrawBeforeTest) {
      await pool.connect(owner).withdrawERC721(nft.address, idsToSneakIn);
    }

    const tx = await pool.connect(owner).withdrawERC721(nft.address, tokenIds);
    await expect(tx).to.emit(pool, "NFTWithdrawal").withArgs(tokenIds.length);
    if (!withdrawBeforeTest) {
      await pool.connect(owner).withdrawERC721(nft.address, idsToSneakIn);
    }

    const finalBalance = await pool.getAllHeldIds();
    const expectedFinalBalance = difference(
      initialBalance,
      tokenIds.map(ethers.BigNumber.from)
    );

    // Difference between initial and final should be the sum of valid and invalid
    // ids withdrawn
    expect(finalBalance.slice().sort()).deep.equal(
      expectedFinalBalance.slice().sort()
    );
    await recordGas(
      tx,
      `withdrawERC721(${isFiltered ? "Filtered" : "Nonfiltered"})`,
      numWithdrawn
    );
  });
}

function testSell(
  isFiltered: boolean,
  numSold: number,
  nftFixture: NFTFixture
) {
  it(`Should increase upon selling into pool of ${numSold + 1} tokenIds for ${
    isFiltered ? "" : "non-"
  }filtered pools`, async function () {
    const { pool, trader, traderNfts, filter } = isFiltered
      ? await filteredTradingFixture(nftFixture)
      : await genericTradingFixture(nftFixture);

    const initialBalance = await pool.getAllHeldIds();
    const tokenIds = pickRandomElements(traderNfts, numSold + 1);
    const multiproof = filter?.proof(tokenIds.map(toBigInt));
    const minExpectedTokenOutput = (await pool.getSellNFTQuote(numSold + 1))[3];
    const tx = await pool.connect(trader).swapNFTsForToken(
      {
        ids: multiproof?.leaves ?? tokenIds,
        proof: multiproof?.proof ?? [],
        proofFlags: multiproof?.proofFlags ?? [],
      },
      minExpectedTokenOutput,
      trader.address,
      false,
      ethers.constants.AddressZero
    );
    await expect(tx).to.emit(pool, "SwapNFTInPool");
    await recordGas(tx, "swapNFTsForToken", numSold);
    const finalBalance = await pool.getAllHeldIds();
    expect(finalBalance.slice().sort()).deep.equal(
      initialBalance.concat(tokenIds.map(ethers.BigNumber.from)).slice().sort()
    );
  });
}

function testBuySpecific(
  isFiltered: boolean,
  numBought: number,
  invalidIds: number,
  withdrawBeforeTest: boolean,
  nftFixture: NFTFixture
) {
  it(`Should decrease but not underflow upon buying ${numBought} specific tokenIds from a ${
    isFiltered ? "" : "non-"
  }filtered pool with ${invalidIds} invalid ids withdrawn ${
    withdrawBeforeTest ? "before" : "afterwards"
  }`, async function () {
    const { pool, trader, filter, ownerNfts, nft, owner } = isFiltered
      ? await filteredTradingFixture(nftFixture)
      : await genericTradingFixture(nftFixture);
    // Pick the tokenIds to sneak in with a low level transfer
    await nft.connect(owner).setApprovalForAll(pool.address, true);
    const idsToSneakIn = pickRandomElements(ownerNfts, invalidIds);

    for (const id of idsToSneakIn) {
      await nft.connect(owner).transferFrom(owner.address, pool.address, id);
    }

    const poolIds = await pool.getAllHeldIds();

    // Pick the legit tokenIds to withdraw
    const tokenIds = pickRandomElements(poolIds, numBought);
    const maxExpectedTokenInput = (await pool.getBuyNFTQuote(numBought))[3];

    // Withdraw fakes and do test
    if (withdrawBeforeTest) {
      await pool.connect(owner).withdrawERC721(nft.address, idsToSneakIn);
    }

    const tx = await pool
      .connect(trader)
      .swapTokenForSpecificNFTs(
        tokenIds,
        maxExpectedTokenInput,
        trader.address,
        false,
        ethers.constants.AddressZero,
        { value: maxExpectedTokenInput }
      );
    if (!withdrawBeforeTest) {
      await pool.connect(owner).withdrawERC721(nft.address, idsToSneakIn);
    }

    const expectedValidTokenIdsInPool = difference(
      poolIds,
      tokenIds.map(ethers.BigNumber.from)
    );
    const finalValidTokenIdsInPool = await pool.getAllHeldIds();
    await expect(tx).to.emit(pool, "SwapNFTOutPool");
    await recordGas(tx, "swapTokenForSpecificNFTs", numBought);
    // Difference between initial and final should be the sum of valid and invalid
    // ids withdrawn
    expect(finalValidTokenIdsInPool.slice().sort()).deep.equal(
      expectedValidTokenIdsInPool.slice().sort()
    );
    logGasUsages();
  });
}

function testBuyAny(
  isFiltered: boolean,
  numBought: number,
  invalidIds: number,
  withdrawBeforeTest: boolean,
  nftFixture: NFTFixture
) {
  it(`Should decrease but not underflow upon buying ${numBought} random tokenIds from a ${
    isFiltered ? "" : "non-"
  }filtered pool with ${invalidIds} invalid ids withdrawn ${
    withdrawBeforeTest ? "before" : "afterwards"
  }`, async function () {
    const { pool, trader, ownerNfts, nft, owner } = isFiltered
      ? await filteredTradingFixture(nftFixture)
      : await genericTradingFixture(nftFixture);
    // Pick the tokenIds to sneak in with a low level transfer
    await nft.connect(owner).setApprovalForAll(pool.address, true);
    const idsToSneakIn = pickRandomElements(ownerNfts, invalidIds);

    for (const id of idsToSneakIn) {
      await nft.connect(owner).transferFrom(owner.address, pool.address, id);
    }

    const poolIds = await pool.getAllHeldIds();
    const maxExpectedTokenInput = (await pool.getBuyNFTQuote(numBought))[3];

    // Withdraw fakes and do test
    if (withdrawBeforeTest) {
      await pool.connect(owner).withdrawERC721(nft.address, idsToSneakIn);
    }

    const tx = await pool
      .connect(trader)
      .swapTokenForAnyNFTs(
        numBought,
        maxExpectedTokenInput,
        trader.address,
        false,
        ethers.constants.AddressZero,
        { value: maxExpectedTokenInput }
      );
    if (!withdrawBeforeTest) {
      await pool.connect(owner).withdrawERC721(nft.address, idsToSneakIn);
    }

    const receipt = await tx.wait();
    const idsTransferred = receipt.logs
      .map((log) => {
        try {
          return nft.interface.parseLog(log);
        } catch (err) {
          return null;
        }
      })
      .filter((log) => log?.name === "Transfer")
      .map((log) => log?.args[2]);

    const expectedValidTokenIdsInPool = difference(poolIds, idsTransferred);
    const finalValidTokenIdsInPool = await pool.getAllHeldIds();
    await expect(tx).to.emit(pool, "SwapNFTOutPool");
    await recordGas(tx, "swapTokenForSpecificNFTs", numBought);
    // Difference between initial and final should be the sum of valid and invalid
    // ids withdrawn
    expect(finalValidTokenIdsInPool.slice().sort()).deep.equal(
      expectedValidTokenIdsInPool.slice().sort()
    );
    logGasUsages();
  });
}

function balanceTrackingSuite(nftFixture: NFTFixture) {
  describe(`Test bookkeeping of the valid NFT balances of pools`, function () {
    for (const isFiltered of [false, true]) {
      describe(`Testing ${
        isFiltered ? "" : "non-"
      }filtered pools`, function () {
        for (let i = 0; i < TRADING_QUANTITY; i++) {
          testPoolCreation(isFiltered, i, nftFixture);
          testDepositNFTs(isFiltered, i, nftFixture);
          testSell(isFiltered, i, nftFixture);

          // Functions which decrease balance must play well with transferring
          // invalid IDs and then withdrawing them (hard-min 0 balance)
          for (
            let invalidIds = 0;
            invalidIds < TRADING_QUANTITY;
            invalidIds++
          ) {
            // Test withdrawing the invalid NFTs before and after the test
            for (const withdrawBeforeTest of [true, false]) {
              testWithdrawERC721(
                isFiltered,
                i,
                invalidIds,
                withdrawBeforeTest,
                nftFixture
              );
              testBuySpecific(
                isFiltered,
                i + 1,
                invalidIds,
                withdrawBeforeTest,
                nftFixture
              );
              testBuyAny(
                isFiltered,
                i + 1,
                invalidIds,
                withdrawBeforeTest,
                nftFixture
              );
            }
          }
        }
      });
    }

    for (let i = 1; i <= TRADING_QUANTITY; i++) {
      it(`Should increase upon atomicPoolAndVault with ${i} initial tokenIds`, async function () {
        const { factory, nft, rewardVault, owner, user, params } =
          await makeRewardVaultFixture(nftFixture as NFTFixture)();
        const newNftTokenIds = await mintRandomNfts(
          nft.connect(owner),
          user.address,
          i
        );
        await nft.connect(user).setApprovalForAll(factory.address, true);
        await factory
          .connect(user)
          .setApprovalForAll(rewardVault.address, true);
        const currTokenIdTx = await rewardVault
          .connect(user)
          .atomicPoolAndVault(
            nft.address,
            params.bondingCurve.address,
            params.delta,
            params.fee,
            params.spotPrice,
            params.props,
            params.state,
            params.royaltyNumerator,
            params.royaltyRecipientFallback,
            newNftTokenIds,
            { value: params.value }
          );
        const receipt = await currTokenIdTx.wait();
        const newPoolEvent = receipt
          .events!.map((event) => {
            try {
              return factory.interface.parseLog(event);
            } catch (e) {
              return null;
            }
          })
          .find((event) => event?.name === "NewPool");
        const { poolAddress: newPoolAddress } = newPoolEvent!.args!;
        const collectionPoolETH = await ethers.getContractAt(
          "CollectionPoolETH",
          newPoolAddress
        );
        expect((await collectionPoolETH.getAllHeldIds()).length).to.be.equal(
          newNftTokenIds.length
        );
      });
    }

    it("Should not increment upon ERC721.safeTransferFrom of an invalid tokenId", async function () {
      const { pool, owner, nft } = await genericTradingFixture(nftFixture);

      const invalidNFT = await mintRandomNfts(nft, owner.address, 1);

      const initialValidBalance = (await pool.getAllHeldIds()).length;
      // const initialTrueBalance = (await pool.getAllHeldIds()).length;
      await nft.connect(owner).setApprovalForAll(pool.address, true);
      await nft
        .connect(owner)
        ["safeTransferFrom(address,address,uint256)"](
          owner.address,
          pool.address,
          invalidNFT[0]
        );
      const finalValidBalance = (await pool.getAllHeldIds()).length;
      // const finalTrueBalance = (await pool.getAllHeldIds()).length;
      expect(initialValidBalance).to.be.equal(finalValidBalance);
      // expect(initialTrueBalance + 1).to.be.equal(finalTrueBalance);
    });

    it("Should not increment upon ERC721.transferFrom of an invalid tokenId", async function () {
      const { pool, owner, nft } = await genericTradingFixture(nftFixture);

      const invalidNFT = await mintRandomNfts(nft, owner.address, 1);

      const initialValidBalance = (await pool.getAllHeldIds()).length;
      // const initialTrueBalance = (await pool.getAllHeldIds()).length;
      await nft.connect(owner).setApprovalForAll(pool.address, true);
      await nft
        .connect(owner)
        .transferFrom(owner.address, pool.address, invalidNFT[0]);
      const finalValidBalance = (await pool.getAllHeldIds()).length;
      // const finalTrueBalance = (await pool.getAllHeldIds()).length;
      expect(initialValidBalance).to.be.equal(finalValidBalance);
      // expect(initialTrueBalance + 1).to.be.equal(finalTrueBalance);
    });
  });
}
