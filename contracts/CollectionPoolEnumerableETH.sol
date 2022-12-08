// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {CollectionPoolETH} from "./CollectionPoolETH.sol";
import {CollectionPoolEnumerable} from "./CollectionPoolEnumerable.sol";
import {ICollectionPoolFactory} from "./ICollectionPoolFactory.sol";

/**
    @title An NFT/Token pool where the NFT implements ERC721Enumerable, and the token is ETH
    @author Collection
 */
contract CollectionPoolEnumerableETH is CollectionPoolEnumerable, CollectionPoolETH {
    /**
        @notice Returns the CollectionPool type
     */
    function poolVariant()
        public
        pure
        override
        returns (ICollectionPoolFactory.PoolVariant)
    {
        return ICollectionPoolFactory.PoolVariant.ENUMERABLE_ETH;
    }
}
