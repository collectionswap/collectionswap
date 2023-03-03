// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/*
  If we ever want to support ERC777:
  1. uncomment PoolAndFactory lines,
  2. remove check in factory, and
  3. fix balanceOf checks in CollectionPoolERC20 that don't account for
     ERC777Recipient using tokensReceived() to move tokens.
*/

import {PoolAndFactory} from "../base/PoolAndFactory.sol";
import {UsingExponentialCurve} from "../mixins/UsingExponentialCurve.sol";
import {UsingEnumerable} from "../mixins/UsingEnumerable.sol";
import {UsingERC777} from "../mixins/UsingERC777.sol";

contract PAFExponentialCurveEnumerableERC20Test is
    // PoolAndFactory,
    UsingExponentialCurve,
    UsingEnumerable,
    UsingERC777
{}
