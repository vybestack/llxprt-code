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

To ensure the integration tests are always run, a GitHub Actions workflow is defined in `.github/workflows/e2e.yml`. This workflow automatically runs the integrations tests for pull requests against the `main` branch, or when a pull request is added to a merge queue.

The workflow runs the tests in different sandboxing environments to ensure LLxprt Code is tested across each:

- `sandbox:none`: Runs the tests without any sandboxing.
- `sandbox:docker`: Runs the tests in a Docker container.
- `sandbox:podman`: Runs the tests in a Podman container.

### Manual local-model E2E pilot (issue #3764)

The existing `.github/workflows/e2e.yml` runs credentialed provider E2E for
internal PRs, main pushes, merge groups and approved labeled reruns. Its required
job names, quota selection, event filtering, full test coverage and budget guard
remain unchanged. The local-model experiment is a separate job in that same
workflow. It runs only on `workflow_dispatch` with the boolean
`pilot_local_model=true`; that dispatch skips the credentialed E2E matrix.
Dispatch without the pilot flag still runs the regular credentialed matrix.
Pilot jobs have distinct, non-required check names and cannot block ordinary
required PR CI. The pilot does not replace any third-party-model E2E coverage.
The credentialed full-platform E2E matrix also remains in
`.github/workflows/nightly.yml`.

With `pilot_local_model=true`, the pilot starts Ollama 0.31.1 on
`127.0.0.1:12644` and pulls `qwen3.5:2b` (Q8_0, digest
`324d162be6ca5629ae4517c8710434d0bd2d665bc94dbad46e9af8fbf8a2f0df`).
It verifies the downloaded Linux runtime archive's SHA-256 digest
(`d297381efc136451f6fabb9dd644a67f70fe51c16815a0c4a95ff0e327a3afb4`)
before extraction, then checks the runtime version and model digest before testing.
The OpenAI provider uses Ollama's `/v1` compatibility API and a local placeholder
key, with no remote inference service or provider secret. Only the shell and
replace canaries run: both are real `TestRig` tests with tool-choice assertions,
the shell test checks command and tool success, and the replace test checks the
file's exact new contents. The shell step exits on a failed suite. The pilot
retains the four-request ledger budget check for two distinct real-model tests;
the ledger reports retries separately without counting their actual model
requests.

On Linux, the Docker test leg sets `SANDBOX_FLAGS='--network host'` so the
sandboxed CLI reaches the host's loopback Ollama endpoint. This networking choice
applies only to the Docker leg. The pilot job supplies no provider credentials.
`GIT_CEILING_DIRECTORIES` prevents Git's implicit parent-repository search from
finding the source checkout from a TestRig test directory. The Docker launcher
passes the ceiling into the container, where Git tests verify its effect across
a real bind mount; the host Git test checks the same boundary without Docker.
The shell canary permits only a literal echo shell command in non-interactive
mode. The replace canary excludes `run_shell_command` and rejects unintended
tool logs. These controls prevent the
observed incidental Git discovery and shell calls in these canaries, but they
are not a security boundary against a model supplied an explicit repository
path or a generally enabled shell tool. During local evaluation, before this exclusion, the 2B model
ran unrelated Git commands and made an unintended local commit; it was removed
without discarding file changes. The runtime archive is pinned to 0.31.1;
its CUDA and Vulkan libraries are excluded during extraction, and the downloaded
archive is removed afterward. Ollama is limited to one concurrent context. The
manual pilot configures both Ollama and LLxprt with a 32,768-token context and
reserves 8,192 tokens for model output. The real replace invocation has a
900,000 ms `TestRig` deadline, its Bun file has a 1,200,000 ms timeout, and each
sandbox job has a 90-minute bound. These larger deadlines apply only when
`LLXPRT_LOCAL_MODEL_PILOT=true`; normal integration-test deadlines are unchanged.

To reproduce the two real-model canaries without using an existing Ollama daemon,
run these commands from the repository root. Choose a free port if 12644 is in
use and change both URLs accordingly. Install Ollama 0.31.1 first and ensure the
`qwen3.5:2b` digest above matches. Store all evidence in the repository's
ignored `tmp/` tree:

```bash
mkdir -p tmp/verify3764/models
OLLAMA_HOST=127.0.0.1:12644 \
  OLLAMA_MODELS="$PWD/tmp/verify3764/models" \
  OLLAMA_CONTEXT_LENGTH=32768 OLLAMA_NUM_PARALLEL=1 \
  ollama serve >tmp/verify3764/ollama-local.log 2>&1 &
OLLAMA_HOST=127.0.0.1:12644 \
  OLLAMA_MODELS="$PWD/tmp/verify3764/models" ollama pull qwen3.5:2b
curl -fsS http://127.0.0.1:12644/api/tags | jq '.models[] | select(.name == "qwen3.5:2b") | {digest, size, details}'
CI=true KEEP_OUTPUT=true VERBOSE=true \
  LLXPRT_DEFAULT_PROVIDER=openai LLXPRT_DEFAULT_MODEL=qwen3.5:2b \
  OPENAI_API_KEY=ollama-local-only \
  OPENAI_BASE_URL=http://127.0.0.1:12644/v1 LLXPRT_AUTH_TYPE=provider \
  LLXPRT_TEST_PROFILE=local-qwen35-pilot LLXPRT_CONTEXT_LIMIT=32768 \
  LLXPRT_MAX_OUTPUT_TOKENS=8192 LLXPRT_LOCAL_MODEL_PILOT=true \
  LLXPRT_FORCE_FILE_STORAGE=true \
  LLXPRT_E2E_MODEL_LEDGER="$PWD/tmp/verify3764/ledger.jsonl" \
  GIT_CEILING_DIRECTORIES="$PWD/.integration-tests" \
  bun scripts/run_bun_tests.ts --root integration-tests \
    integration-tests/run_shell_command.test.ts integration-tests/replace.test.ts \
    --testNamePattern='should be able to run a shell command$|should be able to replace content in a file'
bun scripts/check-e2e-model-budget.ts --ledger "$PWD/tmp/verify3764/ledger.jsonl"
curl -fsS http://127.0.0.1:12644/api/ps | jq '.models[] | {name, size, context_length}'
```

Qwen lists the 2B and 4B releases on March 2, 2026 in its
[release list](https://github.com/QwenLM/Qwen3.5); Ollama publishes the
[quantized tags](https://ollama.com/library/qwen3.5). The
[GitHub-hosted runner specifications](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
list 4 CPU, 16 GB RAM and 14 GB SSD for public `ubuntu-latest` jobs. The
macOS Apple Silicon measurements below do not establish CPU-only x64 speed,
Linux container networking, or the total runtime and disk use of a hosted
Docker E2E leg. Those require an actual Actions run before treating this change
as validated on GitHub's runners. The existing E2E workflow is registered on
the default branch, so after pushing the pilot branch it can be dispatched with
`gh workflow run e2e.yml --ref issue3764 -f branch_ref=issue3764 -f pilot_local_model=true`.
The `--ref` selects the branch version of the workflow and the pilot's checkout;
`branch_ref` identifies the branch for dispatch grouping (and is retained for
normal credentialed reruns). Do not dispatch the new workflow file: GitHub does
not register a new `workflow_dispatch` workflow until it reaches the default
branch. An ordinary `gh workflow run e2e.yml --ref issue3764 -f branch_ref=issue3764`
still runs the credentialed matrix. Local tests validate workflow structure,
but cannot establish hosted-runner performance. Inspect the pilot jobs for both
`sandbox:none` and `sandbox:docker`: job
conclusions, step durations (build, archive download, model pull, E2E), the
`Report local model resources` step (RAM, free disk, model/runtime disk usage,
Docker server), and the uploaded Ollama server log and real-model ledger. Check
the model digest and SHA-256 result in each job log. Both canaries and the budget
check need repeated passes before considering any required-coverage change.
A local Apple Silicon result cannot substitute for Linux CPU and Docker measurements.

#### Local measurements (September 26, 2026)

With Ollama 0.31.1 on an M4 Max, the 2B tag downloaded 2,741,192,820 bytes.
The pinned Linux x64 runtime archive downloaded 1,408,625,102 bytes and a
CPU-only extraction occupied 64 MiB locally. The first three real `TestRig`
suites with the original shell assertion passed 3/3 shell and 3/3 replace after
two replace retries (one timeout, one incorrect tool path). Those runs used the
model's 262,144-token context. At a 32,768-token limit, the first CI-style
replace attempt failed after 205 seconds with malformed file paths; the repeat
experiment was stopped rather than counted as a passing suite. The 4B model
(digest `2a654d98e6fba55d452b7043684e9b57a947e393bbffa62485a7aac05ee4eefd`)
passed only 1/3 complete suites at 32,768 tokens, so it was not selected.
With shell-command validation and exact file-content assertions, two initial
2B suites passed after retries; a third suite repeatedly searched outside the
TestRig workspace and was stopped during its second attempt. After giving the
model the absolute test-file path and naming the required tools, two of three
further suites passed (`tmp/verify3764/canaries-2b-tuned-{1,2,3}.log`). The
remaining suite failed all three replace attempts: the model wrote incorrect
content, including conversational text. The shell canary passed after retries.
At the 262,144-token context, `/api/ps` reported 6,816,498,972 bytes loaded for
2B on the M4 Max (`tmp/verify3764/ps-2b-tuned.json`). The budget guard passed:
four declared requests across two distinct tests; six recorded runs of each
include retries and failed suites (`tmp/verify3764/budget-2b-tuned.log`). A
final combined suite with the shell validator accepting only equivalent literal
`echo hello-world` commands passed both canaries, with one shell retry
(`tmp/verify3764/canaries-2b-final.log`). These are local GPU results. The
failed suite and unmeasured hosted-runner CPU/Docker performance mean this
workflow is not yet validated for PR gating. During remediation, the first two
repeat runs failed because the non-interactive shell canary was initially passed
an option array without stdin; that test setup was corrected before the third
run. In that third genuine suite, the shell canary passed, but replace failed
three of three file-level attempts (`tmp/verify3764/canaries-remediation-2b-3.log`).
The budget guard still passed with four distinct-test requests and separately
reported five replace and seven shell invocations including retries. No local
model/configuration tested here passed repeat suites consistently, so the pilot
is non-required. The three 4B suite logs likewise show only one complete passing
suite, with replace exhausting all retries in two.
