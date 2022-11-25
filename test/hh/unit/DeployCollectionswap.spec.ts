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
  collectionswap: any,
  thisAccount: SignerWithAddress,
  valueToSend: any,
  ethPairParams: {
    nft: any;
    bondingCurve: any;
    assetRecipient: any;
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

  return collectionswap
    .connect(thisAccount)
    .createDirectPairETH(
      thisAccount.address,
      nftContractCollection.address,
      curve.address,
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
  describe("Direct interactions with sudoswap", function () {
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
        lssvmPairETH
          .connect(externalTrader)
          .swapNFTsForToken(
            externalTraderNftsIHave,
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
      console.log("balance of pair", poolBalance);
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
        await lssvmPairETH
          .connect(externalTrader)
          .swapNFTsForToken(
            [222],
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
        console.log(
          "balance of pair",
          i,
          await ethers.provider.getBalance(lssvmPairETH.address)
        );

        poolBalance = newBalance;
      }
    });
  });

  describe("Direct interactions with collectionswap", function () {
    it("Should have setSenderSpecifierOperator only callable by only owner", async function () {
      const {
        otherAccount1,
        otherAccount2,
        collectionswap,
      } = await loadFixture(everythingFixture);

      await expect(
        collectionswap.connect(otherAccount1).setSenderSpecifierOperator(otherAccount1.address, true)
      ).to.be.revertedWithCustomError(collectionswap, "Ownable_NotOwner");

      await expect(
        collectionswap.connect(otherAccount2).setSenderSpecifierOperator(otherAccount1.address, true)
      ).to.be.revertedWithCustomError(collectionswap, "Ownable_NotOwner");
    });

    it("Should have owner be able to set and unset sender specifier operators", async function () {
      const {
        otherAccount2,
        collectionswap,
      } = await loadFixture(everythingFixture);

      // owner should be able to toggle on and off
      expect(await collectionswap.isSenderSpecifierOperator(otherAccount2.address)).to.be.false;
      await collectionswap.setSenderSpecifierOperator(otherAccount2.address, true);
      expect(await collectionswap.isSenderSpecifierOperator(otherAccount2.address)).to.be.true;
      await collectionswap.setSenderSpecifierOperator(otherAccount2.address, false);
      expect(await collectionswap.isSenderSpecifierOperator(otherAccount2.address)).to.be.false;
    });

    it("Should have setCanSpecifySender callable by owner", async function () {
      const {
        otherAccount1,
        otherAccount2,
        collectionswap,
      } = await loadFixture(everythingFixture);

      await expect(
        collectionswap.connect(otherAccount1).setCanSpecifySender(otherAccount1.address, true)
      ).to.be.revertedWith("not authorized");

      await expect(
        collectionswap.connect(otherAccount2).setCanSpecifySender(otherAccount1.address, true)
      ).to.be.revertedWith("not authorized");
    });

    it("Should have owner or operator be able to set and unset sender specifiers", async function () {
      const {
        otherAccount2,
        otherAccount3,
        collectionswap,
      } = await loadFixture(everythingFixture);

      // owner should be able to toggle on and off
      expect(await collectionswap.canSpecifySender(otherAccount2.address)).to.be.false;
      await collectionswap.setCanSpecifySender(otherAccount2.address, true);
      expect(await collectionswap.canSpecifySender(otherAccount2.address)).to.be.true;
      await collectionswap.setCanSpecifySender(otherAccount2.address, false);
      expect(await collectionswap.canSpecifySender(otherAccount2.address)).to.be.false;

      // give permission to an operator, should be able to toggle on and off as well
      await collectionswap.setSenderSpecifierOperator(otherAccount3.address, true);
      await collectionswap.connect(otherAccount3).setCanSpecifySender(otherAccount2.address, true);
      await collectionswap.setCanSpecifySender(otherAccount2.address, true);
    });

    it("Should be unable to create and destroy LP tokens if non-authorized user tries to specify senders", async function () {
      const {
        nftContractCollection,
        curve,
        delta,
        fee,
        spotPrice,
        initialNFTIDs,
        otherAccount2,
        otherAccount3,
        collectionswap,
      } = await loadFixture(everythingFixture);

      // check that otherAccount2 cannot specify sender
      expect(await collectionswap.canSpecifySender(otherAccount2.address)).to.be.false;

      // should revert if trying to create / destroy with a different user
      await expect(
        collectionswap
        .connect(otherAccount2)
        .createDirectPairETH(
          otherAccount3.address,
          nftContractCollection.address,
          curve.address,
          delta,
          fee,
          spotPrice,
          initialNFTIDs
        )
      ).to.be.revertedWith("can't specify sender");

      await expect(
        collectionswap
        .connect(otherAccount2)
        .useLPTokenToDestroyDirectPairETH(
          otherAccount3.address,
          1
        )
      ).to.be.revertedWith("can't specify sender");
    });
    
    it("should be gas efficient to create a sudoswap pair through collectionswap", async function () {
      const {
        lssvmPairFactory,
        nftContractCollection,
        curve,
        assetRecipient,
        poolType,
        delta,
        fee,
        spotPrice,
        otherAccount0,
        collectionswap,
      } = await loadFixture(everythingFixture);

      const listOfListOfTokens = [[1], [2, 3], [4, 5, 6], [7, 8, 9, 10]];

      for (const newTokenList of listOfListOfTokens) {
        // Add 1000 to each token id
        const newTokenListWithOffset = newTokenList.map((id) => id + 1000);
        await mintTokensAndApprove(
          newTokenListWithOffset,
          nftContractCollection,
          otherAccount0,
          lssvmPairFactory
        );
        for (const nftId of newTokenListWithOffset) {
          expect(await nftContractCollection.ownerOf(nftId)).to.equal(
            otherAccount0.address
          );
        }

        const valueToSend = ethers.BigNumber.from(`${1.2e18}`);
        const lssvmPairETHContractTx: ContractTransaction =
          await lssvmPairFactory.createPairETH(
            nftContractCollection.address,
            curve.address,
            assetRecipient,
            poolType,
            delta,
            fee,
            spotPrice,
            newTokenListWithOffset,
            {
              value: valueToSend,
              gasLimit: 1000000,
            }
          );
        const lssvmGas = await checkGas(lssvmPairETHContractTx);
        // Console.log(lssvmGas)
        expect(lssvmGas).to.be.lte(
          BigNumber.from("216000").add(
            BigNumber.from("50000").mul(newTokenList.length)
          )
        );
      }

      // Console.log('createDirectPairETH collection')
      for (const newTokenList of listOfListOfTokens) {
        await mintTokensAndApprove(
          newTokenList,
          nftContractCollection,
          otherAccount0,
          lssvmPairFactory
        );
        for (const nftId of newTokenList) {
          expect(await nftContractCollection.ownerOf(nftId)).to.equal(
            otherAccount0.address
          );
        }

        const valueToSend = ethers.BigNumber.from(`${1.2e18}`);

        const approvalCollectionTx = await nftContractCollection
          .connect(otherAccount0)
          .setApprovalForAll(collectionswap.address, true);
        const approvalCollectionGas = await checkGas(approvalCollectionTx);
        expect(approvalCollectionGas).to.be.lte(BigNumber.from("47000"));

        const createPairTx = await createDirectPairETHHelper(
          collectionswap,
          otherAccount0,
          nftContractCollection,
          curve,
          assetRecipient,
          poolType,
          delta,
          fee,
          spotPrice,
          newTokenList,
          valueToSend
        );

        const createPairGas = await checkGas(createPairTx);
        // Console.log(createPairGas)
        expect(createPairGas).to.be.lte(
          BigNumber.from("620000").add(
            BigNumber.from("76000").mul(newTokenList.length)
          )
        );
      }
    });

    it("Should be able to create and destroy a sudoswap pair through collection swap", async function () {
      const {
        lssvmPairFactory,
        nftContractCollection,
        initialNFTIDs,
        otherAccount0,
        otherAccount1,
        otherAccount2,
        collectionswap,
        ethPoolParams,
      } = await loadFixture(everythingFixture);
      await mintTokensAndApprove(
        initialNFTIDs,
        nftContractCollection,
        otherAccount0,
        lssvmPairFactory
      );
      for (const nftId of initialNFTIDs) {
        expect(await nftContractCollection.ownerOf(nftId)).to.equal(
          otherAccount0.address
        );
      }

      const valueToSend = ethers.BigNumber.from(`${1.2e18}`);

      await expect(
        createDirectPairETHHelper(collectionswap, otherAccount0, valueToSend, {
          ...ethPoolParams,
          initialNFTIDs,
        })
      ).to.be.revertedWith("ERC721: caller is not token owner nor approved");

      await nftContractCollection
        .connect(otherAccount0)
        .setApprovalForAll(collectionswap.address, true);

      const prevBalance = await ethers.provider.getBalance(
        otherAccount0.address
      );
      const newPair = await createDirectPairETHHelper(
        collectionswap,
        otherAccount0,
        valueToSend,
        { ...ethPoolParams, initialNFTIDs }
      );

      // Any random address cannot be alive
      expect(await collectionswap.isPoolAlive(otherAccount0.address)).to.be
        .false;

      const currBalance = await ethers.provider.getBalance(
        otherAccount0.address
      );
      expect(prevBalance.sub(currBalance)).to.be.gte(valueToSend);
      const { newPairAddress, newTokenId } = await getPoolAddress(newPair);
      expect(newTokenId).to.be.eq(1);

      // The pool now owns the NFTs
      for (const nftId of initialNFTIDs) {
        expect(await nftContractCollection.ownerOf(nftId)).to.equal(
          newPairAddress
        );
      }

      expect(await ethers.provider.getBalance(collectionswap.address)).to.be.eq(
        ethers.BigNumber.from(`${0}`)
      );

      // Owner of the LP token is approved to operate on the pool
      expect(
        await collectionswap.isApprovedToOperateOnPool(
          otherAccount0.address,
          newTokenId
        )
      ).to.be.true;
      // Non-owner of the LP token is not approved to operate on the pool
      expect(
        await collectionswap.isApprovedToOperateOnPool(
          otherAccount1.address,
          newTokenId
        )
      ).to.be.false;
      // Collectionswap is not approved to operate on the pool
      expect(
        await collectionswap.isApprovedToOperateOnPool(
          collectionswap.address,
          newTokenId
        )
      ).to.be.false;
      // Nonsensical values on non-pools should be false
      expect(
        await collectionswap.isApprovedToOperateOnPool(
          otherAccount0.address,
          2323232
        )
      ).to.be.false;

      const totalCollectionTokensOwned = await collectionswap.balanceOf(
        otherAccount0.address
      );
      // Only one LP token owned
      expect(totalCollectionTokensOwned).to.be.eq(
        ethers.BigNumber.from(`${1}`)
      );

      /// ///////////////////////////////////
      // transfer LP token to ultimate dest
      /// ///////////////////////////////////
      await collectionswap
        .connect(otherAccount0)
        .transferFrom(otherAccount0.address, otherAccount1.address, newTokenId);

      // Owner of the LP token is approved to operate on the pool
      expect(
        await collectionswap.isApprovedToOperateOnPool(
          otherAccount1.address,
          newTokenId
        )
      ).to.be.true;
      // Non-owner of the LP token is not approved to operate on the pool
      expect(
        await collectionswap.isApprovedToOperateOnPool(
          otherAccount0.address,
          newTokenId
        )
      ).to.be.false;

      // LP token alive
      expect(await collectionswap.isPoolAlive(newPairAddress)).to.be.true;

      for (const notAuthorizedAccount of [otherAccount0, otherAccount2]) {
        await expect(
          collectionswap
            .connect(notAuthorizedAccount)
            .useLPTokenToDestroyDirectPairETH(notAuthorizedAccount.address, newTokenId, {
              gasLimit: 2000000,
            })
        ).to.be.revertedWith("only token owner can destroy pool");
      }

      // Owner of the LP token has been done properly
      expect(await collectionswap.ownerOf(newTokenId)).to.be.eq(
        otherAccount1.address
      );

      // // value accrues to the new LP owner
      await expect(
        collectionswap
          .connect(otherAccount1)
          .useLPTokenToDestroyDirectPairETH(otherAccount1.address, newTokenId, {
            gasLimit: 2000000,
          })
      ).to.changeEtherBalances(
        [otherAccount0.address, newPairAddress, otherAccount1.address],
        [0, ethers.BigNumber.from(`${-1.2e18}`), valueToSend]
      );

      for (const nftId of initialNFTIDs) {
        expect(await nftContractCollection.ownerOf(nftId)).to.equal(
          otherAccount1.address
        );
      }

      // LP token dead
      expect(await collectionswap.isPoolAlive(newPairAddress)).to.be.false;
      await expect(collectionswap.ownerOf(newTokenId)).to.be.revertedWith(
        "ERC721: invalid token ID"
      );

      //   Console.log(`viewPoolParams ${await collectionswap.viewPoolParams(newTokenId)}`)

      await expect(
        collectionswap
          .connect(otherAccount1)
          .useLPTokenToDestroyDirectPairETH(otherAccount1.address, newTokenId, {
            gasLimit: 2000000,
          })
      ).to.be.revertedWith("pool already destroyed");
    });

    it("Should have LP tokens with non-clashing IDs", async function () {
      const {
        lssvmPairFactory,
        nftContractCollection,
        otherAccount0,
        otherAccount1,
        otherAccount2,
        collectionswap,
        ethPoolParams,
      } = await loadFixture(everythingFixture);

      const theseAccounts = [otherAccount0, otherAccount1, otherAccount2];
      let i = 1;
      for (const thisAccount of theseAccounts) {
        // Console.log(theseAccounts.indexOf(thisAccount))
        const tokenIdList = [
          theseAccounts.indexOf(thisAccount),
          theseAccounts.indexOf(thisAccount) + 1000,
        ];
        await mintTokensAndApprove(
          tokenIdList,
          nftContractCollection,
          thisAccount,
          lssvmPairFactory
        );

        await nftContractCollection
          .connect(thisAccount)
          .setApprovalForAll(collectionswap.address, true);

        const newPair = await createDirectPairETHHelper(
          collectionswap,
          thisAccount,
          ethers.BigNumber.from(`${1.2e18}`),
          { ...ethPoolParams, initialNFTIDs: tokenIdList }
        );

        const { newTokenId } = await getPoolAddress(newPair);

        // Const jsonObj = JSON.parse(await collectionswap.tokenURI(newTokenId))
        // await expect(jsonObj.pool).to.be.eq(newPairAddress.toLowerCase())
        expect(newTokenId).to.be.eq(i);
        expect(
          await collectionswap.isApprovedToOperateOnPool(
            thisAccount.address,
            newTokenId
          )
        ).to.be.true;
        i++;
      }
    });

    it("Should have owner be able to destroy even if original tokenIds are not in the pool", async function () {
      const {
        lssvmPairFactory,
        nftContractCollection,
        otherAccount0,
        otherAccount1,
        otherAccount2,
        collectionswap,
        ethPoolParams,
        bigPctProtocolFee,
      } = await loadFixture(everythingFixture);

      const theseAccounts = [otherAccount0, otherAccount1, otherAccount2];
      let poolAddresses: string[] = [];
      let nftTokenIds: number[][] = [];
      let LPtokenIds: BigNumber[] = [];
      // Const i = 1
      let i = 1;
      for (const thisAccount of theseAccounts) {
        // Console.log(theseAccounts.indexOf(thisAccount))
        const tokenIdList = [
          theseAccounts.indexOf(thisAccount),
          theseAccounts.indexOf(thisAccount) + 1000,
        ];
        await mintTokensAndApprove(
          tokenIdList,
          nftContractCollection,
          thisAccount,
          lssvmPairFactory
        );
        await nftContractCollection
          .connect(thisAccount)
          .setApprovalForAll(collectionswap.address, true);

        if (i === 1) {
          const newPair = await createDirectPairETHHelper(
            collectionswap,
            thisAccount,
            ethers.BigNumber.from(`${1.2e18}`),
            { ...ethPoolParams, initialNFTIDs: tokenIdList }
          );

          const { newPairAddress, newTokenId } = await getPoolAddress(newPair);
          poolAddresses = [...poolAddresses, newPairAddress];
          LPtokenIds = [...LPtokenIds, newTokenId];
        }

        nftTokenIds = [...nftTokenIds, tokenIdList];
        i++;
      }

      // Try to trade out the original tokenIds of the first pool
      const targetPool = poolAddresses[0];
      const nftsIWant = nftTokenIds[0];
      const originalPoolCreator = theseAccounts[0];
      const externalTrader = theseAccounts[2];
      const externalTraderNftsIHave = nftTokenIds[2];

      const lssvmPairETH = await ethers.getContractAt(
        "LSSVMPairETH",
        targetPool
      );
      // Send enough for n+1 NFTs
      const maxExpectedTokenInput = (
        await lssvmPairETH.getBuyNFTQuote(nftsIWant.length)
      )[4];

      // Console.log(await lssvmPairETH.spotPrice())
      // console.log(await lssvmPairETH.getAllHeldIds())

      // owners of underlying should be pool
      for (const nftId of nftsIWant) {
        expect(await nftContractCollection.ownerOf(nftId)).to.be.eq(
          lssvmPairETH.address
        );
      }

      await expect(
        lssvmPairETH
          .connect(externalTrader)
          .swapTokenForSpecificNFTs(
            nftsIWant,
            maxExpectedTokenInput,
            externalTrader.address,
            false,
            ethers.constants.AddressZero
          )
      ).to.be.revertedWith("Sent too little ETH");

      // Owners of underlying should be pool
      for (const nftId of nftsIWant) {
        expect(await nftContractCollection.ownerOf(nftId)).to.be.eq(
          lssvmPairETH.address
        );
      }

      let curveParamsCached = await lssvmPairETH.curveParams();

      const [
        _askError,
        _askNewSpotPrice,
        _askNewDelta,
        _askNewState,
        askInputAmount,
        _askTradeFee,
        askProtocolFee,
        _asknObj,
      ] = await lssvmPairETH.getBuyNFTQuote(nftsIWant.length);
      // Console.log(await lssvmPairETH.getBuyNFTQuote(nftsIWant.length))

      // First calculate the expected sale value + royalty amounts
      const buyAmounts = await cumulativeSumWithRoyalties(
        calculateAsk,
        0,
        nftsIWant.length,
        -1,
        lssvmPairETH,
        curveParamsCached.spotPrice,
        curveParamsCached.delta,
        curveParamsCached.props,
        ethPoolParams.fee,
        bigPctProtocolFee,
        ethPoolParams.royaltyNumerator
      );
      let totalBuyRoyalties = 0;
      buyAmounts.slice(1, undefined).forEach((royalty) => {
        totalBuyRoyalties += royalty;
      });

      // TODO: test balance
      const buyTx = await lssvmPairETH
        .connect(externalTrader)
        .swapTokenForSpecificNFTs(
          nftsIWant,
          askInputAmount,
          externalTrader.address,
          false,
          ethers.constants.AddressZero,
          {
            value: maxExpectedTokenInput,
            gasLimit: 1500000,
          }
        );
      expect(
        await changesEtherBalancesFuzzy(
          buyTx,
          [externalTrader.address, lssvmPairETH.address],
          [
            askInputAmount.mul(-1),
            askInputAmount.sub(
              askProtocolFee.add(
                ethers.utils.parseEther(totalBuyRoyalties.toFixed(18))
              )
            ),
          ]
        )
      );

      // Owners of underlying should be externalTrader
      for (const nftId of nftsIWant) {
        expect(await nftContractCollection.ownerOf(nftId)).to.be.eq(
          externalTrader.address
        );
      }

      for (const nftId of externalTraderNftsIHave) {
        expect(await nftContractCollection.ownerOf(nftId)).to.be.eq(
          externalTrader.address
        );
      }

      curveParamsCached = await lssvmPairETH.curveParams();

      const [
        _bidError,
        _bidNewSpotPrice,
        _bidNewDelta,
        _bidNewState,
        bidInputAmount,
        _bidTradeFee,
        bidProtocolFee,
        _bidnObj,
      ] = await lssvmPairETH.getSellNFTQuote(externalTraderNftsIHave.length);

      // First calculate the expected sale value + royalty amounts
      const sellAmounts = await cumulativeSumWithRoyalties(
        calculateBid,
        0,
        externalTraderNftsIHave.length,
        1,
        lssvmPairETH,
        curveParamsCached.spotPrice,
        curveParamsCached.delta,
        curveParamsCached.props,
        ethPoolParams.fee,
        bigPctProtocolFee,
        ethPoolParams.royaltyNumerator
      );
      let totalSellRoyalties = 0;
      sellAmounts.slice(1, undefined).forEach((royalty) => {
        totalSellRoyalties += royalty;
      });

      // Trade with the pair
      await expect(
        lssvmPairETH
          .connect(externalTrader)
          .swapNFTsForToken(
            externalTraderNftsIHave,
            bidInputAmount,
            externalTrader.address,
            false,
            ethers.constants.AddressZero
          )
      ).to.be.revertedWith("ERC721: caller is not token owner nor approved");

      await nftContractCollection
        .connect(externalTrader)
        .setApprovalForAll(lssvmPairETH.address, true);

      const sellTx = await lssvmPairETH
        .connect(externalTrader)
        .swapNFTsForToken(
          externalTraderNftsIHave,
          bidInputAmount,
          externalTrader.address,
          false,
          ethers.constants.AddressZero
        );
      expect(
        await changesEtherBalancesFuzzy(
          sellTx,
          [externalTrader.address, lssvmPairETH.address],
          [
            bidInputAmount.mul(1),
            bidInputAmount
              .mul(-1)
              .sub(
                bidProtocolFee.add(
                  ethers.utils.parseEther(totalSellRoyalties.toFixed(18))
                )
              ),
          ]
        )
      );

      const poolBalance = await ethers.provider.getBalance(
        lssvmPairETH.address
      );

      await expect(
        collectionswap
          .connect(originalPoolCreator)
          .useLPTokenToDestroyDirectPairETH(originalPoolCreator.address, 1, {
            gasLimit: 2000000,
          })
      ).to.changeEtherBalances(
        [originalPoolCreator.address, lssvmPairETH.address],
        [poolBalance, poolBalance.mul(-1)]
      );

      // Check that ownership of NFTs has been switched
      for (const nftId of externalTraderNftsIHave) {
        expect(await nftContractCollection.ownerOf(nftId)).to.be.eq(
          originalPoolCreator.address
        );
      }
    });

    it("should have owner be able to rescue ERC20 tokens directly sent to the CollectionSwap contract", async function () {
      const { collectionswap } = await loadFixture(everythingFixture);
      const MyERC20 = await ethers.getContractFactory("Test20");
      const myERC20 = await MyERC20.deploy();
      // Accidentally send to CollectionSwap contract directly
      const amount = 100;
      myERC20.mint(collectionswap.address, amount);
      expect(await myERC20.balanceOf(collectionswap.address)).to.be.eq(amount);
      await collectionswap.rescueERC20(myERC20.address, amount, 0);
      expect(await myERC20.balanceOf(collectionswap.address)).to.be.eq(0);
    });

    it("should prevent non-users from rescuing ERC20 tokens directly sent to the CollectionSwap contract", async function () {
      const { otherAccount1, collectionswap } = await loadFixture(
        everythingFixture
      );
      const MyERC20 = await ethers.getContractFactory("Test20");
      const myERC20 = await MyERC20.deploy();
      await expect(
        collectionswap
          .connect(otherAccount1)
          .rescueERC20(myERC20.address, 100, 0)
      ).to.be.revertedWith("not owner");
    });

    it("should be able to have users rescue ERC20 tokens from their created pair", async function () {
      const {
        lssvmPairFactory,
        nftContractCollection,
        otherAccount0,
        collectionswap,
        ethPoolParams,
      } = await loadFixture(everythingFixture);
      const tokenIdList = [500, 1000, 1500];
      await mintTokensAndApprove(
        tokenIdList,
        nftContractCollection,
        otherAccount0,
        lssvmPairFactory
      );

      await nftContractCollection
        .connect(otherAccount0)
        .setApprovalForAll(collectionswap.address, true);
      const newPair = await createDirectPairETHHelper(
        collectionswap,
        otherAccount0,
        ethers.BigNumber.from(`${1.2e18}`),
        { ...ethPoolParams, initialNFTIDs: tokenIdList }
      );

      const { newPairAddress, newTokenId } = await getPoolAddress(newPair);
      const MyERC20 = await ethers.getContractFactory("Test20");
      const myERC20 = await MyERC20.deploy();
      // Accidentally send to newPair
      const amount = 100;
      myERC20.mint(newPairAddress, amount);
      expect(await myERC20.balanceOf(newPairAddress)).to.be.eq(amount);
      await collectionswap.rescueERC20(myERC20.address, amount, newTokenId);
      expect(await myERC20.balanceOf(newPairAddress)).to.be.eq(0);
    });

    it("should be able to rescue ERC721 tokens sent to the CollectionSwap contract directly", async function () {
      const {
        lssvmPairFactory,
        nftContractCollection,
        otherAccount0,
        collectionswap,
      } = await loadFixture(everythingFixture);
      const tokenIdList = [500, 1000, 1500];
      await mintTokensAndApprove(
        tokenIdList,
        nftContractCollection,
        otherAccount0,
        lssvmPairFactory
      );
      const tokenId = 2000;
      await nftContractCollection.mint(collectionswap.address, tokenId);
      await collectionswap.rescueERC721(
        nftContractCollection.address,
        [tokenId],
        0
      );
      expect(
        await nftContractCollection.balanceOf(collectionswap.address)
      ).to.be.eq(0);
    });

    it("should prevent non-users from rescuing ERC721 tokens directly sent to the CollectionSwap contract", async function () {
      const { nftContractCollection, otherAccount1, collectionswap } =
        await loadFixture(everythingFixture);
      await expect(
        collectionswap
          .connect(otherAccount1)
          .rescueERC721(nftContractCollection.address, [100], 0)
      ).to.be.revertedWith("not owner");
    });

    it("should prevent users from rescuing NFTs used for the pool", async function () {
      const {
        lssvmPairFactory,
        nftContractCollection,
        otherAccount0,
        collectionswap,
        ethPoolParams,
      } = await loadFixture(everythingFixture);
      const tokenIdList = [500, 1000, 1500];
      await mintTokensAndApprove(
        tokenIdList,
        nftContractCollection,
        otherAccount0,
        lssvmPairFactory
      );

      await nftContractCollection
        .connect(otherAccount0)
        .setApprovalForAll(collectionswap.address, true);
      const newPair = await createDirectPairETHHelper(
        collectionswap,
        otherAccount0,
        ethers.BigNumber.from(`${1.2e18}`),
        { ...ethPoolParams, initialNFTIDs: tokenIdList }
      );
      const { newTokenId } = await getPoolAddress(newPair);
      await expect(
        collectionswap.rescueERC721(
          nftContractCollection.address,
          [500],
          newTokenId
        )
      ).to.be.revertedWith("call useLPTokenToDestroyDirectPairETH()");
    });

    it("should prevent non-approved callers from rescuing ERC721 tokens", async function () {
      const {
        lssvmPairFactory,
        nftContractCollection,
        otherAccount0,
        otherAccount2,
        collectionswap,
        ethPoolParams,
      } = await loadFixture(everythingFixture);
      const tokenIdList = [500, 1000, 1500];
      await mintTokensAndApprove(
        tokenIdList,
        nftContractCollection,
        otherAccount0,
        lssvmPairFactory
      );

      await nftContractCollection
        .connect(otherAccount0)
        .setApprovalForAll(collectionswap.address, true);
      const newPair = await createDirectPairETHHelper(
        collectionswap,
        otherAccount0,
        ethers.BigNumber.from(`${1.2e18}`),
        { ...ethPoolParams, initialNFTIDs: tokenIdList }
      );
      const { newTokenId } = await getPoolAddress(newPair);
      await expect(
        collectionswap
          .connect(otherAccount2)
          .rescueERC721(nftContractCollection.address, [500], newTokenId)
      ).to.be.revertedWith("unapproved caller");
    });

    it("should be able to have users rescue ERC721 tokens (not the one used for the pool) from their created pair", async function () {
      const {
        lssvmPairFactory,
        nftContractCollection,
        otherAccount0,
        collectionswap,
        ethPoolParams,
      } = await loadFixture(everythingFixture);
      const tokenIdList = [500, 1000, 1500];
      await mintTokensAndApprove(
        tokenIdList,
        nftContractCollection,
        otherAccount0,
        lssvmPairFactory
      );

      await nftContractCollection
        .connect(otherAccount0)
        .setApprovalForAll(collectionswap.address, true);
      const newPair = await createDirectPairETHHelper(
        collectionswap,
        otherAccount0,
        ethers.BigNumber.from(`${1.2e18}`),
        { ...ethPoolParams, initialNFTIDs: tokenIdList }
      );
      const { newPairAddress, newTokenId } = await getPoolAddress(newPair);
      // Send airdrop NFT to pool
      const MyERC721 = await ethers.getContractFactory("Test721");
      const myERC721 = await MyERC721.deploy();
      await myERC721.mint(newPairAddress, 1);
      await collectionswap.rescueERC721(myERC721.address, [1], newTokenId);
      expect(await myERC721.ownerOf(1)).to.be.eq(otherAccount0.address);
    });

    it("should be able to rescue ERC1155 tokens sent to the CollectionSwap contract directly", async function () {
      const { otherAccount0, collectionswap } = await loadFixture(
        everythingFixture
      );
      const MyERC1155 = await ethers.getContractFactory("Test1155");
      const myERC1155 = await MyERC1155.deploy();
      const tokenId = 1;
      const amount = 5;
      await myERC1155.mint(collectionswap.address, tokenId, amount);
      await collectionswap.rescueERC1155(
        myERC1155.address,
        [tokenId],
        [amount],
        0
      );
      expect(
        await myERC1155.balanceOf(otherAccount0.address, tokenId)
      ).to.be.eq(amount);
    });

    it("should prevent non-users from rescuing ERC1155 tokens directly sent to the CollectionSwap contract", async function () {
      const { nftContractCollection, otherAccount1, collectionswap } =
        await loadFixture(everythingFixture);
      await expect(
        collectionswap
          .connect(otherAccount1)
          .rescueERC1155(nftContractCollection.address, [100], [1], 0)
      ).to.be.revertedWith("not owner");
    });

    it("should prevent non-approved callers from rescuing ERC1155 tokens", async function () {
      const { nftContractCollection, otherAccount2, collectionswap } =
        await loadFixture(everythingFixture);
      await expect(
        collectionswap
          .connect(otherAccount2)
          .rescueERC1155(nftContractCollection.address, [1], [1], 1)
      ).to.be.revertedWith("unapproved caller");
    });

    it("should be able to have users rescue ERC1155 tokens (not the one used for the pool) from their created pair", async function () {
      const {
        lssvmPairFactory,
        nftContractCollection,
        otherAccount0,
        collectionswap,
        ethPoolParams,
      } = await loadFixture(everythingFixture);
      const tokenIdList = [500, 1000, 1500];
      await mintTokensAndApprove(
        tokenIdList,
        nftContractCollection,
        otherAccount0,
        lssvmPairFactory
      );

      await nftContractCollection
        .connect(otherAccount0)
        .setApprovalForAll(collectionswap.address, true);
      const newPair = await createDirectPairETHHelper(
        collectionswap,
        otherAccount0,
        ethers.BigNumber.from(`${1.2e18}`),
        { ...ethPoolParams, initialNFTIDs: tokenIdList }
      );
      const { newPairAddress, newTokenId } = await getPoolAddress(newPair);
      // Send airdrop NFT to pool
      const MyERC1155 = await ethers.getContractFactory("Test1155");
      const myERC1155 = await MyERC1155.deploy();
      const airdropTokenId = 1337;
      const airdropAmount = 200;
      await myERC1155.mint(newPairAddress, airdropTokenId, 200);
      await collectionswap.rescueERC1155(
        myERC1155.address,
        [airdropTokenId],
        [airdropAmount],
        newTokenId
      );
      expect(
        await myERC1155.balanceOf(otherAccount0.address, airdropTokenId)
      ).to.be.eq(airdropAmount);
    });
  });
});
