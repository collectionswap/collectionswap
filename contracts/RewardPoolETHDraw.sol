// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {RewardPoolETH} from "./RewardPoolETH.sol";
import "./ILSSVMPairFactory.sol";
import "./ILSSVMPair.sol";
import "./SortitionSumTreeFactory.sol";
import "./lib/ReentrancyGuard.sol";
import {RNGInterface} from "./rng/RNGInterface.sol";
import "./validators/IValidator.sol";

contract RewardPoolETHDraw is ReentrancyGuard, RewardPoolETH {
    using SafeERC20 for IERC20;
    using SortitionSumTreeFactory for SortitionSumTreeFactory.SortitionSumTrees;

    address public factory;

    /// @notice RNG contract interface
    RNGInterface public rng;
    /// @notice RNG request ID corresponding to the Chainlink interactor, so we can look up the RNG status and result.
    uint32 public myRNGRequestId;
    uint64 public thisEpoch;

    mapping(uint64 => uint256) public epochToStartTime;
    mapping(uint64 => uint256) public epochToFinishTime;
    mapping(uint64 => uint256) public epochToRandomNumber;
    
    /**
     * @dev This struct is used to track the last observed amount and the time-weighted average price (TWAP) for a user's balance.
     */
    struct SimpleObservation {
        uint256 timestamp;
        uint256 lastAmount;
        uint256 twapCumSum;
        uint256 predictedEndSum; // relies on knowing epoch end in advance
    }

    // list of addresses who have interacted with this contract - necessary to get the list of all interactors
    address[] internal totalVaultInteractorList;
    mapping(address => SimpleObservation) public lastTWAPObservation;

    /**
     * @dev This enum is used to track the status of the draw for a given epoch. The possible statuses are:
     * @dev Open: The draw is currently open and users can enter.
     * @dev Closed: The draw is closed and no more entries are accepted.
     * @dev Resolved: The winners have been determined and the rewards have been distributed.
     */
    enum DrawStatus {
        Open,
        Closed,
        Resolved
    }

    DrawStatus public drawStatus;
    
    //////////////////////////////////////////
    // DRAW AMOUNTS
    //////////////////////////////////////////

    bytes32 private TREE_KEY;
    uint256 private constant MAX_TREE_LEAVES = 5;
    uint256 public constant MAX_REWARD_NFTS = 200;
    uint256 public constant MAX_PRIZE_WINNERS_PER_EPOCH = 500;
    address private constant DUMMY_ADDRESS = address(0);
    SortitionSumTreeFactory.SortitionSumTrees internal sortitionSumTrees;

    /**
     * @dev This struct is used to store information about a non-fungible token (NFT) that is being awarded as a prize.
     */
    struct NFTData {
        IERC721 nftAddress;
        uint256 nftID;
    }
    struct PrizeSet {
        // ERC20 tokens to reward
        IERC20[] erc20RewardTokens;

        // ERC721 tokens to reward
        IERC721[] erc721RewardTokens;
        uint256 numERC721Prizes;
        uint256 prizePerWinner;
    }

    /**
     * @dev This struct is used to store information about the winners for a given epoch. It includes the number of draw winners, the number of prizes per winner, and the remainder.
     */
    struct WinnerConfig {
        uint256 numberOfDrawWinners;
        uint256 numberOfPrizesPerWinner;
        uint256 remainder;
    }
    // Mappings of epoch to prize data
    mapping(uint64 => PrizeSet) public epochPrizeSets;
    mapping(uint64 => mapping(IERC20 => uint256)) public epochERC20PrizeAmounts;
    mapping(uint64 => mapping(IERC721 => bool)) public epochERC721Collections;
    /**
     * @dev This mapping is used to store information about the specific NFTs that will be awarded as prizes for each epoch.
     */
    mapping(uint64 => mapping(uint256 => NFTData)) public epochERC721PrizeIdsData;
    mapping(uint64 => WinnerConfig) public epochWinnerConfigs;

    mapping(uint64 => mapping(address => uint256)) public epochUserERC20NumWinnerEntries; // denominator is epochWinnerConfigs[epoch].numberOfDrawWinners

    // NFT prizes
    /** 
     * @dev epoch => user => `index_arr`, where `address` is awardable
     * `epochERC721PrizeIdsData[index * numberOfPrizesPerWinner + 1]`
     * to 
     * `epochERC721PrizeIdsData[(index + 1) * numberOfPrizesPerWinner]`
     * for all `index` in `index_arr`
     */
    mapping(uint64 => mapping(address => uint256[])) public epochUserPrizeStartIndices; 

    // Both ERC20 and ERC721 prizes
    mapping(uint64 => mapping(address => bool)) public isPrizeClaimable;

    //////////////////////////////////////////
    // EVENTS
    //////////////////////////////////////////

    event DrawOpen(uint64 epoch);
    event DrawClosed(uint64 epoch);
    event PrizesAdded(
        uint256 indexed epoch,
        IERC721[] prizeNftCollections,
        uint256[] prizeNftIds,
        IERC20[] prizeTokens,
        uint256[] prizeAmounts,
        uint256 startTime,
        uint256 endTime
    );
    event PrizesPerWinnerUpdated(uint256 indexed epoch, uint256 numPrizesPerWinner);
    event DrawResolved(uint64 epoch, address[] winners);
    event Claimed(address user, uint64 epoch);

    //////////////////////////////////////////
    // ERRORS
    //////////////////////////////////////////
    error BadEpochZeroInitalization();
    error BadStartTime();
    error CallerNotDeployer();
    error IncorrectDrawStatus();
    error NoClaimableShare();
    error NFTPrizeRequired();
    error RNGRequestIncomplete();

    modifier onlyDeployer() {
        if (msg.sender != deployer) revert CallerNotDeployer();
        _;
    }

    constructor() {
        _disableInitializers();
    }

    /** 
        @dev - this is called by the factory. 
        @param _protocolOwner - the owner of the protocol
        @param _factory - the factory address
        @param _deployer - the vault deployer's address
        @param _lpToken - Collectionswap deployment address
        @param _validator - the validator contract address
        @param _nft - the NFT contract address
        @param _bondingCurve - the bonding curve contract address
        @param _curveParams - the bonding curve parameters
        @param _fee - the fee amount to incentivize
        @param _rewardTokens - the reward token addresses
        @param _rewardRates - the reward rates. Reward rates is in amount per second
        @param _rewardStartTime - the reward start time (note that this can be different from the draw start time)
        @param _rewardPeriodFinish - the reward period finish time
        @param _rng - RNG contract address
        @param _additionalERC20DrawPrize - additional ERC20 prize to add to the draw, list
        @param _additionalERC20DrawPrizeAmounts - additional ERC20 prize amount to add to the draw, list. NB: Note that this is NOT divided per second, unlike the _rewardRates
        @param _nftCollectionsPrize - additional ERC721 prize to add to the draw, list
        @param _nftIdsPrize - additional ERC721 prize ID to add to the draw, list
        @param _prizesPerWinner - number of ERC721 prizes per winner
        @param _drawStartTime - the start time of draw
        @param _drawPeriodFinish - the end time of draw
    **/
    function initialize(
        address _protocolOwner,
        address _factory,
        address _deployer,
        ILSSVMPairFactory _lpToken,
        IValidator _validator,
        IERC721 _nft,
        address _bondingCurve,
        ICurve.Params calldata _curveParams,
        uint96 _fee,
        IERC20[] calldata _rewardTokens,
        uint256[] calldata _rewardRates,
        uint256 _rewardStartTime,
        uint256 _rewardPeriodFinish,
        RNGInterface _rng,
        IERC20[] calldata _additionalERC20DrawPrize,
        uint256[] calldata _additionalERC20DrawPrizeAmounts,
        IERC721[] calldata _nftCollectionsPrize,
        uint256[] calldata _nftIdsPrize,
        uint256 _prizesPerWinner,
        uint256 _drawStartTime,
        uint256 _drawPeriodFinish
    )  external {
        __ReentrancyGuard_init();
        factory = _factory;

        super.initialize({
            _protocolOwner: _protocolOwner,
            _deployer: _deployer,
            _lpToken: _lpToken,
            _validator: _validator,
            _nft: _nft,
            _bondingCurve: _bondingCurve,
            _curveParams: _curveParams,
            _fee: _fee,
            _rewardTokens: _rewardTokens,
            _rewardRates: _rewardRates,
            _startTime: _rewardStartTime,
            _periodFinish: _rewardPeriodFinish
        });

        LOCK_TIME = 90 days;

        rng = _rng;
        TREE_KEY = keccak256(abi.encodePacked(uint256(1)));
        sortitionSumTrees.createTree(TREE_KEY, MAX_TREE_LEAVES);
        
        // Ensure that there is always a non-zero initial stake.
        // This is to prevent the sortition tree from being empty.
        // Can be anyone, have set to DUMMY_ADDRESS, soft guarantee of not zeroing out
        // draw stake midway (stake then unstake)
        bytes32 _ID = addressToBytes32(DUMMY_ADDRESS);
        sortitionSumTrees.set(TREE_KEY, 1, _ID);

        // thisEpoch is incremented in function below
        _addNewPrizeEpoch({
            _nftCollectionsPrize: _nftCollectionsPrize,
            _nftIdsPrize: _nftIdsPrize,
            _prizesPerWinner: _prizesPerWinner,
            _erc20Prize: _additionalERC20DrawPrize,
            _erc20PrizeAmounts: _additionalERC20DrawPrizeAmounts,
            _drawStartTime: _drawStartTime,
            _drawPeriodFinish: _drawPeriodFinish,
            _callerIsDeployer: false,
            _epoch: thisEpoch
        });
    }

    /**
        @dev - add ERC721 prizes and / or ERC20 prizes to the prize set
        any mutation functions to prize sets should not permit epoch parameterization
        @dev - Only callable by deployer
        @dev - Specify zero drawStartTime to add during an epoch, else adding after an epoch
    **/
    function addNewPrizes(
        IERC721[] calldata _nftCollectionsPrize,
        uint256[] calldata _nftIdsPrize,
        IERC20[] calldata _erc20Prize,
        uint256[] calldata _erc20PrizeAmounts,
        uint256 _prizesPerWinner,
        uint256 _drawStartTime,
        uint256 _drawPeriodFinish
    ) external onlyDeployer {
        _addNewPrizeEpoch({
            _nftCollectionsPrize: _nftCollectionsPrize,
            _nftIdsPrize: _nftIdsPrize,
            _erc20Prize: _erc20Prize,
            _erc20PrizeAmounts: _erc20PrizeAmounts,
            _prizesPerWinner: _prizesPerWinner,
            _drawStartTime: _drawStartTime,
            _drawPeriodFinish: _drawPeriodFinish,
            _callerIsDeployer: true,
            _epoch: thisEpoch
        });

        // Add after epoch
        // fast forward sortition tree
        if (_drawStartTime != 0) recalcSortitionTreesEpochStart();
    }

    /**
     * @dev - internal method for transferring and adding ERC721 and ERC20 prizes to the prize set.
     * @dev - Factory has a special-workflow for not transferring as it is easier to initialize state and then transfer tokens in.
     * @dev - workflow 1: call with non-zero drawStartTime to add a new epoch.
     * @dev - workflow 2: call with zero drawStartTime to add prizes during the current epoch.
     * @dev - NB: _drawStartTime and _drawPeriodFinish are potentially different from the rewards start and end time. (draw and rewards can potentially run on different timers)
    **/
    function _addNewPrizeEpoch(
        IERC721[] calldata _nftCollectionsPrize,
        uint256[] calldata _nftIdsPrize,
        IERC20[] calldata _erc20Prize,
        uint256[] calldata _erc20PrizeAmounts,
        uint256 _prizesPerWinner,
        uint256 _drawStartTime,
        uint256 _drawPeriodFinish,
        bool _callerIsDeployer,
        uint64 _epoch
    ) internal nonReentrant {
        uint256 numNfts = _nftCollectionsPrize.length;

        /////////////////////////////
        /// UPDATES FOR NEW EPOCH ///
        /////////////////////////////
        if (_drawStartTime != 0) {
            // ensure that current epoch has been resolved
            // excludes base case of _epoch == 0 (uninitialized)
            if (_epoch != 0) if (drawStatus != DrawStatus.Resolved) revert IncorrectDrawStatus();

            // when setting new epoch, 
            // we need numNfts > 0 to ensure the draw is workable
            // because the distribution of the prizes depends on the number of ERC721 tokens
            if (numNfts == 0) revert NFTPrizeRequired();
            if (_drawStartTime <= block.timestamp) revert BadStartTime();
            if (_drawPeriodFinish <= _drawStartTime) revert BadEndTime();

            // update thisEpoch storage variable
            // and increment _epoch to new epoch
            thisEpoch = ++_epoch;

            // initialize prize set for new epoch
            _initPrizeSet(_epoch);

            // set new epoch times
            epochToStartTime[_epoch] = _drawStartTime;
            epochToFinishTime[_epoch] = _drawPeriodFinish;

            // update reward sweep time if it will exceed current reward sweep time
            uint256 newRewardSweepTime = _drawPeriodFinish + LOCK_TIME;
            if (rewardSweepTime < newRewardSweepTime) rewardSweepTime = newRewardSweepTime;
            
            drawStatus = DrawStatus.Open;
            emit DrawOpen(_epoch);
        } else {
            if (_epoch != 0) {
                // when adding to an existing epoch, 
                // require that the draw is not resolved
                if (drawStatus == DrawStatus.Resolved) revert IncorrectDrawStatus();
            } else {
                // If epoch is zero (initialization),
                // We assume the project is only using the reward distribution portion initially,
                // and would use the draw functionality in the future
                // Hence, we check that no rewards are being distributed
                if (numNfts != 0 || _erc20Prize.length != 0) revert BadEpochZeroInitalization();
            }
        }

        ////////////////////////////
        /// HANDLING NFT PRIZES  ///
        ////////////////////////////
        if (numNfts != _nftIdsPrize.length) revert LengthMismatch();

        PrizeSet storage prizeSet = epochPrizeSets[_epoch];
        // index for appending to existing number of NFTs
        uint256 prizeIdIndex = prizeSet.numERC721Prizes;
        if (prizeIdIndex + numNfts > MAX_REWARD_NFTS) revert LengthLimitExceeded();
        // iterate through each nft in prizePool.nftCollections and transfer to this contract if caller is deployer
        for (uint256 i; i < numNfts; ++i) {
            IERC721 myCollAdd = (_nftCollectionsPrize[i]);
            
            if (!epochERC721Collections[_epoch][myCollAdd]) {
                // new collection for this epoch
                // check if it supports ERC721
                if (!_nftCollectionsPrize[i].supportsInterface(0x80ac58cd)) revert NFTNotERC721();
                epochERC721Collections[_epoch][myCollAdd] = true;
                prizeSet.erc721RewardTokens.push(myCollAdd);
            }
            // @dev: only need transfer NFTs in if caller is deployer
            if (_callerIsDeployer) {
                _nftCollectionsPrize[i].safeTransferFrom(msg.sender, address(this), _nftIdsPrize[i]);
            }
            epochERC721PrizeIdsData[_epoch][++prizeIdIndex] = NFTData(myCollAdd, _nftIdsPrize[i]);
        }
        // update only if numNfts is non-zero
        if (numNfts != 0) {
            prizeSet.numERC721Prizes = prizeIdIndex;
            _setPrizePerWinner(prizeSet, _prizesPerWinner);
        }

        /////////////////////////////
        /// HANDLING ERC20 PRIZES ///
        /////////////////////////////
        if (_erc20Prize.length != _erc20PrizeAmounts.length) revert LengthMismatch();

        // iterate through each ERC20 token and transfer to this contract
        for (uint256 i; i < _erc20Prize.length; ++i) {
            if (_erc20PrizeAmounts[i] == 0) revert ZeroRewardRate();
            // @dev: only need transfer tokens in if caller is deployer
            if (_callerIsDeployer) {
                _erc20Prize[i].safeTransferFrom(msg.sender, address(this), _erc20PrizeAmounts[i]);
            }

            IERC20 myCollAdd = _erc20Prize[i];
            uint256 epochAmount = epochERC20PrizeAmounts[_epoch][myCollAdd];
            if (epochAmount == 0) {
                // not encountered before
                prizeSet.erc20RewardTokens.push(myCollAdd);
                // ensure no. of ERC20 tokens don't exceed MAX_REWARD_TOKENS
                if (prizeSet.erc20RewardTokens.length > MAX_REWARD_TOKENS) revert LengthLimitExceeded();
            }
            epochERC20PrizeAmounts[_epoch][myCollAdd] = epochAmount + _erc20PrizeAmounts[i];
        }

        emit PrizesAdded(
            _epoch,
            _nftCollectionsPrize,
            _nftIdsPrize,
            _erc20Prize,
            _erc20PrizeAmounts,
            _drawStartTime,
            _drawPeriodFinish
        );
    }

    /**
     * @notice as sweep time may be updated by both the draw and reward functions, we have defensive logic to ensure it is set to the maximum of the two
     **/
    function rechargeRewardPool(
        IERC20[] calldata inputRewardTokens,
        uint256[] calldata inputRewardAmounts,
        uint256 _newPeriodFinish
    ) public override {
        uint256 currentRewardSweepTime = rewardSweepTime;
        // sweep time gets updated to _newPeriodFinish + LOCK_TIME
        super.rechargeRewardPool(inputRewardTokens, inputRewardAmounts, _newPeriodFinish);
        // reset to currentRewardSweepTime if new sweep time is shorter
        // ie. rewardSweepTime should always be the maximum of its current and updated value
        if (rewardSweepTime < currentRewardSweepTime) rewardSweepTime = currentRewardSweepTime;
    }

    /**
        @dev - initializes prize set for new epoch. Callable internally only after epoch has been incremented.
    **/
    function _initPrizeSet(uint64 epoch) internal {
        epochPrizeSets[epoch] = PrizeSet({
            erc721RewardTokens: new IERC721[](0),
            numERC721Prizes: 0,
            erc20RewardTokens: new IERC20[](0),
            prizePerWinner: 1
        });
    }

    /**
        @dev - O(1) lookup for previous interaction
    **/
    function firstTimeUser(address user) public view returns (bool) {
        return lastTWAPObservation[user].timestamp == 0;
    }

    /**
     * @notice Fresh state for the sortition tree at the start of a new epoch.
     * prune interactors with 0 `lastAmount` as they are effectively irrelevant
     * @dev - As we are taking a TWAP and using a persistent sortition tree, we
     * need to maintain a list of addresses who have interacted with the vault
     * in the past, and recalc the TWAP for each epoch. This is done by the
     * deployer, and is part of the cost of recharging. The interactor list is
     * pruned upon calling this function.
     */
    function recalcSortitionTreesEpochStart() internal {
        // lastObservationTimestamp is arbitrarily set as 0
        // because it is only used for calculation of timeElapsed
        // which is redundant in this function
        (, uint256 amountTimeRemainingToVaultEnd) = getTimeProgressInEpoch(block.timestamp, 0);

        // Recalculate sortition trees for everything in vaultInteractorList,
        // for the new periodFinish. Use i - 1 because (0 - 1) underflows to 
        // uintmax which causes a revert
        for (uint256 i = totalVaultInteractorList.length; i > 0; --i) {
            address vaultInteractor = totalVaultInteractorList[i - 1];
            SimpleObservation storage lastObservation = lastTWAPObservation[vaultInteractor];

            uint256 sortitionValue;
            // `lastObservation.lastAmount` remains the same
            if (lastObservation.lastAmount == 0) {
                // Delete the vault interactor from storage if they have 0 balance
                // (this is why we iterate in reverse order).
                totalVaultInteractorList[i - 1] = totalVaultInteractorList[totalVaultInteractorList.length - 1];
                totalVaultInteractorList.pop();

                // Delete vault interactor from `lastTWAPObservation`
                delete lastTWAPObservation[vaultInteractor];
            } else {
                lastObservation.timestamp = block.timestamp;
                lastObservation.twapCumSum = 0;
                lastObservation.predictedEndSum = lastObservation.lastAmount * amountTimeRemainingToVaultEnd;
                sortitionValue = lastObservation.predictedEndSum;
            }
            
            // Update the sortition tree. Sortition tree library deletes 0
            // entries for us
            bytes32 _ID = addressToBytes32(vaultInteractor);
            sortitionSumTrees.set(TREE_KEY, sortitionValue, _ID);
        }
    }

    /**
     * @notice Stake an LP token
     * @param tokenId The tokenId of the LP token to stake
     * @return amount The amount of reward token minted as a result
     * @dev - Maintain the new expected TWAP balance for the user.
     */    
    function stake(uint256 tokenId) public override returns (uint256 amount) {
        if (firstTimeUser(msg.sender)) totalVaultInteractorList.push(msg.sender);
        amount = super.stake(tokenId);
        updateSortitionStake(msg.sender, amount, true, (drawStatus == DrawStatus.Open));
    }

    /**
        @dev - if draw is open, directly calculate the expected TWAP balance for the user.
    **/    
    function burn(uint256 tokenId) internal override returns (uint256 amount) {
        amount = super.burn(tokenId);
        updateSortitionStake(msg.sender, amount, false, (drawStatus == DrawStatus.Open));
    }

    /**
       @param eventTimestamp specified timestamp of when to calculate progress from
       @param lastObservationTimestamp timestamp at which the last observation for the user was made
       @return timeElapsed the effective time elapsed during thisEpoch
       @return timeRemaining the remaining amount of usable time to extend on the current TWAP cumsum. 
       This is to calculate the expected TWAP at drawFinish so that 
       we don't have to iterate through all addresses to get the right epoch-end weighted stake.
       We check that (A) eventTimestamp is less than drawFinish.
       And it is always bounded by the drawFinish - start time, even if the vault hasn't started.
    **/
    function getTimeProgressInEpoch(
        uint256 eventTimestamp,
        uint256 lastObservationTimestamp
    ) public view returns (uint256 timeElapsed, uint256 timeRemaining) {
        uint64 _epoch = thisEpoch;
        uint256 _drawStart = epochToStartTime[_epoch];
        uint256 _drawFinish = epochToFinishTime[_epoch];

        if (eventTimestamp < _drawStart) {
            // draw has not commenced:
            // timeElapsed should be 0
            // timeRemaining should be the full draw duration
            return (0, _drawFinish - _drawStart);
        }

        // timeElapsed = min(drawFinish, eventTimestamp) - max(drawStart, lastObservationTimestamp)
        uint256 effectiveEndPoint = eventTimestamp > _drawFinish ? _drawFinish : eventTimestamp;
        uint256 effectiveStartPoint = lastObservationTimestamp < _drawStart ? _drawStart : lastObservationTimestamp;
        timeElapsed = effectiveEndPoint - effectiveStartPoint;

        timeRemaining = eventTimestamp > _drawFinish ? 0 : _drawFinish - eventTimestamp;
    }

    /**
        @dev - updateSortitionStake (updates Sortition stake and TWAP). This is called either when a user stakes/burns, but sortition tree is modified only when draw is open
    **/ 
    function updateSortitionStake(address _staker, uint256 _amount, bool isIncrement, bool modifySortition) internal {
        SimpleObservation storage lastObservation = lastTWAPObservation[_staker];
        (uint256 timeElapsed, uint256 amountTimeRemainingToVaultEnd) = getTimeProgressInEpoch(block.timestamp, lastObservation.timestamp);
        
        // update lastObservation parameters
        // increment cumulative sum given effective time elapsed
        lastObservation.twapCumSum += timeElapsed * lastObservation.lastAmount;

        lastObservation.lastAmount = isIncrement ?
            lastObservation.lastAmount + _amount :
            lastObservation.lastAmount - _amount;

        lastObservation.timestamp = block.timestamp;
        lastObservation.predictedEndSum = lastObservation.twapCumSum + (amountTimeRemainingToVaultEnd * lastObservation.lastAmount);

        if (modifySortition) {
            bytes32 _ID = addressToBytes32(_staker);
            sortitionSumTrees.set(TREE_KEY, lastObservation.predictedEndSum, _ID);
        }
    }

    /**
        @dev - get numerator/denominator for chances of winning
    **/ 
    function viewChanceOfDraw(address _staker) external view returns (uint256 chanceNumerator, uint256 chanceDenominator) {
        bytes32 _treeKey = TREE_KEY;
        chanceNumerator = sortitionSumTrees.stakeOf(_treeKey, addressToBytes32(_staker));
        chanceDenominator = sortitionSumTrees.total(_treeKey);
    }

    /**
        @dev - get number of winners and number of prizes per winner
    **/ 
    function getDrawDistribution(uint64 epoch) public view returns (uint256 numberOfDrawWinners, uint256 numberOfPrizesPerWinner, uint256 remainder) {
        numberOfPrizesPerWinner = epochPrizeSets[epoch].prizePerWinner;
        uint256 numPrizes = epochPrizeSets[epoch].numERC721Prizes;
        // numberOfPrizesPerWinner has been checked to be <= numPrizes
        // ensuring at least 1 winner
        numberOfDrawWinners = numPrizes / numberOfPrizesPerWinner;
        if (numberOfDrawWinners > MAX_PRIZE_WINNERS_PER_EPOCH) numberOfDrawWinners = MAX_PRIZE_WINNERS_PER_EPOCH;
        numberOfPrizesPerWinner = numPrizes / numberOfDrawWinners;
        remainder = numPrizes % numberOfDrawWinners;
    }

    function setPrizePerWinner(uint256 _prizePerWinner) external onlyDeployer {
        // not necessary to check drawStatus because winner config will be saved upon draw resolution: resolveDrawResults()
        _setPrizePerWinner(epochPrizeSets[thisEpoch], _prizePerWinner);
    }

    function _setPrizePerWinner(PrizeSet storage prizeSet, uint256 _prizePerWinner) internal {
        if (_prizePerWinner > prizeSet.numERC721Prizes) revert LengthLimitExceeded();
        if (_prizePerWinner == 0) revert ZeroRewardRate();
        prizeSet.prizePerWinner = _prizePerWinner;
        emit PrizesPerWinnerUpdated(thisEpoch, _prizePerWinner);
    }

    /**
        @dev - allows draw to be closed once the periodFinish has passed. Can be called by anyone (not just deployer) - in case deployer goes missing
    **/ 
    function closeDraw() external
        returns (uint32 requestId, uint32 lockBlock)
    {
        if (drawStatus != DrawStatus.Open) revert IncorrectDrawStatus();
        if (block.timestamp < epochToFinishTime[thisEpoch]) revert TooEarly();
        drawStatus = DrawStatus.Closed;
        (requestId, lockBlock) = rng.requestRandomNumber();
        myRNGRequestId = requestId;

        emit DrawClosed(thisEpoch);
    }

    /**
        @dev - pseudorandom number generation from a verifiably random starting point. 
    **/ 
    function getWinner(uint256 randomNumber, uint256 iteration) private view returns (address winner) {
        // uint256 randomNumber = epochToRandomNumber[thisEpoch];
        uint i;
        bytes32 _treeKey = TREE_KEY;
        while (true) {
            uint256 finalRandom = uint256(keccak256(abi.encodePacked(randomNumber, iteration, i)));
            winner = bytes32ToAddress(sortitionSumTrees.draw(_treeKey, finalRandom));
            if (winner != DUMMY_ADDRESS) {
                return winner;
            }
            ++i;
        }
    }

    /**
        @dev - resolvesDrawResults. This can be called by anyone (not just deployer) - in case deployer goes missing. Sets the winners and their start indices, taking reference from NFT address x ID tuples
    **/ 
    function resolveDrawResults() external {
        // cache storage read
        uint32 _myRNGRequestId = myRNGRequestId;
        if (drawStatus != DrawStatus.Closed) revert IncorrectDrawStatus();
        if (!rng.isRequestComplete(_myRNGRequestId)) revert RNGRequestIncomplete();
        uint64 _epoch = thisEpoch;
        // set drawStatus to resolved
        drawStatus = DrawStatus.Resolved;
        uint256 randomNum = rng.randomNumber(_myRNGRequestId);
        epochToRandomNumber[_epoch] = randomNum;

        // prize Distribution
        (uint256 numberOfDrawWinners, uint256 numberOfPrizesPerWinner, uint256 remainder) = getDrawDistribution(_epoch);
        epochWinnerConfigs[_epoch] = WinnerConfig(numberOfDrawWinners, numberOfPrizesPerWinner, remainder);

        // iterate through the Number of Winners
        uint256 denominator = sortitionSumTrees.total(TREE_KEY);
        bool noDrawParticipants = (denominator == 1);
        // winner list may contain duplicate addresses
        // emitted in the WinnersDrawn event but not stored
        address[] memory winnerList = new address[](numberOfDrawWinners);
        for (uint256 i; i < numberOfDrawWinners; ++i) {
            // get the winner
            address winner = noDrawParticipants ? deployer : getWinner(randomNum, i);

            //////////////////////////////////////
            // NFT amount
            //////////////////////////////////////
            epochUserPrizeStartIndices[_epoch][winner].push(i);

            // set claimable status
            if (!isPrizeClaimable[_epoch][winner]) {
                isPrizeClaimable[_epoch][winner] = true;
            }
            // save in winner list
            winnerList[i] = winner;

            //////////////////////////////////////
            // ERC20 amount
            //////////////////////////////////////
            epochUserERC20NumWinnerEntries[_epoch][winner] += 1;
        } 

        emit DrawResolved(_epoch, winnerList);
    }

    /**
        @dev - Claims your share of the prize per epoch. Takes cue from the number of ERC721 tokens, first-class prizes. ERC20 tokens distribution are determined from ERC-721 tokens
    **/
    function claimMyShare(uint64 epoch) public {
        if (!isPrizeClaimable[epoch][msg.sender]) revert NoClaimableShare();
        // blocks re-entrancy for the same epoch
        isPrizeClaimable[epoch][msg.sender] = false;

        // NFTs
        uint256[] memory startIndices = epochUserPrizeStartIndices[epoch][msg.sender];
        uint256 numberOfPrizesPerWinner = epochWinnerConfigs[epoch].numberOfPrizesPerWinner;

        // Award each winner N := numberOfPrizesPerWinner NFTs
        // winner 1 would be awarded NFTs of prize indices 1 to N
        // winner 2 would be awarded NFTs of prize indices N+1 to 2N
        // etc.
        uint256 prizeIndex;
        for (uint256 i; i < startIndices.length; ++i) {
            prizeIndex = startIndices[i] * numberOfPrizesPerWinner;
            for (uint256 j = 0; j < numberOfPrizesPerWinner; ++j) {
                // starting prize index is 1-indexed, not 0-indexed
                // hence, we use the prefix increment so that value after increment is returned and used
                NFTData storage mytuple = epochERC721PrizeIdsData[epoch][++prizeIndex];
                mytuple.nftAddress.safeTransferFrom(address(this), msg.sender, mytuple.nftID);
            }
        }

        // ERC20s
        uint256 numerator = epochUserERC20NumWinnerEntries[epoch][msg.sender];
        /**
         * @dev numberOfDrawWinners is the number of winners with duplicates
         */
        uint256 denominator = epochWinnerConfigs[epoch].numberOfDrawWinners;
        IERC20[] memory erc20RewardTokens = epochPrizeSets[epoch].erc20RewardTokens;
        for (uint256 i; i < erc20RewardTokens.length; i++) {
            IERC20 token = erc20RewardTokens[i];
            uint256 totalReward = epochERC20PrizeAmounts[epoch][token];
            uint256 userReward = (totalReward * numerator) / denominator;
            token.safeTransfer(msg.sender, userReward);
        }
        emit Claimed(epoch, msg.sender);
    }

    /**
        @dev - Claims your share of the prize for specified epochs
    **/  
    function claimMySharesMultiple(uint64[] calldata epochs) external {
        unchecked {
            for (uint256 i; i < epochs.length; ++i) {
                claimMyShare(epochs[i]);
            }
        }
    }

    /**
        @dev - Sweeps specified unclaimed NFTs, but only after rewardSweepTime
        Note that remainder NFTs count from the last index, and that prizeData is 1-indexed
        Eg. 10 NFT prizes, 4 winners for the draw = remainder of 2 NFTs
        Specified NFT ids should be 9 and 10
    **/
    function sweepUnclaimedNfts(uint64 epoch, uint256[] calldata prizeIndices) external onlyDeployer {
        if (block.timestamp < rewardSweepTime) revert TooEarly();
        unchecked {
            for (uint256 i; i < prizeIndices.length; ++i) {
                NFTData storage nftData = epochERC721PrizeIdsData[epoch][prizeIndices[i]];
                nftData.nftAddress.safeTransferFrom(address(this), msg.sender, nftData.nftID);
            }
        }
    }

    /**
        @dev - Helper functions
    **/      

    function addressToBytes32(address _address) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(_address)));
    }

    function bytes32ToAddress(bytes32 _bytes32) internal pure returns (address) {
        return address(uint160(uint256(_bytes32)));
    }
}
