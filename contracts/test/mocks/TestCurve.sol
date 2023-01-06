pragma solidity ^0.8.0;

import {CurveErrorCodes} from "../../bonding-curves/CurveErrorCodes.sol";
import {Curve} from "../../bonding-curves/Curve.sol";
import {FixedPointMathLib} from "../../lib/FixedPointMathLib.sol";

contract TestCurve is Curve {
    using FixedPointMathLib for uint256;

    function getBuyInfo(Params calldata params, uint256 numItems, FeeMultipliers calldata feeMultipliers)
        external
        view
        returns (CurveErrorCodes.Error error, Params memory newParams, uint256 inputValue, Fees memory fees)
    {
        // use value as seed to generate pseudorandom numbers
        uint256 value = uint256(bytes32(params.state));

        fees.royalties = new uint256[](numItems);
        uint256 totalRoyalty;
        for (uint256 i; i < numItems; ++i) {
            // cast to uint248 to prevent overflow
            value = uint256(uint248(uint256(keccak256(abi.encodePacked(value, "buy", "value", i)))));
            inputValue += value;

            uint256 royalty = value.fmul(feeMultipliers.royaltyNumerator, FixedPointMathLib.WAD);
            fees.royalties[i] = royalty;
            totalRoyalty += royalty;
        }

        (inputValue, fees) = getInputValueAndFees(feeMultipliers, inputValue, fees.royalties, totalRoyalty);

        newParams.state = abi.encodePacked(value);
    }

    function getSellInfo(Params calldata params, uint256 numItems, FeeMultipliers calldata feeMultipliers)
        external
        view
        returns (CurveErrorCodes.Error error, Params memory newParams, uint256 outputValue, Fees memory fees)
    {
        // use value as seed to generate pseudorandom numbers
        uint256 value = uint256(bytes32(params.state));

        fees.royalties = new uint256[](numItems);
        uint256 totalRoyalty;
        for (uint256 i; i < numItems; ++i) {
            // cast to uint248 to prevent overflow
            value = uint256(uint248(uint256(keccak256(abi.encodePacked(value, "sell", "value", i)))));
            outputValue += value;

            uint256 royalty = value.fmul(feeMultipliers.royaltyNumerator, FixedPointMathLib.WAD);
            fees.royalties[i] = royalty;
            totalRoyalty += royalty;
        }

        (outputValue, fees) = getOutputValueAndFees(feeMultipliers, outputValue, fees.royalties, totalRoyalty);

        newParams.state = abi.encodePacked(value);
    }
}