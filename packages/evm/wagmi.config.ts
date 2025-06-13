import { defineConfig } from "@wagmi/cli";
import { foundry } from "@wagmi/cli/plugins";

interface deploymentType {
  [x: string]: `0x${string}` | Record<number, `0x${string}`> | undefined;
}

const deployments = require("./deployments.json");

// deployments as deploymentType

export default defineConfig({
  out: "contracts.ts",
  plugins: [
    foundry({
      project: "./",
      deployments,
      exclude: [
        "EIP712.sol/**",
        "Test.sol/**",
        "Initializable.sol/**",
        "IERC20.sol/**",
        "Ownable.sol/**",
        "ERC20.sol/**",

        // the following patterns are excluded by default
        "Common.sol/**",
        "Components.sol/**",
        "Script.sol/**",
        "StdAssertions.sol/**",
        "StdInvariant.sol/**",
        "StdError.sol/**",
        "StdCheats.sol/**",
        "StdMath.sol/**",
        "StdJson.sol/**",
        "StdStorage.sol/**",
        "StdUtils.sol/**",
        "Vm.sol/**",
        "console.sol/**",
        "console2.sol/**",
        "test.sol/**",
        "**.s.sol/*.json",
        "**.t.sol/*.json",
      ],
      include: [
        "option.sol/**"
      ]
    }),
  ],
});
