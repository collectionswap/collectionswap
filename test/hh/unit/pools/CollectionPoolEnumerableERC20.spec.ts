import {
  setUpCollectionPoolContext,
  testSwapNFTsForToken,
  testSwapTokenForAnyNFTs,
  testSwapTokenForSpecificNFTs,
} from "./CollectionPool";

describe("CollectionPoolEnumerableERC20", function () {
  setUpCollectionPoolContext();

  describe("#swapTokenForAnyNFTs", function () {
    testSwapTokenForAnyNFTs("ERC20", true);
  });

  describe("#swapTokenForSpecificNFTs", function () {
    testSwapTokenForSpecificNFTs("ERC20", true);
  });

  describe("#swapNFTsForToken", function () {
    testSwapNFTsForToken("ERC20", true);
  });
});
