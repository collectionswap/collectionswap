// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {ICurve} from "./ICurve.sol";
import {CurveErrorCodes} from "./CurveErrorCodes.sol";
import {LSSVMPair} from "../LSSVMPair.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {LSSVMPairCloner} from "../lib/LSSVMPairCloner.sol";
import {LSSVMPairERC20} from "../LSSVMPairERC20.sol";
import {ILSSVMPairFactoryLike} from "../LSSVMPairFactory.sol";

// original sudoswap code points to an old version of solmate in raricapital library (deprecated),
// later versions omit fpow and fmul, we use the new version with the functions added back in
import {FixedPointMathLib} from "../lib/FixedPointMathLib.sol";

/*
    @author 0xacedia
    @notice Bonding curve logic for an x*y=k curve using virtual reserves.
    @dev    The virtual token reserve is stored in `spotPrice` and the virtual nft reserve is stored in `delta`.
            An LP can modify the virtual reserves by changing the `spotPrice` (tokens) or `delta` (nfts).
*/
contract XykCurve is ICurve, CurveErrorCodes {
    using FixedPointMathLib for uint256;

    /**
        @dev See {ICurve-validateDelta}
     */
    function validateDelta(uint128 delta)
        external
        pure
        override
        returns (bool)
    {
        // all values are valid
        return true;
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
        // all values are valid
        return true;
    }

    /**
        @dev See {ICurve-validateProps}
     */
    function validateProps(
        bytes calldata /*props*/
    ) external pure override returns (bool valid) {
        // all values are valid
        return true;
    }

    /**
        @dev See {ICurve-validateState}
     */
    function validateState(
        bytes calldata /*state*/
    ) external pure override returns (bool valid) {
        // all values are valid
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
            uint256 protocolFee
        )
    {
        if (numItems == 0) {
            return (Error.INVALID_NUMITEMS, 0, 0, "", 0, 0, 0);
        }

        // get the pair's virtual nft and eth/erc20 reserves
        uint256 tokenBalance = params.spotPrice;
        uint256 nftBalance = params.delta;

        // If numItems is too large, we will get divide by zero error
        if (numItems >= nftBalance) {
            return (Error.INVALID_NUMITEMS, 0, 0, "", 0, 0, 0);
        }

        // calculate the amount to send in
        uint256 inputValueWithoutFee = (numItems * tokenBalance) /
            (nftBalance - numItems);

        // add the fees to the amount to send in
        protocolFee = inputValueWithoutFee.fmul(
            feeMultipliers.protocol,
            FixedPointMathLib.WAD
        );
        tradeFee = inputValueWithoutFee.fmul(
            feeMultipliers.trade,
            FixedPointMathLib.WAD
        );
        // Account for the carry fee, only for Trade pools
        uint256 carryFee = tradeFee.fmul(feeMultipliers.carry, FixedPointMathLib.WAD);
        tradeFee -= carryFee;
        protocolFee += carryFee;
        inputValue = inputValueWithoutFee + tradeFee + protocolFee;

        // set the new virtual reserves
        newSpotPrice = uint128(params.spotPrice + inputValueWithoutFee); // token reserve
        newDelta = uint128(nftBalance - numItems); // nft reserve

        // Keep state the same
        newState = params.state;

        // If we got all the way here, no math error happened
        error = Error.OK;
    }

    /**
        @dev See {ICurve-getSellInfo}
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
            uint256 protocolFee
        )
    {
        if (numItems == 0) {
            return (Error.INVALID_NUMITEMS, 0, 0, "", 0, 0, 0);
        }

        // get the pair's virtual nft and eth/erc20 balance
        uint256 tokenBalance = params.spotPrice;
        uint256 nftBalance = params.delta;

        // calculate the amount to send out
        uint256 outputValueWithoutFee = (numItems * tokenBalance) /
            (nftBalance + numItems);

        // subtract fees from amount to send out
        protocolFee = outputValueWithoutFee.fmul(
            feeMultipliers.protocol,
            FixedPointMathLib.WAD
        );
        tradeFee = outputValueWithoutFee.fmul(
            feeMultipliers.trade,
            FixedPointMathLib.WAD
        );
        // Account for the carry fee, only for Trade pools
        uint256 carryFee = tradeFee.fmul(feeMultipliers.carry, FixedPointMathLib.WAD);
        tradeFee -= carryFee;
        protocolFee += carryFee;
        outputValue = outputValueWithoutFee - tradeFee - protocolFee;

        // set the new virtual reserves
        newSpotPrice = uint128(params.spotPrice - outputValueWithoutFee); // token reserve
        newDelta = uint128(nftBalance + numItems); // nft reserve

        // Keep state the same
        newState = params.state;

        // If we got all the way here, no math error happened
        error = Error.OK;
    }
}
