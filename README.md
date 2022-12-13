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
