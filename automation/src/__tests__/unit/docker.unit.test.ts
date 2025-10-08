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

describe("docker utilities", () => {
  beforeEach(() => {
    execSyncMock.mockReset();
    jest.useRealTimers();
  });

  it("should clean the environment and prepare artifact targets", () => {
    execSyncMock.mockReturnValue("");

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "docker-util-"));
    const artifactsDir = path.join(tempRoot, "artifacts");
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(path.join(artifactsDir, "stale.log"), "stale");

    const logger = { log: jest.fn(), warn: jest.fn() };

    try {
      cleanEnvironment(artifactsDir, ["target1.log", "target2.log"], logger);

      expect(execSyncMock).toHaveBeenCalledWith(
        expect.stringContaining("docker compose down -v"),
        expect.objectContaining({ stdio: "inherit" })
      );
      expect(fs.existsSync(path.join(artifactsDir, "target1.log"))).toBe(true);
      expect(fs.existsSync(path.join(artifactsDir, "target2.log"))).toBe(true);
      expect(fs.existsSync(path.join(artifactsDir, "stale.log"))).toBe(false);
      expect(fs.readFileSync(path.join(artifactsDir, "target1.log"), "utf-8")).toBe("");
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("should preserve configured subdirectories while cleaning", () => {
    execSyncMock.mockReturnValue("");

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "docker-util-preserve-"));
    const artifactsDir = path.join(tempRoot, "artifacts");
    const runsDir = path.join(artifactsDir, "runs");
    fs.mkdirSync(runsDir, { recursive: true });
    fs.writeFileSync(path.join(runsDir, "keep.log"), "keep");
    fs.writeFileSync(path.join(artifactsDir, "stale.log"), "stale");

    const logger = { log: jest.fn(), warn: jest.fn() };

    try {
      cleanEnvironment(
        artifactsDir,
        ["target1.log", "target2.log"],
        logger,
        {},
        { preserve: ["runs"] }
      );

      expect(fs.existsSync(path.join(runsDir, "keep.log"))).toBe(true);
      expect(fs.existsSync(path.join(artifactsDir, "stale.log"))).toBe(false);
      expect(fs.existsSync(path.join(artifactsDir, "target1.log"))).toBe(true);
      expect(fs.existsSync(path.join(artifactsDir, "runs"))).toBe(true);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("should honor a custom compose command when building images", () => {
    execSyncMock.mockReturnValue("");
    const logger = { log: jest.fn() };

    buildImages(logger, { composeCommand: "docker --context ci compose" });

    expect(execSyncMock).toHaveBeenCalledWith(
      expect.stringContaining("docker --context ci compose build"),
      expect.objectContaining({ stdio: "inherit" })
    );
  });

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
