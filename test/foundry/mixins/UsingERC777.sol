// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ERC777} from "@openzeppelin/contracts/token/ERC777/ERC777.sol";
import {IERC777Recipient} from "@openzeppelin/contracts/token/ERC777/IERC777Recipient.sol";
import {ERC1820Implementer} from "@openzeppelin/contracts/utils/introspection/ERC1820Implementer.sol";
import {IERC1820Registry} from "@openzeppelin/contracts/utils/introspection/IERC1820Registry.sol";

import {ERC20} from "solmate/src/tokens/ERC20.sol";
import {SafeTransferLib} from "solmate/src/utils/SafeTransferLib.sol";

import {ICurve} from "../../../contracts/bonding-curves/ICurve.sol";
import {CollectionPool} from "../../../contracts/pools/CollectionPool.sol";
import {CollectionPoolERC20} from "../../../contracts/pools/CollectionPoolERC20.sol";
import {CollectionPoolFactory} from "../../../contracts/pools/CollectionPoolFactory.sol";
import {ICollectionPool} from "../../../contracts/pools/ICollectionPool.sol";
import {ICollectionPoolFactory} from "../../../contracts/pools/ICollectionPoolFactory.sol";

import {UsingERC20} from "./UsingERC20.sol";
import {ERC1820Registry} from "../interfaces/ERC1820Registry.sol";

contract Test777 is ERC777, ERC1820Implementer {
    constructor(address owner) ERC777("Test777", "T777", new address[](0)) {
        _mint(owner, type(uint256).max, "", "");
    }
}

abstract contract UsingERC777 is UsingERC20, IERC777Recipient {
    using SafeTransferLib for ERC20;
    ERC777 test777;

    function tokensReceived(address operator, address from, address to, uint256 amount, bytes memory userData, bytes memory operatorData) public {
    }

    function setupPool(
        CollectionPoolFactory factory,
        IERC721 nft,
        ICurve bondingCurve,
        address payable assetRecipient,
        CollectionPool.PoolType poolType,
        uint128 delta,
        uint24 fee,
        uint128 spotPrice,
        uint256[] memory _idList,
        uint256 initialTokenBalance,
        address routerAddress
    ) public payable override returns (CollectionPool) {
        // create ERC20 token if not already deployed
        if (address(test20) == address(0)) {
            ERC1820Registry.deploy();

            IERC1820Registry _ERC1820_REGISTRY = IERC1820Registry(0x1820a4B7618BdE71Dce8cdc73aAB6C95905faD24);
            // register interfaces
            _ERC1820_REGISTRY.setInterfaceImplementer(address(this), keccak256("ERC777TokensRecipient"), address(this));
            test777 = new Test777(address(this));
            test20 = ERC20(address(test777));
        }

        // set approvals for factory and router
        test20.approve(address(factory), type(uint256).max);

        if (routerAddress != address(0)) {
            test20.approve(routerAddress, type(uint256).max);
        }

        // initialize the pool
        (ICollectionPool pool, ) = factory.createPoolERC20(
            ICollectionPoolFactory.CreateERC20PoolParams(
                test20,
                nft,
                bondingCurve,
                assetRecipient,
                address(this),
                poolType,
                delta,
                fee,
                spotPrice,
                "",
                "",
                0,
                payable(0),
                _idList,
                initialTokenBalance
            )
        );

        // Set approvals for pool
        test20.approve(address(pool), type(uint256).max);

        return CollectionPool(payable(address(pool)));
    }
}
