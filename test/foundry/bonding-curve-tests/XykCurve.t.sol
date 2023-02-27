// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {StdCheats} from "forge-std/StdCheats.sol";
import {Test} from "forge-std/Test.sol";
import {FixedPointMathLib} from "solmate/src/utils/FixedPointMathLib.sol";

import {ICurve} from "../../../contracts/bonding-curves/ICurve.sol";
import {XykCurve} from "../../../contracts/bonding-curves/XykCurve.sol";
import {CurveErrorCodes} from "../../../contracts/bonding-curves/CurveErrorCodes.sol";
import {ICollectionPool} from "../../../contracts/pools/ICollectionPool.sol";
import {ICollectionPoolFactory} from "../../../contracts/pools/ICollectionPoolFactory.sol";
import {CollectionPoolFactory} from "../../../contracts/pools/CollectionPoolFactory.sol";
import {CollectionPoolEnumerableETH} from "../../../contracts/pools/CollectionPoolEnumerableETH.sol";
import {CollectionPoolMissingEnumerableETH} from "../../../contracts/pools/CollectionPoolMissingEnumerableETH.sol";
import {CollectionPoolEnumerableERC20} from "../../../contracts/pools/CollectionPoolEnumerableERC20.sol";
import {CollectionPoolMissingEnumerableERC20} from "../../../contracts/pools/CollectionPoolMissingEnumerableERC20.sol";
import {CollectionPoolCloner} from "../../../contracts/lib/CollectionPoolCloner.sol";
import {CollectionPool} from "../../../contracts/pools/CollectionPool.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import {ERC20} from "solmate/src/tokens/ERC20.sol";
import {Test721} from "../../../contracts/test/mocks/Test721.sol";

contract XykCurveTest is StdCheats, Test, ERC721Holder {
    using FixedPointMathLib for uint256;

    uint256 constant MIN_PRICE = 1 gwei;

    XykCurve curve;
    CollectionPoolFactory factory;
    CollectionPoolEnumerableETH enumerableETHTemplate;
    CollectionPoolMissingEnumerableETH missingEnumerableETHTemplate;
    CollectionPoolEnumerableERC20 enumerableERC20Template;
    CollectionPoolMissingEnumerableERC20 missingEnumerableERC20Template;
    ICollectionPool ethPool;
    Test721 nft;

    receive() external payable {}

    function setUp() public {
        enumerableETHTemplate = new CollectionPoolEnumerableETH();
        missingEnumerableETHTemplate = new CollectionPoolMissingEnumerableETH();
        enumerableERC20Template = new CollectionPoolEnumerableERC20();
        missingEnumerableERC20Template = new CollectionPoolMissingEnumerableERC20();

        factory = new CollectionPoolFactory(
            enumerableETHTemplate,
            missingEnumerableETHTemplate,
            enumerableERC20Template,
            missingEnumerableERC20Template,
            payable(0),
            0,
            0
        );

        curve = new XykCurve();
        factory.setBondingCurveAllowed(curve, true);
    }

    function setUpEthPool(uint256 numNfts, uint256 value) public {
        nft = new Test721();
        nft.setApprovalForAll(address(factory), true);
        uint256[] memory idList = new uint256[](numNfts);
        for (uint256 i = 1; i <= numNfts; i++) {
            nft.mint(address(this), i);
            idList[i - 1] = i;
        }

        (ethPool, ) = factory.createPoolETH{value: value}(
            ICollectionPoolFactory.CreateETHPoolParams(
                nft,
                curve,
                payable(0),
                address(this),
                ICollectionPool.PoolType.TRADE,
                uint128(numNfts),
                0,
                uint128(value),
                "",
                "",
                0,
                payable(0),
                idList
            )
        );
    }

    function test_getBuyInfoCannotHave0NumItems() public {
        // arrange
        uint256 numItems = 0;

        // act
        (CurveErrorCodes.Error error, , , ,) = curve.getBuyInfo(
            ICurve.Params(
                0,
                0,
                "",
                ""
            ),
            numItems,
            ICurve.FeeMultipliers(
                0,
                0,
                0,
                0
            )
        );

        // assert
        assertEq(
            uint256(error),
            uint256(CurveErrorCodes.Error.INVALID_NUMITEMS),
            "Should have returned invalid num items error"
        );
    }

    function test_getSellInfoCannotHave0NumItems() public {
        // arrange
        uint256 numItems = 0;

        // act
        (CurveErrorCodes.Error error, , , ,) = curve.getSellInfo(
            ICurve.Params(
                0,
                0,
                "",
                ""
            ),
            numItems,
            ICurve.FeeMultipliers(
                0,
                0,
                0,
                0
            )
        );

        // assert
        assertEq(
            uint256(error),
            uint256(CurveErrorCodes.Error.INVALID_NUMITEMS),
            "Should have returned invalid num items error"
        );
    }

    function test_getBuyInfoReturnsNewReserves() public {
        // arrange
        uint256 numNfts = 5;
        uint256 value = 1 ether;
        setUpEthPool(numNfts, value);
        uint256 numItemsToBuy = 2;

        // act
        (
            CurveErrorCodes.Error error,
            ICurve.Params memory newParams,
            ,
            uint256 inputValue,

        ) = ethPool.getBuyNFTQuote(numItemsToBuy);

        // assert
        assertEq(
            uint256(error),
            uint256(CurveErrorCodes.Error.OK),
            "Should not have errored"
        );
        assertEq(
            newParams.delta,
            numNfts - numItemsToBuy,
            "Should have updated virtual nft reserve"
        );
        assertEq(
            newParams.spotPrice,
            inputValue + value,
            "Should have updated virtual eth reserve"
        );
    }

    function test_getSellInfoReturnsNewReserves() public {
        // arrange
        uint256 numNfts = 5;
        uint256 value = 1 ether;
        setUpEthPool(numNfts, value);
        uint256 numItemsToSell = 2;

        // act
        (
            CurveErrorCodes.Error error,
            ICurve.Params memory newParams,
            ,
            uint256 inputValue,

        ) = ethPool.getSellNFTQuote(numItemsToSell);

        // assert
        assertEq(
            uint256(error),
            uint256(CurveErrorCodes.Error.OK),
            "Should not have errored"
        );
        assertEq(
            newParams.delta,
            numNfts + numItemsToSell,
            "Should have updated virtual nft reserve"
        );
        assertEq(
            newParams.spotPrice,
            value - inputValue,
            "Should have updated virtual eth reserve"
        );
    }

    function test_getBuyInfoReturnsInputValue() public {
        // arrange
        uint256 numNfts = 5;
        uint256 value = 0.8 ether;
        setUpEthPool(numNfts, value);
        uint256 numItemsToBuy = 3;
        uint256 expectedInputValue = (numItemsToBuy * value) /
            (numNfts - numItemsToBuy);

        // act
        (CurveErrorCodes.Error error, , , uint256 inputValue, ) = ethPool
            .getBuyNFTQuote(numItemsToBuy);

        // assert
        assertEq(
            uint256(error),
            uint256(CurveErrorCodes.Error.OK),
            "Should not have errored"
        );
        assertEq(
            inputValue,
            expectedInputValue,
            "Should have calculated input value"
        );
    }

    function test_getSellInfoReturnsOutputValue() public {
        // arrange
        uint256 numNfts = 5;
        uint256 value = 0.8 ether;
        setUpEthPool(numNfts, value);
        uint256 numItemsToSell = 3;
        uint256 expectedOutputValue = (numItemsToSell * value) /
            (numNfts + numItemsToSell);

        // act
        (CurveErrorCodes.Error error, , , uint256 outputValue, ) = ethPool
            .getSellNFTQuote(numItemsToSell);

        // assert
        assertEq(
            uint256(error),
            uint256(CurveErrorCodes.Error.OK),
            "Should not have errored"
        );
        assertEq(
            outputValue,
            expectedOutputValue,
            "Should have calculated output value"
        );
    }

    function test_getBuyInfoCalculatesProtocolFee() public {
        // arrange
        uint256 numNfts = 5;
        uint256 value = 0.8 ether;
        setUpEthPool(numNfts, value);
        factory.changeProtocolFeeMultiplier((2 * 1e6) / 100); // 2%
        uint256 numItemsToBuy = 3;
        uint256 expectedProtocolFee = ethPool.poolType() == ICollectionPool.PoolType.TRADE
            ? 0
            : (2 * ((numItemsToBuy * value) / (numNfts - numItemsToBuy))) / 100;

        // act
        (CurveErrorCodes.Error error, , , , ICurve.Fees memory fees) = ethPool
            .getBuyNFTQuote(numItemsToBuy);

        // assert
        assertEq(
            uint256(error),
            uint256(CurveErrorCodes.Error.OK),
            "Should not have errored"
        );
        assertEq(
            fees.protocol,
            expectedProtocolFee,
            "Should have calculated protocol fee"
        );
    }

    function test_getSellInfoCalculatesProtocolFee() public {
        // arrange
        uint256 numNfts = 5;
        uint256 value = 0.8 ether;
        setUpEthPool(numNfts, value);
        factory.changeProtocolFeeMultiplier((2 * 1e6) / 100); // 2%
        uint256 numItemsToSell = 3;
        uint256 expectedProtocolFee = ethPool.poolType() == ICollectionPool.PoolType.TRADE
            ? 0
            : (2 * ((numItemsToSell * value) / (numNfts + numItemsToSell))) / 100;

        // act
        (CurveErrorCodes.Error error, , , , ICurve.Fees memory fees) = ethPool
            .getSellNFTQuote(numItemsToSell);

        // assert
        assertEq(
            uint256(error),
            uint256(CurveErrorCodes.Error.OK),
            "Should not have errored"
        );
        assertEq(
            fees.protocol,
            expectedProtocolFee,
            "Should have calculated protocol fee"
        );
    }

    function test_swapTokenForAnyNFTs() public {
        // arrange
        uint256 numNfts = 5;
        uint256 value = 0.8 ether;
        setUpEthPool(numNfts, value);

        // skip 1 block so that trades are not in the same block as pool creation
        vm.roll(block.number + 1);

        uint256 numItemsToBuy = 2;
        uint256 ethBalanceBefore = address(this).balance;
        uint256 nftBalanceBefore = nft.balanceOf(address(this));

        factory.changeProtocolFeeMultiplier((2 * 1e6) / 100); // 2%
        ethPool.changeFee((1 * 1e6) / 100); // 1%

        (CurveErrorCodes.Error error, , , uint256 inputValue, ) = ethPool
            .getBuyNFTQuote(numItemsToBuy);

        // act
        uint256 inputAmount = ethPool.swapTokenForAnyNFTs{value: inputValue}(
            numItemsToBuy,
            inputValue,
            address(this),
            false,
            address(0)
        );

        // assert
        assertEq(
            uint256(error),
            uint256(CurveErrorCodes.Error.OK),
            "Should not have errored"
        );
        assertEq(
            ethBalanceBefore - address(this).balance,
            inputValue,
            "Should have transferred ETH"
        );
        assertEq(
            nft.balanceOf(address(this)) - nftBalanceBefore,
            numItemsToBuy,
            "Should have received NFTs"
        );

        uint256 withoutFeeInputAmount = (inputAmount * 1e18) / 1.01e18;
        assertEq(
            ethPool.spotPrice(),
            uint128(address(ethPool).balance) -
                (withoutFeeInputAmount * 0.01e18) /
                1e18,
            "Spot price should match eth balance - fee after swap"
        );
        assertEq(
            ethPool.delta(),
            nft.balanceOf(address(ethPool)),
            "Delta should match nft balance after swap"
        );
    }

    function test_swapNFTsForToken() public {
        // arrange
        uint256 numNfts = 5;
        uint256 value = 0.8 ether;
        setUpEthPool(numNfts, value);
        // skip 1 block so that trades are not in the same block as pool creation
        vm.roll(block.number + 1);

        factory.changeProtocolFeeMultiplier((2 * 1e6) / 100); // 2%
        ethPool.changeFee((1 * 1e6) / 100); // 1%

        uint256 numItemsToSell = 2;
        (CurveErrorCodes.Error error, , , uint256 outputValue, ) = ethPool
            .getSellNFTQuote(numItemsToSell);

        uint256[] memory idList = new uint256[](numItemsToSell);
        for (uint256 i = 1; i <= numItemsToSell; i++) {
            nft.mint(address(this), numNfts + i);
            idList[i - 1] = numNfts + i;
        }

        uint256 ethBalanceBefore = address(this).balance;
        uint256 nftBalanceBefore = nft.balanceOf(address(this));
        nft.setApprovalForAll(address(ethPool), true);

        // act
        uint256 outputAmount = ethPool.swapNFTsForToken(
            ICollectionPool.NFTs(
                idList,
                new bytes32[](0),
                new bool[](0)
            ),
            outputValue,
            payable(address(this)),
            false,
            address(0),
            new bytes(0)
        );

        // assert
        assertEq(
            uint256(error),
            uint256(CurveErrorCodes.Error.OK),
            "Should not have errored"
        );
        assertEq(
            address(this).balance - ethBalanceBefore,
            outputValue,
            "Should have received ETH"
        );
        assertEq(
            nftBalanceBefore - nft.balanceOf(address(this)),
            numItemsToSell,
            "Should have sent NFTs"
        );

        uint256 withoutFeeOutputAmount = (outputAmount * 1e18) / 0.99e18;
        assertEq(
            ethPool.spotPrice(),
            uint128(address(ethPool).balance) -
                ((withoutFeeOutputAmount * 1e16) / 1e18),
            "Spot price + fee should match eth balance after swap"
        );
        assertEq(
            ethPool.delta(),
            nft.balanceOf(address(ethPool)),
            "Delta should match nft balance after swap"
        );
    }
}
