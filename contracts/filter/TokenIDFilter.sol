// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ITokenIDFilter} from "./ITokenIDFilter.sol";

contract TokenIDFilter is ITokenIDFilter {
    event AcceptsTokenIDs(address indexed _collection, bytes32 indexed _root, bytes _data);

    // Merkle root
    bytes32 public tokenIDFilterRoot;

    uint32[999] _padding;

    function _setRootAndEmitAcceptedIDs(address collection, bytes32 root, bytes calldata data) internal {
        tokenIDFilterRoot = root;
        emit AcceptsTokenIDs(collection, tokenIDFilterRoot, data);
    }

    function _acceptsTokenID(uint256 tokenID, bytes32[] calldata proof) internal view returns (bool) {
        if (tokenIDFilterRoot == 0) {
            return true;
        }

        // double hash to prevent second preimage attack
        bytes32 leaf = keccak256(abi.encodePacked(keccak256(abi.encodePacked((tokenID)))));

        return MerkleProof.verifyCalldata(proof, tokenIDFilterRoot, leaf);
    }

    function _emitTokenIDs(address collection, bytes calldata data) internal {
        emit AcceptsTokenIDs(collection, tokenIDFilterRoot, data);
    }

    function _acceptsTokenIDs(bytes32[] calldata proof, bool[] calldata proofFlags, bytes32[] calldata leaves)
        internal
        view
        returns (bool)
    {
        if (tokenIDFilterRoot == 0) {
            return true;
        }

        uint256 length = leaves.length;
        bytes32[] memory hashedLeaves = new bytes32[](length);

        for (uint256 i; i < length;) {
            // double hash to prevent second preimage attack
            hashedLeaves[i] = keccak256(abi.encodePacked(keccak256(abi.encodePacked((leaves[i])))));
            unchecked {
                ++i;
            }
        }

        return MerkleProof.multiProofVerify(proof, proofFlags, tokenIDFilterRoot, hashedLeaves);
    }
}
