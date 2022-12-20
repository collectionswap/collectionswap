// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";

import {ERC20} from "solmate/src/tokens/ERC20.sol";
import {SafeTransferLib} from "solmate/src/utils/SafeTransferLib.sol";

import {ICollectionPool} from "../pools/ICollectionPool.sol";
import {CollectionPool} from "../pools/CollectionPool.sol";
import {ICollectionPoolFactory} from "../pools/ICollectionPoolFactory.sol";
import {CurveErrorCodes} from "../bonding-curves/CurveErrorCodes.sol";

contract MultiRouter {
    using SafeTransferLib for address payable;
    using SafeTransferLib for ERC20;

    ICollectionPoolFactory public immutable erc721factory;

    constructor(ICollectionPoolFactory _erc721factory) {
        erc721factory = _erc721factory;
    }

    struct PoolSwapSpecific {
        CollectionPool pool;
        uint256[] nftIds;
        bytes32[] proof;
        bool[] proofFlags;
    }

    struct RobustPoolSwapSpecificWithToken {
        PoolSwapSpecific swapInfo;
        uint256 maxCost;
        bool isETHSwap;
    }

    struct RobustPoolSwapSpecificForToken {
        PoolSwapSpecific swapInfo;
        uint256 minOutput;
    }

    struct RobustPoolNFTsForTokenAndTokenforNFTsTrade {
        RobustPoolSwapSpecificWithToken[] tokenToNFTTradesSpecific;
        RobustPoolSwapSpecificForToken[] nftToTokenTrades;
    }

    /**
     * @notice Buys NFTs with ETH and ERC20s and sells them for tokens in one transaction
     * @param params All the parameters for the swap (packed in struct to avoid stack too deep), containing:
     * - tokenToNFTTradesSpecific The list of NFTs to buy
     * - nftToTokenSwapList The list of NFTs to sell
     * - inputAmount The max amount of tokens to send (if ERC20)
     * - tokenRecipient The address that receives tokens from the NFTs sold
     * - nftRecipient The address that receives NFTs
     */
    function robustSwapTokensForSpecificNFTsAndNFTsToToken(RobustPoolNFTsForTokenAndTokenforNFTsTrade calldata params)
        external
        payable
        returns (uint256 remainingETHValue)
    {
        // Attempt to fill each buy order for specific NFTs
        {
            remainingETHValue = msg.value;
            uint256 poolCost;
            CurveErrorCodes.Error error;
            uint256 numSwaps = params.tokenToNFTTradesSpecific.length;
            for (uint256 i; i < numSwaps;) {
                // Calculate actual cost per swap
                (error,,,, poolCost,,) = params.tokenToNFTTradesSpecific[i].swapInfo.pool.getBuyNFTQuote(
                    params.tokenToNFTTradesSpecific[i].swapInfo.nftIds.length
                );

                // If within our maxCost and no error, proceed
                if (poolCost <= params.tokenToNFTTradesSpecific[i].maxCost && error == CurveErrorCodes.Error.OK) {
                    // We know how much ETH to send because we already did the math above
                    // So we just send that much
                    if (params.tokenToNFTTradesSpecific[i].isETHSwap) {
                        remainingETHValue -= params.tokenToNFTTradesSpecific[i].swapInfo.pool.swapTokenForSpecificNFTs{
                            value: poolCost
                        }(params.tokenToNFTTradesSpecific[i].swapInfo.nftIds, poolCost, msg.sender, true, msg.sender);
                    }
                    // Otherwise we send ERC20 tokens
                    else {
                        params.tokenToNFTTradesSpecific[i].swapInfo.pool.swapTokenForSpecificNFTs(
                            params.tokenToNFTTradesSpecific[i].swapInfo.nftIds, poolCost, msg.sender, true, msg.sender
                        );
                    }
                }

                unchecked {
                    ++i;
                }
            }
            // Return remaining value to sender
            if (remainingETHValue > 0) {
                payable(msg.sender).safeTransferETH(remainingETHValue);
            }
        }
        // Attempt to fill each sell order
        {
            uint256 numSwaps = params.nftToTokenTrades.length;
            for (uint256 i; i < numSwaps;) {
                uint256 poolOutput;

                // Locally scoped to avoid stack too deep error
                {
                    CurveErrorCodes.Error error;
                    (error,,,, poolOutput,,) = params.nftToTokenTrades[i].swapInfo.pool.getSellNFTQuote(
                        params.nftToTokenTrades[i].swapInfo.nftIds.length
                    );
                    if (error != CurveErrorCodes.Error.OK) {
                        unchecked {
                            ++i;
                        }
                        continue;
                    }
                }

                // If at least equal to our minOutput, proceed
                if (poolOutput >= params.nftToTokenTrades[i].minOutput) {
                    // Do the swap
                    params.nftToTokenTrades[i].swapInfo.pool.swapNFTsForToken(
                        ICollectionPool.NFTs(
                            params.nftToTokenTrades[i].swapInfo.nftIds,
                            params.nftToTokenTrades[i].swapInfo.proof,
                            params.nftToTokenTrades[i].swapInfo.proofFlags
                        ),
                        0,
                        payable(msg.sender),
                        true,
                        msg.sender
                    );
                }

                unchecked {
                    ++i;
                }
            }
        }
    }

    receive() external payable {}

    /**
     * Restricted functions
     */

    /**
     * @dev Allows an ERC20 pool contract to transfer ERC20 tokens directly from
     * the sender, in order to minimize the number of token transfers. Only callable by an ERC20 pool.
     * @param token The ERC20 token to transfer
     * @param from The address to transfer tokens from
     * @param to The address to transfer tokens to
     * @param amount The amount of tokens to transfer
     * @param variant The pool variant of the pool contract
     */
    function poolTransferERC20From(ERC20 token, address from, address to, uint256 amount, uint8 variant) external {
        // verify caller is an ERC20 pool contract
        ICollectionPoolFactory.PoolVariant _variant = ICollectionPoolFactory.PoolVariant(variant);
        require(erc721factory.isPool(msg.sender, _variant), "Not pool");

        // verify caller is an ERC20 pool
        require(
            _variant == ICollectionPoolFactory.PoolVariant.ENUMERABLE_ERC20
                || _variant == ICollectionPoolFactory.PoolVariant.MISSING_ENUMERABLE_ERC20,
            "Not ERC20 pool"
        );
        // transfer tokens to pool
        token.safeTransferFrom(from, to, amount);
    }

    /**
     * @dev Allows a pool contract to transfer ERC721 NFTs directly from
     * the sender, in order to minimize the number of token transfers. Only callable by a pool.
     * @param nft The ERC721 NFT to transfer
     * @param from The address to transfer tokens from
     * @param to The address to transfer tokens to
     * @param id The ID of the NFT to transfer
     * @param variant The pool variant of the pool contract
     */
    function poolTransferNFTFrom(
        IERC721 nft,
        address from,
        address to,
        uint256 id,
        ICollectionPoolFactory.PoolVariant variant
    ) external {
        // verify caller is a trusted pool contract
        require(erc721factory.isPool(msg.sender, variant), "Not pool");
        // transfer NFTs to pool
        nft.safeTransferFrom(from, to, id);
    }
}
