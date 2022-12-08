// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {LSSVMPairERC20} from "./LSSVMPairERC20.sol";
import {LSSVMPairMissingEnumerable} from "./LSSVMPairMissingEnumerable.sol";
import {ILSSVMPairFactory} from "./ILSSVMPairFactory.sol";

contract LSSVMPairMissingEnumerableERC20 is
    LSSVMPairMissingEnumerable,
    LSSVMPairERC20
{
    function pairVariant()
        public
        pure
        override
        returns (ILSSVMPairFactory.PairVariant)
    {
        return ILSSVMPairFactory.PairVariant.MISSING_ENUMERABLE_ERC20;
    }
}
