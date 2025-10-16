import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const { access, readFile, writeFile, stat, mkdir, rm } = fs.promises;

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_ARTIFACTS_DIR = path.join(PROJECT_ROOT, 'artifacts');

export interface FileStats {
  bytes: number;
  lines: number;
}

export async function ensureDirExists(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

export async function recreateDir(dirPath: string): Promise<void> {
  await rm(dirPath, { recursive: true, force: true });
  await mkdir(dirPath, { recursive: true });
}

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

export async function assertFilesAvailable(
  dirPath: string,
  filenames: string[]
): Promise<Record<string, string>> {
  const resolvedFiles = filenames.map((filename) => ({
    filename,
    filepath: path.join(dirPath, filename),
  }));

  const missingChecks = await Promise.all(
    resolvedFiles.map(async ({ filename, filepath }) => {
      try {
        await access(filepath, fs.constants.F_OK);
        return null;
      } catch {
        return filename;
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

export function md5(buf: Buffer): string {
  return crypto.createHash('md5').update(buf).digest('hex');
}

export function countLines(buffer: Buffer): number {
  if (buffer.length === 0) {
    return 0;
  }

  const segments = buffer.toString('utf8').split(/\n/);
  const count = segments.length - 1;
  return count < 0 ? 0 : count;
}

export async function getFileStats(filepath: string): Promise<FileStats> {
  const stats = await stat(filepath);
  const lines = await readLinesFromFile(filepath);
  return {
    bytes: stats.size,
    lines: lines.length,
  };
}

export interface CollectArtifactsOptions {
  outputFilename?: string;
}

export async function collectArtifacts(
  artifactsDir: string,
  targetFilenames: string[],
  options: CollectArtifactsOptions = {}
): Promise<string> {
  const { outputFilename = 'combined_events.log' } = options;
  await ensureDirExists(artifactsDir);
  const resolvedTargets = await assertFilesAvailable(artifactsDir, targetFilenames);
  const combinedPath = path.join(artifactsDir, outputFilename);
  const combinedContent = await Promise.all(
    targetFilenames.map((filename) => readFile(resolvedTargets[filename], 'utf-8'))
  );
  await writeFile(combinedPath, combinedContent.join(''));
  return combinedPath;
}

export function getArtifactsDir(): string {
  return DEFAULT_ARTIFACTS_DIR;
}

export async function ensureArtifactsDir(dirPath: string = DEFAULT_ARTIFACTS_DIR): Promise<string> {
  await ensureDirExists(dirPath);
  return dirPath;
}
