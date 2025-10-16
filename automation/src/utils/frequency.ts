/**
 * @fileoverview Character frequency utilities for multiset reconciliation.
 * Used to verify data integrity by building character frequency maps and
 * subtracting characters to detect loss or duplication.
 * 
 * @module utils/frequency
 */

/**
 * Map of characters to their frequency count in a text string.
 * Used for byte-level multiset reconciliation to detect data loss or duplication.
 */
export type CharFrequency = Map<string, number>;

/**
 * Builds a character frequency map from the given text.
 * Counts the occurrence of each character in the string.
 * 
 * @param text - Input text to analyze
 * @returns Map of characters to their occurrence counts
 * 
 * @example
 * ```typescript
 * const freq = buildFrequency("hello");
 * // Returns Map { 'h' => 1, 'e' => 1, 'l' => 2, 'o' => 1 }
 * ```
 */
export function buildFrequency(text: string): CharFrequency {
  const frequency = new Map<string, number>();
  for (const ch of text) {
    frequency.set(ch, (frequency.get(ch) ?? 0) + 1);
  }
  return frequency;
}

/**
 * Subtracts characters from a target text from the source frequency map.
 * Mutates the sourceFreq map by decrementing or removing character counts.
 * 
 * @param sourceFreq - Character frequency map to subtract from (modified in place)
 * @param targetText - Text whose characters should be subtracted from the frequency map
 * @returns `true` if all characters were successfully subtracted, `false` if a character
 *          in targetText was not found in sourceFreq or had insufficient count
 * 
 * @remarks
 * This function is used for multiset reconciliation to verify that all bytes from
 * a source appear exactly once across multiple targets. If the function returns false,
 * it indicates data duplication or the target contains data not present in the source.
 */
export function subtractFrequency(sourceFreq: CharFrequency, targetText: string): boolean {
  for (const ch of targetText) {
    const currentCount = sourceFreq.get(ch);
    if (currentCount === undefined) {
      return false; // Character not found in source
    }
    if (currentCount === 1) {
      sourceFreq.delete(ch); // Remove entry when count reaches zero
    } else {
      sourceFreq.set(ch, currentCount - 1); // Decrement count
    }
  }
  return true;
}
