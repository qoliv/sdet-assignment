/**
 * @fileoverview Utilities for waiting for data transfer completion in Docker containers.
 * Monitors file sizes within containers and uses a stabilization mechanism to detect
 * when data transfer is complete.
 * 
 * @module utils/waitForCompletion
 */

import { execSync } from 'child_process';
import { sleep } from './time';

/** Default maximum time to wait for data transfer completion (5 minutes) */
const DEFAULT_TIMEOUT_MS = 300_000;
/** Default interval between file size checks (2 seconds) */
const DEFAULT_POLL_INTERVAL_MS = 2_000;
/** Default time files must remain stable to be considered complete (5 seconds) */
const DEFAULT_STABILIZATION_MS = 5_000;

/**
 * Reads the size of a file from within a Docker container.
 * Uses `wc -c` command executed via docker compose exec.
 * 
 * @param container - Name of the Docker container
 * @param filepath - Path to the file within the container
 * @param logger - Logger for error messages
 * @returns File size in bytes, or 0 if reading fails
 */
function readFileSize(container: string, filepath: string, logger: Pick<typeof console, 'error'>): number {
  try {
    const output = execSync(
      `docker compose exec -T ${container} sh -c "wc -c < ${filepath} 2>/dev/null || echo 0"`,
      { encoding: 'utf-8' }
    );
    const parsed = Number.parseInt(output.trim(), 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  } catch (error) {
    if (error instanceof Error) {
      logger.error(`Failed to read file size from ${container}:${filepath}: ${error.message}`);
    }
    return 0;
  }
}

/**
 * Target file to monitor for completion.
 */
export interface WaitTarget {
  /** Name of the Docker container */
  container: string;
  /** Path to the file within the container */
  filepath: string;
  /** Minimum file size in bytes to be considered valid (default: 1) */
  minimumBytes?: number;
}

/**
 * Options for waiting for data transfer completion.
 */
export interface WaitForCompletionOptions {
  /** Maximum time to wait in milliseconds (default: 300000 / 5 minutes) */
  timeoutMs?: number;
  /** Interval between file size checks in milliseconds (default: 2000) */
  pollIntervalMs?: number;
  /** Time files must remain stable in milliseconds (default: 5000) */
  stabilizationMs?: number;
  /** Logger for status and error messages */
  logger?: Pick<typeof console, 'log' | 'error'>;
}

/**
 * Result of waiting for completion.
 */
export interface WaitForCompletionResult {
  /** Final file sizes for each target container */
  sizes: Record<string, number>;
}

/**
 * Waits for data transfer to complete by monitoring file sizes in Docker containers.
 * Files are considered complete when they reach minimum size requirements and remain
 * stable (unchanged) for a specified stabilization period.
 * 
 * @param targets - Array of target files to monitor
 * @param options - Configuration options for timeout, polling, and stabilization
 * @returns Object containing final file sizes for each target
 * @throws Error if no targets provided or timeout is reached before completion
 * 
 * @remarks
 * The function uses a stabilization mechanism to avoid premature completion detection:
 * - Polls file sizes at regular intervals
 * - Tracks consecutive polls where all files are stable (unchanged)
 * - Only considers transfer complete after files remain stable for stabilizationMs
 * 
 * This approach handles cases where:
 * - File writes may be buffered or occur in bursts
 * - Network delays may cause intermittent pauses in data transfer
 * - Multiple containers are writing concurrently
 * 
 * @example
 * ```typescript
 * const result = await waitForCompletion([
 *   { container: 'target_1', filepath: '/data/output.log', minimumBytes: 100 },
 *   { container: 'target_2', filepath: '/data/output.log', minimumBytes: 100 }
 * ], {
 *   timeoutMs: 60000,
 *   pollIntervalMs: 2000,
 *   stabilizationMs: 5000
 * });
 * console.log('Final sizes:', result.sizes);
 * ```
 */
export async function waitForCompletion(
  targets: WaitTarget[],
  options: WaitForCompletionOptions = {}
): Promise<WaitForCompletionResult> {
  if (targets.length === 0) {
    throw new Error('At least one target must be provided to wait for completion.');
  }

  const logger = options.logger ?? console;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const stabilizationMs = options.stabilizationMs ?? DEFAULT_STABILIZATION_MS;
  // Calculate how many consecutive stable polls are needed
  const stabilizationTarget = Math.ceil(stabilizationMs / pollIntervalMs);

  logger.log('Waiting for agent to complete data transfer...');

  const startTime = Date.now();
  const lastSizes = new Map<string, number>();
  let stableCount = 0;

  while (Date.now() - startTime < timeoutMs) {
    await sleep(pollIntervalMs);

    const currentSizes = new Map<string, number>();

    // Read file sizes from all target containers
    for (const target of targets) {
      const size = readFileSize(target.container, target.filepath, logger);
      currentSizes.set(target.container, size);
      logger.log(`${target.container}: ${size} bytes`);
    }

    // Check if all files are stable (unchanged and meeting minimum size)
    const allStable = targets.every((target) => {
      const key = target.container;
      const previous = lastSizes.get(key);
      const current = currentSizes.get(key) ?? 0;
      const minimum = target.minimumBytes ?? 1;
      return previous === current && current >= minimum;
    });

    if (allStable) {
      stableCount += 1;
      logger.log(`Files stable (${stableCount}/${stabilizationTarget})`);
      if (stableCount >= stabilizationTarget) {
        logger.log('Data transfer completed successfully');
        const sizes = Object.fromEntries(currentSizes);
        return { sizes };
      }
    } else {
      // Files changed, reset stability counter
      stableCount = 0;
    }

    // Update last known sizes for next iteration
    lastSizes.clear();
    currentSizes.forEach((value, key) => lastSizes.set(key, value));
  }

  throw new Error(`Timeout: Agent did not complete within ${timeoutMs / 1000} seconds`);
}
