import { execSync } from 'child_process';
import { sleep } from './time';

const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_STABILIZATION_MS = 5_000;

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

export interface WaitTarget {
  container: string;
  filepath: string;
  minimumBytes?: number;
}

export interface WaitForCompletionOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  stabilizationMs?: number;
  logger?: Pick<typeof console, 'log' | 'error'>;
}

export interface WaitForCompletionResult {
  sizes: Record<string, number>;
}

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
  const stabilizationTarget = Math.ceil(stabilizationMs / pollIntervalMs);

  logger.log('Waiting for agent to complete data transfer...');

  const startTime = Date.now();
  const lastSizes = new Map<string, number>();
  let stableCount = 0;

  while (Date.now() - startTime < timeoutMs) {
    await sleep(pollIntervalMs);

    const currentSizes = new Map<string, number>();

    for (const target of targets) {
      const size = readFileSize(target.container, target.filepath, logger);
      currentSizes.set(target.container, size);
      logger.log(`${target.container}: ${size} bytes`);
    }

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
      stableCount = 0;
    }

    lastSizes.clear();
    currentSizes.forEach((value, key) => lastSizes.set(key, value));
  }

  throw new Error(`Timeout: Agent did not complete within ${timeoutMs / 1000} seconds`);
}
