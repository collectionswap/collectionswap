import {
  setUpCollectionPoolContext,
  testSwapNFTsForToken,
  testSwapTokenForAnyNFTs,
  testSwapTokenForSpecificNFTs,
} from "./CollectionPool";

describe("CollectionPoolMissingEnumerableERC20", function () {
  setUpCollectionPoolContext();

  describe("#swapTokenForAnyNFTs", function () {
    testSwapTokenForAnyNFTs("ERC20", false);
  });

  describe("#swapTokenForSpecificNFTs", function () {
    testSwapTokenForSpecificNFTs("ERC20", false);
  });

  describe("#swapNFTsForToken", function () {
    testSwapNFTsForToken("ERC20", false);
  });
});
