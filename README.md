# Deployment

1. Clone `.env.example` to `.env`, replace the values.

```bash
cp .env.example .env
```

2. Compile contracts

```bash
yarn compile
```

3. Run the deploy script

```bash
# Goerli deployment
yarn deploy --network goerli

# Mainnet deployment
yarn deploy --network mainnet
```

4. Verification Script

Etherscan verification might fail for various reasons. Run `yarn verify --network <network>` in the root directory.

--- 

## Collection.xyz Protocol 

Collection.xyz is a decentralized non-fungible token (NFT) marketplace supported by an automated market maker (AMM) that enables two-sided liquidity pools for all NFTs in a collection.

### Features
1. Users can create trade pools that only accept certain traits within an NFT collection. For example, Alice can create a pool that buys and sells only Bored Ape Yacht Club NFTs with the Gold Fur trait, and Bob can create another that only buys and sells M2 traits for Mutant Ape Yacht Club NFTs.
2. Liquidity pool positions are represented by a liquidity provider (LP) ownership token, which enables composability with other protocols. For example, a developer, Alice, can build an integration where the LP tokens that Bob just received for his M2 liquidity pool position can be used as collateral to borrow USDC in exchange for a yield.
3. Anyone can incentivize liquidity providers with ERC-20 or ERC-721 tokens, and to set the desired criteria for these incentives. For example, a project founder can create a liquidity incentive vault by depositing tokens, and set rewards, royalties, and fees for liquidity providers who contribute to the pool. An NFT project founder, Bob, can create a liquidity incentive vault for Bob Reward NFT by depositing 100 NFTs of the Bob Reward NFT that he just minted. Alice can then receive rewards of 10 Bob Reward NFTs on average if she contributes liquidity for 10% of the total liquidity deposited.
4. The protocol charges 0% protocol fees. Liquidity pool owners determine the pool fees and royalty percentage. If governance decides to implement protocol fees, they will be enabled as a carry percentage for the earned fees by liquidity providers. The protocol encourages royalties to be honored by liquidity pool creators, and vault creators can incentivize liquidity providers to honor royalties.
5. Users control their own curves, and can set the bonding curve, pricing functions, and fees structure.


### Contracts
Here, we give an overview of a few contracts in the Collection protocol.
- The `CollectionPoolFactory` is a factory contract for creating and deploying `CollectionPool` contracts that are used for trading and swapping non-fungible tokens (NFTs) against either ETH or a designated ERC20 token. An ERC721 LP token is minted on the creation of each pool; ownership of the pool is equated with ownership of the LP token. Ownership allows changing of some of the pool's parameters, including delta, fees, and selectivity, as well as depositing and withdrawing liquidity. These LP tokens can also be traded on third-party protocols as these are ERC721 tokens.
- The `CollectionPool` contract is an abstract contract for an NFT/TOKEN Automated Market Maker (AMM) pool. It implements the core swap logic from NFT to TOKEN and defines the core methods that are required for an AMM pool contract. These core methods include the swap method, which facilitates the swapping of NFTs for tokens, and the pullOut method, which facilitates the withdrawal of tokens from the AMM pool. The contract also defines a number of helper methods and constants that are used to facilitate these core methods, such as the _pullTokenInputAndPayProtocolFee method, which is used to calculate and pay fees on NFT/token swaps.
- The `CollectionPoolETH` contract is a child contract of the `CollectionPoolFactory` that extends the `CollectionPool` contract, which defines a standard interface for collection pools and provides common functionality such as the ability to buy and sell NFTs, calculate fees, and support royalties.
- The `ICurve` contract interface implements different types of bonding curves on the Ethereum blockchain. A bonding curve is a mathematical function that describes the relationship between the supply and demand of a particular asset, and it is often used in decentralized finance (DeFi) applications to enable users to buy and sell assets in a predictable and fair manner. Two examples. Example 1, the `ExponentialCurve` contract defines a bonding curve for an exponential curve, where each buy/sell operation changes the spot price by multiplying/dividing it by a certain value called "delta", using fixed point math to avoid rounding errors. It also has a minimum price to prevent numerical issues. Example 2, the `SigmoidCurve` contract defines a bonding curve for a sigmoid price function, and allows the user to control the max price, min price and the scaling gradient that determines how fast the min/max is approached.
- The contract `Collectionstaker` is a liquidity mining contract that allows users to create incentive vaults for trading pools that meet a certain set of incentivization parameters. As an example, we have the `RewardVaultETH` and `RewardVaultETHDraw` contracts that can be created from this contract. As a rule, contribution scores are calculated on deposit, and not recalculated after. We rely on the possibility of taking a bad trade against other users to encourage contribution of liquidity close to the actual spot price of the NFT (denoted against the token), and to discourage gaming of the reward metrics. An example of a design choice that ensures the possibility taking a bad trade for a potential bad actor that is trying to game the rewards metric, is that `CollectionPool` contracts prevent trading in the same timestamp as a pool creation.
- The `RewardVaultETH` contract is an example of a vault contract that enables users to stake their ownership LP tokens for individual `CollectionPool`'s into a vault representing a particular set of incentivization parameters. Reward tokens (multiple ERC20s) are rewarded based on the time spent in the pool (as a fraction of the total pool contributors). For further information, an overview on reward pool mechanics can be found [here](https://www.youtube.com/watch?v=iNZWMj4USUM)
- The `RewardVaultETHDraw` contract is a more advanced version of the `RewardVaultETH` contract. It is an implementation of a pool that rewards users with ERC20 tokens and/or ERC721 non-fungible tokens (NFTs) based on the amount of ETH they have staked and the duration they have staked it for. The contract also allows users to enter a draw to win additional NFTs/additional ERC20s. Draws can be run together or separately from the underlying rewards program. It also uses a sortition tree to determine the winners of the NFT draw. 
