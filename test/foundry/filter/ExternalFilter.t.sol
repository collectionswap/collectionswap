// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {Test} from "forge-std/Test.sol";

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";

import {IERC721Mintable} from "../interfaces/IERC721Mintable.sol";
import {Test20} from "../../../contracts/test/mocks/Test20.sol";
import {Test721} from "../../../contracts/test/mocks/Test721.sol";
import {Test721Enumerable} from "../../../contracts/test/mocks/Test721Enumerable.sol";

import {LinearCurve} from "../../../contracts/bonding-curves/LinearCurve.sol";
import {IExternalFilter} from "../../../contracts/filter/IExternalFilter.sol";
import {CollectionPoolCloner} from "../../../contracts/lib/CollectionPoolCloner.sol";
import {CollectionPool} from "../../../contracts/pools/CollectionPool.sol";
import {CollectionPoolEnumerableERC20} from "../../../contracts/pools/CollectionPoolEnumerableERC20.sol";
import {CollectionPoolEnumerableETH} from "../../../contracts/pools/CollectionPoolEnumerableETH.sol";
import {ICollectionPool} from "../../../contracts/pools/ICollectionPool.sol";
import {ICollectionPoolFactory} from "../../../contracts/pools/ICollectionPoolFactory.sol";

abstract contract ExternalFilter is Test, IExternalFilter, ERC165, ERC721Holder {
    CollectionPool pool;
    Factory factory; // actually a mock
    IERC721Mintable collection;
    bool allTokensAllowed;

    event ExternalFilterSet(address indexed collection, address indexed filterAddress);

    function setUp() public {
        setupCollectionPool();

        // LP token
        factory.mint(address(this), uint256(uint160(address(pool))));

        // skip a block
        vm.roll(block.number + 1);

        collection.mint(address(this), 1);
        collection.mint(address(this), 3);
        collection.mint(address(this), 7);

        collection.setApprovalForAll(address(pool), true);
    }

    // Precalculated merkle root of superset of, and multi-proof of, [1, 3, 7]
    function merkle() public pure returns (bytes32 root, uint256[] memory ids, bytes32[] memory proof, bool[] memory proofFlags) {
        root = 0xdf8c8da4082b4272cc9b0870e40a116efd467249794a1b9e55467ce9fec4ad08;

        ids = new uint256[](3);
        ids[0] = 0x3;
        ids[1] = 0x7;
        ids[2] = 0x1;

        proof = new bytes32[](5);
        proof[0] = 0x16db2e4b9f8dc120de98f8491964203ba76de27b27b29c2d25f85a325cd37477;
        proof[1] = 0x668a281d484745d44157979af38718b70c4a5134e7425da0317b44c6df9d1b9a;
        proof[2] = 0xf31ee89b8f3115a2b48750c8c8a2d7a5b875a0ce5d42ff7545f32953db9e4aa3;
        proof[3] = 0xbbebe29bec56748e985affb7fe7b7e43b2ceef5564a57c76da0f2e4a432164c9;
        proof[4] = 0x0339438092d949e6b8b9bbc62d987ceaec79e90f21f92ef91ec8284da86d0972;

        proofFlags = new bool[](7);
        proofFlags[0] = false;
        proofFlags[1] = false;
        proofFlags[2] = false;
        proofFlags[3] = false;
        proofFlags[4] = false;
        proofFlags[5] = true;
        proofFlags[6] = true;
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override(IERC165, ERC165) returns (bool) {
        return super.supportsInterface(interfaceId) || interfaceId == type(IExternalFilter).interfaceId;
    }

    function areNFTsAllowed(address, uint256[] calldata, bytes calldata) external view returns (bool allowed) {
        return allTokensAllowed;
    }

    function testNoExternalFilter() public {
        (bytes32 root, uint256[] memory ids, bytes32[] memory proof, bool[] memory proofFlags) = merkle();

        pool.setTokenIDFilter(root, "");

        ICollectionPool.NFTs memory nfts = ICollectionPool.NFTs(ids, proof, proofFlags);

        pool.swapNFTsForToken(nfts, 0, payable(address(this)), false, address(0), new bytes(0));
    }

    function testInvalidExternalFilter() public {
        // not contract address
        vm.expectRevert(CollectionPool.InvalidExternalFilter.selector);
        pool.setExternalFilter(address(1));

        // not IERC165
        address empty = address(new Empty());
        vm.expectRevert(CollectionPool.InvalidExternalFilter.selector);
        pool.setExternalFilter(empty);

        // fake IERC165
        address erc165 = address(new ERC165Fake());
        vm.expectRevert(CollectionPool.InvalidExternalFilter.selector);
        pool.setExternalFilter(erc165);

        // not IExternalFilter
        erc165 = address(new ERC165Mock());
        vm.expectRevert(CollectionPool.InvalidExternalFilter.selector);
        pool.setExternalFilter(erc165);
    }

    function testExternalFilterEvents() public {
        // valid external filter
        vm.expectEmit(true, true, false, false);
        emit ExternalFilterSet(address(collection), address(this));
        pool.setExternalFilter(address(this));

        // reset external filter
        vm.expectEmit(true, true, false, false);
        emit ExternalFilterSet(address(collection), address(0));
        pool.setExternalFilter(address(0));
    }

    function testExternalFilterAllowed() public {
        (bytes32 root, uint256[] memory ids, bytes32[] memory proof, bool[] memory proofFlags) = merkle();

        pool.setTokenIDFilter(root, "");
        pool.setExternalFilter(address(this));
        allTokensAllowed = true;

        ICollectionPool.NFTs memory nfts = ICollectionPool.NFTs(ids, proof, proofFlags);

        pool.swapNFTsForToken(nfts, 0, payable(address(this)), false, address(0), new bytes(0));
    }

    function testNoExternalFilterBlocked() public {
        (bytes32 root, uint256[] memory ids, bytes32[] memory proof, bool[] memory proofFlags) = merkle();

        pool.setTokenIDFilter(root, "");
        pool.setExternalFilter(address(this));
        allTokensAllowed = false;

        ICollectionPool.NFTs memory nfts = ICollectionPool.NFTs(ids, proof, proofFlags);

        vm.expectRevert(CollectionPool.NFTsNotAllowed.selector);
        pool.swapNFTsForToken(nfts, 0, payable(address(this)), false, address(0), new bytes(0));
    }

    function testExternalFilterReset() public {
        (bytes32 root, uint256[] memory ids, bytes32[] memory proof, bool[] memory proofFlags) = merkle();

        pool.setTokenIDFilter(root, "");
        pool.setExternalFilter(address(this));
        allTokensAllowed = false;

        ICollectionPool.NFTs memory nfts = ICollectionPool.NFTs(ids, proof, proofFlags);

        vm.expectRevert(CollectionPool.NFTsNotAllowed.selector);
        pool.swapNFTsForToken(nfts, 0, payable(address(this)), false, address(0), new bytes(0));

        pool.setExternalFilter(address(0));
        pool.swapNFTsForToken(nfts, 0, payable(address(this)), false, address(0), new bytes(0));
    }

    function testACL() public {
        vm.prank(address(0));
        vm.expectRevert(CollectionPool.NotAuthorized.selector);
        pool.setExternalFilter(address(this));

        // factory allowed
        vm.prank(address(factory));
        pool.setExternalFilter(address(this));
        pool.setExternalFilter(address(0));

        // LP owner allowed
        pool.setExternalFilter(address(this));
        pool.setExternalFilter(address(0));
    }

    function setupCollectionPool() public virtual {}
}

contract ExternalFilterEnumerableERC20 is ExternalFilter {
    function setupCollectionPool() public override{
        collection = IERC721Mintable(address(new Test721Enumerable()));
        factory = new Factory();
        pool = CollectionPool(CollectionPoolCloner.cloneERC20Pool(
            address(new CollectionPoolEnumerableERC20()),
            ICollectionPoolFactory(address(factory)),
            new LinearCurve(),
            collection,
            0,
            new Test20()
        ));
    }
}

contract ExternalFilterEnumerableETH is ExternalFilter {
    function setupCollectionPool() public override {
        collection = IERC721Mintable(address(new Test721Enumerable()));
        factory = new Factory();
        pool = CollectionPool(CollectionPoolCloner.cloneETHPool(
            address(new CollectionPoolEnumerableETH()),
            ICollectionPoolFactory(address(factory)),
            new LinearCurve(),
            collection,
            0
        ));
    }
}

contract Empty {}

contract ERC165Fake is IERC165 {
    /// @dev By right, this should accept type(IERC165).interfaceId
    function supportsInterface(bytes4) external pure returns (bool) {
        return false;
    }
}

contract ERC165Mock is IERC165 {
    /// @dev By right, this should accept 
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return type(IERC165).interfaceId == interfaceId;
    }
}

contract Factory is Test721 {
    // pretend to be a factory
    uint24 public constant protocolFeeMultiplier = 0.003e6;
    bool public constant swapPaused = false;
}
