import fs from "fs";
import os from "os";
import path from "path";
import {
  validateDataIntegrity,
  validateDistribution,
  type LineCounts,
} from "../../validation";
import * as fileUtils from "../../utils/files";

describe("validation workflow", () => {
  let tempDir: string;
  let sourceFile: string;
  let target1File: string;
  let target2File: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "validation-test-"));
    sourceFile = path.join(tempDir, "source.log");
    target1File = path.join(tempDir, "target-1.log");
    target2File = path.join(tempDir, "target-2.log");
    console.debug("Temp directory", tempDir);
  });

  afterEach(() => {
    const snapshot = {
      sourceFile,
      target1File,
      target2File,
      exists: fs.existsSync(tempDir),
    };

    if (snapshot.exists) {
      const readFile = (filePath: string) =>
        fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : null;
      Object.assign(snapshot, {
        sourceContents: readFile(sourceFile),
        target1Contents: readFile(target1File),
        target2Contents: readFile(target2File),
      });
    }

    try {
      console.debug("Validation temp files", snapshot);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
      jest.restoreAllMocks();
      jest.useRealTimers();
    }
  });

  function writePipelineFiles(
    source: string,
    target1: string,
    target2: string
  ): void {
    fs.writeFileSync(sourceFile, source);
    fs.writeFileSync(target1File, target1);
    fs.writeFileSync(target2File, target2);
  }

  it("should return line counts when data matches exactly", () => {
    writePipelineFiles("line-1\nline-2\n", "line-1\n", "line-2\n");

    const counts = validateDataIntegrity({
      sourceFile,
      target1File,
      target2File,
    });

    console.debug("Baseline line counts", counts);

    expect(counts).toEqual({ source: 2, target1: 1, target2: 1, total: 2 });
  });

  it("should perform reconciliation when lines are shuffled", () => {
    writePipelineFiles("line-1\nline-2\n", "line-2\n", "line-1\n");

    const warnSpy = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const counts = validateDataIntegrity({
      sourceFile,
      target1File,
      target2File,
    });

    console.debug("Reconciliation counts", counts);
    console.debug("Warn calls", warnSpy.mock.calls);

    expect(warnSpy).toHaveBeenCalled();
    expect(counts.total).toBe(2);
  });

  it("should throw when reconciliation detects data loss", () => {
    writePipelineFiles("line-1\nline-2\n", "line-1\n", "line-x\n");

    expect(() =>
      validateDataIntegrity({
        sourceFile,
        target1File,
        target2File,
      })
    ).toThrow("Byte frequency reconciliation failed");
  });

  it("should throw when line counts differ", () => {
    writePipelineFiles("line-1\nline-2\n", "line-1\n", "line-2\nline-3\n");

    expect(() =>
      validateDataIntegrity({
        sourceFile,
        target1File,
        target2File,
      })
    ).toThrow("Line count mismatch");
  });

  it("should validate distribution and throw when a target is empty", () => {
    const validCounts: LineCounts = {
      source: 4,
      target1: 2,
      target2: 2,
      total: 4,
    };
    expect(() => validateDistribution(validCounts)).not.toThrow();

    const emptyTargetOne: LineCounts = {
      source: 4,
      target1: 0,
      target2: 4,
      total: 4,
    };
    expect(() => validateDistribution(emptyTargetOne)).toThrow(
      "Target-1 received no data"
    );

    const emptyTargetTwo: LineCounts = {
      source: 4,
      target1: 4,
      target2: 0,
      total: 4,
    };
    expect(() => validateDistribution(emptyTargetTwo)).toThrow(
      "Target-2 received no data"
    );
  });
});
