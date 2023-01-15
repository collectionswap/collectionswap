// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {Test} from "forge-std/Test.sol";
import {ERC20} from "solmate/src/tokens/ERC20.sol";

import {ICurve} from "../../../contracts/bonding-curves/ICurve.sol";
import {IERC721Mintable} from "../interfaces/IERC721Mintable.sol";
import {IMintable} from "../interfaces/IMintable.sol";
import {Test20} from "../../../contracts/test/mocks/Test20.sol";
import {ICollectionPool} from "../../../contracts/pools/ICollectionPool.sol";
import {CollectionPoolFactory} from "../../../contracts/pools/CollectionPoolFactory.sol";
import {CollectionPool} from "../../../contracts/pools/CollectionPool.sol";
import {CollectionPoolETH} from "../../../contracts/pools/CollectionPoolETH.sol";
import {CollectionPoolERC20} from "../../../contracts/pools/CollectionPoolERC20.sol";
import {CollectionPoolEnumerableETH} from "../../../contracts/pools/CollectionPoolEnumerableETH.sol";
import {CollectionPoolMissingEnumerableETH} from "../../../contracts/pools/CollectionPoolMissingEnumerableETH.sol";
import {CollectionPoolEnumerableERC20} from "../../../contracts/pools/CollectionPoolEnumerableERC20.sol";
import {CollectionPoolMissingEnumerableERC20} from "../../../contracts/pools/CollectionPoolMissingEnumerableERC20.sol";
import {Configurable} from "../mixins/Configurable.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import {Test721} from "../../../contracts/test/mocks/Test721.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {Test1155} from "../../../contracts/test/mocks/Test1155.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

abstract contract PoolAndFactory is StdCheats, Test, ERC721Holder, Configurable, ERC1155Holder {
    uint128 delta = 1.1 ether;
    uint128 spotPrice = 1 ether;
    uint256 tokenAmount = 10 ether;
    uint256 numItems = 2;
    uint256[] idList;
    IERC721 test721;
    Test1155 test1155;
    ERC20 testERC20;
    ICurve bondingCurve;
    CollectionPoolFactory factory;
    address payable constant feeRecipient = payable(address(69));
    uint256 constant protocolFeeMultiplier = 3e15;
    uint256 constant carryFeeMultiplier = 3e15;
    uint256 constant royaltyNumerator = 500;
    CollectionPool pool;

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
        factory.setBondingCurveAllowed(bondingCurve, true);
        test721.setApprovalForAll(address(factory), true);
        for (uint256 i = 1; i <= numItems; i++) {
            IERC721Mintable(address(test721)).mint(address(this), i);
            idList.push(i);
        }

        pool = this.setupPool{value: modifyInputAmount(tokenAmount)}(
            factory,
            test721,
            bondingCurve,
            payable(address(0)),
            ICollectionPool.PoolType.TRADE,
            delta,
            0,
            spotPrice,
            idList,
            tokenAmount,
            address(0)
        );
        test1155 = new Test1155();
        testERC20 = ERC20(address(new Test20()));
        IMintable(address(testERC20)).mint(address(pool), 1 ether);
    }

    function testGas_basicDeploy() public {
        uint256[] memory empty;
        this.setupPool{value: modifyInputAmount(tokenAmount)}(
            factory,
            test721,
            bondingCurve,
            payable(address(0)),
            ICollectionPool.PoolType.TRADE,
            delta,
            0,
            spotPrice,
            empty,
            tokenAmount,
            address(0)
        );
    }

    /**
     * Test CollectionPool Owner functions
     */

    function test_transferOwnership() public {
        transferOwnership(payable(address(2)));
        assertEq(pool.owner(), address(2));
    }

    function testGas_transferNoCallback() public {
        transferOwnership(address(pool));
    }

    function testFail_transferOwnership() public {
        transferOwnership(address(1000));
        transferOwnership(payable(address(2)));
    }

    function test_rescueTokens() public {
        pool.withdrawERC721(test721, idList);
        pool.withdrawERC20(testERC20, 1 ether);
    }

    function testFail_tradePoolChangeAssetRecipient() public {
        pool.changeAssetRecipient(payable(address(1)));
    }

    function testFail_tradePoolChangeFeePastMax() public {
        pool.changeFee(100 ether);
    }

    function test_verifyPoolParams() public {
        // verify pool variables
        assertEq(address(pool.nft()), address(test721));
        assertEq(address(pool.bondingCurve()), address(bondingCurve));
        assertEq(uint256(pool.poolType()), uint256(ICollectionPool.PoolType.TRADE));
        assertEq(pool.delta(), delta);
        assertEq(pool.spotPrice(), spotPrice);
        assertEq(pool.owner(), address(this));
        assertEq(pool.fee(), 0);
        assertEq(pool.assetRecipient(), address(0));
        assertEq(pool.getAssetRecipient(), address(pool));
        assertEq(getBalance(address(pool)), tokenAmount);

        // verify NFT ownership
        assertEq(test721.ownerOf(1), address(pool));
    }

    function test_modifyPoolParams() public {
        // changing spot works as expected
        pool.changeSpotPrice(2 ether);
        assertEq(pool.spotPrice(), 2 ether);

        // changing delta works as expected
        pool.changeDelta(2.2 ether);
        assertEq(pool.delta(), 2.2 ether);

        // // changing fee works as expected
        pool.changeFee(0.2 ether);
        assertEq(pool.fee(), 0.2 ether);
    }

    function test_multicallModifyPoolParams() public {
        bytes[] memory calls = new bytes[](3);
        calls[0] = abi.encodeCall(pool.changeSpotPrice, (1 ether));
        calls[1] = abi.encodeCall(pool.changeDelta, (2 ether));
        calls[2] = abi.encodeCall(pool.changeFee, (0.3 ether));
        pool.multicall(calls, true);
        assertEq(pool.spotPrice(), 1 ether);
        assertEq(pool.delta(), 2 ether);
        assertEq(pool.fee(), 0.3 ether);
    }

    function testFail_multicallChangeOwnership() public {
        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(pool.transferOwnership, (address(69)));
        calls[1] = abi.encodeCall(pool.changeDelta, (2 ether));
        pool.multicall(calls, true);
    }

    function test_getAllHeldNFTs() public {
        uint256[] memory allIds = pool.getAllHeldIds();
        for (uint256 i = 0; i < allIds.length; ++i) {
            assertEq(allIds[i], idList[i]);
        }
    }

    function test_withdraw() public {
        withdrawTokens(pool);
        assertEq(getBalance(address(pool)), 0);
    }

    function testFail_withdraw() public {
        transferOwnership(address(1000));
        withdrawTokens(pool);
    }

    function testFail_callMint721() public {
        bytes memory data = abi.encodeWithSelector(
            Test721.mint.selector,
            address(this),
            1000
        );
        pool.call(payable(address(test721)), data);
    }

    function test_callMint721() public {
        // arbitrary call (just call mint on Test721) works as expected

        // add to whitelist
        factory.setCallAllowed(payable(address(test721)), true);

        bytes memory data = abi.encodeWithSelector(
            Test721.mint.selector,
            address(this),
            1000
        );
        pool.call(payable(address(test721)), data);

        // verify NFT ownership
        assertEq(test721.ownerOf(1000), address(this));
    }

    function test_withdraw1155() public {
        test1155.mint(address(pool), 1, 2);
        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 2;
        pool.withdrawERC1155(IERC1155(address(test1155)), ids, amounts);
        assertEq(IERC1155(address(test1155)).balanceOf(address(pool), 1), 0);
        assertEq(IERC1155(address(test1155)).balanceOf(address(this), 1), 2);
    }

    /**
        Test failure conditions
     */

    function testFail_rescueTokensNotOwner() public {
        transferOwnership(address(1000));
        pool.withdrawERC721(test721, idList);
        pool.withdrawERC20(testERC20, 1 ether);
    }

    function testFail_changeAssetRecipientForTrade() public {
        pool.changeAssetRecipient(payable(address(1)));
    }

    function testFail_changeFeeAboveMax() public {
        pool.changeFee(100 ether);
    }

    function testFail_changeSpotNotOwner() public {
        transferOwnership(address(1000));
        pool.changeSpotPrice(2 ether);
    }

    function testFail_changeDeltaNotOwner() public {
        transferOwnership(address(1000));
        pool.changeDelta(2.2 ether);
    }

    function testFail_changeFeeNotOwner() public {
        transferOwnership(address(1000));
        pool.changeFee(0.2 ether);
    }

    function testFail_reInitPool() public {
        pool.initialize(0, payable(address(0)), 0, 0, 0, "", "", 0, payable(address(0)));
    }

    function testFail_swapForNFTNotInPool() public {
        // skip 1 block so that trades are not in the same block as pool creation
        vm.roll(block.number + 1);

        (, ICurve.Params memory newParams, uint256 inputAmount, ) = bondingCurve
            .getBuyInfo(
                ICurve.Params(
                    spotPrice,
                    delta,
                    "",
                    ""
                ),
                numItems + 1,
                pool.feeMultipliers()
            );

        // buy specific NFT not in pool
        uint256[] memory nftIds = new uint256[](1);
        nftIds[0] = 69;
        pool.swapTokenForSpecificNFTs{value: modifyInputAmount(inputAmount)}(
            nftIds,
            inputAmount,
            address(this),
            false,
            address(0)
        );
        spotPrice = uint56(newParams.spotPrice);
    }

    function testFail_swapForAnyNFTsPastBalance() public {
        // skip 1 block so that trades are not in the same block as pool creation
        vm.roll(block.number + 1);

        (, ICurve.Params memory newParams, uint256 inputAmount, ) = bondingCurve
            .getBuyInfo(
                ICurve.Params(
                    spotPrice,
                    delta,
                    "",
                    ""
                ),
                numItems + 1,
                pool.feeMultipliers()
            );

        // buy any NFTs past pool inventory
        pool.swapTokenForAnyNFTs{value: modifyInputAmount(inputAmount)}(
            numItems + 1,
            inputAmount,
            address(this),
            false,
            address(0)
        );
        spotPrice = uint56(newParams.spotPrice);
    }

    /**
     * Test Admin functions
     */

    function test_changeFeeRecipient() public {
        factory.changeProtocolFeeRecipient(payable(address(69)));
        assertEq(factory.protocolFeeRecipient(), address(69));
    }

    function test_withdrawFees() public {
        // skip 1 block so that trades are not in the same block as pool creation
        vm.roll(block.number + 1);

        uint256 totalProtocolFee;
        uint256 factoryEndBalance;
        uint256 factoryStartBalance = getBalance(address(69));

        test721.setApprovalForAll(address(pool), true);

        // buy all NFTs
        {
            (
                ,
                ICurve.Params memory newParams,
                uint256 inputAmount,
                ICurve.Fees memory fees
            ) = bondingCurve.getBuyInfo(
                    ICurve.Params(
                        spotPrice,
                        delta,
                        "",
                        ""
                    ),
                    numItems,
                    pool.feeMultipliers()
                );
            totalProtocolFee += fees.protocol;

            // buy NFTs
            pool.swapTokenForAnyNFTs{value: modifyInputAmount(inputAmount)}(
                numItems,
                inputAmount,
                address(this),
                false,
                address(0)
            );
            spotPrice = uint56(newParams.spotPrice);
        }

        this.withdrawProtocolFees(factory);

        factoryEndBalance = getBalance(address(69));
        assertEq(factoryEndBalance, factoryStartBalance + totalProtocolFee);
    }

    function test_changeFeeMultiplier() public {
        factory.changeProtocolFeeMultiplier(5e15);
        assertEq(factory.protocolFeeMultiplier(), 5e15);
    }

    function transferOwnership(address newOwner) internal {
        IERC721(address(pool.factory())).approve(address(pool), pool.tokenId());
        pool.transferOwnership(payable(newOwner));
    }
}
