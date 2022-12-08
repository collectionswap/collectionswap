// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {CollectionPoolETH} from "./CollectionPoolETH.sol";
import {CollectionPoolMissingEnumerable} from "./CollectionPoolMissingEnumerable.sol";
import {ICollectionPoolFactory} from "./ICollectionPoolFactory.sol";

contract CollectionPoolMissingEnumerableETH is
    CollectionPoolMissingEnumerable,
    CollectionPoolETH
{
    function poolVariant()
        public
        pure
        override
        returns (ICollectionPoolFactory.PoolVariant)
    {
        return ICollectionPoolFactory.PoolVariant.MISSING_ENUMERABLE_ETH;
    }
}
