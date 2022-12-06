// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ILSSVMPairFactory} from "./ILSSVMPairFactory.sol";
import {RewardPoolETH} from "./RewardPoolETH.sol";
import {RewardPoolETHDraw} from "./RewardPoolETHDraw.sol";
import {ICurve} from "./bonding-curves/ICurve.sol";
import {IValidator} from "./validators/IValidator.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {RNGChainlinkV2Interface} from "./rng/RNGChainlinkV2Interface.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

contract Collectionstaker is Ownable {
    using SafeERC20 for IERC20;

    ILSSVMPairFactory immutable public lpToken;
    RewardPoolETH immutable public rewardPoolETHLogic;
    RewardPoolETHDraw immutable public rewardPoolETHDrawLogic;
    uint256 public constant MAX_REWARD_TOKENS = 5;
    RNGChainlinkV2Interface public rngChainlink;

    /// @notice Event emitted when a liquidity mining incentive has been created
    /// @param poolAddress The Reward pool address
    /// @param rewardTokens The tokens being distributed as a reward
    /// @param rewards The amount of reward tokens to be distributed
    /// @param startTime The time when the incentive program begins
    /// @param endTime The time when rewards stop accruing
    event IncentiveETHCreated(
        address poolAddress,
        IERC20[] rewardTokens,
        uint256[] rewards,
        uint256 startTime,
        uint256 endTime
    );

    event IncentiveETHDrawCreated(
        address poolAddress,
        IERC20[] rewardTokens,
        uint256[] rewards,
        uint256 startTime,
        uint256 endTime
    );

    constructor(ILSSVMPairFactory _lpToken) {
        lpToken = _lpToken;
        rewardPoolETHLogic = new RewardPoolETH();
        rewardPoolETHDrawLogic = new RewardPoolETHDraw();
    }

    function setRNG(RNGChainlinkV2Interface _rngChainlink) external onlyOwner {
        rngChainlink = _rngChainlink;
    }

    /**
     * @notice The createIncentiveETH function is used to create a new liquidity mining incentive program for a specific trading pair. The function takes the following parameters:
     * @param validator: The address of the validator contract that will be used to verify the authenticity of the trading pair.
     * @param nft: The address of the non-fungible token that is being traded in the trading pair.
     * @param bondingCurve: The address of the bonding curve contract that is being used by the trading pair.
     * @param curveParams: The curve parameters that are being used by the bonding curve contract.
     * @param fee: The fee that will be charged on trades made using the trading pair.
     * @param rewardTokens: An array of token addresses that will be used as rewards in the incentive program.
     * @param rewards: An array of reward amounts that will be distributed to liquidity providers. This is the whole amount, which will be divided by the duration of the incentive program as an argument to the child initialize() function
     * @param startTime: The time when the incentive program begins.
     * @param endTime: The time at which the incentive program will end and rewards will no longer be distributed.
     * @dev  
     */
    function createIncentiveETH(
        IValidator validator,
        IERC721 nft,
        address bondingCurve,
        ICurve.Params calldata curveParams,
        uint96 fee,
        bytes32 tokenIDFilterRoot,
        IERC20[] calldata rewardTokens,
        uint256[] calldata rewards,
        uint256 startTime,
        uint256 endTime
    ) external {
        require(startTime > block.timestamp, "cannot backdate");
        uint256 rewardTokensLength = rewardTokens.length;
        require(
            rewardTokensLength <= MAX_REWARD_TOKENS,
            "too many reward tokens"
        );
        require(rewardTokensLength == rewards.length, "unequal lengths");
        uint256[] memory rewardRates = new uint256[](rewardTokensLength);
        for (uint256 i; i < rewardTokensLength; ) {
            rewardRates[i] = rewards[i] / (endTime - startTime); // guaranteed endTime > startTime
            require(rewardRates[i] != 0, "0 rate");
            unchecked {
                ++i;
            }
        }
        RewardPoolETH rewardPool = RewardPoolETH(
            Clones.clone(address(rewardPoolETHLogic))
        );
        
        rewardPool.initialize(
            owner(),
            msg.sender,
            lpToken,
            validator,
            nft,
            bondingCurve,
            curveParams,
            fee,
            tokenIDFilterRoot,
            rewardTokens,
            rewardRates,
            startTime,
            endTime
        );

        // transfer reward tokens to RewardPool
        for (uint256 i; i < rewardTokensLength; ) {
            rewardTokens[i].safeTransferFrom(
                msg.sender,
                address(rewardPool),
                rewards[i]
            );

            unchecked {
                ++i;
            }
        }

        emit IncentiveETHCreated(
            address(rewardPool),
            rewardTokens,
            rewards,
            startTime,
            endTime
        );
    }

    /**
     * @notice The randomnessIsSet function is a contract modifier that checks whether the rngChainlink contract has been set. If it has not been set, this modifier will throw an exception and prevent the contract's function from executing. This ensures that the contract's functions that rely on randomness generated by the rngChainlink contract will only be executed if the rngChainlink contract has been properly initialized.
     * @dev permission for liquidity vaults to call the Chainlink v2 RNG comes this contract
     */
    modifier randomnessIsSet() {
        require(address(rngChainlink) != address(0), "randomness not set");
        _;
    }

    /**
     * @notice The createIncentiveETHDraw function is used to create a new liquidity mining incentive program for a specific trading pair. The function takes the following parameters:
     * @param validator: The address of the validator contract that will be used to verify the authenticity of the trading pair.
     * @param nft: The address of the non-fungible token that is being traded in the trading pair.
     * @param bondingCurve: The address of the bonding curve contract that is being used by the trading pair.
     * @param curveParams: The curve parameters that are being used by the bonding curve contract.
     * @param fee: The fee that will be charged on trades made using the trading pair.
     * @param rewardTokens: An array of token addresses that will be used as rewards in the incentive program.
     * @param rewards: An array of reward amounts that will be distributed to liquidity providers. This is the whole amount, which will be divided by the duration of the incentive program as an argument to the child initialize() function
     * @param rewardStartTime: The time when the incentive program begins.
     * @param rewardEndTime: The time at which the incentive program will end and rewards will no longer be distributed.
     * @param _additionalERC20DrawPrize: The array of ERC20 tokens that will be distributed as additional prizes in the draw.
     * @param _additionalERC20DrawAmounts: The array of ERC20 token amounts that will be distributed as additional prizes in the draw.
     * @param _nftCollectionsPrize The NFT collections that will be awarded as prizes.
     * @param _nftIdsPrize The IDs of the NFTs that will be awarded as prizes.
     * @param _prizesPerWinner The number of prizes that will be awarded to each winner.
     * @param drawStartTime The time when the prize draw will begin. Not necessarily the same as the rewards programme
     * @param drawPeriodFinish The time when the prize draw will end. Not necessarily the same as the rewards programme
     * @dev  
     */
    function createIncentiveETHDraw(
        IValidator validator,
        IERC721 nft,
        address bondingCurve,
        ICurve.Params calldata curveParams,
        uint96 fee,
        bytes32 tokenIDFilterRoot,
        IERC20[] calldata rewardTokens,
        uint256[] calldata rewards,
        uint256 rewardStartTime,
        uint256 rewardEndTime,
        IERC20[] calldata _additionalERC20DrawPrize,
        uint256[] calldata _additionalERC20DrawAmounts,
        IERC721[] calldata _nftCollectionsPrize,
        uint256[] calldata _nftIdsPrize,
        uint256 _prizesPerWinner,
        uint256 drawStartTime,
        uint256 drawPeriodFinish
    ) public randomnessIsSet {
        uint256 rewardTokensLength = rewardTokens.length;
        if (rewardStartTime != 0) {
            // deployer intends to use normal reward distribution functionality
            // same checks apply as per createIncentiveETH()
            require(rewardStartTime > block.timestamp, "cannot backdate");
            require(rewardTokensLength <= MAX_REWARD_TOKENS, "too many reward tokens");
            require(rewardTokensLength == rewards.length, "unequal lengths");
        } else {
            // rewardStartTime == 0 => deployer intends to initially utilise draw functionality only
            require(rewardTokensLength == 0, "bad config");
        }

        uint256[] memory rewardRates = new uint256[](rewardTokensLength);
        for (uint256 i; i < rewardTokensLength; ) {
            rewardRates[i] = rewards[i] / (rewardEndTime - rewardStartTime); // guaranteed endTime > startTime
            require(rewardRates[i] != 0, "0 rate");
            unchecked {
                ++i;
            }
        }

        RewardPoolETHDraw rewardPool = RewardPoolETHDraw(
            Clones.clone(address(rewardPoolETHDrawLogic))
        );

        rewardPool.initialize(
            owner(),
            address(this),
            msg.sender,
            lpToken,
            validator,
            nft,
            bondingCurve,
            curveParams,
            fee,
            tokenIDFilterRoot,
            rewardTokens,
            rewardRates,
            rewardStartTime,
            rewardEndTime,
            rngChainlink,
            _additionalERC20DrawPrize,
            _additionalERC20DrawAmounts,
            _nftCollectionsPrize,
            _nftIdsPrize,
            _prizesPerWinner,
            drawStartTime,
            drawPeriodFinish
        );

        rngChainlink.setAllowedCaller(address(rewardPool));

        // transfer erc20 drawTokens to RewardPool
        for (uint256 i; i < _additionalERC20DrawPrize.length; ) {
            _additionalERC20DrawPrize[i].safeTransferFrom(
                msg.sender,
                address(rewardPool),
                _additionalERC20DrawAmounts[i]
            );

            unchecked {
                ++i;
            }
        }

        // transfer erc721 drawTokens to RewardPool
        for (uint256 i; i < _nftCollectionsPrize.length; ) {
            _nftCollectionsPrize[i].safeTransferFrom(
                msg.sender,
                address(rewardPool),
                _nftIdsPrize[i]
            );

            unchecked {
                ++i;
            }
        }

        // transfer reward tokens to RewardPool
        for (uint256 i; i < rewardTokensLength; ) {
            rewardTokens[i].safeTransferFrom(
                msg.sender,
                address(rewardPool),
                rewards[i]
            );

            unchecked {
                ++i;
            }
        }

        emit IncentiveETHDrawCreated(address(rewardPool), rewardTokens, rewards, rewardStartTime, rewardEndTime);
    }
}
