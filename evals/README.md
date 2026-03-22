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
- Runs in PR and nightly CI
- Test core functionality that models handle consistently
- Example: Basic tool calling, memory operations

### `USUALLY_PASSES`

- May occasionally fail due to model variance
- Only runs when `RUN_EVALS=1` is set (nightly CI)
- Tests more complex or edge-case behavior
- Example: Multi-step reasoning, complex tool orchestration

## Writing Evals

Create a new file `evals/my_feature.eval.ts`:

```typescript
import { describe, expect } from 'vitest';
import { evalTest, validateModelOutput } from './test-helper.js';

describe('my_feature', () => {
  evalTest('ALWAYS_PASSES', {
    name: 'should do something useful',
    log: true, // optional: save tool call logs to evals/logs/
    params: {
      settings: { tools: { core: ['some_tool'] } }, // optional settings
    },
    prompt: 'Ask the model to do something',
    assert: async (rig, result) => {
      // Check that the expected tool was called
      const foundToolCall = await rig.waitForToolCall('some_tool');
      expect(foundToolCall).toBeTruthy();

      // Validate the model's output
      validateModelOutput(result, 'expected content', 'Test name');
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
- `log` (optional boolean): Save tool call logs to `evals/logs/`

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

// Validate model output (warns if content missing, throws if no output)
validateModelOutput(result, 'expected string');
validateModelOutput(result, ['string1', 'string2', /regex/]);
```

## Running Evals

```bash
# Run only ALWAYS_PASSES evals (default in CI)
npm run test:always_passing_evals

# Run all evals including USUALLY_PASSES
npm run test:all_evals

# Or set the env var manually
RUN_EVALS=1 vitest run --config evals/vitest.config.ts
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

- **PR checks**: Run `ALWAYS_PASSES` evals only
- **Nightly**: Run all evals with `RUN_EVALS=1`
- Logs are saved to `evals/logs/` when `log: true` (gitignored)

## Tips

1. **Keep evals focused**: Test one workflow per eval
2. **Use descriptive names**: Make failures easy to diagnose
3. **Set realistic policies**: Don't mark flaky tests as `ALWAYS_PASSES`
4. **Log when debugging**: Set `log: true` to capture tool call details
5. **Validate output loosely**: Use `validateModelOutput` which warns instead of failing on missing content
