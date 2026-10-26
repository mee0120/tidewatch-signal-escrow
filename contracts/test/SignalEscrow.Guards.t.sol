// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SignalEscrowTestBase} from "./SignalEscrow.Base.t.sol";
import {SignalEscrow} from "../SignalEscrow.sol";

/// @dev Tests for the replay guard, interval guard, FutureAsOf guard,
///      and the setMinInterval function added in the replay/interval update.
contract SignalEscrowGuardsTest is SignalEscrowTestBase {

    // Shared setup helper: alice has a funded escrow with price set.
    // setUp() from the base already warps to AS_OF.

    function _readyAlice() internal {
        _depositAndSetMax(alice, DEPOSIT_AMOUNT, MAX_PRICE);
        _setPrice(PRICE_PER_SIGNAL);
    }

    // ════════════════════════════════════════════════════════════════
    // 1. test_PublishSignal_RevertsOnSameAsOf
    //    Publish succeeds at T; publishing again at same T reverts
    //    with SignalAlreadyDelivered.
    // ════════════════════════════════════════════════════════════════

    function test_PublishSignal_RevertsOnSameAsOf() public {
        _readyAlice();

        // First publish at AS_OF — must succeed
        _publish(alice);
        assertEq(escrow.lastAsOf(alice), AS_OF, "lastAsOf not updated");

        // Second publish at same AS_OF — must revert SignalAlreadyDelivered
        vm.prank(provider);
        vm.expectRevert(
            abi.encodeWithSelector(
                SignalEscrow.SignalAlreadyDelivered.selector,
                AS_OF,   // last
                AS_OF    // asOf (same)
            )
        );
        escrow.publishSignal(alice, SIG_BUY, EVIDENCE, AS_OF);
    }

    // ════════════════════════════════════════════════════════════════
    // 2. test_PublishSignal_RevertsOnEarlierAsOf
    //    Publish at T, then at T-1 reverts with SignalAlreadyDelivered.
    // ════════════════════════════════════════════════════════════════

    function test_PublishSignal_RevertsOnEarlierAsOf() public {
        _readyAlice();

        // First publish at AS_OF — must succeed
        _publish(alice);

        // Second publish at AS_OF - 1 (earlier) — must revert SignalAlreadyDelivered
        uint64 earlier = AS_OF - 1;
        vm.prank(provider);
        vm.expectRevert(
            abi.encodeWithSelector(
                SignalEscrow.SignalAlreadyDelivered.selector,
                AS_OF,   // last
                earlier  // asOf
            )
        );
        escrow.publishSignal(alice, SIG_BUY, EVIDENCE, earlier);
    }

    // ════════════════════════════════════════════════════════════════
    // 3. test_PublishSignal_RevertsOnFutureAsOf
    //    asOf = block.timestamp + 1 reverts with FutureAsOf.
    // ════════════════════════════════════════════════════════════════

    function test_PublishSignal_RevertsOnFutureAsOf() public {
        _readyAlice();

        uint64 blockTime = uint64(block.timestamp); // == AS_OF after setUp warp
        uint64 future    = blockTime + 1;

        vm.prank(provider);
        vm.expectRevert(
            abi.encodeWithSelector(
                SignalEscrow.FutureAsOf.selector,
                future,
                blockTime
            )
        );
        escrow.publishSignal(alice, SIG_BUY, EVIDENCE, future);
    }

    // ════════════════════════════════════════════════════════════════
    // 4. test_PublishSignal_RevertsBeforeMinInterval
    //    After first signal at T, second at T + 3599 reverts with
    //    TooSoon (default interval 3600).
    // ════════════════════════════════════════════════════════════════

    function test_PublishSignal_RevertsBeforeMinInterval() public {
        _readyAlice();

        // First signal at AS_OF
        _publish(alice);

        // Advance 3599 seconds (one second short of DEFAULT_MIN_INTERVAL)
        uint64 tooSoonAsOf = AS_OF + DEFAULT_MIN_INTERVAL - 1; // AS_OF + 3599
        vm.warp(tooSoonAsOf);

        // earliest = lastAsOf + DEFAULT_MIN_INTERVAL = AS_OF + 3600
        uint64 earliest = AS_OF + DEFAULT_MIN_INTERVAL;

        vm.prank(provider);
        vm.expectRevert(
            abi.encodeWithSelector(
                SignalEscrow.TooSoon.selector,
                earliest,
                tooSoonAsOf
            )
        );
        escrow.publishSignal(alice, SIG_BUY, EVIDENCE, tooSoonAsOf);
    }

    // ════════════════════════════════════════════════════════════════
    // 5. test_PublishSignal_SucceedsAtMinInterval
    //    Second signal at T + 3600 succeeds (boundary is inclusive).
    // ════════════════════════════════════════════════════════════════

    function test_PublishSignal_SucceedsAtMinInterval() public {
        _readyAlice();

        // First signal at AS_OF
        _publish(alice);

        // Advance exactly DEFAULT_MIN_INTERVAL
        uint64 nextAsOf = AS_OF + DEFAULT_MIN_INTERVAL; // AS_OF + 3600
        vm.warp(nextAsOf);

        // Should succeed — no revert
        _publishAt(alice, nextAsOf);

        assertEq(escrow.lastAsOf(alice), nextAsOf, "lastAsOf should update to nextAsOf");
    }

    // ════════════════════════════════════════════════════════════════
    // 6. test_SetMinInterval_CustomInterval
    //    Subscriber sets minInterval=7200; second signal at T+3600 reverts
    //    TooSoon; at T+7200 succeeds.
    // ════════════════════════════════════════════════════════════════

    function test_SetMinInterval_CustomInterval() public {
        _readyAlice();

        // Alice sets a custom interval of 7200 s (2 h)
        vm.prank(alice);
        escrow.setMinInterval(7200);
        assertEq(escrow.minInterval(alice), 7200, "minInterval not stored");

        // First signal at AS_OF
        _publish(alice);
        assertEq(escrow.lastAsOf(alice), AS_OF);

        // ── T + 3600: should revert TooSoon (custom interval 7200 > 3600) ──
        uint64 tooSoonAsOf = AS_OF + 3600;
        vm.warp(tooSoonAsOf);
        uint64 earliest = AS_OF + 7200;

        vm.prank(provider);
        vm.expectRevert(
            abi.encodeWithSelector(
                SignalEscrow.TooSoon.selector,
                earliest,
                tooSoonAsOf
            )
        );
        escrow.publishSignal(alice, SIG_BUY, EVIDENCE, tooSoonAsOf);

        // ── T + 7200: should succeed ──
        uint64 okAsOf = AS_OF + 7200;
        vm.warp(okAsOf);
        _publishAt(alice, okAsOf);
        assertEq(escrow.lastAsOf(alice), okAsOf, "lastAsOf should update to okAsOf");
    }

    // ════════════════════════════════════════════════════════════════
    // 7. test_SetMinInterval_ZeroResetsToDefault
    //    setMinInterval(0) stores 0 in the mapping; effective interval is
    //    still DEFAULT_MIN_INTERVAL (3600).
    // ════════════════════════════════════════════════════════════════

    function test_SetMinInterval_ZeroResetsToDefault() public {
        _readyAlice();

        // Alice sets a custom interval then resets to default via 0
        vm.prank(alice);
        escrow.setMinInterval(7200);
        vm.prank(alice);
        escrow.setMinInterval(0);
        assertEq(escrow.minInterval(alice), 0, "mapping should store 0 for default");

        // First signal at AS_OF
        _publish(alice);

        // T + 3599: should still revert TooSoon (effective default is 3600)
        uint64 tooSoon = AS_OF + DEFAULT_MIN_INTERVAL - 1;
        vm.warp(tooSoon);
        uint64 earliest = AS_OF + DEFAULT_MIN_INTERVAL;

        vm.prank(provider);
        vm.expectRevert(
            abi.encodeWithSelector(
                SignalEscrow.TooSoon.selector,
                earliest,
                tooSoon
            )
        );
        escrow.publishSignal(alice, SIG_BUY, EVIDENCE, tooSoon);

        // T + 3600: should succeed (default interval honoured)
        uint64 okAsOf = AS_OF + DEFAULT_MIN_INTERVAL;
        vm.warp(okAsOf);
        _publishAt(alice, okAsOf);
        assertEq(escrow.lastAsOf(alice), okAsOf, "lastAsOf should update after default-interval publish");
    }

    // ════════════════════════════════════════════════════════════════
    // 8. test_PublishSignal_NextPeriodChargesNormally
    //    Publish at T and at T+3600; both charge exactly pricePerSignal
    //    and accounting is correct.
    // ════════════════════════════════════════════════════════════════

    function test_PublishSignal_NextPeriodChargesNormally() public {
        _readyAlice();

        uint256 escrowBefore   = escrow.escrowBalance(alice);
        uint256 earningsBefore = escrow.providerEarnings(provider);

        // First publish at AS_OF
        _publish(alice);

        assertEq(
            escrow.escrowBalance(alice),
            escrowBefore - PRICE_PER_SIGNAL,
            "escrow not reduced after 1st publish"
        );
        assertEq(
            escrow.providerEarnings(provider),
            earningsBefore + PRICE_PER_SIGNAL,
            "earnings not increased after 1st publish"
        );

        // Second publish at T + DEFAULT_MIN_INTERVAL
        uint64 nextAsOf = AS_OF + DEFAULT_MIN_INTERVAL;
        vm.warp(nextAsOf);
        _publishAt(alice, nextAsOf);

        assertEq(
            escrow.escrowBalance(alice),
            escrowBefore - 2 * PRICE_PER_SIGNAL,
            "escrow not reduced after 2nd publish"
        );
        assertEq(
            escrow.providerEarnings(provider),
            earningsBefore + 2 * PRICE_PER_SIGNAL,
            "earnings not doubled after 2nd publish"
        );
    }

    // ════════════════════════════════════════════════════════════════
    // setMinInterval — event and access checks
    // ════════════════════════════════════════════════════════════════

    function test_SetMinInterval_EmitsMinIntervalSet() public {
        vm.prank(alice);
        vm.expectEmit(true, false, false, true, address(escrow));
        // interval != 0 → event carries the value directly
        emit SignalEscrow.MinIntervalSet(alice, 7200);
        escrow.setMinInterval(7200);
    }

    function test_SetMinInterval_ZeroEmitsDefaultInEvent() public {
        // setMinInterval(0) emits DEFAULT_MIN_INTERVAL (3600) in the event,
        // but stores 0 in the mapping (contract design).
        vm.prank(alice);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit SignalEscrow.MinIntervalSet(alice, DEFAULT_MIN_INTERVAL);
        escrow.setMinInterval(0);
    }

    function test_SetMinInterval_AnySubscriberCanSet() public {
        // bob (not alice) can set their own interval without any access check
        vm.prank(bob);
        escrow.setMinInterval(1800);
        assertEq(escrow.minInterval(bob), 1800, "bob minInterval not stored");
        // alice's interval is unaffected
        assertEq(escrow.minInterval(alice), 0, "alice minInterval should be untouched");
    }

    // ════════════════════════════════════════════════════════════════
    // lastAsOf — stored correctly after publish
    // ════════════════════════════════════════════════════════════════

    function test_PublishSignal_StoresLastAsOf() public {
        _readyAlice();
        _publish(alice);
        assertEq(escrow.lastAsOf(alice), AS_OF, "lastAsOf not stored after publish");
    }

    function test_PublishSignal_LastAsOfDefaultsToZero() public view {
        // Before any publish, lastAsOf is 0
        assertEq(escrow.lastAsOf(alice), 0, "lastAsOf should be 0 before any publish");
    }

    // ════════════════════════════════════════════════════════════════
    // Constants
    // ════════════════════════════════════════════════════════════════

    function test_DefaultMinIntervalConstant() public view {
        assertEq(escrow.DEFAULT_MIN_INTERVAL(), 3600, "DEFAULT_MIN_INTERVAL should be 3600");
    }

    // ════════════════════════════════════════════════════════════════
    // test_PublishSignal_RevertsOnInvalidSignal
    //   signal=3 (> SIGNAL_AVOID=2) must revert with InvalidSignal(3).
    // ════════════════════════════════════════════════════════════════

    function test_PublishSignal_RevertsOnInvalidSignal() public {
        _readyAlice();

        vm.prank(provider);
        vm.expectRevert(
            abi.encodeWithSelector(SignalEscrow.InvalidSignal.selector, uint8(3))
        );
        escrow.publishSignal(alice, 3, EVIDENCE, AS_OF);
    }
}
