import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { FEE_DECIMALS, PoolType } from "../shared/constants";
import {
  getCurveParameters,
  deployPoolContracts,
  nftFixture,
} from "../shared/fixtures";
import {
  calculateAsk,
  calculateBid,
  changesEtherBalancesFuzzy,
  cumulativeSumWithRoyalties,
  expectAddressToOwnNFTs,
  getPoolAddress,
  mintRandomNfts,
} from "../shared/helpers";
import { getSigners } from "../shared/signers";

import type {
  CollectionPoolETH,
  CollectionPoolFactory,
  Test721Enumerable,
} from "../../../typechain-types";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import type { BigNumber } from "ethers";

describe("CollectionPoolETH", function () {
  let collectionPoolFactory: CollectionPoolFactory;
  let collectionPoolETH: CollectionPoolETH;
  let nft: Test721Enumerable;
  let user: SignerWithAddress;
  let user1: SignerWithAddress;
  let fee: BigNumber;
  let royaltyNumerator: string;

  beforeEach(async function () {
    ({
      collectionPoolFactory,
      collectionPoolETH,
      nft,
      user,
      user1,
      fee,
      royaltyNumerator,
    } = await loadFixture(collectionETHFixture));
  });

  async function collectionETHFixture() {
    const { protocol, user, user1, safeOwner } = await getSigners();
    const { curve, factory } = await deployPoolContracts();
    const { nft } = await nftFixture();
    const nftTokenIds = await mintRandomNfts(nft, user.address);
    await nft.connect(user).setApprovalForAll(factory.address, true);

    const poolType = PoolType.TRADE;
    const fee = ethers.utils.parseUnits("0.89", FEE_DECIMALS);
    const { delta, spotPrice, props, state, royaltyNumerator, protocolFee } =
      getCurveParameters();

    const baseURI = "https://collection.xyz/api/";
    await factory.connect(safeOwner).setBaseURI(baseURI);

    const resp = await factory.connect(user).createPoolETH({
      nft: nft.address,
      bondingCurve: curve.address,
      assetRecipient: ethers.constants.AddressZero,
      receiver: user.address,
      poolType,
      delta,
      fee,
      spotPrice,
      props,
      state,
      royaltyNumerator,
      royaltyRecipientFallback: ethers.constants.AddressZero,
      initialNFTIDs: nftTokenIds,
    });
    const { newPoolAddress: poolAddress, newTokenId: lpTokenId } =
      await getPoolAddress(resp);

    expect(await factory.tokenURI(lpTokenId)).to.equal(
      // Concatenation of baseURI and lpTokenId
      baseURI + lpTokenId
    );

    return {
      collectionPoolFactory: factory,
      collectionPoolETH: await ethers.getContractAt(
        "CollectionPoolETH",
        poolAddress,
        user
      ),
      nft,
      nftTokenIds,
      protocol,
      user,
      user1,
      fee,
      protocolFee,
      royaltyNumerator,
      lpTokenId,
    };
  }

  it("Should have trade fee when buying", async function () {
    const nftsToBuy = 1;
    const [
      _error,
      _newParams,
      _totalAmount,
      inputAmount,
      { trade: tradeFee, protocol: protocolFee },
    ] = await collectionPoolETH.getBuyNFTQuote(nftsToBuy);
    const numNFTs = await nft.balanceOf(user1.address);

    const curveParams = await collectionPoolETH.curveParams();

    // First calculate the expected sale value + royalty amounts
    const buyAmounts = await cumulativeSumWithRoyalties(
      calculateAsk,
      0,
      nftsToBuy,
      -1,
      collectionPoolETH,
      curveParams.spotPrice,
      curveParams.delta,
      curveParams.props,
      fee,
      protocolFee,
      royaltyNumerator
    );

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    let totalBuyRoyalties = 0;
    buyAmounts.slice(1, undefined).forEach((royalty) => {
      totalBuyRoyalties += royalty;
    });

    // The buyer should transfer ETH to the pool, and now own the nft
    const buyTx = await collectionPoolETH
      .connect(user1)
      .swapTokenForAnyNFTs(
        nftsToBuy,
        inputAmount,
        user1.address,
        false,
        ethers.constants.AddressZero,
        {
          value: inputAmount,
        }
      );
    expect(
      await changesEtherBalancesFuzzy(
        buyTx,
        [collectionPoolFactory, collectionPoolETH, user1],
        [
          protocolFee,
          inputAmount.sub(protocolFee),
          // This test suite does not assign royalty recipients, so they go to
          // the pool by default.
          // .sub(ethers.utils.parseEther(totalBuyRoyalties.toFixed(18))),
          inputAmount.mul(-1),
        ]
      )
    ).to.be.true;
    expect(await nft.balanceOf(user1.address)).to.equal(numNFTs.add(1));

    // The pool should accrue trade fees
    expect(await collectionPoolETH.accruedTradeFee()).to.equal(tradeFee);
  });

  it("Should have trade fee when selling", async function () {
    const nftTokenIds = await mintRandomNfts(nft, user1.address);
    await nft.connect(user1).setApprovalForAll(collectionPoolETH.address, true);

    const [
      _error,
      _newParams,
      _totalAmount,
      outputAmount,
      { trade: tradeFee, protocol: protocolFee },
    ] = await collectionPoolETH.getSellNFTQuote(1);

    // Send enough ETH to the pool for it to buy the nfts
    await user.sendTransaction({
      to: collectionPoolETH.address,
      value: outputAmount.add(tradeFee).add(protocolFee),
    });

    const curveParams = await collectionPoolETH.curveParams();

    // First calculate the expected sale value + royalty amounts
    const sellAmounts = await cumulativeSumWithRoyalties(
      calculateBid,
      0,
      nftTokenIds.length,
      1,
      collectionPoolETH,
      curveParams.spotPrice,
      curveParams.delta,
      curveParams.props,
      fee,
      protocolFee,
      royaltyNumerator
    );

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    let totalSellRoyalties = 0;
    sellAmounts.slice(1, undefined).forEach((royalty) => {
      totalSellRoyalties += royalty;
    });

    // The seller should own the nfts
    await expectAddressToOwnNFTs(user1.address, nft, nftTokenIds);

    // The pool should now own the nft, and transfers ETH to the seller
    const sellTx = collectionPoolETH.connect(user1).swapNFTsForToken(
      {
        ids: nftTokenIds,
        proof: [],
        proofFlags: [],
      },
      outputAmount,
      user1.address,
      false,
      ethers.constants.AddressZero
    );
    expect(
      await changesEtherBalancesFuzzy(
        sellTx,
        [collectionPoolFactory, collectionPoolETH, user1],
        [
          protocolFee,
          outputAmount.mul(-1).sub(protocolFee),
          // // This test suite does not assign royalty recipients, so they go to
          // the pool by default.
          // .sub(ethers.utils.parseEther(totalSellRoyalties.toFixed(18))),
          outputAmount,
        ]
      )
    ).to.be.true;

    await expectAddressToOwnNFTs(collectionPoolETH.address, nft, nftTokenIds);

    // The pool should accrue trade fees
    expect(await collectionPoolETH.accruedTradeFee()).to.equal(tradeFee);
  });

  it("Should accrue trade fees", async function () {
    const nftsToBuy = 1;
    let [
      _error,
      _newParams,
      _totalAmount,
      inputAmount,
      { trade: tradeFee1, protocol: protocolFee },
    ] = await collectionPoolETH.getBuyNFTQuote(nftsToBuy);
    const numNFTs = await nft.balanceOf(user1.address);

    const curveParams = await collectionPoolETH.curveParams();

    // First calculate the expected sale value + royalty amounts
    const buyAmounts = await cumulativeSumWithRoyalties(
      calculateAsk,
      0,
      nftsToBuy,
      -1,
      collectionPoolETH,
      curveParams.spotPrice,
      curveParams.delta,
      curveParams.props,
      fee,
      protocolFee,
      royaltyNumerator
    );

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    let totalBuyRoyalties = 0;
    buyAmounts.slice(1, undefined).forEach((royalty) => {
      totalBuyRoyalties += royalty;
    });

    // The buyer should transfer ETH to the pool, and now own the nft
    const buyTx = await collectionPoolETH
      .connect(user1)
      .swapTokenForAnyNFTs(
        nftsToBuy,
        inputAmount,
        user1.address,
        false,
        ethers.constants.AddressZero,
        {
          value: inputAmount,
        }
      );
    expect(
      await changesEtherBalancesFuzzy(
        buyTx,
        [collectionPoolFactory, collectionPoolETH, user1],
        [
          protocolFee,
          inputAmount.sub(protocolFee),
          // This test suite does not assign royalty recipients, so they go to
          // the pool by default.
          // .sub(ethers.utils.parseEther(totalBuyRoyalties.toFixed(18))),
          inputAmount.mul(-1),
        ]
      )
    ).to.be.true;

    expect(await nft.balanceOf(user1.address)).to.equal(numNFTs.add(1));

    // The pool should accrue trade fees
    expect(await collectionPoolETH.accruedTradeFee()).to.equal(tradeFee1);

    let outputAmount;
    let tradeFee2;
    [
      _error,
      _newParams,
      _totalAmount,
      outputAmount,
      { trade: tradeFee2, protocol: protocolFee },
    ] = await collectionPoolETH.getSellNFTQuote(1);
    const nftTokenIds = await mintRandomNfts(nft, user1.address);
    await nft.connect(user1).setApprovalForAll(collectionPoolETH.address, true);

    // The seller should own the nfts
    await expectAddressToOwnNFTs(user1.address, nft, nftTokenIds);

    // First calculate the expected sale value + royalty amounts
    const sellAmounts = await cumulativeSumWithRoyalties(
      calculateBid,
      -1,
      nftTokenIds.length,
      1,
      collectionPoolETH,
      curveParams.spotPrice,
      curveParams.delta,
      curveParams.props,
      fee,
      protocolFee,
      royaltyNumerator
    );

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    let totalSellRoyalties = 0;
    sellAmounts.slice(1, undefined).forEach((royalty) => {
      totalSellRoyalties += royalty;
    });

    // The pool should now own the nft, and transfers ETH to the seller
    const sellTx = await collectionPoolETH.connect(user1).swapNFTsForToken(
      {
        ids: nftTokenIds,
        proof: [],
        proofFlags: [],
      },
      outputAmount,
      user1.address,
      false,
      ethers.constants.AddressZero
    );
    expect(
      await changesEtherBalancesFuzzy(
        sellTx,
        [collectionPoolFactory, collectionPoolETH, user1],
        [
          protocolFee,
          outputAmount.mul(-1).sub(protocolFee),
          // This test suite does not assign royalty recipients, so they go to
          // the pool by default.
          // .sub(ethers.utils.parseEther(totalSellRoyalties.toFixed(18))),
          outputAmount,
        ]
      )
    ).to.be.true;

    await expectAddressToOwnNFTs(collectionPoolETH.address, nft, nftTokenIds);

    // The pool should accrue trade fees
    expect(await collectionPoolETH.accruedTradeFee()).to.equal(
      tradeFee1.add(tradeFee2)
    );
  });

  it("Should not be able to use trade fee when selling", async function () {
    const nftTokenIds = await mintRandomNfts(nft, user1.address, 100);
    await nft.connect(user1).setApprovalForAll(collectionPoolETH.address, true);

    let [
      _error,
      _newParams,
      _totalAmount,
      outputAmount,
      { trade: tradeFee, protocol: protocolFee },
    ] = await collectionPoolETH.getSellNFTQuote(1);

    // First calculate the expected sale value + royalty amounts
    const curveParams = await collectionPoolETH.curveParams();
    const sellAmounts = await cumulativeSumWithRoyalties(
      calculateBid,
      0,
      1,
      1,
      collectionPoolETH,
      curveParams.spotPrice,
      curveParams.delta,
      curveParams.props,
      fee,
      protocolFee,
      royaltyNumerator
    );

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    let totalSellRoyalties = 0;
    sellAmounts.slice(1, undefined).forEach((royalty) => {
      totalSellRoyalties += royalty;
    });

    // Send enough ETH to the pool for it to buy the nfts
    await user.sendTransaction({
      to: collectionPoolETH.address,
      value: outputAmount.add(tradeFee).add(protocolFee),
    });

    // The seller should own the nft
    expect(await nft.ownerOf(nftTokenIds[0])).to.equal(user1.address);

    // The pool should now own the nft, and transfers ETH to the seller
    const sellTx = await collectionPoolETH.connect(user1).swapNFTsForToken(
      {
        ids: [nftTokenIds[0]],
        proof: [],
        proofFlags: [],
      },
      outputAmount,
      user1.address,
      false,
      ethers.constants.AddressZero
    );

    console.log(tradeFee);
    expect(
      await changesEtherBalancesFuzzy(
        sellTx,
        [collectionPoolFactory, collectionPoolETH, user1],
        [
          protocolFee,
          outputAmount.mul(-1).sub(protocolFee),
          // This test suite does not assign royalty recipients, so they go to
          // the pool by default.
          // .sub(ethers.utils.parseEther(totalSellRoyalties.toFixed(18))),
          outputAmount,
        ]
      )
    ).to.be.true;

    expect(await nft.ownerOf(nftTokenIds[0])).to.equal(
      collectionPoolETH.address
    );

    // The pool should accrue the trade fees
    expect(await collectionPoolETH.accruedTradeFee()).to.equal(tradeFee);

    let _fees;
    [_error, _newParams, _totalAmount, outputAmount, _fees] =
      await collectionPoolETH.getSellNFTQuote(1);
    await expect(
      collectionPoolETH.connect(user1).swapNFTsForToken(
        {
          ids: [nftTokenIds[1]],
          proof: [],
          proofFlags: [],
        },
        outputAmount,
        user1.address,
        false,
        ethers.constants.AddressZero
      )
    ).to.be.revertedWithCustomError(collectionPoolETH, "InsufficientLiquidity");
  });

  describe("Withdraw", function () {
    const nftsToBuy = 1;
    beforeEach(async function () {
      let [
        _error,
        _newParams,
        _totalAmount,
        inputAmount,
        { trade: tradeFee1, protocol: protocolFee },
      ] = await collectionPoolETH.getBuyNFTQuote(nftsToBuy);
      const numNFTs = await nft.balanceOf(user1.address);

      const curveParams = await collectionPoolETH.curveParams();

      // First calculate the expected sale value + royalty amounts
      const buyAmounts = await cumulativeSumWithRoyalties(
        calculateAsk,
        0,
        nftsToBuy,
        -1,
        collectionPoolETH,
        curveParams.spotPrice,
        curveParams.delta,
        curveParams.props,
        fee,
        protocolFee,
        royaltyNumerator
      );

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      let totalBuyRoyalties = 0;
      buyAmounts.slice(1, undefined).forEach((royalty) => {
        totalBuyRoyalties += royalty;
      });

      // The buyer should transfer ETH to the pool, and now own the nft
      const buyTx = await collectionPoolETH
        .connect(user1)
        .swapTokenForAnyNFTs(
          nftsToBuy,
          inputAmount,
          user1.address,
          false,
          ethers.constants.AddressZero,
          {
            value: inputAmount,
          }
        );
      expect(
        await changesEtherBalancesFuzzy(
          buyTx,
          [collectionPoolFactory, collectionPoolETH, user1],
          [
            protocolFee,
            inputAmount.sub(protocolFee),
            // This test suite does not assign royalty recipients, so they go to
            // the pool by default.
            // .sub(ethers.utils.parseEther(totalBuyRoyalties.toFixed(18))),
            inputAmount.mul(-1),
          ]
        )
      ).to.be.true;

      expect(await nft.balanceOf(user1.address)).to.equal(numNFTs.add(1));

      // The pool should accrue trade fees
      expect(await collectionPoolETH.accruedTradeFee()).to.equal(tradeFee1);

      let outputAmount;
      let tradeFee2;
      [
        _error,
        _newParams,
        _totalAmount,
        outputAmount,
        { trade: tradeFee2, protocol: protocolFee },
      ] = await collectionPoolETH.getSellNFTQuote(1);

      const nftTokenIds = await mintRandomNfts(nft, user1.address);

      // First calculate the expected sale value + royalty amounts
      const sellAmounts = await cumulativeSumWithRoyalties(
        calculateBid,
        -1, // We bought one from pool just now so -1
        nftTokenIds.length,
        1,
        collectionPoolETH,
        curveParams.spotPrice,
        curveParams.delta,
        curveParams.props,
        fee,
        protocolFee,
        royaltyNumerator
      );

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      let totalSellRoyalties = 0;
      sellAmounts.slice(1, undefined).forEach((royalty) => {
        totalSellRoyalties += royalty;
      });

      await nft
        .connect(user1)
        .setApprovalForAll(collectionPoolETH.address, true);

      // The seller should own the nfts
      await expectAddressToOwnNFTs(user1.address, nft, nftTokenIds);

      // The pool should now own the nft, and transfers ETH to the seller
      const sellTx = await collectionPoolETH.connect(user1).swapNFTsForToken(
        {
          ids: nftTokenIds,
          proof: [],
          proofFlags: [],
        },
        outputAmount,
        user1.address,
        false,
        ethers.constants.AddressZero
      );
      expect(
        await changesEtherBalancesFuzzy(
          sellTx,
          [collectionPoolFactory, collectionPoolETH, user1],
          [
            protocolFee,
            outputAmount.mul(-1).sub(protocolFee),
            // This test suite does not assign royalty recipients, so they go to
            // the pool by default.
            // .sub(ethers.utils.parseEther(totalSellRoyalties.toFixed(18))),
            outputAmount,
          ]
        )
      ).to.be.true;

      await expectAddressToOwnNFTs(collectionPoolETH.address, nft, nftTokenIds);

      // The pool should accrue the trade fees
      expect(await collectionPoolETH.accruedTradeFee()).to.equal(
        tradeFee1.add(tradeFee2)
      );
    });

    it("Should be able to withdraw trade fees", async function () {
      const tradeFee = await collectionPoolETH.accruedTradeFee();
      expect(tradeFee).to.not.equal(0);

      // The user should receive the trade fees
      await expect(
        collectionPoolETH.withdrawAccruedTradeFee()
      ).to.changeEtherBalances(
        [collectionPoolETH, user],
        [tradeFee.mul(-1), tradeFee]
      );

      // Trade fee should be reset to 0
      expect(await collectionPoolETH.accruedTradeFee()).to.equal(0);
    });

    it("Should be able to withdraw all", async function () {
      const tradeFee = await collectionPoolETH.accruedTradeFee();
      expect(tradeFee).to.not.equal(0);

      // The user should receive everything
      const balance = await ethers.provider.getBalance(
        collectionPoolETH.address
      );
      await expect(collectionPoolETH.withdrawAllETH()).to.changeEtherBalances(
        [collectionPoolETH, user],
        [balance.mul(-1), balance]
      );

      // Trade fee should be reset to 0
      expect(await collectionPoolETH.accruedTradeFee()).to.equal(0);
    });

    it("Should not be able to withdraw more than trade fees", async function () {
      const tradeFee = await collectionPoolETH.accruedTradeFee();
      expect(tradeFee).to.not.equal(0);

      // The user should not be able to withdraw
      await expect(collectionPoolETH.withdrawETH(tradeFee)).to.be.revertedWith(
        "Too little ETH"
      );

      // Trade fee should still be the same
      expect(await collectionPoolETH.accruedTradeFee()).to.equal(tradeFee);
    });
  });
});
