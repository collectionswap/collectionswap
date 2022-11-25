// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";

contract Test721Enumerable is ERC721Enumerable, IERC2981 {
    mapping(uint256 => address payable) royaltyRecipients;

    constructor() ERC721("Test721", "T721") {}

    function mint(address to, uint256 id) public {
        _mint(to, id);
    }

    function royaltyInfo(uint256 tokenId, uint256) external view returns (
        address receiver, 
        uint256 royaltyAmount
    ) {
        return (royaltyRecipients[tokenId], 0);
    }

    function setRoyaltyRecipient(
        uint256 tokenId, 
        address payable recipient
    ) external {
        royaltyRecipients[tokenId] = recipient;
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721Enumerable, IERC165) returns (bool) {
        return interfaceId == 0x2a55205a || super.supportsInterface(interfaceId);
    }
}
