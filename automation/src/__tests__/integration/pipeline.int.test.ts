/**
 * @fileoverview End-to-end integration tests for the Cribl data pipeline.
 * Tests data transfer from Agent through Splitter to Target containers,
 * validating data integrity, distribution, and completeness across various
 * input sizes from empty to 1M events.
 * 
 * @module __tests__/integration/pipeline
 */

import fs from "fs";
import path from "path";
import {
  cleanEnvironment,
  buildImagesIfNeeded,
  startDeployment,
  waitForHealth,
  cleanContainers,
} from "../../utils/docker";
import { waitForCompletion } from "../../utils/waitForCompletion";
import {
  assertFilesAvailable,
  collectArtifacts,
  ensureDirExists,
  readLinesFromFile,
} from "../../utils/files";
import {
  validateDataIntegrity,
  validateDistribution,
} from "../../validation";

/** Root directory of the automation project */
const PROJECT_ROOT = path.resolve(__dirname, "../../..");
/** Root directory of the entire workspace (parent of automation) */
const WORKSPACE_ROOT = path.resolve(PROJECT_ROOT, "..");

/** Directory for test artifacts and outputs */
const ARTIFACTS_DIR = path.join(PROJECT_ROOT, "artifacts");
/** Directory for storing test run results organized by input variant */
const ARTIFACTS_RUNS_DIR = path.join(ARTIFACTS_DIR, "runs");
/** Expected output filenames from target containers */
const TARGET_FILENAMES = [
  "target_1_events.log",
  "target_2_events.log",
] as const;
/** Directory containing agent input fixture files */
const AGENT_INPUTS_DIR = path.join(WORKSPACE_ROOT, "application/agent/inputs");
/** Path to the agent configuration file that specifies which input to monitor */
const AGENT_CONFIG_PATH = path.join(WORKSPACE_ROOT, "application/agent/inputs.json");
/** Backup path for preserving original agent configuration */
const AGENT_CONFIG_BACKUP_PATH = `${AGENT_CONFIG_PATH}.backup`;

const { access, readFile, writeFile, copyFile, rm } = fs.promises;

/**
 * Checks if a file or directory exists at the specified path.
 * 
 * @param filepath - Path to check for existence
 * @returns `true` if path exists, `false` otherwise
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
 * Defines a test input variant with associated metadata.
 */
interface InputVariant {
  /** Human-readable label for test output */
  label: string;
  /** Short identifier for artifact directory naming */
  slug: string;
  /** Name of the fixture file in agent/inputs directory */
  filename: string;
  /** Whether this variant is allowed to have empty output */
  allowEmpty?: boolean;
}

/**
 * Test input variants covering various data volumes from empty to 1M events.
 * Each variant tests the pipeline with different input sizes to validate
 * scalability and correctness across different workloads.
 */
const INPUT_VARIANTS: InputVariant[] = [
  {
    label: "empty events",
    slug: "empty",
    filename: "empty_events.log",
    allowEmpty: true,
  },
  {
    label: "1 event",
    slug: "1",
    filename: "small_1_event.log",
  },
  {
    label: "100 events",
    slug: "100",
    filename: "large_100_events.log",
  },
  {
    label: "1000 events",
    slug: "1000",
    filename: "large_1000_events.log",
  },
  {
    label: "10000 events",
    slug: "10000",
    filename: "large_10000_events.log",
  },
  {
    label: "1M events",
    slug: "1M",
    filename: "large_1M_events.log",
  },
];

/**
 * Verifies that a fixture file exists in the agent inputs directory.
 * 
 * @param filename - Name of the fixture file to check
 * @throws Error if fixture file is not found
 */
async function ensureFixtureExists(filename: string): Promise<void> {
  const filepath = path.join(AGENT_INPUTS_DIR, filename);
  if (!(await pathExists(filepath))) {
    throw new Error(`Fixture file not found: ${filepath}`);
  }
}

/**
 * Updates the agent configuration to monitor a specific input file.
 * Modifies the agent's inputs.json to point to the desired log file.
 * 
 * @param monitorRelativePath - Relative path to the file to monitor (e.g., "inputs/small_1_event.log")
 * @throws Error if agent configuration file is not found
 */
async function updateAgentConfig(monitorRelativePath: string): Promise<void> {
  if (!(await pathExists(AGENT_CONFIG_PATH))) {
    throw new Error(`Agent inputs configuration not found: ${AGENT_CONFIG_PATH}`);
  }

  const rawConfig = await readFile(AGENT_CONFIG_PATH, "utf-8");
  const config = JSON.parse(rawConfig) as Record<string, unknown>;
  config.monitor = monitorRelativePath;
  await writeFile(AGENT_CONFIG_PATH, `${JSON.stringify(config, null, 4)}\n`);
}

/**
 * Stages an agent input file for the current test by verifying it exists
 * and updating the agent configuration to monitor it.
 * 
 * @param filename - Name of the fixture file to stage
 * @throws Error if fixture file is not found or configuration fails
 */
async function stageAgentInput(filename: string): Promise<void> {
  await ensureFixtureExists(filename);
  const monitorPath = path.posix.join("inputs", filename);
  await updateAgentConfig(monitorPath);
}

// Set timeout to 10 minutes to accommodate large file processing (especially 1M events)
jest.setTimeout(600_000);

/**
 * Global test setup: Backs up agent configuration and prepares artifacts directory.
 * This runs once before all test suites.
 */
beforeAll(async () => {
  if (!(await pathExists(AGENT_CONFIG_PATH))) {
    throw new Error(`Agent inputs configuration not found: ${AGENT_CONFIG_PATH}`);
  }

  // Backup original agent configuration to restore after tests
  await copyFile(AGENT_CONFIG_PATH, AGENT_CONFIG_BACKUP_PATH);

  // Clean and recreate artifacts/runs directory for fresh test results
  if (await pathExists(ARTIFACTS_RUNS_DIR)) {
    await rm(ARTIFACTS_RUNS_DIR, { recursive: true, force: true });
  }

  await ensureDirExists(ARTIFACTS_RUNS_DIR);
});

/**
 * Global test teardown: Restores original agent configuration.
 * This runs once after all test suites complete.
 */
afterAll(async () => {
  if (await pathExists(AGENT_CONFIG_BACKUP_PATH)) {
    await copyFile(AGENT_CONFIG_BACKUP_PATH, AGENT_CONFIG_PATH);
    await rm(AGENT_CONFIG_BACKUP_PATH);
  }
});

/**
 * Parameterized test suite that runs the same tests for each input variant.
 * Tests the complete data pipeline from agent input through splitter to targets,
 * validating data integrity, distribution, and correctness.
 */
describe.each(INPUT_VARIANTS)("data pipeline integration ($label)", ({ label, slug, filename, allowEmpty }) => {
  // Test state shared across test cases within this variant
  let resolvedTargets!: Record<(typeof TARGET_FILENAMES)[number], string>;
  let target1Lines!: string[];
  let target2Lines!: string[];
  let sourceFile!: string;

  /**
   * Test suite setup: Deploys the pipeline and waits for data transfer completion.
   * This runs once before all tests in this input variant.
   */
  beforeAll(async () => {
    // Clean environment but preserve previous run results
    await cleanEnvironment(ARTIFACTS_DIR, [...TARGET_FILENAMES], console, {}, { preserve: ["runs"] });
    
    // Configure agent to monitor the current input variant
    await stageAgentInput(filename);
    sourceFile = path.join(AGENT_INPUTS_DIR, filename);
    
    // Build Docker images if not already built
    buildImagesIfNeeded();
    
    // Start all containers in detached mode
    startDeployment();
    
    // Wait for all services to report healthy
    await waitForHealth();
    
    // Wait for data transfer to complete (files stable and meeting minimum size)
    await waitForCompletion([
      { container: "target_1", filepath: "events.log", minimumBytes: 0 },
      { container: "target_2", filepath: "events.log", minimumBytes: 0 },
    ]);

    // Verify output files exist and resolve their paths
    resolvedTargets = await assertFilesAvailable(ARTIFACTS_DIR, [...TARGET_FILENAMES]);

    // Read target file contents for validation
    target1Lines = await readLinesFromFile(resolvedTargets[TARGET_FILENAMES[0]]);
    target2Lines = await readLinesFromFile(resolvedTargets[TARGET_FILENAMES[1]]);
  });

  /**
   * Test suite teardown: Collects artifacts and archives test results.
   * Preserves all output files and metadata for later analysis.
   */
  afterAll(async () => {
    // Combine target outputs into a single file for easier comparison
    const combinedPath = await collectArtifacts(ARTIFACTS_DIR, [...TARGET_FILENAMES], {
      outputFilename: `combined_events_${slug}.log`,
    });

    // Create a directory for this run's artifacts
    const runDir = path.join(ARTIFACTS_RUNS_DIR, slug);
    await ensureDirExists(runDir);

    // Copy individual target files to run directory
    for (const targetFilename of TARGET_FILENAMES) {
      const sourcePath = resolvedTargets[targetFilename];
      const destPath = path.join(runDir, targetFilename);
      await copyFile(sourcePath, destPath);
    }

    // Copy combined file to run directory
    const combinedDest = path.join(runDir, path.basename(combinedPath));
    await copyFile(combinedPath, combinedDest);

    // Write metadata about this test run for future reference
    const metadata = {
      label,
      slug,
      sourceFixture: filename,
      target1Lines: target1Lines.length,
      target2Lines: target2Lines.length,
      totalLines: target1Lines.length + target2Lines.length,
      generatedAt: new Date().toISOString(),
    };
    await writeFile(
      path.join(runDir, "metadata.json"),
      `${JSON.stringify(metadata, null, 2)}\n`
    );

    // Stop and remove all containers
    cleanContainers();
  });

  /**
   * Test: Validates that line counts match between source and combined targets.
   * Ensures no data is lost or duplicated during transfer.
   */
  it("should match line counts between source and targets", async () => {
    // Perform byte-level integrity validation
    const lineCounts = await validateDataIntegrity({
      sourceFile,
      target1File: resolvedTargets[TARGET_FILENAMES[0]],
      target2File: resolvedTargets[TARGET_FILENAMES[1]],
    });

    // Handle empty file case differently
    if (allowEmpty) {
      expect(lineCounts.source).toBe(0);
      expect(lineCounts.target1).toBe(0);
      expect(lineCounts.target2).toBe(0);
      expect(target1Lines).toHaveLength(0);
      expect(target2Lines).toHaveLength(0);
    } else {
      // For non-empty files, validate distribution across targets
      validateDistribution(lineCounts);
      expect(lineCounts.source).toBeGreaterThan(0);
    }

    console.debug(`Line counts [${label}]`, lineCounts);

    // Core assertion: total target lines must equal source lines
    expect(lineCounts.source).toBe(lineCounts.target1 + lineCounts.target2);
  });

  /**
   * Test: Validates that all events are transferred without corruption or data loss.
   * Performs comprehensive checks including:
   * - No empty lines (which could indicate truncation)
   * - All source events appear in targets with correct frequency
   * - No extra events added during transfer
   * - JSON structure validation if events appear to be JSON
   */
  it("should transfer events without corruption or data loss", async () => {
    const issues: string[] = [];

    // Check 1: Verify all events are complete (no empty lines unless source is empty)
    // Empty lines could indicate truncation or incomplete writes
    if (!allowEmpty || target1Lines.length > 0 || target2Lines.length > 0) {
      TARGET_FILENAMES.forEach((filename, index) => {
        const lines = index === 0 ? target1Lines : target2Lines;
        lines.forEach((line, lineIndex) => {
          if (line.length === 0) {
            issues.push(`${filename}:${lineIndex + 1} - Empty line (potential truncation)`);
          }
        });
      });
    }

    // Check 2: Verify data integrity - all source events must appear in targets
    // Uses frequency maps to correctly handle duplicate events
    const sourceLines = await readLinesFromFile(sourceFile);
    const targetLines = [...target1Lines, ...target2Lines];
    
    // Build frequency maps for multiset comparison (handles duplicates correctly)
    const sourceFreq = new Map<string, number>();
    const targetFreq = new Map<string, number>();
    
    sourceLines.forEach(line => {
      sourceFreq.set(line, (sourceFreq.get(line) || 0) + 1);
    });
    
    targetLines.forEach(line => {
      targetFreq.set(line, (targetFreq.get(line) || 0) + 1);
    });

    // Check for missing events (source has more occurrences than targets)
    sourceFreq.forEach((count, line) => {
      const targetCount = targetFreq.get(line) || 0;
      if (targetCount < count) {
        const preview = line.length > 50 ? `${line.substring(0, 50)}...` : line;
        issues.push(`Event missing ${count - targetCount} occurrence(s) in targets: "${preview}"`);
      }
    });

    // Check for extra events (targets have more occurrences than source)
    targetFreq.forEach((count, line) => {
      const sourceCount = sourceFreq.get(line) || 0;
      if (count > sourceCount) {
        const preview = line.length > 50 ? `${line.substring(0, 50)}...` : line;
        issues.push(`Extra event with ${count - sourceCount} occurrence(s) not in source: "${preview}"`);
      }
    });

    // Check 3: If events claim to be structured data, validate parseability
    // Ensures JSON events aren't corrupted during transfer
    TARGET_FILENAMES.forEach((filename, index) => {
      const lines = index === 0 ? target1Lines : target2Lines;
      lines.forEach((line, lineIndex) => {
        // Only validate if line appears to be JSON (starts with { or [)
        const trimmed = line.trim();
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || 
            (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
          try {
            JSON.parse(line);
          } catch {
            issues.push(`${filename}:${lineIndex + 1} - Invalid JSON format`);
          }
        }
      });
    });

    // Report issues (limit output to first 10 to avoid overwhelming console)
    if (issues.length > 0) {
      console.error(`Data transfer issues detected [${label}]`, issues.slice(0, 10));
      if (issues.length > 10) {
        console.error(`... and ${issues.length - 10} more issues`);
      }
    }

    expect(issues).toHaveLength(0);
  });

  /**
   * Test: Ensures no events are duplicated across both targets.
   * The splitter should distribute events round-robin, with each event
   * appearing in exactly one target, never both.
   */
  it("should contain only unique events across targets", () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];

    // Check each target for duplicate events
    TARGET_FILENAMES.forEach((filename, index) => {
      const lines = index === 0 ? target1Lines : target2Lines;
      lines.forEach((line, lineIndex) => {
        if (seen.has(line)) {
          // Event appears in multiple targets - this is a duplication error
          duplicates.push(`${filename}:${lineIndex + 1} -> ${line}`);
        } else {
          seen.add(line);
        }
      });
    });

    if (duplicates.length > 0) {
      console.error(`Duplicate events detected [${label}]`, duplicates);
    }

    // The set size should equal the sum of all lines (no duplicates)
    const expectedTotal = target1Lines.length + target2Lines.length;
    expect(seen.size).toBe(expectedTotal);
    expect(duplicates).toHaveLength(0);
  });
});
