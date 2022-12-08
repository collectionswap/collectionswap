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

4. Verification Script

Etherscan verification might fail for various reasons. Run `npx hardhat verifyCollectionSet --network goerli` in the root directory.
