// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IERC165} from "@openzeppelin/contracts/interfaces/IERC165.sol";
import {IPoolActivityMonitor} from "./IPoolActivityMonitor.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {EventType} from "./CollectionStructsAndEnums.sol";

abstract contract PoolActivityMonitor is ERC165, IPoolActivityMonitor, IERC721Receiver {
    /**
     * @dev See {IERC165-supportsInterface}.
     */
    function supportsInterface(bytes4 interfaceId) public view virtual override (ERC165, IERC165) returns (bool) {
        return interfaceId == type(IPoolActivityMonitor).interfaceId || super.supportsInterface(interfaceId);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    /// @inheritdoc IPoolActivityMonitor
    function onBalancesChanged(address poolAddress, EventType eventType, uint256[] memory amounts) external virtual {}
}
