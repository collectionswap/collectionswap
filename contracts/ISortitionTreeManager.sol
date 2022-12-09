// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {SortitionSumTreeFactory} from "./lib/SortitionSumTreeFactory.sol";
import "hardhat/console.sol";

interface ISortitionTreeManager {
    function createTree(bytes32 _key, uint _K) external;

    function set(bytes32 _key, uint _value, bytes32 _ID) external;

    function queryLeafs(
        bytes32 _key,
        uint _cursor,
        uint _count
    ) external view returns(uint startIndex, uint[] memory values, bool hasMore);

    function draw(bytes32 _key, uint _drawnNumber) external view returns(bytes32 ID);

    function stakeOf(bytes32 _key, bytes32 _ID) external view returns(uint value);

    function total(bytes32 _key) external view returns (uint);
}