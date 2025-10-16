/**
 * @fileoverview Data validation utilities for verifying integrity and distribution
 * of data transferred through the Cribl pipeline. Implements byte-level multiset
 * reconciliation to ensure no data loss or duplication occurs during processing.
 * 
 * @module validation
 */

import fs from 'fs';
import { countLines, readLinesFromFile } from './utils/files';
import { buildFrequency, subtractFrequency } from './utils/frequency';

/**
 * Line count statistics for source and target files.
 */
export interface LineCounts {
  /** Number of lines in the source file */
  source: number;
  /** Number of lines in target 1 */
  target1: number;
  /** Number of lines in target 2 */
  target2: number;
  /** Total number of lines across both targets */
  total: number;
}

/**
 * File paths for validation operations.
 */
export interface ValidationPaths {
  /** Path to the source file */
  sourceFile: string;
  /** Path to the first target file */
  target1File: string;
  /** Path to the second target file */
  target2File: string;
}

/**
 * Configuration options for validation operations.
 */
export interface ValidationOptions {
  /** Optional logger for outputting validation messages */
  logger?: Pick<typeof console, 'log' | 'warn'>;
}

const { readFile } = fs.promises;

/**
 * Validates that data has been correctly transferred from source to target files
 * without loss or duplication. Performs byte-level multiset reconciliation to ensure
 * all bytes from the source appear exactly once across the targets.
 * 
 * @param paths - File paths for source and target files to validate
 * @param options - Optional configuration including custom logger
 * @returns Line count statistics for all validated files
 * @throws Error if line counts don't match or byte reconciliation fails
 * 
 * @remarks
 * This function performs comprehensive data integrity checks:
 * 1. Validates total line counts match between source and combined targets
 * 2. Performs byte-level multiset reconciliation to detect data loss or duplication
 * 3. Optionally checks line ordering between source and targets
 */
export async function validateDataIntegrity(
  paths: ValidationPaths,
  options: ValidationOptions = {}
): Promise<LineCounts> {
  const logger = options.logger ?? console;

  logger.log('Data Integrity Validation (Byte-Level)');

  // Read all files in parallel for efficiency
  const [sourceBuf, target1Buf, target2Buf] = await Promise.all([
    readFile(paths.sourceFile),
    readFile(paths.target1File),
    readFile(paths.target2File),
  ]);

  logger.log(`Source bytes: ${sourceBuf.length}`);
  logger.log(`Target-1 bytes: ${target1Buf.length}`);
  logger.log(`Target-2 bytes: ${target2Buf.length}`);

  logger.log('Performing byte multiset reconciliation.');

  // Read lines from all files in parallel
  const [sourceLines, target1Lines, target2Lines] = await Promise.all([
    readLinesFromFile(paths.sourceFile),
    readLinesFromFile(paths.target1File),
    readLinesFromFile(paths.target2File),
  ]);

  // Verify that total line count is preserved across source and targets
  const sourceLineCount = sourceLines.length;
  const newlineCountTargets = target1Lines.length + target2Lines.length;
  if (sourceLineCount !== newlineCountTargets) {
    throw new Error(
      `Line count mismatch (source=${sourceLineCount} vs targets=${newlineCountTargets}).`
    );
  }

  // Check if line ordering is preserved when combining targets
  const combinedTargetLines = [...target1Lines, ...target2Lines];
  const orderMatches = combinedTargetLines.every((line, index) => line === sourceLines[index]);

  // Build character frequency map from source and subtract target characters
  // This ensures every byte from source appears exactly once across targets
  const sourceFreq = buildFrequency(sourceBuf.toString('utf8'));
  const ok1 = subtractFrequency(sourceFreq, target1Buf.toString('utf8'));
  const ok2 = ok1 && subtractFrequency(sourceFreq, target2Buf.toString('utf8'));
  if (!ok2 || sourceFreq.size !== 0) {
    throw new Error('Byte frequency reconciliation failed: possible data loss or duplication.');
  }

  if (!orderMatches) {
    logger.warn('Line ordering mismatch between source and targets; reconciliation succeeded but ordering changed.');
  }
  logger.log('Integrity check passed (byte multiset & newline counts match).');

  // Count lines based on newline characters in buffers
  const pseudoLines1 = countLines(target1Buf);
  const pseudoLines2 = countLines(target2Buf);
  const pseudoLinesSrc = countLines(sourceBuf);

  return {
    source: pseudoLinesSrc,
    target1: pseudoLines1,
    target2: pseudoLines2,
    total: pseudoLines1 + pseudoLines2,
  };
}

/**
 * Configuration options for distribution validation.
 */
export interface DistributionOptions {
  /** Optional logger for outputting validation messages */
  logger?: Pick<typeof console, 'log'>;
}

/**
 * Validates that data has been properly distributed across target files.
 * Ensures both targets received data when multiple lines are present and
 * calculates distribution percentages.
 * 
 * @param lineCounts - Line count statistics from data integrity validation
 * @param options - Optional configuration including custom logger
 * @throws Error if no data was processed or a target received no data when it should have
 * 
 * @remarks
 * For workloads with more than one line, this function verifies that both
 * targets received at least some data, preventing scenarios where all data
 * goes to only one target.
 */
export function validateDistribution(lineCounts: LineCounts, options: DistributionOptions = {}): void {
  const logger = options.logger ?? console;

  logger.log('Distribution Validation');

  // Ensure at least some data was processed
  if (lineCounts.total === 0) {
    throw new Error('No data was processed by any target');
  }

  // For multi-line workloads, both targets should receive data
  if (lineCounts.total > 1 && lineCounts.target1 === 0) {
    throw new Error('Target-1 received no data');
  }

  if (lineCounts.total > 1 && lineCounts.target2 === 0) {
    throw new Error('Target-2 received no data');
  }

  // Calculate and log distribution percentages
  const ratio = (lineCounts.target1 / lineCounts.total) * 100;
  logger.log(`Target-1: ${lineCounts.target1} lines (${ratio.toFixed(2)}%)`);
  logger.log(`Target-2: ${lineCounts.target2} lines (${(100 - ratio).toFixed(2)}%)`);
  if (lineCounts.total > 1) {
    logger.log('Distribution validated: Both targets received data');
  } else {
    logger.log('Distribution validated: Single target handled the payload');
  }
}

