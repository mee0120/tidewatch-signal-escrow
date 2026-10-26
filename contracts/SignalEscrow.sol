// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract SignalEscrow is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Signal values for ABI simplicity:
    // 0 = WAIT, 1 = BUY, 2 = AVOID.
    uint8 public constant SIGNAL_WAIT = 0;
    uint8 public constant SIGNAL_BUY = 1;
    uint8 public constant SIGNAL_AVOID = 2;

    uint64 public constant DEFAULT_MIN_INTERVAL = 3600; // 1 hour in seconds

    IERC20 public immutable usdc;
    address public provider;
    uint256 public pricePerSignal;
    mapping(address => uint256) public escrowBalance;
    mapping(address => uint256) public maxPricePerSignal;
    mapping(address => uint256) public providerEarnings;
    /// @notice Timestamp of the last signal delivered to each subscriber (asOf field).
    mapping(address => uint64) public lastAsOf;
    /// @notice Minimum seconds between signals for each subscriber. Defaults to DEFAULT_MIN_INTERVAL.
    mapping(address => uint64) public minInterval;

    event SignalDelivered(address indexed subscriber, uint8 signal, bytes32 evidenceHash, uint64 asOf, uint256 price);
    event Deposited(address indexed subscriber, uint256 amount);
    event Withdrawn(address indexed subscriber, uint256 amount);
    event PriceSet(address indexed by, uint256 newPrice);
    event MaxPriceSet(address indexed subscriber, uint256 maxPrice);
    event EarningsWithdrawn(address indexed provider, uint256 amount);
    event ProviderChanged(address indexed oldProvider, address indexed newProvider);
    event MinIntervalSet(address indexed subscriber, uint64 interval);

    error InsufficientBalance();
    error PriceExceedsMax(uint256 price, uint256 maxPrice);
    error OnlyProvider();
    error ZeroAmount();
    error ZeroAddress();
    /// @notice Raised when signal value is not WAIT (0), BUY (1), or AVOID (2).
    error InvalidSignal(uint8 signal);
    /// @notice Raised when asOf is not strictly greater than the subscriber's lastAsOf.
    error SignalAlreadyDelivered(uint64 lastAsOf, uint64 asOf);
    /// @notice Raised when asOf is in the future relative to block.timestamp.
    error FutureAsOf(uint64 asOf, uint64 blockTime);
    /// @notice Raised when asOf < lastAsOf + minInterval for this subscriber.
    error TooSoon(uint64 earliest, uint64 asOf);

    constructor(address usdcToken, address initialProvider, address owner) Ownable(owner) {
        if (usdcToken == address(0) || initialProvider == address(0) || owner == address(0)) {
            revert ZeroAddress();
        }

        usdc = IERC20(usdcToken);
        provider = initialProvider;
    }

    modifier onlyProvider() {
        if (msg.sender != provider) {
            revert OnlyProvider();
        }
        _;
    }

    function deposit(uint256 amount) external {
        if (amount == 0) {
            revert ZeroAmount();
        }

        uint256 before = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = usdc.balanceOf(address(this)) - before;
        escrowBalance[msg.sender] += received;

        emit Deposited(msg.sender, received);
    }

    function setMaxPricePerSignal(uint256 maxPrice) external {
        maxPricePerSignal[msg.sender] = maxPrice;
        emit MaxPriceSet(msg.sender, maxPrice);
    }

    function setPricePerSignal(uint256 price) external onlyProvider {
        pricePerSignal = price;
        emit PriceSet(msg.sender, price);
    }

    function publishSignal(address subscriber, uint8 signal, bytes32 evidenceHash, uint64 asOf) external onlyProvider {
        // Signal domain guard: only WAIT (0), BUY (1), AVOID (2) are valid
        if (signal > SIGNAL_AVOID) {
            revert InvalidSignal(signal);
        }

        // --- Replay / freshness guards ---
        uint64 blockTime = uint64(block.timestamp);

        // asOf must not be in the future
        if (asOf > blockTime) {
            revert FutureAsOf(asOf, blockTime);
        }

        // asOf must be strictly greater than the last delivered signal's timestamp
        uint64 last = lastAsOf[subscriber];
        if (asOf <= last) {
            revert SignalAlreadyDelivered(last, asOf);
        }

        // asOf must satisfy the subscriber's minimum interval from the last signal
        // (first signal: last == 0, so any asOf >= minInterval passes; that's intentional)
        uint64 interval = minInterval[subscriber];
        if (interval == 0) interval = DEFAULT_MIN_INTERVAL;
        uint64 earliest = last + interval;
        if (asOf < earliest) {
            revert TooSoon(earliest, asOf);
        }

        // --- Price / balance guards ---
        uint256 price = pricePerSignal;
        uint256 maxPrice = maxPricePerSignal[subscriber];

        if (price > maxPrice) {
            revert PriceExceedsMax(price, maxPrice);
        }

        if (escrowBalance[subscriber] < price) {
            revert InsufficientBalance();
        }

        // --- State changes ---
        lastAsOf[subscriber] = asOf;
        escrowBalance[subscriber] -= price;
        providerEarnings[provider] += price;

        emit SignalDelivered(subscriber, signal, evidenceHash, asOf, price);
    }

    /// @notice Subscriber sets their minimum seconds between signals. 0 resets to the default (3600 s).
    function setMinInterval(uint64 interval) external {
        minInterval[msg.sender] = interval;
        emit MinIntervalSet(msg.sender, interval == 0 ? DEFAULT_MIN_INTERVAL : interval);
    }

    function withdraw() external nonReentrant {
        uint256 amount = escrowBalance[msg.sender];
        if (amount == 0) {
            revert ZeroAmount();
        }

        escrowBalance[msg.sender] = 0;
        usdc.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Any address can withdraw its own accumulated providerEarnings.
    ///         This allows old providers to claim earnings after a provider rotation.
    function withdrawEarnings() external nonReentrant {
        uint256 amount = providerEarnings[msg.sender];
        if (amount == 0) {
            revert ZeroAmount();
        }

        providerEarnings[msg.sender] = 0;
        usdc.safeTransfer(msg.sender, amount);

        emit EarningsWithdrawn(msg.sender, amount);
    }

    function setProvider(address newProvider) external onlyOwner {
        if (newProvider == address(0)) {
            revert ZeroAddress();
        }

        address oldProvider = provider;
        provider = newProvider;

        emit ProviderChanged(oldProvider, newProvider);
    }
}
