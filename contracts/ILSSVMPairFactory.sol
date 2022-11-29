// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {ERC20} from "solmate/src/tokens/ERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/IERC721Enumerable.sol";
import {LSSVMRouter} from "./LSSVMRouter.sol";
import {ICurve} from "./bonding-curves/ICurve.sol";
import {ILSSVMPair} from "./ILSSVMPair.sol";

interface ILSSVMPairFactory is IERC721, IERC721Enumerable {
    enum PairVariant {
        ENUMERABLE_ETH,
        MISSING_ENUMERABLE_ETH,
        ENUMERABLE_ERC20,
        MISSING_ENUMERABLE_ERC20
    }

    struct LPTokenParams721 {
        address nftAddress;
        address bondingCurveAddress;
        address tokenAddress;
        address payable poolAddress;
        uint96 fee;
        uint128 delta;
        uint128 initialSpotPrice;
        uint256 initialPoolBalance;
        uint256 initialNFTIDsLength;
    }

    /**
        @param merkleRoot Merkle root for NFT ID filter
        @param encodedTokenIDs Encoded list of acceptable NFT IDs
        @param initialProof Merkle multiproof for initial NFT IDs
        @param initialProofFlags Merkle multiproof flags for initial NFT IDs
     */
    struct NFTFilterParams {
        bytes32 merkleRoot;
        bytes encodedTokenIDs;
        bytes32[] initialProof;
        bool[] initialProofFlags;
    }

    /**
        @notice Creates a pair contract using EIP-1167.
        @param nft The NFT contract of the collection the pair trades
        @param bondingCurve The bonding curve for the pair to price NFTs, must be whitelisted
        @param assetRecipient The address that will receive the assets traders give during trades.
                              If set to address(0), assets will be sent to the pool address.
                              Not available to TRADE pools.
        @param receiver Receiver of the LP token generated to represent ownership of the pool
        @param poolType TOKEN, NFT, or TRADE
        @param delta The delta value used by the bonding curve. The meaning of delta depends
        on the specific curve.
        @param fee The fee taken by the LP in each trade. Can only be non-zero if _poolType is Trade.
        @param spotPrice The initial selling spot price
        @param royaltyNumerator All trades will result in `royaltyNumerator` * <trade amount> / 1e18 
        being sent to the account to which the traded NFT's royalties are awardable.
        Must be 0 if `_nft` is not IERC2981.
        @param initialNFTIDs The list of IDs of NFTs to transfer from the sender to the pair
        @return pair The new pair
     */
    struct CreateETHPairParams {
        IERC721 nft;
        ICurve bondingCurve;
        address payable assetRecipient;
        address receiver;
        ILSSVMPair.PoolType poolType;
        uint128 delta;
        uint96 fee;
        uint128 spotPrice;
        bytes props;
        bytes state;
        uint256 royaltyNumerator;
        uint256[] initialNFTIDs;
    }

    /**
        @notice Creates a pair contract using EIP-1167.
        @param token The ERC20 token used for pair swaps
        @param nft The NFT contract of the collection the pair trades
        @param bondingCurve The bonding curve for the pair to price NFTs, must be whitelisted
        @param assetRecipient The address that will receive the assets traders give during trades.
                                If set to address(0), assets will be sent to the pool address.
                                Not available to TRADE pools.
        @param receiver Receiver of the LP token generated to represent ownership of the pool
        @param poolType TOKEN, NFT, or TRADE
        @param delta The delta value used by the bonding curve. The meaning of delta depends
        on the specific curve.
        @param fee The fee taken by the LP in each trade. Can only be non-zero if _poolType is Trade.
        @param spotPrice The initial selling spot price, in ETH
        @param royaltyNumerator All trades will result in `royaltyNumerator` * <trade amount> / 1e18 
        being sent to the account to which the traded NFT's royalties are awardable.
        Must be 0 if `_nft` is not IERC2981.
        @param initialNFTIDs The list of IDs of NFTs to transfer from the sender to the pair
        @param initialTokenBalance The initial token balance sent from the sender to the new pair
        @return pair The new pair
     */
    struct CreateERC20PairParams {
        ERC20 token;
        IERC721 nft;
        ICurve bondingCurve;
        address payable assetRecipient;
        address receiver;
        ILSSVMPair.PoolType poolType;
        uint128 delta;
        uint96 fee;
        uint128 spotPrice;
        bytes props;
        bytes state;
        uint256 royaltyNumerator;
        uint256[] initialNFTIDs;
        uint256 initialTokenBalance;
    }

    function protocolFeeMultiplier() external view returns (uint256);

    function protocolFeeRecipient() external view returns (address payable);

    function carryFeeMultiplier() external view returns (uint256);

    function callAllowed(address target) external view returns (bool);

    function routerStatus(LSSVMRouter router)
        external
        view
        returns (bool allowed, bool wasEverAllowed);

    function isPair(address potentialPair, PairVariant variant)
        external
        view
        returns (bool);

    function requireAuthorizedForToken(address spender, uint256 tokenId) external view;

    function createPairETH(
        CreateETHPairParams calldata params
    ) external payable returns (address pair, uint256 tokenId);

    function createPairERC20(CreateERC20PairParams calldata params)
        external
        returns (address pair, uint256 tokenId);

    function burn(uint256 tokenId) external;

    /**
     * @return poolParams the parameters of the pool matching `tokenId`.
     */
    function viewPoolParams(uint256 tokenId)
        external
        view
        returns (LPTokenParams721 memory poolParams);

    /**
     * @param tokenId The tokenId of the pool to validate
     * @param nftAddress The address of the NFT collection which the pool 
     * should accept
     * @param bondingCurveAddress The address of the bonding curve the pool
     * should be using
     * @param fee The maximum fee the pool should have
     * @param delta The maximum delta the pool should have
     * 
     * @return true iff the pool specified by `tokenId` has the correct
     * NFT address, bonding curve address, and has fee and delta == `fee` and
     * `delta`, respectively
     */
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

    /**
     * @param tokenId The tokenId of the pool to validate
     * @param nftAddress The address of the NFT collection which the pool 
     * should accept
     * @param bondingCurveAddress The address of the bonding curve the pool
     * should be using
     * @param fee The fee the pool should have
     * @param delta The delta the pool should have
     * 
     * @return true iff the pool specified by `tokenId` has the correct
     * NFT address, bonding curve address, and has fee and delta <= `fee` and
     * `delta`, respectively
     */
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
