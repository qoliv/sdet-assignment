/**
 * @fileoverview Unit tests for character frequency utilities.
 * Tests building frequency maps and subtracting characters for
 * multiset reconciliation used in data integrity validation.
 * 
 * @module __tests__/unit/frequency
 */

import { buildFrequency, subtractFrequency } from "../../utils/frequency";

/**
 * Test suite for character frequency helper functions.
 * These functions enable byte-level data integrity validation.
 */
describe("character frequency helpers", () => {
  /**
   * Test: Validates frequency map creation from a string.
   */
  it("should build a frequency map for a string", () => {
    const freq = buildFrequency("abba");
    console.debug("Frequency entries", Array.from(freq.entries()));
    expect(freq.get("a")).toBe(2);
    expect(freq.get("b")).toBe(2);
    expect(freq.size).toBe(2);
  });

  /**
   * Test: Validates character subtraction from frequency map.
   * Used to verify all bytes from source appear in targets.
   */
  it("should subtract characters when present", () => {
    const freq = buildFrequency("hello");
    const ok = subtractFrequency(freq, "ole");
    console.debug("Remaining frequency entries", Array.from(freq.entries()));
    expect(ok).toBe(true);
    expect(freq.get("h")).toBe(1);
    expect(freq.get("l")).toBe(1);
    expect(freq.has("o")).toBe(false);
  });

  /**
   * Test: Validates detection of missing characters (data loss scenario).
   */
  it("should fail when a character is missing", () => {
    const freq = buildFrequency("abc");
    const ok = subtractFrequency(freq, "abd");
    console.debug("Requested characters", "abd");
    expect(ok).toBe(false);
  });
});
