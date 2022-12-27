import { task } from "hardhat/config";

task(
  "deployCollectionSet",
  "deploy templates, curves, factory and Collectionstaker contracts"
).setAction(async (taskArgs, hre) => {
  // Only load this file when task is run because it depends on typechain built artifacts
  // which will create a circular dependency when required by hardhat.config.ts for first compilation
  const { deployCollectionSet } = await import("./deployCollectionSet");
  await deployCollectionSet(hre);

  console.log(
    "waiting for etherscan backend propagation... sleeping for 1 minute"
  );
  for (let i = 1; i <= 4; i++) {
    await new Promise((resolve) => {
      setTimeout(resolve, 15_000);
    });
    console.log(`${60 - 15 * i}s left...`);
  }

  const { verifyEtherscanCollectionSet } = await import(
    "./verifyEtherscanCollectionSet"
  );
  await verifyEtherscanCollectionSet(taskArgs, hre);
});

task(
  "verifyEtherscanCollectionSet",
  "verify Collection set contracts on Etherscan"
)
  .addOptionalParam("i", "JSON file containing exported addresses")
  .setAction(async (taskArgs, hre) => {
    // Only load this file when task is run because it depends on typechain built artifacts
    // which will create a circular dependency when required by hardhat.config.ts for first compilation
    const { verifyEtherscanCollectionSet } = await import(
      "./verifyEtherscanCollectionSet"
    );
    await verifyEtherscanCollectionSet(taskArgs, hre);
  });

task(
  "verifyTenderlyCollectionSet",
  "verify Collection set contracts on Tenderly"
).setAction(async (taskArgs, hre) => {
  // Only load this file when task is run because it depends on typechain built artifacts
  // which will create a circular dependency when required by hardhat.config.ts for first compilation
  const { verifyTenderlyCollectionSet } = await import(
    "./verifyTenderlyCollectionSet"
  );
  await verifyTenderlyCollectionSet(taskArgs, hre);
});
