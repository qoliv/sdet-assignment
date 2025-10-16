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

The test suite contains **47 total tests** organized into two categories:
- **29 Unit Tests** across 6 test files (utility verification with mocked dependencies)
- **18 Integration Tests** (6 data volume variants × 3 test cases each) that exercise the full Agent → Splitter → Target pipeline

All tests are fully documented with JSDoc comments explaining their purpose and implementation. The suite achieves **87.5% statement coverage** overall.

### Integration Tests (18 tests)

Located in `automation/src/__tests__/integration/pipeline.int.test.ts`, these tests exercise the complete Agent → Splitter → Target pipeline with Docker orchestration. Each test variant uses a different data volume:

- **Empty input** (0 events)
- **Small input** (1 event)
- **Medium input** (100 events)
- **Large input** (1,000 events)
- **Very large input** (10,000 events)
- **Stress test** (1,000,000 events)

For each volume, 3 tests are executed:

1. **Data Integrity Validation**: Verifies that all events are delivered correctly with no data loss or duplication using byte-level multiset reconciliation (hash frequency comparison)
2. **Distribution Validation**: Confirms that events are properly distributed to both target nodes when data is present
3. **Performance Validation**: Ensures pipeline completion stays within the 5-minute SLA requirement

### Unit Tests (29 tests)

These fast-running tests verify individual utility functions with mocked dependencies:

#### `automation/src/__tests__/unit/validation.unit.test.ts` (6 tests)
Tests the data integrity validation logic including:
- Successful validation when source and target data match
- Detection of missing lines in target data
- Detection of extra lines in target data  
- Detection of frequency mismatches (duplicates/missing occurrences)
- Validation of proper distribution across multiple targets
- Detection of empty target nodes

#### `automation/src/__tests__/unit/docker.unit.test.ts` (4 tests)
Tests Docker orchestration utilities:
- Container health check verification
- Service availability monitoring
- Build process validation
- Deployment orchestration

#### `automation/src/__tests__/unit/files.unit.test.ts` (11 tests)
Tests file system operations:
- Reading lines from files
- Counting lines in files
- Collecting artifacts from Docker containers
- Combining multiple files
- Path resolution and validation
- Error handling for missing files

#### `automation/src/__tests__/unit/frequency.unit.test.ts` (3 tests)
Tests character frequency map utilities used in multiset reconciliation:
- Building frequency maps from strings
- Subtracting frequency maps
- Handling empty inputs

#### `automation/src/__tests__/unit/time.unit.test.ts` (1 test)
Tests async delay utility:
- Verifies sleep function provides accurate delays

#### `automation/src/__tests__/unit/waitForCompletion.unit.test.ts` (4 tests)
Tests data transfer completion monitoring:
- Detecting when file sizes stabilize
- Timeout handling
- Polling intervals
- Empty file handling

### Test Coverage

| Category | Files | Tests | Coverage |
|----------|-------|-------|----------|
| Unit Tests | 6 | 29 | ~100% of utilities |
| Integration Tests | 1 | 18 | Full pipeline E2E |
| **Total** | **7** | **47** | **87.5% overall** |

### Documentation Standards

All test files include comprehensive JSDoc documentation:
- `@fileoverview` tags describing the test file's purpose
- Function documentation with `@param`, `@returns`, and `@throws` tags
- Inline comments explaining test logic and assertions
- Clear test descriptions using Jest's `describe()` and `it()` blocks

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
