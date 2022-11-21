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
# Rinkeby deployment
npx hardhat deployCollectionSet --network goerli

# Mainnet deployment
npx hardhat deployCollectionSet --network mainnet
```

4. Verify RewardPool

The pool will be unverified after deployment. The first pool should be verified. Etherscan automatically verifies subsequent pools.

After pool deployment, replace the parameters in `./scripts/poolParams.json`. Then , run `npx hardhat verifyRewardPool --network rinkeby --i ./scripts/poolParams.json` in the root directory.
