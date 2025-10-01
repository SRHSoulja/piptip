// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract SimpleTest {
    uint256 public value;

    constructor() {
        value = 42;
    }

    function setValue(uint256 _value) public {
        value = _value;
    }

    function getValue() public view returns (uint256) {
        return value;
    }
}