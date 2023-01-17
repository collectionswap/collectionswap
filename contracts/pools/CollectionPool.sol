// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {ERC20} from "solmate/src/tokens/ERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {ReentrancyGuard} from "../lib/ReentrancyGuard.sol";
import {TransferLib} from "../lib/TransferLib.sol";
import {ICurve} from "../bonding-curves/ICurve.sol";
import {CollectionRouter} from "../routers/CollectionRouter.sol";
import {ICollectionPool} from "./ICollectionPool.sol";
import {ICollectionPoolFactory} from "./ICollectionPoolFactory.sol";
import {CurveErrorCodes} from "../bonding-curves/CurveErrorCodes.sol";
import {TokenIDFilter} from "../filter/TokenIDFilter.sol";

/// @title The base contract for an NFT/TOKEN AMM pool
/// @author Collection
/// @notice This implements the core swap logic from NFT to TOKEN
abstract contract CollectionPool is ReentrancyGuard, ERC1155Holder, TokenIDFilter, ICollectionPool {
    /**
     * @dev The RoyaltyDue struct is used to track information about royalty payments that are due on NFT swaps.
     * It contains two fields:
     * @dev amount: The amount of the royalty payment, in the token's base units.
     * This value is calculated based on the price of the NFT being swapped, and the royaltyNumerator value set in the AMM pool contract.
     * @dev recipient: The address to which the royalty payment should be sent.
     * This value is determined by the NFT being swapped, and it is specified in the ERC2981 metadata for the NFT.
     * @dev When a user swaps an NFT for tokens using the AMM pool contract, a RoyaltyDue struct is created to track the amount
     * and recipient of the royalty payment that is due on the NFT swap. This struct is then used to facilitate the payment of
     * the royalty to the appropriate recipient.
     */
    struct RoyaltyDue {
        uint256 amount;
        address recipient;
    }

    /**
     * @dev The _INTERFACE_ID_ERC2981 constant specifies the interface ID for the ERC2981 standard. This standard is used for tracking
     * royalties on non-fungible tokens (NFTs). It defines a standard interface for NFTs that includes metadata about the royalties that
     * are due on the NFT when it is swapped or transferred.
     * @dev The _INTERFACE_ID_ERC2981 constant is used in the AMM pool contract to check whether an NFT being swapped implements the ERC2981
     * standard. If it does, the contract can use the metadata provided by the ERC2981 interface to facilitate the payment of royalties on the
     * NFT swap. If the NFT does not implement the ERC2981 standard, the contract will not track or pay royalties on the NFT swap.
     * This can be overridden by the royaltyNumerator field in the AMM pool contract.
     * @dev For more information about the ERC2981 standard, see https://eips.ethereum.org/EIPS/eip-2981
     */
    bytes4 private constant _INTERFACE_ID_ERC2981 = 0x2a55205a;

    /**
     * @dev The MAX_FEE constant specifies the maximum fee you, the user, are allowed to charge for this AMM pool.
     * It is used to limit the amount of fees that can be charged by the AMM pool contract on NFT/token swaps.
     * @dev The MAX_FEE constant is used to ensure that the AMM pool does not charge excessive fees on NFT/token swaps.
     * It also helps to protect users from paying excessive fees when using the AMM pool contract.
     * @dev usage: 90%, must <= 1 - MAX_PROTOCOL_FEE (set in CollectionPoolFactory)
     * @dev If the bid/ask is 9/10 and the fee is set to 1%, then the fee is calculated as follows:
     * @dev For a buy order, the fee would be the bid price multiplied by the fee rate, or 9 * 1% = 0.09
     * @dev For a sell order, the fee would be the ask price multiplied by the fee rate, or 10 * 1% = 0.1
     * @dev The fee is charged as a percentage of the bid/ask price, and it is used to cover the costs associated with running the AMM pool
     * contract and providing liquidity to the decentralized exchange. The fee is deducted from the final price of the token or NFT swap,
     * and it is paid to the contract owner or to a designated fee recipient. The exact fee rate and fee recipient can be configured by the
     * contract owner when the AMM pool contract is deployed.
     */
    uint24 internal constant MAX_FEE = 0.9e6;

    // The current price of the NFT
    // @dev This is generally used to mean the immediate sell price for the next marginal NFT.
    // However, this should NOT be assumed, as future bonding curves may use spotPrice in different ways.
    // Use getBuyNFTQuote and getSellNFTQuote for accurate pricing info.
    uint128 public spotPrice;

    // The parameter for the pool's bonding curve.
    // Units and meaning are bonding curve dependent.
    uint128 public delta;

    // The spread between buy and sell prices, set to be a multiplier we apply to the buy price
    // Fee is only relevant for TRADE pools
    // Units are in base 1e6
    uint24 public fee;

    // If set to 0, NFTs/tokens sent by traders during trades will be sent to the pool.
    // Otherwise, assets will be sent to the set address. Not available for TRADE pools.
    address payable public assetRecipient;

    // The trade fee accrued from trades.
    uint256 public accruedTradeFee;

    // The properties used by the pool's bonding curve.
    bytes public props;

    // The state used by the pool's bonding curve.
    bytes public state;

    // For every NFT swapped, a fraction of the cost will be sent to the
    // ERC2981 payable address for the NFT swapped. The fraction is equal to
    // `royaltyNumerator / 1e6`
    uint24 public royaltyNumerator;

    // An address to which all royalties will be paid to if not address(0). This
    // is a fallback to ERC2981 royalties set by the NFT creator, and allows sending
    // royalties to arbitrary addresses if a collection does not support ERC2981.
    address payable public royaltyRecipientFallback;
    // token ID assigned to the pool instance
    uint256 public tokenId;

    // Events
    event SwapNFTInPool(
        uint256[] nftIds, uint256 inputAmount, uint256 tradeFee, uint256 protocolFee, RoyaltyDue[] royaltyDue
    );
    event SwapNFTOutPool(
        uint256[] nftIds, uint256 outputAmount, uint256 tradeFee, uint256 protocolFee, RoyaltyDue[] royaltyDue
    );
    event SpotPriceUpdate(uint128 newSpotPrice);
    event TokenDeposit(uint256 amount);
    event TokenWithdrawal(uint256 amount);
    event AccruedTradeFeeWithdrawal(uint256 amount);
    event NFTWithdrawal();
    event DeltaUpdate(uint128 newDelta);
    event FeeUpdate(uint96 newFee);
    event AssetRecipientChange(address a);
    event PropsUpdate(bytes newProps);
    event StateUpdate(bytes newState);
    event RoyaltyNumeratorUpdate(uint24 newRoyaltyNumerator);
    event RoyaltyRecipientFallbackUpdate(address payable newFallback);

    // Parameterized Errors
    error BondingCurveError(CurveErrorCodes.Error error);
    error InsufficientLiquidity(uint256 balance, uint256 accruedTradeFee);

    /**
     * @dev Use this whenever modifying the value of royaltyNumerator.
     */
    modifier validRoyaltyNumerator(uint24 _royaltyNumerator) {
        require(_royaltyNumerator < 1e6, "royaltyNumerator must be < 1e6");
        _;
    }

    /**
     * Ownable functions
     */

    /// @dev Returns the address of the current owner.
    function owner() public view virtual returns (address) {
        return IERC721(address(factory())).ownerOf(tokenId);
    }

    /// @dev Throws if called by any account other than the owner.
    modifier onlyOwner() {
        require(msg.sender == owner(), "not authorized");
        _;
    }

    /// @dev Throws if called by accounts that were not authorized by the owner.
    modifier onlyAuthorized() {
        factory().requireAuthorizedForToken(msg.sender, tokenId);
        _;
    }

    /// @dev Transfers ownership of the contract to a new account (`newOwner`).
    /// Disallows setting to the zero address as a way to more gas-efficiently avoid reinitialization
    /// When ownership is transferred, if the new owner implements IOwnershipTransferCallback, we make a callback
    /// Can only be called by the current owner.
    function transferOwnership(address newOwner) public virtual onlyOwner {
        IERC721(address(factory())).safeTransferFrom(msg.sender, newOwner, tokenId);
    }

    /**
     * @notice Called during pool creation to set initial parameters
     * @dev Only called once by factory to initialize.
     * We verify this by making sure that the current owner is address(0).
     * The Ownable library we use disallows setting the owner to be address(0), so this condition
     * should only be valid before the first initialize call.
     * @param _tokenId The token id of the pool
     * @param _assetRecipient The address that will receive the TOKEN or NFT sent to this pool during swaps.
     * NOTE: If set to address(0), they will go to the pool itself.
     * @param _delta The initial delta of the bonding curve
     * @param _fee The initial % fee taken, if this is a trade pool
     * @param _spotPrice The initial price to sell an asset into the pool
     * @param _royaltyNumerator All trades will result in `royaltyNumerator` * <trade amount> / 1e6
     * being sent to the account to which the traded NFT's royalties are awardable.
     * Must be 0 if `_nft` is not IERC2981 and no recipient fallback is set.
     * @param _royaltyRecipientFallback An address to which all royalties will be paid to if not address(0).
     * This is a fallback to ERC2981 royalties set by the NFT creator, and allows sending royalties to
     * arbitrary addresses if a collection does not support ERC2981.
     */
    function initialize(
        uint256 _tokenId,
        address payable _assetRecipient,
        uint128 _delta,
        uint24 _fee,
        uint128 _spotPrice,
        bytes calldata _props,
        bytes calldata _state,
        uint24 _royaltyNumerator,
        address payable _royaltyRecipientFallback
    ) external payable validRoyaltyNumerator(_royaltyNumerator) {
        require(tokenId == 0, "Initialized");
        tokenId = _tokenId;
        __ReentrancyGuard_init();

        ICurve _bondingCurve = bondingCurve();
        PoolType _poolType = poolType();

        if ((_poolType == PoolType.TOKEN) || (_poolType == PoolType.NFT)) {
            require(_fee == 0, "Only Trade Pools can have nonzero fee");
            assetRecipient = _assetRecipient;
        } else if (_poolType == PoolType.TRADE) {
            require(_fee < MAX_FEE, "Trade fee must be less than 90%");
            require(_assetRecipient == address(0), "Trade pools can't set asset recipient");
            fee = _fee;
        }
        require(_bondingCurve.validateDelta(_delta), "Invalid delta for curve");
        require(_bondingCurve.validateSpotPrice(_spotPrice), "Invalid new spot price for curve");
        require(_bondingCurve.validateProps(_props), "Invalid props for curve");
        require(_bondingCurve.validateState(_state), "Invalid state for curve");
        delta = _delta;
        spotPrice = _spotPrice;
        props = _props;
        state = _state;
        royaltyNumerator = _royaltyNumerator;
        royaltyRecipientFallback = _royaltyRecipientFallback;
    }

    /**
     * External state-changing functions
     */

    /**
     * @notice Sets NFT token ID filter that is allowed in this pool. Pool must
     * be empty to call this function.
     * @param merkleRoot Merkle root representing all allowed IDs
     * @param encodedTokenIDs Opaque encoded list of token IDs
     */
    function setTokenIDFilter(bytes32 merkleRoot, bytes calldata encodedTokenIDs) external {
        require(msg.sender == address(factory()) || msg.sender == owner(), "not authorized");
        require(nft().balanceOf(address(this)) == 0, "pool not empty");
        _setRootAndEmitAcceptedIDs(address(nft()), merkleRoot, encodedTokenIDs);
    }

    /**
     * @notice Sends token to the pool in exchange for any `numNFTs` NFTs
     * @dev To compute the amount of token to send, call bondingCurve.getBuyInfo.
     * This swap function is meant for users who are ID agnostic
     * @dev The nonReentrant modifier is in swapTokenForSpecificNFTs
     * @param numNFTs The number of NFTs to purchase
     * @param maxExpectedTokenInput The maximum acceptable cost from the sender. If the actual
     * amount is greater than this value, the transaction will be reverted.
     * @param nftRecipient The recipient of the NFTs
     * @param isRouter True if calling from CollectionRouter, false otherwise. Not used for
     * ETH pools.
     * @param routerCaller If isRouter is true, ERC20 tokens will be transferred from this address. Not used for
     * ETH pools.
     * @return inputAmount The amount of token used for purchase
     */
    function swapTokenForAnyNFTs(
        uint256 numNFTs,
        uint256 maxExpectedTokenInput,
        address nftRecipient,
        bool isRouter,
        address routerCaller
    ) external payable virtual returns (uint256 inputAmount) {
        IERC721 _nft = nft();
        require((numNFTs > 0) && (numNFTs <= _nft.balanceOf(address(this))), "Ask for > 0 and <= balanceOf NFTs");

        uint256[] memory tokenIds = _selectArbitraryNFTs(_nft, numNFTs);
        inputAmount = swapTokenForSpecificNFTs(tokenIds, maxExpectedTokenInput, nftRecipient, isRouter, routerCaller);
    }

    /**
     * @notice Sends token to the pool in exchange for a specific set of NFTs
     * @dev To compute the amount of token to send, call bondingCurve.getBuyInfo
     * This swap is meant for users who want specific IDs. Also higher chance of
     * reverting if some of the specified IDs leave the pool before the swap goes through.
     * @param nftIds The list of IDs of the NFTs to purchase
     * @param maxExpectedTokenInput The maximum acceptable cost from the sender. If the actual
     * amount is greater than this value, the transaction will be reverted.
     * @param nftRecipient The recipient of the NFTs
     * @param isRouter True if calling from CollectionRouter, false otherwise. Not used for
     * ETH pools.
     * @param routerCaller If isRouter is true, ERC20 tokens will be transferred from this address. Not used for
     * ETH pools.
     * @return inputAmount The amount of token used for purchase
     */
    function swapTokenForSpecificNFTs(
        uint256[] memory nftIds,
        uint256 maxExpectedTokenInput,
        address nftRecipient,
        bool isRouter,
        address routerCaller
    ) public payable virtual nonReentrant returns (uint256 inputAmount) {
        // Store locally to remove extra calls
        ICollectionPoolFactory _factory = factory();
        ICurve _bondingCurve = bondingCurve();

        // Input validation
        {
            PoolType _poolType = poolType();
            require(_poolType == PoolType.NFT || _poolType == PoolType.TRADE, "Wrong Pool type");
            require((nftIds.length > 0), "Must ask for > 0 NFTs");
        }

        // Prevent users from making a ridiculous pool, buying out their "sucker" price, and
        // then staking this pool with liquidity at really bad prices into a reward vault.
        require(!isInCreationBlock(), "Trade blocked");

        // Call bonding curve for pricing information
        ICurve.Fees memory fees;
        (inputAmount, fees) =
            _calculateBuyInfoAndUpdatePoolParams(nftIds.length, maxExpectedTokenInput, _bondingCurve, _factory);

        accruedTradeFee += fees.trade;
        RoyaltyDue[] memory royaltiesDue = _getRoyaltiesDue(nft(), nftIds, fees.royalties);

        _pullTokenInputAndPayProtocolFee(inputAmount, isRouter, routerCaller, _factory, fees.protocol, royaltiesDue);

        _withdrawNFTs(nftRecipient, nftIds);

        _refundTokenToSender(inputAmount);

        emit SwapNFTOutPool(nftIds, inputAmount, fees.trade, fees.protocol, royaltiesDue);
    }

    /**
     * @notice Sends a set of NFTs to the pool in exchange for token
     * @dev To compute the amount of token to that will be received, call bondingCurve.getSellInfo.
     * @param nfts The list of IDs of the NFTs to sell to the pool along with its Merkle multiproof.
     * @param minExpectedTokenOutput The minimum acceptable token received by the sender. If the actual
     * amount is less than this value, the transaction will be reverted.
     * @param tokenRecipient The recipient of the token output
     * @param isRouter True if calling from CollectionRouter, false otherwise. Not used for
     * ETH pools.
     * @param routerCaller If isRouter is true, ERC20 tokens will be transferred from this address. Not used for
     * ETH pools.
     * @return outputAmount The amount of token received
     */
    function swapNFTsForToken(
        ICollectionPool.NFTs calldata nfts,
        uint256 minExpectedTokenOutput,
        address payable tokenRecipient,
        bool isRouter,
        address routerCaller
    ) external virtual nonReentrant returns (uint256 outputAmount) {
        // Store locally to remove extra calls
        ICollectionPoolFactory _factory = factory();
        ICurve _bondingCurve = bondingCurve();

        // Input validation
        {
            PoolType _poolType = poolType();
            require(_poolType == PoolType.TOKEN || _poolType == PoolType.TRADE, "Wrong Pool type");
            require(nfts.ids.length > 0, "Must ask for > 0 NFTs");
            require(acceptsTokenIDs(nfts.ids, nfts.proof, nfts.proofFlags), "NFT not allowed");
        }

        // Prevent users from making a ridiculous pool, buying out their "sucker" price, and
        // then staking this pool with liquidity at really bad prices into a reward vault
        require(!isInCreationBlock(), "Trade blocked");

        // Call bonding curve for pricing information
        ICurve.Fees memory fees;
        (outputAmount, fees) =
            _calculateSellInfoAndUpdatePoolParams(nfts.ids.length, minExpectedTokenOutput, _bondingCurve);

        // Accrue trade fees before sending token output. This ensures that the balance is always sufficient for trade fee withdrawal.
        accruedTradeFee += fees.trade;

        RoyaltyDue[] memory royaltiesDue = _getRoyaltiesDue(nft(), nfts.ids, fees.royalties);

        _sendTokenOutput(tokenRecipient, outputAmount, royaltiesDue);

        _payProtocolFeeFromPool(_factory, fees.protocol);

        _takeNFTsFromSender(nfts.ids, _factory, isRouter, routerCaller);

        emit SwapNFTInPool(nfts.ids, outputAmount, fees.trade, fees.protocol, royaltiesDue);
    }

    function balanceToFulfillBuyNFT(uint256 numNFTs)
        external
        view
        returns (CurveErrorCodes.Error error, uint256 balance)
    {
        uint256 totalAmount;
        (error,, totalAmount,,) = getBuyNFTQuote(numNFTs);
        balance = accruedTradeFee + totalAmount;
    }

    function balanceToFulfillSellNFT(uint256 numNFTs)
        external
        view
        returns (CurveErrorCodes.Error error, uint256 balance)
    {
        uint256 totalAmount;
        (error,, totalAmount,,) = getSellNFTQuote(numNFTs);
        balance = accruedTradeFee + totalAmount;
    }

    /**
     * View functions
     */

    /**
     * @notice Checks if NFTs is allowed in this pool
     * @param tokenID NFT ID
     * @param proof Merkle proof
     */
    function acceptsTokenID(uint256 tokenID, bytes32[] calldata proof) public view returns (bool) {
        return _acceptsTokenID(tokenID, proof);
    }

    /**
     * @notice Checks if list of NFTs are allowed in this pool using Merkle multiproof and flags
     * @param tokenIDs List of NFT IDs
     * @param proof Merkle multiproof
     * @param proofFlags Merkle multiproof flags
     */
    function acceptsTokenIDs(uint256[] calldata tokenIDs, bytes32[] calldata proof, bool[] calldata proofFlags)
        public
        view
        returns (bool)
    {
        return _acceptsTokenIDs(tokenIDs, proof, proofFlags);
    }

    /**
     * @dev Used as read function to query the bonding curve for buy pricing info
     * @param numNFTs The number of NFTs to buy from the pool
     */
    function getBuyNFTQuote(uint256 numNFTs)
        public
        view
        returns (
            CurveErrorCodes.Error error,
            ICurve.Params memory newParams,
            uint256 totalAmount,
            uint256 inputAmount,
            ICurve.Fees memory fees
        )
    {
        (error, newParams, inputAmount, fees) = bondingCurve().getBuyInfo(curveParams(), numNFTs, feeMultipliers());

        // Since inputAmount is already inclusive of fees.
        totalAmount = inputAmount;
    }

    /**
     * @dev Used as read function to query the bonding curve for sell pricing info
     * @param numNFTs The number of NFTs to sell to the pool
     */
    function getSellNFTQuote(uint256 numNFTs)
        public
        view
        returns (
            CurveErrorCodes.Error error,
            ICurve.Params memory newParams,
            uint256 totalAmount,
            uint256 outputAmount,
            ICurve.Fees memory fees
        )
    {
        (error, newParams, outputAmount, fees) = bondingCurve().getSellInfo(curveParams(), numNFTs, feeMultipliers());

        totalAmount = outputAmount + fees.trade + fees.protocol;
        uint256 length = fees.royalties.length;
        for (uint256 i; i < length;) {
            totalAmount += fees.royalties[i];
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice Returns all NFT IDs held by the pool
     */
    function getAllHeldIds() external view virtual returns (uint256[] memory);

    /**
     * @notice Returns the pool's variant (NFT is enumerable or not, pool uses ETH or ERC20)
     */
    function poolVariant() public pure virtual returns (ICollectionPoolFactory.PoolVariant);

    function factory() public pure returns (ICollectionPoolFactory _factory) {
        uint256 paramsLength = _immutableParamsLength();
        assembly {
            _factory := shr(0x60, calldataload(sub(calldatasize(), paramsLength)))
        }
    }

    /**
     * @notice Returns the type of bonding curve that parameterizes the pool
     */
    function bondingCurve() public pure returns (ICurve _bondingCurve) {
        uint256 paramsLength = _immutableParamsLength();
        assembly {
            _bondingCurve := shr(0x60, calldataload(add(sub(calldatasize(), paramsLength), 20)))
        }
    }

    /**
     * @notice Returns the NFT collection that parameterizes the pool
     */
    function nft() public pure returns (IERC721 _nft) {
        uint256 paramsLength = _immutableParamsLength();
        assembly {
            _nft := shr(0x60, calldataload(add(sub(calldatasize(), paramsLength), 40)))
        }
    }

    /**
     * @notice Returns the pool's type (TOKEN/NFT/TRADE)
     */
    function poolType() public pure returns (PoolType _poolType) {
        uint256 paramsLength = _immutableParamsLength();
        assembly {
            _poolType := shr(0xf8, calldataload(add(sub(calldatasize(), paramsLength), 60)))
        }
    }

    function isInCreationBlock() private view returns (bool _isInCreationBlock) {
        uint256 paramsLength = _immutableParamsLength();
        uint256 _creationBlockNumber;

        assembly {
            _creationBlockNumber := shr(0xe0, calldataload(add(sub(calldatasize(), paramsLength), 61)))
        }
        // Only the (lower) 32 bits are stored (~2000 years with 15s blocks). We compare with uint32(block.number)
       // so we can still detect if we're in the same block in the unlikely event of an overflow
        _isInCreationBlock = uint32(_creationBlockNumber) == uint32(block.number);
    }

    /**
     * @notice Handles royalty recipient and fallback logic. Attempts to honor
     * ERC2981 where possible, followed by the owner's set fallback. If neither
     * is a valid address, then royalties go to the asset recipient for this
     * pool.
     * @param erc2981Recipient The address to which royalties should be paid as
     * returned by the IERC2981 `royaltyInfo` method. `payable(address(0))` if
     * the nft does not implement IERC2981.
     * @return The address to which royalties should be paid
     */
    function getRoyaltyRecipient(address payable erc2981Recipient) internal view returns (address payable) {
        if (erc2981Recipient != address(0)) {
            return erc2981Recipient;
        }

        // No recipient from ERC2981 royaltyInfo method. Check if we have a fallback
        if (royaltyRecipientFallback != address(0)) {
            return royaltyRecipientFallback;
        }

        // No ERC2981 recipient or recipient fallback. Default to pool's assetRecipient.
        return getAssetRecipient();
    }

    /**
     * @notice Returns the address that assets that receives assets when a swap is done with this pool
     * Can be set to another address by the owner, if set to address(0), defaults to the pool's own address
     */
    function getAssetRecipient() public view returns (address payable _assetRecipient) {
        // If it's a TRADE pool, we know the recipient is 0 (TRADE pools can't set asset recipients)
        // so just return address(this)
        if (poolType() == PoolType.TRADE) {
            return payable(address(this));
        }

        // Otherwise, we return the recipient if it's been set
        // or replace it with address(this) if it's 0
        _assetRecipient = assetRecipient;
        if (_assetRecipient == address(0)) {
            // Tokens will be transferred to address(this)
            _assetRecipient = payable(address(this));
        }
    }

    function curveParams() public view returns (ICurve.Params memory params) {
        return ICurve.Params(spotPrice, delta, props, state);
    }

    function feeMultipliers() public view returns (ICurve.FeeMultipliers memory) {
        uint24 protocolFeeMultiplier;
        uint24 carryFeeMultiplier;

        PoolType _poolType = poolType();
        if ((_poolType == PoolType.TOKEN) || (_poolType == PoolType.NFT)) {
            protocolFeeMultiplier = factory().protocolFeeMultiplier();
        } else if (_poolType == PoolType.TRADE) {
            carryFeeMultiplier = factory().carryFeeMultiplier();
        }

        return ICurve.FeeMultipliers(fee, protocolFeeMultiplier, royaltyNumerator, carryFeeMultiplier);
    }

    /**
     * Internal functions
     */

    /**
     * @notice Calculates the amount needed to be sent into the pool for a buy and adjusts spot price or delta if necessary
     * @param numNFTs The amount of NFTs to purchase from the pool
     * @param maxExpectedTokenInput The maximum acceptable cost from the sender. If the actual
     * amount is greater than this value, the transaction will be reverted.
     * @return inputAmount The amount of tokens total tokens receive
     * @return fees The amount of tokens to send as fees
     */
    function _calculateBuyInfoAndUpdatePoolParams(
        uint256 numNFTs,
        uint256 maxExpectedTokenInput,
        ICurve _bondingCurve,
        ICollectionPoolFactory
    ) internal returns (uint256 inputAmount, ICurve.Fees memory fees) {
        CurveErrorCodes.Error error;
        ICurve.Params memory params = curveParams();
        ICurve.Params memory newParams;
        (error, newParams, inputAmount, fees) = _bondingCurve.getBuyInfo(params, numNFTs, feeMultipliers());

        // Revert if bonding curve had an error
        if (error != CurveErrorCodes.Error.OK) {
            revert BondingCurveError(error);
        }

        // Revert if input is more than expected
        require(inputAmount <= maxExpectedTokenInput, "In too many tokens");

        _updatePoolParams(params, newParams);
    }

    /**
     * @notice Calculates the amount needed to be sent by the pool for a sell and adjusts spot price or delta if necessary
     * @param numNFTs The amount of NFTs to send to the the pool
     * @param minExpectedTokenOutput The minimum acceptable token received by the sender. If the actual
     * amount is less than this value, the transaction will be reverted.
     * @param _bondingCurve The bonding curve used to fetch pricing information from
     * @return outputAmount The amount of tokens total tokens receive
     * @return fees The amount of tokens to send as fees
     */
    function _calculateSellInfoAndUpdatePoolParams(
        uint256 numNFTs,
        uint256 minExpectedTokenOutput,
        ICurve _bondingCurve
    ) internal returns (uint256 outputAmount, ICurve.Fees memory fees) {
        CurveErrorCodes.Error error;
        ICurve.Params memory params = curveParams();
        ICurve.Params memory newParams;
        (error, newParams, outputAmount, fees) = _bondingCurve.getSellInfo(params, numNFTs, feeMultipliers());

        // Revert if bonding curve had an error
        if (error != CurveErrorCodes.Error.OK) {
            revert BondingCurveError(error);
        }

        // Revert if output is too little
        require(outputAmount >= minExpectedTokenOutput, "Out too little tokens");

        _updatePoolParams(params, newParams);
    }

    function _updatePoolParams(ICurve.Params memory params, ICurve.Params memory newParams) internal {
        // Consolidate writes to save gas
        if (params.spotPrice != newParams.spotPrice || params.delta != newParams.delta) {
            spotPrice = newParams.spotPrice;
            delta = newParams.delta;
        }

        if (keccak256(params.state) != keccak256(newParams.state)) {
            state = newParams.state;

            emit StateUpdate(newParams.state);
        }

        // Emit spot price update if it has been updated
        if (params.spotPrice != newParams.spotPrice) {
            emit SpotPriceUpdate(newParams.spotPrice);
        }

        // Emit delta update if it has been updated
        if (params.delta != newParams.delta) {
            emit DeltaUpdate(newParams.delta);
        }
    }

    /**
     * @notice Pulls the token input of a trade from the trader and pays the protocol fee.
     * @param inputAmount The amount of tokens to be sent
     * @param isRouter Whether or not the caller is CollectionRouter
     * @param routerCaller If called from CollectionRouter, store the original caller
     * @param _factory The CollectionPoolFactory which stores CollectionRouter allowlist info
     * @param protocolFee The protocol fee to be paid
     * @param royaltyAmounts An array of royalties to pay
     */
    function _pullTokenInputAndPayProtocolFee(
        uint256 inputAmount,
        bool isRouter,
        address routerCaller,
        ICollectionPoolFactory _factory,
        uint256 protocolFee,
        RoyaltyDue[] memory royaltyAmounts
    ) internal virtual;

    /**
     * @notice Sends excess tokens back to the caller (if applicable)
     * @dev We send ETH back to the caller even when called from CollectionRouter because we do an aggregate slippage check for certain bulk swaps. (Instead of sending directly back to the router caller)
     * Excess ETH sent for one swap can then be used to help pay for the next swap.
     */
    function _refundTokenToSender(uint256 inputAmount) internal virtual;

    /**
     * @notice Sends protocol fee (if it exists) back to the CollectionPoolFactory from the pool
     */
    function _payProtocolFeeFromPool(ICollectionPoolFactory _factory, uint256 protocolFee) internal virtual;

    /**
     * @notice Sends tokens to a recipient and pays royalties owed
     * @param tokenRecipient The address receiving the tokens
     * @param outputAmount The amount of tokens to send
     * @param royaltiesDue An array of royalties to pay
     */
    function _sendTokenOutput(address payable tokenRecipient, uint256 outputAmount, RoyaltyDue[] memory royaltiesDue)
        internal
        virtual;

    /**
     * @notice Select arbitrary NFTs from pool
     * @param _nft The address of the NFT to send
     * @param numNFTs The number of NFTs to send
     */
    function _selectArbitraryNFTs(IERC721 _nft, uint256 numNFTs) internal virtual returns (uint256[] memory tokenIds);

    /**
     * @notice Takes NFTs from the caller and sends them into the pool's asset recipient
     * @dev This is used by the CollectionPool's swapNFTForToken function.
     * @param nftIds The specific NFT IDs to take
     * @param isRouter True if calling from CollectionRouter, false otherwise. Not used for * ETH pools.
     * @param routerCaller If isRouter is true, ERC20 tokens will be transferred from this address. Not used for
     * ETH pools.
     */
    function _takeNFTsFromSender(
        uint256[] calldata nftIds,
        ICollectionPoolFactory _factory,
        bool isRouter,
        address routerCaller
    ) internal virtual {
        {
            address _assetRecipient = getAssetRecipient();
            uint256 numNFTs = nftIds.length;

            if (isRouter) {
                // Verify if router is allowed
                CollectionRouter router = CollectionRouter(payable(msg.sender));

                {
                    (bool routerAllowed,) = _factory.routerStatus(router);
                    require(routerAllowed, "Not router");
                }

                IERC721 _nft = nft();

                // Call router to pull NFTs
                // If more than 1 NFT is being transfered, do balance check instead of ownership check,
                // as pools are indifferent between NFTs from the same collection
                if (numNFTs > 1) {
                    uint256 beforeBalance = _nft.balanceOf(_assetRecipient);
                    for (uint256 i = 0; i < numNFTs;) {
                        router.poolTransferNFTFrom(_nft, routerCaller, _assetRecipient, nftIds[i], poolVariant());

                        unchecked {
                            ++i;
                        }
                    }
                    require((_nft.balanceOf(_assetRecipient) - beforeBalance) == numNFTs, "NFTs not transferred");
                } else {
                    router.poolTransferNFTFrom(_nft, routerCaller, _assetRecipient, nftIds[0], poolVariant());
                    require(_nft.ownerOf(nftIds[0]) == _assetRecipient, "NFT not transferred");
                }

                if (_assetRecipient == address(this)) {
                    _depositNFTsNotification(nftIds);
                }
            } else {
                // Pull NFTs directly from sender
                if (_assetRecipient == address(this)) {
                    _depositNFTs(msg.sender, nftIds);
                } else {
                    TransferLib.bulkSafeTransferERC721From(nft(), msg.sender, _assetRecipient, nftIds);
                }
            }
        }
    }

    /**
     * @dev Used internally to grab pool parameters from calldata, see CollectionPoolCloner for technical details
     */
    function _immutableParamsLength() internal pure virtual returns (uint256);

    /**
     * Owner functions
     */

    /// @inheritdoc ICollectionPool
    function withdrawERC721(IERC721 a, uint256[] calldata nftIds) external override onlyAuthorized {
        IERC721 _nft = nft();
        address owner = owner();

        // If it's not the pool's NFT, just withdraw normally
        if (a != _nft) {
            TransferLib.bulkSafeTransferERC721From(a, address(this), owner, nftIds);
        }
        // Otherwise, withdraw and also remove the ID from the ID set
        else {
            _withdrawNFTs(owner, nftIds);

            emit NFTWithdrawal();
        }
    }

    /**
     * @notice Rescues ERC1155 tokens from the pool to the owner. Only callable by the owner.
     * @param a The NFT to transfer
     * @param ids The NFT ids to transfer
     * @param amounts The amounts of each id to transfer
     */
    function withdrawERC1155(IERC1155 a, uint256[] calldata ids, uint256[] calldata amounts) external onlyAuthorized {
        a.safeBatchTransferFrom(address(this), owner(), ids, amounts, "");
        // TODO update idSet or not?
    }

    /**
     * @notice Withdraws the accrued trade fee owned by the pool to the owner address.
     * @dev Only callable by the owner.
     */
    function withdrawAccruedTradeFee() external virtual;

    /**
     * @notice Updates the selling spot price. Only callable by the owner.
     * @param newSpotPrice The new selling spot price value, in Token
     */
    function changeSpotPrice(uint128 newSpotPrice) external onlyOwner {
        ICurve _bondingCurve = bondingCurve();
        require(_bondingCurve.validateSpotPrice(newSpotPrice), "Invalid new spot price for curve");
        if (spotPrice != newSpotPrice) {
            spotPrice = newSpotPrice;
            emit SpotPriceUpdate(newSpotPrice);
        }
    }

    /**
     * @notice Updates the delta parameter. Only callable by the owner.
     * @param newDelta The new delta parameter
     */
    function changeDelta(uint128 newDelta) external onlyOwner {
        ICurve _bondingCurve = bondingCurve();
        require(_bondingCurve.validateDelta(newDelta), "Invalid delta for curve");
        if (delta != newDelta) {
            delta = newDelta;
            emit DeltaUpdate(newDelta);
        }
    }

    /**
     * @notice Updates the props parameter. Only callable by the owner.
     * @param newProps The new props parameter
     */
    function changeProps(bytes calldata newProps) external onlyOwner {
        ICurve _bondingCurve = bondingCurve();
        require(_bondingCurve.validateProps(newProps), "Invalid props for curve");
        if (keccak256(props) != keccak256(newProps)) {
            props = newProps;
            emit PropsUpdate(newProps);
        }
    }

    /**
     * @notice Updates the state parameter. Only callable by the owner.
     * @param newState The new state parameter
     */
    function changeState(bytes calldata newState) external onlyOwner {
        ICurve _bondingCurve = bondingCurve();
        require(_bondingCurve.validateState(newState), "Invalid state for curve");
        if (keccak256(state) != keccak256(newState)) {
            state = newState;
            emit StateUpdate(newState);
        }
    }

    /**
     * @notice Updates the fee taken by the LP. Only callable by the owner.
     * Only callable if the pool is a Trade pool. Reverts if the fee is >=
     * MAX_FEE.
     * @param newFee The new LP fee percentage, 18 decimals
     */
    function changeFee(uint24 newFee) external onlyOwner {
        PoolType _poolType = poolType();
        require(_poolType == PoolType.TRADE, "Only for Trade pools");
        require(newFee < MAX_FEE, "Trade fee must be less than 90%");
        if (fee != newFee) {
            fee = newFee;
            emit FeeUpdate(newFee);
        }
    }

    /**
     * @notice Changes the address that will receive assets received from
     * trades. Only callable by the owner.
     * @param newRecipient The new asset recipient
     */
    function changeAssetRecipient(address payable newRecipient) external onlyOwner {
        PoolType _poolType = poolType();
        require(_poolType != PoolType.TRADE, "Not for Trade pools");
        if (assetRecipient != newRecipient) {
            assetRecipient = newRecipient;
            emit AssetRecipientChange(newRecipient);
        }
    }

    function changeRoyaltyNumerator(uint24 newRoyaltyNumerator)
        external
        onlyOwner
        validRoyaltyNumerator(newRoyaltyNumerator)
    {
        require(
            _validRoyaltyState(newRoyaltyNumerator, royaltyRecipientFallback, nft()),
            "Invalid royaltyNumerator or royaltyRecipientFallback"
        );
        royaltyNumerator = newRoyaltyNumerator;
        emit RoyaltyNumeratorUpdate(newRoyaltyNumerator);
    }

    function changeRoyaltyRecipientFallback(address payable newFallback) external onlyOwner {
        require(
            _validRoyaltyState(royaltyNumerator, newFallback, nft()),
            "Invalid royaltyNumerator or royaltyRecipientFallback"
        );
        royaltyRecipientFallback = newFallback;
        emit RoyaltyRecipientFallbackUpdate(newFallback);
    }

    /**
     * @notice Allows the pool to make arbitrary external calls to contracts
     * whitelisted by the protocol. Only callable by authorized parties.
     * @param target The contract to call
     * @param data The calldata to pass to the contract
     */
    function call(address payable target, bytes calldata data) external onlyAuthorized {
        ICollectionPoolFactory _factory = factory();
        require(_factory.callAllowed(target), "Target must be whitelisted");
        (bool result,) = target.call{value: 0}(data);
        require(result, "Call failed");
    }

    /**
     * @notice Allows owner to batch multiple calls, forked from: https://github.com/boringcrypto/BoringSolidity/blob/master/contracts/BoringBatchable.sol
     * @dev Intended for withdrawing/altering pool pricing in one tx, only callable by owner, cannot change owner
     * @param calls The calldata for each call to make
     * @param revertOnFail Whether or not to revert the entire tx if any of the calls fail
     */
    function multicall(bytes[] calldata calls, bool revertOnFail) external onlyAuthorized {
        for (uint256 i; i < calls.length;) {
            (bool success, bytes memory result) = address(this).delegatecall(calls[i]);
            if (!success && revertOnFail) {
                revert(_getRevertMsg(result));
            }

            unchecked {
                ++i;
            }
        }

        // Prevent multicall from malicious frontend sneaking in ownership change
        require(owner() == msg.sender, "Ownership cannot be changed in multicall");
    }

    /**
     * @param _returnData The data returned from a multicall result
     * @dev Used to grab the revert string from the underlying call
     */
    function _getRevertMsg(bytes memory _returnData) internal pure returns (string memory) {
        // If the _res length is less than 68, then the transaction failed silently (without a revert message)
        if (_returnData.length < 68) return "Transaction reverted silently";

        assembly {
            // Slice the sighash.
            _returnData := add(_returnData, 0x04)
        }
        return abi.decode(_returnData, (string)); // All that remains is the revert string
    }

    function _getRoyaltiesDue(IERC721 _nft, uint256[] memory nftIds, uint256[] memory royaltyAmounts)
        private
        view
        returns (RoyaltyDue[] memory royaltiesDue)
    {
        uint256 length = royaltyAmounts.length;
        royaltiesDue = new RoyaltyDue[](length);
        bool is2981 = IERC165(_nft).supportsInterface(_INTERFACE_ID_ERC2981);
        if (royaltyNumerator != 0) {
            for (uint256 i = 0; i < length;) {
                // 2981 recipient, if nft is 2981 and recipient is set.
                address recipient2981;
                if (is2981) {
                    (recipient2981,) = IERC2981(address(_nft)).royaltyInfo(nftIds[i], 0);
                }

                address recipient = getRoyaltyRecipient(payable(recipient2981));
                royaltiesDue[i] = RoyaltyDue({amount: royaltyAmounts[i], recipient: recipient});

                unchecked {
                    ++i;
                }
            }
        }
    }

    /**
     * @notice Returns true if it's valid to set the contract variables to the
     * variables passed to this function.
     */
    function _validRoyaltyState(uint256 _royaltyNumerator, address payable _royaltyRecipientFallback, IERC721 _nft)
        internal
        view
        returns (bool)
    {
        return
        // Supports 2981 interface to tell us who gets royalties or
        (
            IERC165(_nft).supportsInterface(_INTERFACE_ID_ERC2981)
            // There is a fallback so we always know where to send royaltiers or
            || _royaltyRecipientFallback != address(0)
            // Royalties will not be paid
            || _royaltyNumerator == 0
        );
    }

    function onERC721Received(address, address, uint256, bytes memory) public virtual returns (bytes4) {
        return this.onERC721Received.selector;
    }

    /// @inheritdoc ICollectionPool
    function depositNFTsNotification(uint256[] calldata nftIds) external override {
        require(msg.sender == address(factory()), "not authorized");
        _depositNFTsNotification(nftIds);
    }

    /**
     * @dev Deposit NFTs from given address. NFT IDs must have been validated against the filter.
     */
    function _depositNFTs(address from, uint256[] calldata nftIds) internal virtual;

    /**
     * @dev Used to indicate deposited NFTs.
     */
    function _depositNFTsNotification(uint256[] calldata nftIds) internal virtual;

    /**
     * @notice Sends specific NFTs to a recipient address
     * @param to The receiving address for the NFTs
     * @param nftIds The specific IDs of NFTs to send
     */
    function _withdrawNFTs(address to, uint256[] memory nftIds) internal virtual;
}
