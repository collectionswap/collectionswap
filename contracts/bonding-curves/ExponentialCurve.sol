// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {Curve} from "./Curve.sol";
import {CurveErrorCodes} from "./CurveErrorCodes.sol";
import {FixedPointMathLib} from "../lib/FixedPointMathLib.sol";

/**
 * @author Collection
 * @notice Bonding curve logic for an exponential curve, where each buy/sell
 * changes spot price by multiplying/dividing delta. To prevent price slippage,
 * the `state` of pools is used to store the change in number of NFTs this pool
 * has. This value is only updated upon swaps, so depositing/withdrawing does
 * not change the prices quoted by the pool.
 *
 *
 * @dev This curve stores the initial spotPrice in spotPrice and does not update
 * its value. delta is the percent change per nft traded and 1e18 is unity (i.e.
 * price will not change and curve is horizontal). State encodes the change in
 * number of NFTs this pool has.
 */
contract ExponentialCurve is Curve, CurveErrorCodes {
    using FixedPointMathLib for uint256;

    /**
     * @dev See {ICurve-validateDelta}
     */
    function validateDelta(uint128 delta) external pure override returns (bool) {
        return delta > FixedPointMathLib.WAD;
    }

    /**
     * @dev See {ICurve-getBuyInfo}
     */
    function getBuyInfo(Params calldata params, uint256 numItems, FeeMultipliers calldata feeMultipliers)
        external
        pure
        override
        returns (Error error, Params memory newParams, uint256 inputValue, Fees memory fees, uint256 lastSwapPrice)
    {
        // NOTE: we assume delta is > 1, as checked by validateDelta()
        // We only calculate changes for buying 1 or more NFTs
        if (numItems == 0) {
            return (Error.INVALID_NUMITEMS, Params(0, 0, "", ""), 0, Fees(0, 0, new uint256[](0)), 0);
        }

        if (numItems > uint256(type(int256).max)) {
            return (Error.TOO_MANY_ITEMS, Params(0, 0, "", ""), 0, Fees(0, 0, new uint256[](0)), 0);
        }

        uint128 delta = params.delta;
        int256 deltaN = decodeDeltaN(params.state);

        newParams.spotPrice = params.spotPrice;
        newParams.delta = delta;
        newParams.state = encodeDeltaN(deltaN - int256(numItems));

        // Spot price is assumed to be the instant sell price. To avoid arbitraging LPs, we adjust the buy price upwards.
        // If spot price for buy and sell were the same, then someone could buy 1 NFT and then sell for immediate profit.
        // EX: Let S be spot price. Then buying 1 NFT costs S ETH, now new spot price is (S * delta).
        // The same person could then sell for (S * delta) ETH, netting them delta ETH profit.
        // If spot price for buy and sell differ by delta, then buying costs (S * delta) ETH.
        // The new spot price would become (S * delta), so selling would also yield (S * delta) ETH.

        /// @dev The buy now price of 1 item is spotPrice * delta ^ (1 - deltaN).
        /// It is convenient for now to calculate spotPrice * delta ^ (-deltaN).
        /// FixedPointMathLib takes only nonnegative exponents. Thus,
        /// if -deltaN < 0 i.e. deltaN >= 0, then we can do the exponentiation
        /// by calculating spotPrice * (1/delta) ^ (deltaN). If deltaN == 0 however,
        /// we do not need to do exponentiation or division so we check for deltaN > 0.
        uint256 deltaPowQty = deltaN > 0
            ? FixedPointMathLib.WAD.fdiv(delta, FixedPointMathLib.WAD).fpow(uint256(deltaN), FixedPointMathLib.WAD)
            : uint256(delta).fpow(uint256(-deltaN), FixedPointMathLib.WAD);
        uint256 rawAmount = uint256(params.spotPrice).fmul(deltaPowQty, FixedPointMathLib.WAD);

        uint256 deltaPowN = uint256(delta).fpow(numItems, FixedPointMathLib.WAD);
        // If the user buys n items, then the total cost is equal to:
        // (delta * rawAmount) + (delta^2 * rawAmount) + ... (delta^(numItems) * rawAmount)
        // This is equal to (rawAmount * delta) * (delta^n - 1) / (delta - 1)
        // Note that this amount needs to have fees applied to it
        inputValue = (rawAmount.fmul(delta, FixedPointMathLib.WAD)).fmul(
            (deltaPowN - FixedPointMathLib.WAD).fdiv(delta - FixedPointMathLib.WAD, FixedPointMathLib.WAD),
            FixedPointMathLib.WAD
        );

        fees.royalties = new uint256[](numItems);
        uint256 totalRoyalty;
        uint256 royaltyAmount;
        /// @dev Loop to calculate royalty amounts and get last swap price
        for (uint256 i = 0; i < numItems;) {
            rawAmount = rawAmount.fmul(delta, FixedPointMathLib.WAD);
            royaltyAmount = rawAmount.fmul(feeMultipliers.royaltyNumerator, FEE_DENOMINATOR);
            fees.royalties[i] = royaltyAmount;
            totalRoyalty += royaltyAmount;

            unchecked {
                ++i;
            }
        }

        /// @dev royalty breakdown not needed if fees aren't used
        (lastSwapPrice,) = getInputValueAndFees(feeMultipliers, rawAmount, new uint256[](0), royaltyAmount);

        (inputValue, fees) = getInputValueAndFees(feeMultipliers, inputValue, fees.royalties, totalRoyalty);

        // If we got all the way here, no math error happened
        error = Error.OK;
    }

    /**
     * @dev See {ICurve-getSellInfo}
     */
    function getSellInfo(Params calldata params, uint256 numItems, FeeMultipliers calldata feeMultipliers)
        external
        pure
        override
        returns (Error error, Params memory newParams, uint256 outputValue, Fees memory fees, uint256 lastSwapPrice)
    {
        // NOTE: we assume delta is > 1, as checked by validateDelta()

        // We only calculate changes for buying 1 or more NFTs
        if (numItems == 0) {
            return (Error.INVALID_NUMITEMS, Params(0, 0, "", ""), 0, Fees(0, 0, new uint256[](0)), 0);
        }

        if (numItems > uint256(type(int256).max)) {
            return (Error.TOO_MANY_ITEMS, Params(0, 0, "", ""), 0, Fees(0, 0, new uint256[](0)), 0);
        }

        int256 deltaN = decodeDeltaN(params.state);
        uint128 delta = params.delta;

        newParams.spotPrice = params.spotPrice;
        newParams.delta = delta;
        newParams.state = encodeDeltaN(deltaN + int256(numItems));

        /// @dev The sell now price of 1 item is spotPrice * delta ^ (-deltaN).
        /// It is convenient for now to calculate spotPrice * delta ^ (1 - deltaN).
        /// FixedPointMathLib takes only nonnegative exponents. Thus,
        /// if 1 - deltaN < 0 i.e. deltaN > 1, then we can do the exponentiation
        /// by calculating spotPrice * (1/delta) ^ (deltaN - 1).

        uint256 rawAmount;
        uint256 deltaPowQty = deltaN > 1
            ? FixedPointMathLib.WAD.fdiv(delta, FixedPointMathLib.WAD).fpow(uint256(deltaN - 1), FixedPointMathLib.WAD)
            : uint256(delta).fpow(uint256(1 - deltaN), FixedPointMathLib.WAD);
        rawAmount = uint256(params.spotPrice).fmul(deltaPowQty, FixedPointMathLib.WAD);

        // If the user sells n items, then the total revenue is equal to:
        // ((1 / delta) * rawAmount) + ((1 / delta)^2 * rawAmount) + ... ((1 / delta)^(numItems) * rawAmount)
        // This is equal to (rawAmount / delta) * (1 - (1 / delta^n)) / (1 - (1 / delta))
        uint256 invDelta = FixedPointMathLib.WAD.fdiv(delta, FixedPointMathLib.WAD);
        uint256 invDeltaPowN = invDelta.fpow(numItems, FixedPointMathLib.WAD);
        outputValue = rawAmount.fdiv(delta, FixedPointMathLib.WAD).fmul(
            (FixedPointMathLib.WAD - invDeltaPowN).fdiv(FixedPointMathLib.WAD - invDelta, FixedPointMathLib.WAD),
            FixedPointMathLib.WAD
        );

        fees.royalties = new uint256[](numItems);
        uint256 totalRoyalty;
        uint256 royaltyAmount;
        /// @dev Loop to calculate royalty amounts and get last swap price
        for (uint256 i = 0; i < numItems;) {
            rawAmount = rawAmount.fdiv(delta, FixedPointMathLib.WAD);
            royaltyAmount = rawAmount.fmul(feeMultipliers.royaltyNumerator, FEE_DENOMINATOR);
            fees.royalties[i] = royaltyAmount;
            totalRoyalty += royaltyAmount;

            unchecked {
                ++i;
            }
        }

        /// @dev royalty breakdown not needed if fee return value not used
        (lastSwapPrice,) = getOutputValueAndFees(feeMultipliers, rawAmount, new uint256[](0), royaltyAmount);

        (outputValue, fees) = getOutputValueAndFees(feeMultipliers, outputValue, fees.royalties, totalRoyalty);

        // If we got all the way here, no math error happened
        error = Error.OK;
    }

    function decodeDeltaN(bytes calldata state) internal pure returns (int256) {
        return abi.decode(state, (int256));
    }

    function encodeDeltaN(int256 deltaN) internal pure returns (bytes memory) {
        return abi.encode(deltaN);
    }
}
