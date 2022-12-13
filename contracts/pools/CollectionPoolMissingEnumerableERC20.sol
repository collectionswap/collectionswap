// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {CollectionPoolERC20} from "../pools/CollectionPoolERC20.sol";
import {CollectionPoolMissingEnumerable} from "./CollectionPoolMissingEnumerable.sol";
import {ICollectionPoolFactory} from "./ICollectionPoolFactory.sol";

contract CollectionPoolMissingEnumerableERC20 is CollectionPoolMissingEnumerable, CollectionPoolERC20 {
    function poolVariant() public pure override returns (ICollectionPoolFactory.PoolVariant) {
        return ICollectionPoolFactory.PoolVariant.MISSING_ENUMERABLE_ERC20;
    }
}
