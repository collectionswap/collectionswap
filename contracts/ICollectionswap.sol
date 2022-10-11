// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ICurve} from "./bonding-curves/ICurve.sol";
import {ILSSVMPairETH} from "./ILSSVMPair.sol";
import {IERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/IERC721Enumerable.sol";

interface ICollectionswap is IERC721, IERC721Enumerable {
    struct LPTokenParams721ETH {
        address nftAddress;
        address bondingCurveAddress;
        address payable poolAddress;
        uint96 fee;
        uint128 delta;
        uint128 initialSpotPrice;
        uint256 initialPoolBalance;
        uint256 initialNFTIDsLength;
    }

    function createDirectPairETH(
        IERC721 _nft,
        ICurve _bondingCurve,
        uint128 _delta,
        uint96 _fee,
        uint128 _spotPrice,
        uint256[] calldata _initialNFTIDs        
    ) external payable returns (ILSSVMPairETH newPair, uint256 newTokenId) ;

    function useLPTokenToDestroyDirectPairETH(uint256 _lpTokenId) external;

    function viewPoolParams(uint256 tokenId)
        external
        view
        returns (LPTokenParams721ETH memory poolParams);

    function validatePoolParamsLte(
        uint256 tokenId,
        address nftAddress,
        address bondingCurveAddress,
        uint96 fee,
        uint128 delta
    )
        external
        view
        returns (bool);

    function validatePoolParamsEq(
        uint256 tokenId,
        address nftAddress,
        address bondingCurveAddress,
        uint96 fee,
        uint128 delta
    )
        external
        view
        returns (bool);
}
