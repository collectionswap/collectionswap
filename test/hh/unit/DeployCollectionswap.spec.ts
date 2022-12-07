import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { mintTokensAndApprove } from "../shared/constants";
import { everythingFixture } from "../shared/fixtures";
import {
  buyFromPool,
  calculateAsk,
  calculateBid,
  changesEtherBalancesFuzzy,
  closeEnough,
  convertToBigNumber,
  cumulativeSum,
  cumulativeSumWithRoyalties,
  sellToPool,
} from "../shared/helpers";

import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import type { ContractTransaction, BigNumber } from "ethers";

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

function createDirectPairETHHelper(
  factory: any,
  thisAccount: SignerWithAddress,
  valueToSend: any,
  ethPairParams: {
    nft: any;
    bondingCurve: any;
    assetRecipient: any;
    receiver: any;
    poolType: any;
    delta: any;
    fee: any;
    spotPrice: any;
    props: any;
    state: any;
    royaltyNumerator: BigNumber;
    initialNFTIDs: any;
  },
  gasLimit = 1500000
) {
  const {
    nft: nftContractCollection,
    bondingCurve: curve,
    delta,
    fee,
    spotPrice,
    props,
    state,
    royaltyNumerator,
    initialNFTIDs: newTokenList,
  } = ethPairParams;

  return factory
    .connect(thisAccount)
    .createPairETH(
      nftContractCollection,
      curve,
      delta,
      fee,
      spotPrice,
      props,
      state,
      royaltyNumerator,
      newTokenList,
      {
        value: valueToSend,
        gasLimit,
      }
    );
}

async function getPoolAddress(tx: ContractTransaction, showGas = false) {
  const receipt = await tx.wait();
  if (showGas) {
    console.log("gas used:", receipt.cumulativeGasUsed);
  }

  const newPoolEvent = receipt.events?.find(
    (event) => event.event === "NewPair"
  );
  const newPairAddress = newPoolEvent?.args?.poolAddress;
  const newTokenEvent = receipt.events?.find(
    (event) => event.event === "NewTokenId"
  );
  const newTokenId = newTokenEvent?.args?.tokenId;
  return { newPairAddress, newTokenId };
}

describe("Collectionswap", function () {
  describe("Direct interactions with AMM", function () {
    it("Should have a spot price", async function () {
      const {
        lssvmPairFactory,
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
        lssvmPairFactory
      );
      const lssvmPairETHContractTx: ContractTransaction =
        await lssvmPairFactory.createPairETH(
          { ...ethPoolParams, initialNFTIDs },
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
      const poolSpotPrice = await lssvmPairETH.spotPrice();

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
              lssvmPairFactory,
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
              lssvmPairFactory
            );
            const lssvmPairETHContractTx: ContractTransaction =
              await lssvmPairFactory.createPairETH(
                { ...ethPoolParams, initialNFTIDs: nftList },
                {
                  // Value: ethers.BigNumber.from(`${1.2e16}`),
                  value: ethers.BigNumber.from(`${5e18}`),
                  gasLimit: 1000000,
                }
              );
            const { newPairAddress } = await getPoolAddress(
              lssvmPairETHContractTx
            );
            const lssvmPairETH = await ethers.getContractAt(
              "LSSVMPairETH",
              newPairAddress
            );

            const externalTraderNfts = [123456, 123457, 123458];
            await mintTokensAndApprove(
              externalTraderNfts,
              nftContractCollection,
              externalTrader,
              lssvmPairFactory
            );

            await nftContractCollection
              .connect(externalTrader)
              .setApprovalForAll(lssvmPairETH.address, true);

            // Start the pool with the right amount of nfts
            if (deltaItemsInPool < 0) {
              for (let k = 0; k < -deltaItemsInPool; k++) {
                await buyFromPool(lssvmPairETH, externalTrader, nftList[k]);
              }
            } else if (deltaItemsInPool > 0) {
              for (let k = 0; k < deltaItemsInPool; k++) {
                await sellToPool(
                  lssvmPairETH,
                  externalTrader,
                  externalTraderNfts[k]
                );
              }
            }

            const buyPriceQuote = (
              await lssvmPairETH.getBuyNFTQuote(qtyQuoted)
            )[4];
            const buyPriceQuoteSelfCalc = convertToBigNumber(
              await cumulativeSum(
                calculateAsk,
                deltaItemsInPool,
                qtyQuoted,
                -1, // Number of items in the pool decreases more for each additional qty in an ask
                lssvmPairETH,
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
              lssvmPairFactory,
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
              lssvmPairFactory
            );
            const lssvmPairETHContractTx: ContractTransaction =
              await lssvmPairFactory.createPairETH(
                { ...ethPoolParams, initialNFTIDs: nftList },
                {
                  // Value: ethers.BigNumber.from(`${1.2e16}`),
                  value: ethers.BigNumber.from(`${5e18}`),
                  gasLimit: 1000000,
                }
              );
            const { newPairAddress } = await getPoolAddress(
              lssvmPairETHContractTx
            );
            const lssvmPairETH = await ethers.getContractAt(
              "LSSVMPairETH",
              newPairAddress
            );

            const externalTraderNfts = [123456, 123457, 123458];
            await mintTokensAndApprove(
              externalTraderNfts,
              nftContractCollection,
              externalTrader,
              lssvmPairFactory
            );

            await nftContractCollection
              .connect(externalTrader)
              .setApprovalForAll(lssvmPairETH.address, true);

            // Start the pool with the right amount of nfts
            if (deltaItemsInPool < 0) {
              for (let k = 0; k < -deltaItemsInPool; k++) {
                await buyFromPool(lssvmPairETH, externalTrader, nftList[k]);
              }
            } else if (deltaItemsInPool > 0) {
              for (let k = 0; k < deltaItemsInPool; k++) {
                await sellToPool(
                  lssvmPairETH,
                  externalTrader,
                  externalTraderNfts[k]
                );
              }
            }

            const sellPriceQuote = (
              await lssvmPairETH.getSellNFTQuote(qtyQuoted)
            )[4];
            const sellPriceQuoteSelfCalc = convertToBigNumber(
              await cumulativeSum(
                calculateBid,
                deltaItemsInPool,
                qtyQuoted,
                1, // Number of items in the pool increases more for each additional qty in a bid
                lssvmPairETH,
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
        lssvmPairFactory,
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
        lssvmPairFactory
      );
      const lssvmPairETHContractTx: ContractTransaction =
        await lssvmPairFactory.createPairETH(
          { ...ethPoolParams, initialNFTIDs },
          {
            // Value: ethers.BigNumber.from(`${1.2e16}`),
            value: ethers.BigNumber.from(`${1.2e5}`),
            gasLimit: 1000000,
          }
        );
      const { newPairAddress } = await getPoolAddress(lssvmPairETHContractTx);
      const lssvmPairETH = await ethers.getContractAt(
        "LSSVMPairETH",
        newPairAddress
      );

      const externalTrader = otherAccount4;
      const externalTraderNftsIHave = [222];
      const [
        _bidError,
        _bidNewSpotPrice,
        _bidNewDelta,
        _bidNewState,
        bidInputAmount,
        _bidTradeFee,
        _bidProtocolFee,
        _bidnObj,
      ] = await lssvmPairETH.getSellNFTQuote(externalTraderNftsIHave.length);

      // Console.log([bidError, bidNewSpotPrice, bidNewDelta, bidInputAmount, bidProtocolFee, bidnObj])

      await mintTokensAndApprove(
        externalTraderNftsIHave,
        nftContractCollection,
        otherAccount4,
        lssvmPairETH
      );
      await expect(
        lssvmPairETH.connect(externalTrader).swapNFTsForToken(
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
      ).to.be.revertedWith("Too little ETH");

      // Can withdraw
      await lssvmPairETH.withdrawAllETH();
      await lssvmPairETH.withdrawERC721(
        nftContractCollection.address,
        initialNFTIDs
      );
    });

    it("Should accrue ETH when repeated bought/sold into", async function () {
      const {
        lssvmPairFactory,
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
        lssvmPairFactory
      );
      const lssvmPairETHContractTx: ContractTransaction =
        await lssvmPairFactory.createPairETH(
          { ...ethPoolParams, initialNFTIDs: nftList },
          {
            // Value: ethers.BigNumber.from(`${1.2e16}`),
            value: ethers.BigNumber.from(`${5e18}`),
            gasLimit: 1000000,
          }
        );
      const { newPairAddress } = await getPoolAddress(lssvmPairETHContractTx);
      const lssvmPairETH = await ethers.getContractAt(
        "LSSVMPairETH",
        newPairAddress
      );

      const externalTrader = otherAccount4;
      const externalTraderNftsIHave = [222, 223, 224];
      await mintTokensAndApprove(
        externalTraderNftsIHave,
        nftContractCollection,
        otherAccount4,
        lssvmPairFactory
      );

      let poolBalance = await ethers.provider.getBalance(lssvmPairETH.address);
      await nftContractCollection
        .connect(externalTrader)
        .setApprovalForAll(lssvmPairETH.address, true);
      for (let i = 0; i < 20; i++) {
        // Sell my NFT into the pair
        const [
          _bidError,
          _bidNewSpotPrice,
          _bidNewDelta,
          _bidNewState,
          bidInputAmount,
          _bidTradeFee,
          _bidProtocolFee,
          _bidnObj,
        ] = await lssvmPairETH.getSellNFTQuote(1);
        // Console.log([bidError, bidNewSpotPrice, bidNewDelta, bidInputAmount, bidProtocolFee, bidnObj])
        await lssvmPairETH.connect(externalTrader).swapNFTsForToken(
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
          _askNewSpotPrice,
          _askNewDelta,
          _askNewState,
          askOutputAmount,
          _askTradeFee,
          _askProtocolFee,
          _asknObj,
        ] = await lssvmPairETH.getBuyNFTQuote(1);

        await lssvmPairETH
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
          lssvmPairETH.address
        );
        expect(newBalance.gt(poolBalance)).to.be.true;

        poolBalance = newBalance;
      }
    });

    it("Should revert if trades are attempted in the same timestamp as pair creation", async function () {
      const {
        lssvmPairFactory,
        nftContractCollection,
        otherAccount4,
        ethPoolParams,
      } = await loadFixture(everythingFixture);
      let atomicTraderFactory = await ethers.getContractFactory(
        "TestAtomicTrader"
      );
      let atomicTestTrader = await atomicTraderFactory.deploy(lssvmPairFactory.address, ethPoolParams.bondingCurve);
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
      let baseURI = "api.collectionswap.xyz";
      const {
        lssvmPairFactory,
        otherAccount3,
        otherAccount4,
      } = await loadFixture(everythingFixture);

      await expect(
        lssvmPairFactory
          .connect(otherAccount3)
          .setBaseURI(
            baseURI
          )
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await expect(
        lssvmPairFactory
          .connect(otherAccount4)
          .setBaseURI(
            baseURI
          )
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should have the baseURI set by the owner", async function () {
      let baseURI = "api.collectionswap.xyz";
      const {
        lssvmPairFactory
      } = await loadFixture(everythingFixture);

      await lssvmPairFactory.setBaseURI(baseURI);
      expect(await lssvmPairFactory.baseURI()).to.be.equal(baseURI);
    });

    it("Should revert if unauthorized users attempt to set the tokenURI", async function () {
      let tokenURI = "api.collectionswap.xyz/tokenInfo/1";
      const {
        lssvmPairFactory,
        otherAccount3,
        otherAccount4,
      } = await loadFixture(everythingFixture);

      await expect(
        lssvmPairFactory
          .connect(otherAccount3)
          .setTokenURI(
            tokenURI,
            1
          )
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await expect(
        lssvmPairFactory
          .connect(otherAccount4)
          .setTokenURI(
            tokenURI,
            1
          )
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should revert setting the tokenURI if token id has not existed", async function () {
      let tokenURI = "api.collectionswap.xyz/tokenInfo/1";
      const {
        lssvmPairFactory
      } = await loadFixture(everythingFixture);

      await expect(
        lssvmPairFactory.setTokenURI(
          tokenURI,
          1
        )
      ).to.be.revertedWith("ERC721URIStorage: URI set of nonexistent token");
    });

    it("Should return an empty string if baseURI has not been set", async function () {
      let tokenId = 1;
      const {
        lssvmPairFactory,
        nftContractCollection,
        otherAccount0,
        ethPoolParams,
      } = await loadFixture(everythingFixture);

      const nftList = [1, 2, 3, 4, 5];
      await mintTokensAndApprove(
        nftList,
        nftContractCollection,
        otherAccount0,
        lssvmPairFactory
      );

      await lssvmPairFactory.createPairETH(
        { ...ethPoolParams, initialNFTIDs: nftList },
      );

      expect(await lssvmPairFactory.tokenURI(tokenId)).to.be.equal("");
    });

    it("Should return baseURI + tokenID if tokenURI has not been set by the owner", async function () {
      let baseURI = "api.collectionswap.xyz/";
      let tokenId = 1;
      const {
        lssvmPairFactory,
        nftContractCollection,
        otherAccount0,
        ethPoolParams,
      } = await loadFixture(everythingFixture);

      const nftList = [1, 2, 3, 4, 5];
      await mintTokensAndApprove(
        nftList,
        nftContractCollection,
        otherAccount0,
        lssvmPairFactory
      );

      await lssvmPairFactory.createPairETH(
        { ...ethPoolParams, initialNFTIDs: nftList },
      );

      await lssvmPairFactory.setBaseURI(baseURI);

      expect(await lssvmPairFactory.tokenURI(tokenId)).to.be.equal(baseURI.concat("1"));
    });

    it("Should have the tokenURI set by the owner", async function () {
      let tokenURI = "api.collectionswap.xyz/tokenInfo/1";
      let tokenId = 1;
      const {
        lssvmPairFactory,
        nftContractCollection,
        otherAccount0,
        ethPoolParams,
      } = await loadFixture(everythingFixture);

      const nftList = [1, 2, 3, 4, 5];
      await mintTokensAndApprove(
        nftList,
        nftContractCollection,
        otherAccount0,
        lssvmPairFactory
      );

      await lssvmPairFactory.createPairETH(
        { ...ethPoolParams, initialNFTIDs: nftList },
      );

      await lssvmPairFactory.setTokenURI(tokenURI, tokenId);

      expect(await lssvmPairFactory.tokenURI(tokenId)).to.be.equal(tokenURI);
    });
  });

});
