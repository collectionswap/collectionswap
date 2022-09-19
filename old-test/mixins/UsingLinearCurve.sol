// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {LinearCurve} from "../../bonding-curves/LinearCurve.sol";
import {Test721Enumerable} from "../../mocks/Test721Enumerable.sol";
import {IERC721Mintable} from "../interfaces/IERC721Mintable.sol";
import {ICurve} from "../../bonding-curves/ICurve.sol";
import {FixedPointMathLib} from "solmate/src/utils/FixedPointMathLib.sol";
import {Configurable} from "./Configurable.sol";

abstract contract UsingLinearCurve is Configurable {
    function setupCurve() public override returns (ICurve) {
        return new LinearCurve();
    }

    function modifyDelta(uint64 delta) public pure override returns (uint64) {
        return delta;
    }

    function modifySpotPrice(uint56 spotPrice)
        public
        pure
        override
        returns (uint56)
    {
        return spotPrice;
    }
}
