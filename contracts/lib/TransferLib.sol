pragma solidity ^0.8.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/**
 * A helper library for common transfer methods such as transferring multiple token ids of the same collection, or multiple single token id of one collection.
 */
library TransferLib {
    using SafeERC20 for IERC20;

    /**
     * @notice Safe transfer N token ids of 1 ERC721
     */
    function bulkSafeTransferERC721From(IERC721 token, address from, address to, uint256[] calldata tokenIds)
        internal
    {
        uint256 length = tokenIds.length;
        for (uint256 i; i < length;) {
            token.safeTransferFrom(from, to, tokenIds[i]);
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice safe transfer N ERC20
     * @dev The length of tokens and values are assumed to be the same and should be checked before calling.
     */
    function batchSafeTransferERC20From(IERC20[] calldata tokens, address from, address to, uint256[] calldata values)
        internal
    {
        uint256 length = tokens.length;
        for (uint256 i; i < length;) {
            tokens[i].safeTransferFrom(from, to, values[i]);
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice safe transfer N token ids of N ERC721 respectively
     * @dev The length of tokens and values are assumed to be the same and should be checked before calling.
     */
    function batchSafeTransferERC721From(
        IERC721[] calldata tokens,
        address from,
        address to,
        uint256[] calldata tokenIds
    ) internal {
        uint256 length = tokens.length;
        for (uint256 i; i < length;) {
            tokens[i].safeTransferFrom(from, to, tokenIds[i]);
            unchecked {
                ++i;
            }
        }
    }
}
