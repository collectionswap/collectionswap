// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ERC777} from "@openzeppelin/contracts/token/ERC777/ERC777.sol";
import {IERC777Recipient} from "@openzeppelin/contracts/token/ERC777/IERC777Recipient.sol";
import {IERC1820Registry} from "@openzeppelin/contracts/utils/introspection/IERC1820Registry.sol";

import {ERC20} from "solmate/src/tokens/ERC20.sol";
import {SafeTransferLib} from "solmate/src/utils/SafeTransferLib.sol";

import {ICurve} from "../../../contracts/bonding-curves/ICurve.sol";
import {CollectionPoolERC20} from "../../../contracts/pools/CollectionPoolERC20.sol";
import {CollectionPoolEnumerableETH} from "../../../contracts/pools/CollectionPoolEnumerableETH.sol";
import {CollectionPoolMissingEnumerableETH} from "../../../contracts/pools/CollectionPoolMissingEnumerableETH.sol";
import {CollectionPoolEnumerableERC20} from "../../../contracts/pools/CollectionPoolEnumerableERC20.sol";
import {CollectionPoolMissingEnumerableERC20} from "../../../contracts/pools/CollectionPoolMissingEnumerableERC20.sol";
import {CollectionPoolFactory} from "../../../contracts/pools/CollectionPoolFactory.sol";
import {ICollectionPool} from "../../../contracts/pools/ICollectionPool.sol";
import {ICollectionPoolFactory} from "../../../contracts/pools/ICollectionPoolFactory.sol";
import {Test721Enumerable} from "../../../contracts/test/mocks/Test721Enumerable.sol";

import {UsingERC20} from "../mixins/UsingERC20.sol";
import {ERC1820Registry} from "../interfaces/ERC1820Registry.sol";

import {Test} from "forge-std/Test.sol";

import "forge-std/Vm.sol";

contract Test777 is ERC777{
    constructor(address owner) ERC777("Test777", "T777", new address[](0)) {
        _mint(owner, type(uint256).max, "", "");
    }
}

contract RejectERC777 is Test, IERC777Recipient {
    using SafeTransferLib for ERC20;

    IERC1820Registry _ERC1820_REGISTRY = IERC1820Registry(0x1820a4B7618BdE71Dce8cdc73aAB6C95905faD24);

    address payable constant feeRecipient = payable(address(69));
    uint24 constant protocolFeeMultiplier = 0.003e6;
    uint24 constant carryFeeMultiplier = 0.003e6;

    ERC20 test20;
    IERC721 test721;
    ERC777 test777;
    ICurve bondingCurve;
    CollectionPoolFactory factory;

    uint128 delta = 1.1 ether;
    uint128 spotPrice = 1 ether;

    function tokensReceived(address operator, address from, address to, uint256 amount, bytes memory userData, bytes memory operatorData) public {
    }

    function setUp() public {
        ERC1820Registry.deploy();

        CollectionPoolEnumerableETH enumerableETHTemplate = new CollectionPoolEnumerableETH();
        CollectionPoolMissingEnumerableETH missingEnumerableETHTemplate = new CollectionPoolMissingEnumerableETH();
        CollectionPoolEnumerableERC20 enumerableERC20Template = new CollectionPoolEnumerableERC20();
        CollectionPoolMissingEnumerableERC20 missingEnumerableERC20Template = new CollectionPoolMissingEnumerableERC20();
        factory = new CollectionPoolFactory(
            enumerableETHTemplate,
            missingEnumerableETHTemplate,
            enumerableERC20Template,
            missingEnumerableERC20Template,
            feeRecipient,
            protocolFeeMultiplier,
            carryFeeMultiplier
        );

        // register interfaces
        _ERC1820_REGISTRY.setInterfaceImplementer(address(this), keccak256("ERC777TokensRecipient"), address(this));
        test777 = new Test777(address(this));
        test20 = ERC20(address(test777));

        test721 = IERC721(new Test721Enumerable());
    }

    function test_reject777() public {
        vm.expectRevert('ERC777 not supported');

        // initialize the pool
        factory.createPoolERC20(
            ICollectionPoolFactory.CreateERC20PoolParams(
                test20,
                test721,
                ICurve(address(0)),//bondingCurve,
                payable(0),
                address(this),
                ICollectionPool.PoolType.TRADE,
                delta,
                0,
                spotPrice,
                "",
                "",
                0,
                payable(0),
                new uint256[](0),
                42
            )
        );
    }
}
