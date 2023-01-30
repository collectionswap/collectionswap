// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {SafeTransferLib} from "solmate/src/utils/SafeTransferLib.sol";
import {ERC20} from "solmate/src/tokens/ERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ICollectionPool} from "./ICollectionPool.sol";
import {CollectionPool} from "./CollectionPool.sol";
import {ICollectionPoolFactory} from "./ICollectionPoolFactory.sol";
import {CollectionRouter} from "../routers/CollectionRouter.sol";
import {ICurve} from "../bonding-curves/ICurve.sol";
import {CurveErrorCodes} from "../bonding-curves/CurveErrorCodes.sol";
import {IPoolActivityMonitor} from "./IPoolActivityMonitor.sol";

/**
 * @title An NFT/Token pool where the token is an ERC20
 * @author Collection
 */
abstract contract CollectionPoolERC20 is CollectionPool {
    using SafeTransferLib for ERC20;

    uint256 internal constant IMMUTABLE_PARAMS_LENGTH = 85;

    /**
     * @notice Returns the ERC20 token associated with the pool
     * @dev See CollectionPoolCloner for an explanation on how this works
     */
    function token() public pure returns (ERC20 _token) {
        uint256 paramsLength = _immutableParamsLength();
        assembly {
            _token := shr(0x60, calldataload(add(sub(calldatasize(), paramsLength), 65)))
        }
    }

    /// @inheritdoc ICollectionPool
    function liquidity() public view returns (uint256) {
        uint256 _balance = token().balanceOf(address(this));
        uint256 _accruedTradeFee = accruedTradeFee;
        if (_balance < _accruedTradeFee) revert InsufficientLiquidity(_balance, _accruedTradeFee);

        return _balance - _accruedTradeFee;
    }

    /// @inheritdoc CollectionPool
    function _pullTokenInputAndPayProtocolFee(
        uint256 inputAmount,
        bool isRouter,
        address routerCaller,
        ICollectionPoolFactory _factory,
        uint256 protocolFee,
        RoyaltyDue[] memory royaltiesDue
    ) internal override {
        require(msg.value == 0, "ERC20 pool");

        ERC20 _token = token();

        uint256 length = royaltiesDue.length;
        uint256 totalRoyaltiesPaid;

        if (isRouter) {
            // Verify if router is allowed
            CollectionRouter router = CollectionRouter(payable(msg.sender));

            // Locally scoped to avoid stack too deep
            {
                (bool routerAllowed,) = _factory.routerStatus(router);
                require(routerAllowed, "Not router");
            }

            // Pay royalties first to obtain total amount of royalties paid
            for (uint256 i = 0; i < length;) {
                // Cache state and then call router to transfer tokens from user
                RoyaltyDue memory due = royaltiesDue[i];
                uint256 royaltyAmount = due.amount;
                if (royaltyAmount > 0) {
                    totalRoyaltiesPaid += royaltyAmount;

                    address royaltyRecipient = getRoyaltyRecipient(payable(due.recipient));
                    uint256 royaltyInitBalance = _token.balanceOf(royaltyRecipient);

                    router.poolTransferERC20From(_token, routerCaller, royaltyRecipient, royaltyAmount, poolVariant());

                    // Verify token transfer (protect pool against malicious router)
                    require(
                        _token.balanceOf(royaltyRecipient) - royaltyInitBalance == royaltyAmount,
                        "ERC20 royalty not transferred in"
                    );
                }

                unchecked {
                    ++i;
                }
            }

            // Cache state and then call router to transfer tokens from user
            address _assetRecipient = getAssetRecipient();
            uint256 beforeBalance = _token.balanceOf(_assetRecipient);
            uint256 amountToAssetRecipient = inputAmount - protocolFee - totalRoyaltiesPaid;
            router.poolTransferERC20From(_token, routerCaller, _assetRecipient, amountToAssetRecipient, poolVariant());

            // Verify token transfer (protect pool against malicious router)
            require(
                _token.balanceOf(_assetRecipient) - beforeBalance == amountToAssetRecipient, "ERC20 not transferred in"
            );

            router.poolTransferERC20From(_token, routerCaller, address(_factory), protocolFee, poolVariant());

            // Note: no check for factory balance's because router is assumed to be set by factory owner
            // so there is no incentive to *not* pay protocol fee
        } else {
            // Pay royalties first to obtain total amount of royalties paid
            for (uint256 i = 0; i < length;) {
                RoyaltyDue memory due = royaltiesDue[i];
                uint256 royaltyAmount = due.amount;
                if (royaltyAmount > 0) {
                    totalRoyaltiesPaid += royaltyAmount;

                    address royaltyRecipient = getRoyaltyRecipient(payable(due.recipient));
                    _token.safeTransferFrom(msg.sender, royaltyRecipient, royaltyAmount);
                }

                unchecked {
                    ++i;
                }
            }

            // Transfer tokens directly
            _token.safeTransferFrom(msg.sender, getAssetRecipient(), inputAmount - protocolFee - totalRoyaltiesPaid);

            // Take protocol fee (if it exists)
            if (protocolFee > 0) {
                _token.safeTransferFrom(msg.sender, address(_factory), protocolFee);
            }
        }
    }

    /// @inheritdoc CollectionPool
    function _refundTokenToSender(uint256 inputAmount) internal override {
        // Do nothing since we transferred the exact input amount
    }

    /// @inheritdoc CollectionPool
    function _payProtocolFeeFromPool(ICollectionPoolFactory _factory, uint256 protocolFee) internal override {
        // Take protocol fee (if it exists)
        if (protocolFee > 0) {
            ERC20 _token = token();

            // Round down to the actual token balance if there are numerical stability issues with the bonding curve calculations
            uint256 poolTokenBalance = _token.balanceOf(address(this));
            if (protocolFee > poolTokenBalance) {
                protocolFee = poolTokenBalance;
            }
            if (protocolFee > 0) {
                _token.safeTransfer(address(_factory), protocolFee);
            }
        }
    }

    /// @inheritdoc CollectionPool
    function _sendTokenOutput(address payable tokenRecipient, uint256 outputAmount, RoyaltyDue[] memory royaltiesDue)
        internal
        override
    {
        ERC20 _token = token();

        uint256 length = royaltiesDue.length;
        for (uint256 i = 0; i < length;) {
            RoyaltyDue memory due = royaltiesDue[i];
            uint256 royaltyAmount = due.amount;
            if (royaltyAmount > 0) {
                address royaltyRecipient = getRoyaltyRecipient(payable(due.recipient));
                _token.safeTransfer(royaltyRecipient, royaltyAmount);
            }
            unchecked {
                ++i;
            }
        }

        // Send tokens to caller
        if (outputAmount > 0) {
            require(liquidity() >= outputAmount, "Too little ERC20");
            _token.safeTransfer(tokenRecipient, outputAmount);
        }
    }

    /// @inheritdoc CollectionPool
    // @dev see CollectionPoolCloner for params length calculation
    function _immutableParamsLength() internal pure override returns (uint256) {
        return IMMUTABLE_PARAMS_LENGTH;
    }

    /**
     * @dev Deposit ERC20s into pool
     */
    function depositERC20(ERC20 a, uint256 amount) external {
        a.safeTransferFrom(msg.sender, address(this), amount);

        if (a == token()) {
            emit TokenDeposit(address(nft()), address(a), amount);
            notifyDeposit(IPoolActivityMonitor.EventType.DEPOSIT_TOKEN, amount);
        }
    }

    /**
     * @notice Withdraws all pool token owned by the pool to the owner address.
     * @dev Only callable by the owner.
     */
    function withdrawAllERC20() external onlyAuthorized {
        uint256 _accruedTradeFee = accruedTradeFee;
        accruedTradeFee = 0;

        ERC20 _token = token();
        uint256 amount = _token.balanceOf(address(this));
        _token.safeTransfer(owner(), amount);

        if (_accruedTradeFee >= amount) {
            _accruedTradeFee = amount;
            amount = 0;
        } else {
            amount -= _accruedTradeFee;
        }

        // emit event since it is the pool token
        address _nft = address(nft());
        emit TokenWithdrawal(_nft, address(_token), amount);
        emit AccruedTradeFeeWithdrawal(_nft, address(_token), _accruedTradeFee);
    }

    /// @inheritdoc ICollectionPool
    function withdrawERC20(ERC20 a, uint256 amount) external onlyAuthorized {
        if (a == token()) {
            require(liquidity() >= amount, "Too little ERC20");

            // emit event since it is the pool token
            emit TokenWithdrawal(address(nft()), address(a), amount);
        }

        a.safeTransfer(owner(), amount);
    }

    /// @inheritdoc CollectionPool
    function withdrawAccruedTradeFee() external override onlyOwner {
        uint256 _accruedTradeFee = accruedTradeFee;
        if (_accruedTradeFee > 0) {
            accruedTradeFee = 0;

            ERC20 _token = token();
            _token.safeTransfer(msg.sender, _accruedTradeFee);

            // emit event since it is the pool token
            emit AccruedTradeFeeWithdrawal(address(nft()), address(_token), _accruedTradeFee);
        }
    }
}
