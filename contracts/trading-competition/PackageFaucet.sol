// SPDX-License-Identifier: GNU GPLv3

pragma solidity ^0.8.0;

import {ERC20PresetMinterPauser} from "@openzeppelin/contracts/token/ERC20/presets/ERC20PresetMinterPauser.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC721Burnable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Counters} from "@openzeppelin/contracts/utils/Counters.sol";
import {SafeTransferLib} from "solmate/src/utils/SafeTransferLib.sol";

contract ERC20Mintable is ERC20PresetMinterPauser, Ownable {
    constructor(string memory _name, string memory _symbol) ERC20PresetMinterPauser(_name, _symbol) {}

    /**
     * Only the owner (PackageFaucet) can call this.
     */
    function freeMint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}

contract ERC721Mintable is ERC721, Pausable, Ownable, ERC721Burnable, ERC2981 {
    using Counters for Counters.Counter;

    Counters.Counter private _tokenIdCounter;
    string standardURI;

    constructor(string memory _name, string memory _symbol, string memory _standardURI) ERC721(_name, _symbol) {
        // 1%
        _setDefaultRoyalty(msg.sender, 100);
        standardURI = _standardURI;
    }

    function setBaseURI(string memory _uri) external onlyOwner {
        standardURI = _uri;
    }

    function _baseURI() internal view override returns (string memory) {
        return standardURI;
    }

    function freeMint(address to, uint256 amount) external onlyOwner returns (uint256[] memory) {
        uint256[] memory idsMinted = new uint256[](amount);
        uint256 tokenId = _tokenIdCounter.current();
        for (uint256 i; i < amount; ++i) {
            _safeMint(to, tokenId);
            idsMinted[i] = tokenId;
            tokenId++;
            _tokenIdCounter.increment();
        }

        return idsMinted;
    }

    // The following functions are overrides required by Solidity.

    function _burn(uint256 tokenId) internal override (ERC721) {
        super._burn(tokenId);
    }

    function supportsInterface(bytes4 interfaceId) public view override (ERC721, ERC2981) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}

contract ETHFaucet is Pausable, Ownable {
    using SafeTransferLib for address payable;

    constructor() payable {}

    /**
     * @return true iff ETH was dispensed.
     */
    function freeMint(address to, uint256 amount) external onlyOwner returns (bool) {
        if (address(this).balance >= amount) {
            payable(to).safeTransferETH(amount);
            return true;
        }

        return false;
    }
}

contract PackageFaucet is Pausable, Ownable {
    ERC20Mintable public immutable erc20Faucet;
    ERC721Mintable public immutable erc721Faucet;
    ETHFaucet public immutable ethFaucet;

    uint256 public ERC20_MINT_AMOUNT = 1000;
    uint256 public ERC721_MINT_AMOUNT = 12;
    uint256 public ETH_MINT_AMOUNT = 0.005 ether;

    mapping(address => bool) public hasClaimed;

    /**
     * Only addresses where `allowed[address] == true` can call freeMint
     */
    mapping(address => bool) public allowed;

    /**
     * Events
     */
    event receivedETH(uint256 amount);
    event insufficientETH(address to);
    event dispensedETH(address to);
    event dispensedERC20(address to);
    event dispensedERC721(uint256[] nftIds, address to);
    event addressWhitelisted(address[] addresses);

    constructor(
        string memory erc20Name,
        string memory erc20Symbol,
        string memory erc721Name,
        string memory erc721Symbol,
        string memory erc721StandardURI,
        address[] memory allowedUsers
    ) payable {
        erc20Faucet = new ERC20Mintable(erc20Name, erc20Symbol);
        erc721Faucet = new ERC721Mintable(erc721Name, erc721Symbol, erc721StandardURI);
        ethFaucet = new ETHFaucet{value: msg.value}();

        /// @dev Approve the initial list of participants
        uint256 length = allowedUsers.length;
        for (uint256 i = 0; i < length;) {
            allowed[allowedUsers[i]] = true;

            unchecked {
                ++i;
            }
        }

        emit addressWhitelisted(allowedUsers);
    }

    /**
     * @notice Dispense ETH, ERC20 tokens, and ERC721 tokens to the specified
     * address
     */
    function freeMint(address to) external {
        require(allowed[msg.sender], "Not an approved faucet user");
        require(!hasClaimed[msg.sender], "Caller already used");
        hasClaimed[msg.sender] = true;

        erc20Faucet.freeMint(to, ERC20_MINT_AMOUNT);
        uint256[] memory idsMinted = erc721Faucet.freeMint(to, ERC721_MINT_AMOUNT);
        bool ethDispensed = ethFaucet.freeMint(to, ETH_MINT_AMOUNT);

        if (ethDispensed) {
            emit dispensedETH(to);
        } else {
            emit insufficientETH(to);
        }
        emit dispensedERC20(to);
        emit dispensedERC721(idsMinted, to);
    }

    /**
     * @notice Allow an address to call `freeMint`.
     */
    function approveUser(address[] calldata addresses) external onlyOwner {
        uint256 length = addresses.length;
        for (uint256 i = 0; i < length;) {
            allowed[addresses[i]] = true;
            unchecked {
                ++i;
            }
        }

        emit addressWhitelisted(addresses);
    }

    /**
     * @notice Pause the usage of this faucet
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause the usage of this faucet
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Set the base token URI for the NFT collection this faucet dispenses
     */
    function setBaseURI(string memory _uri) external onlyOwner {
        erc721Faucet.setBaseURI(_uri);
    }

    /**
     * @notice Returns the tokenURI for the tokenId given of the NFT collection
     * this faucet dispenses
     */
    function tokenURI(uint256 tokenId) external view returns (string memory) {
        return erc721Faucet.tokenURI(tokenId);
    }

    /**
     * Proxy for calling the same function on the NFT collection this faucet
     * dispenses
     */
    function supportsInterface(bytes4 interfaceId) external view returns (bool) {
        return erc721Faucet.supportsInterface(interfaceId);
    }

    /**
     * @notice Recharge the pool's ETH balance
     */
    function rechargeETH() external payable {
        emit receivedETH(msg.value);
    }

    /**
     * @dev All ETH transfers into the faucet are accepted. This is functionally
     * equivalent to recharging the pool.
     */
    receive() external payable {
        emit receivedETH(msg.value);
    }

    /**
     * @dev All ETH transfers into the faucet are accepted. This is functionally
     * equivalent to recharging the pool.
     */
    fallback() external payable {
        emit receivedETH(msg.value);
    }
}
