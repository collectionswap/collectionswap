// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {Test} from "forge-std/Test.sol";

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

abstract contract RouterSinglePool is
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
    CollectionPool pool;
    address payable constant feeRecipient = payable(address(69));
    uint24 constant protocolFeeMultiplier = 0.003e6;
    uint24 constant carryFeeMultiplier = 0.003e6;
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
        factory.setBondingCurveAllowed(bondingCurve, true);
        factory.setRouterAllowed(router, true);

        // set NFT approvals
        test721.setApprovalForAll(address(factory), true);
        test721.setApprovalForAll(address(router), true);

        // Setup pool parameters
        uint128 delta = 0 ether;
        uint128 spotPrice = 1 ether;
        uint256[] memory idList = new uint256[](numInitialNFTs);
        for (uint256 i = 1; i <= numInitialNFTs; i++) {
            test721.mint(address(this), i);
            idList[i - 1] = i;
        }

        // Create a pool with a spot price of 1 eth, 10 NFTs, and no price increases
        pool = this.setupPool{value: modifyInputAmount(10 ether)}(
            factory,
            test721,
            bondingCurve,
            payable(address(0)),
            ICollectionPool.PoolType.TRADE,
            modifyDelta(uint64(delta)),
            0,
            spotPrice,
            idList,
            10 ether,
            address(router)
        );

        // mint extra NFTs to this contract (i.e. to be held by the caller)
        for (uint256 i = numInitialNFTs + 1; i <= 2 * numInitialNFTs; i++) {
            test721.mint(address(this), i);
        }

        // skip 1 block so that trades are not in the same block as pool creation
        vm.roll(block.number + 1);
    }

    function test_swapTokenForSingleAnyNFT() public {
        CollectionRouter.PoolSwapAny[]
            memory swapList = new CollectionRouter.PoolSwapAny[](1);
        swapList[0] = CollectionRouter.PoolSwapAny({pool: pool, numItems: 1});
        uint256 inputAmount;
        (, , inputAmount, ) = pool.getBuyNFTQuote(1);
        this.swapTokenForAnyNFTs{value: modifyInputAmount(inputAmount)}(
            router,
            swapList,
            payable(address(this)),
            address(this),
            block.timestamp,
            inputAmount
        );
    }

    function test_swapTokenForSingleSpecificNFT() public {
        uint256[] memory nftIds = new uint256[](1);
        nftIds[0] = 1;
        CollectionRouter.PoolSwapSpecific[]
            memory swapList = new CollectionRouter.PoolSwapSpecific[](1);
        swapList[0] = CollectionRouter.PoolSwapSpecific({
            pool: pool,
            nftIds: nftIds,
            proof: new bytes32[](0),
            proofFlags: new bool[](0),
            externalFilterContext: new bytes(0)
        });
        uint256 inputAmount;
        (, , inputAmount, ) = pool.getBuyNFTQuote(1);
        this.swapTokenForSpecificNFTs{value: modifyInputAmount(inputAmount)}(
            router,
            swapList,
            payable(address(this)),
            address(this),
            block.timestamp,
            inputAmount
        );
    }

    function test_swapSingleNFTForToken() public {
        (, , uint256 outputAmount, ) = pool.getSellNFTQuote(1);
        uint256[] memory nftIds = new uint256[](1);
        nftIds[0] = numInitialNFTs + 1;
        CollectionRouter.PoolSwapSpecific[]
            memory swapList = new CollectionRouter.PoolSwapSpecific[](1);
        swapList[0] = CollectionRouter.PoolSwapSpecific({
            pool: pool,
            nftIds: nftIds,
            proof: new bytes32[](0),
            proofFlags: new bool[](0),
            externalFilterContext: new bytes(0)
        });
        router.swapNFTsForToken(
            swapList,
            outputAmount,
            payable(address(this)),
            block.timestamp
        );
    }

    function testGas_swapSingleNFTForToken5Times() public {
        for (uint256 i = 1; i <= 5; i++) {
            (, , uint256 outputAmount, ) = pool.getSellNFTQuote(1);
            uint256[] memory nftIds = new uint256[](1);
            nftIds[0] = numInitialNFTs + i;
            CollectionRouter.PoolSwapSpecific[]
                memory swapList = new CollectionRouter.PoolSwapSpecific[](1);
            swapList[0] = CollectionRouter.PoolSwapSpecific({
                pool: pool,
                nftIds: nftIds,
                proof: new bytes32[](0),
                proofFlags: new bool[](0),
            externalFilterContext: new bytes(0)
            });
            router.swapNFTsForToken(
                swapList,
                outputAmount,
                payable(address(this)),
                block.timestamp
            );
        }
    }

    function test_swapSingleNFTForAnyNFT() public {
        // construct NFT to Token swap list
        uint256[] memory sellNFTIds = new uint256[](1);
        sellNFTIds[0] = numInitialNFTs + 1;
        CollectionRouter.PoolSwapSpecific[]
            memory nftToTokenSwapList = new CollectionRouter.PoolSwapSpecific[](1);
        nftToTokenSwapList[0] = CollectionRouter.PoolSwapSpecific({
            pool: pool,
            nftIds: sellNFTIds,
            proof: new bytes32[](0),
            proofFlags: new bool[](0),
            externalFilterContext: new bytes(0)
        });

        // construct Token to NFT swap list
        CollectionRouter.PoolSwapAny[]
            memory tokenToNFTSwapList = new CollectionRouter.PoolSwapAny[](1);
        tokenToNFTSwapList[0] = CollectionRouter.PoolSwapAny({
            pool: pool,
            numItems: 1
        });

        // NOTE: We send some tokens (more than enough) to cover the protocol fee needed
        uint256 inputAmount = 0.01 ether;
        this.swapNFTsForAnyNFTsThroughToken{
            value: modifyInputAmount(inputAmount)
        }(
            router,
            CollectionRouter.NFTsForAnyNFTsTrade({
                nftToTokenTrades: nftToTokenSwapList,
                tokenToNFTTrades: tokenToNFTSwapList
            }),
            0,
            payable(address(this)),
            address(this),
            block.timestamp,
            inputAmount
        );
    }

    function test_swapSingleNFTForSpecificNFT() public {
        // construct NFT to token swap list
        uint256[] memory sellNFTIds = new uint256[](1);
        sellNFTIds[0] = numInitialNFTs + 1;
        CollectionRouter.PoolSwapSpecific[]
            memory nftToTokenSwapList = new CollectionRouter.PoolSwapSpecific[](1);
        nftToTokenSwapList[0] = CollectionRouter.PoolSwapSpecific({
            pool: pool,
            nftIds: sellNFTIds,
            proof: new bytes32[](0),
            proofFlags: new bool[](0),
            externalFilterContext: new bytes(0)
        });

        // construct token to NFT swap list
        uint256[] memory buyNFTIds = new uint256[](1);
        buyNFTIds[0] = 1;
        CollectionRouter.PoolSwapSpecific[]
            memory tokenToNFTSwapList = new CollectionRouter.PoolSwapSpecific[](1);
        tokenToNFTSwapList[0] = CollectionRouter.PoolSwapSpecific({
            pool: pool,
            nftIds: buyNFTIds,
            proof: new bytes32[](0),
            proofFlags: new bool[](0),
            externalFilterContext: new bytes(0)
        });

        // NOTE: We send some tokens (more than enough) to cover the protocol fee
        uint256 inputAmount = 0.01 ether;
        this.swapNFTsForSpecificNFTsThroughToken{
            value: modifyInputAmount(inputAmount)
        }(
            router,
            CollectionRouter.NFTsForSpecificNFTsTrade({
                nftToTokenTrades: nftToTokenSwapList,
                tokenToNFTTrades: tokenToNFTSwapList
            }),
            0,
            payable(address(this)),
            address(this),
            block.timestamp,
            inputAmount
        );
    }

    function test_swapTokenforAny5NFTs() public {
        CollectionRouter.PoolSwapAny[]
            memory swapList = new CollectionRouter.PoolSwapAny[](1);
        swapList[0] = CollectionRouter.PoolSwapAny({pool: pool, numItems: 5});
        uint256 startBalance = test721.balanceOf(address(this));
        uint256 inputAmount;
        (, , inputAmount, ) = pool.getBuyNFTQuote(5);
        this.swapTokenForAnyNFTs{value: modifyInputAmount(inputAmount)}(
            router,
            swapList,
            payable(address(this)),
            address(this),
            block.timestamp,
            inputAmount
        );
        uint256 endBalance = test721.balanceOf(address(this));
        require((endBalance - startBalance) == 5, "Too few NFTs acquired");
    }

    function test_swapTokenforSpecific5NFTs() public {
        CollectionRouter.PoolSwapSpecific[]
            memory swapList = new CollectionRouter.PoolSwapSpecific[](1);
        uint256[] memory nftIds = new uint256[](5);
        nftIds[0] = 1;
        nftIds[1] = 2;
        nftIds[2] = 3;
        nftIds[3] = 4;
        nftIds[4] = 5;
        swapList[0] = CollectionRouter.PoolSwapSpecific({
            pool: pool,
            nftIds: nftIds,
            proof: new bytes32[](0),
            proofFlags: new bool[](0),
            externalFilterContext: new bytes(0)
        });
        uint256 startBalance = test721.balanceOf(address(this));
        uint256 inputAmount;
        (, , inputAmount, ) = pool.getBuyNFTQuote(5);
        this.swapTokenForSpecificNFTs{value: modifyInputAmount(inputAmount)}(
            router,
            swapList,
            payable(address(this)),
            address(this),
            block.timestamp,
            inputAmount
        );
        uint256 endBalance = test721.balanceOf(address(this));
        require((endBalance - startBalance) == 5, "Too few NFTs acquired");
    }

    function test_swap5NFTsForToken() public {
        (, , uint256 outputAmount, ) = pool.getSellNFTQuote(5);
        uint256[] memory nftIds = new uint256[](5);
        for (uint256 i = 0; i < 5; i++) {
            nftIds[i] = numInitialNFTs + i + 1;
        }
        CollectionRouter.PoolSwapSpecific[]
            memory swapList = new CollectionRouter.PoolSwapSpecific[](1);
        swapList[0] = CollectionRouter.PoolSwapSpecific({
            pool: pool,
            nftIds: nftIds,
            proof: new bytes32[](0),
            proofFlags: new bool[](0),
                externalFilterContext: new bytes(0)
        });
        router.swapNFTsForToken(
            swapList,
            outputAmount,
            payable(address(this)),
            block.timestamp
        );
    }

    function testFail_swapTokenForSingleAnyNFTSlippage() public {
        CollectionRouter.PoolSwapAny[]
            memory swapList = new CollectionRouter.PoolSwapAny[](1);
        swapList[0] = CollectionRouter.PoolSwapAny({pool: pool, numItems: 1});
        uint256 inputAmount;
        (, , inputAmount, ) = pool.getBuyNFTQuote(1);
        inputAmount = inputAmount - 1 wei;
        this.swapTokenForAnyNFTs{value: modifyInputAmount(inputAmount)}(
            router,
            swapList,
            payable(address(this)),
            address(this),
            block.timestamp,
            inputAmount
        );
    }

    function testFail_swapTokenForSingleSpecificNFTSlippage() public {
        uint256[] memory nftIds = new uint256[](1);
        nftIds[0] = 1;
        CollectionRouter.PoolSwapSpecific[]
            memory swapList = new CollectionRouter.PoolSwapSpecific[](1);
        swapList[0] = CollectionRouter.PoolSwapSpecific({
            pool: pool,
            nftIds: nftIds,
            proof: new bytes32[](0),
            proofFlags: new bool[](0),
                externalFilterContext: new bytes(0)
        });
        uint256 inputAmount;
        (, , inputAmount, ) = pool.getBuyNFTQuote(1);
        inputAmount = inputAmount - 1 wei;
        this.swapTokenForSpecificNFTs{value: modifyInputAmount(inputAmount)}(
            router,
            swapList,
            payable(address(this)),
            address(this),
            block.timestamp,
            inputAmount
        );
    }

    function testFail_swapSingleNFTForNonexistentToken() public {
        uint256[] memory nftIds = new uint256[](1);
        nftIds[0] = numInitialNFTs + 1;
        CollectionRouter.PoolSwapSpecific[]
            memory swapList = new CollectionRouter.PoolSwapSpecific[](1);
        swapList[0] = CollectionRouter.PoolSwapSpecific({
            pool: pool,
            nftIds: nftIds,
            proof: new bytes32[](0),
            proofFlags: new bool[](0),
                externalFilterContext: new bytes(0)
        });
        uint256 sellAmount;
        (, , sellAmount, ) = pool.getSellNFTQuote(1);
        sellAmount = sellAmount + 1 wei;
        router.swapNFTsForToken(
            swapList,
            sellAmount,
            payable(address(this)),
            block.timestamp
        );
    }

    function testFail_swapTokenForAnyNFTsPastBalance() public {
        uint256[] memory nftIds = new uint256[](1);
        nftIds[0] = numInitialNFTs + 1;
        CollectionRouter.PoolSwapAny[]
            memory swapList = new CollectionRouter.PoolSwapAny[](1);
        swapList[0] = CollectionRouter.PoolSwapAny({
            pool: pool,
            numItems: test721.balanceOf(address(pool)) + 1
        });
        uint256 inputAmount;
        (, , inputAmount, ) = pool.getBuyNFTQuote(
            test721.balanceOf(address(pool)) + 1
        );
        inputAmount = inputAmount + 1 wei;
        this.swapTokenForAnyNFTs{value: modifyInputAmount(inputAmount)}(
            router,
            swapList,
            payable(address(this)),
            address(this),
            block.timestamp,
            inputAmount
        );
    }

    function testFail_swapSingleNFTForTokenWithEmptyList() public {
        uint256[] memory nftIds = new uint256[](0);
        CollectionRouter.PoolSwapSpecific[]
            memory swapList = new CollectionRouter.PoolSwapSpecific[](1);
        swapList[0] = CollectionRouter.PoolSwapSpecific({
            pool: pool,
            nftIds: nftIds,
            proof: new bytes32[](0),
            proofFlags: new bool[](0),
                externalFilterContext: new bytes(0)
        });
        uint256 sellAmount;
        (, , sellAmount, ) = pool.getSellNFTQuote(1);
        sellAmount = sellAmount + 1 wei;
        router.swapNFTsForToken(
            swapList,
            sellAmount,
            payable(address(this)),
            block.timestamp
        );
    }
}
