/**
 * @fileoverview Unit tests for data transfer completion monitoring.
 * Tests file size polling and stabilization detection with mocked
 * command execution and time progression.
 * 
 * @module __tests__/unit/waitForCompletion
 */

import { execSync } from "child_process";
import { sleep } from "../../utils/time";
import {
  WaitTarget,
  waitForCompletion,
} from "../../utils/waitForCompletion";

type ExecSyncMock = jest.MockedFunction<typeof execSync>;
type SleepMock = jest.MockedFunction<typeof sleep>;

jest.mock("child_process", () => ({
  execSync: jest.fn(),
}));

jest.mock("../../utils/time", () => ({
  sleep: jest.fn(),
}));

const execSyncMock = execSync as ExecSyncMock;
const sleepMock = sleep as SleepMock;

/**
 * Test suite for waitForCompletion utility function.
 * Mocks Docker exec and time to test stabilization logic without
 * requiring actual containers or waiting.
 */
describe("waitForCompletion utility", () => {
  /** Setup: Reset all mocks before each test */
  beforeEach(() => {
    execSyncMock.mockReset();
    sleepMock.mockReset();
  });

  /** Teardown: Restore all mocks */
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * Test: Validates input validation rejects empty target arrays.
   */
  it("should throw when no targets are provided", async () => {
    await expect(waitForCompletion([])).rejects.toThrow(
      "At least one target must be provided"
    );
  });

  /**
   * Test: Validates stabilization detection and error recovery.
   * Simulates file size changes and transient errors to verify
   * the function waits for stable sizes before resolving.
   */
  it("should resolve with stabilized sizes while reporting transient errors", async () => {
    let now = 0;
    const dateNowSpy = jest.spyOn(Date, "now").mockImplementation(() => now);

    sleepMock.mockImplementation(async (ms: number) => {
      now += ms;
    });

    const responses: Array<
      | { type: "value"; value: string }
      | { type: "error"; error: Error }
    > = [
      { type: "value", value: "4\n" },
      { type: "value", value: "0\n" },
      { type: "value", value: "12\n" },
      { type: "error", error: new Error("command failed") },
      { type: "value", value: "12\n" },
      { type: "value", value: "8\n" },
      { type: "value", value: "12\n" },
      { type: "value", value: "8\n" },
    ];

    execSyncMock.mockImplementation(() => {
      const next = responses.shift();
      if (!next) {
        return "12\n";
      }
      if (next.type === "error") {
        throw next.error;
      }
      return next.value;
    });

    const logger = { log: jest.fn(), error: jest.fn() };
    const targets: WaitTarget[] = [
      { container: "target1", filepath: "/tmp/target1.log", minimumBytes: 10 },
      { container: "target2", filepath: "/tmp/target2.log" },
    ];

    const pollIntervalMs = 100;
    const result = await waitForCompletion(targets, {
      timeoutMs: 10_000,
      pollIntervalMs,
      stabilizationMs: 100,
      logger,
    });

    expect(result).toEqual({ sizes: { target1: 12, target2: 8 } });
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to read file size")
    );
  expect(sleepMock).toHaveBeenCalledTimes(4);
  expect(sleepMock).toHaveBeenCalledWith(pollIntervalMs);
    dateNowSpy.mockRestore();
  });

  it("should throw when timeout elapses before stabilization", async () => {
    let now = 0;
    const dateNowSpy = jest.spyOn(Date, "now").mockImplementation(() => now);

    sleepMock.mockImplementation(async (ms: number) => {
      now += ms;
    });

    execSyncMock.mockReturnValue("0\n");

    const logger = { log: jest.fn(), error: jest.fn() };
    const targets: WaitTarget[] = [
      { container: "target1", filepath: "/tmp/target1.log" },
    ];

    await expect(
      waitForCompletion(targets, {
        timeoutMs: 250,
        pollIntervalMs: 100,
        stabilizationMs: 100,
        logger,
      })
    ).rejects.toThrow(/Timeout: Agent did not complete/);

    expect(logger.log).toHaveBeenCalledWith(
      "Waiting for agent to complete data transfer..."
    );
    dateNowSpy.mockRestore();
  });
});
