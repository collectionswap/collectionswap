// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {ERC20} from "solmate/src/tokens/ERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {SafeTransferLib} from "solmate/src/utils/SafeTransferLib.sol";
import {ICollectionPool} from "./ICollectionPool.sol";
import {CollectionPool} from "./CollectionPool.sol";
import {ICollectionPoolFactory} from "./ICollectionPoolFactory.sol";
import {ICurve} from "../bonding-curves/ICurve.sol";
import {IPoolActivityMonitor} from "./IPoolActivityMonitor.sol";
import {CollectionRouter} from "../routers/CollectionRouter.sol";

/**
 * @title An NFT/Token pool where the token is ETH
 * @author Collection
 */
abstract contract CollectionPoolETH is CollectionPool {
    using SafeTransferLib for address payable;
    using SafeTransferLib for ERC20;

    uint256 internal constant IMMUTABLE_PARAMS_LENGTH = 65;

    /// @inheritdoc ICollectionPool
    function liquidity() public view returns (uint256) {
        uint256 _balance = address(this).balance;
        uint256 _accruedTradeFee = accruedTradeFee;
        if (_balance < _accruedTradeFee) revert InsufficientLiquidity(_balance, _accruedTradeFee);

        return _balance - _accruedTradeFee;
    }

    /// @inheritdoc CollectionPool
    function _pullTokenInputAndPayProtocolFee(
        uint256 inputAmount,
        bool, /*isRouter*/
        address, /*routerCaller*/
        ICollectionPoolFactory _factory,
        uint256 protocolFee,
        RoyaltyDue[] memory royaltiesDue
    ) internal override {
        require(msg.value >= inputAmount, "Sent too little ETH");

        // Pay royalties first to obtain total amount of royalties paid
        (uint256 totalRoyaltiesPaid,) = _payRoyalties(royaltiesDue);

        // Transfer inputAmount ETH to assetRecipient if it's been set
        address payable _assetRecipient = getAssetRecipient();
        if (_assetRecipient != address(this)) {
            _assetRecipient.safeTransferETH(inputAmount - protocolFee - totalRoyaltiesPaid);
        }

        _payProtocolFeeFromPool(_factory, protocolFee);
    }

    /// @inheritdoc CollectionPool
    function _refundTokenToSender(uint256 inputAmount) internal override {
        // Give excess ETH back to caller
        if (msg.value > inputAmount) {
            payable(msg.sender).safeTransferETH(msg.value - inputAmount);
        }
    }

    /// @inheritdoc CollectionPool
    function _payProtocolFeeFromPool(ICollectionPoolFactory _factory, uint256 protocolFee) internal override {
        // Take protocol fee
        if (protocolFee > 0) {
            // Round down to the actual ETH balance if there are numerical stability issues with the bonding curve calculations
            if (protocolFee > address(this).balance) {
                protocolFee = address(this).balance;
            }

            if (protocolFee > 0) {
                payable(address(_factory)).safeTransferETH(protocolFee);
            }
        }
    }

    /**
     * @notice Pay royalties to the factory, which should never revert. The factory
     * serves as a single contract to which royalty recipients can make a single
     * transaction to receive all royalties due as opposed to having to send
     * transactions to arbitrary numbers of pools
     *
     * @return totalRoyaltiesPaid The amount of royalties which were paid including
     * royalties whose resolved recipient is this contract itself
     * @return royaltiesSentToFactory `totalRoyaltiesPaid` less the amount whose
     * resolved recipient is this contract itself
     */
    function _payRoyalties(RoyaltyDue[] memory royaltiesDue)
        internal
        returns (uint256 totalRoyaltiesPaid, uint256 royaltiesSentToFactory)
    {
        /// @dev For ETH pools, calculate how much to send in total since factory
        /// can't call safeTransferFrom.
        uint256 length = royaltiesDue.length;
        for (uint256 i = 0; i < length;) {
            uint256 royaltyAmount = royaltiesDue[i].amount;
            if (royaltyAmount > 0) {
                totalRoyaltiesPaid += royaltyAmount;
                address finalRecipient = getRoyaltyRecipient(payable(royaltiesDue[i].recipient));
                if (finalRecipient == address(this)) {
                    royaltiesDue[i].amount = 0;
                } else {
                    royaltiesSentToFactory += royaltyAmount;
                    royaltiesDue[i].recipient = finalRecipient;
                }
            }

            unchecked {
                ++i;
            }
        }

        factory().depositRoyaltiesNotification{value: royaltiesSentToFactory}(
            ERC20(address(0)), royaltiesDue, poolVariant()
        );
    }

    /// @inheritdoc CollectionPool
    function _sendTokenOutput(address payable tokenRecipient, uint256 outputAmount, RoyaltyDue[] memory royaltiesDue)
        internal
        override
    {
        _payRoyalties(royaltiesDue);

        // Send ETH to caller
        if (outputAmount > 0) {
            require(liquidity() >= outputAmount, "Too little ETH");
            tokenRecipient.safeTransferETH(outputAmount);
        }
    }

    /// @inheritdoc CollectionPool
    // @dev see CollectionPoolCloner for params length calculation
    function _immutableParamsLength() internal pure override returns (uint256) {
        return IMMUTABLE_PARAMS_LENGTH;
    }

    /**
     * @notice Withdraws all token owned by the pool to the owner address.
     * @dev Only callable by the owner.
     */
    function withdrawAllETH() external onlyAuthorized {
        uint256 _accruedTradeFee = accruedTradeFee;
        accruedTradeFee = 0;

        uint256 amount = address(this).balance;
        payable(owner()).safeTransferETH(amount);

        if (_accruedTradeFee >= amount) {
            _accruedTradeFee = amount;
            amount = 0;
        } else {
            amount -= _accruedTradeFee;
        }

        // emit event since ETH is the pool token
        address _nft = address(nft());
        emit TokenWithdrawal(_nft, address(0), amount);
        emit AccruedTradeFeeWithdrawal(_nft, address(0), _accruedTradeFee);
    }

    /**
     * @notice Withdraws a specified amount of token owned by the pool to the owner address.
     * @dev Only callable by the owner.
     * @param amount The amount of token to send to the owner. If the pool's balance is less than
     * this value, the transaction will be reverted.
     */
    function withdrawETH(uint256 amount) external onlyAuthorized {
        require(liquidity() >= amount, "Too little ETH");

        payable(owner()).safeTransferETH(amount);

        // emit event since ETH is the pool token
        emit TokenWithdrawal(address(nft()), address(0), amount);
    }

    /// @inheritdoc ICollectionPool
    function withdrawERC20(ERC20 a, uint256 amount) external onlyAuthorized {
        a.safeTransfer(owner(), amount);
    }

    /// @inheritdoc CollectionPool
    function withdrawAccruedTradeFee() external override onlyOwner {
        uint256 _accruedTradeFee = accruedTradeFee;
        if (_accruedTradeFee > 0) {
            accruedTradeFee = 0;

            payable(owner()).safeTransferETH(_accruedTradeFee);

            // emit event since ETH is the pool token
            emit AccruedTradeFeeWithdrawal(address(nft()), address(0), _accruedTradeFee);
        }
    }

    function depositERC20Notification(ERC20, uint256) external view onlyFactory {
        revert InvalidModification();
    }

    /**
     * @dev All ETH transfers into the pool are accepted. This is the main method
     * for the owner to top up the pool's token reserves.
     */
    receive() external payable {
        emit TokenDeposit(address(nft()), address(0), msg.value);
        notifyDeposit(IPoolActivityMonitor.EventType.DEPOSIT_TOKEN, msg.value);
    }

    /**
     * @dev All ETH transfers into the pool are accepted. This is the main method
     * for the owner to top up the pool's token reserves.
     */
    fallback() external payable {
        // Only allow calls without function selector
        require(msg.data.length == _immutableParamsLength());
        emit TokenDeposit(address(nft()), address(0), msg.value);
        notifyDeposit(IPoolActivityMonitor.EventType.DEPOSIT_TOKEN, msg.value);
    }
}
