// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

contract TokenIDFilter {
    event AcceptsTokenIDs(address indexed _collection, bytes32 indexed _root, bytes _data);

    // Merkle root
    bytes32 public tokenIDFilterRoot;

    uint32[999] _padding;

    function _setTokenIDFilterRoot(bytes32 root) internal {
        tokenIDFilterRoot = root;
    }

    function _emitTokenIDs(address collection, bytes calldata data) internal {
        emit AcceptsTokenIDs(collection, tokenIDFilterRoot, data);
    }

    function _acceptsTokenID(uint256 tokenID, bytes32[] calldata proof)
    internal view returns (bool)
    {
        if (tokenIDFilterRoot == 0) {
            return true;
        }

        // double hash to prevent second preimage attack
        bytes32 leaf = keccak256(abi.encodePacked(keccak256(abi.encodePacked((tokenID)))));

        return MerkleProof.verifyCalldata(proof, tokenIDFilterRoot, leaf);
    }

    function _acceptsTokenIDs(uint256[] calldata tokenIDs, bytes32[] calldata proof, bool[] calldata proofFlags)
    internal view returns (bool)
    {
        if (tokenIDFilterRoot == 0) {
            return true;
        }

        uint length = tokenIDs.length;
        bytes32[] memory leaves = new bytes32[](length);

        for (uint i; i < length;) {
            // double hash to prevent second preimage attack
            leaves[i] = keccak256(abi.encodePacked(keccak256(abi.encodePacked((tokenIDs[i])))));
            unchecked { ++i; }
        }

        return MerkleProof.multiProofVerify(proof, proofFlags, tokenIDFilterRoot, leaves);
    }
}
