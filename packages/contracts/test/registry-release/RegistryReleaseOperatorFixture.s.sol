// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {BoardroomKernelSelectors} from "../../src/boardroom/diamond/BoardroomKernelSelectors.sol";
import {ProtocolFacetRegistry} from "../../src/boardroom/diamond/ProtocolFacetRegistry.sol";
import {ProtocolFacetTypes} from "../../src/boardroom/diamond/ProtocolFacetTypes.sol";

contract RegistryReleaseOperatorFacetA {
    function value() external pure returns (uint256) {
        return 1;
    }
}

contract RegistryReleaseOperatorFacetB {
    function value() external pure returns (uint256) {
        return 2;
    }

    function mutate(bytes32) external {}
}

/// @notice Disposable Anvil fixture for the post-genesis registry release operator.
contract RegistryReleaseOperatorFixture is Script {
    uint256 internal constant DEFAULT_ANVIL_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    bytes4 internal constant VIEW_SELECTOR = 0x10000001;
    bytes4 internal constant MUTATING_SELECTOR = 0x10000002;
    bytes32 internal constant STORAGE_LAYOUT_HASH = keccak256("registry-release-operator-layout");

    function run() external {
        uint256 ownerKey = vm.envOr("REGISTRY_RELEASE_FIXTURE_PRIVATE_KEY", DEFAULT_ANVIL_KEY);
        address owner = vm.addr(ownerKey);

        vm.startBroadcast(ownerKey);
        RegistryReleaseOperatorFacetA facetA = new RegistryReleaseOperatorFacetA();
        RegistryReleaseOperatorFacetB facetB = new RegistryReleaseOperatorFacetB();
        ProtocolFacetRegistry registry = new ProtocolFacetRegistry(owner, BoardroomKernelSelectors.selectors());

        ProtocolFacetTypes.RouteDefinition[] memory releaseARoutes = new ProtocolFacetTypes.RouteDefinition[](1);
        releaseARoutes[0] = _route(VIEW_SELECTOR, address(facetA), ProtocolFacetTypes.RouteKind.View);
        ProtocolFacetTypes.FacetSetManifest memory releaseA = ProtocolFacetTypes.FacetSetManifest({
            release: 1,
            requiredStorageVersion: 1,
            predecessorFacetSetHash: bytes32(0),
            storageLayoutHash: STORAGE_LAYOUT_HASH,
            manifestHash: keccak256("registry-release-operator-release-a"),
            routes: releaseARoutes,
            migrationFacet: address(0),
            migrationSelector: bytes4(0)
        });
        bytes32 releaseAHash = registry.publishFacetSet(releaseA);
        registry.activateFacetSet(releaseAHash);

        ProtocolFacetTypes.RouteDefinition[] memory releaseBRoutes = new ProtocolFacetTypes.RouteDefinition[](2);
        releaseBRoutes[0] = _route(VIEW_SELECTOR, address(facetB), ProtocolFacetTypes.RouteKind.View);
        releaseBRoutes[1] = _route(MUTATING_SELECTOR, address(facetB), ProtocolFacetTypes.RouteKind.Mutating);
        ProtocolFacetTypes.FacetSetManifest memory releaseB = ProtocolFacetTypes.FacetSetManifest({
            release: 2,
            requiredStorageVersion: 1,
            predecessorFacetSetHash: releaseAHash,
            storageLayoutHash: STORAGE_LAYOUT_HASH,
            manifestHash: keccak256("registry-release-operator-release-b"),
            routes: releaseBRoutes,
            migrationFacet: address(0),
            migrationSelector: bytes4(0)
        });
        bytes32 releaseBHash = registry.computeFacetSetHash(releaseB);

        ProtocolFacetTypes.RouteDefinition[] memory releaseCRoutes = new ProtocolFacetTypes.RouteDefinition[](0);
        ProtocolFacetTypes.FacetSetManifest memory releaseC = ProtocolFacetTypes.FacetSetManifest({
            release: 3,
            requiredStorageVersion: 1,
            predecessorFacetSetHash: releaseBHash,
            storageLayoutHash: STORAGE_LAYOUT_HASH,
            manifestHash: keccak256("registry-release-operator-emergency-empty-release"),
            routes: releaseCRoutes,
            migrationFacet: address(0),
            migrationSelector: bytes4(0)
        });
        bytes32 releaseCHash = registry.computeFacetSetHash(releaseC);
        vm.stopBroadcast();

        _writeManifest(releaseB, releaseBHash);
        _writeEmptyManifest(releaseC, releaseCHash);
        _writeState(owner, registry, releaseAHash, releaseBHash, releaseCHash);
    }

    function _route(bytes4 selector, address facet, ProtocolFacetTypes.RouteKind kind)
        internal
        view
        returns (ProtocolFacetTypes.RouteDefinition memory)
    {
        return ProtocolFacetTypes.RouteDefinition({
            selector: selector, facet: facet, codeHash: facet.codehash, kind: kind
        });
    }

    function _writeManifest(ProtocolFacetTypes.FacetSetManifest memory manifest, bytes32 expectedHash) internal {
        string memory manifestPath = vm.envString("REGISTRY_RELEASE_FIXTURE_MANIFEST_PATH");
        string memory json = string.concat(
            "{\n",
            '  "schemaVersion": 1,\n',
            '  "release": 2,\n',
            '  "requiredStorageVersion": 1,\n',
            '  "predecessorFacetSetHash": "',
            vm.toString(manifest.predecessorFacetSetHash),
            '",\n',
            '  "storageLayoutHash": "',
            vm.toString(manifest.storageLayoutHash),
            '",\n',
            '  "manifestHash": "',
            vm.toString(manifest.manifestHash),
            '",\n',
            '  "routes": [\n',
            '    {"selector":"0x10000001","facet":"',
            vm.toString(manifest.routes[0].facet),
            '","codeHash":"',
            vm.toString(manifest.routes[0].codeHash),
            '","kind":"View"},\n',
            '    {"selector":"0x10000002","facet":"',
            vm.toString(manifest.routes[1].facet),
            '","codeHash":"',
            vm.toString(manifest.routes[1].codeHash),
            '","kind":"Mutating"}\n',
            "  ],\n",
            '  "migrationFacet": "0x0000000000000000000000000000000000000000",\n',
            '  "migrationSelector": "0x00000000"\n',
            "}\n"
        );
        vm.writeFile(manifestPath, json);

        // Keep the computed hash live in the script so a malformed fixture cannot
        // accidentally pass only because the shell copied an expected value.
        require(expectedHash != bytes32(0), "zero release B hash");
    }

    function _writeEmptyManifest(ProtocolFacetTypes.FacetSetManifest memory manifest, bytes32 expectedHash) internal {
        string memory json = string.concat(
            "{\n",
            '  "schemaVersion": 1,\n',
            '  "release": 3,\n',
            '  "requiredStorageVersion": 1,\n',
            '  "predecessorFacetSetHash": "',
            vm.toString(manifest.predecessorFacetSetHash),
            '",\n',
            '  "storageLayoutHash": "',
            vm.toString(manifest.storageLayoutHash),
            '",\n',
            '  "manifestHash": "',
            vm.toString(manifest.manifestHash),
            '",\n',
            '  "routes": [],\n',
            '  "migrationFacet": "0x0000000000000000000000000000000000000000",\n',
            '  "migrationSelector": "0x00000000"\n',
            "}\n"
        );
        vm.writeFile(vm.envString("REGISTRY_RELEASE_FIXTURE_EMPTY_MANIFEST_PATH"), json);
        require(expectedHash != bytes32(0), "zero release C hash");
    }

    function _writeState(
        address owner,
        ProtocolFacetRegistry registry,
        bytes32 releaseAHash,
        bytes32 releaseBHash,
        bytes32 releaseCHash
    ) internal {
        string memory objectKey = "registryReleaseOperatorFixture";
        vm.serializeUint(objectKey, "chainId", block.chainid);
        vm.serializeAddress(objectKey, "owner", owner);
        vm.serializeAddress(objectKey, "registry", address(registry));
        vm.serializeBytes32(objectKey, "registryCodeHash", address(registry).codehash);
        vm.serializeBytes32(objectKey, "releaseAHash", releaseAHash);
        vm.serializeBytes32(objectKey, "releaseBHash", releaseBHash);
        string memory output = vm.serializeBytes32(objectKey, "releaseCHash", releaseCHash);
        vm.writeJson(output, vm.envString("REGISTRY_RELEASE_FIXTURE_STATE_PATH"));
    }
}
