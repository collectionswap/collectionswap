// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {LSSVMPairETH} from "./LSSVMPairETH.sol";
import {LSSVMPairEnumerable} from "./LSSVMPairEnumerable.sol";
import {ILSSVMPairFactory} from "./ILSSVMPairFactory.sol";

/**
    @title An NFT/Token pair where the NFT implements ERC721Enumerable, and the token is ETH
    @author boredGenius and 0xmons
 */
contract LSSVMPairEnumerableETH is LSSVMPairEnumerable, LSSVMPairETH {
    /**
        @notice Returns the LSSVMPair type
     */
    function pairVariant()
        public
        pure
        override
        returns (ILSSVMPairFactory.PairVariant)
    {
        return ILSSVMPairFactory.PairVariant.ENUMERABLE_ETH;
    }
}
