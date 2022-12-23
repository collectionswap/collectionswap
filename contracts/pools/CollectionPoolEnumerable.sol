// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {IERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/IERC721Enumerable.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {TransferLib} from "../lib/TransferLib.sol";
import {CollectionRouter} from "../routers/CollectionRouter.sol";
import {ICollectionPool} from "./ICollectionPool.sol";
import {CollectionPool} from "./CollectionPool.sol";
import {ICollectionPoolFactory} from "./ICollectionPoolFactory.sol";

/**
 * @title An NFT/Token pool for an NFT that implements ERC721Enumerable
 * @author Collection
 */
abstract contract CollectionPoolEnumerable is CollectionPool {
    /// @inheritdoc CollectionPool
    function _selectArbitraryNFTs(IERC721 _nft, uint256 numNFTs)
        internal
        view
        override
        returns (uint256[] memory tokenIds)
    {
        tokenIds = new uint256[](numNFTs);
        // (we know NFT implements IERC721Enumerable so we just iterate)
        uint256 lastIndex = _nft.balanceOf(address(this)) - 1;
        for (uint256 i = 0; i < numNFTs;) {
            uint256 nftId = IERC721Enumerable(address(_nft)).tokenOfOwnerByIndex(address(this), lastIndex);
            tokenIds[i] = nftId;

            unchecked {
                --lastIndex;
                ++i;
            }
        }
    }

    /// @inheritdoc CollectionPool
    function _sendSpecificNFTsToRecipient(IERC721 _nft, address nftRecipient, uint256[] memory nftIds)
        internal
        override
    {
        // Send NFTs to recipient
        TransferLib.bulkSafeTransferERC721FromMemory(_nft, address(this), nftRecipient, nftIds);
    }

    /// @inheritdoc CollectionPool
    function getAllHeldIds() external view override returns (uint256[] memory) {
        IERC721 _nft = nft();
        uint256 numNFTs = _nft.balanceOf(address(this));
        uint256[] memory ids = new uint256[](numNFTs);
        for (uint256 i; i < numNFTs;) {
            ids[i] = IERC721Enumerable(address(_nft)).tokenOfOwnerByIndex(address(this), i);

            unchecked {
                ++i;
            }
        }
        return ids;
    }

    function onERC721Received(address, address, uint256, bytes memory) public virtual returns (bytes4) {
        return this.onERC721Received.selector;
    }

    /// @inheritdoc ICollectionPool
    function withdrawERC721(IERC721 a, uint256[] calldata nftIds) external override onlyAuthorized {
        TransferLib.bulkSafeTransferERC721From(a, address(this), owner(), nftIds);

        emit NFTWithdrawal();
    }
}
