// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {DSTest} from "../lib/ds-test/test.sol";
import {ERC20} from "solmate/src/tokens/ERC20.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import {StdCheats} from "forge-std/StdCheats.sol";

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
import {Hevm} from "../utils/Hevm.sol";
import {Configurable} from "../mixins/Configurable.sol";
import {RouterCaller} from "../mixins/RouterCaller.sol";

abstract contract RouterRobustSwap is
    StdCheats,
    DSTest,
    ERC721Holder,
    Configurable,
    RouterCaller
{
    IERC721Mintable test721;
    ICurve bondingCurve;
    CollectionPoolFactory factory;
    CollectionRouter router;

    // Create 3 pools
    CollectionPool pool1;
    CollectionPool pool2;
    CollectionPool pool3;

    address payable constant feeRecipient = payable(address(69));

    // Set protocol fee to be 10%
    uint256 constant protocolFeeMultiplier = 1e17;
    uint256 constant carryFeeMultiplier = 1e17;

    function setUp() public {
        // Create contracts
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

        uint256[] memory empty;
        uint256 nftIndex = 0;

        // Create 3 pools with 0 delta and 0 trade fee
        // pool 1 has spot price of 0.1 TOKEN, then pool 2 has 0.2 TOKEN, and pool 3 has 0.3 TOKEN
        // Send 10 NFTs to each pool
        // (0-9), (10-19), (20-29)

        // Pools must be properly notified of deposits
        uint256[] memory nftIds = new uint256[](10);
        bytes32[] memory proof = new bytes32[](0);
        bool[] memory proofFlags = new bool[](0);

        pool1 = this.setupPool{value: modifyInputAmount(10 ether)}(
            factory,
            test721,
            bondingCurve,
            payable(address(0)),
            ICollectionPool.PoolType.TRADE,
            modifyDelta(0),
            0,
            0.1 ether,
            empty,
            10 ether,
            address(router)
        );
        for (uint256 j = 0; j < 10; j++) {
            test721.mint(address(this), nftIndex);
            nftIds[j] = nftIndex;
            nftIndex++;
        }
        factory.depositNFTs(nftIds, proof, proofFlags, address(pool1), address(this));

        pool2 = this.setupPool{value: modifyInputAmount(10 ether)}(
            factory,
            test721,
            bondingCurve,
            payable(address(0)),
            ICollectionPool.PoolType.TRADE,
            modifyDelta(0),
            0,
            0.2 ether,
            empty,
            10 ether,
            address(router)
        );
        for (uint256 j = 0; j < 10; j++) {
            test721.mint(address(this), nftIndex);
            nftIds[j] = nftIndex;
            nftIndex++;
        }
        factory.depositNFTs(nftIds, proof, proofFlags, address(pool2), address(this));

        pool3 = this.setupPool{value: modifyInputAmount(10 ether)}(
            factory,
            test721,
            bondingCurve,
            payable(address(0)),
            ICollectionPool.PoolType.TRADE,
            modifyDelta(0),
            0,
            0.3 ether,
            empty,
            10 ether,
            address(router)
        );
        for (uint256 j = 0; j < 10; j++) {
            test721.mint(address(this), nftIndex);
            nftIds[j] = nftIndex;
            nftIndex++;
        }
        factory.depositNFTs(nftIds, proof, proofFlags, address(pool3), address(this));

        // Mint NFTs 30-39 to this contract
        for (uint256 i = 0; i < 10; i++) {
            test721.mint(address(this), nftIndex);
            nftIndex++;
        }

        // skip 1 second so that trades are not in the same timestamp as pool creation
        skip(1);
    }

    // Test where pool 1 and pool 2 swap tokens for NFT succeed but pool 3 fails
    function test_robustSwapTokenForAny2NFTs() public {
        CollectionRouter.RobustPoolSwapAny[]
            memory swapList = new CollectionRouter.RobustPoolSwapAny[](3);

        (, , , uint256 pool1InputAmount, ) = pool1.getBuyNFTQuote(2);
        (, , , uint256 pool2InputAmount, ) = pool2.getBuyNFTQuote(2);

        swapList[0] = CollectionRouter.RobustPoolSwapAny({
            swapInfo: CollectionRouter.PoolSwapAny({pool: pool1, numItems: 2}),
            maxCost: pool2InputAmount
        });
        swapList[1] = CollectionRouter.RobustPoolSwapAny({
            swapInfo: CollectionRouter.PoolSwapAny({pool: pool2, numItems: 2}),
            maxCost: pool2InputAmount
        });
        swapList[2] = CollectionRouter.RobustPoolSwapAny({
            swapInfo: CollectionRouter.PoolSwapAny({pool: pool3, numItems: 2}),
            maxCost: pool2InputAmount
        });

        uint256 beforeNFTBalance = test721.balanceOf(address(this));

        // Expect to have the first two swapPools succeed, and the last one silently fail
        // with 10% protocol fee:
        uint256 remainingValue = this.robustSwapTokenForAnyNFTs{
            value: modifyInputAmount(pool2InputAmount * 3)
        }(
            router,
            swapList,
            payable(address(this)),
            address(this),
            block.timestamp,
            pool2InputAmount * 3
        );

        uint256 afterNFTBalance = test721.balanceOf(address(this));

        // If the first two swap pools succeed, we gain 4 NFTs
        assertEq((afterNFTBalance - beforeNFTBalance), 4, "Incorrect NFT swap");

        assertEq(
            remainingValue,
            pool2InputAmount * 3 - (pool1InputAmount + pool2InputAmount),
            "Incorrect refund"
        );
    }

    // Test where pool 1 and pool 2 swap tokens for NFT succeed but pool 3 fails
    function test_robustSwapTokenFor2SpecificNFTs() public {
        uint256[] memory nftIds1 = new uint256[](2);
        nftIds1[0] = 0;
        nftIds1[1] = 1;

        uint256[] memory nftIds2 = new uint256[](2);
        nftIds2[0] = 10;
        nftIds2[1] = 11;

        uint256[] memory nftIds3 = new uint256[](2);
        nftIds3[0] = 20;
        nftIds3[1] = 21;

        (, , , uint256 pool1InputAmount, ) = pool1.getBuyNFTQuote(2);
        (, , , uint256 pool2InputAmount, ) = pool2.getBuyNFTQuote(2);

        CollectionRouter.RobustPoolSwapSpecific[]
            memory swapList = new CollectionRouter.RobustPoolSwapSpecific[](3);
        swapList[0] = CollectionRouter.RobustPoolSwapSpecific({
            swapInfo: CollectionRouter.PoolSwapSpecific({
                pool: pool1,
                nftIds: nftIds1,
                proof: new bytes32[](0),
                proofFlags: new bool[](0)
            }),
            maxCost: pool2InputAmount
        });
        swapList[1] = CollectionRouter.RobustPoolSwapSpecific({
            swapInfo: CollectionRouter.PoolSwapSpecific({
                pool: pool2,
                nftIds: nftIds2,
                proof: new bytes32[](0),
                proofFlags: new bool[](0)
            }),
            maxCost: pool2InputAmount
        });
        swapList[2] = CollectionRouter.RobustPoolSwapSpecific({
            swapInfo: CollectionRouter.PoolSwapSpecific({
                pool: pool3,
                nftIds: nftIds3,
                proof: new bytes32[](0),
                proofFlags: new bool[](0)
            }),
            maxCost: pool2InputAmount
        });

        uint256 beforeNFTBalance = test721.balanceOf(address(this));

        // Expect to have the first two swapPools succeed, and the last one silently fail
        // with 10% protocol fee:
        uint256 remainingValue = this.robustSwapTokenForSpecificNFTs{
            value: modifyInputAmount(pool2InputAmount * 3)
        }(
            router,
            swapList,
            payable(address(this)),
            address(this),
            block.timestamp,
            pool2InputAmount * 3
        );

        uint256 afterNFTBalance = test721.balanceOf(address(this));

        // If the first two swap pools succeed we gain 4 NFTs
        assertEq((afterNFTBalance - beforeNFTBalance), 4, "Incorrect NFT swap");
        assertEq(
            remainingValue,
            pool2InputAmount * 3 - (pool1InputAmount + pool2InputAmount),
            "Incorrect ETH refund"
        );
    }

    // Test where selling to pool 2 and pool 3 succeeds, but selling to pool 1 fails
    function test_robustSwap2NFTsForToken() public {
        uint256[] memory nftIds1 = new uint256[](2);
        nftIds1[0] = 30;
        nftIds1[1] = 31;

        uint256[] memory nftIds2 = new uint256[](2);
        nftIds2[0] = 32;
        nftIds2[1] = 33;

        uint256[] memory nftIds3 = new uint256[](2);
        nftIds3[0] = 34;
        nftIds3[1] = 35;

        (, , , uint256 pool2OutputAmount, ) = pool2.getSellNFTQuote(2);
        (, , , uint256 pool3OutputAmount, ) = pool3.getSellNFTQuote(2);

        CollectionRouter.RobustPoolSwapSpecificForToken[]
            memory swapList = new CollectionRouter.RobustPoolSwapSpecificForToken[](
                3
            );
        swapList[0] = CollectionRouter.RobustPoolSwapSpecificForToken({
            swapInfo: CollectionRouter.PoolSwapSpecific({
                pool: pool1,
                nftIds: nftIds1,
                proof: new bytes32[](0),
                proofFlags: new bool[](0)
            }),
            minOutput: pool2OutputAmount
        });
        swapList[1] = CollectionRouter.RobustPoolSwapSpecificForToken({
            swapInfo: CollectionRouter.PoolSwapSpecific({
                pool: pool2,
                nftIds: nftIds2,
                proof: new bytes32[](0),
                proofFlags: new bool[](0)
            }),
            minOutput: pool2OutputAmount
        });
        swapList[2] = CollectionRouter.RobustPoolSwapSpecificForToken({
            swapInfo: CollectionRouter.PoolSwapSpecific({
                pool: pool3,
                nftIds: nftIds3,
                proof: new bytes32[](0),
                proofFlags: new bool[](0)
            }),
            minOutput: pool2OutputAmount
        });

        uint256 beforeNFTBalance = test721.balanceOf(address(this));

        // Expect to have the last two swapPools succeed, and the first one silently fail
        // with 10% protocol fee:
        uint256 remainingValue = router.robustSwapNFTsForToken(
            swapList,
            payable(address(this)),
            block.timestamp
        );

        uint256 afterNFTBalance = test721.balanceOf(address(this));

        assertEq((beforeNFTBalance - afterNFTBalance), 4, "Incorrect NFT swap");
        assertEq(
            remainingValue,
            pool3OutputAmount + pool2OutputAmount,
            "Incorrect ETH received"
        );
    }

    // Test where selling to pool 2 succeeds,
    // but selling to pool 1 fails due to slippage
    // and selling to pool 3 fails due to a bonding curve error
    function test_robustSwapNFTsForTokenWithBondingCurveError() public {
        uint256[] memory nftIds1 = new uint256[](2);
        nftIds1[0] = 30;
        nftIds1[1] = 31;

        uint256[] memory nftIds2 = new uint256[](2);
        nftIds2[0] = 32;
        nftIds2[1] = 33;

        uint256[] memory nftIds3 = new uint256[](0);

        (, , , uint256 pool2OutputAmount, ) = pool2.getSellNFTQuote(2);

        CollectionRouter.RobustPoolSwapSpecificForToken[]
            memory swapList = new CollectionRouter.RobustPoolSwapSpecificForToken[](
                3
            );
        swapList[0] = CollectionRouter.RobustPoolSwapSpecificForToken({
            swapInfo: CollectionRouter.PoolSwapSpecific({
                pool: pool1,
                nftIds: nftIds1,
                proof: new bytes32[](0),
                proofFlags: new bool[](0)
            }),
            minOutput: pool2OutputAmount
        });
        swapList[1] = CollectionRouter.RobustPoolSwapSpecificForToken({
            swapInfo: CollectionRouter.PoolSwapSpecific({
                pool: pool2,
                nftIds: nftIds2,
                proof: new bytes32[](0),
                proofFlags: new bool[](0)
            }),
            minOutput: pool2OutputAmount
        });
        swapList[2] = CollectionRouter.RobustPoolSwapSpecificForToken({
            swapInfo: CollectionRouter.PoolSwapSpecific({
                pool: pool3,
                nftIds: nftIds3,
                proof: new bytes32[](0),
                proofFlags: new bool[](0)
            }),
            minOutput: pool2OutputAmount
        });

        uint256 beforeNFTBalance = test721.balanceOf(address(this));

        // Expect to have the last two swapPools succeed, and the first one silently fail
        // with 10% protocol fee:
        uint256 remainingValue = router.robustSwapNFTsForToken(
            swapList,
            payable(address(this)),
            block.timestamp
        );

        uint256 afterNFTBalance = test721.balanceOf(address(this));

        assertEq((beforeNFTBalance - afterNFTBalance), 2, "Incorrect NFT swap");
        assertEq(remainingValue, pool2OutputAmount, "Incorrect ETH received");
    }

    // Test where we buy and sell in the same tx
    function test_robustSwapNFTsForTokenAndTokenForNFTs() public {
        // Check that we own #0 and #1, and that we don't own #32 and #33
        assertEq(test721.ownerOf(0), address(pool1));
        assertEq(test721.ownerOf(1), address(pool1));
        assertEq(test721.ownerOf(32), address(this));
        assertEq(test721.ownerOf(33), address(this));

        (, , , uint256 pool1InputAmount, ) = pool1.getBuyNFTQuote(2);
        (, , , uint256 pool2OutputAmount, ) = pool2.getSellNFTQuote(2);

        uint256[] memory nftIds1 = new uint256[](2);
        nftIds1[0] = 0;
        nftIds1[1] = 1;
        CollectionRouter.RobustPoolSwapSpecific[]
            memory tokenToNFTSwapList = new CollectionRouter.RobustPoolSwapSpecific[](
                1
            );
        tokenToNFTSwapList[0] = CollectionRouter.RobustPoolSwapSpecific({
            swapInfo: CollectionRouter.PoolSwapSpecific({
                pool: pool1,
                nftIds: nftIds1,
                proof: new bytes32[](0),
                proofFlags: new bool[](0)
            }),
            maxCost: pool1InputAmount
        });

        // We queue up a NFT->Token swap that should work
        uint256[] memory nftIds2 = new uint256[](2);
        nftIds2[0] = 32;
        nftIds2[1] = 33;
        CollectionRouter.RobustPoolSwapSpecificForToken[]
            memory nftToTokenSwapList = new CollectionRouter.RobustPoolSwapSpecificForToken[](
                1
            );
        nftToTokenSwapList[0] = CollectionRouter.RobustPoolSwapSpecificForToken({
            swapInfo: CollectionRouter.PoolSwapSpecific({
                pool: pool2,
                nftIds: nftIds2,
                proof: new bytes32[](0),
                proofFlags: new bool[](0)
            }),
            minOutput: pool2OutputAmount
        });

        // Do the swap
        uint256 inputAmount = pool1InputAmount;
        this.robustSwapTokenForSpecificNFTsAndNFTsForTokens{
            value: modifyInputAmount(inputAmount)
        }(
            router,
            CollectionRouter.RobustPoolNFTsFoTokenAndTokenforNFTsTrade({
                nftToTokenTrades: nftToTokenSwapList,
                tokenToNFTTrades: tokenToNFTSwapList,
                inputAmount: inputAmount,
                tokenRecipient: payable(address(this)),
                nftRecipient: address(this)
            })
        );

        // Check that we own #0 and #1, and that we don't own #32 and #33
        assertEq(test721.ownerOf(0), address(this));
        assertEq(test721.ownerOf(1), address(this));
        assertEq(test721.ownerOf(32), address(pool2));
        assertEq(test721.ownerOf(33), address(pool2));
    }
}
