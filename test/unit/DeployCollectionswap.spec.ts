import { expect } from "chai";
import { BigNumber } from "ethers";
import { ethers } from "hardhat";

import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import type { Contract, ContractTransaction } from "ethers";

console.log(
  `gas: 1m gas at 10 gwei gasPrice at $2000 ETH is ${
    1e6 * 1e1 * 2000 * 1e-9
  } USD`
);

function closeEnough(a: BigNumber, b: BigNumber): boolean {
  if (a.gte(b)) {
    return a.sub(b).abs().lte(convertToBigNumber(1e-6));
  }

  return b.sub(a).abs().lte(convertToBigNumber(1e-6));
}

// Async function logGas (tx: ContractTransaction) {
//   console.log((await tx.wait()).cumulativeGasUsed)
// }

async function checkGas(tx: ContractTransaction) {
  return (await tx.wait()).cumulativeGasUsed;
}

function sqrtBigNumber(value: BigNumber): BigNumber {
  return ethers.BigNumber.from(
    Math.trunc(Math.sqrt(parseFloat(ethers.utils.formatEther(value)) * 1e18))
  );
}

function exponentialCalcAsk(
  spot: number,
  pctDelta: number,
  fee: number,
  protocolFee: number
): number {
  return (1 + fee + protocolFee) * (1 + pctDelta) * spot;
}

function exponentialCalcBid(
  spot: number,
  _pctDelta: number,
  fee: number,
  protocolFee: number
): number {
  return (1 - fee - protocolFee) * spot;
}

function convertToBigNumber(value: number): BigNumber {
  return ethers.BigNumber.from(`${value * 1e18}`);
}

function createDirectPairETHHelper(
  collectionswap: any,
  thisAccount: SignerWithAddress,
  nftContractCollection: any,
  curve: any,
  _assetRecipient: any,
  _poolType: any,
  delta: any,
  fee: any,
  spotPrice: any,
  newTokenList: any,
  valueToSend: any,
  gasLimit = 1500000
) {
  return collectionswap
    .connect(thisAccount)
    .createDirectPairETH(
      nftContractCollection.address,
      curve.address,
      delta,
      fee,
      spotPrice,
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

async function mintTokensAndApprove(
  initialNFTIDs: number[],
  myERC721: Contract,
  thisAccount: SignerWithAddress,
  lssvmPairFactory: Contract
) {
  for (const nftId of initialNFTIDs) {
    await myERC721.safeMint(
      thisAccount.address,
      nftId,
      "https://www.google.com/"
    );
    await myERC721
      .connect(thisAccount)
      .approve(lssvmPairFactory.address, nftId);
    // Console.log(`owner of ${nftId} is '${await myERC721.ownerOf(nftId)}'`)
  }
}

describe("Collectionswap", function () {
  // Async function deployRewardPoolFactory() {

  // }

  async function deployCollectionswap() {
    const LSSVMPairEnumerableETH = await ethers.getContractFactory(
      "LSSVMPairEnumerableETH"
    );
    const lssvmPairEnumerableETH = await LSSVMPairEnumerableETH.deploy();

    const LSSVMPairMissingEnumerableETH = await ethers.getContractFactory(
      "LSSVMPairMissingEnumerableETH"
    );
    const lssvmPairMissingEnumerableETH =
      await LSSVMPairMissingEnumerableETH.deploy();

    const LSSVMPairEnumerableERC20 = await ethers.getContractFactory(
      "LSSVMPairEnumerableERC20"
    );
    const lssvmPairEnumerableERC20 = await LSSVMPairEnumerableERC20.deploy();

    const LSSVMPairMissingEnumerableERC20 = await ethers.getContractFactory(
      "LSSVMPairMissingEnumerableERC20"
    );
    const lssvmPairMissingEnumerableERC20 =
      await LSSVMPairMissingEnumerableERC20.deploy();
    const payoutAddress = ethers.constants.AddressZero;

    const rawPctProtocolFee = 0.005;
    const rawPctFee = 0.01;
    const rawPctDelta = 0.05;
    const rawSpot = 1;

    const protocolFeeMultiplier = convertToBigNumber(rawPctProtocolFee);
    const LSSVMPairFactory = await ethers.getContractFactory(
      "LSSVMPairFactory"
    );
    const lssvmPairFactory = await LSSVMPairFactory.deploy(
      lssvmPairEnumerableETH.address,
      lssvmPairMissingEnumerableETH.address,
      lssvmPairEnumerableERC20.address,
      lssvmPairMissingEnumerableERC20.address,
      payoutAddress,
      protocolFeeMultiplier
    );
    // Console.log(`LSSVMPairFactory deployed to ${lssvmPairFactory.address}`)

    const [
      otherAccount0,
      otherAccount1,
      otherAccount2,
      otherAccount3,
      otherAccount4,
    ] = await ethers.getSigners();
    // Console.log([otherAccount0.address, otherAccount1.address, otherAccount2.address, otherAccount3.address, otherAccount4.address])

    const MyERC721 = await ethers.getContractFactory("Alchemy");
    const myERC721 = await MyERC721.deploy();

    const MyERC1155 = await ethers.getContractFactory("MyERC1155");
    const myERC1155 = await MyERC1155.deploy();

    const Curve = await ethers.getContractFactory("ExponentialCurve");
    const curve = await Curve.deploy();

    const LinearCurve = await ethers.getContractFactory("LinearCurve");
    const linearCurve = await LinearCurve.deploy();

    const nftContractCollection = myERC721;
    const nftContractCollection1155 = myERC1155;
    const assetRecipient = ethers.constants.AddressZero;
    const poolType = await lssvmPairEnumerableETH.poolType();

    const delta = convertToBigNumber(rawPctDelta + 1);
    const fee = convertToBigNumber(rawPctFee);
    const spotPrice = convertToBigNumber(rawSpot);

    const initialNFTIDs = [999, 1000, 1001];
    await lssvmPairFactory.setBondingCurveAllowed(curve.address, true);
    await lssvmPairFactory.setBondingCurveAllowed(linearCurve.address, true);

    const Collectionswap = await ethers.getContractFactory("Collectionswap");
    const collectionswap = await Collectionswap.deploy(
      lssvmPairFactory.address
    );
    // Console.log(`Collectionswap deployed to ${collectionswap.address}`)

    return {
      collectionswap,
      lssvmPairFactory,
      lssvmPairEnumerableETH,
      lssvmPairMissingEnumerableETH,
      lssvmPairEnumerableERC20,
      lssvmPairMissingEnumerableERC20,
      curve,
      nftContractCollection,
      assetRecipient,
      poolType,
      delta,
      fee,
      spotPrice,
      initialNFTIDs,
      rawSpot,
      rawPctDelta,
      rawPctFee,
      rawPctProtocolFee,
      otherAccount0,
      otherAccount1,
      otherAccount2,
      otherAccount3,
      otherAccount4,
      linearCurve,
      nftContractCollection1155,
    };
  }

  describe("Direct interactions with sudoswap", function () {
    it("Should have a spot price", async function () {
      const {
        lssvmPairFactory,
        nftContractCollection,
        curve,
        assetRecipient,
        poolType,
        delta,
        fee,
        spotPrice,
        initialNFTIDs,
        rawSpot,
        otherAccount0,
      } = await deployCollectionswap();
      await mintTokensAndApprove(
        initialNFTIDs,
        nftContractCollection,
        otherAccount0,
        lssvmPairFactory
      );
      const lssvmPairETHContractTx: ContractTransaction =
        await lssvmPairFactory.createPairETH(
          nftContractCollection.address,
          curve.address,
          assetRecipient,
          poolType,
          delta,
          fee,
          spotPrice,
          initialNFTIDs,
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

    it("Should have an accurate ask price", async function () {
      const {
        lssvmPairFactory,
        nftContractCollection,
        curve,
        assetRecipient,
        poolType,
        delta,
        fee,
        spotPrice,
        initialNFTIDs,
        rawSpot,
        rawPctFee,
        rawPctDelta,
        rawPctProtocolFee,
        otherAccount0,
      } = await deployCollectionswap();
      await mintTokensAndApprove(
        initialNFTIDs,
        nftContractCollection,
        otherAccount0,
        lssvmPairFactory
      );
      const lssvmPairETHContractTx: ContractTransaction =
        await lssvmPairFactory.createPairETH(
          nftContractCollection.address,
          curve.address,
          assetRecipient,
          poolType,
          delta,
          fee,
          spotPrice,
          initialNFTIDs,
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
      const buyPriceQuote = (await lssvmPairETH.getBuyNFTQuote(1))[3];
      const buyPriceQuoteSelfCalc = convertToBigNumber(
        exponentialCalcAsk(rawSpot, rawPctDelta, rawPctFee, rawPctProtocolFee)
      );
      expect(closeEnough(buyPriceQuote, buyPriceQuoteSelfCalc)).to.be.true;
    });

    it("Should have an accurate bid price", async function () {
      const {
        lssvmPairFactory,
        nftContractCollection,
        curve,
        assetRecipient,
        poolType,
        delta,
        fee,
        spotPrice,
        initialNFTIDs,
        rawSpot,
        rawPctFee,
        rawPctDelta,
        rawPctProtocolFee,
        otherAccount0,
      } = await deployCollectionswap();
      await mintTokensAndApprove(
        initialNFTIDs,
        nftContractCollection,
        otherAccount0,
        lssvmPairFactory
      );
      const lssvmPairETHContractTx: ContractTransaction =
        await lssvmPairFactory.createPairETH(
          nftContractCollection.address,
          curve.address,
          assetRecipient,
          poolType,
          delta,
          fee,
          spotPrice,
          initialNFTIDs,
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
      const sellPriceQuote = (await lssvmPairETH.getSellNFTQuote(1))[3];
      const sellPriceQuoteSelfCalc = convertToBigNumber(
        exponentialCalcBid(rawSpot, rawPctDelta, rawPctFee, rawPctProtocolFee)
      );
      expect(closeEnough(sellPriceQuote, sellPriceQuoteSelfCalc)).to.be.true;
    });

    it("Should have errors if value is not enough to bid, AND is sold into", async function () {
      const {
        lssvmPairFactory,
        nftContractCollection,
        curve,
        assetRecipient,
        poolType,
        delta,
        fee,
        spotPrice,
        initialNFTIDs,
        otherAccount0,
        otherAccount4,
      } = await deployCollectionswap();
      await mintTokensAndApprove(
        initialNFTIDs,
        nftContractCollection,
        otherAccount0,
        lssvmPairFactory
      );
      const lssvmPairETHContractTx: ContractTransaction =
        await lssvmPairFactory.createPairETH(
          nftContractCollection.address,
          curve.address,
          assetRecipient,
          poolType,
          delta,
          fee,
          spotPrice.mul(ethers.BigNumber.from(`${1e10}`)),
          initialNFTIDs,
          {
            // Value: ethers.BigNumber.from(`${1.2e16}`),
            value: ethers.BigNumber.from(`${1.2e16}`).mul(
              ethers.BigNumber.from(`${1e3}`)
            ),
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
        bidInputAmount,
        _bidProtocolFee,
        _bidnObj,
      ] = await lssvmPairETH.getSellNFTQuote(externalTraderNftsIHave.length);

      // Console.log([bidError, bidNewSpotPrice, bidNewDelta, bidInputAmount, bidProtocolFee, bidnObj])

      await mintTokensAndApprove(
        externalTraderNftsIHave,
        nftContractCollection,
        otherAccount4,
        lssvmPairFactory
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
      ).to.be.revertedWith("ETH_TRANSFER_FAILED");

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
        linearCurve,
        assetRecipient,
        poolType,
        otherAccount0,
        otherAccount4,
      } = await deployCollectionswap();
      const nftList = [1, 2, 3, 4, 5];
      await mintTokensAndApprove(
        nftList,
        nftContractCollection,
        otherAccount0,
        lssvmPairFactory
      );
      const lssvmPairETHContractTx: ContractTransaction =
        await lssvmPairFactory.createPairETH(
          nftContractCollection.address,
          linearCurve.address,
          assetRecipient,
          poolType,
          ethers.utils.parseEther("0.25"),
          ethers.utils.parseEther("0.1"),
          ethers.utils.parseEther("1"),
          nftList,
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
          bidInputAmount,
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
          askOutputAmount,
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
      } = await deployCollectionswap();

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
        curve,
        assetRecipient,
        poolType,
        delta,
        fee,
        spotPrice,
        initialNFTIDs,
        otherAccount0,
        otherAccount1,
        otherAccount2,
        collectionswap,
      } = await deployCollectionswap();
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
        createDirectPairETHHelper(
          collectionswap,
          otherAccount0,
          nftContractCollection,
          curve,
          assetRecipient,
          poolType,
          delta,
          fee,
          spotPrice,
          initialNFTIDs,
          valueToSend
        )
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
        nftContractCollection,
        curve,
        assetRecipient,
        poolType,
        delta,
        fee,
        spotPrice,
        initialNFTIDs,
        valueToSend
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
            .useLPTokenToDestroyDirectPairETH(newTokenId, {
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
          .useLPTokenToDestroyDirectPairETH(newTokenId, {
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
          .useLPTokenToDestroyDirectPairETH(newTokenId, {
            gasLimit: 2000000,
          })
      ).to.be.revertedWith("pool already destroyed");
    });

    it("Should have LP tokens with non-clashing IDs", async function () {
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
        otherAccount1,
        otherAccount2,
        collectionswap,
      } = await deployCollectionswap();

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
          nftContractCollection,
          curve,
          assetRecipient,
          poolType,
          delta,
          fee,
          spotPrice,
          tokenIdList,
          ethers.BigNumber.from(`${1.2e18}`)
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

    it("Should have a measurable contribution function", async function () {
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
      } = await deployCollectionswap();

      //   Const theseAccounts = [otherAccount0, otherAccount1, otherAccount2]
      const theseAccounts = [otherAccount0];
      //   Let i = 1
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
          nftContractCollection,
          curve,
          assetRecipient,
          poolType,
          delta,
          fee,
          spotPrice,
          tokenIdList,
          ethers.BigNumber.from(`${1.2e18}`)
        );

        const { newTokenId } = await getPoolAddress(newPair);

        expect(
          await collectionswap.getMeasurableContribution(newTokenId)
        ).to.be.eq(
          ethers.BigNumber.from(
            Math.trunc(Math.sqrt(tokenIdList.length * 1.2e18))
          )
        );
      }
    });

    it("Should have owner be able to destroy even if original tokenIds are not in the pool", async function () {
      const {
        lssvmPairFactory,
        nftContractCollection,
        curve,
        assetRecipient,
        poolType,
        delta,
        fee,
        spotPrice,
        rawSpot,
        otherAccount0,
        otherAccount1,
        otherAccount2,
        collectionswap,
      } = await deployCollectionswap();

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
            nftContractCollection,
            curve,
            assetRecipient,
            poolType,
            delta,
            fee,
            spotPrice,
            tokenIdList,
            ethers.BigNumber.from(`${1.2e18}`)
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
      const maxExpectedTokenInput = convertToBigNumber(
        rawSpot * (nftsIWant.length + 1)
      );

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

      const [
        _askError,
        _askNewSpotPrice,
        _askNewDelta,
        askInputAmount,
        askProtocolFee,
        _asknObj,
      ] = await lssvmPairETH.getBuyNFTQuote(nftsIWant.length);
      // Console.log(await lssvmPairETH.getBuyNFTQuote(nftsIWant.length))

      // TODO: test balance
      await expect(
        lssvmPairETH
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
          )
      ).to.changeEtherBalances(
        [externalTrader.address, lssvmPairETH.address],
        [askInputAmount.mul(-1), askInputAmount.sub(askProtocolFee)]
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

      const [
        _bidError,
        _bidNewSpotPrice,
        _bidNewDelta,
        bidInputAmount,
        bidProtocolFee,
        _bidnObj,
      ] = await lssvmPairETH.getSellNFTQuote(externalTraderNftsIHave.length);

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
      ).to.changeEtherBalances(
        [externalTrader.address, lssvmPairETH.address],
        [bidInputAmount.mul(1), bidInputAmount.mul(-1).sub(bidProtocolFee)]
      );

      const poolBalance = await ethers.provider.getBalance(
        lssvmPairETH.address
      );
      await expect(
        collectionswap
          .connect(originalPoolCreator)
          .useLPTokenToDestroyDirectPairETH(1, {
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

    it("Should create reward pools", async function () {
      const {
        collectionswap,
        nftContractCollection,
        curve,
        fee,
        delta,
        spotPrice,
        otherAccount0,
        otherAccount1,
        otherAccount4,
        lssvmPairFactory,
        assetRecipient,
        poolType,
      } = await deployCollectionswap();
      const RewardPoolFactory = await ethers.getContractFactory(
        "RewardPoolFactory"
      );
      const rewardPoolFactory = await RewardPoolFactory.deploy(
        collectionswap.address
      );
      const rewardPoolAddressTx = await rewardPoolFactory
        .connect(otherAccount4)
        .createRewardPool(
          nftContractCollection.address,
          ethers.constants.AddressZero,
          curve.address,
          fee,
          delta,
          spotPrice
        );

      const rewardPoolAddressReceipt = await rewardPoolAddressTx.wait();

      // Expect gas to be under 500k
      // await expect(receipt.cumulativeGasUsed).to.be.lt(BigNumber.from('451000'))
      expect(rewardPoolAddressReceipt.cumulativeGasUsed).to.be.lt(
        BigNumber.from("2000000")
      );

      const rewardPoolAddress = rewardPoolAddressReceipt.events?.find(
        (e) => e.event === "NewRewardPool"
      )?.args?.rewardPoolAddress;

      const rewardPool = await ethers.getContractAt(
        "RewardPool",
        rewardPoolAddress
      );

      let i = 100000;
      for (const poolContributor of [otherAccount0, otherAccount1]) {
        const tokenIdList = [i, i + 1000];
        await mintTokensAndApprove(
          tokenIdList,
          nftContractCollection,
          poolContributor,
          lssvmPairFactory
        );

        const valueToSend = spotPrice.mul(tokenIdList.length);
        await nftContractCollection
          .connect(poolContributor)
          .setApprovalForAll(collectionswap.address, true);

        const newPair = await createDirectPairETHHelper(
          collectionswap,
          poolContributor,
          nftContractCollection,
          curve,
          assetRecipient,
          poolType,
          delta,
          fee,
          spotPrice,
          tokenIdList,
          valueToSend
        );

        const { newTokenId } = await getPoolAddress(newPair);

        await expect(
          rewardPool.connect(poolContributor).deposit(newTokenId)
        ).to.be.revertedWith("ERC721: caller is not token owner nor approved");

        // Gas should be less than 47k for approvals
        expect(
          (
            await (
              await collectionswap
                .connect(poolContributor)
                .setApprovalForAll(rewardPool.address, true)
            ).wait()
          ).cumulativeGasUsed
        ).to.be.lte(BigNumber.from("47000"));

        const poolDepositTx = await rewardPool
          .connect(poolContributor)
          .deposit(newTokenId);
        expect(await checkGas(poolDepositTx)).to.be.lte(
          BigNumber.from("308000")
        );
        expect(await collectionswap.ownerOf(newTokenId)).to.be.eq(
          rewardPool.address
        );

        expect(
          await rewardPool.getMyContribution(poolContributor.address)
        ).to.be.eq(sqrtBigNumber(valueToSend.mul(tokenIdList.length)));

        expect(
          await rewardPool.getMyContribution(otherAccount4.address)
        ).to.be.eq(BigNumber.from("0"));

        const lpTokenList = [newTokenId];

        const poolWithdrawTx = await rewardPool
          .connect(poolContributor)
          .withdrawAll(lpTokenList);
        expect(await checkGas(poolWithdrawTx)).to.be.lte(
          BigNumber.from("115000")
        );
        expect(await collectionswap.ownerOf(newTokenId)).to.be.eq(
          poolContributor.address
        );
        i++;
      }

      let j = 12345;
      for (const poolContributor of [otherAccount0, otherAccount1]) {
        const tokenIdList = [j, j + 1000];
        const valueToSend = spotPrice.mul(tokenIdList.length);
        await mintTokensAndApprove(
          tokenIdList,
          nftContractCollection,
          poolContributor,
          lssvmPairFactory
        );

        const newPairErrant = await createDirectPairETHHelper(
          collectionswap,
          poolContributor,
          nftContractCollection,
          curve,
          assetRecipient,
          poolType,
          delta,
          fee.add(1),
          spotPrice,
          tokenIdList,
          valueToSend
        );

        const { newTokenId: newTokenIdErrant } = await getPoolAddress(
          newPairErrant
        );

        await expect(
          rewardPool.connect(poolContributor).deposit(newTokenIdErrant)
        ).to.be.revertedWith("LPToken params do not match RewardPool params");
        j++;
      }
    });

    it("should be able to (rewardspool) go through multiple cycles of depositing and withdrawing", async function () {
      const {
        collectionswap,
        nftContractCollection,
        curve,
        fee,
        delta,
        spotPrice,
        otherAccount0,
        otherAccount4,
        lssvmPairFactory,
        assetRecipient,
        poolType,
      } = await deployCollectionswap();
      const RewardPoolFactory = await ethers.getContractFactory(
        "RewardPoolFactory"
      );
      const rewardPoolFactory = await RewardPoolFactory.deploy(
        collectionswap.address
      );
      const rewardPoolAddressTx = await rewardPoolFactory
        .connect(otherAccount4)
        .createRewardPool(
          nftContractCollection.address,
          ethers.constants.AddressZero,
          curve.address,
          // Collectionswap.address,
          fee,
          delta,
          spotPrice
        );

      const rewardPoolAddressReceipt = await rewardPoolAddressTx.wait();
      const rewardPoolAddress = rewardPoolAddressReceipt.events?.find(
        (e) => e.event === "NewRewardPool"
      )?.args?.rewardPoolAddress;
      const rewardPool = await ethers.getContractAt(
        "RewardPool",
        rewardPoolAddress
      );

      // Add the tokenIds 25 times to get 25 LP tokens

      // create list of singleton list of one tokenId, 1 to 25
      const listOfLists = Array.from(Array(25).keys()).map((i) => [i + 1]);
      // Console.log(listOfLists)

      let i = 1;
      const poolContributor = otherAccount0;
      await nftContractCollection
        .connect(poolContributor)
        .setApprovalForAll(collectionswap.address, true);

      for (const tokenIdList of listOfLists) {
        await mintTokensAndApprove(
          tokenIdList,
          nftContractCollection,
          poolContributor,
          lssvmPairFactory
        );

        const valueToSend = spotPrice.mul(tokenIdList.length);

        const newPair = await createDirectPairETHHelper(
          collectionswap,
          poolContributor,
          nftContractCollection,
          curve,
          assetRecipient,
          poolType,
          delta,
          fee,
          spotPrice,
          tokenIdList,
          valueToSend
        );

        const { newTokenId } = await getPoolAddress(newPair);
        expect(newTokenId).to.be.eq(i);
        i++;
      }

      const lpTokenSequences = [
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        [11, 12, 13],
        [14],
        [15, 16, 17, 18],
        [19, 20],
        [21, 22, 23, 24, 25],
      ];

      expect(
        (
          await (
            await collectionswap
              .connect(poolContributor)
              .setApprovalForAll(rewardPool.address, true)
          ).wait()
        ).cumulativeGasUsed
      ).to.be.lte(BigNumber.from("47000"));

      for (const lpTokenList of lpTokenSequences) {
        // Console.log(lpTokenList.length)

        for (const lpTokenId of lpTokenList) {
          const poolDepositTx = await rewardPool
            .connect(poolContributor)
            .deposit(lpTokenId);
          // Console.log('deposit gas', await checkGas(poolDepositTx))
          expect(await checkGas(poolDepositTx)).to.be.lte(
            BigNumber.from("321000")
          );
        }

        const nftBaseNum = 1;
        const ethBaseNum = spotPrice.mul(nftBaseNum);
        const expectedContribution = sqrtBigNumber(
          ethBaseNum.mul(nftBaseNum)
        ).mul(lpTokenList.length);

        const [myContribution, totalContribution] =
          await rewardPool.getMyAndTotalContribution(poolContributor.address);
        expect(myContribution).to.be.eq(expectedContribution);
        expect(totalContribution).to.be.eq(myContribution);

        const poolWithdrawTx = await rewardPool
          .connect(poolContributor)
          .withdrawAll(lpTokenList);
        // Console.log('withdraw gas', await checkGas(poolWithdrawTx))
        expect(await checkGas(poolWithdrawTx)).to.be.lte(
          BigNumber.from("65000").add(
            BigNumber.from("55000").mul(lpTokenList.length)
          )
        );
      }
    });

    it("should be able to take contributions from multiple users and keep the right contribution ratio", async function () {
      const {
        collectionswap,
        nftContractCollection,
        curve,
        fee,
        delta,
        spotPrice,
        otherAccount0,
        otherAccount1,
        otherAccount2,
        otherAccount3,
        otherAccount4,
        lssvmPairFactory,
        assetRecipient,
        poolType,
        rawSpot,
      } = await deployCollectionswap();
      const RewardPoolFactory = await ethers.getContractFactory(
        "RewardPoolFactory"
      );
      const rewardPoolFactory = await RewardPoolFactory.deploy(
        collectionswap.address
      );
      const rewardPoolAddressTx = await rewardPoolFactory
        .connect(otherAccount4)
        .createRewardPool(
          nftContractCollection.address,
          ethers.constants.AddressZero,
          curve.address,
          // Collectionswap.address,
          fee,
          delta,
          spotPrice
        );

      const rewardPoolAddressReceipt = await rewardPoolAddressTx.wait();
      const rewardPoolAddress = rewardPoolAddressReceipt.events?.find(
        (e) => e.event === "NewRewardPool"
      )?.args?.rewardPoolAddress;
      const rewardPool = await ethers.getContractAt(
        "RewardPool",
        rewardPoolAddress
      );
      expect(await rewardPool.owner()).to.be.eq(otherAccount4.address);

      const ACCOUNT_MAP: Record<string, Record<string, any>> = {
        acct0: {
          account: otherAccount0,
          baseTokenIdList: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        },
        acct1: {
          account: otherAccount1,
          baseTokenIdList: [11, 12],
        },
        acct2: {
          account: otherAccount2,
          baseTokenIdList: [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25],
        },
        acct3: {
          account: otherAccount3,
          baseTokenIdList: [
            26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40,
          ],
        },
        acct3Partner: {
          account: otherAccount3,
          baseTokenIdList: [41],
        },
      };

      // Iterate through ACCOUNT_MAP and create the pools
      let expectedTotalContribution = BigNumber.from(0);

      for (const [acctName, acctInfo] of Object.entries(ACCOUNT_MAP)) {
        const { account, baseTokenIdList } = acctInfo;
        // Console.log(acctName, account.address, baseTokenIdList)
        await nftContractCollection
          .connect(account)
          .setApprovalForAll(collectionswap.address, true);

        await mintTokensAndApprove(
          baseTokenIdList,
          nftContractCollection,
          account,
          lssvmPairFactory
        );
        const valueToSend = spotPrice.mul(baseTokenIdList.length);

        const newPair = await createDirectPairETHHelper(
          collectionswap,
          account,
          nftContractCollection,
          curve,
          assetRecipient,
          poolType,
          delta,
          fee,
          spotPrice,
          baseTokenIdList,
          valueToSend,
          1000000 + 100000 * baseTokenIdList.length
        );

        const showGas = false;
        // Console.log(baseTokenIdList.length)
        const { newPairAddress, newTokenId } = await getPoolAddress(
          newPair,
          showGas
        );
        // Await expect(newTokenId).to.be.eq(baseTokenIdList[0])
        ACCOUNT_MAP[acctName].poolAddress = newPairAddress;
        ACCOUNT_MAP[acctName].poolTokenId = newTokenId;

        await collectionswap
          .connect(account)
          .setApprovalForAll(rewardPool.address, true);

        const poolDepositTx = await rewardPool
          .connect(account)
          .deposit(newTokenId);
        expect(await checkGas(poolDepositTx)).to.be.lte(
          BigNumber.from("308000")
        );

        const nftBaseNum = 1;
        const ethBaseNum = spotPrice.mul(nftBaseNum);
        const expectedContribution = sqrtBigNumber(
          ethBaseNum.mul(nftBaseNum)
        ).mul(baseTokenIdList.length);
        expectedTotalContribution =
          expectedTotalContribution.add(expectedContribution);
        ACCOUNT_MAP[acctName].expectedContribution = expectedContribution;
      }

      // Console.log(ACCOUNT_MAP)
      const ACCOUNT_GROUP: Record<string, BigNumber> = {};

      // Iterate through ACCOUNT_MAP and check the contribution ratio
      for (const [, acctInfo] of Object.entries(ACCOUNT_MAP)) {
        const { account, expectedContribution } = acctInfo;

        // Add expectedContributions to the ACCOUNT_GROUP
        // check if account.address in ACCOUNT_GROUP
        if (account.address in ACCOUNT_GROUP) {
          ACCOUNT_GROUP[account.address] =
            ACCOUNT_GROUP[account.address].add(expectedContribution);
        } else {
          ACCOUNT_GROUP[account.address] = expectedContribution;
        }
        // ACCOUNT_GROUP[account.address] = expectedContribution
      }

      for (const [accountAddress, expectedContribution] of Object.entries(
        ACCOUNT_GROUP
      )) {
        const [myContribution, totalContribution] =
          await rewardPool.getMyAndTotalContribution(accountAddress);
        // Console.log([myContribution, totalContribution])
        expect(myContribution).to.be.eq(expectedContribution);
        expect(totalContribution).to.be.eq(expectedTotalContribution);
      }

      // Show the recalcAllContributions gas
      const totalContribution0 = await rewardPool.totalContribution();

      const externalTrader = otherAccount4;
      const lssvmPairETH = await ethers.getContractAt(
        "LSSVMPairETH",
        ACCOUNT_MAP.acct0.poolAddress
      );
      const numNfts = 5;
      const [
        _askError,
        _askNewSpotPrice,
        _askNewDelta,
        askInputAmount,
        _askProtocolFee,
        _asknObj,
      ] = await lssvmPairETH.getBuyNFTQuote(numNfts);
      const maxExpectedTokenInput = convertToBigNumber(rawSpot * (numNfts + 1));
      await lssvmPairETH
        .connect(externalTrader)
        .swapTokenForAnyNFTs(
          1,
          askInputAmount,
          externalTrader.address,
          false,
          ethers.constants.AddressZero,
          {
            value: maxExpectedTokenInput,
            gasLimit: 1500000,
          }
        );
      const recalcAllContributionsTx =
        await rewardPool.recalcAllContributions();
      console.log(
        "recalcAllContributions gas",
        await checkGas(recalcAllContributionsTx)
      );

      const totalContribution1 = await rewardPool.totalContribution();
      // Console.log(totalContribution0, totalContribution1)

      // total contribution should have changed
      expect(totalContribution1).to.not.be.eq(totalContribution0);

      for (const thisAccount of [
        otherAccount0,
        otherAccount1,
        otherAccount2,
        otherAccount3,
      ]) {
        await expect(
          rewardPool
            .connect(thisAccount)
            .recalcContributionByAddress(thisAccount.address)
        ).to.be.revertedWith("Ownable: caller is not the owner");
      }

      for (const thisAccount of [otherAccount4]) {
        await rewardPool
          .connect(thisAccount)
          .recalcContributionByAddress(thisAccount.address);
        await expect(
          rewardPool
            .connect(thisAccount)
            .recalcContributionByAddressByIndex(thisAccount.address, 0, 1)
        ).to.be.revertedWith("lpEndIndex out of range");
        await expect(
          rewardPool
            .connect(thisAccount)
            .recalcContributionByAddressByIndex(thisAccount.address, 0, 0)
        ).to.not.be.reverted;
        await expect(
          rewardPool
            .connect(thisAccount)
            .recalcContributionByAddressByIndex(otherAccount3.address, 0, 3)
        ).to.be.revertedWith("lpEndIndex out of range");
        await expect(
          rewardPool
            .connect(thisAccount)
            .recalcContributionByAddressByIndex(otherAccount3.address, 0, 2)
        ).to.not.be.reverted;
      }

      // Iterate through ACCOUNT_MAP and withdraw all
      for (const [, acctInfo] of Object.entries(ACCOUNT_MAP)) {
        const { account, baseTokenIdList, poolTokenId, expectedContribution } =
          acctInfo;

        const poolWithdrawTx = await rewardPool
          .connect(account)
          .withdrawAll([poolTokenId]);
        expect(await checkGas(poolWithdrawTx)).to.be.lte(
          BigNumber.from("50000").add(
            BigNumber.from("55000").mul(baseTokenIdList.length)
          )
        );

        expectedTotalContribution =
          expectedTotalContribution.sub(expectedContribution);
        const [myContribution, totalContribution] =
          await rewardPool.getMyAndTotalContribution(account.address);
        // Console.log([myContribution, totalContribution])
        expect(myContribution).to.be.eq(0);
        expect(totalContribution).to.be.eq(expectedTotalContribution);
      }
    });

    it("should have owner be able to rescue ERC20 tokens directly sent to the CollectionSwap contract", async function () {
      const { collectionswap } = await deployCollectionswap();
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
      const { otherAccount1, collectionswap } = await deployCollectionswap();
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
        curve,
        assetRecipient,
        poolType,
        delta,
        fee,
        spotPrice,
        otherAccount0,
        collectionswap,
      } = await deployCollectionswap();
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
        nftContractCollection,
        curve,
        assetRecipient,
        poolType,
        delta,
        fee,
        spotPrice,
        tokenIdList,
        ethers.BigNumber.from(`${1.2e18}`)
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
      } = await deployCollectionswap();
      const tokenIdList = [500, 1000, 1500];
      await mintTokensAndApprove(
        tokenIdList,
        nftContractCollection,
        otherAccount0,
        lssvmPairFactory
      );
      const tokenId = 2000;
      await nftContractCollection.safeMint(
        collectionswap.address,
        tokenId,
        "https://www.google.com/"
      );
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
        await deployCollectionswap();
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
        curve,
        assetRecipient,
        poolType,
        delta,
        fee,
        spotPrice,
        otherAccount0,
        collectionswap,
      } = await deployCollectionswap();
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
        nftContractCollection,
        curve,
        assetRecipient,
        poolType,
        delta,
        fee,
        spotPrice,
        tokenIdList,
        ethers.BigNumber.from(`${1.2e18}`)
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
        curve,
        assetRecipient,
        poolType,
        delta,
        fee,
        spotPrice,
        otherAccount0,
        otherAccount2,
        collectionswap,
      } = await deployCollectionswap();
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
        nftContractCollection,
        curve,
        assetRecipient,
        poolType,
        delta,
        fee,
        spotPrice,
        tokenIdList,
        ethers.BigNumber.from(`${1.2e18}`)
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
        curve,
        assetRecipient,
        poolType,
        delta,
        fee,
        spotPrice,
        otherAccount0,
        collectionswap,
      } = await deployCollectionswap();
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
        nftContractCollection,
        curve,
        assetRecipient,
        poolType,
        delta,
        fee,
        spotPrice,
        tokenIdList,
        ethers.BigNumber.from(`${1.2e18}`)
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
      const { otherAccount0, collectionswap } = await deployCollectionswap();
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
        await deployCollectionswap();
      await expect(
        collectionswap
          .connect(otherAccount1)
          .rescueERC1155(nftContractCollection.address, [100], [1], 0)
      ).to.be.revertedWith("not owner");
    });

    it("should prevent non-approved callers from rescuing ERC1155 tokens", async function () {
      const { nftContractCollection, otherAccount2, collectionswap } =
        await deployCollectionswap();
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
        curve,
        assetRecipient,
        poolType,
        delta,
        fee,
        spotPrice,
        otherAccount0,
        collectionswap,
      } = await deployCollectionswap();
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
        nftContractCollection,
        curve,
        assetRecipient,
        poolType,
        delta,
        fee,
        spotPrice,
        tokenIdList,
        ethers.BigNumber.from(`${1.2e18}`)
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
