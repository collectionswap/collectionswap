pragma solidity ^0.8.0;

import {ICurve} from "./ICurve.sol";
import {FixedPointMathLib} from "../lib/FixedPointMathLib.sol";

abstract contract Curve is ICurve {
    using FixedPointMathLib for uint256;

    /**
     * @dev See {ICurve-validateDelta}
     */
    function validateDelta(uint128 /*delta*/ ) external pure virtual returns (bool valid) {
        return true;
    }

    /**
     * @dev See {ICurve-validateSpotPrice}
     */
    function validateSpotPrice(uint128 /* newSpotPrice */ ) external pure virtual returns (bool) {
        return true;
    }

    /**
     * @dev See {ICurve-validateProps}
     */
    function validateProps(bytes calldata /*props*/ ) external pure virtual returns (bool valid) {
        return true;
    }

    /**
     * @dev See {ICurve-validateState}
     */
    function validateState(bytes calldata /*state*/ ) external pure virtual returns (bool valid) {
        return true;
    }

    /**
     * @dev Compute protocol and trade fee and add fees to input value.
     * @dev royalties should sum to totalRoyalty.
     */
    function getInputValueAndFees(
        FeeMultipliers calldata feeMultipliers,
        uint256 inputValueWithoutFee,
        uint256[] memory royalties,
        uint256 totalRoyalty
    ) internal pure returns (uint256 inputValue, Fees memory fees) {
        fees = getFees(feeMultipliers, inputValueWithoutFee, royalties);

        // Account for the trade fee (only for Trade pools), protocol fee, and royalties
        inputValue = inputValueWithoutFee + fees.trade + fees.protocol + totalRoyalty;
    }

    /**
     * @dev Compute protocol and trade fee and subtract fees from output value.
     * @dev royalties should sum to totalRoyalty.
     */
    function getOutputValueAndFees(
        FeeMultipliers calldata feeMultipliers,
        uint256 outputValueWithoutFee,
        uint256[] memory royalties,
        uint256 totalRoyalty
    ) internal pure returns (uint256 outputValue, Fees memory fees) {
        fees = getFees(feeMultipliers, outputValueWithoutFee, royalties);

        // Account for the trade fee (only for Trade pools), protocol fee, and royalties
        outputValue = outputValueWithoutFee - fees.trade - fees.protocol - totalRoyalty;
    }

    /**
     * @dev Compute protocol and trade fee.
     */
    function getFees(FeeMultipliers calldata feeMultipliers, uint256 valueWithoutFee, uint256[] memory royalties)
        internal
        pure
        returns (Fees memory fees)
    {
        // Account for the protocol fee, a flat percentage of the buy amount, only for Non-Trade pools
        fees.protocol = valueWithoutFee.fmul(feeMultipliers.protocol, FixedPointMathLib.WAD);

        // Account for the trade fee, only for Trade pools
        fees.trade = valueWithoutFee.fmul(feeMultipliers.trade, FixedPointMathLib.WAD);

        // Account for the carry fee, only for Trade pools
        uint256 carryFee = fees.trade.fmul(feeMultipliers.carry, FixedPointMathLib.WAD);
        fees.trade -= carryFee;
        fees.protocol += carryFee;

        fees.royalties = royalties;
    }
}
