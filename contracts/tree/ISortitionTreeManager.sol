// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {SortitionSumTreeFactory} from "../lib/SortitionSumTreeFactory.sol";

interface ISortitionTreeManager {
    function createTree(bytes32 _key, uint256 _K) external;

    function set(bytes32 _key, uint256 _value, bytes32 _ID) external;

    function queryLeafs(bytes32 _key, uint256 _cursor, uint256 _count)
        external
        view
        returns (uint256 startIndex, uint256[] memory values, bool hasMore);

    function draw(bytes32 _key, uint256 _drawnNumber) external view returns (bytes32 ID);

    function stakeOf(bytes32 _key, bytes32 _ID) external view returns (uint256 value);

    function total(bytes32 _key) external view returns (uint256);
}
