# Issue #1579: Decompose client.ts (2,389 lines)

## Overview

Decompose `packages/core/src/core/client.ts` into focused, single-responsibility sibling modules. The `GeminiClient` class currently conflates 9+ concerns: TODO continuation, IDE context tracking, agent hook lifecycle, tool governance, LLM utility calls, system instruction building, chat session creation, history management, and the agentic turn loop.

### Acceptance Criteria (from issue)

- No single file exceeds 800 lines
- No single function exceeds 80 lines
- All existing tests pass
- Test coverage does not decrease

### Guiding Principles

- **Sibling-file decomposition**: Follow the established codebase pattern (geminiChat.ts → ConversationManager.ts, TurnProcessor.ts, StreamProcessor.ts, DirectMessageProcessor.ts). No directory-as-module barrels.
- **SoC (Separation of Concerns)**: Each new module owns exactly one responsibility.
- **DRY**: Reuse existing services (HistoryService, TodoReminderService, ComplexityAnalyzer) — do not wrap them in pointless delegation layers.
- **No speculative abstractions**: No interfaces with a single implementation (IConversationState, IRequestHandler, etc.). Interfaces emerge from need.
- **Pure functions preferred**: Where state is not needed, extract free functions rather than classes.
- **Behavioral tests**: Test input → output transformations. Tests describe preserved behaviors, not which helper was called.
- **Function size enforcement**: No function may exceed 80 lines. Enforced at each step.
- **Import convention**: All new imports use `.js` extension for relative imports per project convention.
- **Naming convention**: New files follow the established convention IN `packages/core/src/core/` (not the aspirational kebab-case from `dev-docs/RULES.md`). The actual codebase pattern is: **PascalCase** for class-based files (`ConversationManager.ts`, `TurnProcessor.ts`, `StreamProcessor.ts`, `DirectMessageProcessor.ts`, `MessageConverter.ts`) and **camelCase** for pure-function/utility modules (`baseLlmClient.ts`, `coreToolScheduler.ts`, `geminiChat.ts`). This plan follows that: `TodoContinuationService.ts`, `IdeContextTracker.ts`, `AgentHookManager.ts`, `ChatSessionFactory.ts` (classes) vs. `clientHelpers.ts`, `clientToolGovernance.ts`, `clientLlmUtilities.ts` (function modules).
- **Test file suffix**: New test files use `.test.ts` (not `.spec.ts`) to match the established convention in `packages/core/src/core/` where all 20+ existing test files use `.test.ts`. While `dev-docs/RULES.md` mentions `.spec.ts` as aspirational, the actual codebase is uniformly `.test.ts`.
- **API preservation**: GeminiClient's public method signatures and exports from `packages/core/src/index.ts` remain unchanged. All existing consumers work without modification.

## Current State

### client.ts Responsibility Map

| Concern | Lines | Size | Methods / State |
|---------|-------|------|-----------------|
| Pure utility functions | 91-205 | 115 | `isThinkingSupported`, `findCompressSplitPoint`, `estimateTextOnlyLength` |
| Constructor / lifecycle | 208-395 | 188 | constructor, dispose, initialize, lazyInitialize, getContentGenerator, getUserTier, getBaseLlmClient |
| TODO / Complexity continuation | 397-615 | 219 | `processComplexityAnalysis`, `shouldEscalateReminder`, `isTodoToolCall`, `appendTodoSuffixToRequest`, `recordModelActivity`, `readTodoSnapshot`, `getActiveTodos`, `areTodoSnapshotsEqual`, `getTodoReminderForCurrentState`, `appendSystemReminderToRequest`, `shouldDeferStreamEvent`, `isTodoPauseResponse` + 11 state fields |
| History management | 617-623, 768-850 | 160 | `addHistory`, `getHistory`, `setHistory`, `storeHistoryForLaterUse`, `storeHistoryServiceForReuse` |
| System instruction | 625-710 | 86 | `updateSystemInstruction`, `buildSystemInstruction` |
| Chat accessors / misc | 712-767, 901-1011 | 170 | `getChat`, `getHistoryService`, `hasChatInitialized`, `isInitialized`, `extractPromptText`, `setTools`, `clearTools`, `updateTelemetryTokenCount`, `resetChat`, `resumeChat`, `restoreHistory`, `getCurrentSequenceModel`, `addDirectoryContext`, `generateDirectMessage` |
| Chat session factory | 1035-1240 | 206 | `startChat` — assembles settings, runtime bundle, creates GeminiChat |
| IDE context tracking | 1242-1412 | 171 | `getIdeContextParts` + state: `lastSentIdeContext`, `forceFullIdeContext` |
| Effective model | 1414-1426 | 13 | `_getEffectiveModelForCurrentTurn` |
| Agent hook management | 1428-1484 | 57 | `fireBeforeAgentHookSafe`, `fireAfterAgentHookSafe` + `HookState`, `hookStateMap` |
| **sendMessageStream** | **1486-2072** | **587** | The agentic turn loop — pre-flight, retry loop, stream processing, post-turn decisions |
| LLM utility methods | 2074-2262 | 189 | `generateJson`, `generateContent`, `generateEmbedding` |
| Tool governance | 2264-2389 | 126 | `getToolGovernanceEphemerals`, `readToolList`, `buildToolDeclarationsFromView`, `getEnabledToolNamesForPrompt`, `shouldIncludeSubagentDelegation` |

> **Note**: `updateTodoToolAvailabilityFromDeclarations` (line 2376) is listed under tool governance in the source but mutates `todoToolsAvailable` state — a field consumed exclusively by todo continuation logic. It moves to `TodoContinuationService`, not `clientToolGovernance`. See Phase 2.

**Total: 2,389 lines, 50+ methods, 25+ private state fields**

### Existing Test Coverage

| Test file | Tests | Lines | Coverage |
|-----------|-------|-------|----------|
| `client.test.ts` | 73 tests | 3,584 | isThinkingSupported, findCompressSplitPoint, generateEmbedding, updateSystemInstruction, generateJson, addHistory, resetChat, recordModelActivity, sendMessageStream (retries, todo_pause, IDE context, thinking-only, MaxSessionTurns, ContextWindowWillOverflow, InvalidStream, hooks), generateContent, setHistory, interactionMode, BeforeAgent/AfterAgent hooks |
| `__tests__/geminiClient.runtimeState.test.ts` | 13 tests | 353 | Constructor integration, runtime state usage, subscription, immutability, HistoryService reuse, error handling |
| `__tests__/geminiClient.dispose.test.ts` | ~2 tests | 28 | dispose cleanup |

### Consumers of GeminiClient (non-test)

| File | Usage |
|------|-------|
| `config/config.ts` | `new GeminiClient(...)`, `.isInitialized()`, `.getHistory()`, `.getHistoryService()`, `.storeHistoryServiceForReuse()`, `.storeHistoryForLaterUse()`, `.initialize()`, `.dispose()` |
| `config/configBaseCore.ts` | Type annotation `: GeminiClient`, `.getGeminiClient()` |
| `utils/summarizer.ts` | `.generateContent()` |
| `utils/llm-edit-fixer.ts` | `.generateJson()` |
| `utils/checkpointUtils.ts` | `.getHistory()` |
| `tools/mcp-client-manager.ts` | `.isInitialized()`, `.setTools()` |
| `utils/extensionLoader.ts` | `.isInitialized()`, `.setTools()` |
| `packages/core/src/index.ts` | `export * from './core/client.js'` |

## Target Decomposition

### New Files

| File | Size (est.) | Type | Responsibility |
|------|-------------|------|----------------|
| `clientHelpers.ts` | ~90 | Pure functions | `isThinkingSupported`, `findCompressSplitPoint`, `estimateTextOnlyLength` |
| `TodoContinuationService.ts` | ~350 | Service class | All TODO/complexity nudging, snapshot tracking, post-turn classification (returns decision enums, NOT stream control flow) |
| `IdeContextTracker.ts` | ~200 | Stateful class | Full/incremental IDE context building and diffing |
| `AgentHookManager.ts` | ~100 | Stateful class | BeforeAgent/AfterAgent hook lifecycle and deduplication |
| `clientToolGovernance.ts` | ~120 | Pure functions | Tool governance ephemerals, declarations, enabled names |
| `clientLlmUtilities.ts` | ~200 | Pure functions | `generateJson`, `generateContent`, `generateEmbedding` — free functions taking config/contentGenerator/baseLlmClient as params (matches `clientToolGovernance.ts` pattern) |
| `ChatSessionFactory.ts` | ~280 | Mixed (see below) | Chat session creation: stateful orchestration + pure builders (see internal decomposition) |

#### `ChatSessionFactory.ts` Internal Decomposition

This single file contains three distinct sub-concerns with different purity characteristics:

| Sub-function | Purity | Responsibility |
|-------------|--------|----------------|
| `buildSettingsSnapshot(config)` | **Pure** — reads config, returns a settings object | Assembles compression settings, reasoning config, tool governance ephemerals into a snapshot struct. No side effects. |
| `buildSystemInstruction(config, enabledToolNames, envParts)` | **Async, pure-ish** — reads config + filesystem (JIT memory), returns string | Builds the full system prompt: env context, core memory, JIT memory, user memory, MCP instructions, subagent delegation. Async only because `getJitMemoryForPath` and `getCoreSystemPromptAsync` are async. No mutations. |
| `createChatSession(deps)` | **Stateful orchestration** — creates objects, reuses HistoryService, has side effects | Reuses stored HistoryService (preserving UI conversation state across provider switches), creates new HistoryService when none stored, adds extra history, estimates tokens, configures thinking/tools, creates GeminiChat, sets active todos provider. This is the only part that mutates state or has side effects. |

`updateSystemInstruction()` stays in client.ts as a thin ~5-line method that calls `ChatSessionFactory.buildSystemInstruction()` to produce the prompt string, then calls `this.chat.setSystemInstruction()` and updates token offsets. Rationale: it needs `this.chat` and `this.config` which are GeminiClient-owned state — moving it to ChatSessionFactory would require passing both as parameters for no benefit.

### client.ts After Extraction (~750 lines)

- Constructor / lifecycle / getters (~130 lines)
- History delegation methods (~150 lines)
- Chat accessors, setTools, resetChat, resumeChat, restoreHistory (~120 lines)
- `_getEffectiveModelForCurrentTurn()` — private helper returning the model string for the current turn (~13 lines, stays in client.ts because it reads `runtimeState` which is GeminiClient-owned state)
- `extractPromptText(request)` — private helper extracting text from PartListUnion for logging/hooks (~20 lines, stays in client.ts because it's only used by sendMessageStream pre-flight)
- sendMessageStream decomposed into private helpers each ≤80 lines (~300 lines)
- Thin forwarding methods + re-exports (~50 lines)

### State Field Ownership Table

Every private state field in GeminiClient is listed below with its current owner, new owner after extraction, and all mutation sites.

| Field | Current Owner | New Owner | Mutation Sites (method names + line numbers) |
|-------|--------------|-----------|----------------------------------------------|
| `todoToolsAvailable` | GeminiClient | TodoContinuationService | `updateTodoToolAvailabilityFromDeclarations` (L2386), read in `processComplexityAnalysis` (L400), `recordModelActivity` (L481), `sendMessageStream` (L1741, L1970) |
| `lastComplexitySuggestionTime` | GeminiClient | TodoContinuationService | field init (L235), `processComplexityAnalysis` write (L431), read (L416) |
| `complexitySuggestionCooldown` | GeminiClient | TodoContinuationService | constructor (L313), read in `processComplexityAnalysis` (L417) |
| `lastTodoToolTurn` | GeminiClient | TodoContinuationService | field init (L239), `sendMessageStream` write (L1828), read in `shouldEscalateReminder` (L443-445) |
| `consecutiveComplexTurns` | GeminiClient | TodoContinuationService | field init (L240), `processComplexityAnalysis` (L401, L406, L410), `sendMessageStream` (L1724, L1727, L1737, L1829), `shouldEscalateReminder` read (L438) |
| `lastComplexitySuggestionTurn` | GeminiClient | TodoContinuationService | field init (L241), `processComplexityAnalysis` write (L432), read (L413) |
| `toolActivityCount` | GeminiClient | TodoContinuationService | field init (L242), `recordModelActivity` (L488, L490, L493), `sendMessageStream` reset (L1603, L1765, L1899, L1962, L1979, L2008, L2039) |
| `toolCallReminderLevel` | GeminiClient | TodoContinuationService | field init (L243), `recordModelActivity` (L491, L494, L496), `sendMessageStream` reset (L1604, L1764, L1898, L1961, L1978, L2007, L2038), read (L1741, L1744, L1970) |
| `lastTodoSnapshot` | GeminiClient | TodoContinuationService | field init (L244), `sendMessageStream` (L1743, L1762, L1835, L1897, L1960, L1977, L2006, L2017, L2031, L2063) |
| `lastSentIdeContext` | GeminiClient | IdeContextTracker | field init (L237), `sendMessageStream` write (L1688), `getIdeContextParts` read (L1251, L1305, L1337) |
| `forceFullIdeContext` | GeminiClient | IdeContextTracker | field init (L238), `setHistory` (L826), `resetChat` (L921), `startChat` (L1036), `sendMessageStream` read (L1680), write (L1689) |
| `hookStateMap` | GeminiClient | AgentHookManager | field init (L233), `fireBeforeAgentHookSafe` (L1433-1434, L1441), `fireAfterAgentHookSafe` (L1464), `sendMessageStream` delete (L1510) |
| `chat` | GeminiClient | stays in client.ts | constructor, `initialize` (L340), `lazyInitialize`, `startChat`, `sendMessageStream`, `resetChat`, `resumeChat`, `setTools`, `clearTools`, etc. |
| `contentGenerator` | GeminiClient | stays in client.ts | constructor, `initialize` (L339), `lazyInitialize` (L361), `getContentGenerator` (L376) |
| `config` | GeminiClient | stays in client.ts | constructor param — read-only reference used throughout |
| `logger` | GeminiClient | stays in client.ts | constructor (L285) — used for debug logging |
| `embeddingModel` | GeminiClient | stays in client.ts | constructor (L303), `generateEmbedding` (L2257) |
| `runtimeState` | GeminiClient | stays in client.ts | constructor (L283) — read-only reference |
| `sessionTurnCount` | GeminiClient | stays in client.ts | field init (L217), `sendMessageStream` (L1602), `processComplexityAnalysis` read (L413, L432), `shouldEscalateReminder` read (L445), `sendMessageStream` (L1828) |
| `loopDetector` | GeminiClient | stays in client.ts | constructor (L304), `sendMessageStream` (L1558, L1781, L1797) |
| `lastPromptId` | GeminiClient | stays in client.ts | constructor (L305), `sendMessageStream` (L1509, L1534, L1559) |
| `_previousHistory` | GeminiClient | stays in client.ts | `initialize` (L336), `setHistory` (L817), `storeHistoryForLaterUse` (L838), `getHistory` (L770), `sendMessageStream` (L1516), `resetChat` (L928) |
| `_storedHistoryService` | GeminiClient | stays in client.ts | `storeHistoryServiceForReuse` (L849), `startChat` (L1048, L1054) |
| `currentSequenceModel` | GeminiClient | stays in client.ts | field init (L222), `handleModelChanged` (L322), `sendMessageStream` (L1560), `_getEffectiveModelForCurrentTurn` (L1415) |
| `_baseLlmClient` | GeminiClient | stays in client.ts | `getBaseLlmClient` (L391-393) |
| `_pendingConfig` | GeminiClient | stays in client.ts | `initialize` (L345), `lazyInitialize` (L355, L372) |
| `_historyService` | GeminiClient | stays in client.ts | constructor (L284) |
| `_unsubscribe` | GeminiClient | stays in client.ts | constructor (L287), `dispose` (L328-329) |
| `complexityAnalyzer` | GeminiClient | stays in client.ts (injected into TodoContinuationService) | constructor (L309) |
| `todoReminderService` | GeminiClient | stays in client.ts (injected into TodoContinuationService) | constructor (L316) |

---

## Implementation Plan

> **Key principle for refactoring**: This is a move-and-delegate refactoring, not new feature implementation. The TDD discipline means: (1) ensure existing behavioral tests pass against the current code, (2) add characterization tests for any untested extracted behavior BEFORE moving code, (3) move code, (4) verify all tests still pass. The RED step for refactoring is "write a test that imports from the new location and asserts the same behavior." The GREEN step is "move the code so the test passes."
>
> **TDD cadence for each phase**:
> - **Extraction phases (1-7)**: Write characterization tests importing from the new file path that assert the same behaviors as the current code. Run them → verify they **FAIL** because the new file doesn't exist. This confirms the tests are wired to the new import path. Then implement the extraction → verify new tests **PASS** → run **FULL** suite to confirm nothing broke.
> - **Refactoring phase (8)**: Verify existing `sendMessageStream` tests **PASS BEFORE** decomposition — these are the safety net. Then decompose into private helpers. Verify the same tests still **PASS** afterward. Run **FULL** suite.
> - **No testing private internals**: Do not test private methods like `shouldEscalateReminder` directly. Test through public behavior (e.g., `classifyPostTurnAction` returns the right enum given inputs that would trigger escalation). The `shouldEscalateReminder` tests listed in Phase 2 test the public `classifyPostTurnAction` behavior that incorporates escalation logic, not the private method itself.

### Phase 0: Baseline Verification

**Goal**: Establish a green baseline before any changes.

#### Step 0.1: Run full test suite and record baseline

```
npm run test
npm run lint
npm run typecheck
```

Record pass counts and any pre-existing failures. All subsequent phases must maintain this baseline.

---

### Phase 1: Extract `clientHelpers.ts` (Pure Functions)

**Why first**: Zero coupling to GeminiClient class. Validates the sibling-file + re-export pattern with minimal risk.

#### Step 1.1: Tests — Add characterization tests for `estimateTextOnlyLength`

`estimateTextOnlyLength` is currently a private module-level function with no direct tests. Before extracting it, add behavioral tests.

**Test file**: `packages/core/src/core/clientHelpers.test.ts`

```
describe('estimateTextOnlyLength')
  it('returns 0 for empty part list')
  it('sums text lengths from Part array')
  it('ignores non-text parts (inlineData, functionCall, etc.)')
  it('handles string input')
  it('handles mixed text and binary parts')

describe('findCompressSplitPoint — boundary cases')
  it('throws for fraction <= 0 or >= 1')
  it('handles minimal history (single content item)')
  it('handles history with no valid split boundaries (no function responses)')
  it('returns correct index at exact threshold boundary')
```

Also move existing tests for `isThinkingSupported` and `findCompressSplitPoint` to this new test file (they currently live in `client.test.ts` at lines 165-287). Keep re-exports from `client.test.ts` until Phase 8.

**RED**: Run NEW tests only → verify they **FAIL** (imports from `./clientHelpers.js` fail because file doesn't exist yet).

#### Step 1.2: Implementation — Create `clientHelpers.ts`

- Create `packages/core/src/core/clientHelpers.ts`
- Move `isThinkingSupported`, `findCompressSplitPoint`, `estimateTextOnlyLength` from `client.ts`
- Add re-exports in `client.ts`: `export { isThinkingSupported, findCompressSplitPoint } from './clientHelpers.js'`
- Update internal imports within `client.ts` to reference `./clientHelpers.js`

**GREEN**: Run NEW tests → verify they **PASS**. Run **FULL** suite → verify `client.test.ts` still passes via re-exports.

#### Step 1.3: Verify

```
npm run test -- packages/core/src/core/clientHelpers.test.ts
npm run test -- packages/core/src/core/client.test.ts
npm run typecheck
```

---

### Phase 2: Extract `TodoContinuationService.ts`

**Why second**: Largest extraction (~350 lines), biggest complexity reduction in client.ts. This removes 11 state fields and 14 methods from GeminiClient.

#### Step 2.1: Tests — Create `TodoContinuationService.test.ts`

Write behavioral tests for the extracted public API. These test the behaviors currently only tested indirectly through `sendMessageStream` tests:

```
describe('TodoContinuationService')
  describe('processComplexityAnalysis')
    it('returns undefined when todoTools are not available')
    it('returns undefined for non-complex analysis')
    it('returns complexity suggestion for complex tasks')
    it('respects cooldown period between suggestions')
    it('returns escalated suggestion after consecutive complex turns')

  describe('isTodoToolCall')
    it('returns true for todo_write')
    it('returns true for todo_read (case-insensitive)')
    it('returns false for non-todo tool names')
    it('returns false for non-string input')

  describe('appendTodoSuffixToRequest')
    it('appends suffix to request array')
    it('does not duplicate suffix if already present')
    it('returns non-array requests unchanged')

  describe('recordModelActivity')
    it('ignores events when todoTools not available')
    it('only counts ToolCallResponse events')
    it('sets base reminder level at 4 tool calls')
    it('sets escalated reminder level above 4 tool calls')

  describe('getTodoReminderForCurrentState')
    it('returns create list reminder when no todos exist')
    it('returns update reminder when active todos exist')
    it('returns escalated reminder when escalate flag is set')

  describe('appendSystemReminderToRequest')
    it('appends reminder text to request array')
    it('does not duplicate existing reminder')
    it('wraps non-array input in array with reminder')
    it('drops non-array input and returns array with only reminder text')

  describe('shouldDeferStreamEvent')
    it('returns true for Content, Finished, Citation events')
    it('returns false for Error, ToolCallRequest events')

  describe('isTodoPauseResponse')
    it('returns true when response contains todo_pause function response')
    it('returns false for non-pause responses')
    it('returns false for undefined response')

  describe('classifyPostTurnAction')
    it('returns "finish" when tool calls were made')
    it('returns "thinking-only-retry" when thinking-only and retries remain')
    it('returns "finish" when thinking-only but max retries hit')
    it('returns "finish" when todo pause was seen')
    it('returns "finish" when no active todos remain and no pending reminder')
    it('returns "retry-with-reminder" when active todos pending and retries remain')
    it('returns "finish" when active todos pending but max retries hit')
    it('returns "finish" when no follow-up reminder available')
    it('does NOT yield events, call hooks, or invoke sendMessageStream — returns enum only')
```

**RED**: Run NEW tests only → verify they **FAIL** (imports from `./TodoContinuationService.js` fail because file doesn't exist yet).

#### Step 2.2: Implementation — Create `TodoContinuationService.ts`

- Create `packages/core/src/core/TodoContinuationService.ts`
- Move constants: `COMPLEXITY_ESCALATION_TURN_THRESHOLD`, `TODO_PROMPT_SUFFIX`
- Move state fields to class: `todoToolsAvailable`, `lastComplexitySuggestionTime`, `complexitySuggestionCooldown`, `lastTodoToolTurn`, `consecutiveComplexTurns`, `lastComplexitySuggestionTurn`, `toolActivityCount`, `toolCallReminderLevel`, `lastTodoSnapshot`, `complexityAnalyzer` (injected), `todoReminderService` (injected)
- Move `updateTodoToolAvailabilityFromDeclarations(declarations)` here (not to `clientToolGovernance`) because it mutates `todoToolsAvailable` state. Callers in `setTools` (line 865) and `startChat` (line 1209) change to `this.todoContinuationService.updateTodoToolAvailabilityFromDeclarations(...)`
- Move methods: all 14 listed in the responsibility map
- **Client-owned state passed as parameters**: `processComplexityAnalysis` and `shouldEscalateReminder` currently read `this.sessionTurnCount` which stays in GeminiClient. After extraction, these methods accept `sessionTurnCount` as an explicit parameter: `processComplexityAnalysis(analysis, sessionTurnCount)`, `shouldEscalateReminder(sessionTurnCount)`. This makes the dependency explicit and testable.
- Add new method `classifyPostTurnAction(context): PostTurnAction` — a **pure classification** that examines turn state (hadToolCalls, hadThinking, hadContent, todoPauseSeen, retryCount, maxRetries, activeTodos, hasPendingReminder) and returns a decision enum:
  - `PostTurnAction.Finish` — flush deferred events, fire after-hook, return turn
  - `PostTurnAction.ThinkingOnlyRetry` — thinking with no content/tools, should retry with continue prompt
  - `PostTurnAction.RetryWithReminder` — active todos pending, should retry with follow-up reminder
  - This method does NOT: yield events, flush deferred buffers, call `sendMessageStream` recursively, fire after-hooks, or modify retry counters. All stream control flow (event flushing, recursive calls, hook firing) stays in client.ts `_evaluatePostTurn` private helper.
- Add `buildFollowUpReminder(latestSnapshot, activeTodos)` — pure method that builds the follow-up reminder text (or returns undefined if none needed), used by client.ts when `classifyPostTurnAction` returns `RetryWithReminder`
- Add `resetActivityCounters()` — resets `toolCallReminderLevel` and `toolActivityCount` (called by client.ts after each completed post-turn action)
- Constructor accepts `Config` reference (for sessionId in `readTodoSnapshot`) and analyzer/reminder service instances
- In `client.ts`: instantiate `TodoContinuationService` in constructor, delegate all todo methods to it. The `_evaluatePostTurn` private helper in client.ts calls `classifyPostTurnAction` to get the decision, then handles stream mechanics (flushing deferred events, firing hooks, recursive `sendMessageStream` calls) based on that decision

**GREEN**: Run NEW tests → verify they **PASS**. Run **FULL** suite → verify existing `client.test.ts` tests for `recordModelActivity`, todo retries, `todo_pause` still pass.

#### Step 2.3: Migrate existing tests

Move the `recordModelActivity` describe block from `client.test.ts` (lines 1047-1089) to `TodoContinuationService.test.ts`, rewritten to test the service directly rather than through GeminiClient. Keep the original tests in `client.test.ts` as integration tests (they verify the wiring).

#### Step 2.4: Verify

```
npm run test -- packages/core/src/core/TodoContinuationService.test.ts
npm run test -- packages/core/src/core/client.test.ts
npm run typecheck
```

---

### Phase 3: Extract `IdeContextTracker.ts`

**Why third**: Self-contained 171-line method with its own state. Clean extraction boundary.

#### Step 3.1: Tests — Create `IdeContextTracker.test.ts`

The IDE context logic is currently tested through `sendMessageStream` tests in `client.test.ts` (the "Editor context delta" and "IDE context with pending tool calls" describe blocks, lines 2322-2934). Write unit tests for the extracted class:

```
describe('IdeContextTracker')
  describe('buildFullContext')
    it('returns empty array when no IDE context available')
    it('includes open files in context')
    it('includes active file with cursor position')
    it('includes selected text when present')
    it('produces well-formed JSON context string')

  describe('buildIncrementalDelta')
    it('returns empty array when nothing changed')
    it('detects opened files')
    it('detects closed files')
    it('detects active file change')
    it('detects cursor movement')
    it('detects selection change')

  describe('getIdeContextParts')
    it('returns full context on first call (forceFullContext=true)')
    it('returns delta on subsequent calls')
    it('returns full context after reset')

  describe('resetContext')
    it('forces full context on next getIdeContextParts call')

  describe('reset integration with GeminiClient callers')
    it('sends full context after setHistory resets the tracker')
    it('sends full context after resetChat resets the tracker')
    it('sends full context after startChat resets the tracker')
```

**RED**: Run NEW tests only → verify they **FAIL** (imports from `./IdeContextTracker.js` fail because file doesn't exist yet).

#### Step 3.2: Implementation — Create `IdeContextTracker.ts`

- Create `packages/core/src/core/IdeContextTracker.ts`
- Move state: `lastSentIdeContext`, `forceFullIdeContext`
- Move `getIdeContextParts()` method, decomposed into `buildFullContext()` (~75 lines) and `buildIncrementalDelta()` (~75 lines) to satisfy the 80-line function limit
- Public method: `getContextParts(forceFullContext)` and `resetContext()`
- In `client.ts`: instantiate `IdeContextTracker`, delegate the `getIdeContextParts` call in `sendMessageStream`
- **IDE context reset callers**: Every location that currently sets `this.forceFullIdeContext = true` must be changed to call `this.ideContextTracker.resetContext()`. Exhaustive list from client.ts:
  1. **Field initializer** (line 238): `private forceFullIdeContext = true` — replaced by `IdeContextTracker` constructor default (`forceFullIdeContext = true` in its own state)
  2. **`setHistory()`** (line 826): after updating history, resets IDE context so the next turn sends full editor state — change to `this.ideContextTracker.resetContext()`
  3. **`resetChat()`** (line 921): inside the `if (this.chat)` branch when clearing history — change to `this.ideContextTracker.resetContext()`
  4. **`startChat()`** (line 1036): at the top of startChat before creating a new chat session — change to `this.ideContextTracker.resetContext()`

**GREEN**: Run NEW tests → verify they **PASS**. Run **FULL** suite → verify all pass.

#### Step 3.3: Verify

```
npm run test -- packages/core/src/core/IdeContextTracker.test.ts
npm run test -- packages/core/src/core/client.test.ts
npm run typecheck
```

---

### Phase 4: Extract `AgentHookManager.ts`

**Why fourth**: Small, clean extraction. Removes hook deduplication complexity from GeminiClient.

#### Step 4.1: Tests — Create `AgentHookManager.test.ts`

```
describe('AgentHookManager')
  describe('fireBeforeAgentHookSafe')
    it('fires hook on first call for a prompt_id')
    it('does not fire hook again for same prompt_id')
    it('fires hook for new prompt_id')
    it('returns undefined when hook trigger is not configured')

  describe('fireAfterAgentHookSafe')
    it('fires hook and accumulates response text')
    it('deduplicates concurrent calls via activeCalls counter')
    it('only fires when activeCalls drops to zero')

  describe('cleanupOldHookState')
    it('removes hook state for old prompt_id')
    it('does not remove state for current prompt_id')

  describe('prompt-id lifecycle')
    it('cleans up hook state for old prompt_id when new prompt arrives')
    it('preserves hook state for current active prompt_id')
```

**RED**: Run NEW tests only → verify they **FAIL** (imports from `./AgentHookManager.js` fail because file doesn't exist yet).

#### Step 4.2: Implementation — Create `AgentHookManager.ts`

- Create `packages/core/src/core/AgentHookManager.ts`
- Move `HookState` interface
- Move state: `hookStateMap`
- Move methods: `fireBeforeAgentHookSafe`, `fireAfterAgentHookSafe`
- Add `cleanupOldHookState(newPromptId, oldPromptId)` — extracted from sendMessageStream lines 1508-1511
- Constructor accepts the hook trigger functions as dependencies
- In `client.ts`: instantiate `AgentHookManager`, delegate hook calls

**GREEN**: Run NEW tests → verify they **PASS**. Run **FULL** suite → verify existing `client.test.ts` BeforeAgent/AfterAgent hook tests still pass.

#### Step 4.3: Verify

```
npm run test -- packages/core/src/core/AgentHookManager.test.ts
npm run test -- packages/core/src/core/client.test.ts
npm run typecheck
```

---

### Phase 5: Extract `clientToolGovernance.ts` (Pure Functions)

**Why fifth**: Stateless functions that read from Config — easy extraction, no class needed.

#### Step 5.1: Tests — Create `clientToolGovernance.test.ts`

```
describe('clientToolGovernance')
  describe('getToolGovernanceEphemerals')
    it('returns undefined when no allowed or disabled tools')
    it('returns allowed list when present')
    it('returns disabled list when present')
    it('returns both when both present')

  describe('readToolList')
    it('returns empty array for non-array input')
    it('filters out non-string entries')
    it('filters out empty/whitespace entries')
    it('returns valid string entries')

  describe('buildToolDeclarationsFromView')
    it('returns empty array for undefined registry')
    it('returns empty array when no tool names in view')
    it('builds declarations from getAllTools')
    it('falls back to getFunctionDeclarations')

  describe('getEnabledToolNamesForPrompt')
    it('returns empty array when no tool registry')
    it('returns deduplicated enabled tool names')
```

**RED**: Run NEW tests only → verify they **FAIL** (imports from `./clientToolGovernance.js` fail because file doesn't exist yet).

#### Step 5.2: Implementation — Create `clientToolGovernance.ts`

- Create `packages/core/src/core/clientToolGovernance.ts`
- Move as free functions (taking Config/registry as parameters): `getToolGovernanceEphemerals`, `readToolList`, `buildToolDeclarationsFromView`, `getEnabledToolNamesForPrompt`, `shouldIncludeSubagentDelegation`
- `updateTodoToolAvailabilityFromDeclarations` is NOT extracted here — it mutates `todoToolsAvailable` state owned by `TodoContinuationService` and was already moved there in Phase 2. The callers (`setTools` at line 865 and `startChat` at line 1209) now call `this.todoContinuationService.updateTodoToolAvailabilityFromDeclarations(...)`.
- In `client.ts`: import and call these functions where the methods were previously used

**GREEN**: Run NEW tests → verify they **PASS**. Run **FULL** suite → verify all pass.

#### Step 5.3: Verify

```
npm run test -- packages/core/src/core/clientToolGovernance.test.ts
npm run test -- packages/core/src/core/client.test.ts
npm run typecheck
```

---

### Phase 6: Extract `clientLlmUtilities.ts`

**Why sixth**: These three methods are standalone API calls with no turn-loop interaction.

#### Step 6.1: Tests — Migrate and augment

The existing tests for `generateJson`, `generateContent`, and `generateEmbedding` in `client.test.ts` test through GeminiClient. Those integration tests stay. Add unit tests for the extracted class:

**Test file**: `packages/core/src/core/clientLlmUtilities.test.ts`

```
describe('clientLlmUtilities')
  describe('generateJson')
    it('returns parsed JSON for valid model response')
    it('retries on transient failures and eventually succeeds')
    it('converts plain text "user"/"model" responses for next_speaker checks')
    it('reports and rethrows errors when not aborted')

  describe('generateContent')
    it('returns generated content with merged config')
    it('retries on transient failures and eventually succeeds')
    it('uses lightweight system prompt (getCoreSystemPromptAsync, no env context)')
    it('reports and rethrows errors when not aborted')

  describe('generateEmbedding')
    it('returns empty array for empty input')
    it('delegates to BaseLLMClient')
```

**RED**: Run NEW tests only → verify they **FAIL** (imports from `./clientLlmUtilities.js` fail because file doesn't exist yet).

#### Step 6.2: Implementation — Create `clientLlmUtilities.ts`

- Create `packages/core/src/core/clientLlmUtilities.ts`
- Export `generateJson`, `generateContent`, `generateEmbedding` as **free functions** (not a class), each taking the required dependencies as parameters: `config: Config`, `contentGenerator: ContentGenerator`, `baseLlmClient: BaseLLMClient`, etc. This matches the `clientToolGovernance.ts` pattern of pure functions with explicit dependency injection.
- Move function bodies from the GeminiClient methods
- **CRITICAL — System prompt path divergence**: `generateJson` and `generateContent` build their system prompts via `getCoreSystemPromptAsync` directly — this is a lightweight path that includes `userMemory` and `mcpInstructions` but does NOT include environment context (`envParts`), core memory, or JIT memory. This differs from `buildSystemInstruction` (used by `startChat`/`ChatSessionFactory`) which includes all of those. The free functions call `getCoreSystemPromptAsync` directly, NOT `ChatSessionFactory.buildSystemInstruction`. Do NOT unify these paths.
- In `client.ts`: the public methods forward to the free functions, passing `this.config`, `this.getContentGenerator()`, `this.getBaseLlmClient()`, etc. as arguments

**GREEN**: Run NEW tests → verify they **PASS**. Run **FULL** suite → verify all pass.

#### Step 6.3: Verify

```
npm run test -- packages/core/src/core/clientLlmUtilities.test.ts
npm run test -- packages/core/src/core/client.test.ts
npm run typecheck
```

---

### Phase 7: Extract `ChatSessionFactory.ts`

**Why seventh**: Removes the 206-line `startChat` and 86-line system instruction methods from GeminiClient.

#### Step 7.1: Tests — Create `ChatSessionFactory.test.ts`

The existing `updateSystemInstruction` and `interactionMode wiring` tests in `client.test.ts` test through GeminiClient and remain as integration tests. Add unit tests for extracted functions:

```
describe('ChatSessionFactory')
  describe('buildSettingsSnapshot')
    it('assembles compression settings from config ephemerals')
    it('uses defaults when ephemerals are not set')
    it('includes reasoning settings')
    it('includes tool governance')

  describe('buildSystemInstruction')
    it('includes user memory')
    it('includes core memory')
    it('includes MCP instructions')
    it('includes environment context')
    it('includes subagent delegation when appropriate')

  describe('createChatSession')
    it('reuses stored HistoryService when available')
    it('creates new HistoryService when none stored')
    it('adds extra history when provided')
    it('sets thinking config for supported models')
    it('disables thinking config for gemini-2.0 models')
    it('builds tool declarations from view')
    it('sets active todos provider on chat')
```

**RED**: Run NEW tests only → verify they **FAIL** (imports from `./ChatSessionFactory.js` fail because file doesn't exist yet).

#### Step 7.2: Implementation — Create `ChatSessionFactory.ts`

- Create `packages/core/src/core/ChatSessionFactory.ts`
- Extract `buildSettingsSnapshot(config)` — the 50-line settings assembly from `startChat`
- Move `buildSystemInstruction(enabledToolNames, envParts)` — currently a private method
- `updateSystemInstruction()` stays in client.ts — it's a thin ~5-line method that calls `ChatSessionFactory.buildSystemInstruction()` then `this.chat.setSystemInstruction()` (see State Ownership Table rationale)
- Create `createChatSession(deps)` factory function encapsulating `startChat` logic
- Each function ≤80 lines: `buildSettingsSnapshot` (~40 lines), `buildSystemInstruction` (~50 lines), `createChatSession` decomposed into `setupHistoryService()` + `assembleRuntimeBundle()` + `createChat()`
- In `client.ts`: `startChat` delegates to `ChatSessionFactory.createChatSession()`, `updateSystemInstruction` calls `ChatSessionFactory.buildSystemInstruction()` then applies result to `this.chat`

**GREEN**: Run NEW tests → verify they **PASS**. Run **FULL** suite → verify all pass.

#### Step 7.3: Verify

```
npm run test -- packages/core/src/core/ChatSessionFactory.test.ts
npm run test -- packages/core/src/core/client.test.ts
npm run typecheck
```

---

### Phase 8: Decompose `sendMessageStream` into ≤80-line helpers

**Why last**: With all services extracted, sendMessageStream shrinks from 587 to ~350 lines. Now decompose it into named private methods.

#### Step 8.1: Tests — Establish safety net BEFORE decomposition

**RED step for refactoring**: Verify existing `sendMessageStream` tests **PASS** before any decomposition begins. Run:

```
npm run test -- packages/core/src/core/client.test.ts
```

The existing `sendMessageStream` describe block in `client.test.ts` has 25+ tests covering: retries, todo_pause, IDE context, thinking-only auto-continue, MaxSessionTurns, ContextWindowWillOverflow, InvalidStream retry, BeforeAgent/AfterAgent hooks. These are behavioral integration tests that test through the public API and remain unchanged. They are the safety net — if any fail BEFORE decomposition, fix them first.

No new tests needed for this step — the decomposition is internal (private methods).

#### sendMessageStream Behavior Lock Checklist

The following branch behaviors must be preserved exactly during decomposition. Each maps to existing test(s) in `client.test.ts`:

- **InvalidStream retry with "Please continue" prompt** → tested by "InvalidStream retry" tests
- **Thinking-only auto-continue with empty text** → tested by "thinking-only" tests
- **todo_pause short-circuits the loop** → tested by "todo_pause" tests
- **Deferred event flushing** (Content, Finished, Citation deferred; Error, ToolCallRequest immediate) → tested by event ordering tests
- **After-hook continuation** (recursive sendMessageStream call) → tested by AfterAgent hook tests
- **Context window overflow detection uses `initialRequest`** (not mutated request) → tested by ContextWindowWillOverflow tests
- **MaxSessionTurns enforcement** → tested by MaxSessionTurns tests
- **Duplicate tool-part filtering before retries** (lines ~1747-1756, ~2045-2055) → add a dedicated regression test if not already covered: assert that when retrying after a tool call response, the retry request does NOT contain duplicate tool-result parts from the previous iteration

#### Step 8.2: Implementation — Decompose sendMessageStream

Split into private helper methods within GeminiClient:

- `sendMessageStream(...)` — outer method: lazy init, chat setup, call `_runAgenticLoop`. (~60 lines)
- `_preflight(request, signal, prompt_id, isNewPrompt)` — hook firing (uses `extractPromptText` which stays in client.ts as it's only used here), session limits, context window check (uses `initialRequest`, NOT mutated request). Returns early Turn or null. (~75 lines)
- `_injectIdeContext(history, hasPendingToolCall)` — IDE context injection before the retry loop. (~20 lines)
- `_runRetryLoop(baseRequest, signal, prompt_id, turns, ...)` — the while-retryCount loop, delegates to `_processStreamIteration` and `_evaluatePostTurn`. (~80 lines)
- `_processStreamIteration(request, signal, prompt_id, turn)` — stream processing for a single retry iteration, yields events, returns iteration state. (~75 lines)
- `_evaluatePostTurn(iterationState, ...)` — calls `TodoContinuationService.classifyPostTurnAction` to get a decision enum, then handles stream mechanics based on that decision: flushes deferred events, fires after-hooks, makes recursive `sendMessageStream` calls for hook continuations. Stream control flow stays here, not in TodoContinuationService. (~60 lines)

Each ≤80 lines. Total ~370 lines across 6 methods.

**GREEN**: Run the same `sendMessageStream` tests from Step 8.1 → verify they all still **PASS**. Run **FULL** suite.

#### Step 8.3: Verify

```
npm run test -- packages/core/src/core/client.test.ts
npm run test -- packages/core/src/core/__tests__/geminiClient.runtimeState.test.ts
npm run test -- packages/core/src/core/__tests__/geminiClient.dispose.test.ts
npm run typecheck
```

---

### Phase 9: Cleanup and Final Validation

#### Step 9.1: Update test imports in `client.test.ts`

For tests that were testing the standalone functions (`isThinkingSupported`, `findCompressSplitPoint`), update imports to come from `./clientHelpers.js` while keeping the `./client.js` re-export imports as well so both paths are validated.

#### Step 9.2: Verify file sizes

```bash
wc -l packages/core/src/core/client.ts
wc -l packages/core/src/core/clientHelpers.ts
wc -l packages/core/src/core/TodoContinuationService.ts
wc -l packages/core/src/core/IdeContextTracker.ts
wc -l packages/core/src/core/AgentHookManager.ts
wc -l packages/core/src/core/clientToolGovernance.ts
wc -l packages/core/src/core/clientLlmUtilities.ts
wc -l packages/core/src/core/ChatSessionFactory.ts
```

All must be ≤800 lines.

#### Step 9.3: Verify function sizes

```bash
# Check no function exceeds 80 lines in new files
npm run lint
```

Lint rules (from issue #1568's Phase 1) enforce `max-lines-per-function`. If not yet active as errors, manually verify.

#### Step 9.4: Full verification suite

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

All must pass green.

#### Step 9.5: Verify no exports changed

```bash
# Ensure barrel export still works
grep "export \* from './core/client.js'" packages/core/src/index.ts
# Verify GeminiClient, isThinkingSupported, findCompressSplitPoint are still exported
```

---

## Mock Strategy: Key Invariant

`client.test.ts` uses `vi.mock()` with hoisting heavily — mocking modules like `./prompts.js`, `./geminiChat.js`, `./contentGenerator.js`, etc. When code moves from `client.ts` into new sibling files (e.g., `TodoContinuationService.ts`, `ChatSessionFactory.ts`), the **production code's imports don't change** — the new files import the same modules (`./prompts.js`, etc.) that `client.ts` used to import directly. Since `vi.mock()` intercepts by module specifier, the existing mocks in `client.test.ts` continue to intercept correctly as long as:

1. **The new sibling files import the same module specifiers** (e.g., `import { getCoreSystemPromptAsync } from './prompts.js'`, not a re-export through client.ts).
2. **`client.test.ts` mocks remain at the module level**, not at the class-instance level.
3. **GeminiClient delegates to the services**, so the `client.test.ts` integration tests exercise the full call chain (GeminiClient → service → mocked dependency).

This is a **key invariant to preserve**: do not change module specifiers during extraction. If `client.ts` imported `getCoreSystemPromptAsync` from `./prompts.js`, and that call moves to `ChatSessionFactory.ts`, then `ChatSessionFactory.ts` must also import from `./prompts.js`. The mock in `client.test.ts` will intercept both because `vi.mock('./prompts.js')` is module-global.

**Risk**: If a new file introduces a re-export layer or changes the import path, the mock won't intercept. Verify after each phase that `client.test.ts` tests pass without mock changes.

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Breaking GeminiClient public API | Re-export pattern preserves all existing imports. Integration tests validate. |
| sendMessageStream control flow corruption | 25+ existing behavioral tests cover every branch. No new logic — only moving existing code. |
| Circular dependencies between new modules | Dependency graph is tree-shaped: client.ts → each service. Services don't import each other. |
| Mock rewiring breakage | See "Mock Strategy" section above. Key invariant: new files import same module specifiers as client.ts did. `vi.mock()` intercepts by module specifier, so mocks continue to work. Verify after each phase. |
| Test flakiness from mock wiring changes | Tests remain in `client.test.ts` as integration tests. New unit tests use simpler mocks. |
| Missing test for extracted behavior | Phase 0 baseline + characterization tests before each extraction. |

## File Summary

### New files (7)

| File | Est. Lines | Type |
|------|-----------|------|
| `clientHelpers.ts` | ~90 | Pure functions |
| `TodoContinuationService.ts` | ~350 | Service class |
| `IdeContextTracker.ts` | ~200 | Stateful class |
| `AgentHookManager.ts` | ~100 | Stateful class |
| `clientToolGovernance.ts` | ~120 | Pure functions |
| `clientLlmUtilities.ts` | ~200 | Pure functions |
| `ChatSessionFactory.ts` | ~280 | Factory functions |

### New test files (7)

| File | Est. Tests |
|------|-----------|
| `clientHelpers.test.ts` | ~12 |
| `TodoContinuationService.test.ts` | ~25 |
| `IdeContextTracker.test.ts` | ~12 |
| `AgentHookManager.test.ts` | ~8 |
| `clientToolGovernance.test.ts` | ~10 |
| `clientLlmUtilities.test.ts` | ~8 |
| `ChatSessionFactory.test.ts` | ~10 |

### Modified files

| File | Change |
|------|--------|
| `client.ts` | Reduced from 2,389 → ~750 lines. GeminiClient delegates to extracted services. Re-exports `isThinkingSupported`, `findCompressSplitPoint`. |
| `client.test.ts` | Import adjustments for re-exported functions. All 73 existing tests preserved as integration tests. |
