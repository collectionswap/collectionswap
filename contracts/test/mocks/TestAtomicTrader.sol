pragma solidity ^0.8.0;

import "../../pools/ICollectionPoolFactory.sol";
import "../../pools/ICollectionPool.sol";
import "../../pools/CollectionPool.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {PoolType, CreateETHPoolParams} from "../../pools/CollectionStructsAndEnums.sol";

contract TestAtomicTrader is IERC721Receiver {
    ICollectionPoolFactory factory;
    ICurve curve;

    constructor(ICollectionPoolFactory _factory, ICurve _curve) {
        factory = _factory;
        curve = _curve;
    }

    function createAndTrade(
        IERC721 nft,
        uint256[] calldata nftIDs,
        uint128 spotPrice,
        uint128 delta,
        bytes calldata props,
        bytes calldata state
    ) external payable {
        for (uint256 i; i < nftIDs.length; ++i) {
            // pull NFTs into this contract
            nft.safeTransferFrom(msg.sender, address(this), nftIDs[i]);
            // give approval to factory
            nft.setApprovalForAll(address(factory), true);
        }

        // create pool pool
        (ICollectionPool pool,) = factory.createPoolETH{value: msg.value}(
            CreateETHPoolParams({
                nft: nft,
                bondingCurve: curve,
                assetRecipient: payable(0),
                receiver: msg.sender,
                poolType: PoolType.TRADE,
                delta: delta,
                fee: 0.05e6,
                spotPrice: spotPrice,
                props: props,
                state: state,
                royaltyNumerator: 0,
                royaltyRecipientFallback: payable(address(0)),
                initialNFTIDs: nftIDs
            })
        );

        // then try to swap against it
        pool.swapTokenForAnyNFTs(1, 100e18, address(this), true, address(this));
    }

    function onERC721Received(address, address, uint256, bytes memory) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}
