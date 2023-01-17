import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { mintTokensAndApprove } from "../shared/constants";
import { everythingFixture } from "../shared/fixtures";
import {
  buyFromPool,
  calculateAsk,
  calculateBid,
  closeEnough,
  convertToBigNumber,
  cumulativeSum,
  getPoolAddress,
  sellToPool,
} from "../shared/helpers";

import type { ContractTransaction } from "ethers";

const MAX_QTY_TO_QUOTE = 5;
const MAX_DELTA_ITEMS = 3;

console.log(
  `gas: 1m gas at 10 gwei gasPrice at $2000 ETH is ${
    1e6 * 1e1 * 2000 * 1e-9
  } USD`
);

// Async function logGas (tx: ContractTransaction) {
//   console.log((await tx.wait()).cumulativeGasUsed)
// }

// async function checkGas(tx: ContractTransaction) {
//   return (await tx.wait()).cumulativeGasUsed;
// }

// function sqrtBigNumber(value: BigNumber): BigNumber {
//   return ethers.BigNumber.from(
//     Math.trunc(Math.sqrt(parseFloat(ethers.utils.formatEther(value)) * 1e18))
//   );
// }

// function createDirectPoolETHHelper(
//   factory: any,
//   thisAccount: SignerWithAddress,
//   valueToSend: any,
//   ethPoolParams: {
//     nft: any;
//     bondingCurve: any;
//     assetRecipient: any;
//     receiver: any;
//     poolType: any;
//     delta: any;
//     fee: any;
//     spotPrice: any;
//     props: any;
//     state: any;
//     royaltyNumerator: BigNumber;
//     initialNFTIDs: any;
//   },
//   gasLimit = 1500000
// ) {
//   const {
//     nft: nftContractCollection,
//     bondingCurve: curve,
//     delta,
//     fee,
//     spotPrice,
//     props,
//     state,
//     royaltyNumerator,
//     initialNFTIDs: newTokenList,
//   } = ethPoolParams;

//   return factory
//     .connect(thisAccount)
//     .createPoolETH(
//       nftContractCollection,
//       curve,
//       delta,
//       fee,
//       spotPrice,
//       props,
//       state,
//       royaltyNumerator,
//       newTokenList,
//       {
//         value: valueToSend,
//         gasLimit,
//       }
//     );
// }

describe("Collectionswap", function () {
  describe("Direct interactions with AMM", function () {
    it("Should have a spot price", async function () {
      const {
        collectionPoolFactory,
        nftContractCollection,
        initialNFTIDs,
        rawSpot,
        otherAccount0,
        ethPoolParams,
      } = await loadFixture(everythingFixture);
      await mintTokensAndApprove(
        initialNFTIDs,
        nftContractCollection,
        otherAccount0,
        collectionPoolFactory
      );
      const collectionPoolETHContractTx: ContractTransaction =
        await collectionPoolFactory.createPoolETH(
          { ...ethPoolParams, initialNFTIDs },
          {
            value: ethers.BigNumber.from(`${1.2e18}`),
            gasLimit: 1000000,
          }
        );
      const { newPoolAddress } = await getPoolAddress(
        collectionPoolETHContractTx
      );

      const collectionPoolETH = await ethers.getContractAt(
        "CollectionPoolETH",
        newPoolAddress
      );
      const poolSpotPrice = await collectionPoolETH.spotPrice();

      expect(poolSpotPrice).to.equal(convertToBigNumber(rawSpot));
    });

    describe("Pool price quotes", function () {
      for (
        let deltaItemsInPool = -MAX_DELTA_ITEMS;
        deltaItemsInPool <= MAX_DELTA_ITEMS;
        deltaItemsInPool++
      ) {
        for (let qtyQuoted = 1; qtyQuoted <= MAX_QTY_TO_QUOTE; qtyQuoted++) {
          it(`Should have an accurate ask price quote for ${qtyQuoted} items when pool has a net gain of ${deltaItemsInPool} tokens`, async function () {
            const {
              collectionPoolFactory,
              nftContractCollection,
              delta,
              fee,
              spotPrice,
              props,
              bigPctProtocolFee,
              otherAccount0,
              otherAccount5: externalTrader,
              ethPoolParams,
            } = await loadFixture(everythingFixture);
            const nftList = [1, 2, 3, 4, 5];
            await mintTokensAndApprove(
              nftList,
              nftContractCollection,
              otherAccount0,
              collectionPoolFactory
            );
            const collectionPoolETHContractTx: ContractTransaction =
              await collectionPoolFactory.createPoolETH(
                { ...ethPoolParams, initialNFTIDs: nftList },
                {
                  // Value: ethers.BigNumber.from(`${1.2e16}`),
                  value: ethers.BigNumber.from(`${5e18}`),
                  gasLimit: 1000000,
                }
              );
            const { newPoolAddress } = await getPoolAddress(
              collectionPoolETHContractTx
            );
            const collectionPoolETH = await ethers.getContractAt(
              "CollectionPoolETH",
              newPoolAddress
            );

            const externalTraderNfts = [123456, 123457, 123458];
            await mintTokensAndApprove(
              externalTraderNfts,
              nftContractCollection,
              externalTrader,
              collectionPoolFactory
            );

            await nftContractCollection
              .connect(externalTrader)
              .setApprovalForAll(collectionPoolETH.address, true);

            // Start the pool with the right amount of nfts
            if (deltaItemsInPool < 0) {
              for (let k = 0; k < -deltaItemsInPool; k++) {
                await buyFromPool(
                  collectionPoolETH,
                  externalTrader,
                  nftList[k]
                );
              }
            } else if (deltaItemsInPool > 0) {
              for (let k = 0; k < deltaItemsInPool; k++) {
                await sellToPool(
                  collectionPoolETH,
                  externalTrader,
                  externalTraderNfts[k]
                );
              }
            }

            const buyPriceQuote = (
              await collectionPoolETH.getBuyNFTQuote(qtyQuoted)
            )[3];
            const buyPriceQuoteSelfCalc = convertToBigNumber(
              await cumulativeSum(
                calculateAsk,
                deltaItemsInPool,
                qtyQuoted,
                -1, // Number of items in the pool decreases more for each additional qty in an ask
                collectionPoolETH,
                spotPrice,
                delta,
                props,
                fee,
                bigPctProtocolFee,
                ethPoolParams.royaltyNumerator
              )
            );
            expect(closeEnough(buyPriceQuote, buyPriceQuoteSelfCalc)).to.be
              .true;
          });

          it(`Should have an accurate bid price quote for ${qtyQuoted} items when pool has a net gain of ${deltaItemsInPool} tokens`, async function () {
            const {
              collectionPoolFactory,
              nftContractCollection,
              delta,
              fee,
              spotPrice,
              props,
              bigPctProtocolFee,
              otherAccount0,
              otherAccount5: externalTrader,
              ethPoolParams,
            } = await loadFixture(everythingFixture);
            const nftList = [1, 2, 3, 4, 5];
            await mintTokensAndApprove(
              nftList,
              nftContractCollection,
              otherAccount0,
              collectionPoolFactory
            );
            const collectionPoolETHContractTx: ContractTransaction =
              await collectionPoolFactory.createPoolETH(
                { ...ethPoolParams, initialNFTIDs: nftList },
                {
                  // Value: ethers.BigNumber.from(`${1.2e16}`),
                  value: ethers.BigNumber.from(`${5e18}`),
                  gasLimit: 1000000,
                }
              );
            const { newPoolAddress } = await getPoolAddress(
              collectionPoolETHContractTx
            );
            const collectionPoolETH = await ethers.getContractAt(
              "CollectionPoolETH",
              newPoolAddress
            );

            const externalTraderNfts = [123456, 123457, 123458];
            await mintTokensAndApprove(
              externalTraderNfts,
              nftContractCollection,
              externalTrader,
              collectionPoolFactory
            );

            await nftContractCollection
              .connect(externalTrader)
              .setApprovalForAll(collectionPoolETH.address, true);

            // Start the pool with the right amount of nfts
            if (deltaItemsInPool < 0) {
              for (let k = 0; k < -deltaItemsInPool; k++) {
                await buyFromPool(
                  collectionPoolETH,
                  externalTrader,
                  nftList[k]
                );
              }
            } else if (deltaItemsInPool > 0) {
              for (let k = 0; k < deltaItemsInPool; k++) {
                await sellToPool(
                  collectionPoolETH,
                  externalTrader,
                  externalTraderNfts[k]
                );
              }
            }

            const sellPriceQuote = (
              await collectionPoolETH.getSellNFTQuote(qtyQuoted)
            )[3];
            const sellPriceQuoteSelfCalc = convertToBigNumber(
              await cumulativeSum(
                calculateBid,
                deltaItemsInPool,
                qtyQuoted,
                1, // Number of items in the pool increases more for each additional qty in a bid
                collectionPoolETH,
                spotPrice,
                delta,
                props,
                fee,
                bigPctProtocolFee,
                ethPoolParams.royaltyNumerator
              )
            );
            expect(closeEnough(sellPriceQuote, sellPriceQuoteSelfCalc)).to.be
              .true;
          });
        }
      }
    });

    it("Should have errors if value is not enough to bid, AND is sold into", async function () {
      const {
        collectionPoolFactory,
        nftContractCollection,
        initialNFTIDs,
        otherAccount0,
        otherAccount4,
        ethPoolParams,
      } = await loadFixture(everythingFixture);
      await mintTokensAndApprove(
        initialNFTIDs,
        nftContractCollection,
        otherAccount0,
        collectionPoolFactory
      );
      const collectionPoolETHContractTx: ContractTransaction =
        await collectionPoolFactory.createPoolETH(
          { ...ethPoolParams, initialNFTIDs },
          {
            // Value: ethers.BigNumber.from(`${1.2e16}`),
            value: ethers.BigNumber.from(`${1.2e5}`),
            gasLimit: 1000000,
          }
        );
      const { newPoolAddress } = await getPoolAddress(
        collectionPoolETHContractTx
      );
      const collectionPoolETH = await ethers.getContractAt(
        "CollectionPoolETH",
        newPoolAddress
      );

      const externalTrader = otherAccount4;
      const externalTraderNftsIHave = [222];
      const [
        _bidError,
        _bidNewParams,
        _bidTotalAmount,
        bidInputAmount,
        _bidFees,
        _bidnObj,
      ] = await collectionPoolETH.getSellNFTQuote(
        externalTraderNftsIHave.length
      );

      // Console.log([bidError, bidNewSpotPrice, bidNewDelta, bidInputAmount, bidProtocolFee, bidnObj])

      await mintTokensAndApprove(
        externalTraderNftsIHave,
        nftContractCollection,
        otherAccount4,
        collectionPoolETH
      );
      await expect(
        collectionPoolETH.connect(externalTrader).swapNFTsForToken(
          {
            ids: externalTraderNftsIHave,
            proof: [],
            proofFlags: [],
          },
          bidInputAmount,
          externalTrader.address,
          false,
          ethers.constants.AddressZero
        )
      ).to.be.revertedWith("ETH_TRANSFER_FAILED");

      // Can withdraw
      await collectionPoolETH.withdrawAllETH();
      await collectionPoolETH.withdrawERC721(
        nftContractCollection.address,
        initialNFTIDs
      );
    });

    it("Should accrue ETH when repeated bought/sold into", async function () {
      const {
        collectionPoolFactory,
        nftContractCollection,
        otherAccount0,
        otherAccount4,
        ethPoolParams,
      } = await loadFixture(everythingFixture);
      const nftList = [1, 2, 3, 4, 5];
      await mintTokensAndApprove(
        nftList,
        nftContractCollection,
        otherAccount0,
        collectionPoolFactory
      );
      const collectionPoolETHContractTx: ContractTransaction =
        await collectionPoolFactory.createPoolETH(
          { ...ethPoolParams, initialNFTIDs: nftList },
          {
            // Value: ethers.BigNumber.from(`${1.2e16}`),
            value: ethers.BigNumber.from(`${5e18}`),
            gasLimit: 1000000,
          }
        );
      const { newPoolAddress } = await getPoolAddress(
        collectionPoolETHContractTx
      );
      const collectionPoolETH = await ethers.getContractAt(
        "CollectionPoolETH",
        newPoolAddress
      );

      const externalTrader = otherAccount4;
      const externalTraderNftsIHave = [222, 223, 224];
      await mintTokensAndApprove(
        externalTraderNftsIHave,
        nftContractCollection,
        otherAccount4,
        collectionPoolFactory
      );

      let poolBalance = await ethers.provider.getBalance(
        collectionPoolETH.address
      );
      await nftContractCollection
        .connect(externalTrader)
        .setApprovalForAll(collectionPoolETH.address, true);
      for (let i = 0; i < 20; i++) {
        // Sell my NFT into the pool
        const [
          _bidError,
          _bidNewParams,
          _bidTotalAmount,
          bidInputAmount,
          _bidFees,
          _bidnObj,
        ] = await collectionPoolETH.getSellNFTQuote(1);
        // Console.log([bidError, bidNewSpotPrice, bidNewDelta, bidInputAmount, bidProtocolFee, bidnObj])
        await collectionPoolETH.connect(externalTrader).swapNFTsForToken(
          {
            ids: [222],
            proof: [],
            proofFlags: [],
          },
          bidInputAmount,
          externalTrader.address,
          false,
          ethers.constants.AddressZero
        );

        const [
          _askError,
          _askNewParams,
          _askTotalAmount,
          askOutputAmount,
          _askFees,
          _asknObj,
        ] = await collectionPoolETH.getBuyNFTQuote(1);

        await collectionPoolETH
          .connect(externalTrader)
          .swapTokenForSpecificNFTs(
            [222],
            askOutputAmount,
            externalTrader.address,
            false,
            ethers.constants.AddressZero,
            { value: askOutputAmount }
          );

        const newBalance = await ethers.provider.getBalance(
          collectionPoolETH.address
        );
        expect(newBalance.gt(poolBalance)).to.be.true;

        poolBalance = newBalance;
      }
    });

    it("Should revert if trades are attempted in the same timestamp as pool creation", async function () {
      const {
        collectionPoolFactory,
        nftContractCollection,
        otherAccount4,
        ethPoolParams,
      } = await loadFixture(everythingFixture);
      const atomicTraderFactory = await ethers.getContractFactory(
        "TestAtomicTrader"
      );
      const atomicTestTrader = await atomicTraderFactory.deploy(
        collectionPoolFactory.address,
        ethPoolParams.bondingCurve
      );
      const atomicTrader = otherAccount4;
      const externalTraderNftsIHave = [222, 223, 224];
      await mintTokensAndApprove(
        externalTraderNftsIHave,
        nftContractCollection,
        atomicTrader,
        atomicTestTrader
      );

      await expect(
        atomicTestTrader
          .connect(atomicTrader)
          .createAndTrade(
            nftContractCollection.address,
            externalTraderNftsIHave
          )
      ).to.be.revertedWith("Trade blocked");
    });

    it("Should revert if unauthorized users attempt to set the baseURI", async function () {
      const baseURI = "api.collectionswap.xyz";
      const { collectionPoolFactory, otherAccount3, otherAccount4 } =
        await loadFixture(everythingFixture);

      await expect(
        collectionPoolFactory.connect(otherAccount3).setBaseURI(baseURI)
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await expect(
        collectionPoolFactory.connect(otherAccount4).setBaseURI(baseURI)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should have the baseURI set by the owner", async function () {
      const baseURI = "api.collectionswap.xyz";
      const { collectionPoolFactory } = await loadFixture(everythingFixture);

      await collectionPoolFactory.setBaseURI(baseURI);
      expect(await collectionPoolFactory.baseURI()).to.be.equal(baseURI);
    });

    it("Should revert if unauthorized users attempt to set the tokenURI", async function () {
      const tokenURI = "api.collectionswap.xyz/tokenInfo/1";
      const { collectionPoolFactory, otherAccount3, otherAccount4 } =
        await loadFixture(everythingFixture);

      await expect(
        collectionPoolFactory.connect(otherAccount3).setTokenURI(tokenURI, 1)
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await expect(
        collectionPoolFactory.connect(otherAccount4).setTokenURI(tokenURI, 1)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should revert setting the tokenURI if token id has not existed", async function () {
      const tokenURI = "api.collectionswap.xyz/tokenInfo/1";
      const { collectionPoolFactory } = await loadFixture(everythingFixture);

      await expect(
        collectionPoolFactory.setTokenURI(tokenURI, 1)
      ).to.be.revertedWith("ERC721URIStorage: URI set of nonexistent token");
    });

    it("Should return an empty string if baseURI has not been set", async function () {
      const {
        collectionPoolFactory,
        nftContractCollection,
        otherAccount0,
        ethPoolParams,
      } = await loadFixture(everythingFixture);

      const nftList = [1, 2, 3, 4, 5];
      await mintTokensAndApprove(
        nftList,
        nftContractCollection,
        otherAccount0,
        collectionPoolFactory
      );

      const tx = await collectionPoolFactory.createPoolETH({
        ...ethPoolParams,
        initialNFTIDs: nftList,
      });

      const { newTokenId: tokenId } = await getPoolAddress(tx);

      expect(await collectionPoolFactory.tokenURI(tokenId)).to.be.equal("");
    });

    it("Should return baseURI + tokenID if tokenURI has not been set by the owner", async function () {
      const baseURI = "api.collectionswap.xyz/";
      const {
        collectionPoolFactory,
        nftContractCollection,
        otherAccount0,
        ethPoolParams,
      } = await loadFixture(everythingFixture);

      const nftList = [1, 2, 3, 4, 5];
      await mintTokensAndApprove(
        nftList,
        nftContractCollection,
        otherAccount0,
        collectionPoolFactory
      );

      const tx = await collectionPoolFactory.createPoolETH({
        ...ethPoolParams,
        initialNFTIDs: nftList,
      });

      const { newTokenId: tokenId, newPoolAddress } = await getPoolAddress(tx);

      await collectionPoolFactory.setBaseURI(baseURI);

      expect(await collectionPoolFactory.tokenURI(tokenId)).to.be.equal(
        baseURI.concat(
          // Needs to be decimal string
          ethers.BigNumber.from(newPoolAddress).toString()
        )
      );
    });

    it("Should have the tokenURI set by the owner", async function () {
      const tokenURI = "api.collectionswap.xyz/tokenInfo/1";
      const {
        collectionPoolFactory,
        nftContractCollection,
        otherAccount0,
        ethPoolParams,
      } = await loadFixture(everythingFixture);

      const nftList = [1, 2, 3, 4, 5];
      await mintTokensAndApprove(
        nftList,
        nftContractCollection,
        otherAccount0,
        collectionPoolFactory
      );

      const tx = await collectionPoolFactory.createPoolETH({
        ...ethPoolParams,
        initialNFTIDs: nftList,
      });

      const { newTokenId: tokenId } = await getPoolAddress(tx);

      await collectionPoolFactory.setTokenURI(tokenURI, tokenId);

      expect(await collectionPoolFactory.tokenURI(tokenId)).to.be.equal(
        tokenURI
      );
    });
  });
});
