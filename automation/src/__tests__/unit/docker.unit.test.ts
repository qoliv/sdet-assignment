/**
 * @fileoverview Unit tests for Docker utility functions.
 * Tests environment cleanup, image building, and health check waiting
 * with mocked command execution to avoid requiring Docker runtime.
 * 
 * @module __tests__/unit/docker
 */

import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";
import {
  buildImages,
  cleanEnvironment,
  waitForHealth,
} from "../../utils/docker";

type ExecSyncMock = jest.MockedFunction<typeof execSync>;

jest.mock("child_process", () => ({
  execSync: jest.fn(),
}));

const execSyncMock = execSync as ExecSyncMock;
const { mkdtemp, mkdir, writeFile, rm, readFile, access } = fs.promises;

/**
 * Checks if a file or directory exists.
 */
async function pathExists(filepath: string): Promise<boolean> {
  try {
    await access(filepath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Test suite for Docker utility functions.
 * Mocks execSync to avoid requiring actual Docker runtime.
 */
describe("docker utilities", () => {
  /** Reset mocks and timers before each test */
  beforeEach(() => {
    execSyncMock.mockReset();
    jest.useRealTimers();
  });

  /**
   * Test: Validates environment cleaning removes old files and creates empty targets.
   */
  it("should clean the environment and prepare artifact targets", async () => {
    execSyncMock.mockReturnValue("");

    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "docker-util-"));
    const artifactsDir = path.join(tempRoot, "artifacts");
    await mkdir(artifactsDir, { recursive: true });
    await writeFile(path.join(artifactsDir, "stale.log"), "stale");

    const logger = { log: jest.fn(), warn: jest.fn() };

    try {
      await cleanEnvironment(artifactsDir, ["target1.log", "target2.log"], logger);

      expect(execSyncMock).toHaveBeenCalledWith(
        expect.stringContaining("docker compose down -v"),
        expect.objectContaining({ stdio: "inherit" })
      );
      expect(await pathExists(path.join(artifactsDir, "target1.log"))).toBe(true);
      expect(await pathExists(path.join(artifactsDir, "target2.log"))).toBe(true);
      expect(await pathExists(path.join(artifactsDir, "stale.log"))).toBe(false);
      expect(await readFile(path.join(artifactsDir, "target1.log"), "utf-8")).toBe("");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  /**
   * Test: Validates that preserved directories are kept during cleanup.
   * Useful for keeping test run history across environment resets.
   */
  it("should preserve configured subdirectories while cleaning", async () => {
    execSyncMock.mockReturnValue("");

    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "docker-util-preserve-"));
    const artifactsDir = path.join(tempRoot, "artifacts");
    const runsDir = path.join(artifactsDir, "runs");
    await mkdir(runsDir, { recursive: true });
    await writeFile(path.join(runsDir, "keep.log"), "keep");
    await writeFile(path.join(artifactsDir, "stale.log"), "stale");

    const logger = { log: jest.fn(), warn: jest.fn() };

    try {
      await cleanEnvironment(
        artifactsDir,
        ["target1.log", "target2.log"],
        logger,
        {},
        { preserve: ["runs"] }
      );

      expect(await pathExists(path.join(runsDir, "keep.log"))).toBe(true);
      expect(await pathExists(path.join(artifactsDir, "stale.log"))).toBe(false);
      expect(await pathExists(path.join(artifactsDir, "target1.log"))).toBe(true);
      expect(await pathExists(path.join(artifactsDir, "runs"))).toBe(true);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  /**
   * Test: Validates that custom Docker Compose commands are respected.
   * Important for CI environments or custom Docker contexts.
   */
  it("should honor a custom compose command when building images", () => {
    execSyncMock.mockReturnValue("");
    const logger = { log: jest.fn() };

    buildImages(logger, { composeCommand: "docker --context ci compose" });

    expect(execSyncMock).toHaveBeenCalledWith(
      expect.stringContaining("docker --context ci compose build"),
      expect.objectContaining({ stdio: "inherit" })
    );
  });

  /**
   * Test: Validates health check polling waits until services report healthy.
   * Simulates progressive health check responses until "healthy" is found.
   */
  it("should resolve once docker compose reports healthy services", async () => {
    jest.useFakeTimers();

    const outputs = ["name state", "target healthy"];
    execSyncMock.mockImplementation(() => outputs.shift() ?? "still healthy");

    const logger = { log: jest.fn(), warn: jest.fn() };
    const delayFn = jest.fn(async (ms: number) => {
      jest.advanceTimersByTime(ms);
    });

    await expect(
      waitForHealth({ pollIntervalMs: 10, timeoutMs: 100, logger, delayFn })
    ).resolves.toBeUndefined();

    expect(execSyncMock).toHaveBeenCalledWith(
      expect.stringContaining("docker compose ps"),
      expect.objectContaining({ stdio: "pipe", encoding: "utf-8" })
    );
    expect(delayFn).toHaveBeenCalled();

    jest.useRealTimers();
  });

  it("should reject when services never become healthy", async () => {
    jest.useFakeTimers();
    execSyncMock.mockReturnValue("pending");

    const logger = { log: jest.fn(), warn: jest.fn() };
    const delayFn = jest.fn(async (ms: number) => {
      jest.advanceTimersByTime(ms);
    });

    await expect(
      waitForHealth({ pollIntervalMs: 10, timeoutMs: 30, logger, delayFn })
    ).rejects.toThrow(/Services failed to become healthy/);

    jest.useRealTimers();
  });
});
