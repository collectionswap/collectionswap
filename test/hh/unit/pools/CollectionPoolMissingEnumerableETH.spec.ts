import {
  setUpCollectionPoolContext,
  testSwapNFTsForToken,
  testSwapTokenForAnyNFTs,
  testSwapTokenForSpecificNFTs,
} from "./CollectionPool";

describe("CollectionPoolMissingEnumerableETH", function () {
  setUpCollectionPoolContext();

  describe("#swapTokenForAnyNFTs", function () {
    testSwapTokenForAnyNFTs("ETH", false);
  });

  describe("#swapTokenForSpecificNFTs", function () {
    testSwapTokenForSpecificNFTs("ETH", false);
  });

  describe("#swapNFTsForToken", function () {
    testSwapNFTsForToken("ETH", false);
  });
});
