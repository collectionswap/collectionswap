pragma solidity ^0.8.0;

import {CurveErrorCodes} from "../../bonding-curves/CurveErrorCodes.sol";
import {Curve} from "../../bonding-curves/Curve.sol";
import {FixedPointMathLib} from "../../lib/FixedPointMathLib.sol";

contract TestCurve is Curve {
    using FixedPointMathLib for uint256;

    function getBuyInfo(Params calldata params, uint256 numItems, FeeMultipliers calldata feeMultipliers)
        external
        view
        returns (
            CurveErrorCodes.Error error,
            Params memory newParams,
            uint256 inputValue,
            Fees memory fees,
            uint256 lastSwapPrice
        )
    {
        // use value as seed to generate pseudorandom numbers
        uint256 value = uint256(bytes32(params.state));

        fees.royalties = new uint256[](numItems);
        uint256 totalRoyalty;
        for (uint256 i; i < numItems; ++i) {
            // cast to uint192 to prevent overflow
            value = uint256(uint192(uint256(keccak256(abi.encodePacked(value, "buy", "value", i)))));
            inputValue += value;

            uint256 royalty = value.fmul(feeMultipliers.royaltyNumerator, FixedPointMathLib.WAD);
            fees.royalties[i] = royalty;
            totalRoyalty += royalty;

            if (i == numItems - 1) {
                /// @dev royalty breakdown not needed if fees aren't used
                (lastSwapPrice,) = getInputValueAndFees(feeMultipliers, value, new uint256[](0), royalty);
            }
        }

        (inputValue, fees) = getInputValueAndFees(feeMultipliers, inputValue, fees.royalties, totalRoyalty);

        newParams.state = abi.encodePacked(value);
    }

    function getSellInfo(Params calldata params, uint256 numItems, FeeMultipliers calldata feeMultipliers)
        external
        view
        returns (
            CurveErrorCodes.Error error,
            Params memory newParams,
            uint256 outputValue,
            Fees memory fees,
            uint256 lastSwapPrice
        )
    {
        // use value as seed to generate pseudorandom numbers
        uint256 value = uint256(bytes32(params.state));

        fees.royalties = new uint256[](numItems);
        uint256 totalRoyalty;
        for (uint256 i; i < numItems; ++i) {
            // cast to uint192 to prevent overflow
            value = uint256(uint192(uint256(keccak256(abi.encodePacked(value, "sell", "value", i)))));
            outputValue += value;

            uint256 royalty = value.fmul(feeMultipliers.royaltyNumerator, FixedPointMathLib.WAD);
            fees.royalties[i] = royalty;
            totalRoyalty += royalty;

            if (i == numItems - 1) {
                /// @dev royalty breakdown not needed if fees aren't used
                (lastSwapPrice,) = getInputValueAndFees(feeMultipliers, value, new uint256[](0), royalty);
            }
        }

        (outputValue, fees) = getOutputValueAndFees(feeMultipliers, outputValue, fees.royalties, totalRoyalty);

        newParams.state = abi.encodePacked(value);
    }
}
