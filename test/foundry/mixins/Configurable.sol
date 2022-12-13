// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {CollectionPool} from "../../../contracts/pools/CollectionPool.sol";
import {ICurve} from "../../../contracts/bonding-curves/ICurve.sol";
import {IERC721Mintable} from "../interfaces/IERC721Mintable.sol";
import {CollectionPoolFactory} from "../../../contracts/pools/CollectionPoolFactory.sol";

abstract contract Configurable {
    function getBalance(address a) public virtual returns (uint256);

    function setupPool(
        CollectionPoolFactory factory,
        IERC721 nft,
        ICurve bondingCurve,
        address payable assetRecipient,
        CollectionPool.PoolType poolType,
        uint128 delta,
        uint96 fee,
        uint128 spotPrice,
        uint256[] memory _idList,
        uint256 initialTokenBalance,
        address routerAddress /* Yes, this is weird, but due to how we encapsulate state for a Pool's ERC20 token, this is an easy way to set approval for the router.*/
    ) public payable virtual returns (CollectionPool);

    function setupCurve() public virtual returns (ICurve);

    function setup721() public virtual returns (IERC721Mintable);

    function modifyInputAmount(uint256 inputAmount)
        public
        virtual
        returns (uint256);

    function modifyDelta(uint64 delta) public virtual returns (uint64);

    function modifySpotPrice(uint56 spotPrice) public virtual returns (uint56);

    function sendTokens(CollectionPool pool, uint256 amount) public virtual;

    function withdrawTokens(CollectionPool pool) public virtual;

    function withdrawProtocolFees(CollectionPoolFactory factory) public virtual;

    function getParamsForPartialFillTest()
        public
        virtual
        returns (uint128 spotPrice, uint128 delta);

    receive() external payable {}
}
