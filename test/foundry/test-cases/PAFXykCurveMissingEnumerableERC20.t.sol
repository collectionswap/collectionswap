// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import {PoolAndFactory} from "../base/PoolAndFactory.sol";
import {UsingXykCurve} from "../mixins/UsingXykCurve.sol";
import {UsingMissingEnumerable} from "../mixins/UsingMissingEnumerable.sol";
import {UsingERC20} from "../mixins/UsingERC20.sol";

contract PAFXykCurveMissingEnumerableERC20Test is
    PoolAndFactory,
    UsingXykCurve,
    UsingMissingEnumerable,
    UsingERC20
{}
