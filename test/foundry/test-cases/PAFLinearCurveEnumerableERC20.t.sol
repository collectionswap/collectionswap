// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import {PoolAndFactory} from "../base/PoolAndFactory.sol";
import {UsingLinearCurve} from "../mixins/UsingLinearCurve.sol";
import {UsingEnumerable} from "../mixins/UsingEnumerable.sol";
import {UsingERC20} from "../mixins/UsingERC20.sol";

contract PAFLinearCurveEnumerableERC20Test is PoolAndFactory, UsingLinearCurve, UsingEnumerable, UsingERC20 {}
