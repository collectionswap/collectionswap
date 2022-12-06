// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {ICurve} from "../bonding-curves/ICurve.sol";
import {ILSSVMPair} from "../ILSSVMPair.sol";

interface IValidator {
    /// @notice Validates if a pair fulfills the conditions of a bonding curve. The conditions can be different for each type of curve.
    function validate(ILSSVMPair pair, ICurve.Params calldata params, uint96 fee, bytes32 tokenIDFilterRoot) external returns (bool);
}
