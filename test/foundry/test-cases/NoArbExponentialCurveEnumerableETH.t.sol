// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import {NoArbBondingCurve} from "../base/NoArbBondingCurve.sol";
import {UsingExponentialCurve} from "../mixins/UsingExponentialCurve.sol";
import {UsingEnumerable} from "../mixins/UsingEnumerable.sol";
import {UsingETH} from "../mixins/UsingETH.sol";

contract NoArbExponentialCurveEnumerableETHTest is
    // The original AMM test does not work when protocol fee is 0.
    // NoArbBondingCurve,
    UsingExponentialCurve,
    UsingEnumerable,
    UsingETH
{}
