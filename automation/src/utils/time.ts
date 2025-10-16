/**
 * @fileoverview Time utilities for asynchronous delays in test execution.
 * 
 * @module utils/time
 */

/**
 * Delays execution for the specified number of milliseconds.
 * Returns a Promise that resolves after the delay period.
 * 
 * @param ms - Number of milliseconds to sleep
 * @returns Promise that resolves after the specified delay
 * 
 * @example
 * ```typescript
 * await sleep(1000); // Wait for 1 second
 * console.log('Resumed after 1 second');
 * ```
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
