# Integration Tests

This document provides information about the integration testing framework used in this project.

## Overview

The integration tests are designed to validate the end-to-end functionality of the LLxprt Code. They execute the built binary in a controlled environment and verify that it behaves as expected when interacting with the file system.

These tests are located in the `integration-tests` directory and are run using a custom test runner.

## Building the tests

Prior to running any integration tests, build the CLI entry that the tests execute:

```bash
npm run build
```

You must re-run this command after making any changes to the CLI source code, but not after making changes to tests.

## Running the tests

The integration tests are not run as part of the default `npm run test` command. They must be run explicitly using the `npm run test:integration:all` script.

The integration tests can also be run using the following shortcut:

```bash
npm run test:e2e
```

## Running a specific set of tests

To run a subset of test files, you can use `npm run <integration test command> <file_name1> ....` where <integration test command> is either `test:e2e` or `test:integration*` and `<file_name>` is any of the `.test.js` files in the `integration-tests/` directory. For example, the following command runs `list_directory.test.js` and `write_file.test.js`:

```bash
npm run test:e2e list_directory write_file
```

### Running a single test by name

To run a single test by its name, use the `--test-name-pattern` flag:

```bash
npm run test:e2e -- --test-name-pattern "reads a file"
```

### Regenerating model responses

Some integration tests use faked out model responses, which may need to be
regenerated from time to time as the implementations change.

To regenerate these golden files, set the REGENERATE_MODEL_GOLDENS environment
variable to "true" when running the tests, for example:

**WARNING**: If running locally you should review these updated responses for
any information about yourself or your system that gemini may have included in
these responses.

```bash
REGENERATE_MODEL_GOLDENS="true" npm run test:e2e
```

**WARNING**: Make sure you run **await rig.cleanup()** at the end of your test,
else the golden files will not be updated.

### Deflaking a test

Before adding a **new** integration test, you should test it at least 5 times with the deflake script to make sure that it is not flaky.

```bash
npm run deflake -- --runs=5 --command="npm run test:e2e -- -- --test-name-pattern '<your-new-test-name>'"
```

### Running all tests

To run the entire suite of integration tests, use the following command:

```bash
npm run test:integration:all
```

### Sandbox matrix

The `all` command will run tests for `no sandboxing`, `docker` and `podman`.
Each individual type can be run using the following commands:

```bash
npm run test:integration:sandbox:none
```

```bash
npm run test:integration:sandbox:docker
```

```bash
npm run test:integration:sandbox:podman
```

## Diagnostics

The integration test runner provides several options for diagnostics to help track down test failures.

### Keeping test output

You can preserve the temporary files created during a test run for inspection. This is useful for debugging issues with file system operations.

To keep the test output set the `KEEP_OUTPUT` environment variable to `true`.

```bash
KEEP_OUTPUT=true npm run test:integration:sandbox:none
```

When output is kept, the test runner will print the path to the unique directory for the test run.

### Verbose output

For more detailed debugging, set the `VERBOSE` environment variable to `true`.

```bash
VERBOSE=true npm run test:integration:sandbox:none
```

When using `VERBOSE=true` and `KEEP_OUTPUT=true` in the same command, the output is streamed to the console and also saved to a log file within the test's temporary directory.

The verbose output is formatted to clearly identify the source of the logs:

```
--- TEST: <log dir>:<test-name> ---
... output from the gemini command ...
--- END TEST: <log dir>:<test-name> ---
```

## Linting and formatting

To ensure code quality and consistency, the integration test files are linted as part of the main build process. You can also manually run the linter and auto-fixer.

### Running the linter

To check for linting errors, run the following command:

```bash
npm run lint
```

You can include the `:fix` flag in the command to automatically fix any fixable linting errors:

```bash
npm run lint:fix
```

## Directory structure

The integration tests create a unique directory for each test run inside the `.integration-tests` directory. Within this directory, a subdirectory is created for each test file, and within that, a subdirectory is created for each individual test case.

This structure makes it easy to locate the artifacts for a specific test run, file, or case.

```
.integration-tests/
└── <run-id>/
    └── <test-file-name>.test.js/
        └── <test-case-name>/
            ├── output.log
            └── ...other test artifacts...
```

## Continuous integration

`.github/workflows/e2e.yml` runs integration tests for internal pull requests against `main`, `release/**` and `dev/**`, and for merge groups.

The workflow runs the tests in different sandboxing environments to ensure LLxprt Code is tested across each:

- `sandbox:none`: Runs the tests without any sandboxing.
- `sandbox:docker`: Runs the tests in a Docker container.

### Runner-local model E2E (issue #3764)

`.github/workflows/e2e.yml` runs one required Linux x64 job with runner-local
Ollama 0.31.1 and `gemma4:e2b-it-qat`. Internal PRs, merge groups and manual
`workflow_dispatch` run both host (`sandbox:none`) and Docker
(`sandbox:docker`) legs; pushes to main run only the host leg. Dispatch accepts
`branch_ref` and runs the same job. Pull requests check out their merge ref,
approved labeled internal `pull_request_target` runs check out the head SHA,
and manual runs check out `branch_ref`; checkout never persists credentials.
Fork PR heads do not run under the privileged target event or receive this E2E
job. Duplicate and doc-only filters and the internal-target mergeability gate
remain in effect. Credentialed full-platform E2E remains in `nightly.yml`.

The workflow verifies the x64 Ollama archive SHA-256
`d297381efc136451f6fabb9dd644a67f70fe51c16815a0c4a95ff0e327a3afb4`,
Ollama version 0.31.1 and Gemma digest
`07ea59a474013479c8b6b802bef095c40e964a1d776ba02f264c0e30e1aede0c`.
On Intel it exposes only the Haswell CPU backend before startup and verifies
that library in the live llama-server process mapping. On AMD it retains the
native Ollama backend and verifies a mapped CPU library. A warm-up and a second
CPU-only inference check require a nonempty response and zero VRAM usage.
The Docker leg uses host networking to reach the Ollama loopback endpoint.
No third-party model credentials are available: the OpenAI-compatible `/v1`
endpoint uses a local placeholder key.

Each leg runs the selected integration suite excluding
`todo-continuation.e2e.test.ts` and `run_shell_command.test.ts`, followed by
exactly three named shell cases. The shell assertion permits only successful
literal `echo hello-world` commands; replace requires the `replace` tool,
exact `bar content`, and no unrelated tools. File-level retries stay enabled.
`GIT_CEILING_DIRECTORIES` prevents incidental parent repository discovery in
TestRig workspaces, but does not prevent a model given an explicit path from
accessing it. The real-model ledger enforces a four-request ceiling
across two distinct tests; retries are reported separately. Logs,
telemetry, inference JSON and ledger are uploaded even on failure.

The local-model E2E profile sets a 32,768-token context and reserves 8,192
output tokens. Only when `LLXPRT_LOCAL_MODEL_E2E=true`, the generated inline
profile extends first-response, SDK request and transport headers deadlines
to 750,000, 850,000 and 900,000 ms respectively. The shell case has a
360,000 ms TestRig deadline and 450,000 ms Bun timeout; replace has a
1,200,000 ms TestRig deadline and 1,500,000 ms Bun timeout. Each job has a
90-minute bound. Other providers, local runs and nightly E2E keep their
ordinary deadlines. The inline profile controls provider selection so explicit
`--provider` flags cannot bypass its timeout settings.

To reproduce a run on a branch, use
`gh workflow run e2e.yml --ref issue3764 -f branch_ref=issue3764`.
Do not dispatch while another run on that branch is active: branch concurrency
cancels an earlier run. Verify both sandbox check names, runtime and model
pins, CPU mapping, selected suites, budget and diagnostics. To reproduce the
test selection locally, set `OPENAI_BASE_URL` to a private Ollama 0.31.1
instance, `OPENAI_API_KEY=ollama-local-only`,
`LLXPRT_DEFAULT_PROVIDER=openai`,
`LLXPRT_DEFAULT_MODEL=gemma4:e2b-it-qat`,
`LLXPRT_TEST_PROFILE=local-gemma4-e2e`, `LLXPRT_CONTEXT_LIMIT=32768`,
`LLXPRT_MAX_OUTPUT_TOKENS=8192`, and `LLXPRT_LOCAL_MODEL_E2E=true`.
Run `npm run test:integration:sandbox:none --
--exclude="**/todo-continuation.e2e.test.ts"
--exclude="**/run_shell_command.test.ts"` and then the three named shell
cases with the same invocations as the workflow. Keep local evidence under the
repository's ignored `tmp/` directory.

Earlier local and hosted trials with smaller models did not consistently
produce the required exact replacement. An ARM trial returned an empty
response after its first 16 generated tokens. Two hosted x64 Gemma runs
[36342130687](https://github.com/vybestack/llxprt-code/actions/runs/36342130687)
and [36344243429](https://github.com/vybestack/llxprt-code/actions/runs/36344243429)
passed both legs with the selected files, shell cases, CPU verification and
budget. These results are specific to the pinned x64 runtime and model; they
do not establish equivalence with the credentialed nightly full-platform suite.
