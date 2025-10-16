/**
 * @fileoverview Unit tests for time utility functions.
 * Tests async delay functionality using fake timers to avoid
 * actual waiting in tests.
 * 
 * @module __tests__/unit/time
 */

import { sleep } from "../../utils/time";

/**
 * Test suite for time helper functions.
 * Uses Jest fake timers for fast, deterministic testing.
 */
describe("time helpers", () => {
  /** Setup: Use fake timers to control time progression */
  beforeEach(() => {
    jest.useFakeTimers();
  });

  /** Teardown: Restore real timers */
  afterEach(() => {
    jest.useRealTimers();
  });

  /**
   * Test: Validates that sleep resolves only after the specified delay.
   * Uses fake timers to advance time without actual waiting.
   */
  it("should resolve only after the specified delay elapses", async () => {
    const onResolved = jest.fn();
    const promise = sleep(200);
    promise.then(onResolved);

    // Advance time but not enough to trigger resolution
    await jest.advanceTimersByTimeAsync(199);
    expect(onResolved).not.toHaveBeenCalled();

    // Advance the final millisecond to trigger resolution
    await jest.advanceTimersByTimeAsync(1);
    expect(onResolved).toHaveBeenCalledTimes(1);
    await expect(promise).resolves.toBeUndefined();
  });
});
