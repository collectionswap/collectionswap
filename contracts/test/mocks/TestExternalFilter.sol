// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import {IExternalFilter} from "../../filter/IExternalFilter.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

contract TestExternalFilter is IExternalFilter, ERC165 {
    struct NFT {
        address contractAddress;
        uint256 tokenId;
    }

    mapping(address => mapping(uint256 => bool)) nftIsBanned;

    constructor(NFT[] memory bannedNFTs) {
        uint256 length = bannedNFTs.length;
        for (uint256 i = 0; i < length;) {
            NFT memory nft = bannedNFTs[i];
            nftIsBanned[nft.contractAddress][nft.tokenId] = true;

            unchecked {
                ++i;
            }
        }
    }

    function areNFTsAllowed(address collection, uint256[] calldata nftIds) external view returns (bool allowed) {
        uint256 length = nftIds.length;
        for (uint256 i = 0; i < length;) {
            if (nftIsBanned[collection][nftIds[i]]) return false;

            unchecked {
                ++i;
            }
        }

        return true;
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override (ERC165, IERC165) returns (bool) {
        return super.supportsInterface(interfaceId) || interfaceId == type(IExternalFilter).interfaceId;
    }
}
