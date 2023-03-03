import { expect } from "chai";
import { constants } from "ethers";
import { ethers } from "hardhat";

import {
  royaltyFixture,
  royaltyWithPoolFixture,
  royaltyWithPoolAndFallbackFixture,
} from "../shared/fixtures";
import {
  changesEtherBalancesFuzzy,
  changesEtherBalancesFuzzyMultipleTransactions,
  getNftTransfersTo,
  getPoolAddress,
  getRandomInt,
  pickRandomElements,
  prepareQuoteValues,
} from "../shared/helpers";

import type {
  CollectionPoolETH,
  CollectionPoolFactory,
} from "../../../typechain-types";
import type { BigNumber, providers } from "ethers";

const newRoyaltyNumerator = ethers.utils.parseUnits("0.5", 6);

describe("Royalties", function () {
  describe("Royalties should be awarded upon swaps", function () {
    it("Should not award royalties when buying 0 items from pool (revert)", async function () {
      const {
        recipients,
        otherAccount1: trader,
        collectionPoolETH,
      } = await royaltyWithPoolFixture();

      const initialBalances = await Promise.all(
        recipients.map(async (recipient) => recipient.getBalance())
      );

      await expect(
        collectionPoolETH.swapTokenForSpecificNFTs(
          [],
          ethers.BigNumber.from("0"),
          trader.address,
          false,
          ethers.constants.AddressZero,
          {
            value: ethers.utils.parseEther("1"),
            gasLimit: 1500000,
          }
        )
      ).to.be.revertedWithCustomError(collectionPoolETH, "InvalidSwapQuantity");

      const finalBalances = await Promise.all(
        recipients.map(async (recipient) => recipient.getBalance())
      );

      expect(finalBalances).deep.equal(initialBalances);
    });

    it("Should not award royalties when selling 0 items to pool", async function () {
      const {
        recipients,
        otherAccount1: trader,
        collectionPoolETH,
      } = await royaltyWithPoolFixture();

      const initialBalances = await Promise.all(
        recipients.map(async (recipient) => recipient.getBalance())
      );

      await expect(
        collectionPoolETH.swapNFTsForToken(
          {
            ids: [],
            proof: [],
            proofFlags: [],
          },
          ethers.utils.parseEther("0"),
          trader.address,
          false,
          ethers.constants.AddressZero,
          []
        )
      ).to.be.revertedWithCustomError(collectionPoolETH, "InvalidSwapQuantity");

      const finalBalances = await Promise.all(
        recipients.map(async (recipient) => recipient.getBalance())
      );

      expect(finalBalances).deep.equal(initialBalances);
    });

    it("Should award royalties when buying many random items from pool", async function () {
      const {
        nft2981: nft,
        otherAccount1: trader,
        collectionPoolETH: pool,
        fee,
        protocolFee,
        royaltyNumerator,
        collectionPoolFactory: factory,
      } = await royaltyWithPoolFixture();

      // Specify quantity of random NFTs to buy
      const numBought = 4;

      const { spotPrice, delta, props } = await pool.curveParams();
      const { tx, quote, protocolFeeAmount, expectedRoyalties } =
        await prepareQuoteValues(
          "buy",
          pool,
          spotPrice,
          delta,
          props,
          fee,
          protocolFee,
          royaltyNumerator,
          trader,
          numBought,
          0
        );

      // Figure out which random NFT the trader bought
      const tradedIds = await getNftTransfersTo(tx, nft, trader.address);

      let royaltyPaid = constants.Zero;
      const amountsDue = new Map<string, BigNumber>();

      for (let index = 0; index < tradedIds.length; index++) {
        const tokenId = tradedIds[index];
        let recipient = (await nft.royaltyInfo(tokenId, 0))[0];
        if (recipient === ethers.constants.AddressZero.toString()) {
          recipient = pool.address;
        }

        if (recipient === pool.address) {
          // If pool is recipient then funds just stay in the pool
          continue;
        }

        const amount = ethers.utils.parseEther(
          expectedRoyalties[index].toFixed(18)
        );
        royaltyPaid = royaltyPaid.add(amount);

        const oldDue = amountsDue.get(recipient) ?? ethers.BigNumber.from("0");
        amountsDue.set(recipient, oldDue.add(amount));
      }

      const addresses: string[] = [trader.address, pool.address];
      const changes: BigNumber[] = [
        quote.mul(-1),
        quote.sub(royaltyPaid).sub(protocolFeeAmount),
      ];

      expect(await changesEtherBalancesFuzzy(tx, addresses, changes)).to.be
        .true;
      await testRoyaltyWithdrawals(factory, pool, amountsDue);
    });

    it("Should award royalties when buying many specific items from pool", async function () {
      const {
        nft2981: nft,
        otherAccount1: trader,
        collectionPoolETH: pool,
        fee,
        protocolFee,
        royaltyNumerator,
        tokenIdsWithRoyalty,
        collectionPoolFactory: factory,
      } = await royaltyWithPoolFixture();

      // Specify NFTs to buy
      const nftsTraded = tokenIdsWithRoyalty;

      const { spotPrice, delta, props } = await pool.curveParams();
      const { tx, quote, protocolFeeAmount, expectedRoyalties } =
        await prepareQuoteValues(
          "buy",
          pool,
          spotPrice,
          delta,
          props,
          fee,
          protocolFee,
          royaltyNumerator,
          trader,
          nftsTraded,
          0
        );

      // Figure out which random NFT the trader bought
      const tradedIds = await getNftTransfersTo(tx, nft, trader.address);

      let royaltyPaid = constants.Zero;
      const amountsDue = new Map<string, BigNumber>();

      for (let index = 0; index < tradedIds.length; index++) {
        const tokenId = tradedIds[index];
        let recipient = (await nft.royaltyInfo(tokenId, 0))[0];
        if (recipient === ethers.constants.AddressZero.toString()) {
          recipient = pool.address;
        }

        if (recipient === pool.address) {
          // If pool is recipient then funds just stay in the pool
          continue;
        }

        const amount = ethers.utils.parseEther(
          expectedRoyalties[index].toFixed(18)
        );
        royaltyPaid = royaltyPaid.add(amount);

        const oldDue = amountsDue.get(recipient) ?? ethers.BigNumber.from("0");
        amountsDue.set(recipient, oldDue.add(amount));
      }

      const addresses: string[] = [trader.address, pool.address];
      const changes: BigNumber[] = [
        quote.mul(-1),
        quote.sub(royaltyPaid).sub(protocolFeeAmount),
      ];

      expect(await changesEtherBalancesFuzzy(tx, addresses, changes)).to.be
        .true;
      await testRoyaltyWithdrawals(factory, pool, amountsDue);
    });

    it("Should award royalties when selling many items to pool", async function () {
      const {
        nft2981: nft,
        otherAccount1: trader,
        collectionPoolETH: pool,
        fee,
        protocolFee,
        royaltyNumerator,
        traderNfts,
        collectionPoolFactory: factory,
      } = await royaltyWithPoolFixture();

      // Specify NFTs to buy
      const nftsTraded = traderNfts;

      const { spotPrice, delta, props } = await pool.curveParams();
      const { tx, quote, protocolFeeAmount, expectedRoyalties } =
        await prepareQuoteValues(
          "sell",
          pool,
          spotPrice,
          delta,
          props,
          fee,
          protocolFee,
          royaltyNumerator,
          trader,
          nftsTraded,
          0
        );

      let royaltyPaid = constants.Zero;
      const amountsDue = new Map<string, BigNumber>();

      for (let index = 0; index < traderNfts.length; index++) {
        const tokenId = traderNfts[index];
        let recipient = (await nft.royaltyInfo(tokenId, 0))[0];
        if (recipient === ethers.constants.AddressZero.toString()) {
          recipient = pool.address;
        }

        if (recipient === pool.address) {
          // If pool is recipient then funds just stay in the pool
          continue;
        }

        const amount = ethers.utils.parseEther(
          expectedRoyalties[index].toFixed(18)
        );
        royaltyPaid = royaltyPaid.add(amount);

        const oldDue = amountsDue.get(recipient) ?? ethers.BigNumber.from("0");
        amountsDue.set(recipient, oldDue.add(amount));
      }

      const addresses: string[] = [trader.address, pool.address];
      const changes: BigNumber[] = [
        quote,
        quote.mul(-1).sub(royaltyPaid).sub(protocolFeeAmount),
      ];

      expect(await changesEtherBalancesFuzzy(tx, addresses, changes)).to.be
        .true;
      await testRoyaltyWithdrawals(factory, pool, amountsDue);
    });

    it("Should award royalties when repeatedly buying and selling one/multiple items", async function () {
      const {
        nft2981: nft,
        otherAccount1: trader,
        collectionPoolETH: pool,
        fee,
        protocolFee,
        royaltyNumerator,
        enumerateTrader,
        collectionPoolFactory: factory,
      } = await royaltyWithPoolFixture();

      const initialNftsInPool = (await pool.getAllHeldIds()).length;
      const expectedBalanceChanges = new Map<string, BigNumber>();
      const royaltiesBookkept = new Map<string, BigNumber>();
      const allTransactions:
        | providers.TransactionResponse[]
        | Promise<providers.TransactionResponse[]> = [];
      const NUM_ITERS = 15;
      const { spotPrice, delta, props } = await pool.curveParams();

      const checkState = async (iteration: number) => {
        console.log(
          `Checking royalties are awarded correctly after interaction #${iteration} (0-indexed)`
        );
        const recipients: string[] = [];
        const amounts: BigNumber[] = [];

        Array.from(expectedBalanceChanges).forEach(([address, amount]) => {
          recipients.push(address);
          amounts.push(amount);
        });

        expect(
          await changesEtherBalancesFuzzyMultipleTransactions(
            allTransactions,
            recipients,
            amounts
          )
        ).to.be.true;

        await Promise.all(
          Array.from(royaltiesBookkept).map(async ([address, amount]) => {
            expect(
              await factory.royaltiesClaimable(
                address,
                ethers.constants.AddressZero
              )
            ).to.approximately(amount, 1e12);
          })
        );
      };

      const sellRoutine = async () => {
        // Select a random number of NFTs to sell
        const nftsHeld = await enumerateTrader();
        const numNftsToSell = getRandomInt(1, nftsHeld.length);
        const nftsToSell = pickRandomElements(nftsHeld, numNftsToSell);
        const currentNumNftsInPool = (await pool.getAllHeldIds()).length;

        // Create the transaction and get expected values
        const { tx, expectedRoyalties, quote, protocolFeeAmount } =
          await prepareQuoteValues(
            "sell",
            pool,
            spotPrice,
            delta,
            props,
            fee,
            protocolFee,
            royaltyNumerator,
            trader,
            nftsToSell,
            currentNumNftsInPool - initialNftsInPool
          );

        // Record the transaction
        allTransactions.push(tx);

        // Maintain the main value changes
        let royaltyPaid = constants.Zero;

        // Maintain royalties due
        for (let i = 0; i < nftsToSell.length; i++) {
          const nftSold = nftsToSell[i];
          let recipient = (await nft.royaltyInfo(nftSold, 0))[0];
          if (recipient === ethers.constants.AddressZero.toString()) {
            recipient = pool.address;
          }

          const amount = ethers.utils.parseEther(
            expectedRoyalties[i].toFixed(18)
          );
          if (recipient === pool.address) {
            continue;
          }

          royaltyPaid = royaltyPaid.add(amount);

          const oldValue =
            royaltiesBookkept.get(recipient) ?? ethers.BigNumber.from("0");
          royaltiesBookkept.set(recipient, oldValue.add(amount));
        }

        const oldTraderAmount =
          expectedBalanceChanges.get(trader.address) ??
          ethers.BigNumber.from("0");
        expectedBalanceChanges.set(trader.address, oldTraderAmount.add(quote));
        const oldPoolAmount =
          expectedBalanceChanges.get(pool.address) ??
          ethers.BigNumber.from("0");
        expectedBalanceChanges.set(
          pool.address,
          oldPoolAmount.add(
            quote.mul(-1).sub(royaltyPaid).sub(protocolFeeAmount)
          )
        );
      };

      const buyRandomRoutine = async () => {
        // Unfortunately there's no way to retrieve the random order in which
        // the NFTs were selected so we can only test with quantity 1
        const numNftsToBuy = 1;
        const currentNumNftsInPool = (await pool.getAllHeldIds()).length;

        // Create the transaction and get expected values
        const { tx, expectedRoyalties, quote, protocolFeeAmount } =
          await prepareQuoteValues(
            "buy",
            pool,
            spotPrice,
            delta,
            props,
            fee,
            protocolFee,
            royaltyNumerator,
            trader,
            numNftsToBuy,
            currentNumNftsInPool - initialNftsInPool
          );

        // Record the transaction
        allTransactions.push(tx);

        // Maintain the main value changes
        let royaltyPaid = constants.Zero;

        // Maintain royalties due
        const nftsSold = await getNftTransfersTo(tx, nft, trader.address);
        for (let i = 0; i < numNftsToBuy; i++) {
          const nftSold = nftsSold[0];
          let recipient = (await nft.royaltyInfo(nftSold, 0))[0];
          if (recipient === ethers.constants.AddressZero.toString()) {
            recipient = pool.address;
          }

          const amount = ethers.utils.parseEther(
            expectedRoyalties[i].toFixed(18)
          );

          if (recipient === pool.address) {
            continue;
          }

          royaltyPaid = royaltyPaid.add(amount);

          const oldValue =
            royaltiesBookkept.get(recipient) ?? ethers.BigNumber.from("0");
          royaltiesBookkept.set(recipient, oldValue.add(amount));
        }

        const oldTraderAmount =
          expectedBalanceChanges.get(trader.address) ??
          ethers.BigNumber.from("0");
        expectedBalanceChanges.set(
          trader.address,
          oldTraderAmount.add(quote.mul(-1))
        );
        const oldPoolAmount =
          expectedBalanceChanges.get(pool.address) ??
          ethers.BigNumber.from("0");
        expectedBalanceChanges.set(
          pool.address,
          oldPoolAmount.add(quote.sub(royaltyPaid).sub(protocolFeeAmount))
        );
      };

      const buySpecificRoutine = async () => {
        // Select a random number of NFTs to buy
        const nftsInPool = await pool.getAllHeldIds();
        const numNftsToBuy = getRandomInt(1, nftsInPool.length);
        const nftsToBuy = pickRandomElements(nftsInPool, numNftsToBuy);
        const currentNumNftsInPool = (await pool.getAllHeldIds()).length;

        // Create the transaction and get expected values
        const { tx, expectedRoyalties, quote, protocolFeeAmount } =
          await prepareQuoteValues(
            "buy",
            pool,
            spotPrice,
            delta,
            props,
            fee,
            protocolFee,
            royaltyNumerator,
            trader,
            nftsToBuy,
            currentNumNftsInPool - initialNftsInPool
          );

        // Record the transaction
        allTransactions.push(tx);

        // Maintain the main value changes
        let royaltyPaid = constants.Zero;

        // Maintain royalties due
        for (let i = 0; i < nftsToBuy.length; i++) {
          const nftSold = nftsToBuy[i];
          let recipient = (await nft.royaltyInfo(nftSold, 0))[0];
          if (recipient === ethers.constants.AddressZero.toString()) {
            recipient = pool.address;
          }

          const amount = ethers.utils.parseEther(
            expectedRoyalties[i].toFixed(18)
          );

          if (recipient === pool.address) {
            continue;
          }

          royaltyPaid = royaltyPaid.add(amount);

          const oldValue =
            royaltiesBookkept.get(recipient) ?? ethers.BigNumber.from("0");
          royaltiesBookkept.set(recipient, oldValue.add(amount));
        }

        const oldTraderAmount =
          expectedBalanceChanges.get(trader.address) ??
          ethers.BigNumber.from("0");
        expectedBalanceChanges.set(
          trader.address,
          oldTraderAmount.add(quote.mul(-1))
        );
        const oldPoolAmount =
          expectedBalanceChanges.get(pool.address) ??
          ethers.BigNumber.from("0");
        expectedBalanceChanges.set(
          pool.address,
          oldPoolAmount.add(quote.sub(royaltyPaid).sub(protocolFeeAmount))
        );
      };

      // For loop to pick a random buy or sell function, random amount/id set,
      // update the change in tokenIds in pool, and maintain the royalties due.
      const ACTIONS = [
        // Double weight to sell routine so average number in pool is stable
        sellRoutine,
        sellRoutine,
        buyRandomRoutine,
        buySpecificRoutine,
      ];
      let i = 0;
      while (i < NUM_ITERS) {
        const routine = pickRandomElements(ACTIONS, 1)[0];
        const numNftsInPool = (await pool.getAllHeldIds()).length;
        if (
          [buyRandomRoutine, buySpecificRoutine].includes(routine) &&
          numNftsInPool === 0
        ) {
          // Not possible to buy cause pool is empty
          continue;
        }

        if (
          routine === sellRoutine &&
          (await nft.balanceOf(trader.address)).eq(ethers.BigNumber.from("0"))
        ) {
          // Not possible to sell cause trader has no nfts
          continue;
        }

        await routine();
        await checkState(i);
        i++;
      }

      await testRoyaltyWithdrawals(factory, pool, royaltiesBookkept);
    });

    it("Should award royalties when repeatedly buying and selling one/multiple items with fallback", async function () {
      const {
        nft2981: nft,
        otherAccount1: trader,
        collectionPoolETH: pool,
        fee,
        protocolFee,
        royaltyNumerator,
        royaltyRecipientFallback,
        collectionPoolFactory: factory,
      } = await royaltyWithPoolAndFallbackFixture();

      const enumerateTrader: () => Promise<BigNumber[]> = async () => {
        const balance = (await nft.balanceOf(trader.address)).toNumber();
        const output = [];
        for (let i = 0; i < balance; i++) {
          output.push(await nft.tokenOfOwnerByIndex(trader.address, i));
        }

        return output;
      };

      const initialNftsInPool = (await pool.getAllHeldIds()).length;
      const expectedBalanceChanges = new Map<string, BigNumber>();
      const royaltiesBookkept = new Map<string, BigNumber>();
      const allTransactions:
        | providers.TransactionResponse[]
        | Promise<providers.TransactionResponse[]> = [];
      const NUM_ITERS = 15;
      const { spotPrice, delta, props } = await pool.curveParams();

      const checkState = async (iteration: number) => {
        console.log(
          `Checking royalties are awarded correctly after interaction #${iteration} (0-indexed)`
        );
        const recipients: string[] = [];
        const amounts: BigNumber[] = [];

        Array.from(expectedBalanceChanges).forEach(([address, amount]) => {
          recipients.push(address);
          amounts.push(amount);
        });

        expect(
          await changesEtherBalancesFuzzyMultipleTransactions(
            allTransactions,
            recipients,
            amounts
          )
        ).to.be.true;

        await Promise.all(
          Array.from(royaltiesBookkept).map(async ([address, amount]) => {
            expect(
              await factory.royaltiesClaimable(
                address,
                ethers.constants.AddressZero
              )
            ).to.approximately(amount, 1e12);
          })
        );
      };

      const sellRoutine = async () => {
        // Select a random number of NFTs to sell
        const nftsHeld = await enumerateTrader();
        const numNftsToSell = getRandomInt(1, nftsHeld.length);
        const nftsToSell = pickRandomElements(nftsHeld, numNftsToSell);
        const currentNumNftsInPool = (await pool.getAllHeldIds()).length;

        // Create the transaction and get expected values
        const { tx, expectedRoyalties, quote, protocolFeeAmount } =
          await prepareQuoteValues(
            "sell",
            pool,
            spotPrice,
            delta,
            props,
            fee,
            protocolFee,
            royaltyNumerator,
            trader,
            nftsToSell,
            currentNumNftsInPool - initialNftsInPool
          );

        // Record the transaction
        allTransactions.push(tx);

        // Maintain the main value changes
        let royaltyPaid = constants.Zero;

        // Maintain royalties due
        for (let i = 0; i < nftsToSell.length; i++) {
          const nftSold = nftsToSell[i];
          let recipient = (await nft.royaltyInfo(nftSold, 0))[0];
          if (recipient === ethers.constants.AddressZero.toString()) {
            recipient = royaltyRecipientFallback.address;
          }

          const amount = ethers.utils.parseEther(
            expectedRoyalties[i].toFixed(18)
          );
          if (recipient === pool.address) {
            continue;
          }

          royaltyPaid = royaltyPaid.add(amount);

          const oldValue =
            royaltiesBookkept.get(recipient) ?? ethers.BigNumber.from("0");
          royaltiesBookkept.set(recipient, oldValue.add(amount));
        }

        const oldTraderAmount =
          expectedBalanceChanges.get(trader.address) ??
          ethers.BigNumber.from("0");
        expectedBalanceChanges.set(trader.address, oldTraderAmount.add(quote));
        const oldPoolAmount =
          expectedBalanceChanges.get(pool.address) ??
          ethers.BigNumber.from("0");
        expectedBalanceChanges.set(
          pool.address,
          oldPoolAmount.add(
            quote.mul(-1).sub(royaltyPaid).sub(protocolFeeAmount)
          )
        );
      };

      const buyRandomRoutine = async () => {
        // Unfortunately there's no way to retrieve the random order in which
        // the NFTs were selected so we can only test with quantity 1
        const numNftsToBuy = 1;
        const currentNumNftsInPool = (await pool.getAllHeldIds()).length;

        // Create the transaction and get expected values
        const { tx, expectedRoyalties, quote, protocolFeeAmount } =
          await prepareQuoteValues(
            "buy",
            pool,
            spotPrice,
            delta,
            props,
            fee,
            protocolFee,
            royaltyNumerator,
            trader,
            numNftsToBuy,
            currentNumNftsInPool - initialNftsInPool
          );

        // Record the transaction
        allTransactions.push(tx);

        // Maintain the main value changes
        let royaltyPaid = constants.Zero;

        // Maintain royalties due
        const nftsSold = await getNftTransfersTo(tx, nft, trader.address);
        for (let i = 0; i < numNftsToBuy; i++) {
          const nftSold = nftsSold[0];
          let recipient = (await nft.royaltyInfo(nftSold, 0))[0];
          if (recipient === ethers.constants.AddressZero.toString()) {
            recipient = royaltyRecipientFallback.address;
          }

          const amount = ethers.utils.parseEther(
            expectedRoyalties[i].toFixed(18)
          );

          if (recipient === pool.address) {
            continue;
          }

          royaltyPaid = royaltyPaid.add(amount);

          const oldValue =
            royaltiesBookkept.get(recipient) ?? ethers.BigNumber.from("0");
          royaltiesBookkept.set(recipient, oldValue.add(amount));
        }

        const oldTraderAmount =
          expectedBalanceChanges.get(trader.address) ??
          ethers.BigNumber.from("0");
        expectedBalanceChanges.set(
          trader.address,
          oldTraderAmount.add(quote.mul(-1))
        );
        const oldPoolAmount =
          expectedBalanceChanges.get(pool.address) ??
          ethers.BigNumber.from("0");
        expectedBalanceChanges.set(
          pool.address,
          oldPoolAmount.add(quote.sub(royaltyPaid).sub(protocolFeeAmount))
        );
      };

      const buySpecificRoutine = async () => {
        // Select a random number of NFTs to buy
        const nftsInPool = await pool.getAllHeldIds();
        const numNftsToBuy = getRandomInt(1, nftsInPool.length);
        const nftsToBuy = pickRandomElements(nftsInPool, numNftsToBuy);
        const currentNumNftsInPool = (await pool.getAllHeldIds()).length;

        // Create the transaction and get expected values
        const { tx, expectedRoyalties, quote, protocolFeeAmount } =
          await prepareQuoteValues(
            "buy",
            pool,
            spotPrice,
            delta,
            props,
            fee,
            protocolFee,
            royaltyNumerator,
            trader,
            nftsToBuy,
            currentNumNftsInPool - initialNftsInPool
          );

        // Record the transaction
        allTransactions.push(tx);

        // Maintain the main value changes
        let royaltyPaid = constants.Zero;

        // Maintain royalties due
        for (let i = 0; i < nftsToBuy.length; i++) {
          const nftSold = nftsToBuy[i];
          let recipient = (await nft.royaltyInfo(nftSold, 0))[0];
          if (recipient === ethers.constants.AddressZero.toString()) {
            recipient = royaltyRecipientFallback.address;
          }

          const amount = ethers.utils.parseEther(
            expectedRoyalties[i].toFixed(18)
          );

          if (recipient === pool.address) {
            continue;
          }

          royaltyPaid = royaltyPaid.add(amount);

          const oldValue =
            royaltiesBookkept.get(recipient) ?? ethers.BigNumber.from("0");
          royaltiesBookkept.set(recipient, oldValue.add(amount));
        }

        const oldTraderAmount =
          expectedBalanceChanges.get(trader.address) ??
          ethers.BigNumber.from("0");
        expectedBalanceChanges.set(
          trader.address,
          oldTraderAmount.add(quote.mul(-1))
        );
        const oldPoolAmount =
          expectedBalanceChanges.get(pool.address) ??
          ethers.BigNumber.from("0");
        expectedBalanceChanges.set(
          pool.address,
          oldPoolAmount.add(quote.sub(royaltyPaid).sub(protocolFeeAmount))
        );
      };

      // For loop to pick a random buy or sell function, random amount/id set,
      // update the change in tokenIds in pool, and maintain the royalties due.
      const ACTIONS = [
        // Double weight to sell routine so average number in pool is stable
        sellRoutine,
        sellRoutine,
        buyRandomRoutine,
        buySpecificRoutine,
      ];
      let i = 0;
      while (i < NUM_ITERS) {
        const routine = pickRandomElements(ACTIONS, 1)[0];
        const numNftsInPool = (await pool.getAllHeldIds()).length;
        if (
          [buyRandomRoutine, buySpecificRoutine].includes(routine) &&
          numNftsInPool === 0
        ) {
          // Not possible to buy cause pool is empty
          continue;
        }

        if (
          routine === sellRoutine &&
          (await nft.balanceOf(trader.address)).eq(ethers.BigNumber.from("0"))
        ) {
          // Not possible to sell cause trader has no nfts
          continue;
        }

        await routine();
        await checkState(i);
        i++;
      }

      await testRoyaltyWithdrawals(factory, pool, royaltiesBookkept);
    });

    it("Should award royalties when repeatedly buying and selling one/multiple items with fallback for non ERC2981", async function () {
      const {
        nftNon2981,
        otherAccount1: trader,
        fee,
        protocolFee,
        royaltyNumerator,
        royaltyRecipientFallback,
        collectionPoolFactory,
        ethPoolParams,
        tokenIdsWithoutRoyalty,
        collectionPoolFactory: factory,
      } = await royaltyFixture();

      const nft = nftNon2981 as unknown as any;
      const collectionPoolETHContractTx =
        await collectionPoolFactory.createPoolETH(
          {
            ...ethPoolParams,
            nft: nft.address,
            royaltyNumerator: ethers.BigNumber.from(royaltyNumerator),
            royaltyRecipientFallback: royaltyRecipientFallback.address,
            initialNFTIDs: tokenIdsWithoutRoyalty,
          },
          {
            value: ethers.BigNumber.from(`${8e18}`),
            gasLimit: 1000000,
          }
        );
      const { newPoolAddress } = await getPoolAddress(
        collectionPoolETHContractTx
      );
      const pool = await ethers.getContractAt(
        "CollectionPoolETH",
        newPoolAddress
      );
      const initialNftsInPool = (await pool.getAllHeldIds()).length;
      const expectedBalanceChanges = new Map<string, BigNumber>();
      const royaltiesBookkept = new Map<string, BigNumber>();
      const allTransactions:
        | providers.TransactionResponse[]
        | Promise<providers.TransactionResponse[]> = [];
      const NUM_ITERS = 15;
      const { spotPrice, delta, props } = await pool.curveParams();

      const checkState = async (iteration: number) => {
        console.log(
          `Checking royalties are awarded correctly after interaction #${iteration} (0-indexed)`
        );
        const recipients: string[] = [];
        const amounts: BigNumber[] = [];

        Array.from(expectedBalanceChanges).forEach(([address, amount]) => {
          recipients.push(address);
          amounts.push(amount);
        });

        expect(
          await changesEtherBalancesFuzzyMultipleTransactions(
            allTransactions,
            recipients,
            amounts
          )
        ).to.be.true;

        await Promise.all(
          Array.from(royaltiesBookkept).map(async ([address, amount]) => {
            expect(
              await factory.royaltiesClaimable(
                address,
                ethers.constants.AddressZero
              )
            ).to.approximately(amount, 1e12);
          })
        );
      };

      const sellRoutine = async () => {
        const enumerateTrader: () => Promise<BigNumber[]> = async () => {
          const balance = (await nft.balanceOf(trader.address)).toNumber();
          const output = [];
          for (let i = 0; i < balance; i++) {
            output.push(await nft.tokenOfOwnerByIndex(trader.address, i));
          }

          return output;
        };

        await nft.connect(trader).setApprovalForAll(pool.address, true);
        // Select a random number of NFTs to sell
        const nftsHeld = await enumerateTrader();
        const numNftsToSell = getRandomInt(1, nftsHeld.length);
        const nftsToSell = pickRandomElements(nftsHeld, numNftsToSell);
        const currentNumNftsInPool = (await pool.getAllHeldIds()).length;

        // Create the transaction and get expected values
        const { tx, expectedRoyalties, quote, protocolFeeAmount } =
          await prepareQuoteValues(
            "sell",
            pool,
            spotPrice,
            delta,
            props,
            fee,
            protocolFee,
            royaltyNumerator,
            trader,
            nftsToSell,
            currentNumNftsInPool - initialNftsInPool
          );

        // Record the transaction
        allTransactions.push(tx);

        // Maintain the main value changes
        let royaltyPaid = constants.Zero;

        // Maintain royalties due
        for (let i = 0; i < nftsToSell.length; i++) {
          const recipient = royaltyRecipientFallback.address;
          const amount = ethers.utils.parseEther(
            expectedRoyalties[i].toFixed(18)
          );
          royaltyPaid = royaltyPaid.add(amount);

          const oldValue =
            royaltiesBookkept.get(recipient) ?? ethers.BigNumber.from("0");
          royaltiesBookkept.set(recipient, oldValue.add(amount));
        }

        const oldTraderAmount =
          expectedBalanceChanges.get(trader.address) ??
          ethers.BigNumber.from("0");
        expectedBalanceChanges.set(trader.address, oldTraderAmount.add(quote));
        const oldPoolAmount =
          expectedBalanceChanges.get(pool.address) ??
          ethers.BigNumber.from("0");
        expectedBalanceChanges.set(
          pool.address,
          oldPoolAmount.add(
            quote.mul(-1).sub(royaltyPaid).sub(protocolFeeAmount)
          )
        );
      };

      const buyRandomRoutine = async () => {
        // Unfortunately there's no way to retrieve the random order in which
        // the NFTs were selected so we can only test with quantity 1
        const numNftsToBuy = 1;
        const currentNumNftsInPool = (await pool.getAllHeldIds()).length;

        // Create the transaction and get expected values
        const { tx, expectedRoyalties, quote, protocolFeeAmount } =
          await prepareQuoteValues(
            "buy",
            pool,
            spotPrice,
            delta,
            props,
            fee,
            protocolFee,
            royaltyNumerator,
            trader,
            numNftsToBuy,
            currentNumNftsInPool - initialNftsInPool
          );

        // Record the transaction
        allTransactions.push(tx);

        // Maintain the main value changes
        let royaltyPaid = constants.Zero;

        // Maintain royalties due
        for (let i = 0; i < numNftsToBuy; i++) {
          const recipient = royaltyRecipientFallback.address;
          const amount = ethers.utils.parseEther(
            expectedRoyalties[i].toFixed(18)
          );
          royaltyPaid = royaltyPaid.add(amount);

          const oldValue =
            royaltiesBookkept.get(recipient) ?? ethers.BigNumber.from("0");
          royaltiesBookkept.set(recipient, oldValue.add(amount));
        }

        const oldTraderAmount =
          expectedBalanceChanges.get(trader.address) ??
          ethers.BigNumber.from("0");
        expectedBalanceChanges.set(
          trader.address,
          oldTraderAmount.add(quote.mul(-1))
        );
        const oldPoolAmount =
          expectedBalanceChanges.get(pool.address) ??
          ethers.BigNumber.from("0");
        expectedBalanceChanges.set(
          pool.address,
          oldPoolAmount.add(quote.sub(royaltyPaid).sub(protocolFeeAmount))
        );
      };

      const buySpecificRoutine = async () => {
        // Select a random number of NFTs to buy
        const nftsInPool = await pool.getAllHeldIds();
        const numNftsToBuy = getRandomInt(1, nftsInPool.length);
        const nftsToBuy = pickRandomElements(nftsInPool, numNftsToBuy);
        const currentNumNftsInPool = (await pool.getAllHeldIds()).length;

        // Create the transaction and get expected values
        const { tx, expectedRoyalties, quote, protocolFeeAmount } =
          await prepareQuoteValues(
            "buy",
            pool,
            spotPrice,
            delta,
            props,
            fee,
            protocolFee,
            royaltyNumerator,
            trader,
            nftsToBuy,
            currentNumNftsInPool - initialNftsInPool
          );

        // Record the transaction
        allTransactions.push(tx);

        // Maintain the main value changes
        let royaltyPaid = constants.Zero;

        // Maintain royalties due
        for (let i = 0; i < nftsToBuy.length; i++) {
          const recipient = royaltyRecipientFallback.address;
          const amount = ethers.utils.parseEther(
            expectedRoyalties[i].toFixed(18)
          );

          royaltyPaid = royaltyPaid.add(amount);

          const oldValue =
            royaltiesBookkept.get(recipient) ?? ethers.BigNumber.from("0");
          royaltiesBookkept.set(recipient, oldValue.add(amount));
        }

        const oldTraderAmount =
          expectedBalanceChanges.get(trader.address) ??
          ethers.BigNumber.from("0");
        expectedBalanceChanges.set(
          trader.address,
          oldTraderAmount.add(quote.mul(-1))
        );
        const oldPoolAmount =
          expectedBalanceChanges.get(pool.address) ??
          ethers.BigNumber.from("0");
        expectedBalanceChanges.set(
          pool.address,
          oldPoolAmount.add(quote.sub(royaltyPaid).sub(protocolFeeAmount))
        );
      };

      // For loop to pick a random buy or sell function, random amount/id set,
      // update the change in tokenIds in pool, and maintain the royalties due.
      const ACTIONS = [
        // Double weight to sell routine so average number in pool is stable
        sellRoutine,
        sellRoutine,
        buyRandomRoutine,
        buySpecificRoutine,
      ];
      let i = 0;
      while (i < NUM_ITERS) {
        const routine = pickRandomElements(ACTIONS, 1)[0];
        const numNftsInPool = (await pool.getAllHeldIds()).length;
        if (
          [buyRandomRoutine, buySpecificRoutine].includes(routine) &&
          numNftsInPool === 0
        ) {
          // Not possible to buy cause pool is empty
          continue;
        }

        if (
          routine === sellRoutine &&
          (await nft.balanceOf(trader.address)).eq(ethers.BigNumber.from("0"))
        ) {
          // Not possible to sell cause trader has no nfts
          continue;
        }

        await routine();
        await checkState(i);
        i++;
      }

      await testRoyaltyWithdrawals(factory, pool, royaltiesBookkept);
    });
  });

  describe("RoyaltyNumerator updates", function () {
    it("Should revert if called by non-owner", async function () {
      const {
        recipients,
        otherAccount1,
        collectionPoolETH: pool,
      } = await royaltyWithPoolFixture();

      const unauthorizedAccounts = recipients.concat(otherAccount1);
      const poolOwner = await pool.owner();
      for (const account of unauthorizedAccounts) {
        if (poolOwner === account.address) continue;
        await expect(
          pool.connect(account).changeRoyaltyNumerator(newRoyaltyNumerator)
        ).to.be.revertedWithCustomError(pool, "NotAuthorized");
      }
    });

    it("Should succeed and emit event if called by owner", async function () {
      const { initialOwner, collectionPoolETH: pool } =
        await royaltyWithPoolFixture();

      await expect(
        pool.connect(initialOwner).changeRoyaltyNumerator(newRoyaltyNumerator)
      )
        .to.emit(pool, "RoyaltyNumeratorUpdate")
        .withArgs(newRoyaltyNumerator);
    });

    it("Should result in new royalty amounts being sent after update", async function () {
      const {
        initialOwner,
        collectionPoolETH: pool,
        nft2981: nft,
        otherAccount1: trader,
        fee,
        protocolFee,
        traderNfts,
        collectionPoolFactory: factory,
      } = await royaltyWithPoolFixture();

      await pool
        .connect(initialOwner)
        .changeRoyaltyNumerator(newRoyaltyNumerator);

      const specificTokenIds = traderNfts[0];

      const { spotPrice, delta, props } = await pool.curveParams();
      const { tx, quote, protocolFeeAmount, totalRoyalties } =
        await prepareQuoteValues(
          "sell",
          pool,
          spotPrice,
          delta,
          props,
          fee,
          protocolFee,
          newRoyaltyNumerator,
          trader,
          [specificTokenIds],
          0
        );

      const royaltyPaid = ethers.utils.parseEther(totalRoyalties.toFixed(18));
      const amountsDue = new Map<string, BigNumber>();
      let recipient = (await nft.royaltyInfo(specificTokenIds, 0))[0];
      if (recipient === ethers.constants.AddressZero.toString()) {
        recipient = pool.address;
      }

      if (recipient !== pool.address) {
        const oldValue =
          amountsDue.get(recipient) ?? ethers.BigNumber.from("0");
        amountsDue.set(recipient, oldValue.add(royaltyPaid));
      }

      const addresses: string[] = [trader.address, pool.address];
      const amounts: BigNumber[] = [
        quote,
        quote.mul(-1).sub(royaltyPaid).sub(protocolFeeAmount),
      ];

      expect(await changesEtherBalancesFuzzy(tx, addresses, amounts)).to.be
        .true;
      await testRoyaltyWithdrawals(factory, pool, amountsDue);
    });

    it("Should revert if setting nonzero but no fallback and not ERC2981", async function () {
      const {
        tokenIdsWithoutRoyalty,
        collectionPoolFactory,
        ethPoolParams,
        nftNon2981: nft,
        initialOwner,
      } = await royaltyFixture();

      const collectionPoolETHContractTx =
        await collectionPoolFactory.createPoolETH(
          {
            ...ethPoolParams,
            nft: nft.address,
            royaltyNumerator: ethers.BigNumber.from("0"),
            royaltyRecipientFallback: ethers.constants.AddressZero,
            initialNFTIDs: tokenIdsWithoutRoyalty,
          },
          {
            value: ethers.BigNumber.from(`${5e18}`),
            gasLimit: 1000000,
          }
        );
      const { newPoolAddress } = await getPoolAddress(
        collectionPoolETHContractTx
      );
      const pool = await ethers.getContractAt(
        "CollectionPoolETH",
        newPoolAddress
      );

      await expect(
        pool
          .connect(initialOwner)
          .changeRoyaltyNumerator(ethers.BigNumber.from("1"))
      ).to.be.revertedWithCustomError(pool, "InvalidModification");
    });
  });

  describe("royaltyRecipientFallback updates", function () {
    it("Should revert if called by non-owner", async function () {
      const {
        recipients,
        otherAccount1,
        collectionPoolETH: pool,
      } = await royaltyWithPoolFixture();

      const unauthorizedAccounts = recipients.concat(otherAccount1);
      for (const account of unauthorizedAccounts) {
        await expect(
          pool.connect(account).changeRoyaltyRecipientFallback(account.address)
        ).to.be.revertedWithCustomError(pool, "NotAuthorized");
      }
    });

    it("Should succeed and emit event if called by owner", async function () {
      const {
        initialOwner,
        collectionPoolETH: pool,
        otherAccount1,
      } = await royaltyWithPoolFixture();

      await expect(
        pool
          .connect(initialOwner)
          .changeRoyaltyRecipientFallback(otherAccount1.address)
      )
        .to.emit(pool, "RoyaltyRecipientFallbackUpdate")
        .withArgs(otherAccount1.address);
    });

    it("Should result in royalties being sent to the fallback after update", async function () {
      const {
        initialOwner,
        collectionPoolETH: pool,
        otherAccount1: trader,
        fee,
        protocolFee,
        royaltyNumerator,
        traderNfts,
        nft2981,
        collectionPoolFactory: factory,
      } = await royaltyWithPoolAndFallbackFixture();

      await pool
        .connect(initialOwner)
        .changeRoyaltyRecipientFallback(initialOwner.address);

      const specificTokenIds = traderNfts;

      const { spotPrice, delta, props } = await pool.curveParams();
      const { tx, quote, protocolFeeAmount, expectedRoyalties } =
        await prepareQuoteValues(
          "sell",
          pool,
          spotPrice,
          delta,
          props,
          fee,
          protocolFee,
          royaltyNumerator,
          trader,
          specificTokenIds,
          0
        );

      let royaltyPaid = constants.Zero;
      const amountsDue = new Map<string, BigNumber>();
      for (let index = 0; index < specificTokenIds.length; index++) {
        const tokenId = specificTokenIds[index];
        let recipient = (await nft2981.royaltyInfo(tokenId, 0))[0];
        if (recipient === ethers.constants.AddressZero.toString()) {
          recipient = initialOwner.address;
        }

        if (recipient === pool.address) {
          // If pool is recipient then funds just stay in the pool
          continue;
        }

        const amount = ethers.utils.parseEther(
          expectedRoyalties[index].toFixed(18)
        );
        royaltyPaid = royaltyPaid.add(amount);

        const oldValue =
          amountsDue.get(recipient) ?? ethers.BigNumber.from("0");
        amountsDue.set(recipient, oldValue.add(amount));
      }

      const addresses: string[] = [trader.address, pool.address];
      const amounts: BigNumber[] = [
        quote,
        quote.mul(-1).sub(royaltyPaid).sub(protocolFeeAmount),
      ];

      expect(await changesEtherBalancesFuzzy(tx, addresses, amounts)).to.be
        .true;
      await testRoyaltyWithdrawals(factory, pool, amountsDue);
    });

    it("Should revert if setting recipient fallback to 0 (deleting it) when token is not ERC2981 and has nonzero numerator", async function () {
      const {
        tokenIdsWithoutRoyalty,
        collectionPoolFactory,
        ethPoolParams,
        nftNon2981: nft,
        initialOwner,
        otherAccount1: trader,
      } = await royaltyFixture();

      const collectionPoolETHContractTx =
        await collectionPoolFactory.createPoolETH(
          {
            ...ethPoolParams,
            nft: nft.address,
            royaltyNumerator: ethers.BigNumber.from("1"),
            royaltyRecipientFallback: trader.address,
            initialNFTIDs: tokenIdsWithoutRoyalty,
          },
          {
            value: ethers.BigNumber.from(`${5e18}`),
            gasLimit: 1000000,
          }
        );
      const { newPoolAddress } = await getPoolAddress(
        collectionPoolETHContractTx
      );
      const pool = await ethers.getContractAt(
        "CollectionPoolETH",
        newPoolAddress
      );

      await expect(
        pool
          .connect(initialOwner)
          .changeRoyaltyRecipientFallback(ethers.constants.AddressZero)
      ).to.be.revertedWithCustomError(pool, "InvalidModification");
    });
  });
});

async function testRoyaltyWithdrawals(
  factory: CollectionPoolFactory,
  pool: CollectionPoolETH,
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
  await factory.withdrawETHProtocolFees();

  // Next, verify that correct amount of royalties are sent out
  await changesEtherBalancesFuzzy(
    await factory.withdrawRoyaltiesMultipleRecipients(
      validRecipientsAndRoyalties.map(([recipient]) => recipient),
      constants.AddressZero
    ),
    recipients,
    amounts
  );

  // Now ensure that recipients can't withdraw more than what's expected
  await changesEtherBalancesFuzzy(
    await factory.withdrawRoyaltiesMultipleRecipients(
      validRecipientsAndRoyalties.map(([recipient]) => recipient),
      constants.AddressZero
    ),
    recipients,
    amounts.map(() => constants.Zero)
  );
}
