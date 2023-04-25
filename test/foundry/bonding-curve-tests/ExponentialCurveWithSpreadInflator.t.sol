// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {Test} from "forge-std/Test.sol";

import {ExponentialCurveWithSpreadInflator} from "../../../contracts/bonding-curves/ExponentialCurveWithSpreadInflator.sol";
import {ICurve} from "../../../contracts/bonding-curves/ICurve.sol";
import {FixedPointMathLib} from "../../../contracts/lib/FixedPointMathLib.sol";

contract ExponentialCurveTest is Test {
    using FixedPointMathLib for uint256;

    ExponentialCurveWithSpreadInflator curve;

    function setUp() public {
        curve = new ExponentialCurveWithSpreadInflator();
    }

    function test_getBuyInfoExample_flat() public {
        uint128 spotPrice = 3 ether;
        uint128 delta = 2 ether; // 2
        uint256 numItems = 5;
        uint24 feeMultiplier = (1e6 * 5) / 1000; // 0.5%
        uint24 protocolFeeMultiplier = (1e6 * 3) / 1000; // 0.3%
        uint24 royaltyNumerator = (1e6 * 1) / 1000; // 0.1%
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
                    abi.encode(0)
                ),
                numItems,
                ICurve.FeeMultipliers(
                    feeMultiplier,
                    protocolFeeMultiplier,
                    royaltyNumerator,
                    0
                )
            );
        assertEq(newParams.spotPrice, 3 ether, "Spot price incorrect");
        assertEq(newParams.delta, 2 ether, "Delta incorrect");
        assertEq(newParams.state, abi.encode(-int256(numItems)), "State incorrect");
        assertEq(inputValue, 188.43075 ether, "Input value incorrect"); // (6 + 12 + 24 + 48 + 96 + (5 * 0.15)) * 1.009
        assertEq(fees.trade, 0.93375 ether, "Trade fee incorrect"); // (6 + 12 + 24 + 48 + 96 + (5 * 0.15)) * .005
        assertEq(fees.protocol, .56025 ether, "Protocol fee incorrect"); // (6 + 12 + 24 + 48 + 96 + (5 * 0.15)) * .003
        assertEq(fees.royalties[0], 0.00615 ether, "Royalty fee incorrect"); 
        assertEq(fees.royalties[1], 0.01215 ether, "Royalty fee incorrect"); 
        assertEq(fees.royalties[2], 0.02415 ether, "Royalty fee incorrect"); 
        assertEq(fees.royalties[3], 0.04815 ether, "Royalty fee incorrect"); 
        assertEq(fees.royalties[4], 0.09615 ether, "Royalty fee incorrect"); 
        // assertEq(newParams.props, props, "Props incorrect");    
        assertEq(lastSwapPrice, 97.01535 ether, "Last swap price incorrect"); // (96.15) * 1.009
    }

    function test_getBuyInfoWithoutFee_flat(
        uint128 spotPrice,
        uint64 delta,
        uint8 numItems,
        uint248 inflator
    ) public {
        if (
            delta <= FixedPointMathLib.WAD ||
            numItems > 10 ||
            numItems == 0
        ) {
            return;
        }

        bool bidAskInflatorIsFlatAmount = true;
        bytes memory props =abi.encode(bidAskInflatorIsFlatAmount, inflator);

        (
            ICurve.Params memory newParams,
            uint256 inputValue,
            ,
        ) = curve.getBuyInfo(ICurve.Params(spotPrice, delta, props, abi.encode(0)), numItems, ICurve.FeeMultipliers(0, 0, 0, 0));

        if (spotPrice > 0 && numItems > 0) {
            assertTrue(
                (newParams.spotPrice == spotPrice &&
                    newParams.delta == delta),
                "Pool params updated inappropriately"
            );
        }

        /// @dev This holds true because we started at nonnegative deltaN (abi.decode(state, (int256)))
        assertGe(
            inputValue,
            numItems * uint256(spotPrice),
            "Input value incorrect"
        );
        // assertEq(newParams.props, props, "Props incorrect");   
    }


    function test_getBuyInfoExample_percent() public {
        uint128 spotPrice = 3 ether;
        uint128 delta = 2 ether; // 2
        uint256 numItems = 5;
        uint24 feeMultiplier = (1e6 * 5) / 1000; // 0.5%
        uint24 protocolFeeMultiplier = (1e6 * 3) / 1000; // 0.3%
        uint24 royaltyNumerator = (1e6 * 1) / 1000; // 0.1%
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
                    abi.encode(0)
                ),
                numItems,
                ICurve.FeeMultipliers(
                    feeMultiplier,
                    protocolFeeMultiplier,
                    royaltyNumerator,
                    0
                )
            );
        assertEq(newParams.spotPrice, 3 ether, "Spot price incorrect");
        assertEq(newParams.delta, 2 ether, "Delta incorrect");
        assertEq(newParams.state, abi.encode(-int256(numItems)), "State incorrect");
        assertEq(inputValue, 212.07162 ether, "Input value incorrect"); // (6 + 12 + 24 + 48 + 96 ) * 1.13 * 1.009
        assertEq(fees.trade, 1.0509 ether, "Trade fee incorrect"); // (6 + 12 + 24 + 48 + 96)*1.13*.005
        assertEq(fees.protocol, 0.63054 ether, "Protocol fee incorrect"); 
        assertEq(fees.royalties[0], 0.00678 ether, "Royalty fee incorrect"); 
        assertEq(fees.royalties[4], 0.10848 ether, "Royalty fee incorrect"); 
        // assertEq(newParams.props, props, "Props incorrect");    
        assertEq(lastSwapPrice, 109.45632 ether, "Last swap price incorrect"); // (96*1.13*1.009)
    }

    function test_getBuyInfoWithoutFee_percent(
        uint128 spotPrice,
        uint64 delta,
        uint8 numItems,
        uint248 inflator
    ) public {
        if (
            delta <= FixedPointMathLib.WAD ||
            numItems > 10 ||
            numItems == 0
        ) {
            return;
        }

        bool bidAskInflatorIsFlatAmount = false;
        bytes memory props =abi.encode(bidAskInflatorIsFlatAmount, inflator);

        if (inflator > 1e6) {
            assertTrue(!curve.validateProps(props));
            return;
        }

        assertTrue(curve.validateProps(props));

        (
            ICurve.Params memory newParams,
            uint256 inputValue,
            ,
        ) = curve.getBuyInfo(ICurve.Params(spotPrice, delta, props, abi.encode(0)), numItems, ICurve.FeeMultipliers(0, 0, 0, 0));

        if (spotPrice > 0 && numItems > 0) {
            assertTrue(
                (newParams.spotPrice == spotPrice &&
                    newParams.delta == delta),
                "Pool params updated inappropriately"
            );
        }

        /// @dev This holds true because we started at nonnegative deltaN (abi.decode(state, (int256)))
        assertGe(
            inputValue,
            numItems * uint256(spotPrice),
            "Input value incorrect"
        );
        // assertEq(newParams.props, props, "Props incorrect");   
    }



    function test_getSellInfoExample() public {
        uint128 spotPrice = 3 ether;
        uint128 delta = 2 ether; // 2
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
                    abi.encode(0)
                ),
                numItems,
                ICurve.FeeMultipliers(
                    feeMultiplier,
                    protocolFeeMultiplier,
                    royaltyNumerator,
                    0
                )
            );
        assertEq(newParams.spotPrice, 3 ether, "Spot price incorrect");
        assertEq(newParams.delta, 2 ether, "Delta incorrect");
        assertEq(outputValue, 5.766 ether, "Output value incorrect");
        assertEq(fees.protocol, 0.0174375 ether, "Protocol fee incorrect");
        // assertEq(newParams.props, props, "Props incorrect");
    }

    function test_getSellInfoWithoutFee(
        uint128 spotPrice,
        uint128 delta,
        uint8 numItems
    ) public {
        if (
            delta <= FixedPointMathLib.WAD ||
            numItems == 0
        ) {
            return;
        }

        bool bidAskInflatorIsFlatAmount = true;
        uint248 inflator = 0.15 ether;
        bytes memory props =abi.encode(bidAskInflatorIsFlatAmount, inflator);

        (
            ICurve.Params memory newParams,
            uint256 outputValue,
            ,
        ) = curve.getSellInfo(ICurve.Params(spotPrice, delta, props, abi.encode(0)), numItems, ICurve.FeeMultipliers(0, 0, 0, 0));

        // assertEq(newParams.props, props, "Props incorrect");

        if (numItems > 0) {
            assertTrue(
                (newParams.spotPrice == spotPrice &&
                    newParams.delta == delta),
                "Pool params updated inappropriately"
            );
        }

        /// @dev This holds true because we started at nonnegative deltaN (abi.decode(state, (int256)))
        assertLe(
            outputValue,
            numItems * uint256(spotPrice),
            "Output value incorrect"
        );
    }
}
