// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {ERC20} from "solmate/src/tokens/ERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {SafeTransferLib} from "solmate/src/utils/SafeTransferLib.sol";
import {LSSVMPair} from "./LSSVMPair.sol";
import {ILSSVMPairFactory} from "./ILSSVMPairFactory.sol";
import {ICurve} from "./bonding-curves/ICurve.sol";

/**
    @title An NFT/Token pair where the token is ETH
    @author boredGenius and 0xmons
 */
abstract contract LSSVMPairETH is LSSVMPair {
    using SafeTransferLib for address payable;
    using SafeTransferLib for ERC20;

    uint256 internal constant IMMUTABLE_PARAMS_LENGTH = 61;

    /// @inheritdoc LSSVMPair
    function _pullTokenInputAndPayProtocolFee(
        uint256 inputAmount,
        bool, /*isRouter*/
        address, /*routerCaller*/
        ILSSVMPairFactory _factory,
        uint256 protocolFee,
        RoyaltyDue[] memory royaltiesDue
    ) internal override {
        require(msg.value >= inputAmount, "Sent too little ETH");

        // Pay royalties first to obtain total amount of royalties paid
        uint256 length = royaltiesDue.length;
        uint256 totalRoyaltiesPaid;

        // If there's an override, just sum and do one transfer. Else, send
        // elementwise
        if (royaltyRecipientOverride != address(0)) {
            for (uint256 i = 0; i  < length; ) {
                totalRoyaltiesPaid += royaltiesDue[i].amount;
                unchecked {
                    ++i;
                }
            }
            
            if (totalRoyaltiesPaid > 0) {
                royaltyRecipientOverride.safeTransferETH(totalRoyaltiesPaid);
            }
        } else {
            for (uint256 i = 0; i < length;) {
                RoyaltyDue memory due = royaltiesDue[i];
                uint256 royaltyAmount = due.amount;
                totalRoyaltiesPaid += royaltyAmount;
                if (royaltyAmount > 0) {
                    address recipient = due.recipient == address(0) ? getAssetRecipient() : due.recipient;
                    payable(recipient).safeTransferETH(
                        royaltyAmount
                    );
                }

                unchecked {
                    ++i;
                }
            }
        }
        

        // Transfer inputAmount ETH to assetRecipient if it's been set
        address payable _assetRecipient = getAssetRecipient();
        if (_assetRecipient != address(this)) {
            _assetRecipient.safeTransferETH(
                inputAmount - protocolFee - totalRoyaltiesPaid
            );
        }

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

    /// @inheritdoc LSSVMPair
    function _refundTokenToSender(uint256 inputAmount) internal override {
        // Give excess ETH back to caller
        if (msg.value > inputAmount) {
            payable(msg.sender).safeTransferETH(msg.value - inputAmount);
        }
    }

    /// @inheritdoc LSSVMPair
    function _payProtocolFeeFromPair(
        ILSSVMPairFactory _factory,
        uint256 protocolFee
    ) internal override {
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

    /// @inheritdoc LSSVMPair
    function _sendTokenOutput(
        address payable tokenRecipient,
        uint256 outputAmount,
        RoyaltyDue[] memory royaltiesDue
    ) internal override {
        // Unfortunately we need to duplicate work here
        uint256 length = royaltiesDue.length;
        uint256 totalRoyaltiesDue;
        for (uint256 i = 0; i  < length; ) {
            totalRoyaltiesDue += royaltiesDue[i].amount;
            unchecked {
                ++i;
            }
        }

        // Send ETH to caller
        if (outputAmount > 0) {
            require(
                address(this).balance >= outputAmount + tradeFee + totalRoyaltiesDue,
                "Too little ETH"
            );
            tokenRecipient.safeTransferETH(outputAmount);
        }

        // If there's an override, just do one transfer. Else, send
        // elementwise
        if (royaltyRecipientOverride != address(0)) {
            if (totalRoyaltiesDue > 0) {
                royaltyRecipientOverride.safeTransferETH(totalRoyaltiesDue);
            }
        } else {
            for (uint256 i = 0; i < length; ) {
                RoyaltyDue memory due = royaltiesDue[i];
                address royaltyRecipient = due.recipient == address(0) ? getAssetRecipient() : due.recipient;
                uint256 royaltyAmount = due.amount;
                if (royaltyAmount > 0) {
                    payable(royaltyRecipient).safeTransferETH(royaltyAmount);
                }

                unchecked {
                    ++i;
                }
            }
        }
    }

    /// @inheritdoc LSSVMPair
    // @dev see LSSVMPairCloner for params length calculation
    function _immutableParamsLength() internal pure override returns (uint256) {
        return IMMUTABLE_PARAMS_LENGTH;
    }

    /**
        @notice Withdraws all token owned by the pair to the owner address.
        @dev Only callable by the owner.
     */
    function withdrawAllETH() external onlyOwner {
        tradeFee = 0;

        _withdrawETH(address(this).balance);
    }

    /**
        @notice Withdraws a specified amount of token owned by the pair to the owner address.
        @dev Only callable by the owner.
        @param amount The amount of token to send to the owner. If the pair's balance is less than
        this value, the transaction will be reverted.
     */
    function withdrawETH(uint256 amount) external onlyOwner {
        require(
            address(this).balance >= amount + tradeFee,
            "Too little ETH"
        );

        _withdrawETH(amount);
    }

    /// @inheritdoc LSSVMPair
    function withdrawERC20(ERC20 a, uint256 amount)
        external
        override
        onlyOwner
    {
        a.safeTransfer(msg.sender, amount);
    }

    /// @inheritdoc LSSVMPair
    function withdrawTradeFee() external override onlyOwner {
        uint256 _tradeFee = tradeFee;
        if (_tradeFee > 0) {
            tradeFee = 0;

            _withdrawETH(_tradeFee);
        }
    }

    /**
        @dev All ETH transfers into the pair are accepted. This is the main method
        for the owner to top up the pair's token reserves.
     */
    receive() external payable {
        emit TokenDeposit(msg.value);
    }

    /**
        @dev All ETH transfers into the pair are accepted. This is the main method
        for the owner to top up the pair's token reserves.
     */
    fallback() external payable {
        // Only allow calls without function selector
        require(msg.data.length == _immutableParamsLength());
        emit TokenDeposit(msg.value);
    }

    function _withdrawETH(uint256 amount) internal {
        payable(owner()).safeTransferETH(amount);

        // emit event since ETH is the pair token
        emit TokenWithdrawal(amount);
    }
}
