// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import {PoolAndFactory} from "../base/PoolAndFactory.sol";
import {UsingXykCurve} from "../mixins/UsingXykCurve.sol";
import {UsingEnumerable} from "../mixins/UsingEnumerable.sol";
import {UsingETH} from "../mixins/UsingETH.sol";

contract PAFXykCurveEnumerableETHTest is PoolAndFactory, UsingXykCurve, UsingEnumerable, UsingETH {}
