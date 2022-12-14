// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ERC20} from "solmate/src/tokens/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeTransferLib} from "solmate/src/utils/SafeTransferLib.sol";

import {NoArbBondingCurve} from "../base/NoArbBondingCurve.sol";
import {ICollectionPoolFactory} from "../../../contracts/pools/ICollectionPoolFactory.sol";
import {CollectionPool} from "../../../contracts/pools/CollectionPool.sol";
import {CollectionPoolERC20} from "../../../contracts/pools/CollectionPoolERC20.sol";
import {CollectionRouter} from "../../../contracts/routers/CollectionRouter.sol";
import {CollectionRouter2} from "../../../contracts/routers/CollectionRouter2.sol";
import {Test20} from "../../../contracts/test/mocks/Test20.sol";
import {IMintable} from "../interfaces/IMintable.sol";
import {CollectionPoolFactory} from "../../../contracts/pools/CollectionPoolFactory.sol";
import {ICurve} from "../../../contracts/bonding-curves/ICurve.sol";
import {Configurable} from "./Configurable.sol";
import {RouterCaller} from "./RouterCaller.sol";

abstract contract UsingERC20 is Configurable, RouterCaller {
    using SafeTransferLib for ERC20;

    ERC20 test20;

    function modifyInputAmount(uint256) public pure override returns (uint256) {
        return 0;
    }

    function getBalance(address a) public view override returns (uint256) {
        return test20.balanceOf(a);
    }

    function sendTokens(CollectionPool pool, uint256 amount) public override {
        test20.safeTransfer(address(pool), amount);
    }

    function setupPool(
        CollectionPoolFactory factory,
        IERC721 nft,
        ICurve bondingCurve,
        address payable assetRecipient,
        CollectionPool.PoolType poolType,
        uint128 delta,
        uint96 fee,
        uint128 spotPrice,
        uint256[] memory _idList,
        uint256 initialTokenBalance,
        address routerAddress
    ) public payable override returns (CollectionPool) {
        // create ERC20 token if not already deployed
        if (address(test20) == address(0)) {
            test20 = new Test20();
        }

        // set approvals for factory and router
        test20.approve(address(factory), type(uint256).max);
        test20.approve(routerAddress, type(uint256).max);

        // mint enough tokens to caller
        IMintable(address(test20)).mint(address(this), 1000 ether);

        // initialize the pool
        (address poolAddress,) = factory.createPoolERC20(
            ICollectionPoolFactory.CreateERC20PoolParams(
                test20,
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
                _idList,
                initialTokenBalance
            )
        );

        // Set approvals for pool
        test20.approve(poolAddress, type(uint256).max);

        return CollectionPool(poolAddress);
    }

    function withdrawTokens(CollectionPool pool) public override {
        uint256 total = test20.balanceOf(address(pool));
        CollectionPoolERC20(address(pool)).withdrawERC20(test20, total);
    }

    function withdrawProtocolFees(CollectionPoolFactory factory) public override {
        factory.withdrawERC20ProtocolFees(test20, test20.balanceOf(address(factory)));
    }

    function swapTokenForAnyNFTs(
        CollectionRouter router,
        CollectionRouter.PoolSwapAny[] calldata swapList,
        address payable,
        address nftRecipient,
        uint256 deadline,
        uint256 inputAmount
    ) public payable override returns (uint256) {
        return router.swapERC20ForAnyNFTs(swapList, inputAmount, nftRecipient, deadline);
    }

    function swapTokenForSpecificNFTs(
        CollectionRouter router,
        CollectionRouter.PoolSwapSpecific[] calldata swapList,
        address payable,
        address nftRecipient,
        uint256 deadline,
        uint256 inputAmount
    ) public payable override returns (uint256) {
        return router.swapERC20ForSpecificNFTs(swapList, inputAmount, nftRecipient, deadline);
    }

    function swapNFTsForAnyNFTsThroughToken(
        CollectionRouter router,
        CollectionRouter.NFTsForAnyNFTsTrade calldata trade,
        uint256 minOutput,
        address payable,
        address nftRecipient,
        uint256 deadline,
        uint256 inputAmount
    ) public payable override returns (uint256) {
        return router.swapNFTsForAnyNFTsThroughERC20(trade, inputAmount, minOutput, nftRecipient, deadline);
    }

    function swapNFTsForSpecificNFTsThroughToken(
        CollectionRouter router,
        CollectionRouter.NFTsForSpecificNFTsTrade calldata trade,
        uint256 minOutput,
        address payable,
        address nftRecipient,
        uint256 deadline,
        uint256 inputAmount
    ) public payable override returns (uint256) {
        return router.swapNFTsForSpecificNFTsThroughERC20(trade, inputAmount, minOutput, nftRecipient, deadline);
    }

    function robustSwapTokenForAnyNFTs(
        CollectionRouter router,
        CollectionRouter.RobustPoolSwapAny[] calldata swapList,
        address payable,
        address nftRecipient,
        uint256 deadline,
        uint256 inputAmount
    ) public payable override returns (uint256) {
        return router.robustSwapERC20ForAnyNFTs(swapList, inputAmount, nftRecipient, deadline);
    }

    function robustSwapTokenForSpecificNFTs(
        CollectionRouter router,
        CollectionRouter.RobustPoolSwapSpecific[] calldata swapList,
        address payable,
        address nftRecipient,
        uint256 deadline,
        uint256 inputAmount
    ) public payable override returns (uint256) {
        return router.robustSwapERC20ForSpecificNFTs(swapList, inputAmount, nftRecipient, deadline);
    }

    function robustSwapTokenForSpecificNFTsAndNFTsForTokens(
        CollectionRouter router,
        CollectionRouter.RobustPoolNFTsFoTokenAndTokenforNFTsTrade calldata params
    ) public payable override returns (uint256, uint256) {
        return router.robustSwapERC20ForSpecificNFTsAndNFTsToToken(params);
    }

    function buyAndSellWithPartialFill(
        CollectionRouter2 router,
        CollectionRouter2.PoolSwapSpecificPartialFill[] calldata buyList,
        CollectionRouter2.PoolSwapSpecificPartialFillForToken[] calldata sellList
    ) public payable override returns (uint256) {
        require(false, "Unimplemented");
    }

    function swapETHForSpecificNFTs(
        CollectionRouter2 router,
        CollectionRouter2.RobustPoolSwapSpecific[] calldata buyList
    ) public payable override returns (uint256) {
        require(false, "Unimplemented");
    }
}
