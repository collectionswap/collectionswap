// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {ERC1155PresetMinterPauser} from "@openzeppelin/contracts/token/ERC1155/presets/ERC1155PresetMinterPauser.sol";
import {IERC721Mintable} from "../interfaces/IERC721Mintable.sol";
import {Configurable} from "./Configurable.sol";

abstract contract UsingSemiFungible is Configurable {
    function setup721() public override returns (IERC721Mintable) {
        return IERC721Mintable(address(new SemiFungible()));
    }
}

/**
 * @dev Implements just enough ERC721 for an ERC1155 contract so that it works with our
 * CollectionPool. Note that there is absolutely no good reason to do this in practice.
 */
contract SemiFungible is ERC1155PresetMinterPauser {
    mapping(address => mapping(uint256 => bool)) knownIDsMap;
    mapping(address => uint256[]) knownIDsList;
    mapping(uint256 => address) lastOwner;

    constructor() ERC1155PresetMinterPauser("") {}

    function mint(address to, uint256 id) external {
        _mint(to, id, 1, "");

        if (!knownIDsMap[to][id]) {
            knownIDsMap[to][id] = true;
            knownIDsList[to].push(id);
        }

        lastOwner[id] = to;
    }

    function safeTransferFrom(address from, address to, uint256 id) public {
        _safeTransferFrom(from, to, id, 1, "");

        if (!knownIDsMap[to][id]) {
            knownIDsMap[to][id] = true;
            knownIDsList[to].push(id);
        }

        lastOwner[id] = to;
    }

    function balanceOf(address account) public view returns (uint256 balance) {
        uint256 length = knownIDsList[account].length;

        for (uint256 i = 0; i < length; i++) {
            balance += balanceOf(account, knownIDsList[account][i]);
        }
    }

    function ownerOf(uint256 id) public view returns (address) {
        return lastOwner[id];
    }
}
