// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {IValidator} from "./IValidator.sol";
import {ICurve} from "../bonding-curves/ICurve.sol";
import {ICollectionPool} from "../pools/ICollectionPool.sol";

/// @notice MonotonicIncreasingValidator is suitable for all bonding curves that are monotonic increasing.
/// i.e. the spot price is always non-decreasing when delta increases.
/// While most parameters are validated with an at most relation to keeping the spread tight,
/// the royalty numerator is validated with an at least as the nft collection would be keener to receive more royalties than keeping spread tight absolutely.
/// @dev Only suitable for TRADE pools
contract MonotonicIncreasingValidator is IValidator {
    /// @dev See {IValidator-validate}
    function validate(ICollectionPool pool, ICurve.Params calldata params, uint96 fee, uint256 royaltyNumerator, bytes32 tokenIDFilterRoot) public view override returns (bool) {
        return (
            pool.delta() <= params.delta && pool.fee() <= fee && pool.royaltyNumerator() >= royaltyNumerator
                && pool.poolType() == ICollectionPool.PoolType.TRADE
                && (tokenIDFilterRoot == 0 || pool.tokenIDFilterRoot() == tokenIDFilterRoot)
        );
    }
}
