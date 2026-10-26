// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SignalEscrow} from "../SignalEscrow.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

/// @dev Shared actors, constants, and deploy fixture for all SignalEscrow test suites.
abstract contract SignalEscrowTestBase is Test {
    // ── actors ──────────────────────────────────────────────────────────────
    address internal owner    = makeAddr("owner");
    address internal provider = makeAddr("provider");
    address internal alice    = makeAddr("alice");
    address internal bob      = makeAddr("bob");
    address internal stranger = makeAddr("stranger");

    // ── contracts ───────────────────────────────────────────────────────────
    MockERC20     internal usdc;
    SignalEscrow  internal escrow;

    // ── amounts (6-decimal USDC-like) ────────────────────────────────────────
    uint256 internal constant DEPOSIT_AMOUNT   = 100e6;   // 100 USDC
    uint256 internal constant PRICE_PER_SIGNAL = 10e6;    //  10 USDC
    uint256 internal constant MAX_PRICE        = 15e6;    //  15 USDC

    // ── standard signal params ───────────────────────────────────────────────
    uint8   internal constant SIG_BUY   = 1;
    bytes32 internal constant EVIDENCE  = keccak256("evidence");

    // AS_OF is a real past timestamp; setUp() warps block.timestamp to it so
    // FutureAsOf never fires, and asOf >= DEFAULT_MIN_INTERVAL (3600) so
    // TooSoon never fires on the first publish.
    uint64  internal constant AS_OF     = 1_700_000_000;

    // DEFAULT_MIN_INTERVAL mirrors the contract constant (3600 s).
    uint64  internal constant DEFAULT_MIN_INTERVAL = 3600;

    // ── setUp ────────────────────────────────────────────────────────────────
    function setUp() public virtual {
        // Deploy mock USDC (6 decimals, like real USDC)
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);

        // Deploy SignalEscrow
        escrow = new SignalEscrow(address(usdc), provider, owner);

        // Warp to AS_OF so every helper that uses AS_OF passes FutureAsOf and
        // TooSoon (AS_OF >> DEFAULT_MIN_INTERVAL, so lastAsOf==0 case passes).
        vm.warp(AS_OF);

        // Seed alice and bob with USDC and give escrow contract approval
        usdc.mint(alice, 1_000e6);
        usdc.mint(bob,   1_000e6);

        vm.prank(alice);
        usdc.approve(address(escrow), type(uint256).max);

        vm.prank(bob);
        usdc.approve(address(escrow), type(uint256).max);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    /// Deposit `amount` from `subscriber` and set their maxPricePerSignal to `maxPrice`.
    function _depositAndSetMax(address subscriber, uint256 amount, uint256 maxPrice) internal {
        vm.startPrank(subscriber);
        escrow.deposit(amount);
        escrow.setMaxPricePerSignal(maxPrice);
        vm.stopPrank();
    }

    /// Provider sets the global pricePerSignal.
    function _setPrice(uint256 price) internal {
        vm.prank(provider);
        escrow.setPricePerSignal(price);
    }

    /// Provider publishes one signal to `subscriber` at the shared AS_OF timestamp.
    function _publish(address subscriber) internal {
        vm.prank(provider);
        escrow.publishSignal(subscriber, SIG_BUY, EVIDENCE, AS_OF);
    }

    /// Provider publishes one signal to `subscriber` at a specific `asOf` timestamp.
    function _publishAt(address subscriber, uint64 asOf) internal {
        vm.prank(provider);
        escrow.publishSignal(subscriber, SIG_BUY, EVIDENCE, asOf);
    }
}
