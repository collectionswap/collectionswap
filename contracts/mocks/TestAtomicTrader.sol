pragma solidity ^0.8.0;

import "../ILSSVMPairFactory.sol";
import "../LSSVMPair.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

contract TestAtomicTrader is IERC721Receiver {
    ILSSVMPairFactory factory;
    ICurve curve;

    constructor (
        ILSSVMPairFactory _factory,
        ICurve _curve
    ) {
        factory = _factory;
        curve = _curve;
    }

    function createAndTrade(IERC721 nft, uint256[] calldata nftIDs) external payable {

        for (uint i; i < nftIDs.length; ++i) {
            // pull NFTs into this contract
            nft.safeTransferFrom(msg.sender, address(this), nftIDs[i]);
            // give approval to factory
            nft.setApprovalForAll(address(factory), true);
        }

        // create pool pair
        (address pair, ) = factory.createPairETH{value: msg.value}(
            ILSSVMPairFactory.CreateETHPairParams({
                nft: nft,
                bondingCurve: curve,
                assetRecipient: payable(0),
                receiver: msg.sender,
                poolType: ILSSVMPair.PoolType.TRADE,
                delta: 15e17,
                fee: 5e16,
                spotPrice: 1e18,
                props: abi.encode(1e18, 1e18),
                state: abi.encode(0),
                royaltyNumerator: 0,
                royaltyRecipientOverride: payable(address(0)),
                initialNFTIDs: nftIDs
            })
        );

        // then try to swap against it
        LSSVMPair(pair).swapTokenForAnyNFTs(
            1,
            100e18,
            address(this),
            true,
            address(this)
        );
    }

    function onERC721Received(
        address,
        address,
        uint256,
        bytes memory
    ) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}
