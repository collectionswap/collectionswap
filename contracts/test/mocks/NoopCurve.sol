pragma solidity ^0.8.0;

import {CurveErrorCodes} from "../../bonding-curves/CurveErrorCodes.sol";
import {ICurve} from "../../bonding-curves/ICurve.sol";

contract NoopCurve is ICurve {
    function getBuyInfo(ICurve.Params calldata params, uint256 numItems, ICurve.FeeMultipliers calldata feeMultipliers)
        external
        pure
        returns (
            CurveErrorCodes.Error error,
            ICurve.Params memory newParams,
            uint256 inputValue,
            ICurve.Fees memory fees
        )
    {}

    function getSellInfo(ICurve.Params calldata params, uint256 numItems, ICurve.FeeMultipliers calldata feeMultipliers)
        external
        pure
        returns (
            CurveErrorCodes.Error error,
            ICurve.Params memory newParams,
            uint256 inputValue,
            ICurve.Fees memory fees
        )
    {}

    function validateDelta(uint128 delta) external pure returns (bool valid) {
        valid = true;
    }

    function validateProps(bytes calldata props) external pure returns (bool valid) {
        valid = true;
    }

    function validateSpotPrice(uint128 newSpotPrice) external pure returns (bool valid) {
        valid = true;
    }

    function validateState(bytes calldata state) external pure returns (bool valid) {
        valid = true;
    }
}
