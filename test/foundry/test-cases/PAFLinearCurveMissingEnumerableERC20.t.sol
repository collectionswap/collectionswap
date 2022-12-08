// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import {PoolAndFactory} from "../base/PoolAndFactory.sol";
import {UsingLinearCurve} from "../mixins/UsingLinearCurve.sol";
import {UsingMissingEnumerable} from "../mixins/UsingMissingEnumerable.sol";
import {UsingERC20} from "../mixins/UsingERC20.sol";

contract PAFLinearCurveMissingEnumerableERC20Test is
    PoolAndFactory,
    UsingLinearCurve,
    UsingMissingEnumerable,
    UsingERC20
{}
