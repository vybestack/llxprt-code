# Test Plan — Issue #1581

> **Single source of truth:** If any detail in this file conflicts with `README.md`, the README takes precedence.

## Philosophy

Following dev-docs/RULES.md: test-first, behavioral tests, no mock theater. Each extracted module gets its own test file covering the standalone functions. The existing `subagent.test.ts` stays as integration tests for the `SubAgentScope` class.

## Existing Test Inventory

### subagent.test.ts (41 tests)
- `ContextState` (2 tests): get/set, missing keys
- `SubAgentScope` creation (4 tests): minimal config, preflight skip, tool validation
- Stateless compliance (1 test): no direct Config access
- Stateless runtime enforcement (5 tests): runtime bundle, tool declarations, env context, whitelist, no foreground Config
- `runNonInteractive` initialization (6 tests): template, output instructions, initialMessages, missing vars, sessionId, mutual exclusion, interactionMode
- `runNonInteractive` execution (6 tests): GOAL termination, todo prompt, emitvalue, external tools, tool errors, disabled tools
- `runNonInteractive` termination (3 tests): MAX_TURNS, TIMEOUT, ERROR
- `dispose` (4 tests): abort, signal cleanup, multiple calls, null controller
- `buildPartsFromCompletedCalls` (4 tests): deduplication, canUpdateOutput, errors, functionResponse-only
- Nudge behavior (1 test): missing outputs nudge
- Anthropic boundary (2 tests): filter functionCall from error, error-only parts
- Misc (3 tests): stateless prompt, tool error responses, fail-fast disabled

### subagentOrchestrator.test.ts (16 tests)
These test the orchestrator and are NOT touched by this decomposition.

## New Test Files

### subagentApiCompat.test.ts (NOT skipped — runtime canary)

```typescript
/**
 * Backward-compatibility canary — these symbols existed before decomposition.
 * Must pass at ALL times during refactoring. Failure = regression.
 */
describe('subagent.ts backward-compatible API surface', () => {
  it('should export SubagentTerminateMode as a value', async () => {
    const mod = await import('./subagent.js');
    expect(mod.SubagentTerminateMode).toBeDefined();
    expect(mod.SubagentTerminateMode.GOAL).toBe('GOAL');
  });

  it('should export ContextState as a constructable class', async () => {
    const mod = await import('./subagent.js');
    const ctx = new mod.ContextState();
    ctx.set('k', 'v');
    expect(ctx.get('k')).toBe('v');
  });

  it('should export SubAgentScope as a class with create()', async () => {
    const mod = await import('./subagent.js');
    expect(typeof mod.SubAgentScope.create).toBe('function');
  });

  it('should export templateString as a function', async () => {
    const mod = await import('./subagent.js');
    expect(typeof mod.templateString).toBe('function');
  });
});

/**
 * Additive API surface — new exports introduced by decomposition.
 * Expected to land in Phase 1. Non-blocking if landed later.
 */
describe('subagent.ts additive API surface', () => {
  it('should export defaultEnvironmentContextLoader as a function', async () => {
    const mod = await import('./subagent.js');
    expect(typeof mod.defaultEnvironmentContextLoader).toBe('function');
  });
});
```

### subagentApiCompat.typecheck.ts (compile-time canary fixture)

NOT a test file — a TypeScript file that must compile but never runs. Place at `packages/core/src/core/__tests__/subagentApiCompat.typecheck.ts`:

```typescript
/**
 * Compile-time canary for subagent.ts type exports.
 * This file must compile without errors. It is never executed.
 * If a type re-export is dropped, tsc will fail on this file.
 */

// --- Backward-compatible type exports (must always compile) ---
import type {
  OutputObject,
  PromptConfig,
  ToolConfig,
  OutputConfig,
  SubAgentRuntimeOverrides,
  ModelConfig,
  RunConfig,
} from '../subagent.js';
import { SubAgentScope, ContextState, SubagentTerminateMode } from '../subagent.js';

const _config: ModelConfig = {} as ModelConfig;
const _prompt: PromptConfig = {} as PromptConfig;
const _run: RunConfig = {} as RunConfig;
const _tool: ToolConfig = {} as ToolConfig;
const _output: OutputConfig = {} as OutputConfig;
const _overrides: SubAgentRuntimeOverrides = {} as SubAgentRuntimeOverrides;
const _outputObj: OutputObject = {} as OutputObject;
const _scope: SubAgentScope = {} as SubAgentScope;
const _ctx: ContextState = new ContextState();
const _mode: SubagentTerminateMode = SubagentTerminateMode.GOAL;

void _config; void _prompt; void _run; void _tool; void _output;
void _overrides; void _outputObj; void _scope; void _ctx; void _mode;

// --- Additive type exports (uncomment in Phase 1 when available) ---
// import type { EnvironmentContextLoader } from '../subagent.js';
// import { defaultEnvironmentContextLoader } from '../subagent.js';
// const _envLoader: EnvironmentContextLoader = {} as EnvironmentContextLoader;
// const _defaultLoader = defaultEnvironmentContextLoader;
// void _envLoader; void _defaultLoader;
```

### subagentTypes.test.ts

```typescript
describe.skip('subagentTypes (enable in Phase 1)', () => {
  describe('ContextState', () => {
    it('should set and get values correctly');
    it('should return undefined for missing keys');
    it('should return all keys via get_keys()');
    it('should return empty array for empty state via get_keys()');
    it('should handle overwriting existing keys');
  });

  describe('templateString', () => {
    // Note: templateString uses ${var} syntax (dollar-brace), NOT {{var}}
    it('should replace ${var} tokens with context values');
    it('should handle multiple ${var} tokens in one string');
    it('should throw when a required variable key is missing from context');
    it('should handle empty context with no tokens in template');
    it('should return template unchanged when it contains no ${} tokens');
    it('should handle adjacent tokens like ${a}${b} correctly');
  });

  describe('SubagentTerminateMode', () => {
    it('should have the expected enum values');
  });
});
```

### subagentRuntimeSetup.test.ts

```typescript
describe.skip('subagentRuntimeSetup (enable in Phase 2)', () => {
  describe('convertMetadataToFunctionDeclaration', () => {
    it('should convert tool metadata to FunctionDeclaration with fallbackName and description');
    it('should include parameters schema when present');
    it('should handle metadata without parameters');
  });

  describe('validateToolsAgainstRuntime', () => {
    it('should pass when all whitelisted tools exist in registry');
    it('should warn and filter when whitelisted tool not found');
    it('should pass with empty whitelist (allow all)');
  });

  describe('createToolExecutionConfig', () => {
    it('should build config from runtime context');
    it('should apply tool whitelist restrictions');
    it('should include ephemeral settings');
  });

  describe('buildEphemeralSettings', () => {
    it('should merge model overrides into base settings');
    it('should handle empty overrides');
  });

  describe('buildChatGenerationConfig', () => {
    it('should set temperature from modelConfig');
    it('should set maxOutputTokens from modelConfig');
    it('should set topP and topK when provided');
    it('should handle defaults when optional fields missing');
  });

  describe('buildRuntimeFunctionDeclarations', () => {
    it('should map all registry metadata to declarations');
    it('should filter based on tool whitelist');
    it('should handle empty registry');
  });

  describe('getScopeLocalFuncDefs', () => {
    it('should return self_emitvalue declaration with output keys as enum');
    it('should return empty array when no outputs defined');
  });

  describe('buildChatSystemPrompt', () => {
    it('should combine core system prompt with behaviour prompts');
    it('should handle empty behaviour prompts');
  });

  describe('buildSchedulerConfig', () => {
    it('should create Config with correct model and run settings');
  });

  describe('applySchedulerToolRestrictions', () => {
    it('should apply whitelist to scheduler config');
    it('should handle no restrictions');
  });
});
```

### subagentToolProcessing.test.ts

```typescript
describe.skip('subagentToolProcessing (enable in Phase 3)', () => {
  // --- Behavioral tests (blocking — test public API) ---
  describe('processFunctionCalls', () => {
    it('should route self_emitvalue calls to emit handling');
    it('should route external tool calls to execution');
    it('should produce fallback message when all calls fail');
  });

  describe('handleEmitValueCall', () => {
    it('should store emitted variable in output object');
    it('should return functionResponse confirming storage');
    it('should handle multiple emissions');
    it('should reject emission for undefined output keys');
  });

  describe('buildPartsFromCompletedCalls', () => {
    it('should produce functionResponse parts for each completed call');
    it('should not call onMessage for tools with canUpdateOutput=true');
    it('should call onMessage for tools with canUpdateOutput=false');
    it('should call onMessage for error calls even with canUpdateOutput=true');
    it('should produce functionResponse-only parts for error calls');
  });

  describe('resolveToolName', () => {
    it('should match exact tool name from registry');
    it('should match lowercased tool name');
    it('should strip Tool suffix and match');
    it('should convert camelCase to snake_case and match');
    it('should return null when no candidate matches registry');
    it('should return null for empty/undefined input');
  });

  describe('buildToolUnavailableMessage', () => {
    it('should produce descriptive error message with tool name');
    it('should include resultDisplay detail when available');
    it('should include error message when available');
  });

  // --- Helper unit tests (add only if exported; skip until API settled) ---
  // These target small functions (<10 lines) that may be inlined.
  // If inlined, verify behavior through the public functions above instead.
  describe.skip('helper unit tests (enable if exported)', () => {
    describe('categorizeToolCall', () => {
      it('should return emit for self_emitvalue calls');
      it('should return external for any other tool name');
    });

    describe('isFatalToolError', () => {
      it('should return true for TOOL_DISABLED error type');
      it('should return true for TOOL_NOT_REGISTERED error type');
      it('should return false for other error types');
      it('should return false for undefined');
    });

    describe('toSnakeCase', () => {
      it('should convert camelCase to snake_case');
      it('should convert PascalCase to snake_case');
      it('should handle already snake_case');
    });

    describe('extractToolDetail', () => {
      it('should extract detail string from resultDisplay');
      it('should extract detail from error when no resultDisplay');
      it('should return undefined when neither available');
    });
  });
});
```

### subagentExecution.test.ts

```typescript
describe.skip('subagentExecution (enable in Phase 4)', () => {
  describe('filterTextResponse', () => {
    it('should pass through text when no emoji filter');
    it('should filter emojis when emoji filter is active');
    it('should return blocked=true for fully blocked content');
    it('should include system feedback when content modified');
  });

  describe('checkGoalCompletion', () => {
    it('should return complete=true when all outputs emitted');
    it('should return remaining vars when not all emitted');
    it('should return complete=true when no outputs configured');
  });

  describe('checkTerminationConditions', () => {
    it('should return MAX_TURNS when turn counter exceeds max_turns');
    it('should return TIMEOUT when elapsed time exceeds max_time_minutes');
    it('should return null when neither limit exceeded');
    it('should check turns before timeout');
    it('should handle undefined max_turns (no limit)');
  });

  describe('buildMissingOutputsNudge', () => {
    it('should produce nudge listing missing variables');
    it('should return null when all outputs emitted');
    it('should return null when no outputs configured');
    it('should list only missing variables, not already-emitted ones');
  });

  describe('buildTodoCompletionPrompt', () => {
    it('should produce prompt when todos are incomplete');
    it('should return null when all todos complete');
    it('should return null when no todos exist');
  });

  describe('finalizeOutput', () => {
    it('should set terminate_reason to GOAL when all required outputs emitted');
    it('should not change terminate_reason when outputs are missing');
    it('should set GOAL when no outputs are configured');
  });

  describe('buildInitialMessages', () => {
    it('should produce user message from promptConfig.initialMessages');
    it('should produce message from goal_prompt');
    it('should handle behaviour_prompts concatenation');
  });
});
```

## Test Migration Strategy

1. **Phase 0:** Create all new test files with `describe.skip` on the top-level describe block (except `subagentApiCompat.test.ts` which is always active). Tests compile but are not executed. CI stays green.
2. **Phase 1-4:** Each phase begins by removing `.skip` from that phase's test file and running the tests to confirm they FAIL (red). This is the mandatory first step before any production code is written. Only then does the implementer create the module and make tests pass (green). The reviewer must verify this sequence was followed.
3. **Phase 5:** Deduplicate — the ContextState tests in `subagent.test.ts` can be kept (they test the re-export path) or removed in favor of `subagentTypes.test.ts`.

## Coverage Verification

### Script: `scripts/compare-coverage.sh`

Commit this script in Phase 0:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/compare-coverage.sh <baseline.json> <current.json>
# Both files are vitest coverage-summary.json format.
# Exit 0 if within tolerance, exit 1 if regression detected.

BASELINE="${1:?Usage: compare-coverage.sh <baseline.json> <current.json>}"
CURRENT="${2:?Usage: compare-coverage.sh <baseline.json> <current.json>}"
TOLERANCE=1  # percentage points

extract() {
  local file="$1" metric="$2"
  if [ ! -f "$file" ]; then echo "ERROR: Coverage file not found: $file" >&2; exit 1; fi
  node --input-type=module -e "
    import { readFileSync } from 'node:fs';
    const data = JSON.parse(readFileSync('$file', 'utf-8'));
    const TARGET_BASENAMES = ['subagent.ts','subagentTypes.ts','subagentRuntimeSetup.ts','subagentToolProcessing.ts','subagentExecution.ts'];
    const files = Object.keys(data).filter(f => TARGET_BASENAMES.some(t => f.endsWith('/core/' + t)));
    let covered = 0, total = 0;
    for (const f of files) {
      covered += data[f]['${metric}'].covered;
      total += data[f]['${metric}'].total;
    }
    console.log(total === 0 ? 100 : ((covered / total) * 100).toFixed(2));
  "
}

for metric in lines branches; do
  baseline_val=$(extract "$BASELINE" "$metric")
  current_val=$(extract "$CURRENT" "$metric")
  diff=$(node -e "console.log(($baseline_val - $current_val).toFixed(2))")
  if (( $(echo "$diff > $TOLERANCE" | bc -l) )); then
    echo "FAIL: $metric coverage dropped by ${diff}pp (${baseline_val}% → ${current_val}%)"
    exit 1
  fi
  echo "OK: $metric coverage ${current_val}% (baseline: ${baseline_val}%, delta: -${diff}pp)"
done
```

### Workflow

**Phase 0 — Capture baseline:**
```bash
npx vitest run --coverage.enabled --coverage.reporter=json-summary \
  packages/core/src/core/subagent.test.ts 2>/dev/null
cp packages/core/coverage/coverage-summary.json project-plans/issue1581/baseline-coverage.json
```

**Phase 5 — Compare:**
```bash
npx vitest run --coverage.enabled --coverage.reporter=json-summary \
  packages/core/src/core/subagent*.test.ts 2>/dev/null
./scripts/compare-coverage.sh \
  project-plans/issue1581/baseline-coverage.json \
  packages/core/coverage/coverage-summary.json
```

### Pass/fail criteria:
- **Line coverage:** Combined coverage across all `subagent*.ts` files must be within 1pp of baseline. More than 1pp drop requires investigation.
- **Branch coverage:** Same 1pp tolerance.
- **Per-module minimum:** No individual module file below 60% line coverage (checked in json-summary output).
- **Artifacts:** Include both sets of numbers in the Phase 5 PR description.
