// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Test721} from "./Test721.sol";

contract Test721Royalty is Test721, ERC2981 {
    function setTokenRoyalty(uint256 tokenId, address receiver) public {
        _setTokenRoyalty(tokenId, receiver, 0);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override (IERC165, ERC721, ERC2981)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
