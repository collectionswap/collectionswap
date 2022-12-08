// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {CollectionPoolERC20} from "./CollectionPoolERC20.sol";
import {CollectionPoolEnumerable} from "./CollectionPoolEnumerable.sol";
import {ICollectionPoolFactory} from "./ICollectionPoolFactory.sol";

/**
    @title An NFT/Token pool where the NFT implements ERC721Enumerable, and the token is an ERC20
    @author Collection
 */
contract CollectionPoolEnumerableERC20 is CollectionPoolEnumerable, CollectionPoolERC20 {
    /**
        @notice Returns the CollectionPool type
     */
    function poolVariant()
        public
        pure
        override
        returns (ICollectionPoolFactory.PoolVariant)
    {
        return ICollectionPoolFactory.PoolVariant.ENUMERABLE_ERC20;
    }
}
