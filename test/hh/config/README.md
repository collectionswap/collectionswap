# Config files for curve types

This README explains what fields are necessary for each config file as well as
curve specific encodings

## Fields required by all curve types

1. `bigPctProtocolFee`: Percentage protocol fee with 1 ether == 100%. E.g. 0.5% = `"5000000000000000"`
1. `bigPctFee`: Similar to `bigPctProtocolFee` but for the pool's fees
1. `rawSpot`: The human readable spot price to be passed to the curve in ether. E.g. `1` for 1 ether spot price
1. `bigDelta`: The final `uint128` which will be passed to the curve, as a string. E.g. `"30000000000000000"`
1. `bigSpot`: The final `uint128` spotPrice which will be passed to the curve, as a string. E.g. `"1000000000000000000"` for 1 ether
1. `rawPropsType`: The types of the values to encode into the `props` byte array. `[]` if nothing to be passed
1. `rawProps`: The values to encode into the `props` byte array. Pass strings for Bignumbers.
1. `rawStateType`: The types of the values to encode into the `state` byte array. `[]` if nothing to be passed
1. `rawState`: The values to encode into the `state` byte array. Pass strings for Bignumbers.
1. `royaltyNumerator`: An int, which when divided by 100, is the percentage of the trade value to be awarded as royalties. E.g. `500` for 5%.
