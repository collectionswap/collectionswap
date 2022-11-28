// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ICurve} from "./bonding-curves/ICurve.sol";
import {ILSSVMPair, ILSSVMPairETH} from "./ILSSVMPair.sol";

interface ILSSVMPairFactory {
    struct CreateETHPairParams {
        IERC721 nft;
        ICurve bondingCurve;
        address payable assetRecipient;
        ILSSVMPair.PoolType poolType;
        uint128 delta;
        uint96 fee;
        uint128 spotPrice;
        bytes props;
        bytes state;
        uint256 royaltyNumerator;
        uint256[] initialNFTIDs;
    }

    function createPairETH(
        CreateETHPairParams calldata params
    ) external payable returns (ILSSVMPairETH pair);

    function createPairETHFiltered(
        IERC721 _nft,
        ICurve _bondingCurve,
        address payable _assetRecipient,
        ILSSVMPair.PoolType _poolType,
        uint128 _delta,
        uint96 _fee,
        uint128 _spotPrice,
        bytes32 _merkleRoot,
        bytes[] calldata _encodedTokenIDs,
        uint256[] calldata _initialNFTIDs,
        bytes32[] calldata _initialProof,
        bool[] calldata _initialProofFlags
    ) external payable returns (ILSSVMPairETH pair);
}
