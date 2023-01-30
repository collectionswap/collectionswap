import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ethers, expect } from "hardhat";

import {
  getCurveParameters,
  poolMonitorFixture,
  TRADING_QUANTITY,
} from "../shared/fixtures";
import {
  closeEnough,
  getPoolAddress,
  mintAndApproveRandomNfts,
} from "../shared/helpers";
import { randomEthValue } from "../shared/random";
import { getSigners } from "../shared/signers";

import { collectionPoolFactoryFixture } from "./CollectionPoolFactory.spec";

import type {
  CollectionPool,
  CollectionPoolEnumerableERC20,
  CollectionPoolFactory,
  CollectionPoolMissingEnumerableERC20,
  ICurve,
  IPoolActivityMonitor,
  Test20,
  Test721,
  Test721Enumerable,
} from "../../../typechain-types";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import type { BigNumber } from "ethers";

const templates = [
  "CollectionPoolEnumerableETH",
  "CollectionPoolEnumerableERC20",
  "CollectionPoolMissingEnumerableETH",
  "CollectionPoolMissingEnumerableERC20",
] as const;

describe(`Testing pool monitor notifications`, function () {
  let collectionPoolFactory: CollectionPoolFactory;
  let curve: ICurve;
  let test20: Test20;
  let test721: Test721;
  let test721Enumerable: Test721Enumerable;
  let user: SignerWithAddress;
  let trader: SignerWithAddress;
  let poolMonitor: IPoolActivityMonitor;
  let spotPrice: string;
  let delta: string;
  let props: any;
  let state: any;
  let fee: string;
  let royaltyNumerator: string;

  before(async function () {
    ({
      factory: collectionPoolFactory,
      curve,
      test20,
      test721,
      test721Enumerable,
    } = await loadFixture(collectionPoolFactoryFixture));
    poolMonitor = await loadFixture(poolMonitorFixture);
    ({ spotPrice, delta, props, state, fee, royaltyNumerator } =
      getCurveParameters());
  });
  for (const template of templates) {
    const isEth = template.includes("ETH");
    describe(`Using ${template}`, function () {
      let pool: CollectionPool;
      let nftContract: Test721 | Test721Enumerable;
      beforeEach(async function () {
        ({ user, user1: trader } = await getSigners());
        nftContract = template.includes("Missing")
          ? test721
          : test721Enumerable;
        const initialNFTIDs = await mintAndApproveRandomNfts(
          nftContract,
          user,
          collectionPoolFactory.address,
          TRADING_QUANTITY
        );

        if (isEth) {
          this.createETHPoolParams = {
            nft: nftContract.address,
            bondingCurve: curve.address,
            assetRecipient: ethers.constants.AddressZero,
            receiver: user.address,
            poolType: 2,
            delta,
            fee,
            spotPrice,
            props,
            state,
            royaltyNumerator,
            royaltyRecipientFallback: user.address,
            initialNFTIDs,
          };

          const value = ethers.utils.parseEther("10");
          const tx = await collectionPoolFactory
            .connect(user)
            .createPoolETH(this.createETHPoolParams, {
              value,
            });
          const { newPoolAddress } = await getPoolAddress(tx);
          pool = (await ethers.getContractAt(
            template,
            newPoolAddress
          )) as CollectionPool;
          await collectionPoolFactory
            .connect(user)
            .setApprovalForAll(pool.address, true);
          await pool.connect(user).transferOwnership(poolMonitor.address);
        } else {
          const initialTokenBalance = ethers.utils.parseEther("10");
          for (const wallet of [user, trader]) {
            await test20.mint(wallet.address, initialTokenBalance);
            await test20
              .connect(wallet)
              .approve(collectionPoolFactory.address, initialTokenBalance);
          }

          this.createERC20PoolParams = {
            token: test20.address,
            nft: nftContract.address,
            bondingCurve: curve.address,
            assetRecipient: ethers.constants.AddressZero,
            receiver: user.address,
            poolType: 2,
            delta,
            fee,
            spotPrice,
            props,
            state,
            royaltyNumerator,
            royaltyRecipientFallback: user.address,
            initialNFTIDs,
          };

          const tx = await collectionPoolFactory.connect(user).createPoolERC20({
            ...this.createERC20PoolParams,
            initialTokenBalance,
          });
          const { newPoolAddress } = await getPoolAddress(tx);
          pool = (await ethers.getContractAt(
            template,
            newPoolAddress
          )) as CollectionPool;
          await collectionPoolFactory
            .connect(user)
            .setApprovalForAll(pool.address, true);
          await pool.connect(user).transferOwnership(poolMonitor.address);
        }
      });

      for (let i = 1; i < TRADING_QUANTITY; i++) {
        it(`Should emit buy events for buying ${i} random NFTs`, async function () {
          const quote = await pool.getBuyNFTQuote(i);
          if (!isEth) {
            await test20
              .connect(trader)
              .approve(pool.address, quote.inputAmount);
          }

          const lastSwapPrice =
            i === 1
              ? quote.inputAmount
              : quote.inputAmount.sub(
                  (await pool.getBuyNFTQuote(i - 1)).inputAmount
                );
          const tx = await pool
            .connect(trader)
            .swapTokenForAnyNFTs(
              i,
              quote.inputAmount,
              trader.address,
              false,
              ethers.constants.AddressZero,
              { ...(isEth ? { value: quote.inputAmount } : {}) }
            );
          await expect(tx)
            .to.emit(poolMonitor, "BoughtFromPool")
            .withArgs(
              pool.address,
              i,
              (val: BigNumber) => {
                const res = closeEnough(val, lastSwapPrice);
                if (!res) console.log(`Expected ${lastSwapPrice}. Got ${val}`);
                return res;
              },
              quote.inputAmount
            );
        });

        it(`Should emit buy events for buying ${i} specific NFTs`, async function () {
          const quote = await pool.getBuyNFTQuote(i);
          if (!isEth) {
            await test20
              .connect(trader)
              .approve(pool.address, quote.inputAmount);
          }

          const lastSwapPrice =
            i === 1
              ? quote.inputAmount
              : quote.inputAmount.sub(
                  (await pool.getBuyNFTQuote(i - 1)).inputAmount
                );
          const tx = await pool
            .connect(trader)
            .swapTokenForSpecificNFTs(
              (await pool.getAllHeldIds()).slice(0, i),
              quote.inputAmount,
              trader.address,
              false,
              ethers.constants.AddressZero,
              { ...(isEth ? { value: quote.inputAmount } : {}) }
            );
          await expect(tx)
            .to.emit(poolMonitor, "BoughtFromPool")
            .withArgs(
              pool.address,
              i,
              (val: BigNumber) => {
                const res = closeEnough(val, lastSwapPrice);
                if (!res) console.log(`Expected ${lastSwapPrice}. Got ${val}`);
                return res;
              },
              quote.inputAmount
            );
        });

        it(`Should emit sell events for selling ${i} NFTs`, async function () {
          const tokenIds = await mintAndApproveRandomNfts(
            nftContract,
            trader,
            pool.address,
            i
          );
          const quote = await pool.getSellNFTQuote(i);
          if (!isEth) {
            await test20
              .connect(trader)
              .approve(pool.address, quote.outputAmount);
          }

          const lastSwapPrice =
            i === 1
              ? quote.outputAmount
              : quote.outputAmount.sub(
                  (await pool.getSellNFTQuote(i - 1)).outputAmount
                );
          const tx = await pool
            .connect(trader)
            .swapNFTsForToken(
              { ids: tokenIds, proof: [], proofFlags: [] },
              quote.outputAmount,
              trader.address,
              false,
              ethers.constants.AddressZero
            );
          await expect(tx)
            .to.emit(poolMonitor, "SoldToPool")
            .withArgs(
              pool.address,
              i,
              (val: BigNumber) => {
                const res = closeEnough(val, lastSwapPrice);
                if (!res) console.log(`Expected ${lastSwapPrice}. Got ${val}`);
                return res;
              },
              quote.outputAmount
            );
        });

        it(`Should emit deposit events for depositing ${i} NFTs through pool`, async function () {
          const tokenIds = await mintAndApproveRandomNfts(
            nftContract,
            user,
            pool.address,
            i
          );
          const tx = await pool.connect(user).depositNFTs(tokenIds, [], []);
          await expect(tx)
            .to.emit(poolMonitor, "DepositNFT")
            .withArgs(pool.address, i);
        });

        it(`Should emit deposit events for depositing ${i} NFTs through factory`, async function () {
          const tokenIds = await mintAndApproveRandomNfts(
            nftContract,
            user,
            collectionPoolFactory.address,
            i
          );
          const tx = await collectionPoolFactory
            .connect(user)
            .depositNFTs(tokenIds, [], [], pool.address, user.address);
          await expect(tx)
            .to.emit(poolMonitor, "DepositNFT")
            .withArgs(pool.address, i);
        });
      }

      if (isEth) {
        it(`Should emit deposit events for depositing ETH`, async function () {
          const amount = randomEthValue();
          await test20.mint(user.address, amount);
          await test20.connect(user).approve(pool.address, amount);
          const tx = await user.sendTransaction({
            to: pool.address,
            value: amount,
          });
          await expect(tx)
            .to.emit(poolMonitor, "DepositToken")
            .withArgs(pool.address, amount);
        });
      } else {
        it(`Should emit deposit events for depositing ERC20`, async function () {
          const amount = randomEthValue();
          await test20.mint(user.address, amount);
          await test20.connect(user).approve(pool.address, amount);
          const tx = await (
            pool as
              | CollectionPoolEnumerableERC20
              | CollectionPoolMissingEnumerableERC20
          )
            .connect(user)
            .depositERC20(test20.address, amount);
          await expect(tx)
            .to.emit(poolMonitor, "DepositToken")
            .withArgs(pool.address, amount);
        });
      }
    });
  }
});
