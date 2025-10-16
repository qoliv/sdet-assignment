/**
 * @fileoverview File system utilities for managing test artifacts, reading files,
 * and collecting output from Docker containers. Provides helpers for directory
 * management, file reading, line counting, and artifact collection.
 * 
 * @module utils/files
 */

/**
 * @fileoverview File system utilities for managing test artifacts, reading files,
 * and collecting test results. Provides functions for directory management, file
 * operations, line counting, and artifact collection.
 * 
 * @module utils/files
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const { access, readFile, writeFile, stat, mkdir, rm } = fs.promises;

/** Root directory of the project */
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
/** Default directory for storing test artifacts and output files */
const DEFAULT_ARTIFACTS_DIR = path.join(PROJECT_ROOT, 'artifacts');

/**
 * File statistics including size and line count.
 */
export interface FileStats {
  /** File size in bytes */
  bytes: number;
  /** Number of lines in the file */
  lines: number;
}

/**
 * Ensures a directory exists, creating it and any parent directories if needed.
 * Equivalent to `mkdir -p` in Unix.
 * 
 * @param dirPath - Absolute path to the directory to create
 */
export async function ensureDirExists(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

/**
 * Removes a directory and all its contents, then recreates it as an empty directory.
 * Useful for cleaning up test artifacts between runs.
 * 
 * @param dirPath - Absolute path to the directory to recreate
 */
export async function recreateDir(dirPath: string): Promise<void> {
  await rm(dirPath, { recursive: true, force: true });
  await mkdir(dirPath, { recursive: true });
}

/**
 * Creates multiple empty files in the specified directory.
 * Ensures the directory exists before creating files.
 * 
 * @param dirPath - Directory where files should be created
 * @param filenames - Array of filenames to create
 * @returns Object mapping filenames to their absolute paths
 * 
 * @example
 * ```typescript
 * const paths = await createEmptyFiles('/tmp/artifacts', ['output1.log', 'output2.log']);
 * // Returns { 'output1.log': '/tmp/artifacts/output1.log', 'output2.log': '/tmp/artifacts/output2.log' }
 * ```
 */
export async function createEmptyFiles(
  dirPath: string,
  filenames: string[]
): Promise<Record<string, string>> {
  await ensureDirExists(dirPath);
  const entries = await Promise.all(
    filenames.map(async (filename) => {
      const filepath = path.join(dirPath, filename);
      await writeFile(filepath, '');
      return [filename, filepath] as const;
    })
  );
  return Object.fromEntries(entries);
}

/**
 * Verifies that expected files exist in a directory and returns their paths.
 * Throws an error if any files are missing.
 * 
 * @param dirPath - Directory to check for files
 * @param filenames - Array of filenames that must exist
 * @returns Object mapping filenames to their absolute paths
 * @throws Error if any expected files are missing
 * 
 * @remarks
 * This function is typically used to verify that Docker containers have successfully
 * written their output files to mounted volumes before attempting to read them.
 */
export async function assertFilesAvailable(
  dirPath: string,
  filenames: string[]
): Promise<Record<string, string>> {
  const resolvedFiles = filenames.map((filename) => ({
    filename,
    filepath: path.join(dirPath, filename),
  }));

  // Check which files exist in parallel
  const missingChecks = await Promise.all(
    resolvedFiles.map(async ({ filename, filepath }) => {
      try {
        await access(filepath, fs.constants.F_OK);
        return null; // File exists
      } catch {
        return filename; // File is missing
      }
    })
  );

  const missing = missingChecks.filter((value): value is string => value !== null);

  if (missing.length > 0) {
    const missingList = missing.join(', ');
    throw new Error(
      `Missing expected output files in '${dirPath}': ${missingList}. ` +
        'Verify Docker volumes map the target outputs into the artifacts directory.'
    );
  }

  return resolvedFiles.reduce<Record<string, string>>((acc, { filename, filepath }) => {
    acc[filename] = filepath;
    return acc;
  }, {});
}

/**
 * Reads a file and splits it into an array of lines.
 * Handles both Unix (\n) and Windows (\r\n) line endings.
 * 
 * @param filepath - Path to the file to read
 * @returns Array of lines from the file (preserves empty lines except trailing)
 * @throws Error if the file does not exist
 * 
 * @remarks
 * Empty lines within the file are preserved, but a trailing empty line
 * (after the final newline) is removed from the result.
 */
export async function readLinesFromFile(filepath: string): Promise<string[]> {
  try {
    await access(filepath, fs.constants.F_OK);
  } catch {
    throw new Error(`File not found: ${filepath}`);
  }

  const content = await readFile(filepath, 'utf-8');
  return content
    .split(/\r?\n/)
    .filter((line: string, idx: number, arr: string[]) => line.length > 0 || idx < arr.length - 1);
}

/**
 * Calculates the MD5 hash of a buffer.
 * 
 * @param buf - Buffer to hash
 * @returns Hexadecimal string representation of the MD5 hash
 */
export function md5(buf: Buffer): string {
  return crypto.createHash('md5').update(buf).digest('hex');
}

/**
 * Counts the number of lines in a buffer by counting newline characters.
 * 
 * @param buffer - Buffer to count lines in
 * @returns Number of lines (newline-delimited segments minus one)
 * 
 * @remarks
 * Returns 0 for an empty buffer. For non-empty buffers, counts the number
 * of newline characters which represents the number of complete lines.
 */
export function countLines(buffer: Buffer): number {
  if (buffer.length === 0) {
    return 0;
  }

  const segments = buffer.toString('utf8').split(/\n/);
  const count = segments.length - 1;
  return count < 0 ? 0 : count;
}

/**
 * Retrieves file statistics including size and line count.
 * 
 * @param filepath - Path to the file to analyze
 * @returns Object containing byte size and line count
 */
export async function getFileStats(filepath: string): Promise<FileStats> {
  const stats = await stat(filepath);
  const lines = await readLinesFromFile(filepath);
  return {
    bytes: stats.size,
    lines: lines.length,
  };
}

/**
 * Configuration options for artifact collection.
 */
export interface CollectArtifactsOptions {
  /** Name for the combined output file (default: 'combined_events.log') */
  outputFilename?: string;
}

/**
 * Combines multiple target files into a single output file.
 * Verifies all target files exist before combining them.
 * 
 * @param artifactsDir - Directory containing the target files
 * @param targetFilenames - Array of filenames to combine
 * @param options - Optional configuration for output filename
 * @returns Path to the combined output file
 * @throws Error if any target files are missing
 * 
 * @remarks
 * The files are concatenated in the order specified by targetFilenames.
 * This is typically used to combine output from multiple processing targets
 * for validation purposes.
 */
export async function collectArtifacts(
  artifactsDir: string,
  targetFilenames: string[],
  options: CollectArtifactsOptions = {}
): Promise<string> {
  const { outputFilename = 'combined_events.log' } = options;
  await ensureDirExists(artifactsDir);
  const resolvedTargets = await assertFilesAvailable(artifactsDir, targetFilenames);
  const combinedPath = path.join(artifactsDir, outputFilename);
  // Read all target files in parallel
  const combinedContent = await Promise.all(
    targetFilenames.map((filename) => readFile(resolvedTargets[filename], 'utf-8'))
  );
  // Concatenate and write the combined content
  await writeFile(combinedPath, combinedContent.join(''));
  return combinedPath;
}

/**
 * Returns the default artifacts directory path.
 * 
 * @returns Absolute path to the default artifacts directory
 */
export function getArtifactsDir(): string {
  return DEFAULT_ARTIFACTS_DIR;
}

/**
 * Ensures the artifacts directory exists, creating it if necessary.
 * 
 * @param dirPath - Path to the artifacts directory (defaults to project artifacts dir)
 * @returns The artifacts directory path
 */
export async function ensureArtifactsDir(dirPath: string = DEFAULT_ARTIFACTS_DIR): Promise<string> {
  await ensureDirExists(dirPath);
  return dirPath;
}
