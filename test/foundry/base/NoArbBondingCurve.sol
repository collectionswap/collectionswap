// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {DSTest} from "../lib/ds-test/test.sol";
import {Configurable} from "../mixins/Configurable.sol";

import {ICollectionPool} from "../../../contracts/ICollectionPool.sol";
import {CollectionPool} from "../../../contracts/CollectionPool.sol";
import {CollectionPoolETH} from "../../../contracts/CollectionPoolETH.sol";
import {CollectionPoolERC20} from "../../../contracts/CollectionPoolERC20.sol";
import {CollectionPoolEnumerableETH} from "../../../contracts/CollectionPoolEnumerableETH.sol";
import {CollectionPoolMissingEnumerableETH} from "../../../contracts/CollectionPoolMissingEnumerableETH.sol";
import {CollectionPoolEnumerableERC20} from "../../../contracts/CollectionPoolEnumerableERC20.sol";
import {CollectionPoolMissingEnumerableERC20} from "../../../contracts/CollectionPoolMissingEnumerableERC20.sol";
import {CollectionPoolFactory} from "../../../contracts/CollectionPoolFactory.sol";
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
    CollectionPoolFactory factory;
    address payable constant feeRecipient = payable(address(69));
    uint256 constant protocolFeeMultiplier = 3e15;
    uint256 constant royaltyNumerator = 0;
    uint256 constant carryFeeMultiplier = 5e15;

    function setUp() public {
        bondingCurve = setupCurve();
        test721 = setup721();
        CollectionPoolEnumerableETH enumerableETHTemplate = new CollectionPoolEnumerableETH();
        CollectionPoolMissingEnumerableETH missingEnumerableETHTemplate = new CollectionPoolMissingEnumerableETH();
        CollectionPoolEnumerableERC20 enumerableERC20Template = new CollectionPoolEnumerableERC20();
        CollectionPoolMissingEnumerableERC20 missingEnumerableERC20Template = new CollectionPoolMissingEnumerableERC20();
        factory = new CollectionPoolFactory(
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

        // skip 1 second so that trades are not in the same timestamp as pool creation
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

        // initialize the pool
        uint256[] memory empty;
        CollectionPool pool = setupPool(
            factory,
            test721,
            bondingCurve,
            payable(address(0)),
            ICollectionPool.PoolType.TRADE,
            delta,
            0,
            spotPrice,
            empty,
            0,
            address(0)
        );

        // mint NFTs to sell to the pool
        for (uint256 i = 0; i < numItems; i++) {
            test721.mint(address(this), startingId);
            idList.push(startingId);
            startingId += 1;
        }

        // skip 1 second so that trades are not in the same timestamp as pool creation
        skip(1);

        uint256 startBalance;
        uint256 endBalance;

        // sell all NFTs minted to the pool
        {
            (
                ,
                ICurve.Params memory newParams,
                uint256 outputAmount,
                ICurve.Fees memory fees
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

            // give the pool contract enough tokens to pay for the NFTs
            sendTokens(pool, outputAmount + fees.protocol);

            // sell NFTs
            test721.setApprovalForAll(address(pool), true);
            startBalance = getBalance(address(this));
            pool.swapNFTsForToken(
                ICollectionPool.NFTs(
                    idList,
                    new bytes32[](0),
                    new bool[](0)
                ),
                0,
                payable(address(this)),
                false,
                address(0)
            );
            spotPrice = uint56(newParams.spotPrice);
        }

        // buy back the NFTs just sold to the pool
        {
            (, , uint256 inputAmount, ) = bondingCurve.getBuyInfo(
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
            pool.swapTokenForAnyNFTs{value: modifyInputAmount(inputAmount)}(
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

        // withdraw the tokens in the pool back
        withdrawTokens(pool);
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

        // initialize the pool
        for (uint256 i = 0; i < numItems; i++) {
            test721.mint(address(this), startingId);
            idList.push(startingId);
            startingId += 1;
        }
        CollectionPool pool = setupPool(
            factory,
            test721,
            bondingCurve,
            payable(address(0)),
            ICollectionPool.PoolType.TRADE,
            delta,
            0,
            spotPrice,
            idList,
            0,
            address(0)
        );
        test721.setApprovalForAll(address(pool), true);

        // skip 1 second so that trades are not in the same timestamp as pool creation
        skip(1);

        uint256 startBalance;
        uint256 endBalance;

        // buy all NFTs
        {
            (, ICurve.Params memory newParams, uint256 inputAmount, ) = bondingCurve
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
            pool.swapTokenForAnyNFTs{value: modifyInputAmount(inputAmount)}(
                numItems,
                inputAmount,
                address(this),
                false,
                address(0)
            );
            spotPrice = uint56(newParams.spotPrice);
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
            pool.swapNFTsForToken(
                ICollectionPool.NFTs(
                    idList,
                    new bytes32[](0),
                    new bool[](0)
                ),
                0,
                payable(address(this)),
                false,
                address(0)
            );
            endBalance = getBalance(address(this));
        }

        // ensure the caller didn't profit from the aggregate trade
        assertGeDecimal(startBalance, endBalance, 18);

        // withdraw the tokens in the pool back
        withdrawTokens(pool);
    }
}
