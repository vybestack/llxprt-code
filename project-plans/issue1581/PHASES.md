# Implementation Phases — Issue #1581

> **Single source of truth:** If any detail in this file conflicts with `README.md`, the README takes precedence.

> **Note on line numbers:** Line numbers referenced below are approximate references to the current `subagent.ts` (2,118 lines as of plan creation). Use symbol names (function/class/interface names) as the authoritative locators, not line numbers. Search for the declaration rather than jumping to a line.

## Phase 0: Test Infrastructure (test-first)

**Goal:** Establish test scaffolds for the functions we're about to extract, BEFORE moving any code. New test files use `describe.skip` at the top level to keep CI green until their module is created. The skip is removed at the START of each phase (before any production code is written), making the TDD cycle explicit: unskip → red → implement → green.

### 0a: Create subagentTypes.test.ts
Write unit tests (wrapped in `describe.skip('subagentTypes (enable in Phase 1)', ...)`) for:
- `ContextState.get()` / `ContextState.set()` / `ContextState.get_keys()` behavior
- `templateString()` with `${var}` substitution (dollar-brace syntax), missing vars, edge cases

These tests currently live inside `subagent.test.ts` under the `ContextState` describe block. **Copy** (don't move yet) the relevant tests to the new file, importing from `./subagentTypes.js`.

### 0b: Create subagentRuntimeSetup.test.ts
Write unit tests (wrapped in `describe.skip('subagentRuntimeSetup (enable in Phase 2)', ...)`) for standalone functions that will be extracted:
- `convertMetadataToFunctionDeclaration` — given fallbackName + tool metadata, returns correct FunctionDeclaration
- `validateToolsAgainstRuntime` — validates tool whitelist against available tools, warns on missing
- `createToolExecutionConfig` — builds correct ToolExecutionConfig from runtime context
- `buildEphemeralSettings` — merges model overrides into settings correctly
- `buildChatGenerationConfig` — produces correct GenerateContentConfig from ModelConfig
- `buildRuntimeFunctionDeclarations` — maps registry metadata to declarations
- `getScopeLocalFuncDefs` — produces self_emitvalue declaration when outputs defined
- `buildChatSystemPrompt` — combines core prompt with behaviour prompts
- `buildSchedulerConfig` — produces correct Config for scheduler
- `applySchedulerToolRestrictions` — applies whitelist correctly

### 0c: Create subagentToolProcessing.test.ts
Write unit tests (wrapped in `describe.skip('subagentToolProcessing (enable in Phase 3)', ...)`) for public API functions:
- `processFunctionCalls` — routes emit calls vs external, produces fallback on failure
- `handleEmitValueCall` — stores emitted variable, returns confirmation, rejects undefined keys
- `buildPartsFromCompletedCalls` — deduplicates output, handles errors, canUpdateOutput behavior
- `resolveToolName` — matches against registry via exact, lowercase, suffix-strip, snake_case candidates
- `buildToolUnavailableMessage` — produces descriptive error message with tool name

**Implementation-flexibility note:** Tests for functions under 10 lines that the plan flags as potential inline candidates (`categorizeToolCall`, `isFatalToolError`, `toSnakeCase`, `extractToolDetail`) should be written as behavioral tests through the public functions that call them (e.g., test `processFunctionCalls` with an emit-value call to verify categorization, rather than testing `categorizeToolCall` directly). Only add direct unit tests for these helpers IF they are ultimately exported. This prevents test churn if they are inlined during implementation.

### 0d: Create subagentExecution.test.ts
Write unit tests (wrapped in `describe.skip('subagentExecution (enable in Phase 4)', ...)`) for:
- `filterTextResponse` — emoji filtering, blocked content, passthrough
- `checkGoalCompletion` — complete/incomplete goal checking
- `checkTerminationConditions` — MAX_TURNS, TIMEOUT, null (continue)
- `buildMissingOutputsNudge` — produces nudge content when vars missing, null when complete
- `buildTodoCompletionPrompt` — produces prompt when todos incomplete, null when done
- `finalizeOutput` — sets terminate_reason to GOAL when all outputs met
- `buildInitialMessages` — produces correct Content[] from prompt config

### 0e: Create subagentApiCompat.test.ts (NOT skipped — runtime canary)
Write an API-surface compatibility test with two describe blocks:
1. **Backward-compatible surface (blocking):** `SubagentTerminateMode`, `ContextState`, `SubAgentScope`, `templateString` — must pass at all times.
2. **Additive surface (non-blocking):** `defaultEnvironmentContextLoader` — expected in Phase 1 but failure does not block earlier phases.

Additionally, create `packages/core/src/core/__tests__/subagentApiCompat.typecheck.ts` — a compile-time canary that imports every type symbol and value symbol from `../subagent.js` and uses them in typed positions. Separate backward-compat imports (blocking) from additive imports (can be commented out until Phase 1). This file must pass `npm run typecheck` but is never executed as a test.

### 0f: Add ESLint size and boundary constraints
Add config blocks in `eslint.config.js` (following the existing Issue #1577 pattern):

```javascript
// Issue #1581: subagent.ts decomposition - Size enforcement
{
  files: [
    'packages/core/src/core/subagentTypes.ts',
    'packages/core/src/core/subagentRuntimeSetup.ts',
    'packages/core/src/core/subagentToolProcessing.ts',
    'packages/core/src/core/subagentExecution.ts',
    'packages/core/src/core/subagent.ts',
  ],
  rules: {
    'max-lines': ['error', { max: 800, skipBlankLines: true, skipComments: true }],
    'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }],
  },
},
// Issue #1581: Enforce execution → runtimeSetup dependency boundary
{
  files: ['packages/core/src/core/subagentExecution.ts'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: './subagentRuntimeSetup.js',
            message:
              'subagentExecution must not import from subagentRuntimeSetup. '
              + 'All runtime artifacts must be passed as parameters by the coordinator (subagent.ts). '
              + 'See project-plans/issue1581/README.md §Dependency Graph.',
          },
        ],
      },
    ],
  },
},
```

**Note:** The `max-lines-per-function` rule on `subagent.ts` will initially trigger errors since the file hasn't been decomposed yet. Temporarily set it to `warn` for `subagent.ts` during Phase 0, then promote to `error` in Phase 5 once the decomposition is complete.

### 0g: Capture coverage baseline and commit comparison script
```bash
# Capture baseline
npx vitest run --coverage.enabled --coverage.reporter=json-summary \
  packages/core/src/core/subagent.test.ts 2>/dev/null
cp packages/core/coverage/coverage-summary.json project-plans/issue1581/baseline-coverage.json
# Commit scripts/compare-coverage.sh and baseline artifact
```

### 0h: Verify existing tests still pass
```bash
npm run test -- --reporter=verbose packages/core/src/core/subagent.test.ts
npm run test -- --reporter=verbose packages/core/src/core/subagentOrchestrator.test.ts
```
All tests (existing + new skipped + canary) must pass.

---

## Rollback Strategy

Each phase is designed to be independently revertible:

- **Phase 0 (test scaffolds):** Revert all new test files. No production code was changed.
- **Phase 1 (subagentTypes):** Revert `subagentTypes.ts`, remove re-exports from `subagent.ts`, restore the moved definitions. The re-export pattern means `subagent.ts` still has all symbols — `git revert` of the phase commit is clean.
- **Phase 2-4 (extraction phases):** Each phase's extraction is additive (new module file + `subagent.ts` imports from it instead of defining inline). Revert = delete the new module file, restore the inline definitions in `subagent.ts`. The canary test catches any regression from a bad revert.
- **Phase 5 (cleanup):** Revert is trivial — it's only test deduplication and verification.

**Key property:** At no point does an intermediate phase change the public API of `subagent.ts`. Every phase maintains backward compatibility independently. A failed phase can be reverted without affecting other phases' work because the re-export facade in `subagent.ts` absorbs all internal structural changes.

---

## Phase 1: Extract subagentTypes.ts

**Goal:** Create the foundational types module. This is the leaf of the dependency graph.

### Steps:
1. **Unskip tests first (RED):** Remove `.skip` from `subagentTypes.test.ts`. Run `npm run test -- packages/core/src/core/subagentTypes.test.ts` — all tests should FAIL (red) because the module doesn't exist yet. This confirms the tests are wired correctly.
2. Create `packages/core/src/core/subagentTypes.ts`
3. Move from `subagent.ts`:
   - `SubagentTerminateMode` enum
   - `OutputObject` interface
   - `PromptConfig` interface
   - `ToolConfig` interface
   - `OutputConfig` interface
   - `SubAgentRuntimeOverrides` interface
   - `EnvironmentContextLoader` type
   - `defaultEnvironmentContextLoader`
   - `ModelConfig` interface
   - `RunConfig` interface
   - `ContextState` class
   - `templateString` function
4. Delete `ToolExecutionConfigShim` type alias — replace the single usage in the constructor with `ToolExecutionConfig` directly.
5. Add re-exports in `subagent.ts` (authoritative contract — see README.md §Re-exports).
   **Note:** `EnvironmentContextLoader` and `defaultEnvironmentContextLoader` are additive exports. Mention in commit message.
6. Update `subagent.ts` to import from `./subagentTypes.js` instead of defining locally
7. Verify: `npm run test -- packages/core/src/core/subagent.test.ts` — all 41 tests pass
8. Verify: `npm run typecheck` — no type errors (compile-time canary validates type exports)
9. Verify: Phase 0a tests now pass (GREEN)
10. Verify: `subagentApiCompat.test.ts` still passes

---

## Phase 2: Extract subagentRuntimeSetup.ts

**Goal:** Extract all execution environment preparation logic into standalone functions.

### Steps:
1. **Unskip tests first (RED):** Remove `.skip` from `subagentRuntimeSetup.test.ts`. Run tests — should FAIL.
2. Create `packages/core/src/core/subagentRuntimeSetup.ts`
3. Move standalone functions from `subagent.ts`:
   - `convertMetadataToFunctionDeclaration` (2 params: fallbackName, metadata)
   - `validateToolsAgainstRuntime`
   - `createToolExecutionConfig`
   - `buildEphemeralSettings`
   - Rename module-level `normalizeToolName` to `canonicalizeToolName`
4. Extract and convert class methods to standalone functions:
   - `createEmojiFilter(settingsSnapshot)` — parameterize
   - Split `createChatObject` into `buildChatGenerationConfig`, `buildChatToolDeclarations`, `createChatObject(params)` (params includes `mcpInstructions?: string`)
   - `buildRuntimeFunctionDeclarations(toolExecutorContext, toolConfig)` — parameterize
   - `getScopeLocalFuncDefs(outputConfig)` — parameterize
   - `buildChatSystemPrompt(params)` — parameterize
   - Split `createSchedulerConfig` into `buildSchedulerConfig` + `applySchedulerToolRestrictions`
5. Import these in `subagent.ts` and replace inline code with calls
6. Verify: all tests pass (GREEN), Phase 0b tests now pass, canary tests still green
7. Check line count — if `subagentRuntimeSetup.ts` exceeds 500 lines, split scheduler functions

---

## Phase 3: Extract subagentToolProcessing.ts

**Goal:** Extract all tool call dispatch and response handling into standalone functions.

### Steps:
1. **Unskip tests first (RED):** Remove `.skip` from `subagentToolProcessing.test.ts`. Run tests — should FAIL.
2. Create `packages/core/src/core/subagentToolProcessing.ts`
3. Extract and convert class methods to standalone functions:
   - Public API: `processFunctionCalls`, `handleEmitValueCall`, `buildPartsFromCompletedCalls`, `resolveToolName`, `buildToolUnavailableMessage`
   - Internal helpers: `categorizeToolCall`, `executeSingleToolCall`, `buildToolResponseContent`, `toSnakeCase`, `isFatalToolError`, `extractToolDetail`
4. Import these in `subagent.ts` and replace method bodies with calls
5. **Test migration:** Update existing `buildPartsFromCompletedCalls` tests in `subagent.test.ts` — eliminate `(scope as any)` casts now that the function is a public export. Either import from `./subagentToolProcessing.js` directly or keep as integration tests through `SubAgentScope`.
6. Verify: all tests pass (GREEN), Phase 0c tests now pass, canary tests still green

---

## Phase 4: Extract subagentExecution.ts

**Goal:** Extract the turn-by-turn execution loop logic that currently lives inside `runInteractive` and `runNonInteractive`.

### Steps:
1. **Unskip tests first (RED):** Remove `.skip` from `subagentExecution.test.ts`. Run tests — should FAIL.
2. Create `packages/core/src/core/subagentExecution.ts`
3. Define shared types (`TerminationResult`, `TurnResult`, `ExecutionContext` — see README.md §Shared Contracts)
4. **Shared primitives first:** Extract and test `filterTextResponse` and `checkGoalCompletion` before the turn processors.
5. Extract remaining standalone functions: `checkTerminationConditions`, `buildMissingOutputsNudge`, `buildTodoCompletionPrompt`, `finalizeOutput`, `buildInitialMessages`
6. Extract inner loop bodies: `processInteractiveTurnEvents`, `processNonInteractiveTurnEvents`, `handleInteractiveToolCompletion`, `handleNonInteractiveToolCompletion`

   **Critical constraint:** None of the extracted execution functions may import from `subagentRuntimeSetup.ts`. The thin loops in `subagent.ts` call setup functions and pass results to execution helpers.

7. Rewrite `runInteractive` and `runNonInteractive` in `subagent.ts` as thin loops (~70 lines each)
8. Verify: all tests pass (GREEN), Phase 0d tests now pass, canary tests still green

---

## Phase 5: Final Cleanup and Verification

**Goal:** Ensure all acceptance criteria are met and the codebase is clean.

### Steps:
1. **Move ContextState tests:** Move from `subagent.test.ts` to `subagentTypes.test.ts` (or keep both for re-export path coverage)
2. **Promote ESLint rule:** Change `max-lines-per-function` for `subagent.ts` from `warn` to `error`
3. **Verify line counts:**
   ```bash
   wc -l packages/core/src/core/subagentTypes.ts        # target: <200
   wc -l packages/core/src/core/subagentRuntimeSetup.ts  # target: <400
   wc -l packages/core/src/core/subagentToolProcessing.ts # target: <300
   wc -l packages/core/src/core/subagentExecution.ts     # target: <400
   wc -l packages/core/src/core/subagent.ts              # target: <600
   ```
4. **Run full verification suite:**
   ```bash
   npm run test
   npm run lint
   npm run typecheck
   npm run format
   npm run build
   node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
   ```
5. **Verify backward compatibility:** All consumers unchanged, canary tests green
6. **Verify test coverage:** Run `scripts/compare-coverage.sh` against Phase 0 baseline. Include both sets of numbers in PR description.

## Subagent Workflow

Each phase uses the **implementer + reviewer** pattern:

1. **typescriptexpert** (implementer): Implements the phase, runs full verification suite
2. **deepthinker** (reviewer): Reviews the implementation for:
   - Architectural cohesion and module boundary correctness
   - Function parameterization quality (no hidden state dependencies)
   - Backward compatibility preservation
   - Acceptance criteria compliance
   - Test quality and coverage
   - Execution → runtimeSetup dependency constraint
3. Loop between implementer and reviewer until the reviewer is satisfied
4. Move to next phase
