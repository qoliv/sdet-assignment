import fs from 'fs';
import { countLines, readLinesFromFile } from './utils/files';
import { buildFrequency, subtractFrequency } from './utils/frequency';

export interface LineCounts {
  source: number;
  target1: number;
  target2: number;
  total: number;
}

export interface ValidationPaths {
  sourceFile: string;
  target1File: string;
  target2File: string;
}

export interface ValidationOptions {
  logger?: Pick<typeof console, 'log' | 'warn'>;
}

const { readFile } = fs.promises;

export async function validateDataIntegrity(
  paths: ValidationPaths,
  options: ValidationOptions = {}
): Promise<LineCounts> {
  const logger = options.logger ?? console;

  logger.log('Data Integrity Validation (Byte-Level)');

  const [sourceBuf, target1Buf, target2Buf] = await Promise.all([
    readFile(paths.sourceFile),
    readFile(paths.target1File),
    readFile(paths.target2File),
  ]);

  logger.log(`Source bytes: ${sourceBuf.length}`);
  logger.log(`Target-1 bytes: ${target1Buf.length}`);
  logger.log(`Target-2 bytes: ${target2Buf.length}`);

  logger.log('Performing byte multiset reconciliation.');

  const [sourceLines, target1Lines, target2Lines] = await Promise.all([
    readLinesFromFile(paths.sourceFile),
    readLinesFromFile(paths.target1File),
    readLinesFromFile(paths.target2File),
  ]);

  const sourceLineCount = sourceLines.length;
  const newlineCountTargets = target1Lines.length + target2Lines.length;
  if (sourceLineCount !== newlineCountTargets) {
    throw new Error(
      `Line count mismatch (source=${sourceLineCount} vs targets=${newlineCountTargets}).`
    );
  }

  const combinedTargetLines = [...target1Lines, ...target2Lines];
  const orderMatches = combinedTargetLines.every((line, index) => line === sourceLines[index]);

  const sourceFreq = buildFrequency(sourceBuf.toString('utf8'));
  const ok1 = subtractFrequency(sourceFreq, target1Buf.toString('utf8'));
  const ok2 = ok1 && subtractFrequency(sourceFreq, target2Buf.toString('utf8'));
  if (!ok2 || sourceFreq.size !== 0) {
    throw new Error('Byte frequency reconciliation failed: possible data loss or duplication.');
  }

  if (!orderMatches) {
    logger.warn('Line ordering mismatch between source and targets; reconciliation succeeded but ordering changed.');
  }
  logger.log('Integrity check passed (byte multiset & newline counts match).');

  const pseudoLines1 = countLines(target1Buf);
  const pseudoLines2 = countLines(target2Buf);
  const pseudoLinesSrc = countLines(sourceBuf);

  return {
    source: pseudoLinesSrc,
    target1: pseudoLines1,
    target2: pseudoLines2,
    total: pseudoLines1 + pseudoLines2,
  };
}

export interface DistributionOptions {
  logger?: Pick<typeof console, 'log'>;
}

export function validateDistribution(lineCounts: LineCounts, options: DistributionOptions = {}): void {
  const logger = options.logger ?? console;

  logger.log('Distribution Validation');

  if (lineCounts.total === 0) {
    throw new Error('No data was processed by any target');
  }

  if (lineCounts.total > 1 && lineCounts.target1 === 0) {
    throw new Error('Target-1 received no data');
  }

  if (lineCounts.total > 1 && lineCounts.target2 === 0) {
    throw new Error('Target-2 received no data');
  }

  const ratio = (lineCounts.target1 / lineCounts.total) * 100;
  logger.log(`Target-1: ${lineCounts.target1} lines (${ratio.toFixed(2)}%)`);
  logger.log(`Target-2: ${lineCounts.target2} lines (${(100 - ratio).toFixed(2)}%)`);
  if (lineCounts.total > 1) {
    logger.log('Distribution validated: Both targets received data');
  } else {
    logger.log('Distribution validated: Single target handled the payload');
  }
}

