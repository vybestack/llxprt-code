# Issue #1583: Break up useGeminiStream.ts (1,924 lines)

## Objective

Decompose `packages/cli/src/ui/hooks/useGeminiStream.ts` — a 1,924-line React hook — into focused, single-responsibility modules that are independently testable and easier to reason about. This is part of the umbrella code quality initiative (#1568).

## Acceptance Criteria (from issue)

- [ ] No single file exceeds 800 lines
- [ ] No single function exceeds 80 lines
- [ ] All existing tests pass
- [ ] Test coverage does not decrease on touched modules (`hooks/geminiStream/**` + shim + existing test files)

## Current State Analysis

### File Structure
The file contains:
- **4 module-level pure functions** (lines 77-218): `mergePartListUnions`, `mergePendingToolGroupsForDisplay`, `showCitations`, `getCurrentProfileName`
- **1 enum** `StreamProcessingStatus` and **1 interface** `QueuedSubmission`
- **1 exported hook** `useGeminiStream` (lines 230-1924) containing ~20 `useCallback`s, ~6 `useEffect`s, ~8 `useRef`s, ~5 `useState`s, ~5 `useMemo`s

### Functions Exceeding 80 Lines (must be split)
| Function | Lines | Size |
|---|---|---|
| `handleCompletedTools` | 1493-1772 | **279 lines** |
| `processGeminiStreamEvents` | 1056-1245 | **189 lines** |
| `submitQuery` | 1247-1434 | **187 lines** |
| `handleContentEvent` | 707-842 | **135 lines** |
| `prepareQueryForGemini` | 583-703 | **120 lines** |

### Export Visibility of Module-Level Functions

| Function | Exported? | Used Outside Module? |
|---|---|---|
| `mergePartListUnions` | **Yes** (`export function`) | Yes — imported by `useGeminiStream.dedup.test.tsx` via dynamic `import()` |
| `mergePendingToolGroupsForDisplay` | **Yes** (`export function`) | Yes — imported by `useGeminiStream.dedup.test.tsx` via dynamic `import()` |
| `showCitations` | **No** (plain `function`) | No — only referenced in test files as a settings property name, not the function itself |
| `getCurrentProfileName` | **No** (plain `function`) | No — used only within `useGeminiStream.ts` (at lines 721, 1101, 1295) |

### Export Decision for `showCitations` and `getCurrentProfileName`

These functions move to `streamUtils.ts`. Since they live in a separate module file and are imported by the orchestrator, they **must be exported from `streamUtils.ts`** (TypeScript requires it). However, they are **not re-exported from the barrel `index.ts`**, keeping them internal to the `geminiStream/` package. This makes them accessible for unit testing directly from `streamUtils.ts` but invisible to consumers importing from the barrel.

**`showCitations` classification — config-bound utility:** Despite living in "streamUtils," `showCitations` is NOT a pure function. It has runtime dependencies on `config.getSettingsService()` and `getCodeAssistServer(config)`. It is classified as a **config-bound utility** — it reads live config state and has a fallback precedence chain:
1. `settingsService.get('ui.showCitations')` — primary
2. `settings.merged.ui.showCitations` — legacy fallback
3. `getCodeAssistServer(config).userTier !== FREE` — tier-based default
4. `false` — final default

Tests for `showCitations` must cover this full fallback chain, including error paths where `getSettingsService()` throws.

### Public vs. Internal Exports from `streamUtils.ts`

| Function | Exported from `streamUtils.ts`? | Re-exported from barrel `index.ts`? | Classification |
|---|---|---|---|
| `mergePartListUnions` | **Yes** | **Yes** — public API | Pure utility |
| `mergePendingToolGroupsForDisplay` | **Yes** | **Yes** — public API | Pure utility |
| `showCitations` | **Yes** | **No** — internal only | Config-bound utility |
| `getCurrentProfileName` | **Yes** | **No** — internal only | Config-bound utility |
| `splitPartsByRole` | **Yes** | **No** — internal only | Pure utility |
| `collectGeminiTools` | **Yes** | **No** — internal only | Pure utility |
| `buildFinishReasonMessage` | **Yes** | **No** — internal only | Pure utility |
| `deduplicateToolCallRequests` | **Yes** | **No** — internal only | Pure utility |
| `buildThinkingBlock` | **Yes** | **No** — internal only | Pure utility |
| `buildSplitContent` | **Yes** | **No** — internal only | Pure utility |
| `processSlashCommandResult` | **Yes** | **No** — internal only | Orchestration helper (may call `scheduleToolCalls`) |
| `handleSubmissionError` | **Yes** | **No** — internal only | Pure utility |
| `SYSTEM_NOTICE_EVENT` | **Yes** | **No** — internal only | Constant |

### Consumers (non-test)
- `packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.ts` — imports `useGeminiStream`
- **No** direct `hooks/index.ts` re-export of `useGeminiStream` (index.ts only exports `useProviderDialog`, `useToolsDialog`, `useTerminalSize`)

### Consumers (test — import the module)
- `useGeminiStream.test.tsx` — `import { useGeminiStream } from './useGeminiStream.js'`
- `useGeminiStream.thinking.test.tsx` — `import { useGeminiStream } from './useGeminiStream.js'`
- `useGeminiStream.dedup.test.tsx` — `import { useGeminiStream } from './useGeminiStream.js'` **and** dynamic `import('./useGeminiStream.js')` for `mergePendingToolGroupsForDisplay`
- `useGeminiStream.integration.test.tsx` — `import { useGeminiStream } from './useGeminiStream.js'`
- `useGeminiStream.subagent.spec.tsx` — `import { useGeminiStream } from './useGeminiStream.js'`
- `App.test.tsx` — `import { useGeminiStream } from './hooks/useGeminiStream.js'` + `vi.mock('./hooks/useGeminiStream', ...)`

### Consumers (test — mock the module path only)
- `AppContainer.mount.test.tsx` — `vi.mock('../../hooks/useGeminiStream.js', ...)`
- `AppContainer.keybindings.test.tsx` — `vi.mock('../hooks/useGeminiStream.js', ...)`
- `AppContainer.render-budget.test.tsx` — `vi.mock('../hooks/useGeminiStream.js', ...)`

### Test Files (5 total)
| File | Lines | CI Status | Source |
|---|---|---|---|
| `useGeminiStream.test.tsx` | 3,046 | **Excluded** | vitest.config.ts L66 |
| `useGeminiStream.thinking.test.tsx` | 1,214 | **Included** | vitest.config.ts L115 |
| `useGeminiStream.integration.test.tsx` | 1,052 | **Excluded** | vitest.config.ts L65 |
| `useGeminiStream.dedup.test.tsx` | 422 | **Included** | vitest.config.ts L117 |
| `useGeminiStream.subagent.spec.tsx` | 326 | **Included** | default include pattern matches `*.spec.tsx` |

### CodeRabbit Plan Evaluation

CodeRabbit proposed extracting 3 sub-hooks (`useStreamEventHandlers`, `useToolCompletionHandler`, `useSubmissionQueue`) plus utilities and types. Analysis:

**Good ideas:**
- Extracting pure utility functions to a separate module — [OK] correct, these are standalone
- Creating a `geminiStream/` subdirectory — [OK] clean organizational pattern
- Extracting tool completion as its own hook — [OK] it has its own refs, effects, and complex logic (279 lines)
- Barrel re-export to preserve import paths — [OK] essential for backward compatibility

**Concerns with CodeRabbit's approach:**
- `useStreamEventHandlers` bundles 9 handlers into one hook, but many are tiny (8-25 lines). The real problem is `handleContentEvent` at 135 lines — the others are fine-grained already. Extracting them all into a single hook just moves code, it doesn't improve cohesion.
- `useSubmissionQueue` wraps only a ref + 1 small callback + 1 tiny effect (~25 lines total). This would be over-abstraction — creating a file and hook for 25 lines of straightforward code.
- Pre-planning `types.ts` with interfaces before understanding what the hooks actually need leads to speculative abstraction. Types should emerge from the extraction.
- CodeRabbit doesn't address that 5 functions exceed 80 lines and need internal decomposition, not just relocation.

## Architecture: Decomposition Based on Cohesion

### Target Directory Structure

```
packages/cli/src/ui/hooks/
  geminiStream/
    index.ts                          # Barrel: re-exports useGeminiStream + public utils
    useGeminiStream.ts                # Orchestrator hook (~700 lines)
    types.ts                          # Hook-specific types: StreamProcessingStatus, QueuedSubmission, handler param interfaces (~60 lines)
    streamUtils.ts                    # Utility functions: pure helpers + config-bound helpers (see classification below) (~200 lines)
    toolCompletionHandler.ts          # useToolCompletionHandler hook (~300 lines)
    checkpointPersistence.ts          # useCheckpointPersistence hook (~130 lines)
    __tests__/
      streamUtils.test.ts             # New: unit tests for extracted utilities (includes query preparation tests since those functions live in streamUtils.ts)
      toolCompletionHandler.test.ts   # New: unit tests for tool completion logic (branch matrix)
      shimContract.test.ts            # New: verifies legacy import path re-exports expected symbols
      eventOrdering.test.ts           # New: contract tests for processGeminiStreamEvents invariants
      deferredCompletion.test.ts      # New: race/stale-closure tests for deferred tool completions
      checkpointPersistence.test.ts   # New: unit tests for checkpoint persistence with injected fs/git mocks
  useGeminiStream.ts                  # KEPT as compatibility re-export shim (see below)
  useGeminiStream.test.tsx            # NO import changes needed (shim resolves)
  useGeminiStream.thinking.test.tsx   # NO import changes needed (shim resolves)
  useGeminiStream.dedup.test.tsx      # NO import changes needed (shim resolves)
  useGeminiStream.integration.test.tsx # NO import changes needed (shim resolves)
  useGeminiStream.subagent.spec.tsx   # NO import changes needed (shim resolves)
```

**Note on `streamEventProcessing.ts` (removed):** The original plan proposed a `streamEventProcessing.ts` module hosting `buildThinkingBlock` (~15 lines) and `buildSplitContent` (~25 lines). Per the rule "No module exists solely to host one <30-line function unless it isolates a domain concern," these two tiny pure helpers are merged into `streamUtils.ts` instead. They are stateless computation — the same domain as the other pure utilities.

**Note on `queryPreparation.ts` (removed):** The original plan proposed a `queryPreparation.ts` module. After finalizing scope, it would contain only `processSlashCommandResult` (~35 lines) and `handleSubmissionError` (~25 lines). Two small functions do not justify a standalone module. These are merged into `streamUtils.ts`. **Note:** `processSlashCommandResult` is an orchestration helper (it calls `scheduleToolCalls`), not a pure function. It is placed in `streamUtils.ts` for convenience but should be clearly documented as side-effecting. If `streamUtils.ts` accumulates too many non-pure helpers, consider splitting into `streamTransforms.ts` (pure) + `streamHelpers.ts` (side-effecting) in a follow-up. The total `streamUtils.ts` grows to ~200 lines — still well under 800.

### Compatibility Re-Export Shim at Old Path

**Critical:** All 5 test files, `App.test.tsx`, and 3 `AppContainer` test files reference `./useGeminiStream.js` or `../hooks/useGeminiStream.js` in both `import` and `vi.mock()` calls. Deleting the old file would break all test mocking paths.

The old `hooks/useGeminiStream.ts` becomes a thin re-export shim:

```typescript
// Backward-compatibility shim — all logic lives in geminiStream/
export { useGeminiStream } from './geminiStream/index.js';
export { mergePartListUnions, mergePendingToolGroupsForDisplay } from './geminiStream/index.js';
```

This means:
- **Zero test file changes** — all `import` and `vi.mock` paths continue to resolve
- **Zero consumer changes** — `useAppInput.ts` still imports from `../../../hooks/useGeminiStream.js`
- `App.test.tsx` import and mock both continue to work
- `AppContainer.*.test.tsx` mocks continue to work
- The dynamic `import('./useGeminiStream.js')` in `useGeminiStream.dedup.test.tsx` (line 319) continues to work

### Types File (`types.ts`) — Scope Discipline

**Rule: Only cross-module stable types go in `types.ts`.** One-off helper types that are used by a single module stay local to that module. For example, a parameter interface used only by `classifyCompletedTools` stays in `toolCompletionHandler.ts`, not `types.ts`. Only types imported by 2+ sibling modules belong in `types.ts`.

Create a local `types.ts` for hook-specific types that are shared across the extracted modules:

```typescript
export enum StreamProcessingStatus {
  Completed,
  UserCancelled,
  Error,
}

export interface QueuedSubmission {
  query: PartListUnion;
  options?: { isContinuation: boolean };
  promptId?: string;
}

// Parameter interfaces for extracted functions — defined during implementation
// based on what each function actually needs (not speculative)
```

### React Hooks Rules Safety Checklist

Every phase that creates or modifies hook code must verify:

- [ ] **(a) Unconditional top-level calls:** All extracted hooks (`useToolCompletionHandler`, `useCheckpointPersistence`) are called unconditionally at the top level of the orchestrator `useGeminiStream` — never inside conditionals, loops, or early-return branches. This is a Rules of Hooks requirement.
- [ ] **(b) No hook calls inside helper factories:** Functions in `streamUtils.ts`, `toolCompletionHandler.ts` helper functions (e.g., `classifyCompletedTools`, `buildToolResponses`), and local case-handler functions must NOT call any React hooks (`useState`, `useRef`, `useCallback`, `useEffect`, `useMemo`, etc.). Only the top-level custom hook functions (`useToolCompletionHandler`, `useCheckpointPersistence`, `useGeminiStream`) may call hooks.
- [ ] **(c) No conditional old/new logic switching during migration:** During the migration phases (7-11), there must be no conditional branching that switches between old monolithic code paths and new extracted code paths in the same render. Each phase either uses the old code or the new code for a given responsibility — never a runtime toggle. This prevents hook call count from varying between renders.

### Circular Import Prevention — Design-Time Rules

To prevent circular imports between the extracted modules:

1. **Dependency direction is strictly one-way:** `useGeminiStream.ts` (orchestrator) → `toolCompletionHandler.ts` → `streamUtils.ts`. Never the reverse. `checkpointPersistence.ts` → `streamUtils.ts` only. `types.ts` has zero imports from sibling modules.
2. **Cross-hook communication uses refs, not imports:** `useToolCompletionHandler` needs `submitQuery` but must NOT import the orchestrator. Instead, the orchestrator passes `submitQueryRef` as a parameter. This is the existing pattern (lines 1436-1438 use `submitQueryRef.current = submitQuery`).
3. **No barrel re-imports:** Modules within `geminiStream/` import directly from siblings (e.g., `import { splitPartsByRole } from './streamUtils.js'`), never from `./index.js`. This prevents the barrel from creating a dependency hub.
4. **Enforcement:** Phase 11 runs `madge --circular --extensions ts packages/cli/src/ui/hooks/geminiStream/` (or `eslint-plugin-import` with `import/no-cycle`). Zero circular imports must exist. Additionally, a manual review step verifies no module imports from the barrel.

### Module Responsibilities

#### 1. `streamUtils.ts` (~200 lines)
**Pure functions and config-bound utilities that don't depend on React or hook state.**

Extract (existing module-level functions):
- `mergePartListUnions()` — merges part list unions
- `mergePendingToolGroupsForDisplay()` — deduplicates tool displays
- `showCitations()` — checks citation settings (**config-bound utility**: depends on `config.getSettingsService()` and `getCodeAssistServer(config)`)
- `getCurrentProfileName()` — resolves profile name from config (**config-bound utility**: depends on `config.getSettingsService()`)
- `SYSTEM_NOTICE_EVENT` constant

New micro-helpers (enable >80-line functions to shrink):
- `splitPartsByRole(parts)` — separates `Part[]` into `{functionCalls, functionResponses, otherParts}` (~20 lines). Eliminates duplication at current lines 1544-1562 and 1695-1713.
- `collectGeminiTools(primaryTools)` — filters non-client-initiated tools (~5 lines)
- `buildFinishReasonMessage(reason)` — maps `FinishReason` → user message string (~25 lines, currently inline in `handleFinishedEvent`)
- `deduplicateToolCallRequests(requests)` — deduplicates by `callId`, preserving insertion order (~15 lines)
- `buildThinkingBlock(thought, sanitizeContent)` — creates a `ThinkingBlock` from a thought event, deduplicates against existing blocks (~15 lines)
- `buildSplitContent(sanitizedCombined, liveProfileName, thinkingBlocks)` — computes the before/after split for markdown-safe streaming (~25 lines)
- `processSlashCommandResult(result, scheduleToolCalls, prompt_id, abortSignal)` — dispatches slash command result types (~35 lines)
- `handleSubmissionError(error, addItem, config, onAuthError, timestamp)` — formats + adds error item from `submitQuery` catch block (~25 lines)

These are all deterministic, stateless computations (except `showCitations` and `getCurrentProfileName` which are config-bound). Moving them is zero-risk.

#### 2. Hook Extraction Rule: "Extract Only Transformations; Keep Mutation Sequencing in One Local Callback"

**This is the governing design principle for all extraction decisions.** When decomposing a large callback:

- **Extract** pure transformations: data classification, filtering, formatting, mapping. These are functions that take input and return output with no side effects. They can safely live in `streamUtils.ts` or as local helpers in extracted hook files.
- **Keep** mutation sequencing in the original callback (or its direct hook): any code that calls `setState`, mutates refs, calls `addItem`, calls `geminiClient.addHistory`, calls `markToolsAsSubmitted`, or calls `submitQuery`. The ORDER of these mutations is the contract. Splitting mutation sequences across module boundaries makes ordering bugs invisible.

**Example:** In `handleCompletedTools`, the call order `geminiClient.addHistory({role:'model',...})` → `geminiClient.addHistory({role:'user',...})` → `markToolsAsSubmitted(callIds)` is a mutation sequence that must stay together in one function body. The `splitPartsByRole` transformation that feeds it can be extracted. The mutation calls themselves cannot be scattered.

**Corollary:** Extracted hooks (`useToolCompletionHandler`, `useCheckpointPersistence`) own their OWN mutation sequences. The orchestrator does not reach into an extracted hook to reorder its internal mutations. The hook's return type is the contract boundary.

#### 3. Event handlers — kept in orchestrator as `useCallback`s

**Key design principle:** Many handlers are NOT truly pure. They depend on ref mutation timing (`turnCancelledRef`, `thinkingBlocksRef`, `loopDetectedRef`), `setPendingHistoryItem` functional updates, `addItem` call ordering, and live profile resolution via `getCurrentProfileName(config)`. Rather than forcing false purity by threading 15+ parameters, we keep them as `useCallback`s in the orchestrator but shrink them by extracting deterministic sub-computations to `streamUtils.ts`:

- `handleContentEvent` — depends on `pendingHistoryItemRef` mutation, `setPendingHistoryItem` functional updates, `flushPendingHistoryItem` ordering, `addItem` sequencing. Split to <80 lines by extracting `buildSplitContent`.
- `handleUserCancelledEvent` — reads and mutates `pendingHistoryItemRef`, calls `setPendingHistoryItem(null)`, `setIsResponding(false)` in specific order
- `handleErrorEvent`, `handleCitationEvent`, `handleChatCompressionEvent` — all mutate `pendingHistoryItemRef` and call `addItem` with specific timing
- `handleFinishedEvent` — slim after extracting `buildFinishReasonMessage` to `streamUtils.ts`, stays in orchestrator (~15 lines)
- `handleLoopDetectedEvent`, `handleMaxSessionTurnsEvent`, `handleContextWindowWillOverflowEvent` — all ≤22 lines, stay in orchestrator

The **stream event loop** (`processGeminiStreamEvents`, 189 lines) remains as a `useCallback` in the orchestrator because it coordinates all handlers. It calls into extracted helpers (`deduplicateToolCallRequests`, `buildThinkingBlock`), bringing it toward 80 lines.

**Extraction constraint for `processGeminiStreamEvents` — stateful control flow stays together:**

> **Rule:** Keep ALL stateful control flow (mutable variable assignment + branching on those variables) in one lexical scope within `processGeminiStreamEvents`. Extract ONLY pure transforms and text formatting. Specifically: the `toolCallRequests` accumulation array, the `loopDetectedRef` mutation, the `setLastGeminiActivityTime` calls, and the post-loop dedup/flush/schedule sequence are all stateful control flow that must remain in the function body. What CAN be extracted are pure data transformations like `buildThinkingBlock` (takes input, returns ThinkingBlock) and `deduplicateToolCallRequests` (takes array, returns array).

**Hard strategy for `processGeminiStreamEvents` if still >80 lines:**

After extracting `buildThinkingBlock` (~saves 44 lines from the Thought case) and `deduplicateToolCallRequests` (~saves 9 lines from post-loop dedup), the function drops from 189 to ~136 lines. This is still over 80. The primary and fallback strategies are:

**Primary reduction — extract `handleThoughtEvent` as a local helper in the orchestrator (~35→8 lines saved already via buildThinkingBlock, but the remaining setPendingHistoryItem call + profile logic is ~20 lines).** Combined savings: ~53 lines → ~136 lines. Still ~56 lines over.

**Fallback strategy — extract per-event case handlers as named functions:**
If after primary extractions the switch body still exceeds 80 lines, extract the larger switch cases into standalone functions within the orchestrator file (not exported — these are local to the module). These extracted case handlers must be **pure transforms or simple formatters** — they receive data and return a value or struct that the caller uses to perform the mutation. They must NOT themselves perform state mutations (no `setState`, no ref mutation, no `addItem`):

1. `buildThoughtUpdate(event, sanitizeContent, config, existingBlocks)` — a **pure transform** that returns `{ thinkingBlock, updatedPendingItem }` (~40 lines → 1 line call + 2 lines to apply returned values). The caller applies the mutation: `thinkingBlocksRef.current = [...]; setPendingHistoryItem(...)`. This keeps all mutation in the main loop body per the extraction rule.
2. `handleAgentExecutionEvent(event, addItem, userMessageTimestamp)` — combines `AgentExecutionStopped` and `AgentExecutionBlocked` cases (~16 lines → 1 line call)
3. The `Content`, `ToolCallRequest`, `UserCancelled`, `Error`, `ChatCompressed`, `Finished`, `Citation` cases are already 1-3 line delegations to existing `useCallback` handlers — no extraction needed.
4. The `UsageMetadata` case is 5 lines — stays inline.

With case handler extraction, the switch body becomes a pure dispatch table (~40 lines) plus the post-loop dedup/flush/schedule block (~15 lines) = ~55 lines total. Comfortably under 80.

**This is the escalation ladder:**
1. First: Extract pure transformations to `streamUtils.ts` (buildThinkingBlock, deduplicateToolCallRequests) — these are stateless: input → output
2. Second: Extract per-event case handlers as local functions in the orchestrator file — these are formatting/dispatch helpers, NOT stateful control flow
3. Third (emergency only): Create a `streamEventHandlers.ts` module — but this is unlikely to be needed

**What must NOT be extracted:** The for-of loop itself, the `toolCallRequests.push()` accumulation, the post-loop dedup/flush/schedule sequence, and any branching that reads or writes mutable variables (`loopDetectedRef`, `toolCallRequests`, `pendingHistoryItemRef`). These constitute the stateful control flow backbone of the function.

**Ordering contract for `processGeminiStreamEvents`:**
The following behaviors MUST be preserved in exact order:
1. `SYSTEM_NOTICE_EVENT` filter — skip before the switch statement
2. `setLastGeminiActivityTime(Date.now())` — called for `Thought` and `Content` events
3. `loopDetectedRef.current = true` — deferred to after the loop (not inline), processed in `submitQuery`'s finally block
4. `toolCallRequests` accumulation — pushed during iteration, deduplicated AFTER the loop completes (not per-event)
5. `UsageMetadata` — `uiTelemetryService.setLastPromptTokenCount()` called inline during iteration
6. Tool call scheduling — happens AFTER the for-of loop, after dedup, after flushing pending history

#### 4. `toolCompletionHandler.ts` (~300 lines) — `useToolCompletionHandler` hook
**The most complex piece: handles tool completion → continuation query lifecycle.**

This is the only extraction that genuinely benefits from being its own hook because it:
- Manages its own refs (`pendingToolCompletionsRef`, `processedMemoryToolsRef`, `handleCompletedToolsRef`)
- Has its own `useEffect` (pending tool completions processing)
- Has a circular dependency with `submitQuery` (resolved via ref)
- Contains the 279-line `handleCompletedTools` which needs internal decomposition

**Return type contract for `useToolCompletionHandler`:**
```typescript
interface UseToolCompletionHandlerReturn {
  /** Callback to process completed tool calls. Queues them if stream is active. */
  handleCompletedTools: (
    tools: TrackedToolCall[],
    skipRespondingCheck?: boolean,
  ) => Promise<void>;
  /** Ref holding the latest handleCompletedTools for use in effects. */
  handleCompletedToolsRef: React.MutableRefObject<
    ((tools: TrackedToolCall[], skipRespondingCheck?: boolean) => Promise<void>) | null
  >;
}
```

##### `handleCompletedTools` Invariants Table

| # | Branch Condition | Side Effects | Required Ordering | Continuation Behavior |
|---|---|---|---|---|
| **1** | `!skipRespondingCheck && isResponding` | Push tools to `pendingToolCompletionsRef.current` | Must happen BEFORE any `markToolsAsSubmitted` or history mutation | **Deferred** — tools processed later by `useEffect` when `isResponding` becomes `false` |
| **2** | `turnCancelledRef.current === true` | (a) `splitPartsByRole` on all response parts, (b) `geminiClient.addHistory({role:'model',...})` for functionCalls, (c) `geminiClient.addHistory({role:'user',...})` for functionResponses+otherParts, (d) `markToolsAsSubmitted(callIds)` | History writes MUST precede `markToolsAsSubmitted`. Model-role history MUST precede user-role history. | **No continuation** — tools recorded in history but no `submitQuery` call |
| **3** | `externalTools.length > 0` | `markToolsAsSubmitted(externalToolCallIds)` | Before primary tool processing. **Must execute even when primary path early-returns at step 4.** | External tools are finalized; primary tools continue to step 4+ |
| **4** | `primaryTools.length === 0` | None | After external tool handling | **Early return** — no further processing |
| **5** | `todoPauseTriggered` (any primary tool named `todo_pause` with status `success`) | `onTodoPause?.()` | After primaryTools identified, before client tool finalization | Does NOT prevent continuation |
| **6** | `clientTools.length > 0` (isClientInitiated) | `markToolsAsSubmitted(clientToolCallIds)` | After todoPause check | Client-initiated tools finalized immediately, not sent to Gemini |
| **7** | `newSuccessfulMemorySaves.length > 0` | `performMemoryRefresh()`, mark callIds in `processedMemoryToolsRef` | After client tool finalization | Does NOT prevent continuation |
| **8** | `geminiTools.length === 0` (all primary are client-initiated) | None | After memory processing | **Early return** — no Gemini continuation needed |
| **9** | `allToolsCancelled` (all geminiTools have status `cancelled`) | `splitPartsByRole`, history writes (model + user role), `markToolsAsSubmitted` | Same ordering as branch 2 | **No continuation** — history recorded, no `submitQuery` |
| **10** | Normal completion (some/all geminiTools succeeded) | Build `responsesToSend` (functionResponse parts only), `markToolsAsSubmitted`, `submitQuery(responsesToSend, {isContinuation:true}, prompt_ids[0])` | `markToolsAsSubmitted` MUST precede `submitQuery` to prevent reprocessing | **Continuation** — `submitQuery` called with first tool's `prompt_id` |

Internal decomposition of `handleCompletedTools`:
- `classifyCompletedTools(tools)` (~30 lines) — separates primary/external/cancelled tools by agentId. Uses `splitPartsByRole` from `streamUtils.ts` for the duplicated functionCall/functionResponse separation pattern.
- `buildToolResponses(geminiTools)` (~20 lines) — constructs functionResponse parts, filtering out functionCall parts (which are already in history)
- `processCancelledTurnTools(tools, geminiClient, markToolsAsSubmitted)` (~30 lines) — handles the turn-cancelled branch: adds parts to history with correct roles via `splitPartsByRole`, marks as submitted
- `processAllCancelledTools(geminiTools, geminiClient, markToolsAsSubmitted)` (~30 lines) — handles the all-tools-cancelled branch: adds cancelled tool responses to history via `splitPartsByRole`
- `processMemoryToolResults(primaryTools, processedMemoryToolsRef, performMemoryRefresh)` (~20 lines) — detects new save_memory successes, triggers refresh, marks as processed
- `handleCompletedTools()` — orchestrates the above (~60 lines)

#### 5. `checkpointPersistence.ts` (~130 lines) — `useCheckpointPersistence` hook
**Extracted from the restorable tool calls `useEffect` (lines 1788-1906).**

The checkpoint persistence effect is 118 lines and is self-contained — it only reads from `toolCalls`, `config`, `gitService`, `history`, `geminiClient`, `storage`, and `onDebugMessage`. It has no write dependencies on other hook state.

Extracting it as a separate hook:
- Reduces the orchestrator by ~120 lines
- Keeps the orchestrator well under 800 lines
- Is independently testable (it's an effect with clear inputs)
- Contains the `saveRestorableToolCalls` async function (~100 lines) which needs decomposition into:
  - `createToolCheckpoint(toolCall, gitService, geminiClient, history, checkpointDir, onDebugMessage)` (~60 lines)
  - The hook itself manages the filtering and iteration (~40 lines)

**Test strategy for checkpoint persistence (fs/git I/O):**

`saveRestorableToolCalls` does real filesystem I/O (`fs.mkdir`, `fs.writeFile`) and git operations (`gitService.createFileSnapshot`, `gitService.getCurrentCommitHash`). To avoid flaky I/O-dependent tests:

1. **Inject `fs` and `gitService` as parameters** — the hook already receives `gitService` as a parameter. For `fs`, the `createToolCheckpoint` helper accepts an `fsOps` parameter with `{ mkdir, writeFile }` signatures, defaulting to `promises` from `node:fs` in production. Tests inject mocks.
2. **Test categories:**
   - **Happy path:** `gitService.createFileSnapshot` succeeds → checkpoint JSON written with correct structure
   - **Git fallback:** `createFileSnapshot` throws → falls back to `getCurrentCommitHash` → still writes checkpoint
   - **Git unavailable:** `gitService` is null → `onDebugMessage` called with warning, no fs operations
   - **Checkpoint dir creation:** `fs.mkdir` throws `EEXIST` → swallowed; other errors → early return with debug message
   - **Write failure:** `fs.writeFile` throws → error caught, debug message logged, loop continues to next tool
   - **No restorable tools:** `toolCalls` has no `replace`/`write_file` in `awaiting_approval` → effect exits immediately
3. **Mock pattern:** Tests create `vi.fn()` implementations for `gitService` and `fsOps`, verify call args and ordering.

#### 6. `useGeminiStream.ts` — Orchestrator (~700 lines)
**What remains: state declarations, hook composition, effects, and memoized wrappers.**

Keeps:
- All `useState`, `useRef` declarations
- `useReactToolScheduler`, `useShellCommandProcessor`, `useKeypress` calls
- `useCallback` wrappers that call into extracted helpers
- `useEffect` hooks (except tool completion and checkpoint persistence)
- `useMemo` computations (`streamingState`, `pendingHistoryItems`, `pendingToolCallGroupDisplay`)
- `cancelOngoingRequest`, `sanitizeContent`, `flushPendingHistoryItem` (small callbacks)
- `submitQuery` (slim orchestration version, ~80 lines after extraction)
- `handleContentEvent` (under 80 lines after extracting `buildSplitContent`)
- All small event handlers (`handleUserCancelledEvent`, `handleErrorEvent`, etc.)
- `processGeminiStreamEvents` (under 80 lines after extracting helpers + per-event case handlers)
- `prepareQueryForGemini` (under 80 lines after extracting `processSlashCommandResult`)
- Return statement

#### Scheduler Tuple Tolerance

`useReactToolScheduler` returns a 5-element tuple: `readonly [TrackedToolCall[], ScheduleFn, MarkToolsAsSubmittedFn, CancelAllFn, number]`. The 5th element (`lastToolOutputTime`) is a `number` (timestamp).

**Current problem:** Existing test mocks are inconsistent — some return only 4 elements (missing `lastToolOutputTime`), and the consumer at line 1909 uses `lastToolOutputTime ?? 0` with nullish coalescing to tolerate `undefined`. Examples:
- `useGeminiStream.thinking.test.tsx` L291: returns 4 elements (missing 5th)
- `useGeminiStream.dedup.test.tsx` L81: returns 4 elements (missing 5th)
- `useGeminiStream.test.tsx` L220: returns 5 elements with inconsistent ordering

**Extraction requirement:** Any extracted hook that consumes the scheduler tuple (the orchestrator) MUST preserve the `?? 0` tolerant access pattern for `lastToolOutputTime`. This is not just defensive coding — it's required for test compatibility since existing mocks omit it. Extracted hooks must NOT destructure the tuple with strict positional assumptions that would throw on short arrays.

### File Size Estimates

| File | Estimated Lines | Under 800? |
|---|---|---|
| `streamUtils.ts` | ~200 | [OK] |
| `types.ts` | ~60 | [OK] |
| `toolCompletionHandler.ts` | ~300 | [OK] |
| `checkpointPersistence.ts` | ~130 | [OK] |
| `useGeminiStream.ts` (orchestrator) | ~700 | [OK] |
| `index.ts` | ~10 | [OK] |
| `useGeminiStream.ts` (shim at old path) | ~8 | [OK] |
| **Total** | ~1,408 | |

All under 800 lines. The orchestrator at ~700 lines has headroom. If it creeps over during implementation, the next candidate for extraction is the `useReactToolScheduler` `onAllToolCallsComplete` callback (lines 404-462), which could move into `toolCompletionHandler.ts`.

### Function-Size Target Map

Every function currently exceeding 80 lines, with exact decomposition plan and resulting sizes:

| Current Function | Current Lines | Extracted Subfunctions | Resulting Orchestrator Size |
|---|---|---|---|
| `handleCompletedTools` (279 lines) | 1493-1772 | `classifyCompletedTools` (~30), `buildToolResponses` (~20), `processCancelledTurnTools` (~30), `processAllCancelledTools` (~30), `processMemoryToolResults` (~20) — all in `toolCompletionHandler.ts` | ~60 lines (orchestrator within the hook) |
| `processGeminiStreamEvents` (189 lines) | 1056-1245 | `buildThinkingBlock` (~15), `deduplicateToolCallRequests` (~15) in `streamUtils.ts`. `handleThoughtCase` (~50 lines) + `handleAgentExecutionEvent` (~16 lines) as local functions in orchestrator. Post-loop dedup collapses to ~3-line call. | ~55-65 lines |
| `submitQuery` (187 lines) | 1247-1434 | `handleSubmissionError` (~25) in `streamUtils.ts`. Profile-change display stays inline (it's ~18 lines, no reuse). | ~75 lines |
| `handleContentEvent` (135 lines) | 707-842 | `buildSplitContent` (~25) in `streamUtils.ts`. The split-point / before-text / after-text calculation (~40 lines) collapses to ~10-line call. | ~70 lines |
| `prepareQueryForGemini` (120 lines) | 583-703 | `processSlashCommandResult` (~35) in `streamUtils.ts`. The slash-command switch block (~30 lines) collapses to ~5-line call. | ~75 lines |

### Function-Size Compliance Enforcement

The plan estimates are not sufficient — we need automated enforcement.

**AST-based validation script** (`scripts/check-function-sizes.sh` or similar):
```bash
# Run after each phase to verify no function exceeds 80 lines
# and no file exceeds 800 lines
npx ts-morph-scripts check-sizes packages/cli/src/ui/hooks/geminiStream/ \
  --max-function-lines 80 \
  --max-file-lines 800
```

If `ts-morph` is not available, use a simpler approach:
```bash
# Count lines per function using grep + awk on the compiled output
# Or use eslint max-lines-per-function rule in .eslintrc
```

**Concrete enforcement:** Add to Phase 11 (Final Validation) a step that runs `eslint --rule '{"max-lines-per-function": ["error", {"max": 80, "skipBlankLines": true, "skipComments": true}]}'` on all files in `geminiStream/`. If any function exceeds 80 lines, the phase fails.

### Micro-Helpers Designed Upfront

These are the specific small pure functions that enable the larger functions to stay under 80 lines:

| Helper | Purpose | Estimated Lines | Destination | Used By |
|---|---|---|---|---|
| `splitPartsByRole(parts)` | Separates `Part[]` into `{functionCalls, functionResponses, otherParts}` | ~20 | `streamUtils.ts` | `toolCompletionHandler` (2 call sites, eliminating duplication at current lines 1544-1562 and 1695-1713) |
| `collectGeminiTools(primaryTools)` | Filters to non-client-initiated tools | ~5 | `streamUtils.ts` | `toolCompletionHandler` |
| `buildFinishReasonMessage(reason)` | Maps `FinishReason` → user message string | ~25 | `streamUtils.ts` | `handleFinishedEvent` |
| `deduplicateToolCallRequests(requests)` | Deduplicates by `callId`, preserves order | ~15 | `streamUtils.ts` | `processGeminiStreamEvents` |
| `buildThinkingBlock(thought, sanitizeContent)` | Creates `ThinkingBlock`, deduplicates | ~15 | `streamUtils.ts` | `processGeminiStreamEvents` (Thought case) |
| `buildSplitContent(sanitized, profileName, thinkingBlocks)` | Computes markdown-safe split point | ~25 | `streamUtils.ts` | `handleContentEvent` |
| `processSlashCommandResult(result, scheduleToolCalls, prompt_id, abortSignal)` | Dispatches slash command result types | ~35 | `streamUtils.ts` | `prepareQueryForGemini` |
| `handleSubmissionError(error, addItem, config, onAuthError, timestamp)` | Formats + adds error item | ~25 | `streamUtils.ts` | `submitQuery` |
| `createToolCheckpoint(toolCall, gitService, ...)` | Creates single checkpoint file | ~60 | `checkpointPersistence.ts` | `checkpointPersistence` |
| `handleThoughtCase(event, ...)` | Thought event case handler | ~50 | orchestrator (local function, not exported) | `processGeminiStreamEvents` |
| `handleAgentExecutionEvent(event, ...)` | AgentExecution{Stopped,Blocked} case handler | ~16 | orchestrator (local function, not exported) | `processGeminiStreamEvents` |

## Implementation Plan (Test-First)

### Phase 0: Establish Baseline
1. Run existing test suite, confirm current pass/fail state
2. Record line counts and function sizes
3. Verify vitest.config.ts test status matches table above
4. **AST audit of ALL functions and callbacks** (not just named `useCallback`s): Run an AST-level scan of `useGeminiStream.ts` that measures the line count of every function expression, arrow function, and callback — including inline callbacks passed as arguments. The acceptance criterion "no function >80 lines" applies to ALL functions including anonymous/inline callbacks. **Pre-analysis note:** The `onAllToolCallsComplete` callback passed to `useReactToolScheduler` at lines 404-455 is ~51 lines (under 80), but must be verified by the AST audit. Any function/callback exceeding 80 lines must be added to the Function-Size Target Map with a decomposition plan.

### Phase 1: Tests for Extracted Pure Utilities
**Create `geminiStream/__tests__/streamUtils.test.ts`**

Unit tests for pure functions and config-bound utilities:
- `mergePartListUnions`: merge behavior with overlapping/disjoint part lists
- `mergePendingToolGroupsForDisplay`: dedup logic with overlapping tool call IDs, shell command handling
- **`showCitations` (config-bound utility — full fallback-precedence tests):**
  - `settingsService.get('ui.showCitations')` returns `true` → returns `true`
  - `settingsService.get('ui.showCitations')` returns `false` → returns `false`
  - `settingsService.get('ui.showCitations')` returns `undefined` → falls through to `settings.merged`
  - `config.getSettingsService()` throws → falls through to `settings.merged`
  - `config.getSettingsService()` returns `null` → falls through to `settings.merged`
  - `settings.merged.ui.showCitations` is `true` → returns `true`
  - `settings.merged.ui.showCitations` is `undefined` → falls through to tier check
  - `getCodeAssistServer(config)` returns server with `userTier !== FREE` → returns `true`
  - `getCodeAssistServer(config)` returns server with `userTier === FREE` → returns `false`
  - `getCodeAssistServer(config)` returns `null` → returns `false`
- **`getCurrentProfileName` (config-bound utility):**
  - `settingsService.getCurrentProfileName()` returns `'custom'` → returns `'custom'`
  - `settingsService.getCurrentProfileName()` returns `null`/`undefined` → returns `null`
  - `config.getSettingsService()` throws → returns `null`
  - `settingsService` has no `getCurrentProfileName` method → returns `null`
- `splitPartsByRole`: correct separation of functionCall/functionResponse/other parts, empty arrays, mixed content
- `buildFinishReasonMessage`: all FinishReason values map correctly, unknown values handled
- `deduplicateToolCallRequests`: duplicate callIds removed, insertion order preserved, empty input
- `buildThinkingBlock`: creates ThinkingBlock, deduplication against existing blocks, empty thought text
- `buildSplitContent`: correct split point computation, full-text case (no split), empty content
- `processSlashCommandResult`: slash command dispatch (schedule_tool, submit_prompt, handled), exhaustive match
- `handleSubmissionError`: error formatting for UnauthorizedError, AbortError, generic errors

These functions already exist (or are trivially derived) and work — the tests capture current behavior before we move code.

### Phase 2: Tests for Tool Completion Branch Matrix
**Create `geminiStream/__tests__/toolCompletionHandler.test.ts`**

Tests for the decomposed tool completion functions, with **explicit branch matrix coverage**:

**`classifyCompletedTools` tests:**
- Primary tools only (all DEFAULT_AGENT_ID)
- External agent tools only (non-default agentId)
- Mixed primary + external tools
- Empty input

**`processCancelledTurnTools` tests (turn-cancelled branch):**
- Tools with responseParts containing functionCall + functionResponse
- Tools with only functionResponse parts
- Empty responseParts
- Verifies `geminiClient.addHistory` called with correct roles
- Verifies `markToolsAsSubmitted` called with correct callIds

**`processAllCancelledTools` tests (all-tools-cancelled branch):**
- All gemini tools cancelled — verifies history entries added with correct roles via `splitPartsByRole`
- Verifies `markToolsAsSubmitted` called
- No `submitQuery` called

**`processMemoryToolResults` tests:**
- New successful `save_memory` tool → `performMemoryRefresh` called
- Already-processed `save_memory` tool → no refresh
- Mixed successful and failed `save_memory` tools
- `todo_pause` success side effect → `onTodoPause` called

**Tool completion call-order assertion tests (explicit ordering verification):**
- **`geminiClient.addHistory` role ordering in cancelled branches:** Assert that in both branch #2 (turn-cancelled) and branch #9 (all-tools-cancelled), `addHistory` is called with `{role: 'model', ...}` BEFORE `{role: 'user', ...}`. Use `vi.fn()` call order tracking: `expect(mockAddHistory.mock.calls[0][0].role).toBe('model')` followed by `expect(mockAddHistory.mock.calls[1][0].role).toBe('user')`.
- **`markToolsAsSubmitted` before continuation `submitQuery`:** Assert that in branch #10 (normal completion), `markToolsAsSubmitted` is called BEFORE `submitQuery`. Use a shared call-order array: both mocks push to it, then verify `markToolsAsSubmitted` index < `submitQuery` index.
- **External tools marked even on primary early-return:** Assert that in branch #3→#4 (external tools exist + primary tools empty), `markToolsAsSubmitted` is called with external tool callIds even though the function returns early at step 4. This verifies the external-tools mark is not guarded by the `primaryTools.length === 0` check.

**Integration-level (hook) tests:**
- Client-initiated tools submitted immediately via `markToolsAsSubmitted`
- `prompt_ids[0]` selection — verifies first tool's prompt_id used for continuation
- Deferred processing: tools queued while `isResponding=true`, processed on `false` transition

### Phase 3: Deferred Completion Race + Stale Closure Tests
**Create `geminiStream/__tests__/deferredCompletion.test.ts`**

These tests target the `pendingToolCompletionsRef` flow and the #1113 race condition:

**Deferred completion race tests (targeting #1113 behavior):**
- Tools completing while `isResponding=true` are queued, then processed when `isResponding` becomes `false`
- Multiple batches of tools arriving during active stream — all are queued and processed in order
- Tools queued during stream, then turn cancelled before `isResponding` becomes `false` — queued tools are NOT processed (turn-cancelled guard)
- Edge case: `isResponding` toggles rapidly (false→true→false) — no duplicate processing

**No-stale-closure verification tests:**
- After a re-render with updated props/state, deferred completions use the latest `handleCompletedTools` (not a stale closure). Verify by:
  1. Render hook with initial `performMemoryRefresh` mock
  2. Queue deferred tools while `isResponding=true`
  3. Update `performMemoryRefresh` to a new mock (simulating re-render)
  4. Set `isResponding=false`
  5. Assert the NEW mock was called, not the old one
- Same pattern for `submitQuery` ref: deferred completion that triggers continuation uses the latest `submitQuery`, not a captured closure from queue time

### Phase 4: Event Ordering Contract Tests
**Create `geminiStream/__tests__/eventOrdering.test.ts`**

Contract tests verifying the 6 ordering invariants from the `processGeminiStreamEvents` ordering contract:

1. **SYSTEM_NOTICE filter:** Stream containing `SYSTEM_NOTICE_EVENT` events — verify they are silently consumed, no history items added
2. **Activity time for Thought/Content:** Verify `setLastGeminiActivityTime` is called with `Date.now()` for Thought and Content events but NOT for other event types
3. **LoopDetected deferred:** Send a `LoopDetected` event mid-stream — verify `handleLoopDetectedEvent` is NOT called during stream processing, only after (in `submitQuery`'s finally/post-stream block)
4. **ToolCallRequest accumulation + post-loop dedup:** Send multiple ToolCallRequest events with duplicate `callId`s — verify dedup happens AFTER the loop (all requests collected during iteration, then deduplicated, then scheduled)
5. **UsageMetadata inline:** Verify `uiTelemetryService.setLastPromptTokenCount` is called during stream iteration, not deferred
6. **Tool call scheduling last:** Verify `scheduleToolCalls` is called AFTER pending history flush, after dedup, as the final action

These are behavioral integration tests using `renderHook` — they exercise the real `processGeminiStreamEvents` callback through the hook, not mocked internals.

### Phase 5: Shim Contract Test
**Create `geminiStream/__tests__/shimContract.test.ts`**

A tiny test that imports from the legacy path and verifies the shim contract:

```typescript
// Verify the legacy import path re-exports all expected symbols
import { useGeminiStream, mergePartListUnions, mergePendingToolGroupsForDisplay } from '../useGeminiStream.js';

test('legacy path re-exports useGeminiStream', () => {
  expect(typeof useGeminiStream).toBe('function');
});

test('legacy path re-exports mergePartListUnions', () => {
  expect(typeof mergePartListUnions).toBe('function');
});

test('legacy path re-exports mergePendingToolGroupsForDisplay', () => {
  expect(typeof mergePendingToolGroupsForDisplay).toBe('function');
});
```

This catches accidental breakage of the shim during future refactors.

### Phase 6: Checkpoint Persistence Tests
**Create `geminiStream/__tests__/checkpointPersistence.test.ts`**

Tests for the extracted checkpoint persistence hook with **injected fs/git mocks** to avoid flaky I/O:

**Setup:** All tests use `vi.fn()` mocks for `gitService` (`createFileSnapshot`, `getCurrentCommitHash`) and `fsOps` (`mkdir`, `writeFile`). No real filesystem or git operations.

**Test cases:**
- **Happy path:** `createFileSnapshot` returns commit hash → `writeFile` called with correct JSON structure (history, clientHistory, toolCall, commitHash, filePath)
- **Git snapshot fallback:** `createFileSnapshot` throws → `getCurrentCommitHash` called → checkpoint still written with fallback hash
- **Git fully unavailable:** `gitService` is null → `onDebugMessage` called with warning, `writeFile` never called
- **Both git methods fail:** `createFileSnapshot` throws + `getCurrentCommitHash` returns null → `onDebugMessage` called, tool skipped, loop continues
- **Checkpoint dir EEXIST:** `mkdir` throws `{code: 'EEXIST'}` → swallowed, proceeds to write
- **Checkpoint dir other error:** `mkdir` throws non-EEXIST error → early return, `onDebugMessage` called, no `writeFile`
- **Write failure:** `writeFile` throws → error caught, `onDebugMessage` called, loop continues to next tool
- **No restorable tools:** toolCalls with no `replace`/`write_file` in `awaiting_approval` → effect exits immediately, no fs/git calls
- **Checkpointing disabled:** `config.getCheckpointingEnabled()` returns false → early return, no operations
- **Multiple restorable tools:** Two tools → two `writeFile` calls with distinct filenames
- **Missing file_path arg:** Tool with no `file_path` in args → skipped with debug message, other tools still processed
- **Rerender idempotency (scope clarification: this verifies EXISTING behavior, not a new requirement):** The current effect runs on every `toolCalls` change. If `toolCalls` reference identity is stable (same array), React skips re-running the effect. Test by: (1) render hook with restorable tools, (2) assert `writeFile` called N times, (3) trigger rerender WITHOUT changing `toolCalls` identity, (4) assert `writeFile` call count did NOT increase. If the current implementation DOES duplicate writes on reference-equal rerenders, that is existing behavior to preserve (not fix in this refactor).

### Phase 7: Create `geminiStream/` Directory Structure + Shim
1. Create `geminiStream/` directory
2. Create `geminiStream/types.ts` with `StreamProcessingStatus` enum and `QueuedSubmission` interface
3. Create `geminiStream/index.ts` barrel exporting `useGeminiStream`, `mergePartListUnions`, `mergePendingToolGroupsForDisplay`
4. Move `useGeminiStream.ts` into `geminiStream/useGeminiStream.ts`
5. **Replace** old `hooks/useGeminiStream.ts` with compatibility re-export shim:
   ```typescript
   export { useGeminiStream } from './geminiStream/index.js';
   export { mergePartListUnions, mergePendingToolGroupsForDisplay } from './geminiStream/index.js';
   ```
6. Verify all tests pass — **zero import changes needed** in any test or consumer file
7. Verify all `vi.mock` paths still resolve (the shim file exists at the mocked path)

### Phase 8: Extract `streamUtils.ts`
1. Move the 4 functions (`mergePartListUnions`, `mergePendingToolGroupsForDisplay`, `showCitations`, `getCurrentProfileName`) and `SYSTEM_NOTICE_EVENT` constant to `geminiStream/streamUtils.ts`. All are **exported from `streamUtils.ts`** (required for cross-module import). Only `mergePartListUnions` and `mergePendingToolGroupsForDisplay` are re-exported from `index.ts`.
2. Create micro-helpers: `splitPartsByRole`, `collectGeminiTools`, `buildFinishReasonMessage`, `deduplicateToolCallRequests`, `buildThinkingBlock`, `buildSplitContent`, `processSlashCommandResult`, `handleSubmissionError` — all exported from `streamUtils.ts`, none from `index.ts`.
3. Import them in the orchestrator
4. Verify all existing tests still pass through the shim

### Phase 9: Extract `toolCompletionHandler.ts` as `useToolCompletionHandler`
1. Move `handleCompletedTools` callback, its ref, and the pending-completions effect
2. Decompose `handleCompletedTools` (279 lines) into micro-helpers: `classifyCompletedTools`, `buildToolResponses`, `processCancelledTurnTools`, `processAllCancelledTools`, `processMemoryToolResults`
3. Use `splitPartsByRole` from `streamUtils.ts` to eliminate the duplicated part-separation code
4. Accept `submitQueryRef` to break circular dependency
5. Return `handleCompletedTools` callback + ref (per return type contract above)
6. Wire up in orchestrator
7. Verify all tests pass

### Phase 10: Extract `checkpointPersistence.ts` as `useCheckpointPersistence`
1. Move the restorable tool calls `useEffect` (lines 1788-1906) into a standalone hook
2. Decompose `saveRestorableToolCalls` into `createToolCheckpoint` helper with injected `fsOps` parameter for testability
3. Wire up in orchestrator: `useCheckpointPersistence(toolCalls, config, gitService, history, geminiClient, storage, onDebugMessage)`
4. Verify all tests pass

### Phase 11: Slim Down Orchestrator Functions
1. Refactor `handleContentEvent` to call `buildSplitContent`, bringing it under 80 lines
2. Refactor `handleFinishedEvent` to call `buildFinishReasonMessage`, keeping it compact
3. Refactor `processGeminiStreamEvents`:
   - Call `buildThinkingBlock` and `deduplicateToolCallRequests` (primary strategy)
   - If still >80 lines: extract `handleThoughtCase` and `handleAgentExecutionEvent` as local (non-exported) functions in the orchestrator file (fallback strategy)
   - Verify result is under 80 lines
4. Refactor `prepareQueryForGemini` to call `processSlashCommandResult`, bringing it under 80 lines
5. Refactor `submitQuery` to call `handleSubmissionError`, bringing it under 80 lines
6. Verify all tests pass

### Phase 12: Final Validation
1. Run full test suite: `npm run test`
2. Run lint: `npm run lint`
3. Run typecheck: `npm run typecheck`
4. Run format: `npm run format`
5. Verify no file exceeds 800 lines: `wc -l packages/cli/src/ui/hooks/geminiStream/*.ts`
6. Verify no function exceeds 80 lines:
   ```bash
   npx eslint --no-eslintrc --rule '{"max-lines-per-function": ["error", {"max": 80, "skipBlankLines": true, "skipComments": true}]}' \
     packages/cli/src/ui/hooks/geminiStream/*.ts
   ```
   If eslint standalone doesn't work with TS, use `grep -c` heuristic or AST script.
7. Run build: `npm run build`
8. Smoke test: `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`
9. Verify shim works: confirm `import { useGeminiStream } from './useGeminiStream.js'` resolves in all 5 test files + `App.test.tsx`
10. **Coverage check — touched modules only:**
    Coverage comparison is scoped to files actually changed by this issue. The project uses selective `include`/`exclude` patterns in `vitest.config.ts` (L108-148, L27-85) that make global aggregate numbers unreliable for comparison. Instead:
    ```bash
    # Before starting (Phase 0): save baseline coverage for touched modules
    npx vitest run --coverage --reporter=json --outputFile=coverage-baseline.json

    # After all phases: compare coverage for touched files ONLY
    npx vitest run --coverage --reporter=json --outputFile=coverage-final.json

    # Compare ONLY these paths:
    #   - packages/cli/src/ui/hooks/geminiStream/**
    #   - packages/cli/src/ui/hooks/useGeminiStream.ts (shim)
    # Verify no file's branch/line coverage decreased on these paths.
    node -e "
      const base = require('./coverage-baseline.json');
      const final = require('./coverage-final.json');
      const touchedPaths = [
        'src/ui/hooks/geminiStream/',
        'src/ui/hooks/useGeminiStream.ts',
      ];
      // For each touched file: compare branch + line coverage
      // New files in geminiStream/ must have >0% coverage (the new tests provide this)
      // The shim file should have 100% coverage (trivial re-exports)
      // Fail if any existing file's coverage decreased
    "
    ```
11. **Circular import detection:**
    ```bash
    npx madge --circular --extensions ts packages/cli/src/ui/hooks/geminiStream/
    ```
    If `madge` is not available, use `dpdm` or `eslint-plugin-import` with `import/no-cycle` rule. Zero circular imports must exist within the `geminiStream/` directory. The only acceptable cross-module ref pattern is the `submitQueryRef` passed as a parameter (not an import cycle).
12. **Verify new tests are included by vitest patterns:**
    The new test files live at `packages/cli/src/ui/hooks/geminiStream/__tests__/*.test.ts`. The vitest config's `include` array (L108) contains `'**/*.{test,spec}.?(c|m)[jt]s?(x)'` which matches `*.test.ts` files recursively. The `exclude` array (`baseExcludePatterns`) has no pattern that would match `hooks/geminiStream/__tests__/*.test.ts`. Therefore new tests ARE included by default.

    **Verification step:** Before running the full suite, run:
    ```bash
    npx vitest list --reporter=verbose 2>&1 | grep 'geminiStream/__tests__'
    ```
    This confirms vitest discovers all new test files. If any are missing, add explicit include entries to `vitest.config.ts` following the existing pattern (L111-148).

## Test Strategy

### Principle: Strong Integration Tests + Focused Pure-Function Units

**DO NOT** unit-test hook internals via brittle mocks. The existing test files (`useGeminiStream.thinking.test.tsx`, `useGeminiStream.dedup.test.tsx`, `useGeminiStream.subagent.spec.tsx`) are integration tests that render the hook and exercise it through its public API. These are the most valuable tests and must remain unchanged.

**DO** add focused unit tests for **truly pure utilities** that are extracted to their own modules:
- `streamUtils.test.ts` — tests `splitPartsByRole`, `deduplicateToolCallRequests`, `buildFinishReasonMessage`, `mergePartListUnions`, `mergePendingToolGroupsForDisplay`, `showCitations` (with full fallback-precedence chain), `getCurrentProfileName` (with config-bound error paths), `buildThinkingBlock`, `buildSplitContent`, `processSlashCommandResult`, `handleSubmissionError`
- `toolCompletionHandler.test.ts` — tests `classifyCompletedTools`, `buildToolResponses`, `processCancelledTurnTools`, `processAllCancelledTools`, `processMemoryToolResults` with the branch matrix from Phase 2, **plus explicit call-order assertions** for `addHistory` role ordering, `markToolsAsSubmitted`-before-`submitQuery`, and external-tools mark on early-return paths
- `checkpointPersistence.test.ts` — tests with **injected fs/git mocks** (no real I/O) covering happy path, git fallback, git unavailable, dir creation errors, write failures, and no-restorable-tools early exit

**DO** add behavioral contract tests:
- `deferredCompletion.test.ts` — race condition tests for `pendingToolCompletionsRef` flow (#1113), stale closure verification post-rerender
- `eventOrdering.test.ts` — contract tests for `processGeminiStreamEvents` ordering invariants (6 invariants)
- `shimContract.test.ts` — verifies legacy import path re-exports expected named symbols

**DO NOT** create unit tests for:
- `handleContentEvent`, `handleUserCancelledEvent`, etc. — these are `useCallback`s with temporal side effects; testing them in isolation requires mocking React state setters, which is brittle and low-value. The existing integration tests cover their behavior.
- `processGeminiStreamEvents` internals — the event ordering contract tests verify the behavioral invariants; the existing integration tests cover end-to-end flows.
- `submitQuery` — same rationale; integration tests exercise the full flow.

### New test files (6 total)
| File | Tests | Type |
|---|---|---|
| `geminiStream/__tests__/streamUtils.test.ts` | ~30-38 test cases | Pure function + config-bound utility unit tests (includes query preparation: `processSlashCommandResult`, `handleSubmissionError`) |
| `geminiStream/__tests__/toolCompletionHandler.test.ts` | ~25-30 test cases | Pure function unit tests + branch matrix + call-order assertions |
| `geminiStream/__tests__/checkpointPersistence.test.ts` | ~10-12 test cases | Injected-mock I/O tests |
| `geminiStream/__tests__/deferredCompletion.test.ts` | ~8-10 test cases | Race condition + stale closure behavioral tests |
| `geminiStream/__tests__/eventOrdering.test.ts` | ~6-8 test cases | Ordering invariant contract tests |
| `geminiStream/__tests__/shimContract.test.ts` | ~3 test cases | Import contract verification |
| **Total new tests** | **~82-101 test cases** | |

## Risk Mitigation

1. **Import path stability (CRITICAL)**: The compatibility re-export shim at `hooks/useGeminiStream.ts` ensures all existing test imports, `vi.mock()` calls, and consumer imports continue to work without changes. This is the single most important risk mitigation — it eliminates the largest class of breakage.

2. **Mock path resolution**: `vi.mock('./useGeminiStream.js', ...)` resolves to the shim file. Since the shim re-exports from `./geminiStream/index.js`, vitest's module resolution will mock the actual module. Verify this works in Phase 7 before proceeding.

3. **Circular dependency**: `handleCompletedTools` ↔ `submitQuery` already uses a ref pattern (`submitQueryRef`). This must be preserved in the extracted hook. `useToolCompletionHandler` accepts `submitQueryRef` as a parameter. Phase 12 includes `madge --circular` detection to verify no import-level cycles are introduced. Additionally, the design-time rules (Section "Circular Import Prevention") prevent cycles from being introduced.

4. **Event-handler purity**: Do NOT force purity where temporal side effects are core behavior. The event handlers (`handleContentEvent`, `handleUserCancelledEvent`, etc.) stay as `useCallback`s in the orchestrator. Only the deterministic computation inside them (split point calculation, thinking block construction, finish reason mapping) is extracted as pure helpers. This follows the hook extraction rule: "Extract only transformations; keep mutation sequencing in one local callback."

5. **processGeminiStreamEvents ordering**: The ordering contract documented in Module Responsibilities section must be preserved exactly. The dedup of tool call requests happens AFTER the stream loop, not per-event. The `loopDetectedRef` is set during iteration but processed after the loop in `submitQuery`. The event ordering contract tests (Phase 4) provide automated verification.

6. **processGeminiStreamEvents >80 lines**: The primary extraction strategy (buildThinkingBlock + deduplicateToolCallRequests) reduces ~53 lines but may leave the function at ~136 lines — still over 80. The documented fallback strategy (extract per-event case handlers as local functions) is the escalation path. This is called out explicitly in Phase 11 step 3 to ensure the implementor doesn't stop at the primary strategy if insufficient.

7. **useCallback dependencies**: Moving logic out of `useCallback` bodies into pure functions must preserve the same memoization semantics. The pure functions should be module-level (not recreated each render).

8. **Scheduler tuple tolerance**: Extracted hooks consuming the `useReactToolScheduler` tuple must preserve `?? 0` tolerant handling for `lastToolOutputTime` (5th element). Test mocks inconsistently return 4 or 5 elements — the code must not break on short tuples. This is documented in the "Scheduler Tuple Tolerance" section and must be verified during Phase 7.

9. **Test coverage**: New unit tests for extracted modules ADD coverage. Existing behavioral tests verify integration. Coverage comparison is scoped to `hooks/geminiStream/**` + shim + existing test files, not global aggregate (which is unreliable due to selective include/exclude in vitest config). Phase 12 includes a touched-modules-only coverage diff check.

10. **Orchestrator size**: The orchestrator is estimated at ~700 lines. If it exceeds 800 during implementation, the first extraction candidate is `useCheckpointPersistence` (already planned as Phase 10). The second is the `onAllToolCallsComplete` callback passed to `useReactToolScheduler`.

11. **Stale closures in deferred completions**: The `handleCompletedToolsRef` pattern ensures the `useEffect` that processes pending tool completions always uses the latest callback. The stale-closure verification tests (Phase 3) provide automated verification that re-renders don't break this.

12. **Checkpoint persistence I/O flakiness**: `saveRestorableToolCalls` does fs/git I/O that could make tests flaky if hitting real filesystem. The `createToolCheckpoint` helper accepts injected `fsOps` (`{ mkdir, writeFile }`) so tests use `vi.fn()` mocks. No real I/O in tests. See Phase 6 and Phase 10 for details.

13. **New test file discoverability**: New tests at `geminiStream/__tests__/*.test.ts` match the default vitest include pattern `**/*.{test,spec}.?(c|m)[jt]s?(x)` and are NOT excluded by any `baseExcludePatterns` entry. Phase 12 includes a `vitest list` verification step to confirm discovery before the full run.
