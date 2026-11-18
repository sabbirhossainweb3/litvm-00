// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @dev Test-only wrapper so Hardhat generates an artifact for ERC1967Proxy.
contract TestERC1967Proxy is ERC1967Proxy {
    constructor(address implementation, bytes memory initData)
        ERC1967Proxy(implementation, initData)
    {}
}
