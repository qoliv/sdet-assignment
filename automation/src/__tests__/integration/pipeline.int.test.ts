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

const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const WORKSPACE_ROOT = path.resolve(PROJECT_ROOT, "..");

const ARTIFACTS_DIR = path.join(PROJECT_ROOT, "artifacts");
const ARTIFACTS_RUNS_DIR = path.join(ARTIFACTS_DIR, "runs");
const TARGET_FILENAMES = [
  "target_1_events.log",
  "target_2_events.log",
] as const;
const AGENT_INPUTS_DIR = path.join(WORKSPACE_ROOT, "application/agent/inputs");
const AGENT_CONFIG_PATH = path.join(WORKSPACE_ROOT, "application/agent/inputs.json");
const AGENT_CONFIG_BACKUP_PATH = `${AGENT_CONFIG_PATH}.backup`;

const { access, readFile, writeFile, copyFile, rm } = fs.promises;

async function pathExists(filepath: string): Promise<boolean> {
  try {
    await access(filepath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

interface InputVariant {
  label: string;
  slug: string;
  filename: string;
  allowEmpty?: boolean;
}

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

async function ensureFixtureExists(filename: string): Promise<void> {
  const filepath = path.join(AGENT_INPUTS_DIR, filename);
  if (!(await pathExists(filepath))) {
    throw new Error(`Fixture file not found: ${filepath}`);
  }
}

async function updateAgentConfig(monitorRelativePath: string): Promise<void> {
  if (!(await pathExists(AGENT_CONFIG_PATH))) {
    throw new Error(`Agent inputs configuration not found: ${AGENT_CONFIG_PATH}`);
  }

  const rawConfig = await readFile(AGENT_CONFIG_PATH, "utf-8");
  const config = JSON.parse(rawConfig) as Record<string, unknown>;
  config.monitor = monitorRelativePath;
  await writeFile(AGENT_CONFIG_PATH, `${JSON.stringify(config, null, 4)}\n`);
}

async function stageAgentInput(filename: string): Promise<void> {
  await ensureFixtureExists(filename);
  const monitorPath = path.posix.join("inputs", filename);
  await updateAgentConfig(monitorPath);
}

jest.setTimeout(600_000);

beforeAll(async () => {
  if (!(await pathExists(AGENT_CONFIG_PATH))) {
    throw new Error(`Agent inputs configuration not found: ${AGENT_CONFIG_PATH}`);
  }

  await copyFile(AGENT_CONFIG_PATH, AGENT_CONFIG_BACKUP_PATH);

  if (await pathExists(ARTIFACTS_RUNS_DIR)) {
    await rm(ARTIFACTS_RUNS_DIR, { recursive: true, force: true });
  }

  await ensureDirExists(ARTIFACTS_RUNS_DIR);
});

afterAll(async () => {
  if (await pathExists(AGENT_CONFIG_BACKUP_PATH)) {
    await copyFile(AGENT_CONFIG_BACKUP_PATH, AGENT_CONFIG_PATH);
    await rm(AGENT_CONFIG_BACKUP_PATH);
  }
});

describe.each(INPUT_VARIANTS)("data pipeline integration ($label)", ({ label, slug, filename, allowEmpty }) => {
  let resolvedTargets!: Record<(typeof TARGET_FILENAMES)[number], string>;
  let target1Lines!: string[];
  let target2Lines!: string[];
  let sourceFile!: string;

  beforeAll(async () => {
    await cleanEnvironment(ARTIFACTS_DIR, [...TARGET_FILENAMES], console, {}, { preserve: ["runs"] });
    await stageAgentInput(filename);
    sourceFile = path.join(AGENT_INPUTS_DIR, filename);
    buildImagesIfNeeded();
    startDeployment();
    await waitForHealth();
    await waitForCompletion([
      { container: "target_1", filepath: "events.log", minimumBytes: 0 },
      { container: "target_2", filepath: "events.log", minimumBytes: 0 },
    ]);

    resolvedTargets = await assertFilesAvailable(ARTIFACTS_DIR, [...TARGET_FILENAMES]);

    target1Lines = await readLinesFromFile(resolvedTargets[TARGET_FILENAMES[0]]);
    target2Lines = await readLinesFromFile(resolvedTargets[TARGET_FILENAMES[1]]);
  });

  afterAll(async () => {
    const combinedPath = await collectArtifacts(ARTIFACTS_DIR, [...TARGET_FILENAMES], {
      outputFilename: `combined_events_${slug}.log`,
    });

    const runDir = path.join(ARTIFACTS_RUNS_DIR, slug);
    await ensureDirExists(runDir);

    for (const targetFilename of TARGET_FILENAMES) {
      const sourcePath = resolvedTargets[targetFilename];
      const destPath = path.join(runDir, targetFilename);
      await copyFile(sourcePath, destPath);
    }

    const combinedDest = path.join(runDir, path.basename(combinedPath));
    await copyFile(combinedPath, combinedDest);

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

    cleanContainers();
  });

  it("should match line counts between source and targets", async () => {
    const lineCounts = await validateDataIntegrity({
      sourceFile,
      target1File: resolvedTargets[TARGET_FILENAMES[0]],
      target2File: resolvedTargets[TARGET_FILENAMES[1]],
    });

    if (allowEmpty) {
      expect(lineCounts.source).toBe(0);
      expect(lineCounts.target1).toBe(0);
      expect(lineCounts.target2).toBe(0);
      expect(target1Lines).toHaveLength(0);
      expect(target2Lines).toHaveLength(0);
    } else {
      validateDistribution(lineCounts);
      expect(lineCounts.source).toBeGreaterThan(0);
    }

    console.debug(`Line counts [${label}]`, lineCounts);

    expect(lineCounts.source).toBe(lineCounts.target1 + lineCounts.target2);
  });

  it("should transfer events without corruption or data loss", async () => {
    const issues: string[] = [];

    // Check 1: Verify all events are complete (no empty lines unless source is empty)
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

    // Check for missing events
    sourceFreq.forEach((count, line) => {
      const targetCount = targetFreq.get(line) || 0;
      if (targetCount < count) {
        const preview = line.length > 50 ? `${line.substring(0, 50)}...` : line;
        issues.push(`Event missing ${count - targetCount} occurrence(s) in targets: "${preview}"`);
      }
    });

    // Check for extra events
    targetFreq.forEach((count, line) => {
      const sourceCount = sourceFreq.get(line) || 0;
      if (count > sourceCount) {
        const preview = line.length > 50 ? `${line.substring(0, 50)}...` : line;
        issues.push(`Extra event with ${count - sourceCount} occurrence(s) not in source: "${preview}"`);
      }
    });

    // Check 3: If events claim to be structured data, validate parseability
    TARGET_FILENAMES.forEach((filename, index) => {
      const lines = index === 0 ? target1Lines : target2Lines;
      lines.forEach((line, lineIndex) => {
        // Only validate if line appears to be JSON
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

    if (issues.length > 0) {
      console.error(`Data transfer issues detected [${label}]`, issues.slice(0, 10));
      if (issues.length > 10) {
        console.error(`... and ${issues.length - 10} more issues`);
      }
    }

    expect(issues).toHaveLength(0);
  });

  it("should contain only unique events across targets", () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];

    TARGET_FILENAMES.forEach((filename, index) => {
      const lines = index === 0 ? target1Lines : target2Lines;
      lines.forEach((line, lineIndex) => {
        if (seen.has(line)) {
          duplicates.push(`${filename}:${lineIndex + 1} -> ${line}`);
        } else {
          seen.add(line);
        }
      });
    });

    if (duplicates.length > 0) {
      console.error(`Duplicate events detected [${label}]`, duplicates);
    }

    const expectedTotal = target1Lines.length + target2Lines.length;
    expect(seen.size).toBe(expectedTotal);
    expect(duplicates).toHaveLength(0);
  });
});
