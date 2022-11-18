pragma solidity ^0.8.0;

import "@openzeppelin/contracts/proxy/Clones.sol";

contract TestClones {
    function clone(address implementation) external returns (address instance) {
        return Clones.clone(implementation);
    }
}
