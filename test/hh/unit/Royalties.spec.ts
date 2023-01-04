import { expect } from "chai";
import { ethers } from "hardhat";

import {
  royaltyFixture,
  royaltyWithPoolFixture,
  royaltyWithPoolAndFallbackFixture,
} from "../shared/fixtures";
import {
  changesEtherBalancesFuzzy,
  changesEtherBalancesFuzzyMultipleTransactions,
  enumerateAddress,
  getNftTransfersTo,
  getPoolAddress,
  getRandomInt,
  mintRandomNfts,
  pickRandomElements,
  prepareQuoteValues,
} from "../shared/helpers";

import type { BigNumber, providers } from "ethers";

const newRoyaltyNumerator = ethers.utils.parseEther("0.5");

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
      ).to.be.revertedWith("Must ask for > 0 NFTs");

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
          ethers.constants.AddressZero
        )
      ).to.be.revertedWith("Must ask for > 0 NFTs");

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
      } = await royaltyWithPoolFixture();

      // Specify quantity of random NFTs to buy
      const numBought = 4;

      const { spotPrice, delta, props } = await pool.curveParams();
      const {
        tx,
        quote,
        protocolFeeAmount,
        totalRoyalties,
        expectedRoyalties,
      } = await prepareQuoteValues(
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

      const royaltyPaid = ethers.utils.parseEther(totalRoyalties.toFixed(18));
      const amountsDue = new Map<string, BigNumber>();
      amountsDue.set(trader.address, quote.mul(-1));
      amountsDue.set(
        pool.address,
        quote.sub(royaltyPaid).sub(protocolFeeAmount)
      );

      for (let index = 0; index < tradedIds.length; index++) {
        const tokenId = tradedIds[index];
        let recipient = (await nft.royaltyInfo(tokenId, 0))[0];
        if (recipient === ethers.constants.AddressZero.toString()) {
          recipient = pool.address;
        }

        const oldDue = amountsDue.get(recipient) ?? ethers.BigNumber.from("0");
        amountsDue.set(
          recipient,
          oldDue.add(
            ethers.utils.parseEther(expectedRoyalties[index].toFixed(18))
          )
        );
      }

      const addresses: string[] = [];
      const changes: BigNumber[] = [];
      amountsDue.forEach((change, address) => {
        addresses.push(address);
        changes.push(change);
      });

      expect(await changesEtherBalancesFuzzy(tx, addresses, changes)).to.be
        .true;
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
      } = await royaltyWithPoolFixture();

      // Specify NFTs to buy
      const nftsTraded = tokenIdsWithRoyalty;

      const { spotPrice, delta, props } = await pool.curveParams();
      const {
        tx,
        quote,
        protocolFeeAmount,
        totalRoyalties,
        expectedRoyalties,
      } = await prepareQuoteValues(
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

      const royaltyPaid = ethers.utils.parseEther(totalRoyalties.toFixed(18));
      const amountsDue = new Map<string, BigNumber>();
      amountsDue.set(trader.address, quote.mul(-1));
      amountsDue.set(
        pool.address,
        quote.sub(royaltyPaid).sub(protocolFeeAmount)
      );

      for (let index = 0; index < tradedIds.length; index++) {
        const tokenId = tradedIds[index];
        let recipient = (await nft.royaltyInfo(tokenId, 0))[0];
        if (recipient === ethers.constants.AddressZero.toString()) {
          recipient = pool.address;
        }

        const oldDue = amountsDue.get(recipient) ?? ethers.BigNumber.from("0");
        amountsDue.set(
          recipient,
          oldDue.add(
            ethers.utils.parseEther(expectedRoyalties[index].toFixed(18))
          )
        );
      }

      const addresses: string[] = [];
      const changes: BigNumber[] = [];
      amountsDue.forEach((change, address) => {
        addresses.push(address);
        changes.push(change);
      });

      expect(await changesEtherBalancesFuzzy(tx, addresses, changes)).to.be
        .true;
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
      } = await royaltyWithPoolFixture();

      // Specify NFTs to buy
      const nftsTraded = traderNfts;

      const { spotPrice, delta, props } = await pool.curveParams();
      const {
        tx,
        quote,
        protocolFeeAmount,
        totalRoyalties,
        expectedRoyalties,
      } = await prepareQuoteValues(
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

      const royaltyPaid = ethers.utils.parseEther(totalRoyalties.toFixed(18));
      const amountsDue = new Map<string, BigNumber>();
      amountsDue.set(trader.address, quote);
      amountsDue.set(
        pool.address,
        quote.mul(-1).sub(royaltyPaid).sub(protocolFeeAmount)
      );

      for (let index = 0; index < traderNfts.length; index++) {
        const tokenId = traderNfts[index];
        let recipient = (await nft.royaltyInfo(tokenId, 0))[0];
        if (recipient === ethers.constants.AddressZero.toString()) {
          recipient = pool.address;
        }

        const oldDue = amountsDue.get(recipient) ?? ethers.BigNumber.from("0");
        amountsDue.set(
          recipient,
          oldDue.add(
            ethers.utils.parseEther(expectedRoyalties[index].toFixed(18))
          )
        );
      }

      const addresses: string[] = [];
      const changes: BigNumber[] = [];
      amountsDue.forEach((change, address) => {
        addresses.push(address);
        changes.push(change);
      });

      expect(await changesEtherBalancesFuzzy(tx, addresses, changes)).to.be
        .true;
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
      } = await royaltyWithPoolFixture();

      const initialNftsInPool = (await pool.getAllHeldIds()).length;
      const amountsDue = new Map<string, BigNumber>();
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

        Array.from(amountsDue).forEach(([address, amount]) => {
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
      };

      const sellRoutine = async () => {
        // Select a random number of NFTs to sell
        const nftsHeld = await enumerateTrader();
        const numNftsToSell = getRandomInt(1, nftsHeld.length);
        const nftsToSell = pickRandomElements(nftsHeld, numNftsToSell);
        const currentNumNftsInPool = (await pool.getAllHeldIds()).length;

        // Create the transaction and get expected values
        const {
          tx,
          expectedRoyalties,
          quote,
          totalRoyalties,
          protocolFeeAmount,
        } = await prepareQuoteValues(
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
        const royaltyPaid = ethers.utils.parseEther(totalRoyalties.toFixed(18));
        const oldTraderAmount =
          amountsDue.get(trader.address) ?? ethers.BigNumber.from("0");
        amountsDue.set(trader.address, oldTraderAmount.add(quote));
        const oldPoolAmount =
          amountsDue.get(pool.address) ?? ethers.BigNumber.from("0");
        amountsDue.set(
          pool.address,
          oldPoolAmount.add(
            quote.mul(-1).sub(royaltyPaid).sub(protocolFeeAmount)
          )
        );

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

          const oldValue =
            amountsDue.get(recipient) ?? ethers.BigNumber.from("0");
          amountsDue.set(recipient, oldValue.add(amount));
        }
      };

      const buyRandomRoutine = async () => {
        // Unfortunately there's no way to retrieve the random order in which
        // the NFTs were selected so we can only test with quantity 1
        const numNftsToBuy = 1;
        const currentNumNftsInPool = (await pool.getAllHeldIds()).length;

        // Create the transaction and get expected values
        const {
          tx,
          expectedRoyalties,
          quote,
          totalRoyalties,
          protocolFeeAmount,
        } = await prepareQuoteValues(
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
        const royaltyPaid = ethers.utils.parseEther(totalRoyalties.toFixed(18));
        const oldTraderAmount =
          amountsDue.get(trader.address) ?? ethers.BigNumber.from("0");
        amountsDue.set(trader.address, oldTraderAmount.add(quote.mul(-1)));
        const oldPoolAmount =
          amountsDue.get(pool.address) ?? ethers.BigNumber.from("0");
        amountsDue.set(
          pool.address,
          oldPoolAmount.add(quote.sub(royaltyPaid).sub(protocolFeeAmount))
        );

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

          const oldValue =
            amountsDue.get(recipient) ?? ethers.BigNumber.from("0");
          amountsDue.set(recipient, oldValue.add(amount));
        }
      };

      const buySpecificRoutine = async () => {
        // Select a random number of NFTs to buy
        const nftsInPool = await pool.getAllHeldIds();
        const numNftsToBuy = getRandomInt(1, nftsInPool.length);
        const nftsToBuy = pickRandomElements(nftsInPool, numNftsToBuy);
        const currentNumNftsInPool = (await pool.getAllHeldIds()).length;

        // Create the transaction and get expected values
        const {
          tx,
          expectedRoyalties,
          quote,
          totalRoyalties,
          protocolFeeAmount,
        } = await prepareQuoteValues(
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
        const royaltyPaid = ethers.utils.parseEther(totalRoyalties.toFixed(18));
        const oldTraderAmount =
          amountsDue.get(trader.address) ?? ethers.BigNumber.from("0");
        amountsDue.set(trader.address, oldTraderAmount.add(quote.mul(-1)));
        const oldPoolAmount =
          amountsDue.get(pool.address) ?? ethers.BigNumber.from("0");
        amountsDue.set(
          pool.address,
          oldPoolAmount.add(quote.sub(royaltyPaid).sub(protocolFeeAmount))
        );

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

          const oldValue =
            amountsDue.get(recipient) ?? ethers.BigNumber.from("0");
          amountsDue.set(recipient, oldValue.add(amount));
        }
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
      } = await royaltyWithPoolAndFallbackFixture();

      const initialNftsInPool = (await pool.getAllHeldIds()).length;
      const amountsDue = new Map<string, BigNumber>();
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

        Array.from(amountsDue).forEach(([address, amount]) => {
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
      };

      const sellRoutine = async () => {
        // Select a random number of NFTs to sell
        const nftsHeld = await enumerateAddress(nft, trader.address);
        const numNftsToSell = getRandomInt(1, nftsHeld.length);
        const nftsToSell = pickRandomElements(nftsHeld, numNftsToSell);
        const currentNumNftsInPool = (await pool.getAllHeldIds()).length;

        // Create the transaction and get expected values
        const {
          tx,
          expectedRoyalties,
          quote,
          totalRoyalties,
          protocolFeeAmount,
        } = await prepareQuoteValues(
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
        const royaltyPaid = ethers.utils.parseEther(totalRoyalties.toFixed(18));
        const oldTraderAmount =
          amountsDue.get(trader.address) ?? ethers.BigNumber.from("0");
        amountsDue.set(trader.address, oldTraderAmount.add(quote));
        const oldPoolAmount =
          amountsDue.get(pool.address) ?? ethers.BigNumber.from("0");
        amountsDue.set(
          pool.address,
          oldPoolAmount.add(
            quote.mul(-1).sub(royaltyPaid).sub(protocolFeeAmount)
          )
        );

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

          const oldValue =
            amountsDue.get(recipient) ?? ethers.BigNumber.from("0");
          amountsDue.set(recipient, oldValue.add(amount));
        }
      };

      const buyRandomRoutine = async () => {
        // Unfortunately there's no way to retrieve the random order in which
        // the NFTs were selected so we can only test with quantity 1
        const numNftsToBuy = 1;
        const traderInitialNfts = await enumerateAddress(nft, trader.address);
        const currentNumNftsInPool = (await pool.getAllHeldIds()).length;

        // Create the transaction and get expected values
        const {
          tx,
          expectedRoyalties,
          quote,
          totalRoyalties,
          protocolFeeAmount,
        } = await prepareQuoteValues(
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
        const royaltyPaid = ethers.utils.parseEther(totalRoyalties.toFixed(18));
        const oldTraderAmount =
          amountsDue.get(trader.address) ?? ethers.BigNumber.from("0");
        amountsDue.set(trader.address, oldTraderAmount.add(quote.mul(-1)));
        const oldPoolAmount =
          amountsDue.get(pool.address) ?? ethers.BigNumber.from("0");
        amountsDue.set(
          pool.address,
          oldPoolAmount.add(quote.sub(royaltyPaid).sub(protocolFeeAmount))
        );

        // Maintain royalties due
        for (let i = 0; i < numNftsToBuy; i++) {
          const nftSold = (await enumerateAddress(nft, trader.address)).filter(
            (id) => !traderInitialNfts.includes(id)
          )[0];
          let recipient = (await nft.royaltyInfo(nftSold, 0))[0];
          if (recipient === ethers.constants.AddressZero.toString()) {
            recipient = royaltyRecipientFallback.address;
          }

          const amount = ethers.utils.parseEther(
            expectedRoyalties[i].toFixed(18)
          );

          const oldValue =
            amountsDue.get(recipient) ?? ethers.BigNumber.from("0");
          amountsDue.set(recipient, oldValue.add(amount));
        }
      };

      const buySpecificRoutine = async () => {
        // Select a random number of NFTs to buy
        const nftsInPool = await pool.getAllHeldIds();
        const numNftsToBuy = getRandomInt(1, nftsInPool.length);
        const nftsToBuy = pickRandomElements(nftsInPool, numNftsToBuy);
        const currentNumNftsInPool = (await pool.getAllHeldIds()).length;

        // Create the transaction and get expected values
        const {
          tx,
          expectedRoyalties,
          quote,
          totalRoyalties,
          protocolFeeAmount,
        } = await prepareQuoteValues(
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
        const royaltyPaid = ethers.utils.parseEther(totalRoyalties.toFixed(18));
        const oldTraderAmount =
          amountsDue.get(trader.address) ?? ethers.BigNumber.from("0");
        amountsDue.set(trader.address, oldTraderAmount.add(quote.mul(-1)));
        const oldPoolAmount =
          amountsDue.get(pool.address) ?? ethers.BigNumber.from("0");
        amountsDue.set(
          pool.address,
          oldPoolAmount.add(quote.sub(royaltyPaid).sub(protocolFeeAmount))
        );

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

          const oldValue =
            amountsDue.get(recipient) ?? ethers.BigNumber.from("0");
          amountsDue.set(recipient, oldValue.add(amount));
        }
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

      // Give the trader some nfts so both directions can be tested
      await mintRandomNfts(nft as unknown as any, trader.address, 4);

      // Approve all for trading with the pool
      await nft.connect(trader).setApprovalForAll(pool.address, true);

      const initialNftsInPool = (await pool.getAllHeldIds()).length;
      const amountsDue = new Map<string, BigNumber>();
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

        Array.from(amountsDue).forEach(([address, amount]) => {
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
      };

      const sellRoutine = async () => {
        // Select a random number of NFTs to sell
        const nftsHeld = await enumerateAddress(nft, trader.address);
        const numNftsToSell = getRandomInt(1, nftsHeld.length);
        const nftsToSell = pickRandomElements(nftsHeld, numNftsToSell);
        const currentNumNftsInPool = (await pool.getAllHeldIds()).length;

        // Create the transaction and get expected values
        const {
          tx,
          expectedRoyalties,
          quote,
          totalRoyalties,
          protocolFeeAmount,
        } = await prepareQuoteValues(
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
        const royaltyPaid = ethers.utils.parseEther(totalRoyalties.toFixed(18));
        const oldTraderAmount =
          amountsDue.get(trader.address) ?? ethers.BigNumber.from("0");
        amountsDue.set(trader.address, oldTraderAmount.add(quote));
        const oldPoolAmount =
          amountsDue.get(pool.address) ?? ethers.BigNumber.from("0");
        amountsDue.set(
          pool.address,
          oldPoolAmount.add(
            quote.mul(-1).sub(royaltyPaid).sub(protocolFeeAmount)
          )
        );

        // Maintain royalties due
        for (let i = 0; i < nftsToSell.length; i++) {
          const recipient = royaltyRecipientFallback.address;
          const amount = ethers.utils.parseEther(
            expectedRoyalties[i].toFixed(18)
          );

          const oldValue =
            amountsDue.get(recipient) ?? ethers.BigNumber.from("0");
          amountsDue.set(recipient, oldValue.add(amount));
        }
      };

      const buyRandomRoutine = async () => {
        // Unfortunately there's no way to retrieve the random order in which
        // the NFTs were selected so we can only test with quantity 1
        const numNftsToBuy = 1;
        const currentNumNftsInPool = (await pool.getAllHeldIds()).length;

        // Create the transaction and get expected values
        const {
          tx,
          expectedRoyalties,
          quote,
          totalRoyalties,
          protocolFeeAmount,
        } = await prepareQuoteValues(
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
        const royaltyPaid = ethers.utils.parseEther(totalRoyalties.toFixed(18));
        const oldTraderAmount =
          amountsDue.get(trader.address) ?? ethers.BigNumber.from("0");
        amountsDue.set(trader.address, oldTraderAmount.add(quote.mul(-1)));
        const oldPoolAmount =
          amountsDue.get(pool.address) ?? ethers.BigNumber.from("0");
        amountsDue.set(
          pool.address,
          oldPoolAmount.add(quote.sub(royaltyPaid).sub(protocolFeeAmount))
        );

        // Maintain royalties due
        for (let i = 0; i < numNftsToBuy; i++) {
          const recipient = royaltyRecipientFallback.address;
          const amount = ethers.utils.parseEther(
            expectedRoyalties[i].toFixed(18)
          );

          const oldValue =
            amountsDue.get(recipient) ?? ethers.BigNumber.from("0");
          amountsDue.set(recipient, oldValue.add(amount));
        }
      };

      const buySpecificRoutine = async () => {
        // Select a random number of NFTs to buy
        const nftsInPool = await pool.getAllHeldIds();
        const numNftsToBuy = getRandomInt(1, nftsInPool.length);
        const nftsToBuy = pickRandomElements(nftsInPool, numNftsToBuy);
        const currentNumNftsInPool = (await pool.getAllHeldIds()).length;

        // Create the transaction and get expected values
        const {
          tx,
          expectedRoyalties,
          quote,
          totalRoyalties,
          protocolFeeAmount,
        } = await prepareQuoteValues(
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
        const royaltyPaid = ethers.utils.parseEther(totalRoyalties.toFixed(18));
        const oldTraderAmount =
          amountsDue.get(trader.address) ?? ethers.BigNumber.from("0");
        amountsDue.set(trader.address, oldTraderAmount.add(quote.mul(-1)));
        const oldPoolAmount =
          amountsDue.get(pool.address) ?? ethers.BigNumber.from("0");
        amountsDue.set(
          pool.address,
          oldPoolAmount.add(quote.sub(royaltyPaid).sub(protocolFeeAmount))
        );

        // Maintain royalties due
        for (let i = 0; i < nftsToBuy.length; i++) {
          const recipient = royaltyRecipientFallback.address;
          const amount = ethers.utils.parseEther(
            expectedRoyalties[i].toFixed(18)
          );

          const oldValue =
            amountsDue.get(recipient) ?? ethers.BigNumber.from("0");
          amountsDue.set(recipient, oldValue.add(amount));
        }
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
        ).to.be.revertedWith("not authorized");
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
      amountsDue.set(trader.address, quote);
      amountsDue.set(
        pool.address,
        quote.mul(-1).sub(royaltyPaid).sub(protocolFeeAmount)
      );
      let recipient = (await nft.royaltyInfo(specificTokenIds, 0))[0];
      if (recipient === ethers.constants.AddressZero.toString()) {
        recipient = pool.address;
      }

      const oldValue = amountsDue.get(recipient) ?? ethers.BigNumber.from("0");
      amountsDue.set(recipient, oldValue.add(royaltyPaid));

      const addresses: string[] = [];
      const amounts: BigNumber[] = [];
      amountsDue.forEach((amount, address) => {
        addresses.push(address);
        amounts.push(amount);
      });

      expect(await changesEtherBalancesFuzzy(tx, addresses, amounts)).to.be
        .true;
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
      ).to.be.revertedWith(
        "Invalid royaltyNumerator or royaltyRecipientFallback"
      );
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
        ).to.be.revertedWith("not authorized");
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
      } = await royaltyWithPoolAndFallbackFixture();

      await pool
        .connect(initialOwner)
        .changeRoyaltyRecipientFallback(initialOwner.address);

      const specificTokenIds = traderNfts;

      const { spotPrice, delta, props } = await pool.curveParams();
      const {
        tx,
        quote,
        protocolFeeAmount,
        totalRoyalties,
        expectedRoyalties,
      } = await prepareQuoteValues(
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

      const royaltyPaid = ethers.utils.parseEther(totalRoyalties.toFixed(18));
      const amountsDue = new Map<string, BigNumber>();
      amountsDue.set(trader.address, quote);
      amountsDue.set(
        pool.address,
        quote.mul(-1).sub(royaltyPaid).sub(protocolFeeAmount)
      );
      for (let index = 0; index < specificTokenIds.length; index++) {
        const tokenId = specificTokenIds[index];
        let recipient = (await nft2981.royaltyInfo(tokenId, 0))[0];
        if (recipient === ethers.constants.AddressZero.toString()) {
          recipient = initialOwner.address;
        }

        const oldValue =
          amountsDue.get(recipient) ?? ethers.BigNumber.from("0");
        amountsDue.set(
          recipient,
          oldValue.add(
            ethers.utils.parseEther(expectedRoyalties[index].toFixed(18))
          )
        );
      }

      const addresses: string[] = [];
      const amounts: BigNumber[] = [];
      amountsDue.forEach((amount, address) => {
        addresses.push(address);
        amounts.push(amount);
      });

      expect(await changesEtherBalancesFuzzy(tx, addresses, amounts)).to.be
        .true;
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
      ).to.be.revertedWith(
        "Invalid royaltyNumerator or royaltyRecipientFallback"
      );
    });
  });
});
