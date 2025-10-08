# Cribl SDET Assignment - Automated Testing

![CI Status](https://github.com/qoliv/sdet-assignment/workflows/Test%20Automation/badge.svg)

This repository contains automated testing infrastructure for the Cribl data pipeline application, implementing the requirements from [Instructions.md](Instructions.md).

## Overview

The application consists of 4 components:
- **Agent**: Reads from a log file and forwards data to the Splitter
- **Splitter**: Receives data and distributes it round-robin between two Target hosts
- **Target-1 & Target-2**: Receive data and write to disk

This test suite validates:
- Complete data transfer without loss or duplication  
- Both targets receive data  
- Full artifact capture for analysis

## Prerequisites

- Docker 20.10+
- Docker Compose 2.0+
- Node.js 18+ (for local test execution)
- Bash (for test runner scripts)

## Quick Start

```bash
cd automation
npm install
npm test
```

Running `npm test` orchestrates both unit and integration suites in sequence. The test harness will:
1. Clean the environment
2. Build Docker images
3. Start all services in the correct order
4. Wait for data transfer completion
5. Validate data integrity
6. Collect all artifacts
7. Clean up containers

### Targeted test runs

```bash
# Unit-only validation of helper utilities
cd automation
npm run test:unit

# Integration-only run of the end-to-end pipeline tests
cd automation
npm run test:integration
```

## Automated Test Suite

The suite is split between fast-running unit tests (utility verification) and a Docker-backed integration test that satisfies the objective to “validate that data received on the Target nodes is correct.” Each test case is documented with its purpose and goal.

### Integration Test Cases

#### TC-I01: Data Integrity Validation (`automation/src/__tests__/integration/pipeline.int.test.ts`)
- **Purpose**: Exercise the full Agent → Splitter → Target pipeline with the 1M event fixture and ensure no data is lost or duplicated.
- **Goal**: Confirm that the aggregated target output is a perfect multiset match with `large_1M_events.log` by verifying every line hash and occurrence count.

#### TC-I02: Distribution Validation (`automation/src/__tests__/integration/pipeline.int.test.ts`)
- **Purpose**: Validate that the Splitter delivers traffic to both Target containers when handling large payloads.
- **Goal**: Ensure `target_1_events.log` and `target_2_events.log` each contain at least one event after the pipeline run.

#### TC-I03: Performance Envelope (`automation/src/__tests__/integration/pipeline.int.test.ts`)
- **Purpose**: Monitor end-to-end processing time when streaming 1M events through the pipeline.
- **Goal**: Assert that pipeline completion time stays under the 5-minute SLA captured in the assignment objectives.

### Unit Test Cases

#### TC-U01: File System Utilities (`automation/src/__tests__/unit/files.unit.test.ts`)
- **Purpose**: Guard deterministic file operations used for artifact handling.
- **Goal**: Verify path resolution, fixture loading, and artifact merge helpers behave correctly across platforms.

#### TC-U02: Docker Lifecycle Utilities (`automation/src/__tests__/unit/docker.unit.test.ts`)
- **Purpose**: Validate Docker client helpers in isolation to avoid flakiness during integration runs.
- **Goal**: Confirm container start/stop orchestration logic enforces the Target → Splitter → Agent order required by the application.

#### TC-U03: Frequency Analysis Helpers (`automation/src/__tests__/unit/frequency.unit.test.ts`)
- **Purpose**: Provide confidence in the multiset diff utilities that power the data integrity assertion.
- **Goal**: Guarantee the helper correctly counts, compares, and reports frequency deltas on large payloads without overflow.

#### TC-U04: Input Validation Guards (`automation/src/__tests__/unit/validation.unit.test.ts`)
- **Purpose**: Ensure CLI and configuration validation produce actionable feedback during local execution.
- **Goal**: Assert invalid paths or missing fixtures are rejected before the Docker workflow starts, allowing quick operator feedback.

## Artifacts

All integration artifacts land in `automation/artifacts/`:

- Root level (`target_1_events.log`, `target_2_events.log`, `combined_events_1M.log`) always reflects the most recent integration run for quick inspection.
- Historical runs are archived under `automation/artifacts/runs/<slug>/` where `<slug>` corresponds to the input fixture (for example, `1`, `1000`, `1M`). Each folder contains:
	- `target_1_events.log` and `target_2_events.log` copied immediately after the test completes
	- `combined_events_<slug>.log` with both target streams merged
	- `metadata.json` summarizing fixture name and line counts

Because we preserve the `runs/` directory between iterations, CI uploads now include every fixture size instead of just the final run. Target outputs are written straight into the `automation/artifacts/` tree through Docker bind mounts, so there's no need to copy files out of the containers manually.

## CI/CD Integration

This repository is integrated with GitHub Actions. On every push:
1. Automated tests run in clean environment
2. All validations execute
3. Artifacts uploaded for inspection
4. Build status visible via badge

See [.github/workflows/ci.yml](.github/workflows/ci.yml) for pipeline configuration.

## Configuration Files

The application uses JSON configuration files (per [Instructions.md](Instructions.md)):
- [`agent/app.json`](agent/app.json) - Agent mode configuration
- [`agent/inputs.json`](agent/inputs.json) - Source file path
- [`agent/outputs.json`](agent/outputs.json) - Splitter connection
- [`splitter/app.json`](splitter/app.json) - Splitter mode configuration
- [`splitter/inputs.json`](splitter/inputs.json) - Listen port
- [`splitter/outputs.json`](splitter/outputs.json) - Target connections
- [`target/app.json`](target/app.json) - Target mode configuration
- [`target/inputs.json`](target/inputs.json) - Listen port
- [`target/outputs.json`](target/outputs.json) - Output file path


**Note**: Configuration files are not modified per assignment requirements.
