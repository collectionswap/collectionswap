// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {IValidator} from "./IValidator.sol";
import {ICurve} from "../bonding-curves/ICurve.sol";
import {ICollectionPool} from "../ICollectionPool.sol";

/// @notice MonotonicIncreasingValidator is suitable for all bonding curves that are monotonic increasing.
/// i.e. the spot price is always non-decreasing when delta increases.
/// @dev Only suitable for TRADE pools
contract MonotonicIncreasingValidator is IValidator {
    /// @dev See {IValidator-validate}
    function validate(ICollectionPool pool, ICurve.Params calldata params, uint96 fee, bytes32 tokenIDFilterRoot) public view override returns (bool) {
        return (
            pool.delta() <= params.delta &&
            pool.fee() <= fee &&
            pool.poolType() == ICollectionPool.PoolType.TRADE &&
            pool.tokenIDFilterRoot() == tokenIDFilterRoot
        );
    }
}
