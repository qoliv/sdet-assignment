import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface FileStats {
  bytes: number;
  lines: number;
}

export function ensureDirExists(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function recreateDir(dirPath: string): void {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
  fs.mkdirSync(dirPath, { recursive: true });
}

export function createEmptyFiles(
  dirPath: string,
  filenames: string[]
): Record<string, string> {
  ensureDirExists(dirPath);
  return filenames.reduce<Record<string, string>>((acc, filename) => {
    const filepath = path.join(dirPath, filename);
    fs.writeFileSync(filepath, '');
    acc[filename] = filepath;
    return acc;
  }, {});
}

export function assertFilesAvailable(
  dirPath: string,
  filenames: string[]
): Record<string, string> {
  const resolvedFiles = filenames.map((filename) => ({
    filename,
    filepath: path.join(dirPath, filename),
  }));

  const missing = resolvedFiles.filter(({ filepath }) => !fs.existsSync(filepath));

  if (missing.length > 0) {
    const missingList = missing.map(({ filename }) => filename).join(', ');
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

export function readLinesFromFile(filepath: string): string[] {
  if (!fs.existsSync(filepath)) {
    throw new Error(`File not found: ${filepath}`);
  }

  const content = fs.readFileSync(filepath, 'utf-8');
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

export function getFileStats(filepath: string): FileStats {
  const stats = fs.statSync(filepath);
  return {
    bytes: stats.size,
    lines: readLinesFromFile(filepath).length,
  };
}

export interface CollectArtifactsOptions {
  outputFilename?: string;
}

export function collectArtifacts(
  artifactsDir: string,
  targetFilenames: string[],
  options: CollectArtifactsOptions = {}
): string {
  const { outputFilename = 'combined_events.log' } = options;
  ensureDirExists(artifactsDir);
  const resolvedTargets = assertFilesAvailable(artifactsDir, targetFilenames);
  const combinedPath = path.join(artifactsDir, outputFilename);
  const combinedContent = targetFilenames
    .map((filename) => fs.readFileSync(resolvedTargets[filename], 'utf-8'))
    .join('');
  fs.writeFileSync(combinedPath, combinedContent);
  return combinedPath;
}
