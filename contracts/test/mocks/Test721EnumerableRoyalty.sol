// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Test721Enumerable} from "./Test721Enumerable.sol";
import {Test721Royalty} from "./Test721Royalty.sol";

contract Test721EnumerableRoyalty is Test721Enumerable, Test721Royalty {
    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override (Test721Enumerable, Test721Royalty)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function _beforeTokenTransfer(address from, address to, uint256 tokenId)
        internal
        override (ERC721, Test721Enumerable)
    {
        super._beforeTokenTransfer(from, to, tokenId);
    }
}
