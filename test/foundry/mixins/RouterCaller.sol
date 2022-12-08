// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {CollectionRouter} from "../../../contracts/CollectionRouter.sol";
import {CollectionRouter2} from "../../../contracts/CollectionRouter2.sol";

abstract contract RouterCaller {
    function swapTokenForAnyNFTs(
        CollectionRouter router,
        CollectionRouter.PoolSwapAny[] calldata swapList,
        address payable ethRecipient,
        address nftRecipient,
        uint256 deadline,
        uint256 inputAmount
    ) public payable virtual returns (uint256);

    function swapTokenForSpecificNFTs(
        CollectionRouter router,
        CollectionRouter.PoolSwapSpecific[] calldata swapList,
        address payable ethRecipient,
        address nftRecipient,
        uint256 deadline,
        uint256 inputAmount
    ) public payable virtual returns (uint256);

    function swapNFTsForAnyNFTsThroughToken(
        CollectionRouter router,
        CollectionRouter.NFTsForAnyNFTsTrade calldata trade,
        uint256 minOutput,
        address payable ethRecipient,
        address nftRecipient,
        uint256 deadline,
        uint256 inputAmount
    ) public payable virtual returns (uint256);

    function swapNFTsForSpecificNFTsThroughToken(
        CollectionRouter router,
        CollectionRouter.NFTsForSpecificNFTsTrade calldata trade,
        uint256 minOutput,
        address payable ethRecipient,
        address nftRecipient,
        uint256 deadline,
        uint256 inputAmount
    ) public payable virtual returns (uint256);

    function robustSwapTokenForAnyNFTs(
        CollectionRouter router,
        CollectionRouter.RobustPoolSwapAny[] calldata swapList,
        address payable ethRecipient,
        address nftRecipient,
        uint256 deadline,
        uint256 inputAmount
    ) public payable virtual returns (uint256);

    function robustSwapTokenForSpecificNFTs(
        CollectionRouter router,
        CollectionRouter.RobustPoolSwapSpecific[] calldata swapList,
        address payable ethRecipient,
        address nftRecipient,
        uint256 deadline,
        uint256 inputAmount
    ) public payable virtual returns (uint256);

    function robustSwapTokenForSpecificNFTsAndNFTsForTokens(
        CollectionRouter router,
        CollectionRouter.RobustPoolNFTsFoTokenAndTokenforNFTsTrade calldata params
    ) public payable virtual returns (uint256, uint256);

    function buyAndSellWithPartialFill(
        CollectionRouter2 router,
        CollectionRouter2.PoolSwapSpecificPartialFill[] calldata buyList,
        CollectionRouter2.PoolSwapSpecificPartialFillForToken[] calldata sellList
    ) public payable virtual returns (uint256);

    function swapETHForSpecificNFTs(
        CollectionRouter2 router,
        CollectionRouter2.RobustPoolSwapSpecific[] calldata buyList
    ) public payable virtual returns (uint256);
}
