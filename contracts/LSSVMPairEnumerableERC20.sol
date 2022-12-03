// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {LSSVMPairERC20} from "./LSSVMPairERC20.sol";
import {LSSVMPairEnumerable} from "./LSSVMPairEnumerable.sol";
import {ILSSVMPairFactory} from "./ILSSVMPairFactory.sol";

/**
    @title An NFT/Token pair where the NFT implements ERC721Enumerable, and the token is an ERC20
    @author Collection
 */
contract LSSVMPairEnumerableERC20 is LSSVMPairEnumerable, LSSVMPairERC20 {
    /**
        @notice Returns the LSSVMPair type
     */
    function pairVariant()
        public
        pure
        override
        returns (ILSSVMPairFactory.PairVariant)
    {
        return ILSSVMPairFactory.PairVariant.ENUMERABLE_ERC20;
    }
}
