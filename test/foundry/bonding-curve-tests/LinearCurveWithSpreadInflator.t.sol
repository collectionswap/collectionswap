// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {Test} from "forge-std/Test.sol";
import {FixedPointMathLib} from "solmate/src/utils/FixedPointMathLib.sol";

import {ICurve} from "../../../contracts/bonding-curves/ICurve.sol";
import {LinearCurveWithSpreadInflator} from "../../../contracts/bonding-curves/LinearCurveWithSpreadInflator.sol";
import {CurveErrorCodes} from "../../../contracts/bonding-curves/CurveErrorCodes.sol";

contract LinearCurveWithSpreadInflatorTest is Test {
    LinearCurveWithSpreadInflator curve;

    function setUp() public {
        curve = new LinearCurveWithSpreadInflator();
    }


    function test_getBuyInfoExample_LinearCurveWithSpreadInflator_flat() public {
        uint128 spotPrice = 3 ether;
        uint128 delta = 0.1 ether;
        uint256 numItems = 5;
        uint24 feeMultiplier = (1e6 * 5) / 1000; // 0.5%
        uint24 protocolFeeMultiplier = (1e6 * 3) / 1000; // 0.3%
        uint24 royaltyNumerator = (1e6 * 1) / 1000; // 0.1%
        // bool bidAskInflatorIsFlatAmount = true;
        // uint248 inflator = 0.15 ether;
        bytes memory props =abi.encode(true, 0.15 ether);

        (
            ICurve.Params memory newParams,
            uint256 inputValue,
            ICurve.Fees memory fees,
            uint256 lastSwapPrice
        ) = curve.getBuyInfo(
                ICurve.Params(
                    spotPrice,
                    delta,
                    props,
                    ""
                ),
                numItems,
                ICurve.FeeMultipliers(
                    feeMultiplier,
                    protocolFeeMultiplier,
                    royaltyNumerator,
                    0
                )
            );
        assertEq(newParams.spotPrice, 3.5 ether, "Spot price incorrect");
        assertEq(newParams.delta, 0.1 ether, "Delta incorrect");
        assertEq(inputValue, 17.40525 ether, "Input value incorrect"); // (16.5 + 0.15 * 5) * 1.009
        assertEq(fees.trade, 0.08625 ether, "Trade fee incorrect"); // 17.25 * 0.005
        assertEq(fees.protocol, 0.05175 ether, "Protocol fee incorrect"); // 17.25 * 0.003
        assertEq(fees.royalties[0], 0.00325 ether, "Royalty fee incorrect"); // 3.25 * 0.001
        assertEq(fees.royalties[1], 0.00335 ether, "Royalty fee incorrect"); // 3.35 * 0.001
        assertEq(fees.royalties[2], 0.00345 ether, "Royalty fee incorrect"); // 3.45 * 0.001
        assertEq(fees.royalties[3], 0.00355 ether, "Royalty fee incorrect"); // 3.55 * 0.001
        assertEq(fees.royalties[4], 0.00365 ether, "Royalty fee incorrect"); // 3.65 * 0.001
        // assertEq(newParams.props, props, "Props incorrect");    
        assertEq(lastSwapPrice, 3.68285 ether, "Last swap price incorrect"); // (3.65) * 1.009
    }

    function test_getBuyInfoWithoutFee_flat(
        uint128 spotPrice,
        uint128 delta,
        uint8 numItems,
        uint248 inflator
    ) public {
        if (numItems == 0) {
            return;
        }

        bool bidAskInflatorIsFlatAmount = true;
        bytes memory props =abi.encode(bidAskInflatorIsFlatAmount, inflator);

        if (
            (uint256(spotPrice) + uint256(delta) * uint256(numItems) + uint256(inflator)) >
            type(uint128).max
        ) {
            vm.expectRevert(CurveErrorCodes.SpotPriceOverflow.selector);
            curve.getBuyInfo(ICurve.Params(spotPrice, delta, props, ""), numItems, ICurve.FeeMultipliers(0, 0, 0, 0));
        } else {
            (
                ICurve.Params memory newParams,
                uint256 inputValue,
                ,
            ) = curve.getBuyInfo(ICurve.Params(spotPrice, delta, props, ""), numItems, ICurve.FeeMultipliers(0, 0, 0, 0));
            assertTrue(
                (newParams.spotPrice > spotPrice && delta > 0) ||
                    (newParams.spotPrice == spotPrice && delta == 0),
                "Price update incorrect"
            );

            assertGe(
                inputValue,
                numItems * uint256(spotPrice),
                "Input value incorrect"
            );
            // assertEq(newParams.props, props, "Props incorrect");    
        }
    }

    function test_getBuyInfoExample_LinearCurveWithSpreadInflator_percent() public {
        uint128 spotPrice = 3 ether;
        uint128 delta = 0.1 ether;
        uint256 numItems = 5;
        uint24 feeMultiplier = (1e6 * 5) / 1000; // 0.5%
        uint24 protocolFeeMultiplier = (1e6 * 3) / 1000; // 0.3%
        uint24 royaltyNumerator = (1e6 * 1) / 1000; // 0.1%
        // bool bidAskInflatorIsFlatAmount = false;
        // uint248 inflator = 0.13e6;
        bytes memory props =abi.encode(false, 0.13e6);

        (
            ICurve.Params memory newParams,
            uint256 inputValue,
            ICurve.Fees memory fees,
            uint256 lastSwapPrice
        ) = curve.getBuyInfo(
                ICurve.Params(
                    spotPrice,
                    delta,
                    props,
                    ""
                ),
                numItems,
                ICurve.FeeMultipliers(
                    feeMultiplier,
                    protocolFeeMultiplier,
                    royaltyNumerator,
                    0
                )
            );
        assertEq(newParams.spotPrice, 3.5 ether, "Spot price incorrect");
        assertEq(newParams.delta, 0.1 ether, "Delta incorrect");
        assertEq(inputValue, 18.812805 ether, "Input value incorrect"); // (16.5 * 1.13) * 1.009
        assertEq(fees.trade, 0.093225 ether, "Trade fee incorrect"); // (16.5 * 1.13) * 0.005
        assertEq(fees.protocol, 0.055935 ether, "Protocol fee incorrect"); // (16.5 * 1.13) * 0.003
        assertEq(fees.royalties[0], 0.003503 ether, "Royalty fee incorrect"); // 3.1 * 1.13 * 0.001
        assertEq(fees.royalties[4], 0.003955 ether, "Royalty fee incorrect"); // 3.5 * 1.13 * 0.001
        // assertEq(newParams.props, props, "Props incorrect");
        assertEq(lastSwapPrice, 3.990595 ether, "Last swap price incorrect"); // 3.5 * 1.13 * 1.009
    }

    function test_getBuyInfoWithoutFee_percent(
        uint128 spotPrice,
        uint128 delta,
        uint8 numItems,
        uint248 inflator
    ) public {
        if (numItems == 0) {
            return;
        }
        bool bidAskInflatorIsFlatAmount = false;
        bytes memory props =abi.encode(bidAskInflatorIsFlatAmount, inflator);

        if (inflator > 1e6) {
            assertTrue(!curve.validateProps(props));
            return;
        }

        assertTrue(curve.validateProps(props));

        if (
            ((uint256(spotPrice) + uint256(delta) * uint256(numItems)) * uint256(1e6 + inflator)) / 1e6 >
            type(uint128).max
        ) {
            vm.expectRevert(CurveErrorCodes.SpotPriceOverflow.selector);
            curve.getBuyInfo(ICurve.Params(spotPrice, delta, props, ""), numItems, ICurve.FeeMultipliers(0, 0, 0, 0));
        } else {
            (
                ICurve.Params memory newParams,
                uint256 inputValue,
                ,
            ) = curve.getBuyInfo(ICurve.Params(spotPrice, delta, props, ""), numItems, ICurve.FeeMultipliers(0, 0, 0, 0));
            assertTrue(
                (newParams.spotPrice > spotPrice && delta > 0) ||
                    (newParams.spotPrice == spotPrice && delta == 0),
                "Price update incorrect"
            );

            assertGe(
                inputValue,
                numItems * uint256(spotPrice),
                "Input value incorrect"
            );
            // assertEq(newParams.props, props, "Props incorrect");
        }
    }


    function test_getSellInfoExample() public {
        uint128 spotPrice = 3 ether;
        uint128 delta = 0.1 ether;
        uint256 numItems = 5;
        uint24 feeMultiplier = (1e6 * 5) / 1000; // 0.5%
        uint24 protocolFeeMultiplier = (1e6 * 3) / 1000; // 0.3%
        uint24 royaltyNumerator = 0;
        bool bidAskInflatorIsFlatAmount = true;
        uint248 inflator = 0.15 ether;
        bytes memory props =abi.encode(bidAskInflatorIsFlatAmount, inflator);

        (
            ICurve.Params memory newParams,
            uint256 outputValue,
            ICurve.Fees memory fees,
        ) = curve.getSellInfo(
                ICurve.Params(
                    spotPrice,
                    delta,
                    props,
                    ""
                ),
                numItems,
                ICurve.FeeMultipliers(
                    feeMultiplier,
                    protocolFeeMultiplier,
                    royaltyNumerator,
                    0
                )
            );
        assertEq(newParams.spotPrice, 2.5 ether, "Spot price incorrect");
        assertEq(newParams.delta, 0.1 ether, "Delta incorrect");
        assertEq(outputValue, 13.888 ether, "Output value incorrect");
        assertEq(fees.protocol, 0.042 ether, "Protocol fee incorrect");
        // assertEq(newParams.props, props, "Props incorrect");
    }

    function test_getSellInfoWithoutFee(
        uint128 spotPrice,
        uint128 delta,
        uint8 numItems
    ) public {
        if (numItems == 0) {
            return;
        }
        bool bidAskInflatorIsFlatAmount = true;
        uint248 inflator = 0.15 ether;
        bytes memory props =abi.encode(bidAskInflatorIsFlatAmount, inflator);

        (
            ICurve.Params memory newParams,
            uint256 outputValue,
            ,
        ) = curve.getSellInfo(ICurve.Params(spotPrice, delta, props, ""), numItems, ICurve.FeeMultipliers(0, 0, 0, 0));

        // assertEq(newParams.props, props, "Props incorrect");

        uint256 totalPriceDecrease = uint256(delta) * numItems;
        if (spotPrice < totalPriceDecrease) {
            assertEq(
                newParams.spotPrice,
                0,
                "New spot price not 0 when decrease is greater than current spot price"
            );
        }

        if (spotPrice > 0) {
            assertTrue(
                (newParams.spotPrice < spotPrice && delta > 0) ||
                    (newParams.spotPrice == spotPrice && delta == 0),
                "Price update incorrect"
            );
        }

        assertLe(
            outputValue,
            numItems * uint256(spotPrice),
            "Output value incorrect"
        );
    }
}
