// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import {PoolAndFactory} from "../base/PoolAndFactory.sol";
import {UsingExponentialCurve} from "../mixins/UsingExponentialCurve.sol";
import {UsingEnumerable} from "../mixins/UsingEnumerable.sol";
import {UsingERC20} from "../mixins/UsingERC20.sol";

contract PAFExponentialCurveEnumerableERC20Test is
    PoolAndFactory,
    UsingExponentialCurve,
    UsingEnumerable,
    UsingERC20
{}
