# QA Engineering: Take Home Project

## Setup

1. Hosts:
   - Agent — 1 host tagged as "Agent"
   - Splitter — 1 host tagged as "Splitter"
   - Target — 2 hosts, one tagged as "Target-1" and the other as "Target-2"

2. Application Modes:
   - Agent — Reads from a specified file and forwards the contents to a "Splitter"
   - Splitter — Receives data from an "Agent" and randomly splits the data between the two configured "Target" hosts
   - Target — Receives data from a "Splitter" and writes it to a file on disk

## Objectives

Automate the following tasks using the language of your choice:

1. Download and install the provided application on each of the 4 hosts mentioned in the "Setup" section.
2. For each "Application Mode," there is a corresponding configuration directory in the provided package; please examine these files before proceeding. You must start the applications in the exact order: Targets, Splitter, Agent. Otherwise, the deployment may not function as expected.
   - To start each application, run: `node app.js <conf_directory>`
3. Automate the following test cases:
   - Validate that data received on the "Target" nodes is correct
   - Optional: Any additional test cases that provide coverage
4. Capture all output and artifacts generated from each application/host.

## Acceptance Criteria

- Test suite with the automated test case as noted in the "Objectives" section
  - Each test case should include documentation describing the purpose and goal of the test
- Setup and teardown of the deployment must be fully automated
- Node.js application and configuration files should not be modified in any way, with the exception of the `inputs.json` file
- Create a GitHub repository and add:
  - Test implementation
  - README.md documenting your approach and complete instructions for test execution outside of the CI environment
- Integrate the GitHub repository with a publicly available CI/CD service
  - Such as, but not limited to: GitHub, CircleCI, TravisCI
- Submission should be a link to the GitHub repository README.md, containing all necessary information for evaluating the solution

## Notes

- The provided Node.js application requires Node v12+
- You should be able to explain your approach for deploying and testing the application

## Resources

- Node.js application for the assignment: https://drive.google.com/file/d/16k1na8UA0THRBQbKSeo8t_spX1ehkXwx/view?usp=sharing