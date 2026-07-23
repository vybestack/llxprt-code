# LLxprt Behavioral Evals

This directory contains behavioral evaluations (evals) for LLxprt. Unlike integration tests (which test specific features in isolation), evals test end-to-end behavior that depends on LLM responses.

## What are Evals?

Evals are tests that:

- Exercise real LLxprt workflows end-to-end
- Depend on LLM behavior (non-deterministic)
- May occasionally fail due to model variance
- Are slower and more expensive than unit/integration tests

## Eval Policies

Each eval has a policy that determines when it runs:

### `ALWAYS_PASSES`

- Should reliably pass every time
- Tests core functionality that models handle consistently
- Example: Basic tool calling, memory operations

> Note: `ALWAYS_PASSES` evals are **not** currently wired into pull-request CI.
> They run in the nightly workflows (`.github/workflows/evals-nightly.yml` and
> the `behavioral_evals` job in `.github/workflows/nightly.yml`). Both delegate
> to the shared `.github/workflows/_evals-run.yml`. `USUALLY_PASSES` evals are
> skipped unless `RUN_EVALS=1` is set, which the nightly eval workflows do.

### `USUALLY_PASSES`

- May occasionally fail due to model variance
- Only runs when `RUN_EVALS=1` is set (nightly CI)
- Tests more complex or edge-case behavior
- Example: Multi-step reasoning, complex tool orchestration

## Writing Evals

Create a new file `evals/my_feature.eval.ts`:

```typescript
import { describe, expect } from 'vitest';
import { evalTest } from './test-helper.js';

describe('my_feature', () => {
  evalTest('ALWAYS_PASSES', {
    name: 'should do something useful',
    params: {
      settings: { tools: { core: ['some_tool'] } }, // optional settings
    },
    prompt: 'Ask the model to do something',
    assert: async (rig, result) => {
      // Check that the expected tool was called
      const foundToolCall = await rig.waitForToolCall('some_tool');
      expect(foundToolCall).toBeTruthy();

      // Behavioral evals should encode their own deterministic assertions
      // (exact-value comparisons) rather than relying on substring matching.
    },
  });
});
```

### `EvalCase` Properties

- `name` (string): Test name
- `prompt` (string): The prompt to send to LLxprt
- `assert` (function): Async function to validate results
  - `rig`: TestRig instance with telemetry methods
  - `result`: String output from the CLI
- `params` (optional): TestRig setup options
  - `settings`: Override LLxprt settings for this test
  - `fakeResponsesPath`: Use canned responses instead of live model

Note: Versioned JSON diagnostic logs are automatically saved to `evals/logs/` for all evals. Each log contains the raw process capture and parsed tool calls.

### Available Assertions

From `@vybestack/llxprt-code-test-utils`:

```typescript
// Wait for a specific tool to be called
await rig.waitForToolCall('tool_name');
await rig.waitForToolCall('tool_name', timeout);
await rig.waitForToolCall('tool_name', timeout, (args) => args.includes('foo'));

// Wait for any of multiple tools
await rig.waitForAnyToolCall(['tool1', 'tool2']);

// Expect successful tool calls
await rig.expectToolCallSuccess(['tool_name']);

// Read all tool calls
const toolLogs = rig.readToolLogs();

// Validate advisory model output content (warns and returns false when
// missing, throws only when there is no output at all — reserve for content
// that is not a hard requirement)
validateModelOutput(result, 'expected string');
validateModelOutput(result, ['string1', 'string2', /regex/]);
```

## Running Evals

```bash
# Run only ALWAYS_PASSES evals
npm run test:always_passing_evals

# Run all evals including USUALLY_PASSES (canonical manual invocation;
# matches the nightly workflow). Sets RUN_EVALS=1 and runs vitest with
# --root ./evals so report.json lands at evals/logs/report.json.
npm run test:all_evals

# Equivalent manual invocation (must use --root ./evals so the JSON
# reporter's outputFile resolves to evals/logs/report.json, which the
# nightly aggregation and artifact upload expect)
RUN_EVALS=1 npx vitest run --root ./evals
```

## When to Use Integration Tests vs Evals

| Use Integration Tests                 | Use Evals                          |
| ------------------------------------- | ---------------------------------- |
| Testing specific tool implementations | Testing end-to-end workflows       |
| Deterministic behavior                | LLM-dependent behavior             |
| Fast feedback (<1s per test)          | Slower feedback (10s-60s per test) |
| Can use fake/mocked responses         | Requires real model behavior       |
| Run on every commit                   | Run nightly or on-demand           |

## CI Integration

- **PR checks**: Do **not** run evals today. `ALWAYS_PASSES` evals are intended
  to be reliable enough for PR gates, but no eval step is currently wired into
  `.github/workflows/ci.yml`. Add a dedicated eval PR gate before relying on
  this.
- **Nightly**: Run all evals with `RUN_EVALS=1` via the shared
  `.github/workflows/_evals-run.yml`, called by both
  `.github/workflows/evals-nightly.yml` and
  `.github/workflows/nightly.yml` (the `behavioral_evals` job).
- Logs are automatically saved to `evals/logs/` (gitignored)

## Tips

1. **Keep evals focused**: Test one workflow per eval
2. **Use descriptive names**: Make failures easy to diagnose
3. **Set realistic policies**: Don't mark flaky tests as `ALWAYS_PASSES`
4. **Check logs when debugging**: Tool call logs are automatically saved to `evals/logs/`
5. **Encode deterministic assertions**: Behavioral evals should assert exact expected values (after harmless normalization) rather than substring matching, so paraphrases, negations, and wrong tokens fail the eval. Reserve `validateModelOutput` for advisory content where a warning is acceptable (it returns `false` but does not throw when content is missing).

## Reporting

The nightly workflow (`.github/workflows/evals-nightly.yml`) runs evals multiple times and aggregates the results using `scripts/aggregate_evals.js`. The aggregation script:

1. **Collects current run data**: Parses all `report.json` files from the current workflow run (generated by vitest's JSON reporter)
2. **Fetches historical data**: Uses `gh run list` and `gh run download` to pull recent nightly eval results. Runs are filtered by the artifact `retention-days` (7 days) using each run's `createdAt` timestamp, so only runs whose artifacts can still be downloaded are requested.
3. **Generates a summary table**: Shows pass rates for each test across historical runs and the current run
4. **Outputs to GitHub Step Summary**: The table appears in the workflow run summary. Aggregation exits nonzero when no reports or no usable assertion data are found, so broken result collection surfaces as a failed job instead of a silent success.

### Interpreting the Results

- **Overall Pass Rate**: Percentage of all tests that passed in the current run
- **Per-Test Pass Rates**: Individual test success rates across historical runs
- **Trends**: Compare current vs. historical to spot regressions or improvements
- **Bold Current Column**: The current run is highlighted in bold for easy comparison

Example output:

```
# Eval Results Summary

**Overall Pass Rate:** 95.0% (19/20 tests passed)

| Test | Run 12345 | Run 12344 | **Current** |
| :--- | :---: | :---: | :---: |
| [should save memory](https://github.com/vybestack/llxprt-code/search?q=should+save+memory&type=code) | 100% | 100% | **100%** |
| [complex reasoning](https://github.com/vybestack/llxprt-code/search?q=complex+reasoning&type=code) | 90% | 80% | **67%** |
```

### Total Pass Rate

The overall pass rate at the top is calculated as `(total passed tests) / (total tests)` across all runs in the current workflow. For workflows with a matrix strategy (e.g., 3 runs), this represents the combined pass rate.

For more details on a specific test, click the test name link to search the codebase, or click a run ID link to view that workflow run's full logs.
