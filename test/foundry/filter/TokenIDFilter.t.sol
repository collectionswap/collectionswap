// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import "forge-std/Test.sol";
import "murky/Merkle.sol";

import "../../../contracts/mocks/TestTokenIDFilter.sol";

contract TokenIDFilterTest is Test {
    TokenIDFilterMock filter;

    address collection = address(1);
    bytes data = "";

    function setUp() public {
        filter = new TokenIDFilterMock();
    }

    function testDefaultAcceptsAll() public view {
        bytes32[] memory empty;
        assert(filter.acceptsTokenID(uint256(0), empty));
        assert(filter.acceptsTokenID(uint256(42), empty));
    }

    function testFilterOneOfOne() public {
        filter.setTokenIDFilter(collection, hash(hash(1)), data);

        bytes32[] memory empty;
        assert(filter.acceptsTokenID(uint256(1), empty));

        bool[] memory emptyFlags;
        uint256[] memory tokens = new uint256[](1);
        tokens[0] = 1;
        assert(filter.acceptsTokenIDs(tokens, empty, emptyFlags));
    }

    function testFilterTwoIDs() public {
        bytes32 token42Leaf = hash(hash(42));
        bytes32 token88Leaf = hash(hash(88));
        bytes32 root;

        if (token42Leaf < token88Leaf) {
            root = hash(token42Leaf, token88Leaf);
        }
        else {
            root = hash(token88Leaf, token42Leaf);
        }

        filter.setTokenIDFilter(collection, root, data);

        bytes32[] memory proof = new bytes32[](1);

        proof[0] = token88Leaf;
        assert(filter.acceptsTokenID(uint256(42), proof));

        proof[0] = token42Leaf;
        assert(filter.acceptsTokenID(uint256(88), proof));
    }

    function testFilterMulti() public {
        
        filter.setTokenIDFilter(
            collection,
            0xdf8c8da4082b4272cc9b0870e40a116efd467249794a1b9e55467ce9fec4ad08,
            data
            );

        uint256[] memory tokens = new uint256[](3);
        tokens[0] = 0x3;
        tokens[1] = 0x7;
        tokens[2] = 0x1;

        bytes32[] memory proof = new bytes32[](5);
        proof[0] = 0x16db2e4b9f8dc120de98f8491964203ba76de27b27b29c2d25f85a325cd37477;
        proof[1] = 0x668a281d484745d44157979af38718b70c4a5134e7425da0317b44c6df9d1b9a;
        proof[2] = 0xf31ee89b8f3115a2b48750c8c8a2d7a5b875a0ce5d42ff7545f32953db9e4aa3;
        proof[3] = 0xbbebe29bec56748e985affb7fe7b7e43b2ceef5564a57c76da0f2e4a432164c9;
        proof[4] = 0x0339438092d949e6b8b9bbc62d987ceaec79e90f21f92ef91ec8284da86d0972;

        bool[] memory proofFlags = new bool[](7);
        proofFlags[0] = false;
        proofFlags[1] = false;
        proofFlags[2] = false;
        proofFlags[3] = false;
        proofFlags[4] = false;
        proofFlags[5] = true;
        proofFlags[6] = true;

        assert(filter.acceptsTokenIDs(tokens, proof, proofFlags));
    }
}

contract TokenIDFilterHugeTest is Test {
    TokenIDFilterMock filter;

    address collection = address(1);
    bytes data = "";

    function setUp() public {
        filter = new TokenIDFilterMock();
    }

    function useAndTestDistribution(bytes32 seed, uint count, uint256 maxTokenID) public {
        uint256[] memory tokens = new uint256[](count);
        bytes32[] memory leaves = new bytes32[](count);

        for (uint i = 0; i < count; i++) {
            // poor man's random numbers
            seed = hash(seed);

            tokens[i] = uint256(seed) % maxTokenID;
            leaves[i] = hash(hash(tokens[i]));
        }

        Merkle tree = new Merkle();

        filter.setTokenIDFilter(
            collection,
            tree.getRoot(leaves),
            data
            );

        assert(filter.acceptsTokenID(tokens[0], tree.getProof(leaves, 0)));
        assert(filter.acceptsTokenID(tokens[1], tree.getProof(leaves, 1)));
        assert(filter.acceptsTokenID(tokens[count - 2], tree.getProof(leaves, count - 2)));
        assert(filter.acceptsTokenID(tokens[count - 1], tree.getProof(leaves, count - 1)));
    }

    function testPowersOfTwoPlusOne() public {
        useAndTestDistribution(bytes32(uint(0xbeef)), 3, 10000);
        useAndTestDistribution(bytes32(uint(0xabcd)), 9, 10000);
        useAndTestDistribution(bytes32(uint(0x8888)), 65, 10000);
        useAndTestDistribution(bytes32(uint(0xfeed)), 513, 10000);
        useAndTestDistribution(bytes32(uint(0xbead)), 8193, 10000);
    }

    function testPowersOfTwoMinusOne() public {
        useAndTestDistribution(bytes32(uint(0xabcd)), 7, 10000);
        useAndTestDistribution(bytes32(uint(0x8888)), 63, 10000);
        useAndTestDistribution(bytes32(uint(0xfeed)), 511, 10000);
        useAndTestDistribution(bytes32(uint(0xbead)), 8191, 10000);
    }

    function testPowersOfTwo() public {
        useAndTestDistribution(bytes32(uint(0xbeef)), 2, 10000);
        useAndTestDistribution(bytes32(uint(0xabcd)), 8, 10000);
        useAndTestDistribution(bytes32(uint(0x8888)), 64, 10000);
        useAndTestDistribution(bytes32(uint(0xfeed)), 512, 10000);
        useAndTestDistribution(bytes32(uint(0xbead)), 8192, 10000);
    }

    function testMany() public {
        useAndTestDistribution(bytes32(uint(0xbeef)), 5000, 10000);
        useAndTestDistribution(bytes32(uint(0xbeef)), 50000, 100000);

        // insufficient gas for ~million items
        // useAndTestDistribution(bytes32(uint(0xbeef)), 500000, 1000000);
    }
}

contract TokenIDFilterEvents is Test {
    TokenIDFilterMock filter;

    function setUp() public {
        filter = new TokenIDFilterMock();
    }

    function many(bytes32 seed, uint count, uint256 maxTokenID) public {
        uint256[] memory tokens = new uint256[](count);
        bytes32[] memory leaves = new bytes32[](count);

        for (uint i = 0; i < count; i++) {
            // poor man's random numbers
            seed = hash(seed);

            tokens[i] = uint256(seed) % maxTokenID;
            leaves[i] = hash(hash(tokens[i]));
        }

        filter.emitTokenIDs(address(0), abi.encodePacked(uint32(0), tokens));
    }

    function testEmit() public {
        many(bytes32(uint(0)), 50000, 100000);
    }
}

function hash(uint256 data) pure returns (bytes32) {
    return keccak256(abi.encodePacked(data));
}

function hash(bytes32 data) pure returns (bytes32) {
    return keccak256(abi.encodePacked(data));
}

function hash(bytes32 a, bytes32 b) pure returns (bytes32) {
    return keccak256(abi.encodePacked(a, b));
}

function hash(bytes memory data) pure returns (bytes32) {
    return keccak256(data);
}
