# Issue #1581b: Eliminate Backward-Compatibility Shim from subagent.ts Decomposition

## Problem Statement

The initial decomposition of `subagent.ts` (PR #1779) successfully extracted logic into four modules (`subagentTypes.ts`, `subagentToolProcessing.ts`, `subagentRuntimeSetup.ts`, `subagentExecution.ts`) but left behind a **backward-compatibility shim** — `subagent.ts` still re-exports every type from `subagentTypes.ts`, and `SubAgentScope` retains ~78 lines of pure pass-through delegation stubs like:

```typescript
private processFunctionCalls(...) {
    return processFunctionCalls(..., { this.output, this.subagentId, ... });
}
```

Additionally, `subagentApiCompat.test.ts` (61 lines) and `subagentApiCompat.typecheck.ts` (64 lines) exist solely to test the re-export shim. This is 125 lines of test code defending the wrong thing.

The result: 2,621 total lines across 5 files (up from 2,117) with no consumer actually importing from the canonical module.

## Goal

Migrate all consumers to import directly from the canonical modules. Remove all re-exports and delegation stubs from `subagent.ts`. Delete the compat test files. `subagent.ts` should contain **only** `SubAgentScope` and the code that truly belongs on that class.

## Acceptance Criteria

1. **`subagent.ts` exports only `SubAgentScope`** — the class and nothing else. No re-exports from `subagentTypes.js` or any other subagent module family member.
2. **No re-exports from subagent module family wrappers** — none of `subagentTypes.ts`, `subagentToolProcessing.ts`, `subagentRuntimeSetup.ts`, or `subagentExecution.ts` re-export anything from `subagent.ts`, and `subagent.ts` re-exports nothing from them.
3. **Zero remaining imports of non-`SubAgentScope` symbols from `subagent.js`** — verified by repo-wide grep (see Verification Gates below).
4. **All CI checks pass** — `npm run test`, `npm run typecheck`, `npm run lint`, `npm run format`, `npm run build`, and smoke test.
5. **Package exports unaffected** — `@vybestack/llxprt-code-core` consumers (e.g. `packages/cli`) that import `SubagentTerminateMode` continue to work because `index.ts` is retargeted to `subagentTypes.js`.

## Scope of Changes

### Consumers to migrate (production code)

| File | Currently imports from | Symbols | Migrate to |
|------|----------------------|---------|------------|
| `subagentOrchestrator.ts` | `./subagent.js` | `SubAgentScope`, `ModelConfig`, `PromptConfig`, `RunConfig`, `ToolConfig`, `OutputConfig` | `SubAgentScope` from `./subagent.js`, types from `./subagentTypes.js` |
| `tools/task.ts` | `../core/subagent.js` | `ContextState`, `SubagentTerminateMode`, `type OutputObject`, `type SubAgentScope` | `type SubAgentScope` from `../core/subagent.js`, rest from `../core/subagentTypes.js` |
| `services/asyncTaskManager.ts` | `../core/subagent.js` | `type OutputObject` | `../core/subagentTypes.js` |
| `index.ts` | `./core/subagent.js` | `SubagentTerminateMode` | `./core/subagentTypes.js` |

### Consumers to migrate (test code)

| File | Currently imports from | Symbols | Migrate to |
|------|----------------------|---------|------------|
| `subagent.test.ts` | `./subagent.js` | `ContextState`, `SubAgentScope`, `SubagentTerminateMode`, `PromptConfig`, `ModelConfig`, `RunConfig`, `OutputConfig`, `ToolConfig`, **`SubAgentRuntimeOverrides`** | `SubAgentScope` from `./subagent.js`, all types from `./subagentTypes.js` |
| `__tests__/subagent.stateless.test.ts` | `../subagent.js` | `SubAgentScope`, **`SubAgentRuntimeOverrides`**, `ModelConfig`, `PromptConfig`, `RunConfig`, `OutputObject` (lines 25 and 41-46) | `SubAgentScope` from `../subagent.js`, types from `../subagentTypes.js` |
| `subagentOrchestrator.test.ts` | `./subagent.js` | `SubAgentScope`, `type RunConfig`, `type SubAgentScope` (aliased as `SubAgentScopeInstance`) | `SubAgentScope` + `type SubAgentScope as SubAgentScopeInstance` from `./subagent.js`, `type RunConfig` from `./subagentTypes.js` |
| `tools/task.test.ts` | `../core/subagent.js` | `ContextState`, `SubagentTerminateMode` | `../core/subagentTypes.js` |
| `services/asyncTaskReminderService.test.ts` | `../core/subagent.js` | `type OutputObject` | `../core/subagentTypes.js` |

> **NOTE:** The original plan listed exactly 4 production + 4 test files. Source verification revealed a **5th test file**: `services/asyncTaskReminderService.test.ts` (line 14: `import type { OutputObject } from '../core/subagent.js'`). This is now included.

### SubAgentRuntimeOverrides mapping

`SubAgentRuntimeOverrides` is an interface defined in `subagentTypes.ts` and is heavily used in tests:

| File | Import line(s) | Current source | Migrated source |
|------|---------------|---------------|-----------------|
| `subagent.ts` (internal import) | L91 | `./subagentTypes.js` | unchanged (internal) |
| `subagent.ts` (re-export) | L74 | `./subagentTypes.js` | **DELETED** |
| `subagent.test.ts` | L17 | `./subagent.js` | `./subagentTypes.js` |
| `__tests__/subagent.stateless.test.ts` | L45 | `../subagent.js` | `../subagentTypes.js` |
| `__tests__/subagentApiCompat.typecheck.ts` | L24 | `../subagent.js` | **FILE DELETED** |

### Files to delete

| File | Reason |
|------|--------|
| `subagentApiCompat.test.ts` | Tests re-export shim that will no longer exist |
| `__tests__/subagentApiCompat.typecheck.ts` | Tests re-export shim types |

### What stays in `subagent.ts`

After migration, `subagent.ts` should contain only:
1. `SubAgentScope` class definition
2. Imports it needs from the other modules (internal use only)
3. `export { SubAgentScope }` — the **only** export

The delegation stubs (lines 716-793) will be removed. The methods they wrap are already called by the class's substantive methods (`runInteractive`, `runNonInteractive`, `handleInteractiveToolCalls`, etc.) — the stubs only existed because the class wanted to maintain a "method call" syntax for what are now module-level functions. After removing the stubs, the call sites in the substantive methods will call the imported functions directly (which some already do — e.g., `checkTerminationConditions`, `filterTextWithEmoji`, `handleExecutionError`).

### What changes in `subagent.ts` class body

Currently, some methods call imported functions directly (good):
```typescript
const check = checkTerminationConditions(turnCounter, startTime, execCtx);
```

But others go through pointless delegation stubs (bad):
```typescript
this.finalizeOutput();  // calls finalizeOutput(this.output)
this.processFunctionCalls(...)  // calls processFunctionCalls(..., {this.output, ...})
```

After remediation, ALL calls use the imported functions directly:
```typescript
finalizeOutput(this.output);
processFunctionCalls(functionCalls, abortController, promptId, {
  output: this.output, subagentId: this.subagentId, ...
});
```

## Delegation Stub Removal — Complete Call-Site Checklist

The 9 delegation stubs to remove (lines 716-793) and every call site that must be inlined:

### Stub 1: `this.processFunctionCalls(functionCalls, abortController, promptId)` (L716-729)
**Wraps:** `processFunctionCalls(functionCalls, abortController, promptId, { output: this.output, subagentId: this.subagentId, logger: this.logger, toolExecutorContext: this.toolExecutorContext, config: this.config, messageBus: this.messageBus })`
**Call sites in:**
- `runNonInteractive` — L572: `currentMessages = await this.processFunctionCalls(functionCalls, abortController, promptId);`

### Stub 2: `this.createSchedulerConfig(options)` (L731-737)
**Wraps:** `createSchedulerConfig(this.toolExecutorContext, this.config, options)`
**Call sites in:**
- `initScheduler` — L386: `schedulerConfig: this.createSchedulerConfig({ interactive: true }),`

### Stub 3: `this.finalizeOutput()` (L739-741)
**Wraps:** `finalizeOutput(this.output)`
**Call sites in:**
- `runInteractive` — L372: `this.finalizeOutput();`
- `runInteractive` catch block — L375: `this.finalizeOutput();`
- `runNonInteractive` — L588: `this.finalizeOutput();`
- `runNonInteractive` catch block — L591: `this.finalizeOutput();`

### Stub 4: `this.handleEmitValueCall(request)` (L743-750)
**Wraps:** `handleEmitValueCall(request, { output: this.output, onMessage: this.onMessage, subagentId: this.subagentId, logger: this.logger })`
**Call sites in:**
- `handleInteractiveToolCalls` — L453: `manualParts.push(...this.handleEmitValueCall(request));`

### Stub 5: `this.buildPartsFromCompletedCalls(completedCalls)` (L752-760)
**Wraps:** `buildPartsFromCompletedCalls(completedCalls, { onMessage: this.onMessage, subagentId: this.subagentId, logger: this.logger })`
**Call sites in:**
- `handleInteractiveToolCalls` — L465-466: `responseParts = responseParts.concat(this.buildPartsFromCompletedCalls(completedCalls));`

### Stub 6: `this.buildTodoCompletionPrompt()` (L762-768)
**Wraps:** `buildTodoCompletionPrompt(this.runtimeContext, this.subagentId, this.logger)`
**Call sites in:**
- `runInteractive` — L363: `const todoReminder = await this.buildTodoCompletionPrompt();`
- `runNonInteractive` — L578: `const todoReminder = await this.buildTodoCompletionPrompt();`

### Stub 7: `this.createChatObject(context)` (L770-782)
**Wraps:** `createChatObject({ promptConfig: this.promptConfig, modelConfig: this.modelConfig, outputConfig: this.outputConfig, toolConfig: this.toolConfig, runtimeContext: this.runtimeContext, contentGenerator: this.contentGenerator, environmentContextLoader: this.environmentContextLoader, foregroundConfig: this.config, context })`
**Call sites in:**
- `prepareRun` — L271: `const chat = await this.createChatObject(context);`

### Stub 8: `this.buildRuntimeFunctionDeclarations()` (L784-789)
**Wraps:** `buildRuntimeFunctionDeclarations(this.runtimeContext.tools, this.toolConfig)`
**Call sites in:**
- `prepareRun` — L279: `const functionDeclarations = this.buildRuntimeFunctionDeclarations();`

### Stub 9: `this.getScopeLocalFuncDefs()` (L791-793)
**Wraps:** `getScopeLocalFuncDefs(this.outputConfig)`
**Call sites in:**
- `prepareRun` — L281: `functionDeclarations.push(...this.getScopeLocalFuncDefs());`

### Summary by calling method

| Method | Stubs called | Lines |
|--------|-------------|-------|
| `prepareRun` | `createChatObject`, `buildRuntimeFunctionDeclarations`, `getScopeLocalFuncDefs` | L271, L279, L281 |
| `runInteractive` | `buildTodoCompletionPrompt`, `finalizeOutput` (×2) | L363, L372, L375 |
| `initScheduler` | `createSchedulerConfig` | L386 |
| `handleInteractiveToolCalls` | `handleEmitValueCall`, `buildPartsFromCompletedCalls` | L453, L465-466 |
| `runNonInteractive` | `processFunctionCalls`, `buildTodoCompletionPrompt`, `finalizeOutput` (×2) | L572, L578, L588, L591 |

## vi.mock / jest.mock Search Results and Mitigation

### Search results

Repo-wide search for `vi.mock(.*subagent` and `jest.mock(.*subagent` found exactly **1 match**:

```
packages/core/src/providers/anthropic/AnthropicProvider.mediaBlock.test.ts
L89: vi.mock('../../prompt-config/subagent-delegation.js', () => ({
```

This mocks `subagent-delegation.js` (a completely unrelated module in `prompt-config/`), **NOT** `core/subagent.js`. No test file uses `vi.mock` or `jest.mock` targeting `core/subagent.js`.

### Mitigation

**No mock path updates needed.** None of the consumer test files mock `subagent.js` — they import symbols directly and construct test doubles inline. The plan is safe from mock-path breakage.

## Implementation Plan

### Phase 0: Pre-migration verification gate

**Purpose:** Establish baseline of all imports from `subagent.js` before making changes, confirming the complete consumer list.

1. Run repo-wide grep: `grep -rn "from ['\"].*subagent\.js['\"]" packages/ --include='*.ts' --include='*.tsx' | grep -v node_modules`
2. Confirm the consumer list matches exactly the files listed in this plan (4 production, 5 test, 2 compat files to delete, plus internal subagent family imports)
3. Run repo-wide grep for `vi.mock.*subagent\|jest.mock.*subagent` and confirm only the `subagent-delegation.js` mock exists
4. Run `npm run typecheck` and `npm run test` to establish green baseline

### Phase 1: Migrate all import paths

Update every consumer to import types from `subagentTypes.js` and `SubAgentScope` from `subagent.js`. This is a mechanical search-and-replace across **10 files** (5 production, 5 test).

**Specific changes:**

1. **`subagentOrchestrator.ts`** (L13-20) — Split the import:
   ```typescript
   // Before
   import { SubAgentScope, type ModelConfig, type PromptConfig, type RunConfig, type ToolConfig, type OutputConfig } from './subagent.js';
   // After
   import { SubAgentScope } from './subagent.js';
   import type { ModelConfig, PromptConfig, RunConfig, ToolConfig, OutputConfig } from './subagentTypes.js';
   ```

2. **`tools/task.ts`** (L18-23) — Split the import:
   ```typescript
   // Before
   import { ContextState, SubagentTerminateMode, type OutputObject, type SubAgentScope } from '../core/subagent.js';
   // After
   import type { SubAgentScope } from '../core/subagent.js';
   import { ContextState, SubagentTerminateMode, type OutputObject } from '../core/subagentTypes.js';
   ```

3. **`services/asyncTaskManager.ts`** (L14) — Retarget:
   ```typescript
   // Before
   import type { OutputObject } from '../core/subagent.js';
   // After
   import type { OutputObject } from '../core/subagentTypes.js';
   ```

4. **`index.ts`** (L64) — Retarget:
   ```typescript
   // Before
   export { SubagentTerminateMode } from './core/subagent.js';
   // After
   export { SubagentTerminateMode } from './core/subagentTypes.js';
   ```

5. **`subagent.test.ts`** (L8-18) — Split the import (keep SubAgentScope from `subagent.js`, move `ContextState`, `SubagentTerminateMode`, `PromptConfig`, `ModelConfig`, `RunConfig`, `OutputConfig`, `ToolConfig`, `SubAgentRuntimeOverrides` to `subagentTypes.js`)

6. **`__tests__/subagent.stateless.test.ts`** (L25 and L41-46) — Split:
   - L25: keep `import { SubAgentScope } from '../subagent.js'`
   - L41-46: change to `import type { PromptConfig, ModelConfig, RunConfig, SubAgentRuntimeOverrides } from '../subagentTypes.js'`

7. **`subagentOrchestrator.test.ts`** (L13-17) — Split:
   - Keep `SubAgentScope` (value) AND `type SubAgentScope as SubAgentScopeInstance` from `./subagent.js`
   - Move only `type RunConfig` to `./subagentTypes.js`
   - Note: `SubAgentScope` is imported both as a value (L14) and as a type alias `SubAgentScopeInstance` (L16). **Both must stay as imports from `./subagent.js`** because `SubAgentScope` is a class defined in `subagent.ts`, NOT in `subagentTypes.ts`. The type-only import `type SubAgentScope as SubAgentScopeInstance` is used to type local variables (e.g., `runtimeContext` in `createRuntimeBundle`) and must reference the class from its canonical location.
   ```typescript
   // Before
   import {
     SubAgentScope,
     type RunConfig,
     type SubAgentScope as SubAgentScopeInstance,
   } from './subagent.js';
   // After
   import {
     SubAgentScope,
     type SubAgentScope as SubAgentScopeInstance,
   } from './subagent.js';
   import type { RunConfig } from './subagentTypes.js';
   ```

8. **`tools/task.test.ts`** (L11) — Retarget:
   ```typescript
   // Before
   import { ContextState, SubagentTerminateMode } from '../core/subagent.js';
   // After
   import { ContextState, SubagentTerminateMode } from '../core/subagentTypes.js';
   ```

9. **`services/asyncTaskReminderService.test.ts`** (L14) — Retarget:
   ```typescript
   // Before
   import type { OutputObject } from '../core/subagent.js';
   // After
   import type { OutputObject } from '../core/subagentTypes.js';
   ```

### Phase 2: Remove re-exports and delegation stubs from subagent.ts

1. **Delete the entire re-export block** (lines 61-80):
   ```typescript
   // DELETE all of these:
   export { SubagentTerminateMode, ContextState, templateString } from './subagentTypes.js';
   export type { OutputObject, PromptConfig, ToolConfig, OutputConfig, SubAgentRuntimeOverrides, ModelConfig, RunConfig } from './subagentTypes.js';
   export { defaultEnvironmentContextLoader } from './subagentTypes.js';
   export type { EnvironmentContextLoader } from './subagentTypes.js';
   ```

2. **Inline the 9 delegation stubs** (lines 716-793) at their call sites per the call-site checklist above. Replace every `this.<stub>()` with the direct function call, passing the necessary `this.*` fields as arguments. The functions are already imported at the top of the file.

3. **Trim the internal imports block** (lines 82-95) to only what `SubAgentScope` actually needs internally. After removing re-exports:
   - Keep: `SubagentTerminateMode` (used in class body for `output.terminate_reason`), `ContextState` (parameter type in methods), `defaultEnvironmentContextLoader` (used in `create()`), and all types needed by the class (`OutputObject`, `PromptConfig`, `ToolConfig`, `OutputConfig`, `SubAgentRuntimeOverrides`, `EnvironmentContextLoader`, `ModelConfig`, `RunConfig`)
   - Actually all internal imports remain needed — just remove the re-export block above them.

   > **Note:** `npm run typecheck` and `npm run lint` are the definitive checks for unused imports after re-export removal, not manual verification. If the compiler and linter pass, the import cleanup is correct.

### Phase 3: Delete compat test files

1. Delete `packages/core/src/core/subagentApiCompat.test.ts`
2. Delete `packages/core/src/core/__tests__/subagentApiCompat.typecheck.ts`

### Phase 4: Verify

#### Standard verification suite
1. `npm run typecheck` — confirm no broken imports
2. `npm run test` — confirm all tests pass
3. `npm run lint` — confirm no lint issues
4. `npm run format` — confirm formatting
5. `npm run build` — confirm build succeeds
6. `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"` — smoke test

#### Post-change structural assertions

7. **Comprehensive import audit — all imports from subagent.js:**
   ```bash
   # Step 1: Find ALL imports from subagent.js across the repo
   grep -rn "from ['\"].*subagent\.js['\"]" packages/ --include='*.ts' --include='*.tsx' | grep -v node_modules | grep -v '/subagentTypes\.\|/subagentToolProcessing\.\|/subagentRuntimeSetup\.\|/subagentExecution\.\|/subagentOrchestrator\.\|/subagentScheduler\.\|/subagent-delegation\.\|/subagentApiCompat\.'
   ```
   This surfaces every import from `subagent.js` that is NOT an internal subagent-module-family import. Validate each line:
   - **Allowed:** `import { SubAgentScope }`, `import type { SubAgentScope }`, `import { SubAgentScope, type SubAgentScope as ... }`
   - **Forbidden:** any other named symbol (`ContextState`, `SubagentTerminateMode`, `OutputObject`, `PromptConfig`, `ModelConfig`, `RunConfig`, `ToolConfig`, `OutputConfig`, `SubAgentRuntimeOverrides`, `EnvironmentContextLoader`, `defaultEnvironmentContextLoader`, `templateString`, etc.)

   ```bash
   # Step 2: Verify that every remaining import from subagent.js imports ONLY SubAgentScope
   grep -rn "from ['\"].*\/subagent\.js['\"]" packages/ --include='*.ts' --include='*.tsx' | grep -v node_modules | grep -v '/subagentTypes\.\|/subagentToolProcessing\.\|/subagentRuntimeSetup\.\|/subagentExecution\.\|/subagentOrchestrator\.\|/subagentScheduler\.\|/subagent-delegation\.\|/subagentApiCompat\.' | grep -vE 'import\s+(type\s+)?\{\s*(SubAgentScope|type SubAgentScope)\s*(,\s*type SubAgentScope\s*(as\s+\w+)?)?\s*\}'
   ```
   Expected: **zero matches**. If any line appears, it contains an illegal non-SubAgentScope import from `subagent.js`.

8. **Dynamic import and string-literal reference check:**
   ```bash
   # Check for dynamic imports of subagent.js (not subagentTypes, subagentExecution, etc.)
   grep -rn "import(['\"].*\/subagent\.js['\"])" packages/ --include='*.ts' --include='*.tsx' | grep -v node_modules | grep -v '/subagentTypes\.\|/subagentToolProcessing\.\|/subagentRuntimeSetup\.\|/subagentExecution\.\|/subagentOrchestrator\.\|/subagentScheduler\.\|/subagent-delegation\.'
   # Check for string-literal references that might bypass static imports
   grep -rn "require(['\"].*\/subagent\.js['\"])" packages/ --include='*.ts' --include='*.tsx' | grep -v node_modules
   ```
   Expected: zero matches for both. No dynamic imports or require() calls referencing `subagent.js` should exist.

9. **Verify subagent.ts export surface:**
   ```bash
   grep "^export " packages/core/src/core/subagent.ts
   ```
   Expected: exactly one line: `export class SubAgentScope {` (or equivalent)

10. **Verify no re-exports from subagent module family wrappers:**
    ```bash
    grep -n "export.*from.*subagentTypes\|export.*from.*subagentToolProcessing\|export.*from.*subagentRuntimeSetup\|export.*from.*subagentExecution" packages/core/src/core/subagent.ts
    ```
    Expected: zero matches.

11. **Verify delegation stubs are fully removed (no private wrapper methods remain):**
    ```bash
    grep -n "private\s\+\(processFunctionCalls\|createSchedulerConfig\|finalizeOutput\|handleEmitValueCall\|buildPartsFromCompletedCalls\|buildTodoCompletionPrompt\|createChatObject\|buildRuntimeFunctionDeclarations\|getScopeLocalFuncDefs\)" packages/core/src/core/subagent.ts
    ```
    Expected: **zero matches**. All 9 delegation stubs must be removed; the module-level functions are called directly from the substantive methods.

11b. **Verify no stale `this.<stub>()` call sites remain:**
     ```bash
     grep -nE 'this\.(processFunctionCalls|createSchedulerConfig|finalizeOutput|handleEmitValueCall|buildPartsFromCompletedCalls|buildTodoCompletionPrompt|createChatObject|buildRuntimeFunctionDeclarations|getScopeLocalFuncDefs)\b' packages/core/src/core/subagent.ts
     ```
     Expected: **zero matches**. After stub removal, all call sites must use the imported module-level functions directly (e.g., `finalizeOutput(this.output)` not `this.finalizeOutput()`).

12. **API surface verification — package exports:**
    ```bash
    # Confirm @vybestack/llxprt-code-core still exports SubagentTerminateMode
    grep "SubagentTerminateMode" packages/core/src/index.ts
    ```
    Expected: `export { SubagentTerminateMode } from './core/subagentTypes.js'`

    Then verify downstream consumers compile:
    ```bash
    cd packages/cli && npx tsc --noEmit
    ```
    The `packages/cli/src/ui/commands/tasksCommand.test.ts` file imports `SubagentTerminateMode` from `@vybestack/llxprt-code-core` — this must continue to work.

13. **Verify `subagent.ts` line count** — Expected: ~680-720 lines (informational, not a gate — compiler/lint are the authority)

14. **Full-file grep of `tools/task.ts`** (1,262 lines, was partially read during planning):
    Verify no remaining imports from `subagent.js` except the `type SubAgentScope` import. Full file has been read and confirmed: the only import from `subagent.js` is at line 18-23, and uses `ContextState`, `SubagentTerminateMode`, `type OutputObject`, `type SubAgentScope`. After migration, only `type SubAgentScope` remains from `subagent.js`.

## Verification Gates

### Pre-migration gate (Phase 0)
- [ ] `grep -rn "from.*subagent\.js" packages/ --include='*.ts' --include='*.tsx' | grep -v node_modules` output matches plan's consumer list
- [ ] `grep -rn "vi\.mock.*subagent\|jest\.mock.*subagent" packages/ --include='*.ts' --include='*.tsx' | grep -v node_modules` shows only `subagent-delegation.js` mock
- [ ] `npm run typecheck && npm run test` passes (green baseline)

### Post-migration gate (after Phase 1)
- [ ] Comprehensive import audit (assertion 7, steps 1-2) — only `SubAgentScope` imports from `subagent.js` remain
- [ ] `npm run typecheck` passes

### Post-stub-removal gate (after Phase 2)
- [ ] `grep "^export " packages/core/src/core/subagent.ts` shows only `SubAgentScope`
- [ ] `grep "from.*subagentTypes\|from.*subagentToolProcessing\|from.*subagentRuntimeSetup\|from.*subagentExecution" packages/core/src/core/subagent.ts | grep "^export"` returns empty
- [ ] Delegation stub removal verified (assertion 11) — zero private wrapper methods for the 9 removed stubs
- [ ] `npm run typecheck` passes

### Post-deletion gate (after Phase 3)
- [ ] `subagentApiCompat.test.ts` and `subagentApiCompat.typecheck.ts` no longer exist
- [ ] Full verification suite passes (test, lint, typecheck, format, build, smoke test)

### Final structural gate (Phase 4)
- [ ] Comprehensive import audit passes (assertion 7) — zero illegal imports from `subagent.js`
- [ ] Dynamic import check passes (assertion 8) — no `import()` or `require()` of `subagent.js`
- [ ] Delegation stubs fully removed (assertion 11)
- [ ] `packages/cli` typechecks with retargeted `index.ts` export
- [ ] `subagent.ts` line count ~680-720 (informational, not a gate — compiler/lint are the authority)
- [ ] Repo-wide barrel/export-chain verification — no public API surface regressions:
  ```bash
  # Check for barrel re-exports from subagent.js (outside subagent module family)
  grep -rn "export.*from.*['\"].*core/subagent\.js['\"]" packages/ | grep -v '/subagentTypes\.\|/subagentToolProcessing\.\|/subagentRuntimeSetup\.\|/subagentExecution\.\|/subagentOrchestrator\.\|/subagentScheduler\.'
  # Check for @vybestack/llxprt-code-core consumers expecting transitive symbols from subagent.js
  grep -rn "from ['\"]@vybestack/llxprt-code-core['\"]" packages/ | grep -v node_modules
  ```
  Expected: no barrel re-exports of subagent.js remain (only `subagentTypes.js` exports are re-exported). All `@vybestack/llxprt-code-core` consumers still resolve their imports (verified by typecheck).

## Expected Outcome

| File | Before (lines) | After (lines) | Change |
|------|----------------|---------------|--------|
| `subagent.ts` | 795 | ~680-720 | -75 to -115 (removed re-exports + stubs) |
| `subagentTypes.ts` | 233 | 233 | no change |
| `subagentToolProcessing.ts` | 518 | 518 | no change |
| `subagentRuntimeSetup.ts` | 586 | 586 | no change |
| `subagentExecution.ts` | 490 | 490 | no change |
| `subagentApiCompat.test.ts` | 61 | **deleted** | -61 |
| `subagentApiCompat.typecheck.ts` | 64 | **deleted** | -64 |
| **Total** | 2,747 | ~2,507-2,547 | ~-200 to -240 lines of pure waste removed |

## Risks

1. **Missed consumer** — Mitigated by:
   - Exhaustive grep in Phase 0 establishing the complete baseline
   - Post-migration grep gate confirming zero remaining non-SubAgentScope imports
   - Original plan missed `asyncTaskReminderService.test.ts` — now included
2. **index.ts public API** — `index.ts` only exports `SubagentTerminateMode` from `subagent.js`. Retargeting to `subagentTypes.js` is invisible to external consumers since they import from `@vybestack/llxprt-code-core` not individual files. Verified: `packages/cli/src/ui/commands/tasksCommand.test.ts` imports it this way and will be unaffected.
3. **Test mock wiring** — Verified: no test file uses `vi.mock` or `jest.mock` targeting `core/subagent.js`. The only subagent-related mock is for `prompt-config/subagent-delegation.js` which is a completely unrelated module. **No mock path updates needed.**
4. **SubAgentRuntimeOverrides heavy test usage** — This type is imported from `subagent.js` in 3 test files (`subagent.test.ts`, `subagent.stateless.test.ts`, `subagentApiCompat.typecheck.ts`). The first two are migrated to `subagentTypes.js`; the third is deleted. All accounted for.
5. **Truncated-file risk for `tools/task.ts`** — Full file (1,262 lines) has been read end-to-end during plan verification. The only import from `subagent.js` is at lines 18-23. No hidden imports elsewhere in the file.
6. **`agents/types.ts` has its own `OutputObject`** — This is a completely different `OutputObject` interface (with fields `result` and `terminate_reason: AgentTerminateMode`), not the subagent one. It imports nothing from `subagent.js`. No conflict.
