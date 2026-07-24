import { ethers, run } from "hardhat";
import * as dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

async function main() {
  const [owner] = await ethers.getSigners();
  if (!owner) {
    throw new Error("OWNER_PRIVATE_KEY is required in .env to deploy to Amoy.");
  }

  console.log(`Deploying PhishingRegistry with owner: ${owner.address}`);
  const registry = await ethers.deployContract("PhishingRegistry", [
    owner.address,
  ]);
  await registry.waitForDeployment();

  const contractAddress = await registry.getAddress();
  const deploymentTx = registry.deploymentTransaction();
  console.log(`PhishingRegistry deployed at: ${contractAddress}`);
  console.log(`Deployment transaction: ${deploymentTx?.hash ?? "unavailable"}`);

  const reporterPrivateKey = process.env.REPORTER_PRIVATE_KEY;
  if (!reporterPrivateKey) {
    console.warn(
      "REPORTER_PRIVATE_KEY is not set. Add the reporter manually with setReporter before using the registry.",
    );
    return;
  }

  const reporter = new ethers.Wallet(reporterPrivateKey).address;
  const setReporterTx = await registry.setReporter(reporter, true);
  await setReporterTx.wait();
  console.log(`Reporter authorized: ${reporter}`);
  console.log(`Authorization transaction: ${setReporterTx.hash}`);

  if (!process.env.POLYGONSCAN_API_KEY) {
    console.warn(
      "POLYGONSCAN_API_KEY is not set. Skip automatic source-code verification.",
    );
    return;
  }

  console.log("Waiting for block explorer indexing before verification...");
  await new Promise((resolve) => setTimeout(resolve, 30_000));

  try {
    await run("verify:verify", {
      address: contractAddress,
      constructorArguments: [owner.address],
    });
    console.log("Source code verified on PolygonScan.");
  } catch (error) {
    console.warn(
      "Automatic verification did not complete. Run npm run verify:amoy manually after indexing.",
    );
    console.warn(error);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
