// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {ERC20} from "solmate/src/tokens/ERC20.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {Test} from "forge-std/Test.sol";

import {LinearCurve} from "../../../contracts/bonding-curves/LinearCurve.sol";
import {ICurve} from "../../../contracts/bonding-curves/ICurve.sol";
import {ICollectionPool} from "../../../contracts/pools/ICollectionPool.sol";
import {CollectionPoolFactory} from "../../../contracts/pools/CollectionPoolFactory.sol";
import {CollectionPool} from "../../../contracts/pools/CollectionPool.sol";
import {CollectionPoolETH} from "../../../contracts/pools/CollectionPoolETH.sol";
import {CollectionPoolERC20} from "../../../contracts/pools/CollectionPoolERC20.sol";
import {CollectionPoolEnumerableETH} from "../../../contracts/pools/CollectionPoolEnumerableETH.sol";
import {CollectionPoolMissingEnumerableETH} from "../../../contracts/pools/CollectionPoolMissingEnumerableETH.sol";
import {CollectionPoolEnumerableERC20} from "../../../contracts/pools/CollectionPoolEnumerableERC20.sol";
import {CollectionPoolMissingEnumerableERC20} from "../../../contracts/pools/CollectionPoolMissingEnumerableERC20.sol";
import {CollectionRouter} from "../../../contracts/routers/CollectionRouter.sol";
import {IERC721Mintable} from "../interfaces/IERC721Mintable.sol";
import {Configurable} from "../mixins/Configurable.sol";
import {RouterCaller} from "../mixins/RouterCaller.sol";

abstract contract RouterRobustSwapWithAssetRecipient is
    StdCheats,
    Test,
    ERC721Holder,
    Configurable,
    RouterCaller
{
    IERC721Mintable test721;
    ICurve bondingCurve;
    CollectionPoolFactory factory;
    CollectionRouter router;

    // 2 Sell Pools
    CollectionPool sellPool1;
    CollectionPool sellPool2;

    // 2 Buy Pools
    CollectionPool buyPool1;
    CollectionPool buyPool2;

    address payable constant feeRecipient = payable(address(69));
    address payable constant sellPoolRecipient = payable(address(1));
    address payable constant buyPoolRecipient = payable(address(2));
    uint24 constant protocolFeeMultiplier = 0;
    uint24 constant carryFeeMultiplier = 0;
    uint256 constant numInitialNFTs = 10;

    function setUp() public {
        bondingCurve = setupCurve();
        test721 = setup721();
        CollectionPoolEnumerableETH enumerableETHTemplate = new CollectionPoolEnumerableETH();
        CollectionPoolMissingEnumerableETH missingEnumerableETHTemplate = new CollectionPoolMissingEnumerableETH();
        CollectionPoolEnumerableERC20 enumerableERC20Template = new CollectionPoolEnumerableERC20();
        CollectionPoolMissingEnumerableERC20 missingEnumerableERC20Template = new CollectionPoolMissingEnumerableERC20();
        factory = new CollectionPoolFactory(
            enumerableETHTemplate,
            missingEnumerableETHTemplate,
            enumerableERC20Template,
            missingEnumerableERC20Template,
            feeRecipient,
            protocolFeeMultiplier,
            carryFeeMultiplier
        );
        router = new CollectionRouter(factory);

        // Set approvals
        test721.setApprovalForAll(address(factory), true);
        test721.setApprovalForAll(address(router), true);
        factory.setBondingCurveAllowed(bondingCurve, true);
        factory.setRouterAllowed(router, true);

        for (uint256 i = 1; i <= numInitialNFTs; i++) {
            test721.mint(address(this), i);
        }
        uint128 spotPrice = 1 ether;

        uint256[] memory sellIDList1 = new uint256[](1);
        sellIDList1[0] = 1;
        sellPool1 = this.setupPool{value: modifyInputAmount(1 ether)}(
            factory,
            test721,
            bondingCurve,
            sellPoolRecipient,
            ICollectionPool.PoolType.NFT,
            modifyDelta(0),
            0,
            spotPrice,
            sellIDList1,
            1 ether,
            address(router)
        );

        uint256[] memory sellIDList2 = new uint256[](1);
        sellIDList2[0] = 2;
        sellPool2 = this.setupPool{value: modifyInputAmount(1 ether)}(
            factory,
            test721,
            bondingCurve,
            sellPoolRecipient,
            ICollectionPool.PoolType.NFT,
            modifyDelta(0),
            0,
            spotPrice,
            sellIDList2,
            1 ether,
            address(router)
        );

        uint256[] memory buyIDList1 = new uint256[](1);
        buyIDList1[0] = 3;
        buyPool1 = this.setupPool{value: modifyInputAmount(1 ether)}(
            factory,
            test721,
            bondingCurve,
            buyPoolRecipient,
            ICollectionPool.PoolType.TOKEN,
            modifyDelta(0),
            0,
            spotPrice,
            buyIDList1,
            1 ether,
            address(router)
        );

        uint256[] memory buyIDList2 = new uint256[](1);
        buyIDList2[0] = 4;
        buyPool2 = this.setupPool{value: modifyInputAmount(1 ether)}(
            factory,
            test721,
            bondingCurve,
            buyPoolRecipient,
            ICollectionPool.PoolType.TOKEN,
            modifyDelta(0),
            0,
            spotPrice,
            buyIDList2,
            1 ether,
            address(router)
        );

        // skip 1 block so that trades are not in the same block as pool creation
        vm.roll(block.number + 1);
    }

    // Swapping tokens for any NFT on sellPool1 works, but fails silently on sellPool2 if slippage is too tight
    function test_robustSwapTokenForAnyNFTs() public {
        uint256 sellPool1Price;
        (, , , sellPool1Price, ) = sellPool1.getBuyNFTQuote(1);
        CollectionRouter.RobustPoolSwapAny[]
            memory swapList = new CollectionRouter.RobustPoolSwapAny[](2);
        swapList[0] = CollectionRouter.RobustPoolSwapAny({
            swapInfo: CollectionRouter.PoolSwapAny({pool: sellPool1, numItems: 1}),
            maxCost: sellPool1Price
        });
        swapList[1] = CollectionRouter.RobustPoolSwapAny({
            swapInfo: CollectionRouter.PoolSwapAny({pool: sellPool2, numItems: 1}),
            maxCost: 0 ether
        });
        uint256 remainingValue = this.robustSwapTokenForAnyNFTs{
            value: modifyInputAmount(2 ether)
        }(
            router,
            swapList,
            payable(address(this)),
            address(this),
            block.timestamp,
            2 ether
        );
        assertEq(remainingValue + sellPool1Price, 2 ether);
        assertEq(getBalance(sellPoolRecipient), sellPool1Price);
    }

    // Swapping tokens to a specific NFT with sellPool2 works, but fails silently on sellPool1 if slippage is too tight
    function test_robustSwapTokenForSpecificNFTs() public {
        uint256 sellPool1Price;
        (, , , sellPool1Price, ) = sellPool2.getBuyNFTQuote(1);
        CollectionRouter.RobustPoolSwapSpecific[]
            memory swapList = new CollectionRouter.RobustPoolSwapSpecific[](2);
        uint256[] memory nftIds1 = new uint256[](1);
        nftIds1[0] = 1;
        uint256[] memory nftIds2 = new uint256[](1);
        nftIds2[0] = 2;
        swapList[0] = CollectionRouter.RobustPoolSwapSpecific({
            swapInfo: CollectionRouter.PoolSwapSpecific({
                pool: sellPool1,
                nftIds: nftIds1,
                proof: new bytes32[](0),
                proofFlags: new bool[](0)
            }),
            maxCost: 0 ether
        });
        swapList[1] = CollectionRouter.RobustPoolSwapSpecific({
            swapInfo: CollectionRouter.PoolSwapSpecific({
                pool: sellPool2,
                nftIds: nftIds2,
                proof: new bytes32[](0),
                proofFlags: new bool[](0)
            }),
            maxCost: sellPool1Price
        });
        uint256 remainingValue = this.robustSwapTokenForSpecificNFTs{
            value: modifyInputAmount(2 ether)
        }(
            router,
            swapList,
            payable(address(this)),
            address(this),
            block.timestamp,
            2 ether
        );
        assertEq(remainingValue + sellPool1Price, 2 ether);
        assertEq(getBalance(sellPoolRecipient), sellPool1Price);
    }

    // Swapping NFTs to tokens with buyPool1 works, but buyPool2 silently fails due to slippage
    function test_robustSwapNFTsForToken() public {
        uint256 buyPool1Price;
        (, , , buyPool1Price, ) = buyPool1.getSellNFTQuote(1);
        uint256[] memory nftIds1 = new uint256[](1);
        nftIds1[0] = 5;
        uint256[] memory nftIds2 = new uint256[](1);
        nftIds2[0] = 6;
        CollectionRouter.RobustPoolSwapSpecificForToken[]
            memory swapList = new CollectionRouter.RobustPoolSwapSpecificForToken[](
                2
            );
        swapList[0] = CollectionRouter.RobustPoolSwapSpecificForToken({
            swapInfo: CollectionRouter.PoolSwapSpecific({
                pool: buyPool1,
                nftIds: nftIds1,
                proof: new bytes32[](0),
                proofFlags: new bool[](0)
            }),
            minOutput: buyPool1Price
        });
        swapList[1] = CollectionRouter.RobustPoolSwapSpecificForToken({
            swapInfo: CollectionRouter.PoolSwapSpecific({
                pool: buyPool2,
                nftIds: nftIds2,
                proof: new bytes32[](0),
                proofFlags: new bool[](0)
            }),
            minOutput: 2 ether
        });
        router.robustSwapNFTsForToken(
            swapList,
            payable(address(this)),
            block.timestamp
        );
        assertEq(test721.balanceOf(buyPoolRecipient), 1);
    }
}
