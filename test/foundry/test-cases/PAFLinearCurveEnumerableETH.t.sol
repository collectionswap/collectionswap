// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import {PoolAndFactory} from "../base/PoolAndFactory.sol";
import {UsingLinearCurve} from "../mixins/UsingLinearCurve.sol";
import {UsingEnumerable} from "../mixins/UsingEnumerable.sol";
import {UsingETH} from "../mixins/UsingETH.sol";

contract PAFLinearCurveEnumerableETHTest is
    PoolAndFactory,
    UsingLinearCurve,
    UsingEnumerable,
    UsingETH
{}
