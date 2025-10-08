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

describe("file utility helpers", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "files-test-"));
  });

  afterEach(() => {
    const snapshot = {
      tempDir,
      files: [] as string[],
    };

    if (fs.existsSync(tempDir)) {
      snapshot.files = fs.readdirSync(tempDir).sort();
    }

    console.debug("Temp directory cleanup", snapshot);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should create a directory when ensureDirExists is called on a missing path", () => {
    const nested = path.join(tempDir, "nested");
    ensureDirExists(nested);
    expect(fs.existsSync(nested)).toBe(true);
  });

  it("should return resolved file paths when all files are present", () => {
    const filenames = ["alpha.log", "beta.log"];
    filenames.forEach((name, idx) => {
      fs.writeFileSync(path.join(tempDir, name), `file-${idx}`);
    });

    const resolved = assertFilesAvailable(tempDir, filenames);

    console.debug("Resolved files", resolved);
    filenames.forEach((name) => {
      expect(resolved[name]).toBe(path.join(tempDir, name));
    });
  });

  it("should throw when required files are missing", () => {
    const filenames = ["exists.log", "missing.log"];
    fs.writeFileSync(path.join(tempDir, "exists.log"), "content");

    expect(() => assertFilesAvailable(tempDir, filenames)).toThrow(
      "Missing expected output files in"
    );
  });

  it("should recreate a directory, removing previous contents", () => {
    const nested = path.join(tempDir, "nested");
    ensureDirExists(nested);
    const staleFile = path.join(nested, "stale.log");
    fs.writeFileSync(staleFile, "stale");

    recreateDir(nested);

    expect(fs.existsSync(nested)).toBe(true);
    expect(fs.readdirSync(nested)).toHaveLength(0);
  });

  it("should create empty files and return their resolved paths", () => {
    const filenames = ["empty1.log", "empty2.log"];

    const resolved = createEmptyFiles(tempDir, filenames);

    expect(Object.keys(resolved)).toEqual(filenames);
    filenames.forEach((name) => {
      const filepath = resolved[name];
      expect(fs.existsSync(filepath)).toBe(true);
      expect(fs.readFileSync(filepath, "utf-8")).toBe("");
    });
  });

  it("should read lines from a file without dropping the trailing newline", () => {
    const file = path.join(tempDir, "lines.log");
    fs.writeFileSync(file, "line-1\r\nline-2\n");
    const lines = readLinesFromFile(file);
    console.debug("Read lines", lines);
    expect(lines).toEqual(["line-1", "line-2"]);
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

  it("should return file stats with byte and line counts", () => {
    const file = path.join(tempDir, "stats.log");
    fs.writeFileSync(file, "first\nsecond");
    const stats = getFileStats(file);
    console.debug("File stats", stats);
    expect(stats.bytes).toBe(Buffer.byteLength("first\nsecond"));
    expect(stats.lines).toBe(2);
  });

  it("should combine target files into a single artifact", () => {
    const targetNames = ["target1.log", "target2.log"];
    const targetPaths = createEmptyFiles(tempDir, targetNames);

    fs.writeFileSync(targetPaths[targetNames[0]], "alpha\n");
    fs.writeFileSync(targetPaths[targetNames[1]], "beta\n");

    const combinedPath = collectArtifacts(tempDir, targetNames, {
      outputFilename: "combined.log",
    });

    expect(path.basename(combinedPath)).toBe("combined.log");
    expect(fs.readFileSync(combinedPath, "utf-8")).toBe("alpha\nbeta\n");
  });
});
