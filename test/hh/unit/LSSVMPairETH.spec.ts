import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import {
  getCurveParameters,
  lsSVMFixture,
  nftFixture,
} from "../shared/fixtures";
import {
  calculateAsk,
  calculateBid,
  changesEtherBalancesFuzzy,
  cumulativeSumWithRoyalties,
  expectAddressToOwnNFTs,
  mintNfts,
} from "../shared/helpers";
import { getSigners } from "../shared/signers";

import type {
  LSSVMPairETH,
  LSSVMPairFactory,
  Test721Enumerable,
} from "../../../typechain-types";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import type { BigNumber } from "ethers";

describe("LSSVMPairETH", function () {
  let lsSVMPairFactory: LSSVMPairFactory;
  let lssvmPairETH: LSSVMPairETH;
  let nft: Test721Enumerable;
  let user: SignerWithAddress;
  let user1: SignerWithAddress;
  let fee: BigNumber;
  let royaltyNumerator: string;

  beforeEach(async function () {
    ({
      lsSVMPairFactory,
      lssvmPairETH,
      nft,
      user,
      user1,
      fee,
      royaltyNumerator,
    } = await loadFixture(lsSVMETHFixture));
  });

  async function lsSVMETHFixture() {
    const { protocol, user, user1 } = await getSigners();
    const { curve, factory } = await lsSVMFixture();
    const { nft } = await nftFixture();
    const nftTokenIds = await mintNfts(nft, user.address);
    await nft.connect(user).setApprovalForAll(factory.address, true);

    const poolType = 2;
    const fee = ethers.utils.parseEther("0.89");
    const { delta, spotPrice, props, state, royaltyNumerator, protocolFee } =
      getCurveParameters();

    const resp = await factory.connect(user).createPairETH({
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
      initialNFTIDs: nftTokenIds,
    });
    const receipt = await resp.wait();

    return {
      lsSVMPairFactory: factory,
      lssvmPairETH: await ethers.getContractAt(
        "LSSVMPairETH",
        receipt.events![5].args!.poolAddress,
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
    };
  }

  it("Should have trade fee when buying", async function () {
    const nftsToBuy = 1;
    const [
      _error,
      _newSpotPrice,
      _newDelta,
      _newState,
      inputAmount,
      tradeFee,
      protocolFee,
    ] = await lssvmPairETH.getBuyNFTQuote(nftsToBuy);
    const numNFTs = await nft.balanceOf(user1.address);

    const curveParams = await lssvmPairETH.curveParams();

    // First calculate the expected sale value + royalty amounts
    const buyAmounts = await cumulativeSumWithRoyalties(
      calculateAsk,
      0,
      nftsToBuy,
      -1,
      lssvmPairETH,
      curveParams.spotPrice,
      curveParams.delta,
      curveParams.props,
      fee,
      protocolFee,
      royaltyNumerator
    );
    let totalBuyRoyalties = 0;
    buyAmounts.slice(1, undefined).forEach((royalty) => {
      totalBuyRoyalties += royalty;
    });

    // The buyer should transfer ETH to the pair, and now own the nft
    const buyTx = await lssvmPairETH
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
        [lsSVMPairFactory, lssvmPairETH, user1],
        [
          protocolFee,
          inputAmount
            .sub(protocolFee)
            .sub(ethers.utils.parseEther(totalBuyRoyalties.toFixed(18))),
          inputAmount.mul(-1),
        ]
      )
    ).to.be.true;
    expect(await nft.balanceOf(user1.address)).to.equal(numNFTs.add(1));

    // The pair should accrue trade fees
    expect(await lssvmPairETH.tradeFee()).to.equal(tradeFee);
  });

  it("Should have trade fee when selling", async function () {
    const nftTokenIds = await mintNfts(nft, user1.address);
    await nft.connect(user1).setApprovalForAll(lssvmPairETH.address, true);

    const [
      _error,
      _newSpotPrice,
      _newDelta,
      _newState,
      outputAmount,
      tradeFee,
      protocolFee,
    ] = await lssvmPairETH.getSellNFTQuote(1);

    // Send enough ETH to the pair for it to buy the nfts
    await user.sendTransaction({
      to: lssvmPairETH.address,
      value: outputAmount.add(tradeFee),
    });

    const curveParams = await lssvmPairETH.curveParams();

    // First calculate the expected sale value + royalty amounts
    const sellAmounts = await cumulativeSumWithRoyalties(
      calculateBid,
      0,
      nftTokenIds.length,
      1,
      lssvmPairETH,
      curveParams.spotPrice,
      curveParams.delta,
      curveParams.props,
      fee,
      protocolFee,
      royaltyNumerator
    );
    let totalSellRoyalties = 0;
    sellAmounts.slice(1, undefined).forEach((royalty) => {
      totalSellRoyalties += royalty;
    });

    // The seller should own the nfts
    await expectAddressToOwnNFTs(user1.address, nft, nftTokenIds);

    // The pair should now own the nft, and transfers ETH to the seller
    const sellTx = lssvmPairETH
      .connect(user1)
      .swapNFTsForToken(
        nftTokenIds,
        [],
        [],
        outputAmount,
        user1.address,
        false,
        ethers.constants.AddressZero
      );
    expect(
      await changesEtherBalancesFuzzy(
        sellTx,
        [lsSVMPairFactory, lssvmPairETH, user1],
        [
          protocolFee,
          outputAmount
            .mul(-1)
            .sub(protocolFee)
            .sub(ethers.utils.parseEther(totalSellRoyalties.toFixed(18))),
          outputAmount,
        ]
      )
    ).to.be.true;

    await expectAddressToOwnNFTs(lssvmPairETH.address, nft, nftTokenIds);

    // The pair should accrue trade fees
    expect(await lssvmPairETH.tradeFee()).to.equal(tradeFee);
  });

  it("Should accrue trade fees", async function () {
    const nftsToBuy = 1;
    let [
      _error,
      _newSpotPrice,
      _newDelta,
      _newState,
      inputAmount,
      tradeFee1,
      protocolFee,
    ] = await lssvmPairETH.getBuyNFTQuote(nftsToBuy);
    const numNFTs = await nft.balanceOf(user1.address);

    const curveParams = await lssvmPairETH.curveParams();

    // First calculate the expected sale value + royalty amounts
    const buyAmounts = await cumulativeSumWithRoyalties(
      calculateAsk,
      0,
      nftsToBuy,
      -1,
      lssvmPairETH,
      curveParams.spotPrice,
      curveParams.delta,
      curveParams.props,
      fee,
      protocolFee,
      royaltyNumerator
    );
    let totalBuyRoyalties = 0;
    buyAmounts.slice(1, undefined).forEach((royalty) => {
      totalBuyRoyalties += royalty;
    });

    // The buyer should transfer ETH to the pair, and now own the nft
    const buyTx = await lssvmPairETH
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
        [lsSVMPairFactory, lssvmPairETH, user1],
        [
          protocolFee,
          inputAmount
            .sub(protocolFee)
            .sub(ethers.utils.parseEther(totalBuyRoyalties.toFixed(18))),
          inputAmount.mul(-1),
        ]
      )
    ).to.be.true;

    expect(await nft.balanceOf(user1.address)).to.equal(numNFTs.add(1));

    // The pair should accrue trade fees
    expect(await lssvmPairETH.tradeFee()).to.equal(tradeFee1);

    let outputAmount;
    let tradeFee2;
    [
      _error,
      _newSpotPrice,
      _newDelta,
      _newState,
      outputAmount,
      tradeFee2,
      protocolFee,
    ] = await lssvmPairETH.getSellNFTQuote(1);
    const nftTokenIds = await mintNfts(nft, user1.address);
    await nft.connect(user1).setApprovalForAll(lssvmPairETH.address, true);

    // The seller should own the nfts
    await expectAddressToOwnNFTs(user1.address, nft, nftTokenIds);

    // First calculate the expected sale value + royalty amounts
    const sellAmounts = await cumulativeSumWithRoyalties(
      calculateBid,
      -1,
      nftTokenIds.length,
      1,
      lssvmPairETH,
      curveParams.spotPrice,
      curveParams.delta,
      curveParams.props,
      fee,
      protocolFee,
      royaltyNumerator
    );
    let totalSellRoyalties = 0;
    sellAmounts.slice(1, undefined).forEach((royalty) => {
      totalSellRoyalties += royalty;
    });

    // The pair should now own the nft, and transfers ETH to the seller
    const sellTx = await lssvmPairETH
      .connect(user1)
      .swapNFTsForToken(
        nftTokenIds,
        [],
        [],
        outputAmount,
        user1.address,
        false,
        ethers.constants.AddressZero
      );
    expect(
      await changesEtherBalancesFuzzy(
        sellTx,
        [lsSVMPairFactory, lssvmPairETH, user1],
        [
          protocolFee,
          outputAmount
            .mul(-1)
            .sub(protocolFee)
            .sub(ethers.utils.parseEther(totalSellRoyalties.toFixed(18))),
          outputAmount,
        ]
      )
    ).to.be.true;

    await expectAddressToOwnNFTs(lssvmPairETH.address, nft, nftTokenIds);

    // The pair should accrue trade fees
    expect(await lssvmPairETH.tradeFee()).to.equal(tradeFee1.add(tradeFee2));
  });

  it("Should not be able to use trade fee when selling", async function () {
    const nftTokenIds = await mintNfts(nft, user1.address, 100);
    await nft.connect(user1).setApprovalForAll(lssvmPairETH.address, true);

    let [
      _error,
      _newSpotPrice,
      _newDelta,
      _newState,
      outputAmount,
      tradeFee,
      protocolFee,
    ] = await lssvmPairETH.getSellNFTQuote(1);

    // First calculate the expected sale value + royalty amounts
    const curveParams = await lssvmPairETH.curveParams();
    const sellAmounts = await cumulativeSumWithRoyalties(
      calculateBid,
      0,
      1,
      1,
      lssvmPairETH,
      curveParams.spotPrice,
      curveParams.delta,
      curveParams.props,
      fee,
      protocolFee,
      royaltyNumerator
    );
    let totalSellRoyalties = 0;
    sellAmounts.slice(1, undefined).forEach((royalty) => {
      totalSellRoyalties += royalty;
    });

    // Send enough ETH to the pair for it to buy the nfts
    await user.sendTransaction({
      to: lssvmPairETH.address,
      value: outputAmount.add(tradeFee),
    });

    // The seller should own the nft
    expect(await nft.ownerOf(nftTokenIds[0])).to.equal(user1.address);

    // The pair should now own the nft, and transfers ETH to the seller
    const sellTx = await lssvmPairETH
      .connect(user1)
      .swapNFTsForToken(
        [nftTokenIds[0]],
        [],
        [],
        outputAmount,
        user1.address,
        false,
        ethers.constants.AddressZero
      );
    expect(
      await changesEtherBalancesFuzzy(
        sellTx,
        [lsSVMPairFactory, lssvmPairETH, user1],
        [
          protocolFee,
          outputAmount
            .mul(-1)
            .sub(protocolFee)
            .sub(ethers.utils.parseEther(totalSellRoyalties.toFixed(18))),
          outputAmount,
        ]
      )
    ).to.be.true;

    expect(await nft.ownerOf(nftTokenIds[0])).to.equal(lssvmPairETH.address);

    // The pair should accrue the trade fees
    expect(await lssvmPairETH.tradeFee()).to.equal(tradeFee);

    [
      _error,
      _newSpotPrice,
      _newDelta,
      _newState,
      outputAmount,
      tradeFee,
      protocolFee,
    ] = await lssvmPairETH.getSellNFTQuote(1);
    await expect(
      lssvmPairETH
        .connect(user1)
        .swapNFTsForToken(
          [nftTokenIds[1]],
          [],
          [],
          outputAmount,
          user1.address,
          false,
          ethers.constants.AddressZero
        )
    ).to.be.revertedWith("Too little ETH");
  });

  describe("Withdraw", function () {
    const nftsToBuy = 1;
    beforeEach(async function () {
      let [
        _error,
        _newSpotPrice,
        _newDelta,
        _newState,
        inputAmount,
        tradeFee1,
        protocolFee,
      ] = await lssvmPairETH.getBuyNFTQuote(nftsToBuy);
      const numNFTs = await nft.balanceOf(user1.address);

      let curveParams = await lssvmPairETH.curveParams();

      // First calculate the expected sale value + royalty amounts
      const buyAmounts = await cumulativeSumWithRoyalties(
        calculateAsk,
        0,
        nftsToBuy,
        -1,
        lssvmPairETH,
        curveParams.spotPrice,
        curveParams.delta,
        curveParams.props,
        fee,
        protocolFee,
        royaltyNumerator
      );
      let totalBuyRoyalties = 0;
      buyAmounts.slice(1, undefined).forEach((royalty) => {
        totalBuyRoyalties += royalty;
      });

      // The buyer should transfer ETH to the pair, and now own the nft
      const buyTx = await lssvmPairETH
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
          [lsSVMPairFactory, lssvmPairETH, user1],
          [
            protocolFee,
            inputAmount
              .sub(protocolFee)
              .sub(ethers.utils.parseEther(totalBuyRoyalties.toFixed(18))),
            inputAmount.mul(-1),
          ]
        )
      ).to.be.true;

      expect(await nft.balanceOf(user1.address)).to.equal(numNFTs.add(1));

      // The pair should accrue trade fees
      expect(await lssvmPairETH.tradeFee()).to.equal(tradeFee1);

      let outputAmount;
      let tradeFee2;
      [
        _error,
        _newSpotPrice,
        _newDelta,
        _newState,
        outputAmount,
        tradeFee2,
        protocolFee,
      ] = await lssvmPairETH.getSellNFTQuote(1);

      const nftTokenIds = await mintNfts(nft, user1.address);

      // First calculate the expected sale value + royalty amounts
      curveParams = await lssvmPairETH.curveParams();
      const sellAmounts = await cumulativeSumWithRoyalties(
        calculateBid,
        -1, // We bought one from pool just now so -1
        nftTokenIds.length,
        1,
        lssvmPairETH,
        curveParams.spotPrice,
        curveParams.delta,
        curveParams.props,
        fee,
        protocolFee,
        royaltyNumerator
      );
      let totalSellRoyalties = 0;
      sellAmounts.slice(1, undefined).forEach((royalty) => {
        totalSellRoyalties += royalty;
      });

      await nft.connect(user1).setApprovalForAll(lssvmPairETH.address, true);

      // The seller should own the nfts
      await expectAddressToOwnNFTs(user1.address, nft, nftTokenIds);

      // The pair should now own the nft, and transfers ETH to the seller
      const sellTx = await lssvmPairETH
        .connect(user1)
        .swapNFTsForToken(
          nftTokenIds,
          [],
          [],
          outputAmount,
          user1.address,
          false,
          ethers.constants.AddressZero
        );
      expect(
        await changesEtherBalancesFuzzy(
          sellTx,
          [lsSVMPairFactory, lssvmPairETH, user1],
          [
            protocolFee,
            outputAmount
              .mul(-1)
              .sub(protocolFee)
              .sub(ethers.utils.parseEther(totalSellRoyalties.toFixed(18))),
            outputAmount,
          ]
        )
      ).to.be.true;

      await expectAddressToOwnNFTs(lssvmPairETH.address, nft, nftTokenIds);

      // The pair should accrue the trade fees
      expect(await lssvmPairETH.tradeFee()).to.equal(tradeFee1.add(tradeFee2));
    });

    it("Should be able to withdraw trade fees", async function () {
      const tradeFee = await lssvmPairETH.tradeFee();
      expect(tradeFee).to.not.equal(0);

      // The user should receive the trade fees
      await expect(lssvmPairETH.withdrawTradeFee()).to.changeEtherBalances(
        [lssvmPairETH, user],
        [tradeFee.mul(-1), tradeFee]
      );

      // Trade fee should be reset to 0
      expect(await lssvmPairETH.tradeFee()).to.equal(0);
    });

    it("Should be able to withdraw all", async function () {
      const tradeFee = await lssvmPairETH.tradeFee();
      expect(tradeFee).to.not.equal(0);

      // The user should receive everything
      const balance = await ethers.provider.getBalance(lssvmPairETH.address);
      await expect(lssvmPairETH.withdrawAllETH()).to.changeEtherBalances(
        [lssvmPairETH, user],
        [balance.mul(-1), balance]
      );

      // Trade fee should be reset to 0
      expect(await lssvmPairETH.tradeFee()).to.equal(0);
    });

    it("Should not be able to withdraw more than trade fees", async function () {
      const tradeFee = await lssvmPairETH.tradeFee();
      expect(tradeFee).to.not.equal(0);

      // The user should not be able to withdraw
      await expect(lssvmPairETH.withdrawETH(tradeFee)).to.be.revertedWith(
        "Too little ETH"
      );

      // Trade fee should still be the same
      expect(await lssvmPairETH.tradeFee()).to.equal(tradeFee);
    });
  });
});
