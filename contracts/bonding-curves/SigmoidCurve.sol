// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {Curve} from "./Curve.sol";
import {CurveErrorCodes} from "./CurveErrorCodes.sol";
import {FixedPointMathLib} from "../lib/FixedPointMathLib.sol";

import {ABDKMath64x64} from "../lib/ABDKMATH64x64.sol";

/**
 * @author potato-cat69
 * @notice Bonding curve logic for a sigmoid curve, where each buy/sell changes
 * spot price by adjusting its position along a sigmoid curve.
 *
 * WARNING: This curve does not set spotPrice to be the sell now price. Do not
 * assume as such. spotPrice for this curve is set to 0.
 *
 * GLOSSARY:
 *     P_min: minimum price of an NFT to be bought / sold
 *     P_max: maximum price of an NFT to be bought / sold
 *     k: scaling factor (curve gradient) that affects how fast P_min and P_max is approached.
 *     n_0: initial number of NFTs the pool had
 *     n: current number of NFTs the pool is holding
 *     deltaN: n - n_0, ie. the delta between initial and current NFTs held
 *
 * CONSTRAINTS:
 *     - k and deltaN must be expressible as signed 64.64 bit fixed point
 *       binary numbers as we rely on a 64x64 library for computations.
 *     - k is non-negative as it is casted from uint256 delta, implying 0 <= k <= 0x7FFFFFFFFFFFFFFF
 *     - -0x8000000000000000 <= deltaN <= 0x7FFFFFFFFFFFFFFF
 *     - This means the pool can never have a net loss of NFTs greater than
 *       -0x8000000000000000 or a net gain of NFTs greater than
 *       0x7FFFFFFFFFFFFFFF
 *
 * @dev The curve takes the form:
 * P(deltaN) = P_min + (P_max - P_min) / (1 + 2 ** (k * deltaN))
 *
 * While a traditional sigmoid uses e as the exponent base, this is equivalent
 * to modifying the value of k so a value of 2 is used for convenience.
 *
 * The values used in the equation for P(n) are as described below:
 * - `props` must be abi.encode(uint256(P_min), uint256(P_max - P_min))
 * - `state` must be abi.encode(int128(n - n0))
 * - `delta` must be k * 2**10 as a uint128. The value of k is normalized
 *   because most useful curves have k between 0 and 8, with small changes to k
 *   (e.g. 1/128) producing significant changes to the curve
 */
contract SigmoidCurve is Curve, CurveErrorCodes {
    using FixedPointMathLib for uint256;
    using ABDKMath64x64 for int128;

    /**
     * @param k The normalized value of k as a 64.64 bit signed int
     * @param deltaN The SIGNED INTEGER value of (n - n_0)
     * @param pMin The minimum value of the sigmoid curve
     * @param deltaP The difference between min and max price of the curve
     */
    struct SigmoidParameters {
        int128 k;
        int256 deltaN;
        uint256 pMin;
        uint256 deltaP;
    }

    /**
     * @dev k = `(delta << 64) / 2**K_NORMALIZATION_EXPONENT`
     */

    uint256 private constant K_NORMALIZATION_EXPONENT = 10;
    int128 private constant ONE_64_64 = 1 << 64;

    /**
     * @dev See {ICurve-validateDelta}
     */
    function validateDelta(uint128 delta) external pure override returns (bool valid) {
        return valid64x64Uint(delta);
    }

    /**
     * @dev See {ICurve-validateProps}
     */
    function validateProps(bytes calldata props) external pure override returns (bool valid) {
        // The only way for P_min and deltaP to be invalid is if P_min + deltaP
        // causes overflow (i.e. P_max not in uint256 space)

        // We don't want to revert on overflow, just return false. So do
        // unchecked addition and compare. Equality is allowed because deltaP of
        // 0 is allowed. Safe because it's impossible to overflow back to the
        // same number in a single binop addition.
        (uint256 P_min, uint256 deltaP) = getPriceRange(props);

        unchecked {
            uint256 P_max = P_min + deltaP;
            return P_max >= P_min;
        }
    }

    /**
     * @dev See {ICurve-validateState}
     */
    function validateState(bytes calldata state) external pure override returns (bool valid) {
        // convert to uint256 first, then check it doesn't exceed upper and lower bounds of int64
        // modified from https://github.com/GNSPS/solidity-bytes-utils/blob/master/contracts/BytesLib.sol#L374-L383
        if (state.length < 32) return false;
        uint256 tempUint;
        assembly {
            tempUint := calldataload(state.offset)
        }

        // taken from OpenZeppelin's SafeCast library
        // https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v4.8.0/contracts/utils/math/SafeCast.sol#L1131-L1135
        // Unsafe cast below is okay because `type(int256).max` is guaranteed to be positive
        if (tempUint > uint256(type(int256).max)) return false;
        return valid64x64Int(int256(tempUint));
    }

    /**
     * @dev See {ICurve-getBuyInfo}
     */
    function getBuyInfo(Params calldata params, uint256 numItems, FeeMultipliers calldata feeMultipliers)
        external
        pure
        override
        returns (Params memory newParams, uint256 inputValue, Fees memory fees, uint256 lastSwapPrice)
    {
        return getInfo(true, params, numItems, feeMultipliers);
    }

    /**
     * @dev See {ICurve-getSellInfo}
     */
    function getSellInfo(Params calldata params, uint256 numItems, FeeMultipliers calldata feeMultipliers)
        external
        pure
        returns (Params memory newParams, uint256 outputValue, Fees memory fees, uint256 lastSwapPrice)
    {
        return getInfo(false, params, numItems, feeMultipliers);
    }

    /// @dev To prevent stack too deep
    function getInfoPrelude(uint256 numItems) internal pure {
        // We only calculate changes for buying/selling 1 or more NFTs.
        if (numItems == 0) revert InvalidNumItems();

        // Verify that the resulting deltaN is will be valid. First ensure that
        // `numItems` fits in a 64 bit unsigned int. Then we can subtract
        // unchecked and manually check if bounds are exceeded
        if (numItems > 0x7FFFFFFFFFFFFFFF) revert TooManyItems();
    }

    function getInfo(bool isBuy, Params calldata params, uint256 numItems, FeeMultipliers calldata feeMultipliers)
        internal
        pure
        returns (Params memory newParams, uint256 value, Fees memory fees, uint256 lastSwapPrice)
    {
        // Extract information about the state of the pool
        (SigmoidParameters memory sigmoidParams) = getSigmoidParameters(params.delta, params.props, params.state);

        // The only difference between buying and selling is whether the number of items is being incremented or decremented.
        // Since buying nfts from the pool results in the pool having less nfts, we decrease the number of items for all calculations.
        // Vice versa for selling.
        int256 sign = isBuy ? -1 : int8(1);

        int256 _numItems = int256(numItems);
        int256 newNumItems = sigmoidParams.deltaN + sign * _numItems;
        // Ensure deltaN -/+ _numItems can be safecasted for 64.64 bit computations
        if (!valid64x64Int(sigmoidParams.deltaN + sign * _numItems)) revert TooManyItems();

        newParams.state = encodeState(newNumItems);

        // Iterate to calculate values. No closed form expression for discrete
        // sigmoid steps
        uint256 itemCost;

        fees.royalties = new uint256[](numItems);
        uint256 totalRoyalty;
        uint256 itemRoyalty;

        // We decrease / increase by n iteratively to the new price at fixedPointN for each NFT bought
        // ie. P(newDeltaN) = P_min + (P_max - P_min) / (1 + 2 ** (k * newDeltaN))
        // = P_min + deltaP / (1 + 2 ** (k * (deltaN -/+ n)))
        // = P_min + deltaP * (1 / (1 + 2 ** (k * (deltaN -/+ n))))
        // the loop calculates the sum of 1 / (1 + 2 ** (k * (deltaN + n))) before we apply scaling by deltaP
        for (int256 n = 1; n <= _numItems;) {
            // Locally scoped to avoid stack too deep
            {
                int128 kDeltaN = ABDKMath64x64.fromInt(sigmoidParams.deltaN + sign * n).mul(sigmoidParams.k);
                // fraction = 1 / (1 + 2 ** (k * (deltaN + n)))
                int128 fraction = ONE_64_64.div(ONE_64_64.add(kDeltaN.exp_2()));

                itemCost = sigmoidParams.pMin + fraction.mulu(sigmoidParams.deltaP);
                value += itemCost;
            }

            itemRoyalty = itemCost.fmul(feeMultipliers.royaltyNumerator, FEE_DENOMINATOR);
            fees.royalties[uint256(n) - 1] = itemRoyalty;
            totalRoyalty += itemRoyalty;

            unchecked {
                ++n;
            }
        }

        /// @dev royalty breakdown not needed if fees aren't used
        (lastSwapPrice,) = isBuy
            ? getInputValueAndFees(feeMultipliers, itemCost, new uint256[](0), itemRoyalty)
            : getOutputValueAndFees(feeMultipliers, itemCost, new uint256[](0), itemRoyalty);

        (value, fees) = isBuy
            ? getInputValueAndFees(feeMultipliers, value, fees.royalties, totalRoyalty)
            : getOutputValueAndFees(feeMultipliers, value, fees.royalties, totalRoyalty);

        // Set new spotPrice and delta equal to old spotPrice and delta
        // as neither changes for this curve
        newParams.spotPrice = params.spotPrice;
        newParams.delta = params.delta;
    }

    /// Helper functions
    function valid64x64Uint(uint256 value) private pure returns (bool) {
        return value <= 0x7FFFFFFFFFFFFFFF;
    }

    function valid64x64Int(int256 value) private pure returns (bool) {
        return value >= -0x8000000000000000 && value <= 0x7FFFFFFFFFFFFFFF;
    }

    /**
     * @param params The params for this curve
     * @return (minPrice, maxPrice - minPrice)
     */
    function getPriceRange(bytes calldata params) private pure returns (uint256, uint256) {
        return abi.decode(params, (uint256, uint256));
    }

    /**
     * @param state The state of this curve
     * @return The signed integer value of deltaN
     */
    function getDeltaN(bytes calldata state) private pure returns (int256) {
        return abi.decode(state, (int256));
    }

    /**
     * @param deltaN The value of (n - n_0) at the moment
     * @return The encoded state of the curve
     */
    function encodeState(int256 deltaN) private pure returns (bytes memory) {
        return abi.encode(deltaN);
    }

    /**
     * @param delta The delta for this curve
     * @return The value of k for this curve, normalized, as a 64.64 bit fixed
     * point number.
     */
    function getK(uint128 delta) private pure returns (int128) {
        /// @dev Implicit upcast to uint256
        return ABDKMath64x64.fromUInt(delta) >> K_NORMALIZATION_EXPONENT;
    }

    /**
     * @param delta The delta for this curve
     * @param params The params for this curve
     * @param state The state of this curve
     * @return
     */
    function getSigmoidParameters(uint128 delta, bytes calldata params, bytes calldata state)
        private
        pure
        returns (SigmoidParameters memory)
    {
        int128 k = getK(delta);
        int256 deltaN = getDeltaN(state);
        (uint256 pMin, uint256 deltaP) = getPriceRange(params);
        return SigmoidParameters({k: k, deltaN: deltaN, pMin: pMin, deltaP: deltaP});
    }
}
