// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SignalEscrowTestBase} from "./SignalEscrow.Base.t.sol";
import {SignalEscrow} from "../SignalEscrow.sol";

/// @dev Case 10 – Fuzz: deposit + publish multiple times, verify exact accounting.
contract SignalEscrowFuzzTest is SignalEscrowTestBase {

    // ────────────────────────────────────────────────────────────────
    // testFuzz_DepositAccounting
    //
    // Any valid deposit amount updates escrowBalance and USDC balances exactly.
    // ────────────────────────────────────────────────────────────────
    function testFuzz_DepositAccounting(uint256 amount) public {
        // bound: 1 .. alice's balance
        amount = bound(amount, 1, usdc.balanceOf(alice));

        uint256 escrowBefore  = escrow.escrowBalance(alice);
        uint256 aliceBefore   = usdc.balanceOf(alice);
        uint256 contractBefore = usdc.balanceOf(address(escrow));

        vm.prank(alice);
        escrow.deposit(amount);

        assertEq(escrow.escrowBalance(alice),        escrowBefore   + amount, "escrow balance wrong");
        assertEq(usdc.balanceOf(alice),              aliceBefore    - amount, "alice balance wrong");
        assertEq(usdc.balanceOf(address(escrow)),    contractBefore + amount, "contract balance wrong");
    }

    // ────────────────────────────────────────────────────────────────
    // testFuzz_DepositAndPublishMultipleTimes
    //
    // Core Case 10: deposit a fuzz amount, publish N times (1..10),
    // verify that:
    //   - subscriber escrow = deposit - (n * price)
    //   - providerEarnings  = n * price
    //   - contract USDC balance = subscriber escrow (no leakage)
    // ────────────────────────────────────────────────────────────────
    function testFuzz_DepositAndPublishMultipleTimes(
        uint256 depositAmount,
        uint256 price,
        uint8   publishCount
    ) public {
        // Bound price: 1 .. 50 USDC (avoid 0 so each publish is meaningful)
        price = bound(price, 1e6, 50e6);

        // Bound count: 1 .. 10 publishes
        publishCount = uint8(bound(uint256(publishCount), 1, 10));

        // Deposit must cover all publishes
        uint256 minDeposit = price * publishCount;
        depositAmount = bound(depositAmount, minDeposit, minDeposit + 1_000e6);

        // Ensure alice has enough USDC
        usdc.mint(alice, depositAmount);

        // Alice deposits and sets max price
        vm.startPrank(alice);
        escrow.deposit(depositAmount);
        escrow.setMaxPricePerSignal(price); // max == price → always passes check
        vm.stopPrank();

        // Provider sets price
        vm.prank(provider);
        escrow.setPricePerSignal(price);

        uint256 escrowBefore   = escrow.escrowBalance(alice);
        uint256 earningsBefore = escrow.providerEarnings(provider);

        // Publish N times — each call uses a strictly-later asOf at least
        // DEFAULT_MIN_INTERVAL apart so replay and TooSoon guards pass.
        uint64 baseAsOf = AS_OF;
        for (uint256 i = 0; i < publishCount; i++) {
            uint64 asOf = baseAsOf + uint64(i) * DEFAULT_MIN_INTERVAL;
            vm.warp(asOf);
            vm.prank(provider);
            escrow.publishSignal(alice, SIG_BUY, EVIDENCE, asOf);
        }

        uint256 totalCharged = price * publishCount;

        assertEq(
            escrow.escrowBalance(alice),
            escrowBefore - totalCharged,
            "escrow balance: incorrect deduction"
        );
        assertEq(
            escrow.providerEarnings(provider),
            earningsBefore + totalCharged,
            "provider earnings: incorrect accumulation"
        );
        // Conservation: money in escrow + money in earnings == USDC held by contract
        assertEq(
            usdc.balanceOf(address(escrow)),
            escrow.escrowBalance(alice) + escrow.providerEarnings(provider),
            "conservation: USDC balance mismatch"
        );
    }

    // ────────────────────────────────────────────────────────────────
    // testFuzz_WithdrawReturnsExactBalance
    //
    // After arbitrary deposit, withdraw returns exactly the current escrow
    // balance and zeroes it.
    // ────────────────────────────────────────────────────────────────
    function testFuzz_WithdrawReturnsExactBalance(uint256 depositAmount) public {
        depositAmount = bound(depositAmount, 1, usdc.balanceOf(alice));

        vm.prank(alice);
        escrow.deposit(depositAmount);

        uint256 aliceBefore  = usdc.balanceOf(alice);
        uint256 escrowed     = escrow.escrowBalance(alice);

        vm.prank(alice);
        escrow.withdraw();

        assertEq(usdc.balanceOf(alice),       aliceBefore + escrowed, "wrong refund");
        assertEq(escrow.escrowBalance(alice), 0,                      "escrow not zeroed");
    }

    // ────────────────────────────────────────────────────────────────
    // testFuzz_MultiSubscriberIsolation
    //
    // alice and bob both deposit; publishing to alice never touches bob's balance.
    // ────────────────────────────────────────────────────────────────
    function testFuzz_MultiSubscriberIsolation(
        uint256 aliceDeposit,
        uint256 bobDeposit,
        uint256 price
    ) public {
        price        = bound(price, 1e6, 20e6);
        aliceDeposit = bound(aliceDeposit, price, price + 500e6);
        bobDeposit   = bound(bobDeposit,   price, price + 500e6);

        usdc.mint(alice, aliceDeposit);
        usdc.mint(bob,   bobDeposit);

        vm.startPrank(alice);
        escrow.deposit(aliceDeposit);
        escrow.setMaxPricePerSignal(price);
        vm.stopPrank();

        vm.startPrank(bob);
        escrow.deposit(bobDeposit);
        escrow.setMaxPricePerSignal(price);
        vm.stopPrank();

        vm.prank(provider);
        escrow.setPricePerSignal(price);

        uint256 bobEscrowBefore = escrow.escrowBalance(bob);

        // publish only to alice
        _publish(alice);

        // bob's balance must be untouched
        assertEq(escrow.escrowBalance(bob), bobEscrowBefore, "bob escrow should not change");
    }

    // ────────────────────────────────────────────────────────────────
    // testFuzz_SetPricePerSignal
    //
    // Any fuzzed price is stored exactly and only settable by provider.
    // ────────────────────────────────────────────────────────────────
    function testFuzz_SetPricePerSignal(uint256 price) public {
        vm.prank(provider);
        escrow.setPricePerSignal(price);
        assertEq(escrow.pricePerSignal(), price, "price not stored correctly");
    }

    // ────────────────────────────────────────────────────────────────
    // testFuzz_PriceExceedsMaxReverts
    //
    // Whenever price > maxPrice the revert fires with the right args.
    // ────────────────────────────────────────────────────────────────
    function testFuzz_PriceExceedsMaxReverts(uint256 price, uint256 maxPrice) public {
        // Ensure price strictly exceeds maxPrice (both non-zero to keep it interesting)
        price    = bound(price,    1, type(uint128).max);
        maxPrice = bound(maxPrice, 0, price - 1);

        _depositAndSetMax(alice, DEPOSIT_AMOUNT, maxPrice);

        vm.prank(provider);
        escrow.setPricePerSignal(price);

        vm.prank(provider);
        vm.expectRevert(
            abi.encodeWithSelector(SignalEscrow.PriceExceedsMax.selector, price, maxPrice)
        );
        escrow.publishSignal(alice, SIG_BUY, EVIDENCE, AS_OF);
    }

    // ────────────────────────────────────────────────────────────────
    // testFuzz_InsufficientBalanceReverts
    //
    // When escrow < price the InsufficientBalance revert fires.
    // ────────────────────────────────────────────────────────────────
    function testFuzz_InsufficientBalanceReverts(uint256 depositAmount, uint256 price) public {
        // price strictly greater than deposit so InsufficientBalance fires
        depositAmount = bound(depositAmount, 1, 500e6);
        price         = bound(price, depositAmount + 1, 1_000e6);

        // Set maxPrice >= price so PriceExceedsMax doesn't fire first
        _depositAndSetMax(alice, depositAmount, price);

        vm.prank(provider);
        escrow.setPricePerSignal(price);

        vm.prank(provider);
        vm.expectRevert(SignalEscrow.InsufficientBalance.selector);
        escrow.publishSignal(alice, SIG_BUY, EVIDENCE, AS_OF);
    }
}
