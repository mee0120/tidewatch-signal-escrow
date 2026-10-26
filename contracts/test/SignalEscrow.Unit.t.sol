// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SignalEscrowTestBase} from "./SignalEscrow.Base.t.sol";
import {SignalEscrow} from "../SignalEscrow.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @dev Unit tests for SignalEscrow covering cases 1-9.
contract SignalEscrowUnitTest is SignalEscrowTestBase {

    // ════════════════════════════════════════════════════════════════
    // 1. Deployment & initialization
    // ════════════════════════════════════════════════════════════════

    function test_Deploy_SetsUsdcAndProvider() public view {
        assertEq(address(escrow.usdc()), address(usdc), "usdc mismatch");
        assertEq(escrow.provider(), provider, "provider mismatch");
        assertEq(escrow.owner(), owner, "owner mismatch");
    }

    function test_Deploy_RevertsOnZeroUsdcAddress() public {
        vm.expectRevert(SignalEscrow.ZeroAddress.selector);
        new SignalEscrow(address(0), provider, owner);
    }

    function test_Deploy_RevertsOnZeroProviderAddress() public {
        vm.expectRevert(SignalEscrow.ZeroAddress.selector);
        new SignalEscrow(address(usdc), address(0), owner);
    }

    function test_Deploy_RevertsOnZeroOwnerAddress() public {
        // OZ Ownable(address(0)) fires OwnableInvalidOwner BEFORE the contract's
        // own ZeroAddress guard — the ZeroAddress check on `owner` is therefore
        // unreachable. The actual revert is OwnableInvalidOwner(address(0)).
        // Recorded as a CONTRACT BUG: the `if (owner == address(0)) revert ZeroAddress()`
        // guard in the constructor is dead code for the owner parameter.
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0))
        );
        new SignalEscrow(address(usdc), provider, address(0));
    }

    // ════════════════════════════════════════════════════════════════
    // Case 1 – deposit: escrowBalance increases correctly, event emitted
    // ════════════════════════════════════════════════════════════════

    function test_Deposit_IncreasesEscrowBalance() public {
        uint256 balBefore = escrow.escrowBalance(alice);
        vm.prank(alice);
        escrow.deposit(DEPOSIT_AMOUNT);
        assertEq(escrow.escrowBalance(alice), balBefore + DEPOSIT_AMOUNT, "escrow balance mismatch");
    }

    function test_Deposit_TransfersUsdcFromCaller() public {
        uint256 aliceBefore   = usdc.balanceOf(alice);
        uint256 contractBefore = usdc.balanceOf(address(escrow));
        vm.prank(alice);
        escrow.deposit(DEPOSIT_AMOUNT);
        assertEq(usdc.balanceOf(alice),           aliceBefore   - DEPOSIT_AMOUNT, "alice usdc not debited");
        assertEq(usdc.balanceOf(address(escrow)), contractBefore + DEPOSIT_AMOUNT, "escrow usdc not credited");
    }

    function test_Deposit_EmitsDepositedEvent() public {
        vm.prank(alice);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit SignalEscrow.Deposited(alice, DEPOSIT_AMOUNT);
        escrow.deposit(DEPOSIT_AMOUNT);
    }

    function test_Deposit_RevertsOnZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(SignalEscrow.ZeroAmount.selector);
        escrow.deposit(0);
    }

    function test_Deposit_AccumulatesMultipleDeposits() public {
        vm.prank(alice);
        escrow.deposit(DEPOSIT_AMOUNT);
        vm.prank(alice);
        escrow.deposit(DEPOSIT_AMOUNT);
        assertEq(escrow.escrowBalance(alice), DEPOSIT_AMOUNT * 2, "balance should double");
    }

    // ════════════════════════════════════════════════════════════════
    // Case 2 – publishSignal charges exactly pricePerSignal
    // ════════════════════════════════════════════════════════════════

    function test_PublishSignal_ChargesExactPrice() public {
        _depositAndSetMax(alice, DEPOSIT_AMOUNT, MAX_PRICE);
        _setPrice(PRICE_PER_SIGNAL);

        uint256 escrowBefore   = escrow.escrowBalance(alice);
        uint256 earningsBefore = escrow.providerEarnings(provider);

        _publish(alice);

        assertEq(escrow.escrowBalance(alice),         escrowBefore   - PRICE_PER_SIGNAL, "subscriber escrow not reduced");
        assertEq(escrow.providerEarnings(provider),   earningsBefore + PRICE_PER_SIGNAL, "provider earnings not increased");
    }

    function test_PublishSignal_EmitsSignalDelivered() public {
        _depositAndSetMax(alice, DEPOSIT_AMOUNT, MAX_PRICE);
        _setPrice(PRICE_PER_SIGNAL);

        vm.prank(provider);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit SignalEscrow.SignalDelivered(alice, SIG_BUY, EVIDENCE, AS_OF, PRICE_PER_SIGNAL);
        escrow.publishSignal(alice, SIG_BUY, EVIDENCE, AS_OF);
    }

    function test_PublishSignal_ZeroPriceDoesNotRevert() public {
        // pricePerSignal defaults to 0; maxPricePerSignal defaults to 0 → 0 <= 0 passes
        _depositAndSetMax(alice, DEPOSIT_AMOUNT, 0);
        // price == 0, max == 0, escrow >= 0 — all checks pass
        _publish(alice);
        // balance unchanged (price is 0)
        assertEq(escrow.escrowBalance(alice), DEPOSIT_AMOUNT, "balance should be unchanged for zero price");
    }

    // ════════════════════════════════════════════════════════════════
    // Case 3 – publishSignal reverts when price > maxPricePerSignal
    // ════════════════════════════════════════════════════════════════

    function test_PublishSignal_RevertsWhenPriceExceedsMax() public {
        uint256 subscriberMax = 5e6; // 5 USDC
        _depositAndSetMax(alice, DEPOSIT_AMOUNT, subscriberMax);
        _setPrice(10e6); // price 10 > max 5

        vm.prank(provider);
        vm.expectRevert(
            abi.encodeWithSelector(SignalEscrow.PriceExceedsMax.selector, uint256(10e6), uint256(5e6))
        );
        escrow.publishSignal(alice, SIG_BUY, EVIDENCE, AS_OF);
    }

    function test_PublishSignal_DoesNotRevertWhenPriceEqualsMax() public {
        _depositAndSetMax(alice, DEPOSIT_AMOUNT, PRICE_PER_SIGNAL); // max == price
        _setPrice(PRICE_PER_SIGNAL);
        _publish(alice); // should not revert
        assertEq(escrow.escrowBalance(alice), DEPOSIT_AMOUNT - PRICE_PER_SIGNAL);
    }

    // ════════════════════════════════════════════════════════════════
    // Case 4 – publishSignal reverts when escrow < pricePerSignal
    // ════════════════════════════════════════════════════════════════

    function test_PublishSignal_RevertsWhenInsufficientBalance() public {
        uint256 smallDeposit = 3e6; // only 3 USDC deposited
        _depositAndSetMax(alice, smallDeposit, MAX_PRICE);
        _setPrice(PRICE_PER_SIGNAL); // price 10 > balance 3

        vm.prank(provider);
        vm.expectRevert(SignalEscrow.InsufficientBalance.selector);
        escrow.publishSignal(alice, SIG_BUY, EVIDENCE, AS_OF);
    }

    function test_PublishSignal_RevertsWhenEscrowExactlyDrained() public {
        // drain fully, then try once more at the next valid asOf
        _depositAndSetMax(alice, PRICE_PER_SIGNAL, MAX_PRICE); // deposit exactly 1 signal's worth
        _setPrice(PRICE_PER_SIGNAL);

        _publish(alice); // first publish at AS_OF → drains to 0
        assertEq(escrow.escrowBalance(alice), 0);

        // Advance time and use a strictly-later asOf so replay/interval guards pass;
        // InsufficientBalance is the gate that should fire.
        uint64 nextAsOf = AS_OF + DEFAULT_MIN_INTERVAL;
        vm.warp(nextAsOf);
        vm.prank(provider);
        vm.expectRevert(SignalEscrow.InsufficientBalance.selector);
        escrow.publishSignal(alice, SIG_BUY, EVIDENCE, nextAsOf);
    }

    // ════════════════════════════════════════════════════════════════
    // Case 5 – withdraw: returns balance to subscriber, zeroes escrow
    // ════════════════════════════════════════════════════════════════

    function test_Withdraw_ReturnsBalanceToSubscriber() public {
        vm.prank(alice);
        escrow.deposit(DEPOSIT_AMOUNT);

        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        escrow.withdraw();

        assertEq(usdc.balanceOf(alice),    aliceBefore + DEPOSIT_AMOUNT, "alice not refunded");
        assertEq(escrow.escrowBalance(alice), 0, "escrow balance not zeroed");
    }

    function test_Withdraw_EmitsWithdrawnEvent() public {
        vm.prank(alice);
        escrow.deposit(DEPOSIT_AMOUNT);

        vm.prank(alice);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit SignalEscrow.Withdrawn(alice, DEPOSIT_AMOUNT);
        escrow.withdraw();
    }

    function test_Withdraw_RevertsWhenZeroBalance() public {
        vm.prank(alice);
        vm.expectRevert(SignalEscrow.ZeroAmount.selector);
        escrow.withdraw();
    }

    function test_Withdraw_RefundsPartialAfterPublish() public {
        // deposit 100, publish once (10), withdraw remaining 90
        _depositAndSetMax(alice, DEPOSIT_AMOUNT, MAX_PRICE);
        _setPrice(PRICE_PER_SIGNAL);
        _publish(alice);

        uint256 remaining = escrow.escrowBalance(alice);
        uint256 aliceBefore = usdc.balanceOf(alice);

        vm.prank(alice);
        escrow.withdraw();

        assertEq(usdc.balanceOf(alice),       aliceBefore + remaining, "wrong refund amount");
        assertEq(escrow.escrowBalance(alice), 0,                       "escrow not zeroed");
    }

    // ════════════════════════════════════════════════════════════════
    // Case 6 – only provider can call publishSignal
    // ════════════════════════════════════════════════════════════════

    function test_PublishSignal_RevertsForNonProvider() public {
        _depositAndSetMax(alice, DEPOSIT_AMOUNT, MAX_PRICE);
        _setPrice(PRICE_PER_SIGNAL);

        vm.prank(stranger);
        vm.expectRevert(SignalEscrow.OnlyProvider.selector);
        escrow.publishSignal(alice, SIG_BUY, EVIDENCE, AS_OF);
    }

    function test_PublishSignal_RevertsForOwnerCallingAsNonProvider() public {
        _depositAndSetMax(alice, DEPOSIT_AMOUNT, MAX_PRICE);
        _setPrice(PRICE_PER_SIGNAL);

        // owner != provider; should still revert
        vm.prank(owner);
        vm.expectRevert(SignalEscrow.OnlyProvider.selector);
        escrow.publishSignal(alice, SIG_BUY, EVIDENCE, AS_OF);
    }

    // ════════════════════════════════════════════════════════════════
    // Case 7 – setPricePerSignal: only provider can call
    // ════════════════════════════════════════════════════════════════

    function test_SetPricePerSignal_ProviderCanSet() public {
        vm.prank(provider);
        escrow.setPricePerSignal(PRICE_PER_SIGNAL);
        assertEq(escrow.pricePerSignal(), PRICE_PER_SIGNAL, "price not updated");
    }

    function test_SetPricePerSignal_EmitsPriceSet() public {
        vm.prank(provider);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit SignalEscrow.PriceSet(provider, PRICE_PER_SIGNAL);
        escrow.setPricePerSignal(PRICE_PER_SIGNAL);
    }

    function test_SetPricePerSignal_RevertsForNonProvider() public {
        vm.prank(stranger);
        vm.expectRevert(SignalEscrow.OnlyProvider.selector);
        escrow.setPricePerSignal(PRICE_PER_SIGNAL);
    }

    function test_SetPricePerSignal_RevertsForOwnerIfNotProvider() public {
        vm.prank(owner);
        vm.expectRevert(SignalEscrow.OnlyProvider.selector);
        escrow.setPricePerSignal(PRICE_PER_SIGNAL);
    }

    // ════════════════════════════════════════════════════════════════
    // Case 8 – withdrawEarnings: any address withdraws its own earnings
    // ════════════════════════════════════════════════════════════════

    function test_WithdrawEarnings_ProviderReceivesEarnings() public {
        _depositAndSetMax(alice, DEPOSIT_AMOUNT, MAX_PRICE);
        _setPrice(PRICE_PER_SIGNAL);
        _publish(alice);

        uint256 earned       = escrow.providerEarnings(provider);
        uint256 providerBefore = usdc.balanceOf(provider);

        vm.prank(provider);
        escrow.withdrawEarnings();

        assertEq(usdc.balanceOf(provider),        providerBefore + earned, "provider not paid");
        assertEq(escrow.providerEarnings(provider), 0,                      "earnings not zeroed");
    }

    function test_WithdrawEarnings_EmitsEarningsWithdrawn() public {
        _depositAndSetMax(alice, DEPOSIT_AMOUNT, MAX_PRICE);
        _setPrice(PRICE_PER_SIGNAL);
        _publish(alice);

        vm.prank(provider);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit SignalEscrow.EarningsWithdrawn(provider, PRICE_PER_SIGNAL);
        escrow.withdrawEarnings();
    }

    /// @dev withdrawEarnings no longer has onlyProvider — stranger with zero
    ///      earnings must revert ZeroAmount (not OnlyProvider).
    function test_WithdrawEarnings_RevertsZeroAmountForStrangerWithNoEarnings() public {
        // stranger has never accumulated any providerEarnings
        vm.prank(stranger);
        vm.expectRevert(SignalEscrow.ZeroAmount.selector);
        escrow.withdrawEarnings();
    }

    function test_WithdrawEarnings_RevertsWhenZeroEarnings() public {
        vm.prank(provider);
        vm.expectRevert(SignalEscrow.ZeroAmount.selector);
        escrow.withdrawEarnings();
    }

    /// @dev After a provider rotation via setProvider, the OLD provider must
    ///      still be able to call withdrawEarnings and receive their accumulated balance.
    function test_WithdrawEarnings_OldProviderCanWithdrawAfterRotation() public {
        // 1. Accumulate earnings under the current (old) provider
        _depositAndSetMax(alice, DEPOSIT_AMOUNT, MAX_PRICE);
        _setPrice(PRICE_PER_SIGNAL);
        _publish(alice);

        uint256 oldProviderEarned  = escrow.providerEarnings(provider);
        assertGt(oldProviderEarned, 0, "sanity: old provider must have earnings");

        // 2. Owner rotates to a new provider
        address newProvider = makeAddr("newProvider");
        vm.prank(owner);
        escrow.setProvider(newProvider);
        assertEq(escrow.provider(), newProvider, "provider not updated");

        // 3. Old provider withdraws their earnings — must succeed
        uint256 oldProviderUsdcBefore = usdc.balanceOf(provider);
        vm.prank(provider);
        escrow.withdrawEarnings();

        assertEq(
            usdc.balanceOf(provider),
            oldProviderUsdcBefore + oldProviderEarned,
            "old provider: wrong USDC received after rotation"
        );
        assertEq(
            escrow.providerEarnings(provider),
            0,
            "old provider: earnings not zeroed after withdrawal"
        );
    }

    // ════════════════════════════════════════════════════════════════
    // Case 9 – setProvider: only owner can call
    // ════════════════════════════════════════════════════════════════

    function test_SetProvider_OwnerCanChange() public {
        address newProvider = makeAddr("newProvider");
        vm.prank(owner);
        escrow.setProvider(newProvider);
        assertEq(escrow.provider(), newProvider, "provider not updated");
    }

    function test_SetProvider_EmitsProviderChanged() public {
        address newProvider = makeAddr("newProvider");
        vm.prank(owner);
        vm.expectEmit(true, true, false, false, address(escrow));
        emit SignalEscrow.ProviderChanged(provider, newProvider);
        escrow.setProvider(newProvider);
    }

    function test_SetProvider_RevertsForNonOwner() public {
        address newProvider = makeAddr("newProvider");
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        escrow.setProvider(newProvider);
    }

    function test_SetProvider_RevertsForProvider() public {
        // provider != owner; provider calling setProvider should revert
        address newProvider = makeAddr("newProvider");
        vm.prank(provider);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, provider)
        );
        escrow.setProvider(newProvider);
    }

    function test_SetProvider_RevertsOnZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(SignalEscrow.ZeroAddress.selector);
        escrow.setProvider(address(0));
    }

    // ════════════════════════════════════════════════════════════════
    // setMaxPricePerSignal — happy path
    // ════════════════════════════════════════════════════════════════

    function test_SetMaxPricePerSignal_StoresValue() public {
        vm.prank(alice);
        escrow.setMaxPricePerSignal(MAX_PRICE);
        assertEq(escrow.maxPricePerSignal(alice), MAX_PRICE, "max price not stored");
    }

    function test_SetMaxPricePerSignal_EmitsMaxPriceSet() public {
        vm.prank(alice);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit SignalEscrow.MaxPriceSet(alice, MAX_PRICE);
        escrow.setMaxPricePerSignal(MAX_PRICE);
    }
}
