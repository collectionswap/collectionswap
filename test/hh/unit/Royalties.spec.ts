import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("Royalties", function () {
  describe("Initializing pool with royaltyNumerator", function () {
    it("Should allow zero royaltyNumerator for non-ERC2981");
    it("Should allow zero royaltyNumerator for ERC2981");
    it("Should revert on nonzero royaltyNumerator for non-ERC2981");
    it("Should allow nonzero royaltyNumerator for ERC2981");
  });
  describe("Royalties should be awarded upon swaps", function () {
    it("Should not award royalties when getting info/quotes");
    it("Should not award royalties when buying 0 items from pool");
    it("Should not award royalties when selling 0 items to pool");
    it("Should award royalties when buying one item from pool");
    it("Should award royalties when selling one item to pool");
    it("Should award royalties when buying many items from pool");
    it("Should award royalties when selling many items to pool");
    it(
      "Should award royalties when repeatedly buying and selling multiple items"
    );
  });
  describe("RoyaltyNumerator updates", function () {
    it("Should revert if called by non-owner");
    it("Should succeed and emit event if called by owner");
    it("Should result in new royalty amounts being sent after update");
  });
});
