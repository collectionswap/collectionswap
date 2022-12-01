import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { getPoolAddress } from "../shared/constants";
import {
  DEFAULT_VALID_ROYALTY,
  royaltyFixture,
  royaltyWithPoolFixture,
} from "../shared/fixtures";
import {
  changesEtherBalancesFuzzy,
  changesEtherBalancesFuzzyMultipleTransactions,
  getRandomInt,
  pickRandomElements,
  prepareQuoteValues,
} from "../shared/helpers";

import type { BigNumber, providers } from "ethers";

const newRoyaltyNumerator = ethers.utils.parseEther("0.5");

describe("Royalties", function () {
  describe("Initializing pool with royaltyNumerator", function () {
    it("Should allow zero royaltyNumerator for non-ERC2981", async function () {
      const {
        ethPoolParams,
        nftNon2981: nft,
        lssvmPairFactory,
        tokenIdsWithoutRoyalty: tokenIds,
      } = await loadFixture(royaltyFixture);

      const lssvmPairETHContractTx = await lssvmPairFactory.createPairETH(
        {
          ...ethPoolParams,
          nft: nft.address,
          royaltyNumerator: ethers.BigNumber.from("0"),
          initialNFTIDs: tokenIds,
        },
        {
          value: ethers.BigNumber.from(`${1.2e18}`),
          gasLimit: 1000000,
        }
      );
      const { newPairAddress } = await getPoolAddress(lssvmPairETHContractTx);
      const lssvmPairETH = await ethers.getContractAt(
        "LSSVMPairETH",
        newPairAddress
      );

      expect(await lssvmPairETH.royaltyNumerator()).to.be.equal("0");
    });

    it("Should allow zero royaltyNumerator for ERC2981", async function () {
      const {
        ethPoolParams,
        nft2981: nft,
        lssvmPairFactory,
        tokenIdsWithRoyalty: tokenIds,
      } = await loadFixture(royaltyFixture);

      const lssvmPairETHContractTx = await lssvmPairFactory.createPairETH(
        {
          ...ethPoolParams,
          nft: nft.address,
          royaltyNumerator: ethers.BigNumber.from("0"),
          initialNFTIDs: tokenIds,
        },
        {
          value: ethers.BigNumber.from(`${1.2e18}`),
          gasLimit: 1000000,
        }
      );
      const { newPairAddress } = await getPoolAddress(lssvmPairETHContractTx);
      const lssvmPairETH = await ethers.getContractAt(
        "LSSVMPairETH",
        newPairAddress
      );

      expect(await lssvmPairETH.royaltyNumerator()).to.be.equal("0");
    });

    it("Should allow nonzero royaltyNumerator for ERC2981", async function () {
      const {
        ethPoolParams,
        nft2981: nft,
        lssvmPairFactory,
        tokenIdsWithRoyalty: tokenIds,
      } = await loadFixture(royaltyFixture);

      const royaltyNumerator = DEFAULT_VALID_ROYALTY;

      const lssvmPairETHContractTx = await lssvmPairFactory.createPairETH(
        {
          ...ethPoolParams,
          nft: nft.address,
          royaltyNumerator,
          initialNFTIDs: tokenIds,
        },
        {
          value: ethers.BigNumber.from(`${1.2e18}`),
          gasLimit: 1000000,
        }
      );
      const { newPairAddress } = await getPoolAddress(lssvmPairETHContractTx);
      const lssvmPairETH = await ethers.getContractAt(
        "LSSVMPairETH",
        newPairAddress
      );

      expect(await lssvmPairETH.royaltyNumerator()).to.be.equal(
        royaltyNumerator
      );
    });

    it("Should revert on nonzero royaltyNumerator for non-ERC2981", async function () {
      const {
        ethPoolParams,
        nftNon2981: nft,
        lssvmPairFactory,
        tokenIdsWithoutRoyalty: tokenIds,
      } = await loadFixture(royaltyFixture);

      const royaltyNumerator = DEFAULT_VALID_ROYALTY;

      expect(
        lssvmPairFactory.createPairETH(
          {
            ...ethPoolParams,
            nft: nft.address,
            royaltyNumerator,
            initialNFTIDs: tokenIds,
          },
          {
            value: ethers.BigNumber.from(`${1.2e18}`),
            gasLimit: 1000000,
          }
        )
      ).to.be.revertedWith("Nonzero royalty for non ERC2981");
    });

    it("Should revert on royaltyNumerator > 1e18 for non-ERC2981", async function () {
      const {
        ethPoolParams,
        nftNon2981: nft,
        lssvmPairFactory,
        tokenIdsWithoutRoyalty: tokenIds,
      } = await loadFixture(royaltyFixture);

      const royaltyNumerator = ethers.utils.parseEther("2");

      expect(
        lssvmPairFactory.createPairETH(
          {
            ...ethPoolParams,
            nft: nft.address,
            royaltyNumerator: ethers.BigNumber.from(royaltyNumerator),
            initialNFTIDs: tokenIds,
          },
          {
            value: ethers.BigNumber.from(`${1.2e18}`),
            gasLimit: 1000000,
          }
        )
      ).to.be.revertedWith(
        // This transaction should fail for 2 reasons actually. Just that the
        // non-ERC2981 reason takes precedence
        "Nonzero royalty for non ERC2981"
      );
    });

    it("Should revert on royaltyNumerator > 1e18 for ERC2981", async function () {
      const {
        ethPoolParams,
        nft2981: nft,
        lssvmPairFactory,
        tokenIdsWithRoyalty: tokenIds,
      } = await loadFixture(royaltyFixture);

      const royaltyNumerator = ethers.utils.parseEther("2");

      expect(
        lssvmPairFactory.createPairETH(
          {
            ...ethPoolParams,
            nft: nft.address,
            royaltyNumerator: ethers.BigNumber.from(royaltyNumerator),
            initialNFTIDs: tokenIds,
          },
          {
            value: ethers.BigNumber.from(`${1.2e18}`),
            gasLimit: 1000000,
          }
        )
      ).to.be.revertedWith("royaltyNumerator must be < 1e18");
    });
  });

  describe("Royalties should be awarded upon swaps", function () {
    it("Should not award royalties when buying 0 items from pool (revert)", async function () {
      const {
        recipients,
        otherAccount1: trader,
        lssvmPairETH,
      } = await loadFixture(royaltyWithPoolFixture);

      const initialBalances = await Promise.all(
        recipients.map(async (recipient) => recipient.getBalance())
      );

      expect(
        lssvmPairETH.swapTokenForSpecificNFTs(
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
        lssvmPairETH,
      } = await loadFixture(royaltyWithPoolFixture);

      const initialBalances = await Promise.all(
        recipients.map(async (recipient) => recipient.getBalance())
      );

      expect(
        lssvmPairETH.swapNFTsForToken(
          [],
          [],
          [],
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

    it("Should award royalties when buying one random item from pool", async function () {
      const {
        nft2981: nft,
        otherAccount1: trader,
        lssvmPairETH: pool,
        fee,
        protocolFee,
        royaltyNumerator,
        enumerateTrader,
        traderNfts,
      } = await loadFixture(royaltyWithPoolFixture);

      const { tx, quote, protocolFeeAmount, totalRoyalties } =
        await prepareQuoteValues(
          "buy",
          pool,
          fee,
          protocolFee,
          royaltyNumerator,
          trader,
          1,
          0
        );

      // Figure out which random NFT the trader bought
      const tradedNft = (await enumerateTrader()).filter(
        (nftId) => !traderNfts.includes(nftId)
      )[0];

      // Calculate the corresponding recipient (only testable for n=1 when
      // buying random nfts)
      const recipient = (await nft.royaltyInfo(tradedNft, 0))[0];
      const royaltyPaid = ethers.utils.parseEther(totalRoyalties.toFixed(18));

      expect(
        await changesEtherBalancesFuzzy(
          tx,
          [trader.address, pool.address, recipient],
          [
            quote.mul(-1),
            quote.sub(royaltyPaid).sub(protocolFeeAmount),
            royaltyPaid,
          ]
        )
      ).to.be.true;
    });

    it("Should award royalties when buying one specific item from pool", async function () {
      const {
        nft2981: nft,
        otherAccount1: trader,
        lssvmPairETH: pool,
        fee,
        protocolFee,
        royaltyNumerator,
        tokenIdsWithRoyalty,
      } = await loadFixture(royaltyWithPoolFixture);

      const specificTokenIds = [tokenIdsWithRoyalty[0]];

      const { tx, quote, protocolFeeAmount, totalRoyalties } =
        await prepareQuoteValues(
          "buy",
          pool,
          fee,
          protocolFee,
          royaltyNumerator,
          trader,
          specificTokenIds,
          0
        );

      const recipient = (await nft.royaltyInfo(specificTokenIds[0], 0))[0];
      const royaltyPaid = ethers.utils.parseEther(totalRoyalties.toFixed(18));

      expect(
        await changesEtherBalancesFuzzy(
          tx,
          [trader.address, pool.address, recipient],
          [
            quote.mul(-1),
            quote.sub(royaltyPaid).sub(protocolFeeAmount),
            royaltyPaid,
          ]
        )
      ).to.be.true;
    });

    it("Should award royalties when selling one item to pool", async function () {
      const {
        nft2981: nft,
        otherAccount1: trader,
        lssvmPairETH: pool,
        fee,
        protocolFee,
        royaltyNumerator,
        traderNfts,
      } = await loadFixture(royaltyWithPoolFixture);

      const specificTokenIds = [traderNfts[0]];

      const { tx, quote, protocolFeeAmount, totalRoyalties } =
        await prepareQuoteValues(
          "sell",
          pool,
          fee,
          protocolFee,
          royaltyNumerator,
          trader,
          specificTokenIds,
          0
        );

      const recipient = (await nft.royaltyInfo(specificTokenIds[0], 0))[0];
      const royaltyPaid = ethers.utils.parseEther(totalRoyalties.toFixed(18));

      expect(
        await changesEtherBalancesFuzzy(
          tx,
          [trader.address, pool.address, recipient],
          [
            quote,
            quote.mul(-1).sub(royaltyPaid).sub(protocolFeeAmount),
            royaltyPaid,
          ]
        )
      ).to.be.true;
    });

    it("Should award royalties when buying many random items from pool", async function () {
      const {
        nft2981: nft,
        otherAccount1: trader,
        lssvmPairETH: pool,
        fee,
        protocolFee,
        royaltyNumerator,
        enumerateTrader,
        traderNfts,
      } = await loadFixture(royaltyWithPoolFixture);

      // Specify quantity of random NFTs to buy
      const numSold = 3;

      const {
        tx,
        quote,
        protocolFeeAmount,
        totalRoyalties,
        expectedRoyalties,
      } = await prepareQuoteValues(
        "buy",
        pool,
        fee,
        protocolFee,
        royaltyNumerator,
        trader,
        numSold,
        0
      );

      // Figure out which random NFT the trader bought
      const tradedIds = (await enumerateTrader()).filter(
        (nftId) => !traderNfts.includes(nftId)
      );

      const recipients = await Promise.all(
        tradedIds.map(async (id) => (await nft.royaltyInfo(id, 0))[0])
      );

      const royaltyPaid = ethers.utils.parseEther(totalRoyalties.toFixed(18));

      expect(
        await changesEtherBalancesFuzzy(
          tx,
          [trader.address, pool.address].concat(recipients),
          [quote.mul(-1), quote.sub(royaltyPaid).sub(protocolFeeAmount)].concat(
            expectedRoyalties.map((royalty) =>
              ethers.utils.parseEther(royalty.toFixed(18))
            )
          )
        )
      ).to.be.true;
    });

    it("Should award royalties when buying many specific items from pool", async function () {
      const {
        nft2981: nft,
        otherAccount1: trader,
        lssvmPairETH: pool,
        fee,
        protocolFee,
        royaltyNumerator,
        tokenIdsWithRoyalty,
        enumerateTrader,
        traderNfts,
      } = await loadFixture(royaltyWithPoolFixture);

      // Specify NFTs to buy
      const nftsTraded = tokenIdsWithRoyalty;

      const {
        tx,
        quote,
        protocolFeeAmount,
        totalRoyalties,
        expectedRoyalties,
      } = await prepareQuoteValues(
        "buy",
        pool,
        fee,
        protocolFee,
        royaltyNumerator,
        trader,
        nftsTraded,
        0
      );

      // Figure out which random NFT the trader bought
      const tradedIds = (await enumerateTrader()).filter(
        (nftId) => !traderNfts.includes(nftId)
      );

      const royaltiesDue = new Map<string, BigNumber>();
      for (let index = 0; index < tradedIds.length; index++) {
        const tokenId = tradedIds[index];
        const recipient = (await nft.royaltyInfo(tokenId, 0))[0];
        const oldVal =
          royaltiesDue.get(recipient) ?? ethers.BigNumber.from("0");
        royaltiesDue.set(
          recipient,
          oldVal.add(
            ethers.utils.parseEther(expectedRoyalties[index].toFixed(18))
          )
        );
      }

      const totalRoyaltyPaid = ethers.utils.parseEther(
        totalRoyalties.toFixed(18)
      );

      const recipients: string[] = [];
      const amounts: BigNumber[] = [];
      royaltiesDue.forEach((amount, recipient) => {
        recipients.push(recipient);
        amounts.push(amount);
      });

      expect(
        await changesEtherBalancesFuzzy(
          tx,
          [trader.address, pool.address].concat(recipients),
          [
            quote.mul(-1),
            quote.sub(totalRoyaltyPaid).sub(protocolFeeAmount),
          ].concat(amounts)
        )
      ).to.be.true;
    });

    it("Should award royalties when selling many items to pool", async function () {
      const {
        nft2981: nft,
        otherAccount1: trader,
        lssvmPairETH: pool,
        fee,
        protocolFee,
        royaltyNumerator,
        traderNfts,
      } = await loadFixture(royaltyWithPoolFixture);

      // Specify NFTs to buy
      const nftsTraded = traderNfts;

      const {
        tx,
        quote,
        protocolFeeAmount,
        totalRoyalties,
        expectedRoyalties,
      } = await prepareQuoteValues(
        "sell",
        pool,
        fee,
        protocolFee,
        royaltyNumerator,
        trader,
        nftsTraded,
        0
      );

      const recipients = await Promise.all(
        traderNfts.map(async (id) => (await nft.royaltyInfo(id, 0))[0])
      );

      const royaltyPaid = ethers.utils.parseEther(totalRoyalties.toFixed(18));

      expect(
        await changesEtherBalancesFuzzy(
          tx,
          [trader.address, pool.address].concat(recipients),
          [quote, quote.mul(-1).sub(royaltyPaid).sub(protocolFeeAmount)].concat(
            expectedRoyalties.map((royalty) =>
              ethers.utils.parseEther(royalty.toFixed(18))
            )
          )
        )
      ).to.be.true;
    });

    it("Should award royalties when repeatedly buying and selling multiple items", async function () {
      const {
        nft2981: nft,
        otherAccount1: trader,
        lssvmPairETH: pool,
        fee,
        protocolFee,
        royaltyNumerator,
        enumerateTrader,
      } = await loadFixture(royaltyWithPoolFixture);

      const initialNftsInPool = (await pool.getAllHeldIds()).length;
      const royaltiesDue = new Map<string, BigNumber>();
      const allTransactions:
        | providers.TransactionResponse[]
        | Promise<providers.TransactionResponse[]> = [];
      const NUM_ITERS = 15;

      const checkState = async (iteration: number) => {
        console.log(
          `Checking royalties are awarded correctly after interaction #${iteration} (0-indexed)`
        );
        const recipients: string[] = [];
        const amounts: BigNumber[] = [];

        Array.from(royaltiesDue).forEach(([address, amount]) => {
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
        const { tx, expectedRoyalties } = await prepareQuoteValues(
          "sell",
          pool,
          fee,
          protocolFee,
          royaltyNumerator,
          trader,
          nftsToSell,
          currentNumNftsInPool - initialNftsInPool
        );

        // Record the transaction
        allTransactions.push(tx);

        // Maintain royalties due
        for (let i = 0; i < nftsToSell.length; i++) {
          const nftSold = nftsToSell[i];
          const recipient = (await nft.royaltyInfo(nftSold, 0))[0];
          const amount = ethers.utils.parseEther(
            expectedRoyalties[i].toFixed(18)
          );

          const oldValue =
            royaltiesDue.get(recipient) ?? ethers.BigNumber.from("0");
          royaltiesDue.set(recipient, oldValue.add(amount));
        }
      };

      const buyRandomRoutine = async () => {
        // Unfortunately there's no way to retrieve the random order in which
        // the NFTs were selected so we can only test with quantity 1
        const numNftsToBuy = 1;
        const traderInitialNfts = await enumerateTrader();
        const currentNumNftsInPool = (await pool.getAllHeldIds()).length;

        // Create the transaction and get expected values
        const { tx, expectedRoyalties } = await prepareQuoteValues(
          "buy",
          pool,
          fee,
          protocolFee,
          royaltyNumerator,
          trader,
          numNftsToBuy,
          currentNumNftsInPool - initialNftsInPool
        );

        // Record the transaction
        allTransactions.push(tx);

        // Maintain royalties due
        for (let i = 0; i < numNftsToBuy; i++) {
          const nftSold = (await enumerateTrader()).filter(
            (id) => !traderInitialNfts.includes(id)
          )[0];
          const recipient = (await nft.royaltyInfo(nftSold, 0))[0];
          const amount = ethers.utils.parseEther(
            expectedRoyalties[i].toFixed(18)
          );

          const oldValue =
            royaltiesDue.get(recipient) ?? ethers.BigNumber.from("0");
          royaltiesDue.set(recipient, oldValue.add(amount));
        }
      };

      const buySpecificRoutine = async () => {
        // Select a random number of NFTs to buy
        const nftsInPool = await pool.getAllHeldIds();
        const numNftsToBuy = getRandomInt(1, nftsInPool.length);
        const nftsToBuy = pickRandomElements(nftsInPool, numNftsToBuy);
        const currentNumNftsInPool = (await pool.getAllHeldIds()).length;

        // Create the transaction and get expected values
        const { tx, expectedRoyalties } = await prepareQuoteValues(
          "buy",
          pool,
          fee,
          protocolFee,
          royaltyNumerator,
          trader,
          nftsToBuy,
          currentNumNftsInPool - initialNftsInPool
        );

        // Record the transaction
        allTransactions.push(tx);

        // Maintain royalties due
        for (let i = 0; i < nftsToBuy.length; i++) {
          const nftSold = nftsToBuy[i];
          const recipient = (await nft.royaltyInfo(nftSold, 0))[0];
          const amount = ethers.utils.parseEther(
            expectedRoyalties[i].toFixed(18)
          );

          const oldValue =
            royaltiesDue.get(recipient) ?? ethers.BigNumber.from("0");
          royaltiesDue.set(recipient, oldValue.add(amount));
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
        lssvmPairETH: pool,
      } = await loadFixture(royaltyWithPoolFixture);

      const unauthorizedAccounts = recipients.concat(otherAccount1);
      for (const account of unauthorizedAccounts) {
        await expect(
          pool.connect(account).changeRoyaltyNumerator(newRoyaltyNumerator)
        ).to.be.revertedWith("Not approved");
      }
    });

    it("Should succeed and emit event if called by owner", async function () {
      const { initialOwner, lssvmPairETH: pool } = await loadFixture(
        royaltyWithPoolFixture
      );

      await expect(
        pool.connect(initialOwner).changeRoyaltyNumerator(newRoyaltyNumerator)
      )
        .to.emit(pool, "RoyaltyNumeratorUpdate")
        .withArgs(newRoyaltyNumerator);
    });

    it("Should result in new royalty amounts being sent after update", async function () {
      const {
        initialOwner,
        lssvmPairETH: pool,
        nft2981: nft,
        otherAccount1: trader,
        fee,
        protocolFee,
        traderNfts,
      } = await loadFixture(royaltyWithPoolFixture);

      await pool
        .connect(initialOwner)
        .changeRoyaltyNumerator(newRoyaltyNumerator);

      const specificTokenIds = traderNfts[0];

      const { tx, quote, protocolFeeAmount, totalRoyalties } =
        await prepareQuoteValues(
          "sell",
          pool,
          fee,
          protocolFee,
          newRoyaltyNumerator,
          trader,
          [specificTokenIds],
          0
        );

      const recipient = (await nft.royaltyInfo(specificTokenIds, 0))[0];
      const royaltyPaid = ethers.utils.parseEther(totalRoyalties.toFixed(18));
      expect(
        await changesEtherBalancesFuzzy(
          tx,
          [trader.address, pool.address, recipient],
          [
            quote,
            quote.mul(-1).sub(royaltyPaid).sub(protocolFeeAmount),
            royaltyPaid,
          ]
        )
      ).to.be.true;
    });
  });
});
