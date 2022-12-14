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

// Gives more realistic scenarios where swaps have to go through multiple pools, for more accurate gas profiling
abstract contract RouterMultiPool is StdCheats, DSTest, ERC721Holder, Configurable, RouterCaller {
    IERC721Mintable test721;
    ICurve bondingCurve;
    CollectionPoolFactory factory;
    CollectionRouter router;
    mapping(uint256 => CollectionPool) pools;
    address payable constant feeRecipient = payable(address(69));
    uint256 constant protocolFeeMultiplier = 3e15;
    uint256 constant carryFeeMultiplier = 3e15;
    uint256 numInitialNFTs = 10;

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

        // mint NFT #1-10 to caller
        for (uint256 i = 1; i <= numInitialNFTs; i++) {
            test721.mint(address(this), i);
        }

        // Pool 1 has NFT#1 at 1 ETH price, willing to also buy at the same price
        // Pool 2 has NFT#2 at 2 ETH price, willing to also buy at the same price
        // Pool 3 has NFT#3 at 3 ETH price, willing to also buy at the same price
        // Pool 4 has NFT#4 at 4 ETH price, willing to also buy at the same price
        // Pool 5 has NFT#5 at 5 ETH price, willing to also buy at the same price
        // For all, assume no price changes
        for (uint256 i = 1; i <= 5; i++) {
            uint256[] memory idList = new uint256[](1);
            idList[0] = i;
            pools[i] = this.setupPool{value: modifyInputAmount(i * 1 ether)}(
                factory,
                test721,
                bondingCurve,
                payable(address(0)),
                ICollectionPool.PoolType.TRADE,
                modifyDelta(0),
                0,
                uint128(i * 1 ether),
                idList,
                (i * 1 ether),
                address(router)
            );
        }

        // skip 1 second so that trades are not in the same timestamp as pool creation
        skip(1);
    }

    function test_swapTokenForAny5NFTs() public {
        // Swap across all 5 pools
        CollectionRouter.PoolSwapAny[] memory swapList = new CollectionRouter.PoolSwapAny[](5);
        uint256 totalInputAmount = 0;
        for (uint256 i = 0; i < 5; i++) {
            uint256 inputAmount;
            (,,,, inputAmount,,) = pools[i + 1].getBuyNFTQuote(1);
            totalInputAmount += inputAmount;
            swapList[i] = CollectionRouter.PoolSwapAny({pool: pools[i + 1], numItems: 1});
        }
        uint256 startBalance = test721.balanceOf(address(this));
        this.swapTokenForAnyNFTs{value: modifyInputAmount(totalInputAmount)}(
            router, swapList, payable(address(this)), address(this), block.timestamp, totalInputAmount
        );
        uint256 endBalance = test721.balanceOf(address(this));
        require((endBalance - startBalance) == 5, "Too few NFTs acquired");
    }

    function test_swapTokenForSpecific5NFTs() public {
        // Swap across all 5 pools
        CollectionRouter.PoolSwapSpecific[] memory swapList = new CollectionRouter.PoolSwapSpecific[](5);
        uint256 totalInputAmount = 0;
        for (uint256 i = 0; i < 5; i++) {
            uint256 inputAmount;
            (,,,, inputAmount,,) = pools[i + 1].getBuyNFTQuote(1);
            totalInputAmount += inputAmount;
            uint256[] memory nftIds = new uint256[](1);
            nftIds[0] = i + 1;
            swapList[i] = CollectionRouter.PoolSwapSpecific({
                pool: pools[i + 1],
                nftIds: nftIds,
                proof: new bytes32[](0),
                proofFlags: new bool[](0),
                proofLeaves: new bytes32[](0)
            });
        }
        uint256 startBalance = test721.balanceOf(address(this));
        this.swapTokenForSpecificNFTs{value: modifyInputAmount(totalInputAmount)}(
            router, swapList, payable(address(this)), address(this), block.timestamp, totalInputAmount
        );
        uint256 endBalance = test721.balanceOf(address(this));
        require((endBalance - startBalance) == 5, "Too few NFTs acquired");
    }

    function test_swap5NFTsForToken() public {
        // Swap across all 5 pools
        CollectionRouter.PoolSwapSpecific[] memory swapList = new CollectionRouter.PoolSwapSpecific[](5);
        uint256 totalOutputAmount = 0;
        for (uint256 i = 0; i < 5; i++) {
            uint256 outputAmount;
            (,,,, outputAmount,,) = pools[i + 1].getSellNFTQuote(1);
            totalOutputAmount += outputAmount;
            uint256[] memory nftIds = new uint256[](1);
            // Set it to be an ID we own
            nftIds[0] = i + 6;
            swapList[i] = CollectionRouter.PoolSwapSpecific({
                pool: pools[i + 1],
                nftIds: nftIds,
                proof: new bytes32[](0),
                proofFlags: new bool[](0),
                proofLeaves: new bytes32[](0)
            });
        }
        uint256 startBalance = test721.balanceOf(address(this));
        router.swapNFTsForToken(swapList, totalOutputAmount, payable(address(this)), block.timestamp);
        uint256 endBalance = test721.balanceOf(address(this));
        require((startBalance - endBalance) == 5, "Too few NFTs sold");
    }
}
