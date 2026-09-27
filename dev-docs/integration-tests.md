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

### Runner-local model E2E (issue #3764)

The required `e2e_linux` job uses runner-local Ollama and Gemma 4 E2B on
ordinary internal pull requests, merge groups, main pushes, approved labeled
internal target reruns and manual dispatch without the pilot flag. It sends no
third-party model credentials to the checked-out PR code. The Linux host and
Docker check names, duplicate/doc-only/mergeability gates, main-push host-only
rule, selected integration invocations, assertions, retries and real-model
budget guard remain in place. Fork PR heads do not execute in privileged
`pull_request_target` jobs; fork PRs remain excluded from this E2E job.
The checkout uses the PR merge ref for internal `pull_request`, an approved
internal head SHA for labeled `pull_request_target`, `github.ref` for push and
merge groups, and `branch_ref` for dispatch, always with
`persist-credentials: false`.

The separate `local_model_canaries` job runs only when explicitly opted in with
`workflow_dispatch` and `pilot_local_model=true`; that dispatch skips the
regular E2E matrix. Its check names remain distinct. Credentialed full-platform
E2E remains in `.github/workflows/nightly.yml` without changes.

With `pilot_local_model=true`, the pilot starts Ollama 0.31.1 on
`127.0.0.1:12644` and pulls `gemma4:e2b-it-qat` (Q4_0, digest
`07ea59a474013479c8b6b802bef095c40e964a1d776ba02f264c0e30e1aede0c`).
It verifies the downloaded Linux runtime archive's SHA-256 digest
(`d297381efc136451f6fabb9dd644a67f70fe51c16815a0c4a95ff0e327a3afb4`)
before extraction, then checks the runtime version and model digest before testing.
The OpenAI provider uses Ollama's `/v1` compatibility API and a local placeholder
key, with no remote inference service or provider secret. Each sandbox leg
runs the regular Linux job's first full integration invocation, excluding
only `todo-continuation.e2e.test.ts` and `run_shell_command.test.ts` (31 of 33
selected integration test files), followed by the same three named shell cases
from the regular job. The shell step exits on a failed suite. The existing
real-model budget guard remains enabled and the ledger reports retries
separately without counting their actual model requests. This selection was
validated on hosted x64 runners before its promotion to required Linux E2E;
nightly still covers credentialed full-platform tests.

On Linux, the Docker test leg sets `SANDBOX_FLAGS='--network host'` so the
sandboxed CLI reaches the host's loopback Ollama endpoint. This networking choice
applies only to the Docker leg. Neither Linux job supplies provider credentials.
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
archive is removed afterward. Ollama is limited to one concurrent context.
Both Linux jobs configure Ollama and LLxprt with a 32,768-token context and
reserve 8,192 tokens for model output. The pilot profile allows 750,000 ms
for the first model response and sets `openai-headers-timeout-ms` to 900,000 ms
on its OpenAI SDK transport. The latter exceeds Undici's ordinary 300,000 ms
response-headers limit without changing the dispatcher for other requests. On
hosted CPU, a 15,200-token replace prompt was still being evaluated at 300 s
when that limit aborted it. The Docker shell model response took about 238 s,
so the pilot shell invocation has a 360,000 ms `TestRig` deadline and a
450,000 ms Bun file timeout to leave room for its tool round trip. The real
replace invocation has a 1,200,000 ms `TestRig` deadline, its Bun file has a
1,500,000 ms timeout, and each sandbox job has a 90-minute bound. These larger
deadlines apply only when `LLXPRT_LOCAL_MODEL_PILOT=true`, set by both Linux
model jobs; local and nightly integration-test deadlines are unchanged.

To reproduce the expanded real-model test selection without using an existing
Ollama daemon, run these commands from the repository root. Choose a free port
if 12644 is in use and change both URLs accordingly. Install Ollama 0.31.1 first
and ensure the `gemma4:e2b-it-qat` digest above matches. Store all evidence in
the repository's ignored `tmp/` tree:

```bash
mkdir -p tmp/verify3764/models
OLLAMA_HOST=127.0.0.1:12644 \
  OLLAMA_MODELS="$PWD/tmp/verify3764/models" \
  OLLAMA_CONTEXT_LENGTH=32768 OLLAMA_NUM_PARALLEL=1 \
  ollama serve >tmp/verify3764/ollama-local.log 2>&1 &
OLLAMA_HOST=127.0.0.1:12644 \
  OLLAMA_MODELS="$PWD/tmp/verify3764/models" ollama pull gemma4:e2b-it-qat
curl -fsS http://127.0.0.1:12644/api/tags | jq '.models[] | select(.name == "gemma4:e2b-it-qat") | {digest, size, details}'
CI=true KEEP_OUTPUT=true VERBOSE=true \
  LLXPRT_DEFAULT_PROVIDER=openai LLXPRT_DEFAULT_MODEL=gemma4:e2b-it-qat \
  OPENAI_API_KEY=ollama-local-only \
  OPENAI_BASE_URL=http://127.0.0.1:12644/v1 LLXPRT_AUTH_TYPE=provider \
  LLXPRT_TEST_PROFILE=local-gemma4-pilot LLXPRT_CONTEXT_LIMIT=32768 \
  LLXPRT_MAX_OUTPUT_TOKENS=8192 LLXPRT_LOCAL_MODEL_PILOT=true \
  LLXPRT_FORCE_FILE_STORAGE=true \
  LLXPRT_E2E_MODEL_LEDGER="$PWD/tmp/verify3764/ledger.jsonl" \
  GIT_CEILING_DIRECTORIES="$PWD/.integration-tests" \
  bun scripts/run_bun_tests.ts --root integration-tests \
    --exclude='**/todo-continuation.e2e.test.ts' \
    --exclude='**/run_shell_command.test.ts'
CI=true KEEP_OUTPUT=true VERBOSE=true \
  LLXPRT_DEFAULT_PROVIDER=openai LLXPRT_DEFAULT_MODEL=gemma4:e2b-it-qat \
  OPENAI_API_KEY=ollama-local-only \
  OPENAI_BASE_URL=http://127.0.0.1:12644/v1 LLXPRT_AUTH_TYPE=provider \
  LLXPRT_TEST_PROFILE=local-gemma4-pilot LLXPRT_CONTEXT_LIMIT=32768 \
  LLXPRT_MAX_OUTPUT_TOKENS=8192 LLXPRT_LOCAL_MODEL_PILOT=true \
  LLXPRT_FORCE_FILE_STORAGE=true \
  LLXPRT_E2E_MODEL_LEDGER="$PWD/tmp/verify3764/ledger.jsonl" \
  GIT_CEILING_DIRECTORIES="$PWD/.integration-tests" \
  bun scripts/run_bun_tests.ts --root integration-tests \
    --exclude='**/todo-continuation.e2e.test.ts' \
    integration-tests/run_shell_command.test.ts \
    --testNamePattern='should be able to run a shell command|should be able to run a shell command via stdin|should run a platform-specific file listing command'
bun scripts/check-e2e-model-budget.ts --ledger "$PWD/tmp/verify3764/ledger.jsonl"
curl -fsS http://127.0.0.1:12644/api/ps | jq '.models[] | {name, size, context_length}'
```

Google [released Gemma 4 E2B on April 2, 2026](https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/);
Ollama publishes the [QAT tag](https://ollama.com/library/gemma4/tags). The
[GitHub-hosted runner specifications](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
list 4 CPU, 16 GB RAM and 14 GB SSD for public `ubuntu-latest` jobs. The macOS
Apple Silicon measurements below alone did not establish CPU-only x64
performance. Hosted x64 evidence is recorded below. For an opt-in rerun,
use `gh workflow run e2e.yml --ref issue3764 -f branch_ref=issue3764 -f pilot_local_model=true`.
A dispatch without the pilot flag runs the regular local-model job. Do not
start a second dispatch while a run on the same branch is active: the workflow
cancels in-progress jobs on that branch. Inspect both sandbox legs, SHA and
model digest verification, mapped CPU backend, E2E outputs, budget and uploaded
diagnostics. The regular PR checks must pass on the pushed commit before
considering the migration verified.

Hosted run [`36276039788`](https://github.com/vybestack/llxprt-code/actions/runs/36276039788)
passed shell in both legs but failed replace in all three attempts per leg.
Four replace attempts hit the CLI's default 300,000 ms first-response watchdog;
the remaining host attempt hit the 900,000 ms `TestRig` deadline. Both diagnostic
artifacts uploaded. The pilot-only first-response and replace deadlines above
were increased in response; this does not establish a passing hosted run.

Hosted [run 36278157447](https://github.com/vybestack/llxprt-code/actions/runs/36278157447)
confirmed why that increase did not work. The test rig generated a profile with
`stream-first-response-timeout-ms: 600000`, but also passed `--provider openai`.
`applyGlobalAndProfileEphemeralSettings` deliberately skips profile ephemerals
when the provider is explicit. The stream guard therefore used its 300000 ms
default. The pilot now relies on its inline profile for provider, model,
credentials and timeout instead of supplying conflicting CLI flags. A real-CLI
test uses a stalled local HTTP server and a shortened profile threshold to
verify that the guard reads the profile setting. The required Linux job now
uses that same inline profile; the default watchdog is unchanged.

Both hosted artifacts include `telemetry.log` with the original user prompt:
`Use the replace tool on '<absolute test file>' to replace the exact text 'foo
content' with 'bar content'. Do not add any whitespace.` On the Docker leg,
the model first tried `read_file` with a space inserted into the checkout path,
then called `replace` twice after dropping one `llxprt-code` path component.
It subsequently called `glob`, `list_directory`, `direct_web_fetch` and
`run_shell_command`; none repaired the file. On the host leg, a retry read the
correct file but passed tool-result formatting and patch fragments as the
`old_string` to `ast_edit` instead of making the requested replacement. Other
attempts hit the guard or TestRig deadline. The target files existed, observed
prompts fit within 32,768 tokens, and the model chose incorrect tools or paths.
The assertions still require the `replace` call, no unrelated tools and exact
`bar content`.

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
failed suite and then-unmeasured hosted-runner CPU/Docker performance meant
the pilot was not ready for PR gating at that stage. During remediation, the
first two repeat runs failed because the non-interactive shell canary was initially passed
an option array without stdin; that test setup was corrected before the third
run. In that third genuine suite, the shell canary passed, but replace failed
three of three file-level attempts (`tmp/verify3764/canaries-remediation-2b-3.log`).
The budget guard still passed with four distinct-test requests and separately
reported five replace and seven shell invocations including retries. No local
model/configuration tested here passed repeat suites consistently, so the pilot
is non-required. The three 4B suite logs likewise show only one complete passing
suite, with replace exhausting all retries in two.

#### Gemma 4 pilot candidate (September 26, 2026)

The official `gemma4:e2b-it-qat` artifact is 4,336,358,185 bytes, with the
digest pinned above. Ollama 0.31.1 reported a 3,784,551,955-byte loaded model
at 32,768 context on the local M4 Max. Three separate full `TestRig` suites
passed both the shell and exact replacement canaries on the first file-level
attempt, six tests in total. The three per-suite budget checks each passed at
four recorded requests across two distinct tests. See
`tmp/verify3764/canaries-gemma4-e2b-{1,2,3}.log` and `gemma-budget.log` for
local evidence. The strict unrelated-tool and exact-content assertions were
unchanged. Qwen3.5:4b Q4_K_M also passed shell but failed replace in a further
complete suite despite retrying three times. Disabling thinking for 4B did not
fix the unrelated-tool failure in its first complete suite; its next run was
stopped to avoid competing with the Gemma measurements. The earlier 2B hosted
failures remain as recorded above. These were local GPU measurements; hosted
Gemma results are recorded below.

#### Hosted x64 evidence (September 27, 2026)

Two full hosted Linux pilot runs passed both legs:
[36342130687](https://github.com/vybestack/llxprt-code/actions/runs/36342130687)
used an Intel Docker runner with the Haswell CPU library pinned and a native AMD
host runner; [36344243429](https://github.com/vybestack/llxprt-code/actions/runs/36344243429)
used AMD for both legs. Each leg verified the Ollama 0.31.1 archive SHA-256,
Gemma model digest, live mapped CPU backend and CPU-only inference. Each ran the
same 31 selected integration files plus three named shell cases, produced the
exact `bar content` replacement, and passed the 4/4 real-model budget check.
These successes are specific to hosted x64 CPUs and the pinned model/runtime.
The ARM pilot [36341146657](https://github.com/vybestack/llxprt-code/actions/runs/36341146657)
failed preflight inference in both legs: Ollama returned `done:true` with an
empty `response` and `done_reason:length` after 16 generated tokens. No selected
E2E files or budget guard ran on those ARM legs. The required job checks
`x86_64` and rejects other architectures rather than silently switching backend.
Earlier x64 pilot failures and their observed model/tool issues remain documented
above. The hosted pilots did not themselves
exercise the required PR check names; inspect the ordinary PR run separately.
