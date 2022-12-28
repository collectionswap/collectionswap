// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import "../../filter/TokenIDFilter.sol";

contract TokenIDFilterMock is TokenIDFilter {
    function setTokenIDFilter(address collection, bytes32 _merkleRoot, bytes calldata data) public {
        _setRootAndEmitAcceptedIDs(collection, _merkleRoot, data);
    }

    function emitTokenIDs(address collection, bytes calldata data) public {
        _emitTokenIDs(collection, data);
    }

    function acceptsTokenID(uint256 tokenID, bytes32[] calldata proof) public view returns (bool) {
        return _acceptsTokenID(tokenID, proof);
    }

    function acceptsTokenIDs(uint256[] calldata tokenIDs, bytes32[] calldata proof, bool[] calldata proofFlags)
        public
        view
        returns (bool)
    {
        return _acceptsTokenIDs(tokenIDs, proof, proofFlags);
    }
}
