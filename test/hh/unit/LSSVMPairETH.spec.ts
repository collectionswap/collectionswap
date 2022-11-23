import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import {
  getCurveParameters,
  lsSVMFixture,
  nftFixture,
} from "../shared/fixtures";
import { expectAddressToOwnNFTs, mintNfts } from "../shared/helpers";
import { getSigners } from "../shared/signers";

import type {
  ERC721PresetMinterPauserAutoId,
  LSSVMPairETH,
  LSSVMPairFactory,
} from "../../../typechain-types";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("LSSVMPairETH", function () {
  let lsSVMPairFactory: LSSVMPairFactory;
  let lssvmPairETH: LSSVMPairETH;
  let nft: ERC721PresetMinterPauserAutoId;
  let user: SignerWithAddress;
  let user1: SignerWithAddress;

  beforeEach(async function () {
    ({ lsSVMPairFactory, lssvmPairETH, nft, user, user1 } = await loadFixture(
      lsSVMETHFixture
    ));
  });

  async function lsSVMETHFixture() {
    const { protocol, user, user1 } = await getSigners();
    const { curve, lsSVMPairFactory } = await lsSVMFixture();
    const { nft } = await nftFixture();
    const nftTokenIds = await mintNfts(nft, user.address);
    await nft.connect(user).setApprovalForAll(lsSVMPairFactory.address, true);

    const poolType = 2;
    const fee = ethers.utils.parseEther("0.89");
    const { delta, spotPrice, props, state } = getCurveParameters();

    const resp = await lsSVMPairFactory.connect(user).createPairETH({
      nft: nft.address,
      bondingCurve: curve.address,
      assetRecipient: ethers.constants.AddressZero,
      poolType,
      delta,
      fee,
      spotPrice,
      props,
      state,
      initialNFTIDs: nftTokenIds,
    });
    const receipt = await resp.wait();

    return {
      lsSVMPairFactory,
      lssvmPairETH: await ethers.getContractAt(
        "LSSVMPairETH",
        receipt.events!.at(-1)!.args!.poolAddress,
        user
      ),
      nft,
      nftTokenIds,
      protocol,
      user,
      user1,
    };
  }

  it("Should have trade fee when buying", async function () {
    const [
      _error,
      _newSpotPrice,
      _newDelta,
      _newState,
      inputAmount,
      tradeFee,
      protocolFee,
    ] = await lssvmPairETH.getBuyNFTQuote(1);
    const numNFTs = await nft.balanceOf(user1.address);

    // The buyer should transfer ETH to the pair, and now own the nft
    await expect(
      lssvmPairETH
        .connect(user1)
        .swapTokenForAnyNFTs(
          1,
          inputAmount,
          user1.address,
          false,
          ethers.constants.AddressZero,
          {
            value: inputAmount,
          }
        )
    ).to.changeEtherBalances(
      [lsSVMPairFactory, lssvmPairETH, user1],
      [protocolFee, inputAmount.sub(protocolFee), inputAmount.mul(-1)]
    );
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

    // The seller should own the nfts
    await expectAddressToOwnNFTs(user1.address, nft, nftTokenIds);

    // The pair should now own the nft, and transfers ETH to the seller
    await expect(
      lssvmPairETH
        .connect(user1)
        .swapNFTsForToken(
          nftTokenIds,
          outputAmount,
          user1.address,
          false,
          ethers.constants.AddressZero
        )
    ).to.changeEtherBalances(
      [lsSVMPairFactory, lssvmPairETH, user1],
      [protocolFee, outputAmount.mul(-1).sub(protocolFee), outputAmount]
    );
    await expectAddressToOwnNFTs(lssvmPairETH.address, nft, nftTokenIds);

    // The pair should accrue trade fees
    expect(await lssvmPairETH.tradeFee()).to.equal(tradeFee);
  });

  it("Should accrue trade fees", async function () {
    let [
      _error,
      _newSpotPrice,
      _newDelta,
      _newState,
      inputAmount,
      tradeFee1,
      protocolFee,
    ] = await lssvmPairETH.getBuyNFTQuote(1);
    const numNFTs = await nft.balanceOf(user1.address);

    // The buyer should transfer ETH to the pair, and now own the nft
    await expect(
      lssvmPairETH
        .connect(user1)
        .swapTokenForAnyNFTs(
          1,
          inputAmount,
          user1.address,
          false,
          ethers.constants.AddressZero,
          {
            value: inputAmount,
          }
        )
    ).to.changeEtherBalances(
      [lsSVMPairFactory, lssvmPairETH, user1],
      [protocolFee, inputAmount.sub(protocolFee), inputAmount.mul(-1)]
    );
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

    // The pair should now own the nft, and transfers ETH to the seller
    await expect(
      lssvmPairETH
        .connect(user1)
        .swapNFTsForToken(
          nftTokenIds,
          outputAmount,
          user1.address,
          false,
          ethers.constants.AddressZero
        )
    ).to.changeEtherBalances(
      [lsSVMPairFactory, lssvmPairETH, user1],
      [protocolFee, outputAmount.mul(-1).sub(protocolFee), outputAmount]
    );
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

    // Send enough ETH to the pair for it to buy the nfts
    await user.sendTransaction({
      to: lssvmPairETH.address,
      value: outputAmount.add(tradeFee),
    });

    // The seller should own the nft
    expect(await nft.ownerOf(nftTokenIds[0])).to.equal(user1.address);

    // The pair should now own the nft, and transfers ETH to the seller
    await expect(
      lssvmPairETH
        .connect(user1)
        .swapNFTsForToken(
          [nftTokenIds[0]],
          outputAmount,
          user1.address,
          false,
          ethers.constants.AddressZero
        )
    ).to.changeEtherBalances(
      [lsSVMPairFactory, lssvmPairETH, user1],
      [protocolFee, outputAmount.mul(-1).sub(protocolFee), outputAmount]
    );
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
          outputAmount,
          user1.address,
          false,
          ethers.constants.AddressZero
        )
    ).to.be.revertedWith("Too little ETH");
  });

  describe("Withdraw", function () {
    beforeEach(async function () {
      let [
        _error,
        _newSpotPrice,
        _newDelta,
        _newState,
        inputAmount,
        tradeFee1,
        protocolFee,
      ] = await lssvmPairETH.getBuyNFTQuote(1);
      const numNFTs = await nft.balanceOf(user1.address);

      // The buyer should transfer ETH to the pair, and now own the nft
      await expect(
        lssvmPairETH
          .connect(user1)
          .swapTokenForAnyNFTs(
            1,
            inputAmount,
            user1.address,
            false,
            ethers.constants.AddressZero,
            {
              value: inputAmount,
            }
          )
      ).to.changeEtherBalances(
        [lsSVMPairFactory, lssvmPairETH, user1],
        [protocolFee, inputAmount.sub(protocolFee), inputAmount.mul(-1)]
      );
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

      // The pair should now own the nft, and transfers ETH to the seller
      await expect(
        lssvmPairETH
          .connect(user1)
          .swapNFTsForToken(
            nftTokenIds,
            outputAmount,
            user1.address,
            false,
            ethers.constants.AddressZero
          )
      ).to.changeEtherBalances(
        [lsSVMPairFactory, lssvmPairETH, user1],
        [protocolFee, outputAmount.mul(-1).sub(protocolFee), outputAmount]
      );
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
