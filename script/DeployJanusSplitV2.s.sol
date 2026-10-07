// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/JanusSplitV2.sol";

/**
 * Deploys V2 beside the existing JanusSplit deployment.
 * The old contract is never modified or replaced by this script.
 *
 * Usage:
 *   forge script script/DeployJanusSplitV2.s.sol \
 *     --rpc-url https://rpc.testnet.monad.xyz \
 *     --broadcast --private-key $PRIVATE_KEY -vvvv
 */
contract DeployJanusSplitV2 is Script {
    address constant AUSD_TESTNET = 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC;

    function run() external returns (JanusSplitV2 settler) {
        address ausdAddress = vm.envOr("AUSD_ADDRESS", AUSD_TESTNET);
        require(ausdAddress != address(0), "Deploy: AUSD address not set");

        uint256 deployerKey = vm.envOr("PRIVATE_KEY", uint256(0));
        if (deployerKey != 0) vm.startBroadcast(deployerKey);
        else vm.startBroadcast();

        settler = new JanusSplitV2(ausdAddress);

        console2.log("===== JANUS V2 DEPLOYMENT =====");
        console2.log("Chain ID           :", block.chainid);
        console2.log("JanusSplitV2 address:", address(settler));
        console2.log("AUSD token         :", ausdAddress);
        console2.log("Deployer           :", msg.sender);
        console2.log("================================");

        vm.stopBroadcast();
    }
}
