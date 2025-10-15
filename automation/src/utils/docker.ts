import fs from "fs";
import path from "path";
import { execSync, type ExecSyncOptions } from "child_process";
import { createEmptyFiles, ensureDirExists, recreateDir } from "./files";
import { sleep } from "./time";

interface Logger {
  log: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
}

const DEFAULT_COMPOSE_COMMAND = "docker compose";
const { readdir, rm: rmAsync } = fs.promises;

interface ComposeExecutionConfig {
  composeCommand?: string;
  execOptions?: ExecSyncOptions;
}

export interface CleanEnvironmentOptions {
  preserve?: string[];
}

function run(command: string, options: ExecSyncOptions = {}): string {
  return execSync(command, {
    stdio: "pipe",
    encoding: "utf-8",
    ...options,
  }) as string;
}

function runStreaming(command: string, options: ExecSyncOptions = {}): void {
  execSync(command, { stdio: "inherit", ...options });
}

function composeCommand(subcommand: string, command: string): string {
  return `${command} ${subcommand}`.trim();
}

function runCompose(
  subcommand: string,
  { composeCommand: command = DEFAULT_COMPOSE_COMMAND, execOptions }: ComposeExecutionConfig = {}
): string {
  return run(composeCommand(subcommand, command), execOptions);
}

function runComposeStreaming(
  subcommand: string,
  { composeCommand: command = DEFAULT_COMPOSE_COMMAND, execOptions }: ComposeExecutionConfig = {}
): void {
  runStreaming(composeCommand(subcommand, command), execOptions);
}

function bringDown(
  logger: Logger,
  composeConfig: ComposeExecutionConfig
): void {
  try {
    runComposeStreaming("down -v", composeConfig);
  } catch (error) {
    if (logger.warn) {
      logger.warn(
        `${composeConfig.composeCommand ?? DEFAULT_COMPOSE_COMMAND} down encountered an issue: ${(error as Error).message}`
      );
    }
  }
}

export async function cleanEnvironment(
  artifactsDir: string,
  targetFilenames: string[],
  logger: Logger = console,
  composeConfig: ComposeExecutionConfig = {},
  options: CleanEnvironmentOptions = {}
): Promise<void> {
  logger.log("Cleaning environment...");
  bringDown(logger, composeConfig);

  const preserve = new Set(options.preserve ?? []);
  if (preserve.size === 0) {
    await recreateDir(artifactsDir);
  } else {
    await ensureDirExists(artifactsDir);
    const entries = await readdir(artifactsDir);
    await Promise.all(
      entries.map(async (entry) => {
        if (preserve.has(entry)) {
          return;
        }

        const entryPath = path.join(artifactsDir, entry);
        await rmAsync(entryPath, { recursive: true, force: true });
      })
    );
  }

  await createEmptyFiles(artifactsDir, targetFilenames);

  logger.log("Environment cleaned");
}

export function buildImages(
  logger: Logger = console,
  composeConfig: ComposeExecutionConfig = {}
): void {
  logger.log("Building Docker images...");
  runComposeStreaming("build", composeConfig);
  logger.log("Images built");
}

export function startDeployment(
  logger: Logger = console,
  composeConfig: ComposeExecutionConfig = {}
): void {
  logger.log("Starting deployment...");
  runComposeStreaming("up -d", composeConfig);
  logger.log("Deployment started");
}

export interface WaitForHealthOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  logger?: Logger;
  composeCommand?: string;
  execOptions?: ExecSyncOptions;
  delayFn?: (ms: number) => Promise<void>;
}

export async function waitForHealth(
  options: WaitForHealthOptions = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const pollIntervalMs = options.pollIntervalMs ?? 2_000;
  const logger = options.logger ?? console;
  const delay = options.delayFn ?? sleep;
  const composeConfig: ComposeExecutionConfig = {
    composeCommand: options.composeCommand,
    execOptions: options.execOptions,
  };

  logger.log("Waiting for services to be healthy...");

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const output = runCompose("ps", composeConfig);
      if (/healthy/i.test(output)) {
        logger.log("Services healthy");
        return;
      }
    } catch (error) {
      if (logger.warn) {
        logger.warn(`docker compose ps failed: ${(error as Error).message}`);
      }
    }

    logger.log("...still waiting for services");
    await delay(pollIntervalMs);
  }

  throw new Error(
    `Services failed to become healthy within ${timeoutMs / 1000} seconds`
  );
}

export function cleanContainers(
  logger: Logger = console,
  composeConfig: ComposeExecutionConfig = {}
): void {
  logger.log("Cleaning up containers...");
  bringDown(logger, composeConfig);
  logger.log("✓ Cleanup complete");
}
