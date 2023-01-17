// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {Test} from "forge-std/Test.sol";

import {ExponentialCurve} from "../../../contracts/bonding-curves/ExponentialCurve.sol";
import {ICurve} from "../../../contracts/bonding-curves/ICurve.sol";
import {CurveErrorCodes} from "../../../contracts/bonding-curves/CurveErrorCodes.sol";
import {FixedPointMathLib} from "../../../contracts/lib/FixedPointMathLib.sol";

contract ExponentialCurveTest is Test {
    using FixedPointMathLib for uint256;

    uint256 constant MIN_PRICE = 1 gwei;

    ExponentialCurve curve;

    function setUp() public {
        curve = new ExponentialCurve();
    }

    function test_getBuyInfoExample() public {
        uint128 spotPrice = 3 ether;
        uint128 delta = 2 ether; // 2
        uint256 numItems = 5;
        uint24 feeMultiplier = (1e6 * 5) / 1000; // 0.5%
        uint24 protocolFeeMultiplier = (1e6 * 3) / 1000; // 0.3%
        uint24 royaltyNumerator = 0;
        (
            CurveErrorCodes.Error error,
            ICurve.Params memory newParams,
            uint256 inputValue,
            ICurve.Fees memory fees
        ) = curve.getBuyInfo(
                ICurve.Params(
                    spotPrice,
                    delta,
                    "",
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
        assertEq(
            uint256(error),
            uint256(CurveErrorCodes.Error.OK),
            "Error code not OK"
        );
        assertEq(newParams.spotPrice, 96 ether, "Spot price incorrect");
        assertEq(newParams.delta, 2 ether, "Delta incorrect");
        assertEq(inputValue, 187.488 ether, "Input value incorrect");
        assertEq(fees.protocol, 0.558 ether, "Protocol fee incorrect");
    }

    function test_getBuyInfoWithoutFee(
        uint128 spotPrice,
        uint64 delta,
        uint8 numItems
    ) public {
        if (
            delta < FixedPointMathLib.WAD ||
            numItems > 10 ||
            spotPrice < MIN_PRICE ||
            numItems == 0
        ) {
            return;
        }

        (
            CurveErrorCodes.Error error,
            ICurve.Params memory newParams,
            uint256 inputValue,

        ) = curve.getBuyInfo(ICurve.Params(spotPrice, delta, "", ""), numItems, ICurve.FeeMultipliers(0, 0, 0, 0));
        uint256 deltaPowN = uint256(delta).fpow(
            numItems,
            FixedPointMathLib.WAD
        );
        uint256 fullWidthNewSpotPrice = uint256(spotPrice).fmul(
            deltaPowN,
            FixedPointMathLib.WAD
        );
        if (fullWidthNewSpotPrice > type(uint128).max) {
            assertEq(
                uint256(error),
                uint256(CurveErrorCodes.Error.SPOT_PRICE_OVERFLOW),
                "Error code not SPOT_PRICE_OVERFLOW"
            );
        } else {
            assertEq(
                uint256(error),
                uint256(CurveErrorCodes.Error.OK),
                "Error code not OK"
            );

            if (spotPrice > 0 && numItems > 0) {
                assertTrue(
                    (newParams.spotPrice > spotPrice &&
                        delta > FixedPointMathLib.WAD) ||
                        (newParams.spotPrice == spotPrice &&
                            delta == FixedPointMathLib.WAD),
                    "Price update incorrect"
                );
            }

            assertGe(
                inputValue,
                numItems * uint256(spotPrice),
                "Input value incorrect"
            );
        }
    }

    function test_getSellInfoExample() public {
        uint128 spotPrice = 3 ether;
        uint128 delta = 2 ether; // 2
        uint256 numItems = 5;
        uint24 feeMultiplier = (1e6 * 5) / 1000; // 0.5%
        uint24 protocolFeeMultiplier = (1e6 * 3) / 1000; // 0.3%
        uint24 royaltyNumerator = 0;
        (
            CurveErrorCodes.Error error,
            ICurve.Params memory newParams,
            uint256 outputValue,
            ICurve.Fees memory fees
        ) = curve.getSellInfo(
                ICurve.Params(
                    spotPrice,
                    delta,
                    "",
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
        assertEq(
            uint256(error),
            uint256(CurveErrorCodes.Error.OK),
            "Error code not OK"
        );
        assertEq(newParams.spotPrice, 0.09375 ether, "Spot price incorrect");
        assertEq(newParams.delta, 2 ether, "Delta incorrect");
        assertEq(outputValue, 5.766 ether, "Output value incorrect");
        assertEq(fees.protocol, 0.0174375 ether, "Protocol fee incorrect");
    }

    function test_getSellInfoWithoutFee(
        uint128 spotPrice,
        uint128 delta,
        uint8 numItems
    ) public {
        if (
            delta < FixedPointMathLib.WAD ||
            spotPrice < MIN_PRICE ||
            numItems == 0
        ) {
            return;
        }

        (
            CurveErrorCodes.Error error,
            ICurve.Params memory newParams,
            uint256 outputValue,

        ) = curve.getSellInfo(ICurve.Params(spotPrice, delta, "", ""), numItems, ICurve.FeeMultipliers(0, 0, 0, 0));
        assertEq(
            uint256(error),
            uint256(CurveErrorCodes.Error.OK),
            "Error code not OK"
        );

        if (spotPrice > MIN_PRICE && numItems > 0) {
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
