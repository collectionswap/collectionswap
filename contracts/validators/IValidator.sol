// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {ICurve} from "../bonding-curves/ICurve.sol";
import {ICollectionPool} from "../ICollectionPool.sol";

interface IValidator {
    /// @notice Validates if a pool fulfills the conditions of a bonding curve. The conditions can be different for each type of curve.
    function validate(ICollectionPool pool, ICurve.Params calldata params, uint96 fee, uint256 royaltyNumerator, bytes32 tokenIDFilterRoot) external returns (bool);
}
