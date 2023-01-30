// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ICurve} from "../../../contracts/bonding-curves/ICurve.sol";
import {ICollectionPoolFactory} from "../../../contracts/pools/ICollectionPoolFactory.sol";
import {CollectionPool} from "../../../contracts/pools/CollectionPool.sol";
import {CollectionPoolFactory} from "../../../contracts/pools/CollectionPoolFactory.sol";
import {CollectionRouter} from "../../../contracts/routers/CollectionRouter.sol";
import {CollectionRouter2} from "../../../contracts/routers/CollectionRouter2.sol";
import {CollectionPoolETH} from "../../../contracts/pools/CollectionPoolETH.sol";
import {Configurable} from "./Configurable.sol";
import {RouterCaller} from "./RouterCaller.sol";

abstract contract UsingETH is Configurable, RouterCaller {
    function modifyInputAmount(uint256 inputAmount)
        public
        pure
        override
        returns (uint256)
    {
        return inputAmount;
    }

    function getBalance(address a) public view override returns (uint256) {
        return a.balance;
    }

    function sendTokens(CollectionPool pool, uint256 amount) public override {
        (bool success,) = payable(address(pool)).call{value: amount}("");

        if (!success) {
            revert("Transfer failed");
        }
    }

    function setupPool(
        CollectionPoolFactory factory,
        IERC721 nft,
        ICurve bondingCurve,
        address payable assetRecipient,
        CollectionPool.PoolType poolType,
        uint128 delta,
        uint24 fee,
        uint128 spotPrice,
        uint256[] memory _idList,
        uint256,
        address
    ) public payable override returns (CollectionPool) {
        ICollectionPoolFactory.CreateETHPoolParams memory params = ICollectionPoolFactory.CreateETHPoolParams(
            nft,
            bondingCurve,
            assetRecipient,
            address(this),
            poolType,
            delta,
            fee,
            spotPrice,
            "",
            "",
            0,
            payable(0),
            _idList
        );
        (address poolAddress, ) = factory.createPoolETH{value: msg.value}(
            params
        );
        return CollectionPoolETH(payable(poolAddress));
    }

    function withdrawTokens(CollectionPool pool) public override {
        CollectionPoolETH(payable(address(pool))).withdrawAllETH();
    }

    function withdrawProtocolFees(CollectionPoolFactory factory) public override {
        factory.withdrawETHProtocolFees();
    }

    function swapTokenForAnyNFTs(
        CollectionRouter router,
        CollectionRouter.PoolSwapAny[] calldata swapList,
        address payable ethRecipient,
        address nftRecipient,
        uint256 deadline,
        uint256
    ) public payable override returns (uint256) {
        return
            router.swapETHForAnyNFTs{value: msg.value}(
                swapList,
                ethRecipient,
                nftRecipient,
                deadline
            );
    }

    function swapTokenForSpecificNFTs(
        CollectionRouter router,
        CollectionRouter.PoolSwapSpecific[] calldata swapList,
        address payable ethRecipient,
        address nftRecipient,
        uint256 deadline,
        uint256
    ) public payable override returns (uint256) {
        return
            router.swapETHForSpecificNFTs{value: msg.value}(
                swapList,
                ethRecipient,
                nftRecipient,
                deadline
            );
    }

    function swapNFTsForAnyNFTsThroughToken(
        CollectionRouter router,
        CollectionRouter.NFTsForAnyNFTsTrade calldata trade,
        uint256 minOutput,
        address payable ethRecipient,
        address nftRecipient,
        uint256 deadline,
        uint256
    ) public payable override returns (uint256) {
        return
            router.swapNFTsForAnyNFTsThroughETH{value: msg.value}(
                trade,
                minOutput,
                ethRecipient,
                nftRecipient,
                deadline
            );
    }

    function swapNFTsForSpecificNFTsThroughToken(
        CollectionRouter router,
        CollectionRouter.NFTsForSpecificNFTsTrade calldata trade,
        uint256 minOutput,
        address payable ethRecipient,
        address nftRecipient,
        uint256 deadline,
        uint256
    ) public payable override returns (uint256) {
        return
            router.swapNFTsForSpecificNFTsThroughETH{value: msg.value}(
                trade,
                minOutput,
                ethRecipient,
                nftRecipient,
                deadline
            );
    }

    function robustSwapTokenForAnyNFTs(
        CollectionRouter router,
        CollectionRouter.RobustPoolSwapAny[] calldata swapList,
        address payable ethRecipient,
        address nftRecipient,
        uint256 deadline,
        uint256
    ) public payable override returns (uint256) {
        return
            router.robustSwapETHForAnyNFTs{value: msg.value}(
                swapList,
                ethRecipient,
                nftRecipient,
                deadline
            );
    }

    function robustSwapTokenForSpecificNFTs(
        CollectionRouter router,
        CollectionRouter.RobustPoolSwapSpecific[] calldata swapList,
        address payable ethRecipient,
        address nftRecipient,
        uint256 deadline,
        uint256
    ) public payable override returns (uint256) {
        return
            router.robustSwapETHForSpecificNFTs{value: msg.value}(
                swapList,
                ethRecipient,
                nftRecipient,
                deadline
            );
    }

    function robustSwapTokenForSpecificNFTsAndNFTsForTokens(
        CollectionRouter router,
        CollectionRouter.RobustPoolNFTsFoTokenAndTokenforNFTsTrade calldata params
    ) public payable override returns (uint256, uint256) {
        return
            router.robustSwapETHForSpecificNFTsAndNFTsToToken{value: msg.value}(
                params
            );
    }

    function buyAndSellWithPartialFill(
        CollectionRouter2 router,
        CollectionRouter2.PoolSwapSpecificPartialFill[] calldata buyList,
        CollectionRouter2.PoolSwapSpecificPartialFillForToken[] calldata sellList
    ) public payable override returns (uint256) {
      return router.robustBuySellWithETHAndPartialFill{value: msg.value}(
        buyList, sellList
      );
    }

    function swapETHForSpecificNFTs(
        CollectionRouter2 router,
        CollectionRouter2.RobustPoolSwapSpecific[] calldata buyList
    ) public payable override returns (uint256) {
      return router.swapETHForSpecificNFTs{value: msg.value}(buyList);
    }
}
