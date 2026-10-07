// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/JanusSplit.sol";

/**
 * @title DeployJanusSplit
 * @notice Foundry deployment script for Monad Testnet (Chain ID: 10143).
 *
 * Usage:
 *   forge script script/DeployJanusSplit.s.sol \
 *     --rpc-url https://rpc.testnet.monad.xyz \
 *     --broadcast \
 *     --private-key $PRIVATE_KEY \
 *     -vvvv
 */
contract DeployJanusSplit is Script {
    // Canonical Agora AUSD token on Monad Testnet (Chain ID 10143)
    address constant AUSD_TESTNET = 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC;

    function run() external returns (JanusSplit settler) {
        address ausdAddress = vm.envOr("AUSD_ADDRESS", AUSD_TESTNET);
        require(ausdAddress != address(0), "Deploy: AUSD address not set");

        uint256 deployerKey = vm.envOr("PRIVATE_KEY", uint256(0));
        if (deployerKey != 0) {
            vm.startBroadcast(deployerKey);
        } else {
            vm.startBroadcast();
        }

        settler = new JanusSplit(ausdAddress);

        console2.log("===== JANUS DEPLOYMENT =====");
        console2.log("Chain ID          :", block.chainid);
        console2.log("JanusSplit address :", address(settler));
        console2.log("AUSD token         :", ausdAddress);
        console2.log("Deployer           :", msg.sender);
        console2.log("============================");

        vm.stopBroadcast();
    }
}
