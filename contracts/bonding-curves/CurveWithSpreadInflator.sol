// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {Curve} from "./Curve.sol";

abstract contract CurveWithSpreadInflator is Curve {
    uint24 constant INFLATOR_DENOMINATOR = 1e6;

    function deserializeProps(bytes calldata props)
        internal
        pure virtual
        returns (bool bidAskInflatorIsFlatAmount, uint248 inflator)
    {
        return abi.decode(props, (bool, uint248));
    }

    /**
     * @dev See {ICurve-validateProps}
     */
    function validateProps(bytes calldata props) external pure virtual override returns (bool valid) {
        (bool bidAskInflatorIsFlatAmount, uint248 inflator) = deserializeProps(props);

        if (!bidAskInflatorIsFlatAmount) {
            return inflator <= INFLATOR_DENOMINATOR; // can only go to 100% additively more than ask price. (i.e. 200% of ask price, multiplicatively)
        }

        return true;
    }

    function applyInflator(uint256 value, uint248 inflator, bool bidAskInflatorIsFlatAmount)
        internal
        pure
        returns (uint256)
    {
        return bidAskInflatorIsFlatAmount
            ? value + inflator
            : (value * (INFLATOR_DENOMINATOR + inflator)) / INFLATOR_DENOMINATOR;
    }
}
