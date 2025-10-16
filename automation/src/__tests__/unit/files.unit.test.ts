/**
 * @fileoverview Unit tests for file system utility functions.
 * Tests directory management, file operations, line counting,
 * and artifact collection without requiring actual pipeline execution.
 * 
 * @module __tests__/unit/files
 */

import fs from "fs";
import os from "os";
import path from "path";
import {
  assertFilesAvailable,
  collectArtifacts,
  countLines,
  createEmptyFiles,
  ensureDirExists,
  getFileStats,
  md5,
  recreateDir,
  readLinesFromFile,
} from "../../utils/files";

const { mkdtemp, rm, readdir, writeFile, readFile, access } = fs.promises;

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
 * Test suite for file utility helper functions.
 * Uses temporary directories to avoid affecting the actual file system.
 */
describe("file utility helpers", () => {
  let tempDir: string;

  /** Setup: Create temporary directory for each test */
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "files-test-"));
  });

  /** Teardown: Capture diagnostics and clean up temporary directory */
  afterEach(async () => {
    const snapshot = {
      tempDir,
      files: [] as string[],
    };

    // Capture directory contents for debugging
    if (await pathExists(tempDir)) {
      try {
        const entries = await readdir(tempDir);
        snapshot.files = entries.sort();
      } catch {
        snapshot.files = [];
      }
    }

    console.debug("Temp directory cleanup", snapshot);

    await rm(tempDir, { recursive: true, force: true });
  });

  /**
   * Test: Validates directory creation with nested paths (mkdir -p behavior).
   */
  it("should create a directory when ensureDirExists is called on a missing path", async () => {
    const nested = path.join(tempDir, "nested");
    await ensureDirExists(nested);
    expect(await pathExists(nested)).toBe(true);
  });

  /**
   * Test: Validates file path resolution when all expected files exist.
   */
  it("should return resolved file paths when all files are present", async () => {
    const filenames = ["alpha.log", "beta.log"];
    await Promise.all(
      filenames.map((name, idx) => writeFile(path.join(tempDir, name), `file-${idx}`))
    );

    const resolved = await assertFilesAvailable(tempDir, filenames);

    console.debug("Resolved files", resolved);
    for (const name of filenames) {
      expect(resolved[name]).toBe(path.join(tempDir, name));
    }
  });

  it("should throw when required files are missing", async () => {
    const filenames = ["exists.log", "missing.log"];
  await writeFile(path.join(tempDir, "exists.log"), "content");

    await expect(assertFilesAvailable(tempDir, filenames)).rejects.toThrow(
      "Missing expected output files in"
    );
  });

  it("should recreate a directory, removing previous contents", async () => {
    const nested = path.join(tempDir, "nested");
    await ensureDirExists(nested);
    const staleFile = path.join(nested, "stale.log");
    await writeFile(staleFile, "stale");

    await recreateDir(nested);

    expect(await pathExists(nested)).toBe(true);
    expect((await readdir(nested)).length).toBe(0);
  });

  it("should create empty files and return their resolved paths", async () => {
  const filenames = ["empty1.log", "empty2.log"];

  const resolved = await createEmptyFiles(tempDir, filenames);

    expect(Object.keys(resolved)).toEqual(filenames);
    for (const name of filenames) {
      const filepath = resolved[name];
      expect(await pathExists(filepath)).toBe(true);
      expect(await readFile(filepath, "utf-8")).toBe("");
    }
  });

  it("should read lines from a file without dropping the trailing newline", async () => {
    const file = path.join(tempDir, "lines.log");
  await writeFile(file, "line-1\r\nline-2\n");
    const lines = await readLinesFromFile(file);
    console.debug("Read lines", lines);
    expect(lines).toEqual(["line-1", "line-2"]);
  });

  it("should throw when attempting to read a missing file", async () => {
    const missingPath = path.join(tempDir, "missing.log");
    await expect(readLinesFromFile(missingPath)).rejects.toThrow(
      `File not found: ${missingPath}`
    );
  });

  it("should compute an md5 hash for a buffer", () => {
    const buffer = Buffer.from("hash-me");
    const hash = md5(buffer);
    console.debug("Buffer length", buffer.length);
    expect(hash).toBe("0b893466231ec15a31520cfb1f761f4f");
  });

  it("should count newline-terminated lines in a buffer", () => {
    const buffer = Buffer.from("a\n\n");
    const count = countLines(buffer);
    console.debug("Buffer sample", buffer.toString());
    expect(count).toBe(2);
  });

  it("should return zero lines when the buffer is empty", () => {
    const buffer = Buffer.alloc(0);
    const count = countLines(buffer);
    console.debug("Empty buffer length", buffer.length);
    expect(count).toBe(0);
  });

  it("should return file stats with byte and line counts", async () => {
    const file = path.join(tempDir, "stats.log");
  await writeFile(file, "first\nsecond");
    const stats = await getFileStats(file);
    console.debug("File stats", stats);
    expect(stats.bytes).toBe(Buffer.byteLength("first\nsecond"));
    expect(stats.lines).toBe(2);
  });

  it("should combine target files into a single artifact", async () => {
    const targetNames = ["target1.log", "target2.log"];
    const targetPaths = await createEmptyFiles(tempDir, targetNames);

    await writeFile(targetPaths[targetNames[0]], "alpha\n");
    await writeFile(targetPaths[targetNames[1]], "beta\n");

    const combinedPath = await collectArtifacts(tempDir, targetNames, {
      outputFilename: "combined.log",
    });

    expect(path.basename(combinedPath)).toBe("combined.log");
    expect(await readFile(combinedPath, "utf-8")).toBe("alpha\nbeta\n");
  });
});
