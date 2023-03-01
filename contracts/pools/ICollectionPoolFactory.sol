// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {ERC20} from "solmate/src/tokens/ERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/IERC721Enumerable.sol";
import {CollectionRouter} from "../routers/CollectionRouter.sol";
import {ICurve} from "../bonding-curves/ICurve.sol";
import {IExternalFilter} from "../filter/IExternalFilter.sol";
import {CollectionPool} from "../pools/CollectionPool.sol";
import {ICollectionPool} from "../pools/ICollectionPool.sol";

interface ICollectionPoolFactory is IERC721 {
    enum PoolVariant {
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
        uint24 fee;
        uint128 delta;
        uint24 royaltyNumerator;
    }

    /**
     * @param merkleRoot Merkle root for NFT ID filter
     * @param encodedTokenIDs Encoded list of acceptable NFT IDs
     * @param initialProof Merkle multiproof for initial NFT IDs
     * @param initialProofFlags Merkle multiproof flags for initial NFT IDs
     * @param externalFilter Address implementing IExternalFilter for external filtering
     */
    struct NFTFilterParams {
        bytes32 merkleRoot;
        bytes encodedTokenIDs;
        bytes32[] initialProof;
        bool[] initialProofFlags;
        IExternalFilter externalFilter;
    }

    /**
     * @notice Creates a pool contract using EIP-1167.
     * @param nft The NFT contract of the collection the pool trades
     * @param bondingCurve The bonding curve for the pool to price NFTs, must be whitelisted
     * @param assetRecipient The address that will receive the assets traders give during trades.
     * If set to address(0), assets will be sent to the pool address. Not available to TRADE pools.
     * @param receiver Receiver of the LP token generated to represent ownership of the pool
     * @param poolType TOKEN, NFT, or TRADE
     * @param delta The delta value used by the bonding curve. The meaning of delta depends
     * on the specific curve.
     * @param fee The fee taken by the LP in each trade. Can only be non-zero if _poolType is Trade.
     * @param spotPrice The initial selling spot price
     * @param royaltyNumerator All trades will result in `royaltyNumerator` * <trade amount> / 1e6
     * being sent to the account to which the traded NFT's royalties are awardable.
     * Must be 0 if `_nft` is not IERC2981 and no recipient fallback is set.
     * @param royaltyRecipientFallback An address to which all royalties will
     * be paid to if not address(0) and ERC2981 is not supported or ERC2981 recipient is not set.
     * @param initialNFTIDs The list of IDs of NFTs to transfer from the sender to the pool
     * @return pool The new pool
     */
    struct CreateETHPoolParams {
        IERC721 nft;
        ICurve bondingCurve;
        address payable assetRecipient;
        address receiver;
        ICollectionPool.PoolType poolType;
        uint128 delta;
        uint24 fee;
        uint128 spotPrice;
        bytes props;
        bytes state;
        uint24 royaltyNumerator;
        address payable royaltyRecipientFallback;
        uint256[] initialNFTIDs;
    }

    /**
     * @notice Creates a pool contract using EIP-1167.
     * @param token The ERC20 token used for pool swaps
     * @param nft The NFT contract of the collection the pool trades
     * @param bondingCurve The bonding curve for the pool to price NFTs, must be whitelisted
     * @param assetRecipient The address that will receive the assets traders give during trades.
     * If set to address(0), assets will be sent to the pool address. Not available to TRADE pools.
     * @param receiver Receiver of the LP token generated to represent ownership of the pool
     * @param poolType TOKEN, NFT, or TRADE
     * @param delta The delta value used by the bonding curve. The meaning of delta depends on the
     * specific curve.
     * @param fee The fee taken by the LP in each trade. Can only be non-zero if _poolType is Trade.
     * @param spotPrice The initial selling spot price, in ETH
     * @param royaltyNumerator All trades will result in `royaltyNumerator` * <trade amount> / 1e6
     * being sent to the account to which the traded NFT's royalties are awardable.
     * Must be 0 if `_nft` is not IERC2981 and no recipient fallback is set.
     * @param royaltyRecipientFallback An address to which all royalties will
     * be paid to if not address(0) and ERC2981 is not supported or ERC2981 recipient is not set.
     * @param initialNFTIDs The list of IDs of NFTs to transfer from the sender to the pool
     * @param initialTokenBalance The initial token balance sent from the sender to the new pool
     * @return pool The new pool
     */
    struct CreateERC20PoolParams {
        ERC20 token;
        IERC721 nft;
        ICurve bondingCurve;
        address payable assetRecipient;
        address receiver;
        ICollectionPool.PoolType poolType;
        uint128 delta;
        uint24 fee;
        uint128 spotPrice;
        bytes props;
        bytes state;
        uint24 royaltyNumerator;
        address payable royaltyRecipientFallback;
        uint256[] initialNFTIDs;
        uint256 initialTokenBalance;
    }

    function protocolFeeMultiplier() external view returns (uint24);

    function protocolFeeRecipient() external view returns (address payable);

    function carryFeeMultiplier() external view returns (uint24);

    function callAllowed(address target) external view returns (bool);

    function routerStatus(CollectionRouter router) external view returns (bool allowed, bool wasEverAllowed);

    function isPool(address potentialPool) external view returns (bool);

    function isPoolVariant(address potentialPool, PoolVariant variant) external view returns (bool);

    function requireAuthorizedForToken(address spender, uint256 tokenId) external view;

    function swapPaused() external view returns (bool);

    function creationPaused() external view returns (bool);

    function createPoolETH(CreateETHPoolParams calldata params)
        external
        payable
        returns (ICollectionPool pool, uint256 tokenId);

    function createPoolERC20(CreateERC20PoolParams calldata params) external returns (ICollectionPool pool, uint256 tokenId);

    function createPoolETHFiltered(CreateETHPoolParams calldata params, NFTFilterParams calldata filterParams)
        external
        payable
        returns (ICollectionPool pool, uint256 tokenId);

    function createPoolERC20Filtered(CreateERC20PoolParams calldata params, NFTFilterParams calldata filterParams)
        external
        returns (ICollectionPool pool, uint256 tokenId);

    function depositNFTs(
        uint256[] calldata ids,
        bytes32[] calldata proof,
        bool[] calldata proofFlags,
        address recipient,
        address from
    ) external;

    function depositERC20(ERC20 token, uint256 amount, address recipient, address from) external;

    function depositRoyaltiesNotification(
        ERC20 token,
        CollectionPool.RoyaltyDue[] calldata royaltiesDue,
        PoolVariant poolVariant
    ) external payable;

    function burn(uint256 tokenId) external;

    /**
     * @dev Returns the pool of the `tokenId` token.
     */
    function poolOf(uint256 tokenId) external view returns (ICollectionPool);

    function withdrawRoyalties(address payable recipient, ERC20 token) external;

    /**
     * @notice Withdraw all `token` royalties awardable to `recipient`. If the
     * zero address is passed as `token`, then ETH royalties are paid. Does not
     * use msg.sender so this function can be called on behalf of contract
     * royalty recipients
     *
     * @dev Does not call `withdrawRoyalties` to avoid making multiple unneeded
     * checks of whether `address(token) == address(0)` for each iteration
     */
    function withdrawRoyaltiesMultipleRecipients(address payable[] calldata recipients, ERC20 token) external;

    function withdrawRoyaltiesMultipleCurrencies(address payable recipient, ERC20[] calldata tokens) external;

    /**
     * @notice Withdraw royalties for ALL combinations of recipients and tokens
     * in the given arguments
     *
     * @dev Iterate over tokens as outer loop to reduce stores/loads to `royaltiesStored`
     * and also reduce the number of `address(token) == address(0)` condition checks
     * from O(m * n) to O(n)
     */
    function withdrawRoyaltiesMultipleRecipientsAndCurrencies(
        address payable[] calldata recipients,
        ERC20[] calldata tokens
    ) external;
}
