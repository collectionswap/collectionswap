// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {DSTest} from "../lib/ds-test/test.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {StdCheats} from "forge-std/StdCheats.sol";

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

abstract contract RouterSinglePoolWithAssetRecipient is StdCheats, DSTest, ERC721Holder, Configurable, RouterCaller {
    IERC721Mintable test721;
    ICurve bondingCurve;
    CollectionPoolFactory factory;
    CollectionRouter router;
    CollectionPool sellPool; // Gives NFTs, takes in tokens
    CollectionPool buyPool; // Takes in NFTs, gives tokens
    address payable constant feeRecipient = payable(address(69));
    address payable constant sellPoolRecipient = payable(address(1));
    address payable constant buyPoolRecipient = payable(address(2));
    uint256 constant protocolFeeMultiplier = 0;
    uint256 constant carryFeeMultiplier = 0;
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
        uint256[] memory sellIDList = new uint256[](numInitialNFTs);
        uint256[] memory buyIDList = new uint256[](numInitialNFTs);
        for (uint256 i = 1; i <= 2 * numInitialNFTs; i++) {
            test721.mint(address(this), i);
            if (i <= numInitialNFTs) {
                sellIDList[i - 1] = i;
            } else {
                buyIDList[i - numInitialNFTs - 1] = i;
            }
        }

        // Create a sell pool with a spot price of 1 eth, 10 NFTs, and no price increases
        // All stuff gets sent to assetRecipient
        sellPool = this.setupPool{value: modifyInputAmount(10 ether)}(
            factory,
            test721,
            bondingCurve,
            sellPoolRecipient,
            ICollectionPool.PoolType.NFT,
            modifyDelta(uint64(delta)),
            0,
            spotPrice,
            sellIDList,
            10 ether,
            address(router)
        );

        // Create a buy pool with a spot price of 1 eth, 10 NFTs, and no price increases
        // All stuff gets sent to assetRecipient
        buyPool = this.setupPool{value: modifyInputAmount(10 ether)}(
            factory,
            test721,
            bondingCurve,
            buyPoolRecipient,
            ICollectionPool.PoolType.TOKEN,
            modifyDelta(uint64(delta)),
            0,
            spotPrice,
            buyIDList,
            10 ether,
            address(router)
        );

        // skip 1 second so that trades are not in the same timestamp as pool creation
        skip(1);

        // mint extra NFTs to this contract (i.e. to be held by the caller)
        for (uint256 i = 2 * numInitialNFTs + 1; i <= 3 * numInitialNFTs; i++) {
            test721.mint(address(this), i);
        }
    }

    function test_swapTokenForSingleAnyNFT() public {
        CollectionRouter.PoolSwapAny[] memory swapList = new CollectionRouter.PoolSwapAny[](1);
        swapList[0] = CollectionRouter.PoolSwapAny({pool: sellPool, numItems: 1});
        uint256 inputAmount;
        (,,,, inputAmount,,) = sellPool.getBuyNFTQuote(1);
        this.swapTokenForAnyNFTs{value: modifyInputAmount(inputAmount)}(
            router, swapList, payable(address(this)), address(this), block.timestamp, inputAmount
        );
        assertEq(getBalance(sellPoolRecipient), inputAmount);
    }

    function test_swapTokenForSingleSpecificNFT() public {
        uint256[] memory nftIds = new uint256[](1);
        nftIds[0] = 1;
        CollectionRouter.PoolSwapSpecific[] memory swapList = new CollectionRouter.PoolSwapSpecific[](1);
        swapList[0] = CollectionRouter.PoolSwapSpecific({
            pool: sellPool,
            nftIds: nftIds,
            proof: new bytes32[](0),
            proofFlags: new bool[](0),
            proofLeaves: new bytes32[](0)
        });
        uint256 inputAmount;
        (,,,, inputAmount,,) = sellPool.getBuyNFTQuote(1);
        this.swapTokenForSpecificNFTs{value: modifyInputAmount(inputAmount)}(
            router, swapList, payable(address(this)), address(this), block.timestamp, inputAmount
        );
        assertEq(getBalance(sellPoolRecipient), inputAmount);
    }

    function test_swapSingleNFTForToken() public {
        (,,,, uint256 outputAmount,,) = buyPool.getSellNFTQuote(1);
        uint256 beforeBuyPoolNFTBalance = test721.balanceOf(address(buyPool));
        uint256[] memory nftIds = new uint256[](1);
        nftIds[0] = numInitialNFTs * 2 + 1;
        CollectionRouter.PoolSwapSpecific[] memory swapList = new CollectionRouter.PoolSwapSpecific[](1);
        swapList[0] = CollectionRouter.PoolSwapSpecific({
            pool: buyPool,
            nftIds: nftIds,
            proof: new bytes32[](0),
            proofFlags: new bool[](0),
            proofLeaves: new bytes32[](0)
        });
        router.swapNFTsForToken(swapList, outputAmount, payable(address(this)), block.timestamp);
        assertEq(test721.balanceOf(buyPoolRecipient), 1);
        // Pool should still keep track of the same number of NFTs prior to the swap
        // because we sent the NFT to the asset recipient (and not the pool)
        uint256 afterBuyPoolNFTBalance = (buyPool.getAllHeldIds()).length;
        assertEq(beforeBuyPoolNFTBalance, afterBuyPoolNFTBalance);
    }

    function test_swapSingleNFTForAnyNFT() public {
        // construct NFT to Token swap list
        uint256[] memory sellNFTIds = new uint256[](1);
        sellNFTIds[0] = 2 * numInitialNFTs + 1;
        CollectionRouter.PoolSwapSpecific[] memory nftToTokenSwapList = new CollectionRouter.PoolSwapSpecific[](1);
        nftToTokenSwapList[0] = CollectionRouter.PoolSwapSpecific({
            pool: buyPool,
            nftIds: sellNFTIds,
            proof: new bytes32[](0),
            proofFlags: new bool[](0),
            proofLeaves: new bytes32[](0)
        });
        // construct Token to NFT swap list
        CollectionRouter.PoolSwapAny[] memory tokenToNFTSwapList = new CollectionRouter.PoolSwapAny[](1);
        tokenToNFTSwapList[0] = CollectionRouter.PoolSwapAny({pool: sellPool, numItems: 1});
        uint256 sellAmount;
        (,,,, sellAmount,,) = sellPool.getBuyNFTQuote(1);
        // Note: we send a little bit of tokens with the call because the exponential curve increases price ever so slightly
        uint256 inputAmount = 0.1 ether;
        this.swapNFTsForAnyNFTsThroughToken{value: modifyInputAmount(inputAmount)}(
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
        assertEq(test721.balanceOf(buyPoolRecipient), 1);
        assertEq(getBalance(sellPoolRecipient), sellAmount);
    }

    function test_swapSingleNFTForSpecificNFT() public {
        // construct NFT to token swap list
        uint256[] memory sellNFTIds = new uint256[](1);
        sellNFTIds[0] = 2 * numInitialNFTs + 1;
        CollectionRouter.PoolSwapSpecific[] memory nftToTokenSwapList = new CollectionRouter.PoolSwapSpecific[](1);
        nftToTokenSwapList[0] = CollectionRouter.PoolSwapSpecific({
            pool: buyPool,
            nftIds: sellNFTIds,
            proof: new bytes32[](0),
            proofFlags: new bool[](0),
            proofLeaves: new bytes32[](0)
        });

        // construct token to NFT swap list
        uint256[] memory buyNFTIds = new uint256[](1);
        buyNFTIds[0] = numInitialNFTs;
        CollectionRouter.PoolSwapSpecific[] memory tokenToNFTSwapList = new CollectionRouter.PoolSwapSpecific[](1);
        tokenToNFTSwapList[0] = CollectionRouter.PoolSwapSpecific({
            pool: sellPool,
            nftIds: buyNFTIds,
            proof: new bytes32[](0),
            proofFlags: new bool[](0),
            proofLeaves: new bytes32[](0)
        });
        uint256 sellAmount;
        (,,,, sellAmount,,) = sellPool.getBuyNFTQuote(1);
        // Note: we send a little bit of tokens with the call because the exponential curve increases price ever so slightly
        uint256 inputAmount = 0.1 ether;
        this.swapNFTsForSpecificNFTsThroughToken{value: modifyInputAmount(inputAmount)}(
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
        assertEq(test721.balanceOf(buyPoolRecipient), 1);
        assertEq(getBalance(sellPoolRecipient), sellAmount);
    }

    function test_swapTokenforAny5NFTs() public {
        CollectionRouter.PoolSwapAny[] memory swapList = new CollectionRouter.PoolSwapAny[](1);
        swapList[0] = CollectionRouter.PoolSwapAny({pool: sellPool, numItems: 5});
        uint256 startBalance = test721.balanceOf(address(this));
        uint256 inputAmount;
        (,,,, inputAmount,,) = sellPool.getBuyNFTQuote(5);
        this.swapTokenForAnyNFTs{value: modifyInputAmount(inputAmount)}(
            router, swapList, payable(address(this)), address(this), block.timestamp, inputAmount
        );
        uint256 endBalance = test721.balanceOf(address(this));
        require((endBalance - startBalance) == 5, "Too few NFTs acquired");
        assertEq(getBalance(sellPoolRecipient), inputAmount);
    }

    function test_swapTokenforSpecific5NFTs() public {
        CollectionRouter.PoolSwapSpecific[] memory swapList = new CollectionRouter.PoolSwapSpecific[](1);
        uint256[] memory nftIds = new uint256[](5);
        nftIds[0] = 1;
        nftIds[1] = 2;
        nftIds[2] = 3;
        nftIds[3] = 4;
        nftIds[4] = 5;
        swapList[0] = CollectionRouter.PoolSwapSpecific({
            pool: sellPool,
            nftIds: nftIds,
            proof: new bytes32[](0),
            proofFlags: new bool[](0),
            proofLeaves: new bytes32[](0)
        });
        uint256 startBalance = test721.balanceOf(address(this));
        uint256 inputAmount;
        (,,,, inputAmount,,) = sellPool.getBuyNFTQuote(5);
        this.swapTokenForSpecificNFTs{value: modifyInputAmount(inputAmount)}(
            router, swapList, payable(address(this)), address(this), block.timestamp, inputAmount
        );
        uint256 endBalance = test721.balanceOf(address(this));
        require((endBalance - startBalance) == 5, "Too few NFTs acquired");
        assertEq(getBalance(sellPoolRecipient), inputAmount);
    }

    function test_swap5NFTsForToken() public {
        (,,,, uint256 outputAmount,,) = buyPool.getSellNFTQuote(5);
        uint256 beforeBuyPoolNFTBalance = test721.balanceOf(address(buyPool));
        uint256[] memory nftIds = new uint256[](5);
        for (uint256 i = 0; i < 5; i++) {
            nftIds[i] = 2 * numInitialNFTs + i + 1;
        }
        CollectionRouter.PoolSwapSpecific[] memory swapList = new CollectionRouter.PoolSwapSpecific[](1);
        swapList[0] = CollectionRouter.PoolSwapSpecific({
            pool: buyPool,
            nftIds: nftIds,
            proof: new bytes32[](0),
            proofFlags: new bool[](0),
            proofLeaves: new bytes32[](0)
        });
        router.swapNFTsForToken(swapList, outputAmount, payable(address(this)), block.timestamp);
        assertEq(test721.balanceOf(buyPoolRecipient), 5);
        // Pool should still keep track of the same number of NFTs prior to the swap
        // because we sent the NFT to the asset recipient (and not the pool)
        uint256 afterBuyPoolNFTBalance = (buyPool.getAllHeldIds()).length;
        assertEq(beforeBuyPoolNFTBalance, afterBuyPoolNFTBalance);
    }

    function test_swapSingleNFTForTokenWithProtocolFee() public {
        // Set protocol fee to be 10%
        factory.changeProtocolFeeMultiplier(0.1e18);
        uint256[] memory nftIds = new uint256[](1);
        nftIds[0] = numInitialNFTs * 2 + 1;
        CollectionRouter.PoolSwapSpecific[] memory swapList = new CollectionRouter.PoolSwapSpecific[](1);
        swapList[0] = CollectionRouter.PoolSwapSpecific({
            pool: buyPool,
            nftIds: nftIds,
            proof: new bytes32[](0),
            proofFlags: new bool[](0),
            proofLeaves: new bytes32[](0)
        });
        (,,,, uint256 outputAmount,,) = buyPool.getSellNFTQuote(1);
        uint256 output = router.swapNFTsForToken(swapList, outputAmount, payable(address(this)), block.timestamp);
        // User gets 90% of the tokens (which is output) and the other 10% goes to the factory
        assertEq(getBalance(address(factory)), output / 9);
    }

    function test_swapTokenForSingleSpecificNFTWithProtocolFee() public {
        // Set protocol fee to be 10%
        factory.changeProtocolFeeMultiplier(0.1e18);
        uint256[] memory nftIds = new uint256[](1);
        nftIds[0] = 1;
        CollectionRouter.PoolSwapSpecific[] memory swapList = new CollectionRouter.PoolSwapSpecific[](1);
        swapList[0] = CollectionRouter.PoolSwapSpecific({
            pool: sellPool,
            nftIds: nftIds,
            proof: new bytes32[](0),
            proofFlags: new bool[](0),
            proofLeaves: new bytes32[](0)
        });
        uint256 inputAmount;
        (,,,, inputAmount,,) = sellPool.getBuyNFTQuote(1);
        this.swapTokenForSpecificNFTs{value: modifyInputAmount(inputAmount)}(
            router, swapList, payable(address(this)), address(this), block.timestamp, inputAmount
        );
        // Assert 90% and 10% split of the buy amount between sellPoolRecipient and the factory
        assertEq(getBalance(address(factory)), inputAmount / 11);
        assertEq(getBalance(sellPoolRecipient) + getBalance(address(factory)), inputAmount);
    }

    function test_swapTokenForSingleAnyNFTWithProtocolFee() public {
        // Set protocol fee to be 10%
        factory.changeProtocolFeeMultiplier(0.1e18);
        CollectionRouter.PoolSwapAny[] memory swapList = new CollectionRouter.PoolSwapAny[](1);
        swapList[0] = CollectionRouter.PoolSwapAny({pool: sellPool, numItems: 1});
        uint256 inputAmount;
        (,,,, inputAmount,,) = sellPool.getBuyNFTQuote(1);
        this.swapTokenForAnyNFTs{value: modifyInputAmount(inputAmount)}(
            router, swapList, payable(address(this)), address(this), block.timestamp, inputAmount
        );
        // Assert 90% and 10% split of the buy amount between sellPoolRecipient and the factory
        assertEq(getBalance(address(factory)), inputAmount / 11);
        assertEq(getBalance(sellPoolRecipient) + getBalance(address(factory)), inputAmount);
    }
}
