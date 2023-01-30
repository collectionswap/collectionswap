// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {IPoolActivityMonitor} from "../../pools/IPoolActivityMonitor.sol";
import {PoolActivityMonitor} from "../../pools/PoolActivityMonitor.sol";

contract TestPoolActivityMonitor is PoolActivityMonitor {
    event BoughtFromPool(address poolAddress, uint256 numNFTs, uint256 lastSwapPrice, uint256 swapValue);
    event SoldToPool(address poolAddress, uint256 numNFTs, uint256 lastSwapPrice, uint256 swapValue);
    event DepositToken(address poolAddress, uint256 amount);
    event DepositNFT(address poolAddress, uint256 amount);
    event WithdrawToken(address poolAddress, uint256 amount);
    event WithdrawNFT(address poolAddress, uint256 amount);

    constructor() {}

    function onBalancesChanged(address poolAddress, EventType eventType, uint256[] calldata amounts)
        external
        override
    {
        if (eventType == IPoolActivityMonitor.EventType.BOUGHT_NFT_FROM_POOL) {
            emit BoughtFromPool(poolAddress, amounts[0], amounts[1], amounts[2]);
        } else if (eventType == IPoolActivityMonitor.EventType.SOLD_NFT_TO_POOL) {
            emit SoldToPool(poolAddress, amounts[0], amounts[1], amounts[2]);
        } else if (eventType == IPoolActivityMonitor.EventType.DEPOSIT_TOKEN) {
            emit DepositToken(poolAddress, amounts[0]);
        } else if (eventType == IPoolActivityMonitor.EventType.DEPOSIT_NFT) {
            emit DepositNFT(poolAddress, amounts[0]);
        }
    }
}
