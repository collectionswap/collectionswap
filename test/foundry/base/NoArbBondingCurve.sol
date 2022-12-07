// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {DSTest} from "../lib/ds-test/test.sol";
import {Configurable} from "../mixins/Configurable.sol";

import {ILSSVMPair} from "../../../contracts/ILSSVMPair.sol";
import {LSSVMPair} from "../../../contracts/LSSVMPair.sol";
import {LSSVMPairETH} from "../../../contracts/LSSVMPairETH.sol";
import {LSSVMPairERC20} from "../../../contracts/LSSVMPairERC20.sol";
import {LSSVMPairEnumerableETH} from "../../../contracts/LSSVMPairEnumerableETH.sol";
import {LSSVMPairMissingEnumerableETH} from "../../../contracts/LSSVMPairMissingEnumerableETH.sol";
import {LSSVMPairEnumerableERC20} from "../../../contracts/LSSVMPairEnumerableERC20.sol";
import {LSSVMPairMissingEnumerableERC20} from "../../../contracts/LSSVMPairMissingEnumerableERC20.sol";
import {LSSVMPairFactory} from "../../../contracts/LSSVMPairFactory.sol";
import {ICurve} from "../../../contracts/bonding-curves/ICurve.sol";
import {CurveErrorCodes} from "../../../contracts/bonding-curves/CurveErrorCodes.sol";
import {Test721} from "../../../contracts/mocks/Test721.sol";
import {IERC721Mintable} from "../interfaces/IERC721Mintable.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import {StdCheats} from "forge-std/StdCheats.sol";

abstract contract NoArbBondingCurve is StdCheats, DSTest, ERC721Holder, Configurable {
    uint256[] idList;
    uint256 startingId;
    IERC721Mintable test721;
    ICurve bondingCurve;
    LSSVMPairFactory factory;
    address payable constant feeRecipient = payable(address(69));
    uint256 constant protocolFeeMultiplier = 3e15;
    uint256 constant royaltyNumerator = 0;
    uint256 constant carryFeeMultiplier = 5e15;

    function setUp() public {
        bondingCurve = setupCurve();
        test721 = setup721();
        LSSVMPairEnumerableETH enumerableETHTemplate = new LSSVMPairEnumerableETH();
        LSSVMPairMissingEnumerableETH missingEnumerableETHTemplate = new LSSVMPairMissingEnumerableETH();
        LSSVMPairEnumerableERC20 enumerableERC20Template = new LSSVMPairEnumerableERC20();
        LSSVMPairMissingEnumerableERC20 missingEnumerableERC20Template = new LSSVMPairMissingEnumerableERC20();
        factory = new LSSVMPairFactory(
            enumerableETHTemplate,
            missingEnumerableETHTemplate,
            enumerableERC20Template,
            missingEnumerableERC20Template,
            feeRecipient,
            protocolFeeMultiplier,
            carryFeeMultiplier
        );
        test721.setApprovalForAll(address(factory), true);
        factory.setBondingCurveAllowed(bondingCurve, true);

        // skip 1 second so that trades are not in the same timestamp as pair creation
        skip(1);
    }

    /**
    @dev Ensures selling NFTs & buying them back results in no profit.
     */
    function test_bondingCurveSellBuyNoProfit(
        uint56 spotPrice,
        uint64 delta,
        uint8 numItems
    ) public payable {
        // modify spotPrice to be appropriate for the bonding curve
        spotPrice = modifySpotPrice(spotPrice);

        // modify delta to be appropriate for the bonding curve
        delta = modifyDelta(delta);

        // decrease the range of numItems to speed up testing
        numItems = numItems % 3;

        if (numItems == 0) {
            return;
        }

        delete idList;

        // initialize the pair
        uint256[] memory empty;
        LSSVMPair pair = setupPair(
            factory,
            test721,
            bondingCurve,
            payable(address(0)),
            ILSSVMPair.PoolType.TRADE,
            delta,
            0,
            spotPrice,
            empty,
            0,
            address(0)
        );

        // mint NFTs to sell to the pair
        for (uint256 i = 0; i < numItems; i++) {
            test721.mint(address(this), startingId);
            idList.push(startingId);
            startingId += 1;
        }

        // skip 1 second so that trades are not in the same timestamp as pair creation
        skip(1);

        uint256 startBalance;
        uint256 endBalance;

        // sell all NFTs minted to the pair
        {
            (
                ,
                uint256 newSpotPrice,
                ,
                ,
                uint256 outputAmount,
                ,
                uint256 protocolFee,
                
            ) = bondingCurve.getSellInfo(
                    ICurve.Params(
                        spotPrice,
                        delta,
                        "",
                        ""
                    ),
                    numItems,
                    ICurve.FeeMultipliers(
                        0,
                        protocolFeeMultiplier,
                        royaltyNumerator,
                        0
                    )
                );

            // give the pair contract enough tokens to pay for the NFTs
            sendTokens(pair, outputAmount + protocolFee);

            // sell NFTs
            test721.setApprovalForAll(address(pair), true);
            startBalance = getBalance(address(this));
            pair.swapNFTsForToken(
                idList,
                new bytes32[](0),
                new bool[](0),
                0,
                payable(address(this)),
                false,
                address(0)
            );
            spotPrice = uint56(newSpotPrice);
        }

        // buy back the NFTs just sold to the pair
        {
            (, , , , uint256 inputAmount, , , ) = bondingCurve.getBuyInfo(
                ICurve.Params(
                    spotPrice,
                    delta,
                    "",
                    ""
                ),
                numItems,
                ICurve.FeeMultipliers(
                    0,
                    protocolFeeMultiplier,
                    royaltyNumerator,
                    0
                )
            );
            pair.swapTokenForAnyNFTs{value: modifyInputAmount(inputAmount)}(
                idList.length,
                inputAmount,
                address(this),
                false,
                address(0)
            );
            endBalance = getBalance(address(this));
        }

        // ensure the caller didn't profit from the aggregate trade
        assertGeDecimal(startBalance, endBalance, 18);

        // withdraw the tokens in the pair back
        withdrawTokens(pair);
    }

    /**
    @dev Ensures buying NFTs & selling them back results in no profit.
     */
    function test_bondingCurveBuySellNoProfit(
        uint56 spotPrice,
        uint64 delta,
        uint8 numItems
    ) public payable {
        // modify spotPrice to be appropriate for the bonding curve
        spotPrice = modifySpotPrice(spotPrice);

        // modify delta to be appropriate for the bonding curve
        delta = modifyDelta(delta);

        // decrease the range of numItems to speed up testing
        numItems = numItems % 3;

        if (numItems == 0) {
            return;
        }

        delete idList;

        // initialize the pair
        for (uint256 i = 0; i < numItems; i++) {
            test721.mint(address(this), startingId);
            idList.push(startingId);
            startingId += 1;
        }
        LSSVMPair pair = setupPair(
            factory,
            test721,
            bondingCurve,
            payable(address(0)),
            ILSSVMPair.PoolType.TRADE,
            delta,
            0,
            spotPrice,
            idList,
            0,
            address(0)
        );
        test721.setApprovalForAll(address(pair), true);

        // skip 1 second so that trades are not in the same timestamp as pair creation
        skip(1);

        uint256 startBalance;
        uint256 endBalance;

        // buy all NFTs
        {
            (, uint256 newSpotPrice, , , uint256 inputAmount, , , ) = bondingCurve
                .getBuyInfo(
                    ICurve.Params(
                        spotPrice,
                        delta,
                        "",
                        ""
                    ),
                    numItems,
                    ICurve.FeeMultipliers(
                        0,
                        protocolFeeMultiplier,
                        royaltyNumerator,
                        0
                    )
                );

            // buy NFTs
            startBalance = getBalance(address(this));
            pair.swapTokenForAnyNFTs{value: modifyInputAmount(inputAmount)}(
                numItems,
                inputAmount,
                address(this),
                false,
                address(0)
            );
            spotPrice = uint56(newSpotPrice);
        }

        // sell back the NFTs
        {
            bondingCurve.getSellInfo(
                ICurve.Params(
                    spotPrice,
                    delta,
                    "",
                    ""
                ),
                numItems,
                ICurve.FeeMultipliers(
                    0,
                    protocolFeeMultiplier,
                    royaltyNumerator,
                    0
                )
            );
            pair.swapNFTsForToken(
                idList,
                new bytes32[](0),
                new bool[](0),
                0,
                payable(address(this)),
                false,
                address(0)
            );
            endBalance = getBalance(address(this));
        }

        // ensure the caller didn't profit from the aggregate trade
        assertGeDecimal(startBalance, endBalance, 18);

        // withdraw the tokens in the pair back
        withdrawTokens(pair);
    }
}
