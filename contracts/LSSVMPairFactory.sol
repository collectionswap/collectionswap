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
import {ReentrancyGuard} from "./lib/ReentrancyGuard.sol";

import {LSSVMPair} from "./LSSVMPair.sol";
import {LSSVMRouter} from "./LSSVMRouter.sol";
import {LSSVMPairETH} from "./LSSVMPairETH.sol";
import {ICurve} from "./bonding-curves/ICurve.sol";
import {LSSVMPairERC20} from "./LSSVMPairERC20.sol";
import {LSSVMPairCloner} from "./lib/LSSVMPairCloner.sol";
import {ILSSVMPairFactory} from "./ILSSVMPairFactory.sol";
import {LSSVMPairEnumerableETH} from "./LSSVMPairEnumerableETH.sol";
import {LSSVMPairEnumerableERC20} from "./LSSVMPairEnumerableERC20.sol";
import {LSSVMPairMissingEnumerableETH} from "./LSSVMPairMissingEnumerableETH.sol";
import {LSSVMPairMissingEnumerableERC20} from "./LSSVMPairMissingEnumerableERC20.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";

contract LSSVMPairFactory is Ownable, ReentrancyGuard, ERC721, ERC721Enumerable, ERC721URIStorage, ILSSVMPairFactory {
    using LSSVMPairCloner for address;
    using SafeTransferLib for address payable;
    using SafeTransferLib for ERC20;

    bytes4 private constant _INTERFACE_ID_ERC2981 = 0x2a55205a;
    bytes4 private constant INTERFACE_ID_ERC721_ENUMERABLE =
        type(IERC721Enumerable).interfaceId;

    /**
     * @dev The MAX_PROTOCOL_FEE constant specifies the maximum fee that can be charged by the AMM pair contract 
     * for facilitating token or NFT swaps on the decentralized exchange. 
     * This fee is charged as a flat percentage of the final traded price for each swap, 
     * and it is used to cover the costs associated with running the AMM pair contract and providing liquidity to the decentralized exchange.
     * This is used for NFT/TOKEN trading pairs, that have a limited amount of dry powder
     */
    uint256 internal constant MAX_PROTOCOL_FEE = 0.10e18; // 10%, must <= 1 - MAX_FEE
    /**
     * @dev The MAX_CARRY_FEE constant specifies the maximum fee that can be charged by the AMM pair contract for facilitating token 
     * or NFT swaps on the decentralized exchange. This fee is charged as a percentage of the fee set by the trading pair creator, 
     * which is itself a percentage of the final traded price. This is used for TRADE pairs, that form a continuous liquidity pool
     */
    uint256 internal constant MAX_CARRY_FEE = 0.50e18; // 50%
    
    /// @dev maps the tokenID to the pair address created
    mapping(uint256 => LPTokenParams721) internal _tokenIdToPairParams;
    /// @dev The ID of the next token that will be minted. Skips 0
    uint256 internal _nextTokenId;

    event NewTokenId(uint256 tokenId);

    address public constant ETH_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    LSSVMPairEnumerableETH public immutable enumerableETHTemplate;
    LSSVMPairMissingEnumerableETH public immutable missingEnumerableETHTemplate;
    LSSVMPairEnumerableERC20 public immutable enumerableERC20Template;
    LSSVMPairMissingEnumerableERC20
        public immutable missingEnumerableERC20Template;
    address payable public override protocolFeeRecipient;

    // Units are in base 1e18
    uint256 public override protocolFeeMultiplier;

    // Units are in base 1e18
    uint256 public override carryFeeMultiplier;

    mapping(ICurve => bool) public bondingCurveAllowed;
    mapping(address => bool) public override callAllowed;
    struct RouterStatus {
        bool allowed;
        bool wasEverAllowed;
    }
    mapping(LSSVMRouter => RouterStatus) public override routerStatus;

    string public baseURI;

    event NewPair(address poolAddress);
    event TokenDeposit(address poolAddress);
    event NFTDeposit(address poolAddress);
    event ProtocolFeeRecipientUpdate(address recipientAddress);
    event ProtocolFeeMultiplierUpdate(uint256 newMultiplier);
    event CarryFeeMultiplierUpdate(uint256 newMultiplier);
    event BondingCurveStatusUpdate(ICurve bondingCurve, bool isAllowed);
    event CallTargetStatusUpdate(address target, bool isAllowed);
    event RouterStatusUpdate(LSSVMRouter router, bool isAllowed);

    constructor(
        LSSVMPairEnumerableETH _enumerableETHTemplate,
        LSSVMPairMissingEnumerableETH _missingEnumerableETHTemplate,
        LSSVMPairEnumerableERC20 _enumerableERC20Template,
        LSSVMPairMissingEnumerableERC20 _missingEnumerableERC20Template,
        address payable _protocolFeeRecipient,
        uint256 _protocolFeeMultiplier,
        uint256 _carryFeeMultiplier
    ) ERC721("Collectionswap","CollectionLP") {
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

    function createPairETH(
        CreateETHPairParams calldata params
    ) external payable returns (address pair, uint256 tokenId) {
        require(
            bondingCurveAllowed[params.bondingCurve],
            "Bonding curve not whitelisted"
        );

        require(
            params.royaltyNumerator == 0 || 
            IERC165(params.nft).supportsInterface(_INTERFACE_ID_ERC2981) ||
            params.royaltyRecipientOverride != address(0),
            "Nonzero royalty for non ERC2981 without override"
        );
        
        // Check to see if the NFT supports Enumerable to determine which template to use
        address template;
        try IERC165(address(params.nft)).supportsInterface(INTERFACE_ID_ERC721_ENUMERABLE) returns (bool isEnumerable) {
          template = isEnumerable ? address(enumerableETHTemplate)
            : address(missingEnumerableETHTemplate);
        } catch {
          template = address(missingEnumerableETHTemplate);
        }

        pair = template.cloneETHPair(
            this,
            params.bondingCurve,
            params.nft,
            uint8(params.poolType)
        );

        // issue new token
        tokenId = mint(params.receiver);

        // save params in mapping
        _tokenIdToPairParams[tokenId] = LPTokenParams721({
            nftAddress: address(params.nft),
            bondingCurveAddress: address(params.bondingCurve),
            tokenAddress: ETH_ADDRESS,
            poolAddress: payable(pair),
            fee: params.fee,
            delta: params.delta,
            royaltyNumerator: params.royaltyNumerator,
            initialSpotPrice: params.spotPrice,
            initialPoolBalance: msg.value,
            initialNFTIDsLength: params.initialNFTIDs.length
        });

        _initializePairETH(
            LSSVMPairETH(payable(pair)),
            params,
            tokenId
        );

        emit NewPair(pair);
    }

    /**
        @notice Creates a filtered pair contract using EIP-1167.
        @param params The parameters to create ETH pair
        @param filterParams The parameters needed for the filtering functionality
        @return pair The new pair
     */
    function createPairETHFiltered(
        CreateETHPairParams calldata params,
        NFTFilterParams calldata filterParams
    ) external payable returns (address pair, uint256 tokenId) {
        require(
            bondingCurveAllowed[params.bondingCurve],
            "Bonding curve not whitelisted"
        );

        require(
            params.royaltyNumerator == 0 || 
            IERC165(params.nft).supportsInterface(_INTERFACE_ID_ERC2981) ||
            params.royaltyRecipientOverride != address(0),
            "Nonzero royalty for non ERC2981 without override"
        );

        // Check to see if the NFT supports Enumerable to determine which template to use
        address template;
        try IERC165(address(params.nft)).supportsInterface(INTERFACE_ID_ERC721_ENUMERABLE) returns (bool isEnumerable) {
          template = isEnumerable ? address(enumerableETHTemplate)
            : address(missingEnumerableETHTemplate);
        } catch {
          template = address(missingEnumerableETHTemplate);
        }

        pair = template.cloneETHPair(
            this,
            params.bondingCurve,
            params.nft,
            uint8(params.poolType)
        );

        // issue new token
        tokenId = mint(params.receiver);

        // save params in mapping
        _tokenIdToPairParams[tokenId] = LPTokenParams721({
            nftAddress: address(params.nft),
            bondingCurveAddress: address(params.bondingCurve),
            tokenAddress: ETH_ADDRESS,
            poolAddress: payable(pair),
            fee: params.fee,
            delta: params.delta,
            royaltyNumerator: params.royaltyNumerator,
            initialSpotPrice: params.spotPrice,
            initialPoolBalance: msg.value,
            initialNFTIDsLength: params.initialNFTIDs.length
        });

        _initializePairETHFiltered(
            LSSVMPairETH(payable(pair)),
            params,
            filterParams,
            tokenId
        );
        emit NewPair(pair);
    }

    function createPairERC20(CreateERC20PairParams calldata params)
        external
        returns (address pair, uint256 tokenId)
    {
        require(
            bondingCurveAllowed[params.bondingCurve],
            "Bonding curve not whitelisted"
        );

        require(
            params.royaltyNumerator == 0 || 
            IERC165(params.nft).supportsInterface(_INTERFACE_ID_ERC2981) ||
            params.royaltyRecipientOverride != address(0),
            "Nonzero royalty for non ERC2981 without override"
        );

        // Check to see if the NFT supports Enumerable to determine which template to use
        address template;
        try IERC165(address(params.nft)).supportsInterface(INTERFACE_ID_ERC721_ENUMERABLE) returns (bool isEnumerable) {
          template = isEnumerable ? address(enumerableERC20Template)
            : address(missingEnumerableERC20Template);
        } catch {
          template = address(missingEnumerableERC20Template);
        }

        pair = template.cloneERC20Pair(
            this,
            params.bondingCurve,
            params.nft,
            uint8(params.poolType),
            params.token
        );

        // issue new token
        tokenId = mint(params.receiver);

        // save params in mapping
        _tokenIdToPairParams[tokenId] = LPTokenParams721({
            nftAddress: address(params.nft),
            bondingCurveAddress: address(params.bondingCurve),
            tokenAddress: address(params.token),
            poolAddress: payable(pair),
            fee: params.fee,
            delta: params.delta,
            royaltyNumerator: params.royaltyNumerator,
            initialSpotPrice: params.spotPrice,
            initialPoolBalance: params.initialTokenBalance,
            initialNFTIDsLength: params.initialNFTIDs.length
        });

        _initializePairERC20(
            LSSVMPairERC20(payable(pair)),
            params,
            tokenId
        );

        emit NewPair(pair);
    }

    function createPairERC20Filtered(
        CreateERC20PairParams calldata params,
        NFTFilterParams calldata filterParams
    )
        external
        returns (address pair, uint256 tokenId)
    {
        require(
            bondingCurveAllowed[params.bondingCurve],
            "Bonding curve not whitelisted"
        );

        require(
            params.royaltyNumerator == 0 || 
            IERC165(params.nft).supportsInterface(_INTERFACE_ID_ERC2981) ||
            params.royaltyRecipientOverride != address(0),
            "Nonzero royalty for non ERC2981 without override"
        );

        // Check to see if the NFT supports Enumerable to determine which template to use
        address template;
        try IERC165(address(params.nft)).supportsInterface(INTERFACE_ID_ERC721_ENUMERABLE) returns (bool isEnumerable) {
          template = isEnumerable ? address(enumerableERC20Template)
            : address(missingEnumerableERC20Template);
        } catch {
          template = address(missingEnumerableERC20Template);
        }

        pair = template.cloneERC20Pair(
            this,
            params.bondingCurve,
            params.nft,
            uint8(params.poolType),
            params.token
        );

        // issue new token
        tokenId = mint(params.receiver);

        // save params in mapping
        _tokenIdToPairParams[tokenId] = LPTokenParams721({
            nftAddress: address(params.nft),
            bondingCurveAddress: address(params.bondingCurve),
            tokenAddress: address(params.token),
            poolAddress: payable(pair),
            fee: params.fee,
            delta: params.delta,
            royaltyNumerator: params.royaltyNumerator,
            initialSpotPrice: params.spotPrice,
            initialPoolBalance: params.initialTokenBalance,
            initialNFTIDsLength: params.initialNFTIDs.length
        });

        _initializePairERC20Filtered(
            LSSVMPairERC20(payable(pair)),
            params,
            filterParams,
            tokenId
        );

        emit NewPair(address(pair));
    }

    /**
     * @return poolParams the parameters of the pool matching `tokenId`.
     */
    function viewPoolParams(uint256 tokenId)
        public
        view
        returns (LPTokenParams721 memory poolParams)
    {
        poolParams = _tokenIdToPairParams[tokenId];
    }

    /**
        @notice Checks if an address is a LSSVMPair. Uses the fact that the pairs are EIP-1167 minimal proxies.
        @param potentialPair The address to check
        @param variant The pair variant (NFT is enumerable or not, pair uses ETH or ERC20)
        @dev The PairCloner contract is a utility contract that is used by the PairFactory contract to create new instances of automated market maker (AMM) pairs. 
        @return True if the address is the specified pair variant, false otherwise
     */
    function isPair(address potentialPair, PairVariant variant)
        public
        view
        override
        returns (bool)
    {
        if (variant == PairVariant.ENUMERABLE_ERC20) {
            return
                LSSVMPairCloner.isERC20PairClone(
                    address(this),
                    address(enumerableERC20Template),
                    potentialPair
                );
        } else if (variant == PairVariant.MISSING_ENUMERABLE_ERC20) {
            return
                LSSVMPairCloner.isERC20PairClone(
                    address(this),
                    address(missingEnumerableERC20Template),
                    potentialPair
                );
        } else if (variant == PairVariant.ENUMERABLE_ETH) {
            return
                LSSVMPairCloner.isETHPairClone(
                    address(this),
                    address(enumerableETHTemplate),
                    potentialPair
                );
        } else if (variant == PairVariant.MISSING_ENUMERABLE_ETH) {
            return
                LSSVMPairCloner.isETHPairClone(
                    address(this),
                    address(missingEnumerableETHTemplate),
                    potentialPair
                );
        } else {
            // invalid input
            return false;
        }
    }

    /**
        @notice Allows receiving ETH in order to receive protocol fees
     */
    receive() external payable {}

    /**
     * Admin functions
     */

    /**
        @notice Withdraws the ETH balance to the protocol fee recipient.
        Only callable by the owner.
     */
    function withdrawETHProtocolFees() external onlyOwner {
        protocolFeeRecipient.safeTransferETH(address(this).balance);
    }

    /**
        @notice Withdraws ERC20 tokens to the protocol fee recipient. Only callable by the owner.
        @param token The token to transfer
        @param amount The amount of tokens to transfer
     */
    function withdrawERC20ProtocolFees(ERC20 token, uint256 amount)
        external
        onlyOwner
    {
        token.safeTransfer(protocolFeeRecipient, amount);
    }

    /**
        @notice Changes the protocol fee recipient address. Only callable by the owner.
        @param _protocolFeeRecipient The new fee recipient
     */
    function changeProtocolFeeRecipient(address payable _protocolFeeRecipient)
        external
        onlyOwner
    {
        require(_protocolFeeRecipient != address(0), "0 address");
        protocolFeeRecipient = _protocolFeeRecipient;
        emit ProtocolFeeRecipientUpdate(_protocolFeeRecipient);
    }

    /**
        @notice Changes the protocol fee multiplier. Only callable by the owner.
        @param _protocolFeeMultiplier The new fee multiplier, 18 decimals
     */
    function changeProtocolFeeMultiplier(uint256 _protocolFeeMultiplier)
        external
        onlyOwner
    {
        require(_protocolFeeMultiplier <= MAX_PROTOCOL_FEE, "Fee too large");
        protocolFeeMultiplier = _protocolFeeMultiplier;
        emit ProtocolFeeMultiplierUpdate(_protocolFeeMultiplier);
    }

    /**
        @notice Changes the carry fee multiplier. Only callable by the owner.
        @param _carryFeeMultiplier The new fee multiplier, 18 decimals
     */
    function changeCarryFeeMultiplier(uint256 _carryFeeMultiplier)
        external
        onlyOwner
    {
        require(_carryFeeMultiplier <= MAX_CARRY_FEE, "Fee too large");
        carryFeeMultiplier = _carryFeeMultiplier;
        emit CarryFeeMultiplierUpdate(_carryFeeMultiplier);
    }

    /**
        @notice Sets the whitelist status of a bonding curve contract. Only callable by the owner.
        @param bondingCurve The bonding curve contract
        @param isAllowed True to whitelist, false to remove from whitelist
     */
    function setBondingCurveAllowed(ICurve bondingCurve, bool isAllowed)
        external
        onlyOwner
    {
        bondingCurveAllowed[bondingCurve] = isAllowed;
        emit BondingCurveStatusUpdate(bondingCurve, isAllowed);
    }

    /**
        @notice Sets the whitelist status of a contract to be called arbitrarily by a pair.
        Only callable by the owner.
        @param target The target contract
        @param isAllowed True to whitelist, false to remove from whitelist
     */
    function setCallAllowed(address payable target, bool isAllowed)
        external
        onlyOwner
    {
        // ensure target is not / was not ever a router
        if (isAllowed) {
            require(
                !routerStatus[LSSVMRouter(target)].wasEverAllowed,
                "Can't call router"
            );
        }

        callAllowed[target] = isAllowed;
        emit CallTargetStatusUpdate(target, isAllowed);
    }

    /**
        @notice Updates the router whitelist. Only callable by the owner.
        @param _router The router
        @param isAllowed True to whitelist, false to remove from whitelist
     */
    function setRouterAllowed(LSSVMRouter _router, bool isAllowed)
        external
        onlyOwner
    {
        // ensure target is not arbitrarily callable by pairs
        if (isAllowed) {
            require(!callAllowed[address(_router)], "Can't call router");
        }
        routerStatus[_router] = RouterStatus({
            allowed: isAllowed,
            wasEverAllowed: true
        });

        emit RouterStatusUpdate(_router, isAllowed);
    }

    /**
     * Internal functions
     */
    function _baseURI() internal view override returns (string memory) {
        return baseURI;
    }

    function _initializePairETH(
        LSSVMPairETH _pair,
        CreateETHPairParams calldata _params,
        uint256 tokenId
    ) internal {
        // initialize pair
        _pair.initialize(
            tokenId, 
            _params.assetRecipient, 
            _params.delta, 
            _params.fee, 
            _params.spotPrice, 
            _params.props, 
            _params.state, 
            _params.royaltyNumerator,
            _params.royaltyRecipientOverride
        );

        // transfer initial ETH to pair
        payable(address(_pair)).safeTransferETH(msg.value);

        // transfer initial NFTs from sender to pair
        uint256 numNFTs = _params.initialNFTIDs.length;
        for (uint256 i; i < numNFTs; ) {
            _params.nft.safeTransferFrom(
                msg.sender,
                address(_pair),
                _params.initialNFTIDs[i]
            );

            unchecked {
                ++i;
            }
        }
    }

    function _initializePairETHFiltered(
        LSSVMPairETH _pair,
        CreateETHPairParams calldata _params,
        NFTFilterParams calldata _filterParams,
        uint256 tokenId
    ) internal {
        // initialize pair
        _pair.initialize(
            tokenId,
            _params.assetRecipient,
            _params.delta,
            _params.fee,
            _params.spotPrice,
            _params.props,
            _params.state,
            _params.royaltyNumerator,
            _params.royaltyRecipientOverride
        );
        _pair.setTokenIDFilter(_filterParams.merkleRoot, _filterParams.encodedTokenIDs);

        require(_pair.acceptsTokenIDs(_params.initialNFTIDs, _filterParams.initialProof, _filterParams.initialProofFlags), "NFT not allowed");

        // transfer initial ETH to pair
        payable(address(_pair)).safeTransferETH(msg.value);

        // transfer initial NFTs from sender to pair
        uint256 numNFTs = _params.initialNFTIDs.length;
        for (uint256 i; i < numNFTs; ) {
            _params.nft.safeTransferFrom(
                msg.sender,
                address(_pair),
                _params.initialNFTIDs[i]
            );

            unchecked {
                ++i;
            }
        }
    }

    function _initializePairERC20(
        LSSVMPairERC20 _pair,
        CreateERC20PairParams calldata _params,
        uint256 tokenId
    ) internal {
        // initialize pair
        _pair.initialize(
            tokenId, 
            _params.assetRecipient, 
            _params.delta, 
            _params.fee, 
            _params.spotPrice, 
            _params.props, 
            _params.state, 
            _params.royaltyNumerator,
            _params.royaltyRecipientOverride
        );

        // transfer initial tokens to pair
        _params.token.safeTransferFrom(
            msg.sender,
            address(_pair),
                _params.initialTokenBalance
        );

        // transfer initial NFTs from sender to pair
        uint256 numNFTs = _params.initialNFTIDs.length;
        for (uint256 i; i < numNFTs; ) {
            _params.nft.safeTransferFrom(
                msg.sender,
                address(_pair),
                _params.initialNFTIDs[i]
            );

            unchecked {
                ++i;
            }
        }
    }

    function _initializePairERC20Filtered(
        LSSVMPairERC20 _pair,
        CreateERC20PairParams calldata _params,
        NFTFilterParams calldata _filterParams,
        uint256 tokenId
    ) internal {
        // initialize pair
        _pair.initialize(
            tokenId,
            _params.assetRecipient,
            _params.delta,
            _params.fee,
            _params.spotPrice,
            _params.props,
            _params.state,
            _params.royaltyNumerator,
            _params.royaltyRecipientOverride
        );
        _pair.setTokenIDFilter(_filterParams.merkleRoot, _filterParams.encodedTokenIDs);

        require(_pair.acceptsTokenIDs(_params.initialNFTIDs, _filterParams.initialProof, _filterParams.initialProofFlags), "NFT not allowed");

        // transfer initial tokens to pair
        _params.token.safeTransferFrom(
            msg.sender,
            address(_pair),
            _params.initialTokenBalance
        );

        // transfer initial NFTs from sender to pair
        uint256 numNFTs = _params.initialNFTIDs.length;
        for (uint256 i; i < numNFTs; ) {
            _params.nft.safeTransferFrom(
                msg.sender,
                address(_pair),
                _params.initialNFTIDs[i]
            );

            unchecked {
                ++i;
            }
        }
    }

    /**
      @dev Used to deposit NFTs into a pair after creation and emit an event for indexing (if recipient is indeed a pair)
    */
    function depositNFTs(
        IERC721 _nft,
        uint256[] calldata ids,
        bytes32[] calldata proof,
        bool[] calldata proofFlags,
        address recipient
    ) external {
        bool _isPair =
            isPair(recipient, PairVariant.ENUMERABLE_ERC20) ||
            isPair(recipient, PairVariant.ENUMERABLE_ETH) ||
            isPair(recipient, PairVariant.MISSING_ENUMERABLE_ERC20) ||
            isPair(recipient, PairVariant.MISSING_ENUMERABLE_ETH);

        if (_isPair) {
            require(LSSVMPair(recipient).acceptsTokenIDs(ids, proof, proofFlags), "NFT not allowed");
        }

        // transfer NFTs from caller to recipient
        uint256 numNFTs = ids.length;
        for (uint256 i; i < numNFTs; ) {
            _nft.safeTransferFrom(msg.sender, recipient, ids[i]);

            unchecked { ++i; }
        }

        if (_isPair) {
            emit NFTDeposit(recipient);
        }
    }

    /**
      @dev Used to deposit ERC20s into a pair after creation and emit an event for indexing (if recipient is indeed an ERC20 pair 
      and the token matches)
     */
    function depositERC20(
        ERC20 token,
        address recipient,
        uint256 amount
    ) external {
        token.safeTransferFrom(msg.sender, recipient, amount);
        if (
            isPair(recipient, PairVariant.ENUMERABLE_ERC20) ||
            isPair(recipient, PairVariant.MISSING_ENUMERABLE_ERC20)
        ) {
            if (token == LSSVMPairERC20(recipient).token()) {
                emit TokenDeposit(recipient);
            }
        }
    }

    function requireAuthorizedForToken(address spender, uint256 tokenId) external view {
        require(_isApprovedOrOwner(spender, tokenId), "Not approved");
    }

    /// @dev requires LP token owner to give allowance to this factory contract for asset withdrawals
    /// @dev withdrawn assets are sent directly to the LPToken owner
    /// @dev does not withdraw airdropped assets, that should be done prior to calling this function
    function burn(uint256 tokenId) external nonReentrant {
        require(_isApprovedOrOwner(msg.sender, tokenId), "Not approved");
        LPTokenParams721 memory poolParams = viewPoolParams(tokenId);
        uint256[] memory heldNftIds;

        // withdraw all ETH / ERC20
        if (poolParams.tokenAddress == ETH_ADDRESS) {
            // withdraw ETH, sent to owner of LPToken
            LSSVMPairETH pool = LSSVMPairETH(poolParams.poolAddress);
            pool.withdrawAllETH();

            // then withdraw NFTs
            heldNftIds = pool.getAllHeldIds();
            pool.withdrawERC721(IERC721(poolParams.nftAddress), heldNftIds);
            
        } else {
            // withdraw ERC20
            LSSVMPairERC20 pool = LSSVMPairERC20(poolParams.poolAddress);
            pool.withdrawAllERC20();
            heldNftIds = pool.getAllHeldIds();

            // then withdraw NFTs
            heldNftIds = pool.getAllHeldIds();
            pool.withdrawERC721(IERC721(poolParams.nftAddress), heldNftIds);
        }

        delete _tokenIdToPairParams[tokenId];
        _burn(tokenId);
    }

    function mint(address recipient) internal returns (uint256 tokenId) {
        _safeMint(recipient, (tokenId = ++_nextTokenId));

        emit NewTokenId(tokenId);
    }

    /// @inheritdoc ILSSVMPairFactory
    function validatePoolParamsLte(
        uint256 tokenId,
        address nftAddress,
        address bondingCurveAddress,
        uint96 fee,
        uint128 delta,
        uint256 royaltyNumerator
    ) public view returns (bool) {    
        LPTokenParams721 memory poolParams = viewPoolParams(tokenId);
        return (
            poolParams.nftAddress == nftAddress &&
            poolParams.bondingCurveAddress == bondingCurveAddress &&
            poolParams.fee <= fee &&
            poolParams.delta <= delta &&
            poolParams.royaltyNumerator <= royaltyNumerator
        );
    }

    /// @inheritdoc ILSSVMPairFactory
    function validatePoolParamsEq(
        uint256 tokenId,
        address nftAddress,
        address bondingCurveAddress,
        uint96 fee,
        uint128 delta,
        uint256 royaltyNumerator
    ) public view returns (bool) {    
        LPTokenParams721 memory poolParams = viewPoolParams(tokenId);
        return (
            poolParams.nftAddress == nftAddress &&
            poolParams.bondingCurveAddress == bondingCurveAddress &&
            poolParams.fee == fee &&
            poolParams.delta == delta &&
            poolParams.royaltyNumerator <= royaltyNumerator
        );
    }

    // overrides required by Solidiity for ERC721 contract
    // The following functions are overrides required by Solidity.

    function _beforeTokenTransfer(address from, address to, uint256 tokenId)
        internal
        override (ERC721, ERC721Enumerable)
    {
        super._beforeTokenTransfer(from, to, tokenId);
    }

    function _burn(uint256 tokenId) internal override (ERC721, ERC721URIStorage) {
        super._burn(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override (IERC165, ERC721, ERC721Enumerable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function tokenURI(uint256 tokenId) public view override (ERC721, ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }
}
