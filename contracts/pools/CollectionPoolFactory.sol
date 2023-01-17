// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {ERC165Checker} from "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/IERC721Enumerable.sol";

// @dev Solmate's ERC20 is used instead of OZ's ERC20 so we can use safeTransferLib for cheaper safeTransfers for
// ETH and ERC20 tokens
import {ERC20} from "solmate/src/tokens/ERC20.sol";
import {SafeTransferLib} from "solmate/src/utils/SafeTransferLib.sol";
import {ReentrancyGuard} from "../lib/ReentrancyGuard.sol";
import {TransferLib} from "../lib/TransferLib.sol";

import {CollectionPool} from ".//CollectionPool.sol";
import {CollectionRouter} from "../routers/CollectionRouter.sol";
import {CollectionPoolETH} from "./CollectionPoolETH.sol";
import {ICurve} from "../bonding-curves/ICurve.sol";
import {CollectionPoolERC20} from ".//CollectionPoolERC20.sol";
import {CollectionPoolCloner} from "../lib/CollectionPoolCloner.sol";
import {ICollectionPoolFactory} from "./ICollectionPoolFactory.sol";
import {CollectionPoolEnumerableETH} from "./CollectionPoolEnumerableETH.sol";
import {CollectionPoolEnumerableERC20} from "./CollectionPoolEnumerableERC20.sol";
import {CollectionPoolMissingEnumerableETH} from "./CollectionPoolMissingEnumerableETH.sol";
import {CollectionPoolMissingEnumerableERC20} from "./CollectionPoolMissingEnumerableERC20.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";

contract CollectionPoolFactory is Ownable, ReentrancyGuard, ERC721, ERC721URIStorage, ICollectionPoolFactory {
    using CollectionPoolCloner for address;
    using SafeTransferLib for address payable;
    using SafeTransferLib for ERC20;

    bytes4 private constant _INTERFACE_ID_ERC2981 = 0x2a55205a;
    bytes4 private constant INTERFACE_ID_ERC721_ENUMERABLE = type(IERC721Enumerable).interfaceId;

    /**
     * @dev The MAX_PROTOCOL_FEE constant specifies the maximum fee that can be charged by the AMM pool contract
     * for facilitating token or NFT swaps on the decentralized exchange.
     * This fee is charged as a flat percentage of the final traded price for each swap,
     * and it is used to cover the costs associated with running the AMM pool contract and providing liquidity to the decentralized exchange.
     * This is used for NFT/TOKEN trading pools, that have a limited amount of dry powder
     */
    uint256 internal constant MAX_PROTOCOL_FEE = 0.1e6; // 10%, must <= 1 - MAX_FEE
    /**
     * @dev The MAX_CARRY_FEE constant specifies the maximum fee that can be charged by the AMM pool contract for facilitating token
     * or NFT swaps on the decentralized exchange. This fee is charged as a percentage of the fee set by the trading pool creator,
     * which is itself a percentage of the final traded price. This is used for TRADE pools, that form a continuous liquidity pool
     */
    uint256 internal constant MAX_CARRY_FEE = 0.5e6; // 50%

    // Mapping from token ID to pool address
    mapping(uint256 => address) private _poolAddresses;

    /// @dev The ID of the next token that will be minted. Skips 0
    uint256 internal _nextTokenId;

    address public constant ETH_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    CollectionPoolEnumerableETH public immutable enumerableETHTemplate;
    CollectionPoolMissingEnumerableETH public immutable missingEnumerableETHTemplate;
    CollectionPoolEnumerableERC20 public immutable enumerableERC20Template;
    CollectionPoolMissingEnumerableERC20 public immutable missingEnumerableERC20Template;
    address payable public override protocolFeeRecipient;

    // Units are in base 1e6
    uint24 public override protocolFeeMultiplier;

    // Units are in base 1e6
    uint24 public override carryFeeMultiplier;

    mapping(ICurve => bool) public bondingCurveAllowed;
    mapping(address => bool) public override callAllowed;

    struct RouterStatus {
        bool allowed;
        bool wasEverAllowed;
    }

    mapping(CollectionRouter => RouterStatus) public override routerStatus;

    string public baseURI;

    event NewPool(address poolAddress, uint256 tokenId);
    event TokenDeposit(address poolAddress);
    event NFTDeposit(address poolAddress);
    event ProtocolFeeRecipientUpdate(address recipientAddress);
    event ProtocolFeeMultiplierUpdate(uint24 newMultiplier);
    event CarryFeeMultiplierUpdate(uint24 newMultiplier);
    event BondingCurveStatusUpdate(ICurve bondingCurve, bool isAllowed);
    event CallTargetStatusUpdate(address target, bool isAllowed);
    event RouterStatusUpdate(CollectionRouter router, bool isAllowed);

    constructor(
        CollectionPoolEnumerableETH _enumerableETHTemplate,
        CollectionPoolMissingEnumerableETH _missingEnumerableETHTemplate,
        CollectionPoolEnumerableERC20 _enumerableERC20Template,
        CollectionPoolMissingEnumerableERC20 _missingEnumerableERC20Template,
        address payable _protocolFeeRecipient,
        uint24 _protocolFeeMultiplier,
        uint24 _carryFeeMultiplier
    ) ERC721("Collectionswap", "CollectionLP") {
        enumerableETHTemplate = _enumerableETHTemplate;
        missingEnumerableETHTemplate = _missingEnumerableETHTemplate;
        enumerableERC20Template = _enumerableERC20Template;
        missingEnumerableERC20Template = _missingEnumerableERC20Template;
        protocolFeeRecipient = _protocolFeeRecipient;

        require(_protocolFeeMultiplier <= MAX_PROTOCOL_FEE, "Protocol fee too large");
        protocolFeeMultiplier = _protocolFeeMultiplier;

        require(_carryFeeMultiplier <= MAX_CARRY_FEE, "Carry fee too large");
        carryFeeMultiplier = _carryFeeMultiplier;
    }

    /**
     * External functions
     */

    function setBaseURI(string calldata _uri) external onlyOwner {
        baseURI = _uri;
    }

    function setTokenURI(string calldata _uri, uint256 tokenId) external onlyOwner {
        _setTokenURI(tokenId, _uri);
    }

    function createPoolETH(CreateETHPoolParams calldata params)
        external
        payable
        returns (address pool, uint256 tokenId)
    {
        (pool, tokenId) = _createPoolETH(params);

        _initializePoolETH(CollectionPoolETH(payable(pool)), params, tokenId);
    }

    /**
     * @notice Creates a filtered pool contract using EIP-1167.
     * @param params The parameters to create ETH pool
     * @param filterParams The parameters needed for the filtering functionality
     * @return pool The new pool
     */
    function createPoolETHFiltered(CreateETHPoolParams calldata params, NFTFilterParams calldata filterParams)
        external
        payable
        returns (address pool, uint256 tokenId)
    {
        (pool, tokenId) = _createPoolETH(params);

        // Check if nfts are allowed before initializing to save gas on transferring nfts on revert.
        // If not, we could re-use createPoolETH and check later.
        CollectionPoolETH _pool = CollectionPoolETH(payable(pool));
        _pool.setTokenIDFilter(filterParams.merkleRoot, filterParams.encodedTokenIDs);
        require(
            _pool.acceptsTokenIDs(params.initialNFTIDs, filterParams.initialProof, filterParams.initialProofFlags),
            "NFT not allowed"
        );

        _initializePoolETH(_pool, params, tokenId);
    }

    function createPoolERC20(CreateERC20PoolParams calldata params) external returns (address pool, uint256 tokenId) {
        (pool, tokenId) = _createPoolERC20(params);

        _initializePoolERC20(CollectionPoolERC20(payable(pool)), params, tokenId);
    }

    function createPoolERC20Filtered(CreateERC20PoolParams calldata params, NFTFilterParams calldata filterParams)
        external
        returns (address pool, uint256 tokenId)
    {
        (pool, tokenId) = _createPoolERC20(params);

        // Check if nfts are allowed before initializing to save gas on transferring nfts on revert.
        // If not, we could re-use createPoolERC20 and check later.
        CollectionPoolERC20 _pool = CollectionPoolERC20(payable(pool));
        _pool.setTokenIDFilter(filterParams.merkleRoot, filterParams.encodedTokenIDs);
        require(
            _pool.acceptsTokenIDs(params.initialNFTIDs, filterParams.initialProof, filterParams.initialProofFlags),
            "NFT not allowed"
        );

        _initializePoolERC20(_pool, params, tokenId);
    }

    /**
     * @dev See {ICollectionPoolFactory-poolAddressOf}.
     */
    function poolAddressOf(uint256 tokenId) public view returns (address) {
        return _poolAddresses[tokenId];
    }

    /**
     * @notice Checks if an address is a CollectionPool. Uses the fact that the pools are EIP-1167 minimal proxies.
     * @param potentialPool The address to check
     * @param variant The pool variant (NFT is enumerable or not, pool uses ETH or ERC20)
     * @dev The PoolCloner contract is a utility contract that is used by the PoolFactory contract to create new instances of automated market maker (AMM) pools.
     * @return True if the address is the specified pool variant, false otherwise
     */
    function isPool(address potentialPool, PoolVariant variant) public view override returns (bool) {
        if (variant == PoolVariant.ENUMERABLE_ERC20) {
            return CollectionPoolCloner.isERC20PoolClone(address(this), address(enumerableERC20Template), potentialPool);
        } else if (variant == PoolVariant.MISSING_ENUMERABLE_ERC20) {
            return CollectionPoolCloner.isERC20PoolClone(
                address(this), address(missingEnumerableERC20Template), potentialPool
            );
        } else if (variant == PoolVariant.ENUMERABLE_ETH) {
            return CollectionPoolCloner.isETHPoolClone(address(this), address(enumerableETHTemplate), potentialPool);
        } else if (variant == PoolVariant.MISSING_ENUMERABLE_ETH) {
            return
                CollectionPoolCloner.isETHPoolClone(address(this), address(missingEnumerableETHTemplate), potentialPool);
        } else {
            // invalid input
            return false;
        }
    }

    /**
     * @notice Allows receiving ETH in order to receive protocol fees
     */
    receive() external payable {}

    /**
     * Admin functions
     */

    /**
     * @notice Withdraws the ETH balance to the protocol fee recipient.
     * Only callable by the owner.
     */
    function withdrawETHProtocolFees() external onlyOwner {
        protocolFeeRecipient.safeTransferETH(address(this).balance);
    }

    /**
     * @notice Withdraws ERC20 tokens to the protocol fee recipient. Only callable by the owner.
     * @param token The token to transfer
     * @param amount The amount of tokens to transfer
     */
    function withdrawERC20ProtocolFees(ERC20 token, uint256 amount) external onlyOwner {
        token.safeTransfer(protocolFeeRecipient, amount);
    }

    /**
     * @notice Changes the protocol fee recipient address. Only callable by the owner.
     * @param _protocolFeeRecipient The new fee recipient
     */
    function changeProtocolFeeRecipient(address payable _protocolFeeRecipient) external onlyOwner {
        require(_protocolFeeRecipient != address(0), "0 address");
        protocolFeeRecipient = _protocolFeeRecipient;
        emit ProtocolFeeRecipientUpdate(_protocolFeeRecipient);
    }

    /**
     * @notice Changes the protocol fee multiplier. Only callable by the owner.
     * @param _protocolFeeMultiplier The new fee multiplier, 18 decimals
     */
    function changeProtocolFeeMultiplier(uint24 _protocolFeeMultiplier) external onlyOwner {
        require(_protocolFeeMultiplier <= MAX_PROTOCOL_FEE, "Fee too large");
        protocolFeeMultiplier = _protocolFeeMultiplier;
        emit ProtocolFeeMultiplierUpdate(_protocolFeeMultiplier);
    }

    /**
     * @notice Changes the carry fee multiplier. Only callable by the owner.
     * @param _carryFeeMultiplier The new fee multiplier, 18 decimals
     */
    function changeCarryFeeMultiplier(uint24 _carryFeeMultiplier) external onlyOwner {
        require(_carryFeeMultiplier <= MAX_CARRY_FEE, "Fee too large");
        carryFeeMultiplier = _carryFeeMultiplier;
        emit CarryFeeMultiplierUpdate(_carryFeeMultiplier);
    }

    /**
     * @notice Sets the whitelist status of a bonding curve contract. Only callable by the owner.
     * @param bondingCurve The bonding curve contract
     * @param isAllowed True to whitelist, false to remove from whitelist
     */
    function setBondingCurveAllowed(ICurve bondingCurve, bool isAllowed) external onlyOwner {
        bondingCurveAllowed[bondingCurve] = isAllowed;
        emit BondingCurveStatusUpdate(bondingCurve, isAllowed);
    }

    /**
     * @notice Sets the whitelist status of a contract to be called arbitrarily by a pool.
     * Only callable by the owner.
     * @param target The target contract
     * @param isAllowed True to whitelist, false to remove from whitelist
     */
    function setCallAllowed(address payable target, bool isAllowed) external onlyOwner {
        // ensure target is not / was not ever a router
        if (isAllowed) {
            require(!routerStatus[CollectionRouter(target)].wasEverAllowed, "Can't call router");
        }

        callAllowed[target] = isAllowed;
        emit CallTargetStatusUpdate(target, isAllowed);
    }

    /**
     * @notice Updates the router whitelist. Only callable by the owner.
     * @param _router The router
     * @param isAllowed True to whitelist, false to remove from whitelist
     */
    function setRouterAllowed(CollectionRouter _router, bool isAllowed) external onlyOwner {
        // ensure target is not arbitrarily callable by pools
        if (isAllowed) {
            require(!callAllowed[address(_router)], "Can't call router");
        }
        routerStatus[_router] = RouterStatus({allowed: isAllowed, wasEverAllowed: true});

        emit RouterStatusUpdate(_router, isAllowed);
    }

    /**
     * Internal functions
     */
    function _baseURI() internal view override returns (string memory) {
        return baseURI;
    }

    function _createPoolETH(CreateETHPoolParams calldata params) internal returns (address pool, uint256 tokenId) {
        require(bondingCurveAllowed[params.bondingCurve], "Bonding curve not whitelisted");

        require(
            params.royaltyNumerator == 0 || IERC165(params.nft).supportsInterface(_INTERFACE_ID_ERC2981)
                || params.royaltyRecipientFallback != address(0),
            "Nonzero royalty for non ERC2981 without fallback"
        );

        // Check to see if the NFT supports Enumerable to determine which template to use
        address template;
        try IERC165(address(params.nft)).supportsInterface(INTERFACE_ID_ERC721_ENUMERABLE) returns (bool isEnumerable) {
            template = isEnumerable ? address(enumerableETHTemplate) : address(missingEnumerableETHTemplate);
        } catch {
            template = address(missingEnumerableETHTemplate);
        }

        pool = template.cloneETHPool(this, params.bondingCurve, params.nft, uint8(params.poolType));

        // issue new token
        tokenId = mint(params.receiver);

        // save pool address in mapping
        _poolAddresses[tokenId] = pool;

        emit NewPool(pool, tokenId);
    }

    function _initializePoolETH(CollectionPoolETH _pool, CreateETHPoolParams calldata _params, uint256 tokenId)
        internal
    {
        // initialize pool
        _pool.initialize(
            tokenId,
            _params.assetRecipient,
            _params.delta,
            _params.fee,
            _params.spotPrice,
            _params.props,
            _params.state,
            _params.royaltyNumerator,
            _params.royaltyRecipientFallback
        );

        // transfer initial ETH to pool
        payable(address(_pool)).safeTransferETH(msg.value);

        // transfer initial NFTs from sender to pool and notify pool
        _depositNFTs(_params.nft, _params.initialNFTIDs, _pool, msg.sender);
    }

    function _createPoolERC20(CreateERC20PoolParams calldata params) internal returns (address pool, uint256 tokenId) {
        require(bondingCurveAllowed[params.bondingCurve], "Bonding curve not whitelisted");

        require(
            params.royaltyNumerator == 0 || IERC165(params.nft).supportsInterface(_INTERFACE_ID_ERC2981)
                || params.royaltyRecipientFallback != address(0),
            "Nonzero royalty for non ERC2981 without fallback"
        );

        // Check to see if the NFT supports Enumerable to determine which template to use
        address template;
        try IERC165(address(params.nft)).supportsInterface(INTERFACE_ID_ERC721_ENUMERABLE) returns (bool isEnumerable) {
            template = isEnumerable ? address(enumerableERC20Template) : address(missingEnumerableERC20Template);
        } catch {
            template = address(missingEnumerableERC20Template);
        }

        pool = template.cloneERC20Pool(this, params.bondingCurve, params.nft, uint8(params.poolType), params.token);

        // issue new token
        tokenId = mint(params.receiver);

        // save pool address in mapping
        _poolAddresses[tokenId] = pool;

        emit NewPool(pool, tokenId);
    }

    function _initializePoolERC20(CollectionPoolERC20 _pool, CreateERC20PoolParams calldata _params, uint256 tokenId)
        internal
    {
        // initialize pool
        _pool.initialize(
            tokenId,
            _params.assetRecipient,
            _params.delta,
            _params.fee,
            _params.spotPrice,
            _params.props,
            _params.state,
            _params.royaltyNumerator,
            _params.royaltyRecipientFallback
        );

        // transfer initial tokens to pool
        _params.token.safeTransferFrom(msg.sender, address(_pool), _params.initialTokenBalance);

        // transfer initial NFTs from sender to pool and notify pool
        _depositNFTs(_params.nft, _params.initialNFTIDs, _pool, msg.sender);
    }

    /**
     * @dev Used to deposit NFTs into a pool after creation and emit an event for indexing (if recipient is indeed a pool)
     */
    function depositNFTs(
        uint256[] calldata ids,
        bytes32[] calldata proof,
        bool[] calldata proofFlags,
        address recipient,
        address from
    ) external {
        bool _isPool = isPool(recipient, PoolVariant.ENUMERABLE_ERC20) || isPool(recipient, PoolVariant.ENUMERABLE_ETH)
            || isPool(recipient, PoolVariant.MISSING_ENUMERABLE_ERC20)
            || isPool(recipient, PoolVariant.MISSING_ENUMERABLE_ETH);

        require(_isPool, "Not a pool");

        CollectionPool pool = CollectionPool(recipient);
        require(pool.acceptsTokenIDs(ids, proof, proofFlags), "NFTs not allowed");

        // transfer NFTs from caller to recipient
        _depositNFTs(pool.nft(), ids, pool, from);

        emit NFTDeposit(recipient);
    }

    /**
     * @dev Transfers NFTs from sender and notifies pool. `ids` must already have been verified
     */
    function _depositNFTs(IERC721 _nft, uint256[] calldata nftIds, CollectionPool pool, address from) internal {
        // transfer NFTs from caller to recipient
        TransferLib.bulkSafeTransferERC721From(_nft, from, address(pool), nftIds);
        pool.depositNFTsNotification(nftIds);
    }

    /**
     * @dev Used to deposit ERC20s into a pool after creation and emit an event for indexing (if recipient is indeed an ERC20 pool
     * and the token matches)
     */
    function depositERC20(ERC20 token, address recipient, uint256 amount) external {
        token.safeTransferFrom(msg.sender, recipient, amount);
        if (isPool(recipient, PoolVariant.ENUMERABLE_ERC20) || isPool(recipient, PoolVariant.MISSING_ENUMERABLE_ERC20))
        {
            if (token == CollectionPoolERC20(recipient).token()) {
                emit TokenDeposit(recipient);
            }
        }
    }

    function requireAuthorizedForToken(address spender, uint256 tokenId) external view {
        require(_isApprovedOrOwner(spender, tokenId), "Not approved");
    }

    /*
     * @notice NFTs that don't match filter and any airdropped assets  must be rescued prior to calling this function.
     * Requires LP token owner to give allowance to this factory contract for asset withdrawals
     * which are sent directly to the LP token owner.
     */
    function burn(uint256 tokenId) external nonReentrant {
        require(_isApprovedOrOwner(msg.sender, tokenId), "Not approved");
        address poolAddress = poolAddressOf(tokenId);
        CollectionPool pool = CollectionPool(poolAddress);
        PoolVariant poolVariant = pool.poolVariant();

        // withdraw all ETH / ERC20
        if (poolVariant == PoolVariant.ENUMERABLE_ETH || poolVariant == PoolVariant.MISSING_ENUMERABLE_ETH) {
            // withdraw ETH, sent to owner of LP token
            CollectionPoolETH(payable(poolAddress)).withdrawAllETH();
        } else if (poolVariant == PoolVariant.ENUMERABLE_ERC20 || poolVariant == PoolVariant.MISSING_ENUMERABLE_ERC20) {
            // withdraw ERC20
            CollectionPoolERC20(poolAddress).withdrawAllERC20();
        }
        // then withdraw NFTs
        pool.withdrawERC721(pool.nft(), pool.getAllHeldIds());

        delete _poolAddresses[tokenId];
        _burn(tokenId);
    }

    function mint(address recipient) internal returns (uint256 tokenId) {
        _safeMint(recipient, (tokenId = ++_nextTokenId));
    }

    // overrides required by Solidiity for ERC721 contract
    // The following functions are overrides required by Solidity.

    function _beforeTokenTransfer(address from, address to, uint256 tokenId) internal override (ERC721) {
        super._beforeTokenTransfer(from, to, tokenId);
    }

    function _burn(uint256 tokenId) internal override (ERC721, ERC721URIStorage) {
        super._burn(tokenId);
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override (IERC165, ERC721) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function tokenURI(uint256 tokenId) public view override (ERC721, ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }
}
