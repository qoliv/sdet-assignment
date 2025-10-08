import fs from "fs";
import path from "path";
import {
  cleanEnvironment,
  buildImages,
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

function ensureFixtureExists(filename: string): void {
  const filepath = path.join(AGENT_INPUTS_DIR, filename);
  if (!fs.existsSync(filepath)) {
    throw new Error(`Fixture file not found: ${filepath}`);
  }
}

function updateAgentConfig(monitorRelativePath: string): void {
  if (!fs.existsSync(AGENT_CONFIG_PATH)) {
    throw new Error(`Agent inputs configuration not found: ${AGENT_CONFIG_PATH}`);
  }

  const config = JSON.parse(fs.readFileSync(AGENT_CONFIG_PATH, "utf-8")) as Record<string, unknown>;
  config.monitor = monitorRelativePath;
  fs.writeFileSync(AGENT_CONFIG_PATH, `${JSON.stringify(config, null, 4)}\n`);
}

function stageAgentInput(filename: string): void {
  ensureFixtureExists(filename);
  const monitorPath = path.posix.join("inputs", filename);
  updateAgentConfig(monitorPath);
}

const EVENT_LINE_REGEX = /^This is event number \d+$/;

jest.setTimeout(600_000);

beforeAll(() => {
  if (!fs.existsSync(AGENT_CONFIG_PATH)) {
    throw new Error(`Agent inputs configuration not found: ${AGENT_CONFIG_PATH}`);
  }

  fs.copyFileSync(AGENT_CONFIG_PATH, AGENT_CONFIG_BACKUP_PATH);

  if (fs.existsSync(ARTIFACTS_RUNS_DIR)) {
    fs.rmSync(ARTIFACTS_RUNS_DIR, { recursive: true, force: true });
  }

  ensureDirExists(ARTIFACTS_RUNS_DIR);
});

afterAll(() => {
  if (fs.existsSync(AGENT_CONFIG_BACKUP_PATH)) {
    fs.copyFileSync(AGENT_CONFIG_BACKUP_PATH, AGENT_CONFIG_PATH);
    fs.rmSync(AGENT_CONFIG_BACKUP_PATH);
  }
});

describe.each(INPUT_VARIANTS)("data pipeline integration ($label)", ({ label, slug, filename, allowEmpty }) => {
  let resolvedTargets!: Record<(typeof TARGET_FILENAMES)[number], string>;
  let target1Lines!: string[];
  let target2Lines!: string[];
  let sourceFile!: string;

  beforeAll(async () => {
  cleanEnvironment(ARTIFACTS_DIR, [...TARGET_FILENAMES], console, {}, { preserve: ["runs"] });
    stageAgentInput(filename);
    sourceFile = path.join(AGENT_INPUTS_DIR, filename);
    buildImages();
    startDeployment();
    await waitForHealth();
    await waitForCompletion([
      { container: "target_1", filepath: "events.log", minimumBytes: 0 },
      { container: "target_2", filepath: "events.log", minimumBytes: 0 },
    ]);

    resolvedTargets = assertFilesAvailable(ARTIFACTS_DIR, [...TARGET_FILENAMES]);

    target1Lines = readLinesFromFile(resolvedTargets[TARGET_FILENAMES[0]]);
    target2Lines = readLinesFromFile(resolvedTargets[TARGET_FILENAMES[1]]);
  });

  afterAll(() => {
    const combinedPath = collectArtifacts(ARTIFACTS_DIR, [...TARGET_FILENAMES], {
      outputFilename: `combined_events_${slug}.log`,
    });

    const runDir = path.join(ARTIFACTS_RUNS_DIR, slug);
    ensureDirExists(runDir);

    TARGET_FILENAMES.forEach((targetFilename) => {
      const sourcePath = resolvedTargets[targetFilename];
      const destPath = path.join(runDir, targetFilename);
      fs.copyFileSync(sourcePath, destPath);
    });

    const combinedDest = path.join(runDir, path.basename(combinedPath));
    fs.copyFileSync(combinedPath, combinedDest);

    const metadata = {
      label,
      slug,
      sourceFixture: filename,
      target1Lines: target1Lines.length,
      target2Lines: target2Lines.length,
      totalLines: target1Lines.length + target2Lines.length,
      generatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(runDir, "metadata.json"),
      `${JSON.stringify(metadata, null, 2)}\n`
    );

    cleanContainers();
  });

  it("should match line counts between source and targets", () => {
    const lineCounts = validateDataIntegrity({
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

  it("should produce correctly formatted events", () => {
    const invalidPerTarget = TARGET_FILENAMES.map((filename, index) => {
      const lines = index === 0 ? target1Lines : target2Lines;
      return {
        filename,
        invalidLines: lines.filter((line) => !EVENT_LINE_REGEX.test(line)),
      };
    });

    const flattenedInvalid = invalidPerTarget.flatMap(({ invalidLines }) => invalidLines);

    if (flattenedInvalid.length > 0) {
      console.error(`Invalid event lines detected [${label}]`, invalidPerTarget);
    }

    expect(flattenedInvalid).toHaveLength(0);
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
