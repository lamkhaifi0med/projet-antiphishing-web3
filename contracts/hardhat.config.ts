import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
import { HardhatUserConfig } from "hardhat/config";
import path from "node:path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const ownerPrivateKey = process.env.OWNER_PRIVATE_KEY;

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    amoy: {
      url:
        process.env.AMOY_RPC_URL ??
        "https://polygon-amoy-bor-rpc.publicnode.com",
      chainId: 80002,
      accounts: ownerPrivateKey ? [ownerPrivateKey] : [],
    },
  },
  etherscan: {
    apiKey: {
      polygonAmoy: process.env.POLYGONSCAN_API_KEY ?? "",
    },
  },
};

export default config;
