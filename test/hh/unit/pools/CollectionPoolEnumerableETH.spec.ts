import {
  setUpCollectionPoolContext,
  testSwapNFTsForToken,
  testSwapTokenForAnyNFTs,
  testSwapTokenForSpecificNFTs,
} from "./CollectionPool";

describe("CollectionPoolEnumerableETH", function () {
  setUpCollectionPoolContext();

  describe("#swapTokenForAnyNFTs", function () {
    testSwapTokenForAnyNFTs("ETH", true);
  });

  describe("#swapTokenForSpecificNFTs", function () {
    testSwapTokenForSpecificNFTs("ETH", true);
  });

  describe("#swapNFTsForToken", function () {
    testSwapNFTsForToken("ETH", true);
  });
});
