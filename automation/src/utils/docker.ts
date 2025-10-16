/**
 * @fileoverview Docker and Docker Compose management utilities for test orchestration.
 * Provides functions for building images, managing container lifecycle, waiting for
 * health checks, and cleaning up test environments.
 * 
 * @module utils/docker
 */

import fs from "fs";
import path from "path";
import { execSync, type ExecSyncOptions } from "child_process";
import { createEmptyFiles, ensureDirExists, recreateDir } from "./files";
import { sleep } from "./time";

/**
 * Logger interface for outputting status messages and warnings.
 */
interface Logger {
  log: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
}

/** Default Docker Compose command */
const DEFAULT_COMPOSE_COMMAND = "docker compose";
const { readdir, rm: rmAsync } = fs.promises;

/** Project name used for Docker image naming */
const PROJECT_NAME = "automation";
/** List of Docker images required by the test suite */
const REQUIRED_IMAGES = [
  `${PROJECT_NAME}-agent:latest`,
  `${PROJECT_NAME}-splitter:latest`,
  `${PROJECT_NAME}-target_1:latest`,
  `${PROJECT_NAME}-target_2:latest`,
] as const;

/**
 * Configuration for Docker Compose command execution.
 */
interface ComposeExecutionConfig {
  /** Custom Docker Compose command (e.g., 'docker-compose' for older versions) */
  composeCommand?: string;
  /** Options passed to execSync for command execution */
  execOptions?: ExecSyncOptions;
}

/**
 * Options for cleaning the test environment.
 */
export interface CleanEnvironmentOptions {
  /** Array of directory/file names to preserve in artifacts directory */
  preserve?: string[];
}

/**
 * Executes a shell command and returns its output as a string.
 * 
 * @param command - Shell command to execute
 * @param options - Options for command execution
 * @returns Command output as a UTF-8 string
 */
function run(command: string, options: ExecSyncOptions = {}): string {
  return execSync(command, {
    stdio: "pipe",
    encoding: "utf-8",
    ...options,
  }) as string;
}

/**
 * Executes a shell command with output streamed to stdout/stderr.
 * Useful for long-running commands where real-time output is desired.
 * 
 * @param command - Shell command to execute
 * @param options - Options for command execution
 */
function runStreaming(command: string, options: ExecSyncOptions = {}): void {
  execSync(command, { stdio: "inherit", ...options });
}

/**
 * Constructs a full Docker Compose command by combining the base command with a subcommand.
 * 
 * @param subcommand - Docker Compose subcommand (e.g., 'up -d', 'down -v')
 * @param command - Base Docker Compose command
 * @returns Complete command string
 */
function composeCommand(subcommand: string, command: string): string {
  return `${command} ${subcommand}`.trim();
}

/**
 * Runs a Docker Compose command and returns its output.
 * 
 * @param subcommand - Docker Compose subcommand to execute
 * @param config - Configuration including compose command and exec options
 * @returns Command output as a string
 */
function runCompose(
  subcommand: string,
  { composeCommand: command = DEFAULT_COMPOSE_COMMAND, execOptions }: ComposeExecutionConfig = {}
): string {
  return run(composeCommand(subcommand, command), execOptions);
}

/**
 * Runs a Docker Compose command with streaming output.
 * 
 * @param subcommand - Docker Compose subcommand to execute
 * @param config - Configuration including compose command and exec options
 */
function runComposeStreaming(
  subcommand: string,
  { composeCommand: command = DEFAULT_COMPOSE_COMMAND, execOptions }: ComposeExecutionConfig = {}
): void {
  runStreaming(composeCommand(subcommand, command), execOptions);
}

/**
 * Brings down Docker Compose services and removes volumes.
 * Logs a warning if the operation fails but does not throw.
 * 
 * @param logger - Logger for status messages
 * @param composeConfig - Docker Compose configuration
 */
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

/**
 * Cleans the test environment by stopping containers and preparing artifacts directory.
 * Brings down Docker Compose services, clears or recreates the artifacts directory,
 * and creates empty placeholder files for expected outputs.
 * 
 * @param artifactsDir - Directory for test artifacts
 * @param targetFilenames - Names of files to create as placeholders
 * @param logger - Logger for status messages
 * @param composeConfig - Docker Compose configuration
 * @param options - Options for selective preservation of artifacts
 * 
 * @remarks
 * If options.preserve is provided, only removes non-preserved entries from the
 * artifacts directory. Otherwise, completely recreates the directory.
 */
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
    // No preservation needed, recreate the entire directory
    await recreateDir(artifactsDir);
  } else {
    // Preserve specific entries, remove everything else
    await ensureDirExists(artifactsDir);
    const entries = await readdir(artifactsDir);
    await Promise.all(
      entries.map(async (entry) => {
        if (preserve.has(entry)) {
          return; // Skip preserved entries
        }

        const entryPath = path.join(artifactsDir, entry);
        await rmAsync(entryPath, { recursive: true, force: true });
      })
    );
  }

  // Create empty placeholder files for expected outputs
  await createEmptyFiles(artifactsDir, targetFilenames);

  logger.log("Environment cleaned");
}

/**
 * Builds all Docker images defined in the docker-compose file.
 * 
 * @param logger - Logger for status messages
 * @param composeConfig - Docker Compose configuration
 */
export function buildImages(
  logger: Logger = console,
  composeConfig: ComposeExecutionConfig = {}
): void {
  logger.log("Building Docker images...");
  runComposeStreaming("build", composeConfig);
  logger.log("Images built");
}

/**
 * Lists all Docker images on the system in "repository:tag" format.
 * 
 * @returns Array of image names in "repository:tag" format
 */
function listDockerImages(): string[] {
  const output = run('docker images --format "{{.Repository}}:{{.Tag}}"');
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Checks if all required Docker images have been built.
 * 
 * @returns `true` if all required images exist, `false` otherwise
 */
export function areImagesBuilt(): boolean {
  try {
    const images = listDockerImages();
    return REQUIRED_IMAGES.every((image) => images.includes(image));
  } catch {
    return false;
  }
}

/**
 * Builds Docker images only if they don't already exist.
 * Uses an environment variable flag to avoid redundant checks across test runs.
 * 
 * @param logger - Logger for status messages
 * @param composeConfig - Docker Compose configuration
 * 
 * @remarks
 * This function optimizes test suite performance by:
 * 1. Checking if images were already built in this process (via env var)
 * 2. Checking if images exist on the system
 * 3. Only building if images are missing
 */
export function buildImagesIfNeeded(
  logger: Logger = console,
  composeConfig: ComposeExecutionConfig = {}
): void {
  if (process.env.DOCKER_IMAGES_BUILT === "true") {
    logger.log("Docker images already flagged as built, skipping rebuild");
    return;
  }

  if (areImagesBuilt()) {
    logger.log("Docker images already available, skipping rebuild");
    process.env.DOCKER_IMAGES_BUILT = "true";
    return;
  }

  buildImages(logger, composeConfig);
  process.env.DOCKER_IMAGES_BUILT = "true";
}

/**
 * Starts Docker Compose services in detached mode.
 * 
 * @param logger - Logger for status messages
 * @param composeConfig - Docker Compose configuration
 */
export function startDeployment(
  logger: Logger = console,
  composeConfig: ComposeExecutionConfig = {}
): void {
  logger.log("Starting deployment...");
  runComposeStreaming("up -d", composeConfig);
  logger.log("Deployment started");
}

/**
 * Options for waiting for Docker services to become healthy.
 */
export interface WaitForHealthOptions {
  /** Maximum time to wait in milliseconds (default: 60000) */
  timeoutMs?: number;
  /** Interval between health checks in milliseconds (default: 2000) */
  pollIntervalMs?: number;
  /** Logger for status messages */
  logger?: Logger;
  /** Custom Docker Compose command */
  composeCommand?: string;
  /** Options for command execution */
  execOptions?: ExecSyncOptions;
  /** Custom delay function (useful for testing) */
  delayFn?: (ms: number) => Promise<void>;
}

/**
 * Waits for Docker Compose services to report healthy status.
 * Polls `docker compose ps` until services are healthy or timeout is reached.
 * 
 * @param options - Configuration options for health check polling
 * @throws Error if services don't become healthy within the timeout period
 * 
 * @remarks
 * This function repeatedly checks the output of `docker compose ps` for the word
 * "healthy". It's designed to work with Docker Compose health checks defined in
 * the compose file.
 */
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

/**
 * Stops and removes Docker Compose containers and volumes.
 * 
 * @param logger - Logger for status messages
 * @param composeConfig - Docker Compose configuration
 * 
 * @remarks
 * This is typically called during test cleanup to ensure a clean state
 * for subsequent test runs.
 */
export function cleanContainers(
  logger: Logger = console,
  composeConfig: ComposeExecutionConfig = {}
): void {
  logger.log("Cleaning up containers...");
  bringDown(logger, composeConfig);
  logger.log("✓ Cleanup complete");
}
