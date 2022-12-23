// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {ERC20} from "solmate/src/tokens/ERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {ICurve} from "../bonding-curves/ICurve.sol";
import {CurveErrorCodes} from "../bonding-curves/CurveErrorCodes.sol";
import {ITokenIDFilter} from "../filter/ITokenIDFilter.sol";

interface ICollectionPool is ITokenIDFilter {
    enum PoolType {
        TOKEN,
        NFT,
        TRADE
    }

    /**
     * @param ids The list of IDs of the NFTs to sell to the pool
     * @param proof Merkle multiproof proving list is allowed by pool
     * @param proofFlags Merkle multiproof flags for proof
     */
    struct NFTs {
        uint256[] ids;
        bytes32[] proof;
        bool[] proofFlags;
    }

    function bondingCurve() external view returns (ICurve);

    function getAllHeldIds() external view returns (uint256[] memory);

    function delta() external view returns (uint128);

    function fee() external view returns (uint96);

    function nft() external view returns (IERC721);

    function poolType() external view returns (PoolType);

    function spotPrice() external view returns (uint128);

    function royaltyNumerator() external view returns (uint256);

    /**
     * @notice Rescues a specified set of NFTs owned by the pool to the owner address. (onlyOwnable modifier is in the implemented function)
     * @dev If the NFT is the pool's collection, we also remove it from the id tracking (if the NFT is missing enumerable).
     * @param a The NFT to transfer
     * @param nftIds The list of IDs of the NFTs to send to the owner
     */
    function withdrawERC721(IERC721 a, uint256[] calldata nftIds) external;

    /**
     * @notice Rescues ERC20 tokens from the pool to the owner. Only callable by the owner (onlyOwnable modifier is in the implemented function).
     * @param a The token to transfer
     * @param amount The amount of tokens to send to the owner
     */
    function withdrawERC20(ERC20 a, uint256 amount) external;

    function withdrawERC1155(IERC1155 a, uint256[] calldata ids, uint256[] calldata amounts) external;

    function getSellNFTQuote(uint256 numNFTs)
        external
        view
        returns (
            CurveErrorCodes.Error error,
            ICurve.Params memory newParams,
            uint256 totalAmount,
            uint256 outputAmount,
            ICurve.Fees memory fees
        );
}

interface ICollectionPoolETH is ICollectionPool {
    function withdrawAllETH() external;
}
