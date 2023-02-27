// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {Curve} from "./Curve.sol";
import {CurveErrorCodes} from "./CurveErrorCodes.sol";
import {CollectionPool} from "../pools/CollectionPool.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {CollectionPoolCloner} from "../lib/CollectionPoolCloner.sol";
import {CollectionPoolERC20} from "../pools/CollectionPoolERC20.sol";
import {FixedPointMathLib} from "../lib/FixedPointMathLib.sol";

/**
 * @author Collection
 * @notice Bonding curve logic for an x*y=k curve using virtual reserves.
 * @dev    The virtual token reserve is stored in `spotPrice` and the virtual nft reserve is stored in `delta`.
 *         An LP can modify the virtual reserves by changing the `spotPrice` (tokens) or `delta` (nfts).
 */
contract XykCurve is Curve, CurveErrorCodes {
    using FixedPointMathLib for uint256;

    error TokenReserveOverflow(uint256 initialValue, uint256 finalValue);
    error NFTReserveOverflow(uint256 initialValue, uint256 finalValue);

    /**
     * @dev See {ICurve-getBuyInfo}
     */
    function getBuyInfo(Params calldata params, uint256 numItems, FeeMultipliers calldata feeMultipliers)
        external
        pure
        override
        returns (Error error, Params memory newParams, uint256 inputValue, Fees memory fees, uint256 lastSwapPrice)
    {
        if (numItems == 0) {
            return (Error.INVALID_NUMITEMS, Params(0, 0, "", ""), 0, Fees(0, 0, new uint256[](0)), 0);
        }

        // get the pool's virtual nft and eth/erc20 reserves
        uint256 tokenBalance = params.spotPrice;
        uint256 nftBalance = params.delta;

        // If numItems is too large, we will get divide by zero error
        if (numItems >= nftBalance) {
            return (Error.INVALID_NUMITEMS, Params(0, 0, "", ""), 0, Fees(0, 0, new uint256[](0)), 0);
        }

        // calculate the amount to send in
        uint256 inputValueWithoutFee = (numItems * tokenBalance) / (nftBalance - numItems);

        fees.royalties = new uint256[](numItems);
        // For XYK, every item has the same price so royalties have the same value
        uint256 rawAmount = inputValueWithoutFee / numItems;
        uint256 royaltyAmount = rawAmount.fmul(feeMultipliers.royaltyNumerator, FEE_DENOMINATOR);
        for (uint256 i = 0; i < numItems;) {
            fees.royalties[i] = royaltyAmount;

            unchecked {
                ++i;
            }
        }

        /// @dev royalty breakdown not needed if fees aren't used
        (lastSwapPrice,) = getInputValueAndFees(feeMultipliers, rawAmount, new uint256[](0), royaltyAmount);

        // Get the total royalties after accounting for integer division
        uint256 totalRoyalties = royaltyAmount * numItems;

        (inputValue, fees) = getInputValueAndFees(feeMultipliers, inputValueWithoutFee, fees.royalties, totalRoyalties);

        // set the new virtual reserves
        bool success;
        (success, newParams.spotPrice) = safeCastUint256ToUint128(tokenBalance + inputValueWithoutFee); // token reserve
        if (!success) revert TokenReserveOverflow(tokenBalance, newParams.spotPrice);
        (success, newParams.delta) = safeCastUint256ToUint128(nftBalance - numItems); // nft reserve
        if (!success) revert NFTReserveOverflow(nftBalance, newParams.delta);

        // Keep state the same
        newParams.state = params.state;

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
        if (numItems == 0) {
            return (Error.INVALID_NUMITEMS, Params(0, 0, "", ""), 0, Fees(0, 0, new uint256[](0)), 0);
        }

        // get the pool's virtual nft and eth/erc20 balance
        uint256 tokenBalance = params.spotPrice;
        uint256 nftBalance = params.delta;

        // calculate the amount to send out
        uint256 outputValueWithoutFee = (numItems * tokenBalance) / (nftBalance + numItems);

        fees.royalties = new uint256[](numItems);
        // For XYK, every item has the same price so royalties have the same value
        uint256 rawAmount = outputValueWithoutFee / numItems;
        uint256 royaltyAmount = rawAmount.fmul(feeMultipliers.royaltyNumerator, FEE_DENOMINATOR);
        for (uint256 i = 0; i < numItems;) {
            fees.royalties[i] = royaltyAmount;

            unchecked {
                ++i;
            }
        }

        /// @dev royalty breakdown not needed if fee return value not used
        (lastSwapPrice,) = getOutputValueAndFees(feeMultipliers, rawAmount, new uint256[](0), royaltyAmount);

        // Get the total royalties after accounting for integer division
        uint256 totalRoyalties = royaltyAmount * numItems;

        (outputValue, fees) =
            getOutputValueAndFees(feeMultipliers, outputValueWithoutFee, fees.royalties, totalRoyalties);

        // set the new virtual reserves
        bool success;
        (success, newParams.spotPrice) = safeCastUint256ToUint128(tokenBalance - outputValueWithoutFee); // token reserve
        if (!success) revert TokenReserveOverflow(tokenBalance, newParams.spotPrice);
        (success, newParams.delta) = safeCastUint256ToUint128(nftBalance + numItems); // nft reserve
        if (!success) revert NFTReserveOverflow(nftBalance, newParams.delta);

        // Keep state the same
        newParams.state = params.state;

        // If we got all the way here, no math error happened
        error = Error.OK;
    }

    function safeCastUint256ToUint128(uint256 value) internal pure returns (bool success, uint128 castedValue) {
        success = value <= type(uint128).max;
        castedValue = uint128(value);
    }
}
