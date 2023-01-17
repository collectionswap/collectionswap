// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {Curve} from "./Curve.sol";
import {CurveErrorCodes} from "./CurveErrorCodes.sol";
import {FixedPointMathLib} from "../lib/FixedPointMathLib.sol";

/*
    @author Collection
    @notice Bonding curve logic for a linear curve, where each buy/sell changes spot price by adding/substracting delta*/
contract LinearCurve is Curve, CurveErrorCodes {
    using FixedPointMathLib for uint256;

    /**
     * @dev See {ICurve-getBuyInfo}
     */
    function getBuyInfo(Params calldata params, uint256 numItems, FeeMultipliers calldata feeMultipliers)
        external
        pure
        override
        returns (Error error, Params memory newParams, uint256 inputValue, Fees memory fees)
    {
        // We only calculate changes for buying 1 or more NFTs
        if (numItems == 0) {
            return (Error.INVALID_NUMITEMS, Params(0, 0, "", ""), 0, Fees(0, 0, new uint256[](0)));
        }

        // For a linear curve, the spot price increases by delta for each item bought
        uint256 newSpotPrice_ = params.spotPrice + params.delta * numItems;
        if (newSpotPrice_ > type(uint128).max) {
            return (Error.SPOT_PRICE_OVERFLOW, Params(0, 0, "", ""), 0, Fees(0, 0, new uint256[](0)));
        }
        newParams.spotPrice = uint128(newSpotPrice_);

        // Spot price is assumed to be the instant sell price. To avoid arbitraging LPs, we adjust the buy price upwards.
        // If spot price for buy and sell were the same, then someone could buy 1 NFT and then sell for immediate profit.
        // EX: Let S be spot price. Then buying 1 NFT costs S ETH, now new spot price is (S+delta).
        // The same person could then sell for (S+delta) ETH, netting them delta ETH profit.
        // If spot price for buy and sell differ by delta, then buying costs (S+delta) ETH.
        // The new spot price would become (S+delta), so selling would also yield (S+delta) ETH.
        uint256 buySpotPrice = params.spotPrice + params.delta;

        // If we buy n items, then the total cost is equal to:
        // (buy spot price) + (buy spot price + 1*delta) + (buy spot price + 2*delta) + ... + (buy spot price + (n-1)*delta)
        // This is equal to n*(buy spot price) + (delta)*(n*(n-1))/2
        // because we have n instances of buy spot price, and then we sum up from delta to (n-1)*delta
        inputValue = numItems * buySpotPrice + (numItems * (numItems - 1) * params.delta) / 2;

        fees.royalties = new uint256[](numItems);
        uint256 totalRoyalty;
        for (uint256 i = 0; i < numItems;) {
            uint256 royaltyAmount =
                (buySpotPrice + (params.delta * i)).fmul(feeMultipliers.royaltyNumerator, FEE_DENOMINATOR);
            fees.royalties[i] = royaltyAmount;
            totalRoyalty += royaltyAmount;

            unchecked {
                ++i;
            }
        }

        (inputValue, fees) = getInputValueAndFees(feeMultipliers, inputValue, fees.royalties, totalRoyalty);

        // Keep delta the same
        newParams.delta = params.delta;

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
        returns (Error error, Params memory newParams, uint256 outputValue, Fees memory fees)
    {
        // We only calculate changes for selling 1 or more NFTs
        if (numItems == 0) {
            return (Error.INVALID_NUMITEMS, Params(0, 0, "", ""), 0, Fees(0, 0, new uint256[](0)));
        }

        // We first calculate the change in spot price after selling all of the items
        uint256 totalPriceDecrease = params.delta * numItems;

        // If the current spot price is less than the total amount that the spot price should change by...
        if (params.spotPrice < totalPriceDecrease) {
            // Then we set the new spot price to be 0. (Spot price is never negative)
            newParams.spotPrice = 0;

            // We calculate how many items we can sell into the linear curve until the spot price reaches 0, rounding up
            uint256 numItemsTillZeroPrice = params.spotPrice / params.delta + 1;
            numItems = numItemsTillZeroPrice;
        }
        // Otherwise, the current spot price is greater than or equal to the total amount that the spot price changes
        // Thus we don't need to calculate the maximum number of items until we reach zero spot price, so we don't modify numItems
        else {
            // The new spot price is just the change between spot price and the total price change
            newParams.spotPrice = params.spotPrice - uint128(totalPriceDecrease);
        }

        // If we sell n items, then the total sale amount is:
        // (spot price) + (spot price - 1*delta) + (spot price - 2*delta) + ... + (spot price - (n-1)*delta)
        // This is equal to n*(spot price) - (delta)*(n*(n-1))/2
        outputValue = numItems * params.spotPrice - (numItems * (numItems - 1) * params.delta) / 2;

        fees.royalties = new uint256[](numItems);
        uint256 totalRoyalty;
        for (uint256 i = 0; i < numItems;) {
            uint256 royaltyAmount =
                (params.spotPrice - (params.delta * i)).fmul(feeMultipliers.royaltyNumerator, FEE_DENOMINATOR);
            fees.royalties[i] = royaltyAmount;
            totalRoyalty += royaltyAmount;

            unchecked {
                ++i;
            }
        }

        (outputValue, fees) = getOutputValueAndFees(feeMultipliers, outputValue, fees.royalties, totalRoyalty);

        // Keep delta the same
        newParams.delta = params.delta;

        // Keep state the same
        newParams.state = params.state;

        // If we reached here, no math errors
        error = Error.OK;
    }
}
