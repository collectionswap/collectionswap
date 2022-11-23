// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import {NoArbBondingCurve} from "../base/NoArbBondingCurve.sol";
import {UsingExponentialCurve} from "../mixins/UsingExponentialCurve.sol";
import {UsingMissingEnumerable} from "../mixins/UsingMissingEnumerable.sol";
import {UsingETH} from "../mixins/UsingETH.sol";

contract NoArbExponentialCurveMissingEnumerableETHTest is
    // The original sudoswap test does not work when protocol fee is 0.
    // NoArbBondingCurve,
    UsingExponentialCurve,
    UsingMissingEnumerable,
    UsingETH
{}
