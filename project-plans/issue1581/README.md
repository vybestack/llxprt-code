# Issue #1581: Decompose subagent.ts

## Overview

Break up `packages/core/src/core/subagent.ts` (2,117 lines) into focused, single-responsibility modules. The `SubAgentScope` class is a god object that handles configuration, runtime setup, execution loops, tool processing, and output management all in one file.

**Parent Issue:** #1568 (0.10.0 Code Improvement Plan)

## Acceptance Criteria

- [ ] No single file exceeds 800 lines
- [ ] No single function in production modules (`subagentTypes.ts`, `subagentRuntimeSetup.ts`, `subagentToolProcessing.ts`, `subagentExecution.ts`, `subagent.ts`) exceeds 80 lines (blank lines and comments excluded, enforced by ESLint `max-lines-per-function`). Test files are exempt.
- [ ] All existing tests pass (41 in subagent.test.ts, 16 in subagentOrchestrator.test.ts)
- [ ] Test coverage does not decrease (measured by line + branch coverage via `scripts/compare-coverage.sh`)
- [ ] Backward compatibility: all existing imports from `./subagent.js` continue to work unchanged
- [ ] Related files (subagentOrchestrator.ts, subagentScheduler.ts) require zero import changes
- [ ] Module size constraints enforced by ESLint `max-lines` / `max-lines-per-function` rules in `eslint.config.js` (runs in CI via `npm run lint`)
- [ ] Dependency boundary (`subagentExecution` must not import `subagentRuntimeSetup`) enforced by ESLint `no-restricted-imports` rule

## Current State Analysis

### File Structure (2,117 lines)
| Region | Lines | Content |
|--------|-------|---------|
| Types/Interfaces/Enums | 60-244 | SubagentTerminateMode, OutputObject, PromptConfig, ToolConfig, OutputConfig, SubAgentRuntimeOverrides, ModelConfig, RunConfig, ContextState |
| Pre-creation utilities | 246-422 | normalizeToolName, convertMetadataToFunctionDeclaration, validateToolsAgainstRuntime, createToolExecutionConfig, buildEphemeralSettings, templateString |
| SubAgentScope class | 433-2116 | Constructor, create(), 2 execution loops, tool processing, output handling, chat setup |

### Oversized Functions (>80 lines)
| Function | Lines | Size |
|----------|-------|------|
| `runInteractive` | 661-1015 | **355 lines** |
| `runNonInteractive` | 1028-1319 | **292 lines** |
| `processFunctionCalls` | 1380-1498 | **119 lines** |
| `createChatObject` | 1851-1963 | **113 lines** |
| `createSchedulerConfig` | 1500-1586 | **87 lines** |

### Consumers (must not break)

| Consumer | Imports from `./subagent.js` |
|----------|------------------------------|
| `subagentOrchestrator.ts` | `SubAgentScope`, `ModelConfig`, `PromptConfig`, `RunConfig`, `ToolConfig`, `OutputConfig` |
| `task.ts` | `SubAgentScope` (type), `ContextState`, `SubagentTerminateMode`, `OutputObject` (type) |
| `task.test.ts` | `ContextState`, `SubagentTerminateMode` |
| `index.ts` | `SubagentTerminateMode` |
| `asyncTaskManager.ts` | `OutputObject` (type) |
| `asyncTaskReminderService.test.ts` | `OutputObject` (type) |
| `subagent.stateless.test.ts` | `SubAgentScope`, `SubAgentRuntimeOverrides` (type) |
| `subagent.test.ts` | `ContextState`, `SubAgentScope`, `SubagentTerminateMode`, `PromptConfig`, `ModelConfig`, `RunConfig`, `OutputConfig`, `ToolConfig`, `SubAgentRuntimeOverrides` |

## Architectural Decomposition

The decomposition follows **domain cohesion** — each module owns a distinct responsibility rather than being a mechanical line-count split.

### Target Directory Structure

```
packages/core/src/core/
├── subagent.ts                    (~550 lines) Thin coordinator class + re-exports
├── subagentTypes.ts               (~200 lines) Types, interfaces, enums, ContextState
├── subagentRuntimeSetup.ts        (~400 lines) Execution environment preparation
├── subagentToolProcessing.ts      (~300 lines) Tool call dispatch and response handling
├── subagentExecution.ts           (~400 lines) Turn-by-turn execution loop logic
├── subagentScheduler.ts           (26 lines)   Unchanged
├── subagentOrchestrator.ts        (687 lines)  Unchanged
├── subagent.test.ts               (2573 lines) Updated imports, new unit tests
├── subagentOrchestrator.test.ts   (849 lines)  Unchanged
├── subagentTypes.test.ts          (new)        Unit tests for ContextState, templateString
├── subagentRuntimeSetup.test.ts   (new)        Unit tests for extracted setup functions
├── subagentToolProcessing.test.ts (new)        Unit tests for tool processing helpers
├── subagentExecution.test.ts      (new)        Unit tests for execution helpers
├── subagentApiCompat.test.ts      (new)        API surface runtime canary test (not skipped)
└── __tests__/
    └── subagentApiCompat.typecheck.ts (new)    Compile-time type export canary
```

### Module 1: subagentTypes.ts (~200 lines)
**Responsibility:** All type definitions, interfaces, enums, and simple value classes that define what a subagent IS.

**Contents:**
- `SubagentTerminateMode` enum
- `OutputObject` interface
- `PromptConfig` interface
- `ToolConfig` interface
- `OutputConfig` interface
- `SubAgentRuntimeOverrides` interface
- `EnvironmentContextLoader` type alias
- `defaultEnvironmentContextLoader`
- `ModelConfig` interface
- `RunConfig` interface
- `ContextState` class
- `templateString` pure function (used in prompt building)

**Why this grouping:** These are the foundational types that every other module depends on, plus `templateString` — a pure string-interpolation utility used during prompt building. While `templateString` is technically behavior, it is a pure function with no dependencies beyond `ContextState` (defined in this module) and is used by multiple modules (`subagentRuntimeSetup.ts` for system prompt building, and potentially by the coordinator). Keeping it here avoids a circular dependency that would arise if it lived in `subagentRuntimeSetup.ts` (since types must be the leaf). If `subagentTypes.ts` grows beyond 250 lines in a future change, move `templateString` to a dedicated `subagentUtils.ts` module.

**Note:** `ToolExecutionConfigShim` (a type alias for `ToolExecutionConfig` that adds no value) is deleted during Phase 1 and replaced with `ToolExecutionConfig` directly at the constructor parameter site.

### Module 2: subagentRuntimeSetup.ts (~400 lines)
**Responsibility:** Everything about preparing the execution environment — validation, configuration building, chat object creation, prompt assembly.

**Contents (all exported as standalone functions):**
- `canonicalizeToolName(name: string): string` (module-level utility — simple trim+toLowerCase for whitelist matching)
- `convertMetadataToFunctionDeclaration(fallbackName: string, metadata: ToolMetadata): FunctionDeclaration`
- `validateToolsAgainstRuntime(params): Promise<...>`
- `createToolExecutionConfig(params): ToolExecutionConfig`
- `buildEphemeralSettings(params): EphemeralConfig`
- `createEmojiFilter(settingsSnapshot): EmojiFilter | undefined`
- `buildChatGenerationConfig(modelConfig): GenerateContentConfig` (split from createChatObject)
- `buildChatToolDeclarations(functionDeclarations): Tool[]` (split from createChatObject)
- `createChatObject(params): Promise<GeminiChat | null>` (orchestrator, <80 lines; `params` includes `mcpInstructions?: string` resolved by the caller from `config.getMcpClientManager()`)
- `buildRuntimeFunctionDeclarations(toolRegistry, toolConfig): FunctionDeclaration[]`
- `getScopeLocalFuncDefs(outputConfig): FunctionDeclaration[]`
- `buildChatSystemPrompt(params): string`
- `buildSchedulerConfig(params): Config` (split from createSchedulerConfig)
- `applySchedulerToolRestrictions(config, toolConfig): Config` (split from createSchedulerConfig)

**Why this grouping:** All of these answer the question "how do we set up a subagent run?" They transform configuration into runtime objects. Cohesive because they share the same lifecycle phase (pre-execution).

**Growth guardrail:** If `subagentRuntimeSetup.ts` exceeds 500 lines after Phase 2, split scheduler-related functions (`buildSchedulerConfig`, `applySchedulerToolRestrictions`) into a separate `subagentSchedulerSetup.ts` module.

### Module 3: subagentToolProcessing.ts (~300 lines)
**Responsibility:** Everything about dispatching tool calls, handling responses, and managing the emit-value mechanism.

**Contents (all exported as standalone functions):**
- `processFunctionCalls(params): Promise<Content[]>` (orchestrator, <80 lines, receives `schedulerConfigFactory: () => Config`)
- `handleEmitValueCall(params): Part[]`
- `buildPartsFromCompletedCalls(params): Part[]`
- `resolveToolName(rawName: string | undefined, toolsView: ToolRegistryView): string | null` (fuzzy name resolution with registry lookup)
- `buildToolUnavailableMessage(toolName: string, resultDisplay?, error?): string`

Small internal helpers (may be inlined or exported depending on implementation):
- `categorizeToolCall(call, outputConfig): 'emit' | 'external'`
- `executeSingleToolCall(params): Promise<ToolCallResult>`
- `buildToolResponseContent(results): Content[]`
- `toSnakeCase(value: string): string`
- `isFatalToolError(errorType): boolean`
- `extractToolDetail(resultDisplay?, error?): string | undefined`

**Why this grouping:** All of these answer the question "what happens when the model makes a tool call?" They share a common data flow: tool call in → response parts out. Cohesive because they handle the same phase of a turn.

**Dependency note:** `processFunctionCalls` in non-interactive mode needs a `Config` to call `executeToolCall`. Rather than importing `createSchedulerConfig` from `subagentRuntimeSetup.ts`, the `processFunctionCalls` orchestrator receives a `schedulerConfigFactory: () => Config` parameter. The class method in `subagent.ts` provides `() => this.createSchedulerConfig({ interactive: false })` as the concrete value, with the `interactive` flag baked in.

**Naming clarification:** The codebase has two different `normalizeToolName` functions:
1. Module-level (line 246): simple `trim().toLowerCase()` for whitelist matching → renamed to `canonicalizeToolName` (in Module 2)
2. Class method (line 2038): fuzzy matching with suffix stripping, snake_case conversion, registry lookup → renamed to `resolveToolName` (in this module)

### Module 4: subagentExecution.ts (~400 lines)
**Responsibility:** The turn-by-turn execution loop logic for both interactive and non-interactive modes.

**Contents (all exported as standalone functions):**

Shared primitives (extract and test first — reduce duplication between run modes):
- `filterTextResponse(text, emojiFilter?): { filtered: string; systemFeedback?: string; blocked: boolean }` (shared emoji filtering, currently duplicated in both run methods)
- `checkGoalCompletion(outputConfig?, emittedVars): { complete: boolean; remainingVars: string[] }` (shared goal-check logic, currently duplicated)

Core execution helpers:
- `checkTerminationConditions(params): TerminationResult | null`
- `buildMissingOutputsNudge(outputConfig, emittedVars): Content[] | null`
- `buildTodoCompletionPrompt(todoStore): Promise<string | null>`
- `finalizeOutput(outputConfig, output): void`
- `buildInitialMessages(promptConfig, context): Content[]`
- `processInteractiveTurnEvents(params): TurnResult` (extracted from runInteractive loop body)
- `processNonInteractiveTurnEvents(params): TurnResult` (extracted from runNonInteractive loop body)
- `handleInteractiveToolCompletion(params): Content[]` (tool result → response assembly for interactive)
- `handleNonInteractiveToolCompletion(params): Content[]` (tool result → response assembly for non-interactive)

**Types defined in this module:**
- `TerminationResult` - reason + metadata for why execution stopped
- `TurnResult` - outcome of processing a single turn (tool calls, text, stop reason)
- `ExecutionContext` - shared read/write state bag passed to execution helpers (see Shared Contracts below)

**Dependency constraint:** `subagentExecution.ts` must NOT import from `subagentRuntimeSetup.ts`. All runtime artifacts (chat object, scheduler Config, function declarations, initial messages) are prepared by the coordinator (`subagent.ts`) using `subagentRuntimeSetup.ts` functions and then passed into execution helpers as parameters. This keeps execution depending only on `subagentTypes` (for type definitions) and `subagentToolProcessing` (for tool dispatch). The coordinator is the only module that bridges setup and execution.

**Lint enforcement:** The execution→runtimeSetup boundary is enforced by an ESLint `no-restricted-imports` rule added in Phase 0. Violations fail `npm run lint`.

**Why this grouping:** All of these answer the question "how does the execution loop progress turn by turn?" They share execution state (turn counter, start time, abort signal) and form the core control flow of a subagent run.

### Module 5: subagent.ts (coordinator, ~550 lines)
**Responsibility:** The `SubAgentScope` class as a thin coordinator that owns state and delegates to extracted modules. Maintains the public API.

**Retained in class:**
- All field declarations and constructor
- `create()` factory — validates and delegates to runtimeSetup
- `runInteractive()` — thin loop (~70 lines) that calls execution helpers
- `runNonInteractive()` — thin loop (~70 lines) that calls execution helpers
- `cancel()` and `dispose()` — lifecycle methods (small, state-dependent)
- `bindParentSignal()` — abort signal wiring (small, state-dependent)
- `onMessage` callback field
- Runtime artifact preparation: calls `subagentRuntimeSetup` functions to produce the chat object, scheduler Config/factory, function declarations, and initial messages, then passes these into `subagentExecution` helpers as parameters. This is the bridge between setup and execution — execution helpers never import setup directly.

**Re-exports for backward compatibility (authoritative contract):**
```typescript
// Value re-exports (backward-compatible — existed before decomposition)
export { SubagentTerminateMode, ContextState, templateString } from './subagentTypes.js';
// Type-only re-exports (backward-compatible)
export type { OutputObject, PromptConfig, ToolConfig, OutputConfig, SubAgentRuntimeOverrides, ModelConfig, RunConfig } from './subagentTypes.js';
// Additive exports (not previously public — no existing consumers)
export { defaultEnvironmentContextLoader } from './subagentTypes.js';
export type { EnvironmentContextLoader } from './subagentTypes.js';
```

`EnvironmentContextLoader` and `defaultEnvironmentContextLoader` are NOT currently exported and no external consumer imports them. The plan adds them as new public exports — this is an intentional, additive-only API surface expansion. `SubAgentRuntimeOverrides.environmentContextLoader` inlines the function signature rather than referencing the type alias, so this expansion has zero risk of breaking existing consumers. Mark this as an additive API change in the commit message for Phase 1.

**Growth contingency for coordinator:** If `subagent.ts` exceeds 600 lines after Phase 4, apply one of these strategies:
1. **Move `create()` factory to `subagentRuntimeSetup.ts`** as a standalone function `createSubAgentScope(...)`. The class retains a minimal private constructor and delegates to the factory. This removes ~60 lines of validation and setup from the coordinator.
2. **Extract scheduler wiring** (the `schedulerPromise` / `awaitCompletedCalls` / `handleCompletion` block in `runInteractive`, ~50 lines) into a `createSchedulerContext()` helper in `subagentRuntimeSetup.ts` that returns a `{ scheduler, dispose, awaitCompletedCalls }` tuple.

These are contingencies — only apply if the 600-line threshold is exceeded. Monitor during Phase 4.

## Function Splitting Plan

### runInteractive (355 → ~70 lines)
Current: one giant method with inline event processing, tool call handling, scheduler setup, nudge building.
After: thin loop that calls `processInteractiveTurnEvents()` for each turn, `handleInteractiveToolCompletion()` for tool results, `checkTerminationConditions()` for loop control, `buildMissingOutputsNudge()` for nudges. Scheduler setup (~30 lines) extracted to `subagentRuntimeSetup.ts`.

### runNonInteractive (292 → ~70 lines)
Same pattern: thin loop delegating to `processNonInteractiveTurnEvents()`, `checkTerminationConditions()`, `buildMissingOutputsNudge()`, `finalizeOutput()`.

### processFunctionCalls (119 → orchestrator ~60 lines + helpers)
Split into `categorizeToolCall` (is it emit_value or external?), `executeSingleToolCall` (dispatch and error handling), `buildToolResponseContent` (assemble response parts).

### createChatObject (113 → orchestrator ~60 lines + 2 helpers)
Split into `buildChatGenerationConfig` (model params → GenerateContentConfig), `buildChatToolDeclarations` (tool list → Tool[]), with the main function orchestrating. `mcpInstructions` is resolved by the caller and passed as a parameter.

### createSchedulerConfig (87 → 2 functions ~45 lines each)
Split into `buildSchedulerConfig` (base config) and `applySchedulerToolRestrictions` (tool whitelist/blacklist logic).

## Dependency Graph

```
subagentTypes.ts (leaf — no internal deps)
    ↑
subagentRuntimeSetup.ts (depends on: subagentTypes)
    ↑
    |   subagentToolProcessing.ts (depends on: subagentTypes)
    |           ↑
    |   subagentExecution.ts (depends on: subagentTypes, subagentToolProcessing)
    ↑           ↑
subagent.ts (depends on: all above, re-exports subagentTypes)
```

No circular dependencies. Each module can be tested independently. **Key constraint:** `subagentExecution.ts` does NOT depend on `subagentRuntimeSetup.ts`. Only `subagent.ts` (the coordinator) bridges setup and execution.

### Shared Contracts

To prevent implicit coupling, the following contracts must be defined:

1. **ExecutionContext** (in `subagentExecution.ts`): A read/write state bag that execution helpers receive as a parameter:
   ```typescript
   interface ExecutionContext {
     // --- Write target ---
     output: OutputObject;

     // --- Read-only configuration ---
     readonly subagentId: string;
     readonly runConfig: RunConfig;
     readonly outputConfig?: OutputConfig;
     readonly runtimeContext: AgentRuntimeContext;
     readonly emojiFilter?: EmojiFilter;
     readonly textToolParser: GemmaToolCallParser;
     readonly logger: DebugLogger;
     readonly onMessage?: (message: string) => void;

     // --- Runtime artifacts (prepared by coordinator from runtimeSetup) ---
     readonly functionDeclarations: FunctionDeclaration[];
     readonly schedulerConfigFactory: () => Config;
   }
   ```

2. **ToolResolutionContext** (in `subagentToolProcessing.ts`):
   ```typescript
   type ToolResolutionContext = { toolsView: ToolRegistryView };
   ```

3. **SchedulerConfigFactory** (in `subagentToolProcessing.ts`):
   ```typescript
   type SchedulerConfigFactory = () => Config;
   ```

### Export Classification

Each module's exports fall into two categories:

| Category | Convention | Consumed by |
|----------|-----------|-------------|
| **Public API** | Named export, documented in module JSDoc | Other modules in the dependency graph, re-exported via `subagent.ts` |
| **Test-visible** | Named export, prefixed with `/** @internal */` JSDoc tag | Test files only — not imported by other production modules |

**Per-module public API (non-exhaustive — implementer finalizes based on actual extraction):**

| Module | Public API exports | Internal/test-visible |
|--------|-------------------|----------------------|
| `subagentTypes.ts` | All symbols (types, enums, ContextState, templateString) | None — everything is public |
| `subagentRuntimeSetup.ts` | `createToolExecutionConfig`, `buildEphemeralSettings`, `createChatObject`, `buildChatSystemPrompt`, `buildSchedulerConfig`, `applySchedulerToolRestrictions`, `buildRuntimeFunctionDeclarations`, `getScopeLocalFuncDefs`, `canonicalizeToolName` | `convertMetadataToFunctionDeclaration`, `buildChatGenerationConfig`, `createEmojiFilter` |
| `subagentToolProcessing.ts` | `processFunctionCalls`, `handleEmitValueCall`, `buildPartsFromCompletedCalls`, `resolveToolName`, `buildToolUnavailableMessage` | `categorizeToolCall`, `toSnakeCase`, `isFatalToolError`, `extractToolDetail` |
| `subagentExecution.ts` | `filterTextResponse`, `checkGoalCompletion`, `checkTerminationConditions`, `buildMissingOutputsNudge`, `buildTodoCompletionPrompt`, `finalizeOutput`, `buildInitialMessages`, `processInteractiveTurnEvents`, `processNonInteractiveTurnEvents` | `handleInteractiveToolCompletion`, `handleNonInteractiveToolCompletion` |

The implementer should validate this classification during each phase and adjust as needed. The key constraint: production code outside a module must only import its public API exports.

## Risk Mitigation

1. **Import breakage:** Re-exports from `subagent.ts` ensure all existing consumers work unchanged. Backward-compatible runtime canary (`subagentApiCompat.test.ts`) and compile-time type canary (`subagentApiCompat.typecheck.ts`) validate continuously.
2. **State threading:** Extracted functions receive state as parameters (via `ExecutionContext` and explicit params) rather than accessing `this`. Testable and no hidden coupling.
3. **Function signature stability:** The `SubAgentScope` public API (`create()`, `runInteractive()`, `runNonInteractive()`, `cancel()`, `dispose()`, `output`, `onMessage`) is unchanged.
4. **Test continuity:** Existing 41 test cases remain as integration tests. New unit tests cover extracted functions.
5. **Growth guardrails:** `subagentRuntimeSetup.ts` 500-line threshold. `subagent.ts` 600-line contingency.
6. **Size enforcement:** ESLint `max-lines` / `max-lines-per-function` rules in `eslint.config.js` run in CI.
7. **Dependency boundary enforcement:** ESLint `no-restricted-imports` rule prevents execution→runtimeSetup coupling.

## Implementation Phases

See [PHASES.md](./PHASES.md) for the detailed phase-by-phase implementation sequence.
See [TEST_PLAN.md](./TEST_PLAN.md) for the test-first approach.
