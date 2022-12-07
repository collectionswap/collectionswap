// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {ICurve} from "./ICurve.sol";
import {CurveErrorCodes} from "./CurveErrorCodes.sol";
import {FixedPointMathLib} from "../lib/FixedPointMathLib.sol";

/*
    @author Collection
    @notice Bonding curve logic for an exponential curve, where each buy/sell changes spot price by multiplying/dividing delta
*/
contract ExponentialCurve is ICurve, CurveErrorCodes {
    using FixedPointMathLib for uint256;

    // minimum price to prevent numerical issues
    uint256 public constant MIN_PRICE = 1 gwei;

    /**
        @dev See {ICurve-validateDelta}
     */
    function validateDelta(uint128 delta)
        external
        pure
        override
        returns (bool)
    {
        return delta > FixedPointMathLib.WAD;
    }

    /**
        @dev See {ICurve-validateSpotPrice}
     */
    function validateSpotPrice(uint128 newSpotPrice)
        external
        pure
        override
        returns (bool)
    {
        return newSpotPrice >= MIN_PRICE;
    }

    /**
        @dev See {ICurve-validateProps}
     */
    function validateProps(
        bytes calldata /*props*/
    ) external pure override returns (bool valid) {
        // For an exponential curve, all values of props are valid
        return true;
    }

    /**
        @dev See {ICurve-validateState}
     */
    function validateState(
        bytes calldata /*state*/
    ) external pure override returns (bool valid) {
        // For an exponential curve, all values of state are valid
        return true;
    }

    /**
        @dev See {ICurve-getBuyInfo}
     */
    function getBuyInfo(
        ICurve.Params calldata params,
        uint256 numItems,
        ICurve.FeeMultipliers calldata feeMultipliers
    )
        external
        pure
        override
        returns (
            Error error,
            uint128 newSpotPrice,
            uint128 newDelta,
            bytes memory newState,
            uint256 inputValue,
            uint256 tradeFee,
            uint256 protocolFee,
            uint256[] memory royaltyAmounts
        )
    {
        // NOTE: we assume delta is > 1, as checked by validateDelta()
        // We only calculate changes for buying 1 or more NFTs
        if (numItems == 0) {
            return (Error.INVALID_NUMITEMS, 0, 0, "", 0, 0, 0, new uint256[](0));
        }

        uint256 deltaPowN = uint256(params.delta).fpow(
            numItems,
            FixedPointMathLib.WAD
        );

        // For an exponential curve, the spot price is multiplied by delta for each item bought
        uint256 newSpotPrice_ = uint256(params.spotPrice).fmul(
            deltaPowN,
            FixedPointMathLib.WAD
        );
        if (newSpotPrice_ > type(uint128).max) {
            return (Error.SPOT_PRICE_OVERFLOW, 0, 0, "", 0, 0, 0, new uint256[](0));
        }
        newSpotPrice = uint128(newSpotPrice_);

        // Spot price is assumed to be the instant sell price. To avoid arbitraging LPs, we adjust the buy price upwards.
        // If spot price for buy and sell were the same, then someone could buy 1 NFT and then sell for immediate profit.
        // EX: Let S be spot price. Then buying 1 NFT costs S ETH, now new spot price is (S * delta).
        // The same person could then sell for (S * delta) ETH, netting them delta ETH profit.
        // If spot price for buy and sell differ by delta, then buying costs (S * delta) ETH.
        // The new spot price would become (S * delta), so selling would also yield (S * delta) ETH.
        uint256 buySpotPrice = uint256(params.spotPrice).fmul(
            params.delta,
            FixedPointMathLib.WAD
        );

        // If the user buys n items, then the total cost is equal to:
        // buySpotPrice + (delta * buySpotPrice) + (delta^2 * buySpotPrice) + ... (delta^(numItems - 1) * buySpotPrice)
        // This is equal to buySpotPrice * (delta^n - 1) / (delta - 1)
        inputValue = buySpotPrice.fmul(
            (deltaPowN - FixedPointMathLib.WAD).fdiv(
                params.delta - FixedPointMathLib.WAD,
                FixedPointMathLib.WAD
            ),
            FixedPointMathLib.WAD
        );

        // Account for the protocol fee, a flat percentage of the buy amount, only for Non-Trade pools
        protocolFee = inputValue.fmul(
            feeMultipliers.protocol,
            FixedPointMathLib.WAD
        );

        // Account for the trade fee, only for Trade pools
        tradeFee = inputValue.fmul(feeMultipliers.trade, FixedPointMathLib.WAD);

        // Account for the carry fee, only for Trade pools
        uint256 carryFee = tradeFee.fmul(feeMultipliers.carry, FixedPointMathLib.WAD);
        tradeFee -= carryFee;
        protocolFee += carryFee;

        royaltyAmounts = new uint256[](numItems);
        uint256 totalRoyalty;
        for (uint256 i = 0; i < numItems; ) {
            uint256 deltaPowI = uint256(params.delta).fpow(
                i,
                FixedPointMathLib.WAD
            );
            uint256 royaltyAmount = (buySpotPrice * deltaPowI).fmul(
                feeMultipliers.royaltyNumerator,
                FixedPointMathLib.WAD * FixedPointMathLib.WAD // (delta ^ i) is still in units of ether 
            );
            royaltyAmounts[i] = royaltyAmount;
            totalRoyalty += royaltyAmount;

            unchecked {
                ++i;
            }
        }

        // Add the fees to the required input amount
        inputValue += tradeFee + protocolFee + totalRoyalty;

        // Keep delta the same
        newDelta = params.delta;

        // Keep state the same
        newState = params.state;

        // If we got all the way here, no math error happened
        error = Error.OK;
    }

    /**
        @dev See {ICurve-getSellInfo}
        If newSpotPrice is less than MIN_PRICE, newSpotPrice is set to MIN_PRICE instead.
        This is to prevent the spot price from ever becoming 0, which would decouple the price
        from the bonding curve (since 0 * delta is still 0)
     */
    function getSellInfo(
        ICurve.Params calldata params,
        uint256 numItems,
        ICurve.FeeMultipliers calldata feeMultipliers
    )
        external
        pure
        override
        returns (
            Error error,
            uint128 newSpotPrice,
            uint128 newDelta,
            bytes memory newState,
            uint256 outputValue,
            uint256 tradeFee,
            uint256 protocolFee,
            uint256[] memory royaltyAmounts
        )
    {
        // NOTE: we assume delta is > 1, as checked by validateDelta()

        // We only calculate changes for buying 1 or more NFTs
        if (numItems == 0) {
            return (Error.INVALID_NUMITEMS, 0, 0, "", 0, 0, 0, new uint256[](0));
        }

        uint256 invDelta = FixedPointMathLib.WAD.fdiv(
            params.delta,
            FixedPointMathLib.WAD
        );
        uint256 invDeltaPowN = invDelta.fpow(numItems, FixedPointMathLib.WAD);

        // For an exponential curve, the spot price is divided by delta for each item sold
        // safe to convert newSpotPrice directly into uint128 since we know newSpotPrice <= spotPrice
        // and spotPrice <= type(uint128).max
        newSpotPrice = uint128(
            uint256(params.spotPrice).fmul(invDeltaPowN, FixedPointMathLib.WAD)
        );
        if (newSpotPrice < MIN_PRICE) {
            newSpotPrice = uint128(MIN_PRICE);
        }

        // If the user sells n items, then the total revenue is equal to:
        // spotPrice + ((1 / delta) * spotPrice) + ((1 / delta)^2 * spotPrice) + ... ((1 / delta)^(numItems - 1) * spotPrice)
        // This is equal to spotPrice * (1 - (1 / delta^n)) / (1 - (1 / delta))
        outputValue = uint256(params.spotPrice).fmul(
            (FixedPointMathLib.WAD - invDeltaPowN).fdiv(
                FixedPointMathLib.WAD - invDelta,
                FixedPointMathLib.WAD
            ),
            FixedPointMathLib.WAD
        );

        // Account for the protocol fee, a flat percentage of the sell amount
        protocolFee = outputValue.fmul(
            feeMultipliers.protocol,
            FixedPointMathLib.WAD
        );

        // Account for the trade fee, only for Trade pools
        tradeFee = outputValue.fmul(feeMultipliers.trade, FixedPointMathLib.WAD);

        // Account for the carry fee, only for Trade pools
        uint256 carryFee = tradeFee.fmul(feeMultipliers.carry, FixedPointMathLib.WAD);
        tradeFee -= carryFee;
        protocolFee += carryFee;
        
        royaltyAmounts = new uint256[](numItems);
        uint256 totalRoyalty;
        uint256 royaltyAmount;
        for (uint256 i = 0; i < numItems; ) {
            uint256 invDeltaPowI = invDelta.fpow(
                i,
                FixedPointMathLib.WAD
            );
            royaltyAmount = (params.spotPrice * invDeltaPowI).fmul(
                feeMultipliers.royaltyNumerator,
                FixedPointMathLib.WAD * FixedPointMathLib.WAD // (delta ^ i) is still in units of ether
            );
            royaltyAmounts[i] = royaltyAmount;
            totalRoyalty += royaltyAmount;

            unchecked {
                ++i;
            }
        }

        // Account for the trade fee (only for Trade pools), protocol fee, and
        // royalties
        outputValue -= tradeFee + protocolFee + totalRoyalty;

        // Keep delta the same
        newDelta = params.delta;

        // Keep state the same
        newState = params.state;

        // If we got all the way here, no math error happened
        error = Error.OK;
    }
}
