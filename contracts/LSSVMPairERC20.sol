// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {SafeTransferLib} from "solmate/src/utils/SafeTransferLib.sol";
import {ERC20} from "solmate/src/tokens/ERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {LSSVMPair} from "./LSSVMPair.sol";
import {ILSSVMPairFactory} from "./ILSSVMPairFactory.sol";
import {LSSVMRouter} from "./LSSVMRouter.sol";
import {ICurve} from "./bonding-curves/ICurve.sol";
import {CurveErrorCodes} from "./bonding-curves/CurveErrorCodes.sol";

/**
    @title An NFT/Token pair where the token is an ERC20
    @author boredGenius and 0xmons
 */
abstract contract LSSVMPairERC20 is LSSVMPair {
    using SafeTransferLib for ERC20;

    uint256 internal constant IMMUTABLE_PARAMS_LENGTH = 81;

    /**
        @notice Returns the ERC20 token associated with the pair
        @dev See LSSVMPairCloner for an explanation on how this works
     */
    function token() public pure returns (ERC20 _token) {
        uint256 paramsLength = _immutableParamsLength();
        assembly {
            _token := shr(
                0x60,
                calldataload(add(sub(calldatasize(), paramsLength), 61))
            )
        }
    }

    /// @inheritdoc LSSVMPair
    function _pullTokenInputAndPayProtocolFee(
        uint256 inputAmount,
        bool isRouter,
        address routerCaller,
        ILSSVMPairFactory _factory,
        uint256 protocolFee,
        RoyaltyDue[] memory royaltiesDue
    ) internal override {
        require(msg.value == 0, "ERC20 pair");

        ERC20 _token = token();
        address _assetRecipient = getAssetRecipient();

        if (isRouter) {
            // Verify if router is allowed
            LSSVMRouter router = LSSVMRouter(payable(msg.sender));

            // Locally scoped to avoid stack too deep
            {
                (bool routerAllowed, ) = _factory.routerStatus(router);
                require(routerAllowed, "Not router");
            }

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
              
              uint256 royaltyInitBalance = _token.balanceOf(royaltyRecipientOverride);
              if (totalRoyaltiesPaid > 0) {
                router.pairTransferERC20From(
                    _token,
                    routerCaller,
                    royaltyRecipientOverride,
                    totalRoyaltiesPaid,
                    pairVariant()
                );

                // Verify token transfer (protect pair against malicious router)
                require(
                    _token.balanceOf(royaltyRecipientOverride) - royaltyInitBalance ==
                        totalRoyaltiesPaid,
                    "ERC20 royalty not transferred in"
                );
              }
            } else {
                for (uint256 i = 0; i  < length; ) {
                    // Cache state and then call router to transfer tokens from user
                    RoyaltyDue memory due = royaltiesDue[i];
                    uint256 royaltyAmount = due.amount;
                    address royaltyRecipient = due.recipient == address(0) ? getAssetRecipient() : due.recipient;
                    uint256 royaltyInitBalance = _token.balanceOf(royaltyRecipient);
                    if (royaltyAmount > 0) {
                        totalRoyaltiesPaid += royaltyAmount;

                        router.pairTransferERC20From(
                            _token,
                            routerCaller,
                            royaltyRecipient,
                            royaltyAmount,
                            pairVariant()
                        );

                        // Verify token transfer (protect pair against malicious router)
                        require(
                            _token.balanceOf(royaltyRecipient) - royaltyInitBalance ==
                                royaltyAmount,
                            "ERC20 royalty not transferred in"
                        );
                    }

                    unchecked {
                        ++i;
                    }
                }
            }

            // Cache state and then call router to transfer tokens from user
            uint256 beforeBalance = _token.balanceOf(_assetRecipient);
            uint256 amountToAssetRecipient = inputAmount - protocolFee - totalRoyaltiesPaid;
            router.pairTransferERC20From(
                _token,
                routerCaller,
                _assetRecipient,
                amountToAssetRecipient,
                pairVariant()
            );

            // Verify token transfer (protect pair against malicious router)
            require(
                _token.balanceOf(_assetRecipient) - beforeBalance ==
                    amountToAssetRecipient,
                "ERC20 not transferred in"
            );

            router.pairTransferERC20From(
                _token,
                routerCaller,
                address(_factory),
                protocolFee,
                pairVariant()
            );

            // Note: no check for factory balance's because router is assumed to be set by factory owner
            // so there is no incentive to *not* pay protocol fee
        } else {
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
                    _token.safeTransferFrom(
                        msg.sender,
                        royaltyRecipientOverride,
                        totalRoyaltiesPaid
                    );
                }
            } else {
                for (uint256 i = 0; i < length;) {
                    RoyaltyDue memory due = royaltiesDue[i];
                    uint256 royaltyAmount = due.amount;
                    address royaltyRecipient = due.recipient == address(0) ? getAssetRecipient() : due.recipient;
                    totalRoyaltiesPaid += royaltyAmount;
                    if (royaltyAmount > 0) {
                        _token.safeTransferFrom(
                            msg.sender,
                            royaltyRecipient,
                            royaltyAmount
                        );
                    }

                    unchecked {
                        ++i;
                    }
                }
            }
            

            // Transfer tokens directly
            _token.safeTransferFrom(
                msg.sender,
                _assetRecipient,
                inputAmount - protocolFee - totalRoyaltiesPaid
            );

            // Take protocol fee (if it exists)
            if (protocolFee > 0) {
                _token.safeTransferFrom(
                    msg.sender,
                    address(_factory),
                    protocolFee
                );
            }
        }
    }

    /// @inheritdoc LSSVMPair
    function _refundTokenToSender(uint256 inputAmount) internal override {
        // Do nothing since we transferred the exact input amount
    }

    /// @inheritdoc LSSVMPair
    function _payProtocolFeeFromPair(
        ILSSVMPairFactory _factory,
        uint256 protocolFee
    ) internal override {
        // Take protocol fee (if it exists)
        if (protocolFee > 0) {
            ERC20 _token = token();

            // Round down to the actual token balance if there are numerical stability issues with the bonding curve calculations
            uint256 pairTokenBalance = _token.balanceOf(address(this));
            if (protocolFee > pairTokenBalance) {
                protocolFee = pairTokenBalance;
            }
            if (protocolFee > 0) {
                _token.safeTransfer(address(_factory), protocolFee);
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

        // Send tokens to caller
        if (outputAmount > 0) {
            ERC20 _token = token();
            require(
                _token.balanceOf(address(this)) >= outputAmount + tradeFee + totalRoyaltiesDue,
                "Too little ERC20"
            );
            _token.safeTransfer(tokenRecipient, outputAmount);
        }

        // If there's an override, just do one transfer. Else, send
        // elementwise
        if (royaltyRecipientOverride != address(0)) {
            if (totalRoyaltiesDue > 0) {
                token().safeTransfer(royaltyRecipientOverride, totalRoyaltiesDue);
            }
        } else {
            for (uint256 i = 0; i < length; ) {
                RoyaltyDue memory due = royaltiesDue[i];
                uint256 royaltyAmount = due.amount;
                if (royaltyAmount > 0) {
                    address royaltyRecipient = due.recipient == address(0) ? getAssetRecipient() : due.recipient;
                    token().safeTransfer(royaltyRecipient, royaltyAmount);
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
        @notice Withdraws all pair token owned by the pair to the owner address.
        @dev Only callable by the owner.
     */
    function withdrawAllERC20() external onlyOwner {
        tradeFee = 0;

        ERC20 _token = token();
        uint256 amount = _token.balanceOf(address(this));
        _token.safeTransfer(owner(), amount);

        // emit event since it is the pair token
        emit TokenWithdrawal(amount);
    }

    /// @inheritdoc LSSVMPair
    function withdrawERC20(ERC20 a, uint256 amount)
        external
        override
        onlyOwner
    {
        if (a == token()) {
            require(
                a.balanceOf(address(this)) >= amount + tradeFee,
                "Too little ERC20"
            );

            // emit event since it is the pair token
            emit TokenWithdrawal(amount);
        }

        a.safeTransfer(msg.sender, amount);
    }

    /// @inheritdoc LSSVMPair
    function withdrawTradeFee() external override onlyOwner {
        uint256 _tradeFee = tradeFee;
        if (_tradeFee > 0) {
            tradeFee = 0;

            token().safeTransfer(msg.sender, _tradeFee);

            // emit event since it is the pair token
            emit TokenWithdrawal(_tradeFee);
        }
    }
}
