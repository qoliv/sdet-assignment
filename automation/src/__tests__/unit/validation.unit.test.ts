/**
 * @fileoverview Unit tests for data validation utilities.
 * Tests byte-level integrity validation and distribution validation
 * to ensure proper data transfer without loss or duplication.
 * 
 * @module __tests__/unit/validation
 */

import fs from "fs";
import os from "os";
import path from "path";
import {
  validateDataIntegrity,
  validateDistribution,
  type LineCounts,
} from "../../validation";
import * as fileUtils from "../../utils/files";

const { mkdtemp, writeFile, readFile: readFileAsync, rm, access } = fs.promises;

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
 * Test suite for validation workflow functions.
 * Tests data integrity checks and distribution validation.
 */
describe("validation workflow", () => {
  let tempDir: string;
  let sourceFile: string;
  let target1File: string;
  let target2File: string;

  /** Setup: Create temporary directory for test files */
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "validation-test-"));
    sourceFile = path.join(tempDir, "source.log");
    target1File = path.join(tempDir, "target-1.log");
    target2File = path.join(tempDir, "target-2.log");
    console.debug("Temp directory", tempDir);
  });

  /** Teardown: Capture diagnostics and clean up temporary files */
  afterEach(async () => {
    const exists = await pathExists(tempDir);
    const snapshot = {
      sourceFile,
      target1File,
      target2File,
      exists,
    };

    // Capture file contents for debugging if they exist
    if (exists) {
      const readFileIfPresent = async (filePath: string) =>
        (await pathExists(filePath)) ? await readFileAsync(filePath, "utf-8") : null;
      Object.assign(snapshot, {
        sourceContents: await readFileIfPresent(sourceFile),
        target1Contents: await readFileIfPresent(target1File),
        target2Contents: await readFileIfPresent(target2File),
      });
    }

    try {
      console.debug("Validation temp files", snapshot);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
      jest.restoreAllMocks();
      jest.useRealTimers();
    }
  });

  /**
   * Helper: Writes source and target files for pipeline simulation.
   */
  function writePipelineFiles(
    source: string,
    target1: string,
    target2: string
  ): Promise<void> {
    return Promise.all([
      writeFile(sourceFile, source),
      writeFile(target1File, target1),
      writeFile(target2File, target2),
    ]).then(() => undefined);
  }

  /**
   * Test: Validates that correct line counts are returned when data matches exactly.
   */
  it("should return line counts when data matches exactly", async () => {
    await writePipelineFiles("line-1\nline-2\n", "line-1\n", "line-2\n");

    const counts = await validateDataIntegrity({
      sourceFile,
      target1File,
      target2File,
    });

    console.debug("Baseline line counts", counts);

    expect(counts).toEqual({ source: 2, target1: 1, target2: 1, total: 2 });
  });

  /**
   * Test: Validates that byte-level reconciliation succeeds even when line order changes.
   * Should log a warning about ordering but still pass validation.
   */
  it("should perform reconciliation when lines are shuffled", async () => {
    await writePipelineFiles("line-1\nline-2\n", "line-2\n", "line-1\n");

    const warnSpy = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const counts = await validateDataIntegrity({
      sourceFile,
      target1File,
      target2File,
    });

    console.debug("Reconciliation counts", counts);
    console.debug("Warn calls", warnSpy.mock.calls);

    expect(warnSpy).toHaveBeenCalled();
    expect(counts.total).toBe(2);
  });

  /**
   * Test: Validates that data loss is detected via byte frequency reconciliation.
   */
  it("should throw when reconciliation detects data loss", async () => {
    await writePipelineFiles("line-1\nline-2\n", "line-1\n", "line-x\n");

    await expect(
      validateDataIntegrity({
        sourceFile,
        target1File,
        target2File,
      })
    ).rejects.toThrow("Byte frequency reconciliation failed");
  });

  /**
   * Test: Validates that mismatched line counts are detected and reported.
   */
  it("should throw when line counts differ", async () => {
    await writePipelineFiles("line-1\nline-2\n", "line-1\n", "line-2\nline-3\n");

    await expect(
      validateDataIntegrity({
        sourceFile,
        target1File,
        target2File,
      })
    ).rejects.toThrow("Line count mismatch");
  });

  /**
   * Test: Validates distribution check succeeds when both targets have data.
   */
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
