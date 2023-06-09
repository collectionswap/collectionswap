// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {Test721} from "./Test721.sol";

contract Test721Enumerable is Test721, ERC721Enumerable {
    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override (IERC165, ERC721, ERC721Enumerable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function _beforeTokenTransfer(address from, address to, uint256 tokenId)
        internal
        virtual
        override (ERC721, ERC721Enumerable)
    {
        super._beforeTokenTransfer(from, to, tokenId);
    }
}
