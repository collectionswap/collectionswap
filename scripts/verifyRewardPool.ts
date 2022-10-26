import fs from "fs";

import type { HardhatRuntimeEnvironment } from "hardhat/types";

export async function verifyRewardPool(
  taskArgs: any,
  hre: HardhatRuntimeEnvironment
) {
  // Read file from input
  const poolParams = JSON.parse(fs.readFileSync(taskArgs.i, "utf8"));
  console.log("verifying RewardPool...");
  await hre.run("verify:verify", {
    address: poolParams.address,
    constructorArguments: [
      poolParams.lpToken,
      poolParams.nft,
      poolParams.bondingCurve,
      poolParams.delta,
      poolParams.fee,
      poolParams.rewardToken,
      poolParams.startTime,
      poolParams.endTime,
      poolParams.rewardRate,
    ],
  });
}
