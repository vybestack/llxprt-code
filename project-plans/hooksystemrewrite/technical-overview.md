# Hook System Rewrite — Technical Specification

## 1. Problem Statement

The current hook trigger layer (`coreToolHookTriggers.ts`, `geminiChatHookTriggers.ts`) has three structural defects:

1. **Per-call instantiation.** Every hook invocation constructs a new `HookRegistry`, calls `await hookRegistry.initialize()`, creates a new `HookPlanner`, and creates a new `HookRunner`. This re-reads and re-validates configuration on every tool call and every model call.

2. **Fire-and-forget semantics.** Every caller uses `void triggerXxxHook(...)` — the returned `Promise<void>` is discarded. Hook outputs (blocking decisions, modified requests, injected context, synthetic responses) are never consumed. Hooks can observe events but cannot influence the agent pipeline.

3. **Fake data in model triggers.** `geminiChatHookTriggers.ts` passes `{} as never` for the LLM request in `AfterModel` and `BeforeToolSelection`, and manually constructs a simplified `llmRequest` from `IContent` instead of using `hookTranslator`. The translator exists and works — it is simply not wired in.

The rewrite introduces two new components (`HookSystem`, `HookEventHandler`) and rewrites the two trigger files and their callers to close these gaps. All existing infrastructure (`HookRegistry`, `HookPlanner`, `HookRunner`, `HookAggregator`, `hookTranslator`, types) is preserved as-is. New types introduced by the rewrite (e.g., `HookSystemNotInitializedError`, `suppressDisplay` on `ToolResult`) are explicitly marked as **[Proposed — new]** throughout this document.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                           Config                                │
│  owns: HookSystem (lazy singleton)                              │
│  exposes: getHookSystem() → HookSystem                          │
├─────────────────────────────────────────────────────────────────┤
│                         HookSystem                              │
│  owns: HookRegistry, HookPlanner, HookRunner, HookAggregator   │
│  exposes: getEventHandler() → HookEventHandler                  │
│           getRegistry() → HookRegistry                          │
│           status: { initialized, totalHooks }                   │
├─────────────────────────────────────────────────────────────────┤
│                      HookEventHandler                           │
│  owns: reference to HookSystem's planner/runner/aggregator      │
│  methods: fireBeforeToolEvent, fireAfterToolEvent,              │
│           fireBeforeModelEvent, fireAfterModelEvent,            │
│           fireBeforeToolSelectionEvent                          │
│  returns: AggregatedHookResult (containing finalOutput)         │
├──────────────┬──────────────────────────────────────────────────┤
│              │ delegates to existing infrastructure             │
│    ┌─────────▼──────────┐  ┌──────────────┐  ┌──────────────┐  │
│    │    HookPlanner     │  │  HookRunner  │  │HookAggregator│  │
│    │ (existing, as-is)  │  │  (existing)  │  │  (existing)  │  │
│    └────────────────────┘  └──────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────────────┘

Callers:
  coreToolScheduler.ts  ──uses──►  fireBeforeToolHook / fireAfterToolHook / executeToolWithHooks
  geminiChat.ts         ──uses──►  fireBeforeModelHook / fireAfterModelHook / fireBeforeToolSelectionHook
```

---

## 3. New Components

### 3.1 HookSystem

**File:** `packages/core/src/hooks/hookSystem.ts`

**Responsibility:** Owns and initializes the hook infrastructure once. Acts as the single entry point for obtaining a `HookEventHandler`.

**Lifecycle:**
- Created lazily by `Config.getHookSystem()` on first access.
- Calls `registry.initialize()` once during its own initialization.
- Subsequent calls to `getEventHandler()` return the same handler backed by the same registry/planner/runner/aggregator.

```typescript
class HookSystem {
  private readonly registry: HookRegistry;
  private readonly planner: HookPlanner;
  private readonly runner: HookRunner;
  private readonly aggregator: HookAggregator;
  private readonly eventHandler: HookEventHandler;
  private initialized: boolean;

  constructor(config: Config);

  /** Initialize the registry. Idempotent — safe to call multiple times. */
  async initialize(): Promise<void>;

  /** Returns the event handler for firing hook events. */
  getEventHandler(): HookEventHandler;

  /** Returns the registry for management operations (enable/disable, list). */
  getRegistry(): HookRegistry;

  /** Reports current status. */
  getStatus(): { initialized: boolean; totalHooks: number };
}
```

**Invariants:**
- `getEventHandler()` and `getRegistry()` throw if called before `initialize()`. **[Proposed — new type]** The `HookSystem` will throw a new `HookSystemNotInitializedError` (to be created in `hookSystem.ts`), mirroring the pattern of the existing `HookRegistryNotInitializedError` from `hookRegistry.ts`. This error class does not exist in the current codebase — it is introduced by the rewrite. The existing `HookRegistryNotInitializedError` remains unchanged and continues to be thrown by `HookRegistry` itself.
- The `HookRunner` and `HookAggregator` instances require no initialization — they are stateless. Only `HookRegistry` requires async init.
- `HookSystem` does NOT subscribe to the message bus. That is the `HookEventHandler`'s responsibility (see §3.2).

### 3.2 HookEventHandler

**File:** `packages/core/src/hooks/hookEventHandler.ts`

**Responsibility:** Receives typed event requests, builds `HookInput` payloads, orchestrates plan→run→aggregate, and returns `AggregatedHookResult`.

```typescript
class HookEventHandler {
  constructor(
    config: Config,
    planner: HookPlanner,
    runner: HookRunner,
    aggregator: HookAggregator,
  );

  fireBeforeToolEvent(toolName: string, toolInput: Record<string, unknown>): Promise<AggregatedHookResult>;
  fireAfterToolEvent(toolName: string, toolInput: Record<string, unknown>, toolResponse: Record<string, unknown>): Promise<AggregatedHookResult>;
  fireBeforeModelEvent(llmRequest: GenerateContentParameters): Promise<AggregatedHookResult>;
  fireAfterModelEvent(llmRequest: GenerateContentParameters, llmResponse: GenerateContentResponse): Promise<AggregatedHookResult>;
  fireBeforeToolSelectionEvent(llmRequest: GenerateContentParameters): Promise<AggregatedHookResult>;
}
```

**Internal flow for every `fire*Event()` method:**

1. Build `HookInput` with base fields from `Config`:
   - `session_id` ← `config.getSessionId()`
   - `cwd` ← `config.getWorkingDir()`
   - `timestamp` ← `new Date().toISOString()`
   - `hook_event_name` ← the event enum value
   - `transcript_path` ← `''` (empty string placeholder)

   > **`transcript_path` design decision:** Both the current trigger files and this rewrite set `transcript_path` to an empty string. The `Config` object does not currently expose a transcript file path. This field exists for compatibility with the Claude Code hook protocol and for potential future audit/compliance use cases. **Migration path:** When transcript persistence is implemented, `Config` should expose a `getTranscriptPath(): string` method. The `HookEventHandler` will then read from `config.getTranscriptPath()` instead of hardcoding `''`. No hook script changes are required — scripts that use this field will simply start receiving a real path instead of an empty string. Scripts should already handle `transcript_path: ''` gracefully.

2. Add event-specific fields:
   - Tool events: `tool_name`, `tool_input`, `tool_response`
   - Model events: `llm_request` (via `defaultHookTranslator.toHookLLMRequest()`)
   - AfterModel: additionally `llm_response` (via `defaultHookTranslator.toHookLLMResponse()`)

3. Create execution plan: `planner.createExecutionPlan(eventName, context)`
   - For tool events, pass `{ toolName }` as context for matcher filtering.
   - For model events, pass `undefined` (no matcher).
   - If plan is `null` (no matching hooks), return an empty success `AggregatedHookResult`.

4. Execute hooks:
   - If `plan.sequential`: `runner.executeHooksSequential(plan.hookConfigs, eventName, input)`
   - Else: `runner.executeHooksParallel(plan.hookConfigs, eventName, input)`

5. Aggregate: `aggregator.aggregateResults(results, eventName)` → `AggregatedHookResult`

6. Log telemetry (debug level): event name, hook count, total duration, success/failure.

7. Return `AggregatedHookResult`.

**Empty result shape** (returned when no hooks match or hooks disabled):
```typescript
{
  success: true,
  finalOutput: undefined,
  allOutputs: [],
  errors: [],
  totalDuration: 0,
}
```

> **`success` semantics note:** The empty fast-path result always has `success: true`. For real executions, the `HookAggregator` sets `success: false` if **any** hook execution fails (crash, timeout, non-0/non-2 exit code) — including intentional policy blocks (exit code 2), which the runner marks as `success: false`. This means `AggregatedHookResult.success` represents **hook execution health**, not policy outcome. Callers must not use `success` to decide whether to proceed with the operation — they must check `finalOutput.isBlockingDecision()` for that. For telemetry: `success: false` + `finalOutput.isBlockingDecision() === true` is normal policy enforcement, not an error condition.

**Error handling:** Each `fire*Event()` method wraps its entire body in try/catch. On error, it logs a warning and returns the empty success result above. Hook infrastructure failures are never propagated as exceptions.

---

## 4. Config Integration

### 4.1 New Method on Config

```typescript
// In Config class
private hookSystem?: HookSystem;

getHookSystem(): HookSystem | undefined {
  if (!this.getEnableHooks()) {
    return undefined;
  }
  if (!this.hookSystem) {
    this.hookSystem = new HookSystem(this);
  }
  return this.hookSystem;
}
```

**Semantics:**
- Returns `undefined` when hooks are disabled (`getEnableHooks() === false`). Callers use this as the fast-path check — no further hook processing needed.
- Creates `HookSystem` lazily on first call when enabled.
- Does NOT call `initialize()` — the caller (the rewritten trigger function) does that.

### 4.2 Initialization Sequence

The `HookSystem.initialize()` call happens once, lazily, on the first hook event fire. The trigger functions handle this:

```
caller invokes fireBeforeToolHook(config, toolName, toolInput)
  → config.getHookSystem() returns HookSystem or undefined
  → if undefined → return safe default (no hooks)
  → hookSystem.initialize() — idempotent, fast no-op after first call
  → hookSystem.getEventHandler().fireBeforeToolEvent(toolName, toolInput)
```

This avoids initialization overhead at startup when hooks are configured but no events have fired yet.

---

## 5. Rewritten Trigger Functions

### 5.1 coreToolHookTriggers.ts

The file is rewritten to export three functions with return values instead of `Promise<void>`.

#### fireBeforeToolHook

```typescript
async function fireBeforeToolHook(
  config: Config,
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<DefaultHookOutput | undefined>
```

**Logic:**
1. `config.getHookSystem()` → if undefined, return undefined.
2. `await hookSystem.initialize()`
3. `hookSystem.getEventHandler().fireBeforeToolEvent(toolName, toolInput)` → `AggregatedHookResult`
4. Return `result.finalOutput` (a `DefaultHookOutput` or undefined if no hooks matched).

**Error contract:** Returns `undefined` on any infrastructure failure. Never throws.

#### fireAfterToolHook

```typescript
async function fireAfterToolHook(
  config: Config,
  toolName: string,
  toolInput: Record<string, unknown>,
  toolResponse: Record<string, unknown>,
): Promise<DefaultHookOutput | undefined>
```

Same pattern as `fireBeforeToolHook`. The `toolResponse` is the serialized `ToolResult` fields (`llmContent`, `returnDisplay`, `metadata`, `error`), matching the current `AfterToolInput.tool_response` shape.

#### executeToolWithHooks

```typescript
async function executeToolWithHooks(
  config: Config,
  toolName: string,
  toolInput: Record<string, unknown>,
  executeFn: () => Promise<ToolResult>,
): Promise<ToolResult>
```

**Logic:**
1. If hooks disabled (`config.getHookSystem()` returns undefined): call `executeFn()` directly, return result.
2. `const beforeOutput = await fireBeforeToolHook(config, toolName, toolInput)`
3. If `beforeOutput?.isBlockingDecision()`:
   - Return an error `ToolResult` with `llmContent` containing the block reason from `beforeOutput.getBlockingError().reason`.
4. If `beforeOutput?.shouldStopExecution()`:
   - Return a stop `ToolResult` with `llmContent` containing the stop reason.
5. `const toolResult = await executeFn()`
6. Build `toolResponse` from `toolResult` fields.
7. `const afterOutput = await fireAfterToolHook(config, toolName, toolInput, toolResponse)`
8. If `afterOutput?.shouldStopExecution()`:
   - Return a stop `ToolResult`.
9. If `afterOutput?.getAdditionalContext()`:
   - Append the additional context string to `toolResult.llmContent`.
10. If `afterOutput?.suppressOutput`:
    - Set `toolResult.suppressDisplay = true`. **[Proposed — new field]** The `ToolResult` type does not currently have a `suppressDisplay` field. The rewrite introduces this as an optional `suppressDisplay?: boolean` field on `ToolResult`. The scheduler's `publishBufferedResults()` will check this field: if `true`, the result is sent to the LLM (`llmContent` is preserved) but the `returnDisplay` is cleared or the display callback is skipped. This avoids modifying the scheduler's existing status/buffering state machine beyond a simple conditional check at the display layer. No existing code uses this field — it is entirely new.
11. Return `toolResult`.

**Note:** Whether `coreToolScheduler` uses `executeToolWithHooks` as a complete wrapper or calls `fireBeforeToolHook`/`fireAfterToolHook` individually depends on how cleanly the scheduler's existing promise chain can accommodate a wrapper. Both approaches are valid — the trigger file exports all three.

**Scheduler status mapping for blocked tool calls:** The scheduler uses `setStatusInternal()`, `bufferResult()`, and `publishBufferedResults()` to manage tool execution lifecycle. When a BeforeTool hook blocks execution:
- The scheduler treats the block as a completed (not cancelled, not errored) tool invocation that produced an error-like result.
- `setStatusInternal('idle')` — the tool slot returns to idle, not error state.
- `bufferResult(blockedToolResult)` — the blocked result (containing the block reason as `llmContent`) is buffered normally.
- `publishBufferedResults()` — the blocked result is published to the LLM so the model sees the block reason and can adjust.
- No retry is attempted for blocked tool calls. The model decides how to proceed based on the block reason.
- This is analogous to the existing pattern for tool execution errors — the scheduler already handles non-success tool results without entering an error state.

### 5.2 geminiChatHookTriggers.ts

The file is rewritten to export three functions with typed return values.

#### fireBeforeModelHook

```typescript
async function fireBeforeModelHook(
  config: Config,
  llmRequest: GenerateContentParameters,
): Promise<BeforeModelHookResult>
```

**Return type:**
```typescript
interface BeforeModelHookResult {
  blocked: boolean;
  reason?: string;
  syntheticResponse?: GenerateContentResponse;
  modifiedRequest?: GenerateContentParameters;
}
```

**Logic:**
1. `config.getHookSystem()` → if undefined, return `{ blocked: false }`.
2. `await hookSystem.initialize()`
3. `hookSystem.getEventHandler().fireBeforeModelEvent(llmRequest)` → `AggregatedHookResult`
4. Extract `finalOutput` as `BeforeModelHookOutput` (guaranteed by `createHookOutput` + `HookAggregator.createSpecificHookOutput`).
5. If `finalOutput` is undefined → return `{ blocked: false }`.
6. If `finalOutput.isBlockingDecision()` or `finalOutput.shouldStopExecution()`:
   - `syntheticResponse = finalOutput.getSyntheticResponse()` — may be undefined (block without response).
   - Return `{ blocked: true, reason: finalOutput.getEffectiveReason(), syntheticResponse }`.
7. Otherwise:
   - `modifiedRequest = finalOutput.applyLLMRequestModifications(llmRequest)` — returns original if no modifications.
   - Return `{ blocked: false, modifiedRequest }`.

**Key difference from current code:** The `llmRequest` parameter is `GenerateContentParameters` (the SDK type), not a manually-constructed `IContent[]` wrapper. The `HookEventHandler` uses `defaultHookTranslator.toHookLLMRequest()` internally to convert to the stable hook API format before sending to scripts.

#### fireAfterModelHook

```typescript
async function fireAfterModelHook(
  config: Config,
  llmRequest: GenerateContentParameters,
  llmResponse: GenerateContentResponse,
): Promise<AfterModelHookResult>
```

**Return type:**
```typescript
interface AfterModelHookResult {
  response: GenerateContentResponse;
}
```

**Logic:**
1. `config.getHookSystem()` → if undefined, return `{ response: llmResponse }`.
2. `await hookSystem.initialize()`
3. `hookSystem.getEventHandler().fireAfterModelEvent(llmRequest, llmResponse)` → `AggregatedHookResult`
4. Extract `finalOutput` as `AfterModelHookOutput`.
5. If `finalOutput` is undefined → return `{ response: llmResponse }`.
6. `const modified = finalOutput.getModifiedResponse()` — returns a `GenerateContentResponse` or undefined.
7. Return `{ response: modified ?? llmResponse }`.

**Key difference from current code:** Receives the actual `GenerateContentParameters` and `GenerateContentResponse` SDK types instead of `IContent`. The translator handles conversion to/from the stable hook API format.

#### fireBeforeToolSelectionHook

```typescript
async function fireBeforeToolSelectionHook(
  config: Config,
  llmRequest: GenerateContentParameters,
): Promise<BeforeToolSelectionHookResult>
```

**Return type:**
```typescript
interface BeforeToolSelectionHookResult {
  toolConfig?: ToolConfig;
  tools?: ToolListUnion;
}
```

**Logic:**
1. `config.getHookSystem()` → if undefined, return `{}`.
2. `await hookSystem.initialize()`
3. `hookSystem.getEventHandler().fireBeforeToolSelectionEvent(llmRequest)` → `AggregatedHookResult`
4. Extract `finalOutput` as `BeforeToolSelectionHookOutput`.
5. If `finalOutput` is undefined → return `{}`.
6. Extract `currentToolConfig` and `currentTools` from the `llmRequest` parameter. The `GenerateContentParameters` SDK type contains `config.toolConfig` (a `ToolConfig`) and `tools` (a `ToolListUnion`). These serve as the base values that the hook output modifies.
7. `const modified = finalOutput.applyToolConfigModifications({ toolConfig: currentToolConfig, tools: currentTools })`.
8. Return `{ toolConfig: modified.toolConfig, tools: modified.tools }`.

> **Parameter contract note:** The current trigger (`triggerBeforeToolSelectionHook`) accepts `_tools: unknown` but ignores it. The rewrite changes the parameter to `llmRequest: GenerateContentParameters`, which contains both the tool definitions and toolConfig. The `applyToolConfigModifications()` method on `BeforeToolSelectionHookOutput` modifies the `toolConfig` (mode and allowedFunctionNames) but does not filter the `tools` list itself — it returns the original tools unchanged. Tool restriction works through the `toolConfig.allowedFunctionNames` mechanism, not by removing tool definitions.

---

## 6. Caller Integration

### 6.1 coreToolScheduler.ts

**Current code (fire-and-forget):**
```typescript
void triggerBeforeToolHook(this.config, toolName, args);
// ... execute tool ...
void triggerAfterToolHook(this.config, toolName, args, toolResult);
```

**After rewrite — Option A (inline await):**
```typescript
const beforeOutput = await fireBeforeToolHook(this.config, toolName, args);
if (beforeOutput?.isBlockingDecision()) {
  // Build error ToolResult from beforeOutput.getBlockingError().reason
  // Buffer the error result and return
}
if (beforeOutput?.shouldStopExecution()) {
  // Build stop ToolResult, buffer, return
}

// ... execute tool ...

const afterOutput = await fireAfterToolHook(this.config, toolName, args, toolResponse);
if (afterOutput?.shouldStopExecution()) {
  // Buffer stop result and return
}
if (afterOutput?.getAdditionalContext()) {
  // Append to toolResult.llmContent
}
if (afterOutput?.systemMessage) {
  // Append as system-role context to toolResult.llmContent
  // so the model sees it alongside the tool result
  toolResult.llmContent += '

[System] ' + afterOutput.systemMessage;
}
```

**After rewrite — Option B (wrapper):**
```typescript
const toolResult = await executeToolWithHooks(
  this.config, toolName, args,
  () => invocation.execute(signal, liveOutputCallback, ...),
);
```

Option B is cleaner but requires adapting the scheduler's existing callback/buffering pattern. The trigger file exports both patterns so the scheduler integration can choose whichever fits.

### 6.2 geminiChat.ts

**Current code (fire-and-forget):**
```typescript
void triggerBeforeToolSelectionHook(configForHooks, toolsFromConfig);
void triggerBeforeModelHook(configForHooks, requestForHook);
// ... call model API ...
void triggerAfterModelHook(configForHooks, lastResponse);
```

**After rewrite:**
```typescript
// 1. Tool selection hook
const toolSelectionResult = await fireBeforeToolSelectionHook(configForHooks, fullRequest);
if (toolSelectionResult.toolConfig) {
  // Apply to the request's tool config
}
if (toolSelectionResult.tools) {
  // Replace the request's tools
}

// 2. Before model hook
const beforeModelResult = await fireBeforeModelHook(configForHooks, fullRequest);
if (beforeModelResult.blocked) {
  if (beforeModelResult.syntheticResponse) {
    // Yield synthetic response, skip model call
  } else {
    // Return empty/error response
  }
  return;
}
if (beforeModelResult.modifiedRequest) {
  fullRequest = beforeModelResult.modifiedRequest;
}

// 3. Call model API with (possibly modified) fullRequest
const response = await provider.generateChatCompletion(fullRequest);

// 4. After model hook
const afterModelResult = await fireAfterModelHook(configForHooks, fullRequest, response);
// Use afterModelResult.response (either modified or original)
```

#### systemMessage Application Contract

The `systemMessage` field can appear in hook outputs from any event. Callers apply it as follows:

- **Tool pipeline (`coreToolScheduler.ts`):** If `beforeOutput.systemMessage` or `afterOutput.systemMessage` is present, the message is appended to `toolResult.llmContent` as a system-role annotation (e.g., `"

[System] " + systemMessage`). This ensures the model sees the injected message alongside the tool result in the next turn. The `systemMessage` is **not** injected as a separate conversation turn — it rides on the existing tool result content.

- **Model pipeline (`geminiChat.ts`):** If `beforeModelResult` or `afterModelResult` includes a `systemMessage`, the caller appends it as an additional system-role `Content` entry to the request's `contents` array (for before-model) or stores it for inclusion in the next request turn (for after-model). The exact mechanism depends on whether the provider supports mid-conversation system messages; if not, the message is appended as a user-role annotation.

- **General rule:** `systemMessage` is always surfaced to the model. It is never displayed to the user as standalone UI output — it flows through the LLM context channel. Display-facing notifications should use the tool result's `returnDisplay` or a separate notification mechanism.

**Adapter concern:** The current `geminiChat.ts` builds `requestForHook` as `{ contents: IContent[], tools }` — the internal `IContent` format. After the rewrite, the triggers accept `GenerateContentParameters`. The caller must pass the SDK-typed request that it already has available from building `params.config`. The `HookEventHandler` handles translation internally via `hookTranslator`.

---

## 7. Type Contracts

### 7.1 Result Types (new, exported from geminiChatHookTriggers.ts)

```typescript
/** Returned by fireBeforeModelHook */
interface BeforeModelHookResult {
  blocked: boolean;
  reason?: string;
  syntheticResponse?: GenerateContentResponse;
  modifiedRequest?: GenerateContentParameters;
}

/** Returned by fireAfterModelHook */
interface AfterModelHookResult {
  response: GenerateContentResponse;
}

/** Returned by fireBeforeToolSelectionHook */
interface BeforeToolSelectionHookResult {
  toolConfig?: ToolConfig;
  tools?: ToolListUnion;
}
```

### 7.2 Existing Types (unchanged)

| Type | Source | Used by |
|---|---|---|
| `AggregatedHookResult` | `hookAggregator.ts` | `HookEventHandler` returns, trigger functions consume |
| `DefaultHookOutput` | `types.ts` | `fireBeforeToolHook` / `fireAfterToolHook` return type |
| `BeforeModelHookOutput` | `types.ts` | Cast from `AggregatedHookResult.finalOutput` for model events |
| `AfterModelHookOutput` | `types.ts` | Cast from `AggregatedHookResult.finalOutput` for after-model |
| `BeforeToolSelectionHookOutput` | `types.ts` | Cast from `AggregatedHookResult.finalOutput` for tool selection |
| `BeforeToolHookOutput` | `types.ts` | Used internally by aggregator for BeforeTool events |
| `HookInput` / `BeforeToolInput` / etc. | `types.ts` | Built by `HookEventHandler`, consumed by `HookRunner` |
| `HookOutput` | `types.ts` | Parsed from script stdout by `HookRunner` |
| `HookExecutionPlan` | `types.ts` | Created by `HookPlanner`, consumed by `HookRunner` |
| `HookExecutionResult` | `types.ts` | Created by `HookRunner`, consumed by `HookAggregator` |
| `LLMRequest` / `LLMResponse` / `HookToolConfig` | `hookTranslator.ts` | Stable hook API types for script stdin/stdout |
| `GenerateContentParameters` / `GenerateContentResponse` | `@google/genai` | SDK types used at caller boundaries |

### 7.3 Type Flow Through the Pipeline

```
Caller (SDK types)
  → fireBeforeModelHook(config, GenerateContentParameters)
    → HookEventHandler.fireBeforeModelEvent(GenerateContentParameters)
      → hookTranslator.toHookLLMRequest(GenerateContentParameters) → LLMRequest
      → hookTranslator.toHookLLMResponse(GenerateContentResponse) → LLMResponse  [AfterModel only]
      → HookRunner receives HookInput containing LLMRequest/LLMResponse
      → Script receives JSON on stdin in stable hook API format
      → Script writes JSON to stdout in stable hook API format
      → HookRunner parses stdout as HookOutput
      → HookAggregator merges HookOutputs → AggregatedHookResult
      → AggregatedHookResult.finalOutput = BeforeModelHookOutput (via createHookOutput)
    → BeforeModelHookOutput.applyLLMRequestModifications(GenerateContentParameters)
      → internally calls hookTranslator.fromHookLLMRequest() to convert back
    → BeforeModelHookOutput.getSyntheticResponse()
      → internally calls hookTranslator.fromHookLLMResponse() to convert back
  → Returns BeforeModelHookResult (SDK types)
Caller (SDK types)
```

The caller never touches `LLMRequest`/`LLMResponse` directly. The translator boundary is fully encapsulated within `HookEventHandler` + the output classes.

**Lossy round-trip behavior:** The translator (`HookTranslatorGenAIv1`) is intentionally lossy:
- `toHookLLMRequest()`: Only text parts are extracted from `Content.parts`. Non-text parts (inline data, function calls, function responses, file data) are dropped. Messages with no text content are omitted entirely. Safety settings and system instructions are not included in `LLMRequest`.
- `toHookLLMResponse()`: Only text parts are extracted from candidate content. Safety ratings lose the `blocked` field. `usageMetadata` fields beyond the three documented ones are dropped.
- `fromHookLLMRequest()`: Accepts a `baseRequest` parameter to preserve SDK fields that the hook format cannot represent (e.g., `tools`, `systemInstruction`, non-text content parts). The hook's modifications are merged onto the base request via spread.
- `fromHookLLMResponse()`: Reconstructs a `GenerateContentResponse` from the hook format. Non-text parts from the original response are **not preserved** — the response is rebuilt from text parts only.

**Non-goal:** Full-fidelity round-trip translation is explicitly a non-goal for v1. Hook scripts operate on a simplified text-only view of the LLM pipeline. If a hook modifies and returns an `llm_request`, the `baseRequest` merge strategy preserves most original fields. If a hook modifies and returns an `llm_response`, non-text parts (function calls, etc.) from the original response are lost. Implementers should be aware of this constraint when designing hooks that interact with tool-call-heavy conversations.

---

## 8. Message Bus Integration (Optional Extension)

> **Scope clarification:** Message bus integration is an **optional extension** that is NOT required for the core rewrite. The current hook system code has no message bus types or subscriptions. The core rewrite deliverable (§3–§6) uses direct function calls exclusively. This section documents a **future extension point** for decoupled hook triggering. The file manifest marks `confirmation-bus/types.ts` as "modify **if** message bus integration is included" — it is not a required deliverable.

The `MessageBus` (`packages/core/src/confirmation-bus/message-bus.ts`) supports typed pub/sub. The hook system integration would add two new message types:

### 8.1 New Message Types

```typescript
// Added to MessageBusType enum
HOOK_EXECUTION_REQUEST = 'hook-execution-request',
HOOK_EXECUTION_RESPONSE = 'hook-execution-response',

// Request message
interface HookExecutionRequest {
  type: MessageBusType.HOOK_EXECUTION_REQUEST;
  correlationId: string;
  eventName: HookEventName;
  payload: Record<string, unknown>;  // event-specific fields
}

// Response message
interface HookExecutionResponse {
  type: MessageBusType.HOOK_EXECUTION_RESPONSE;
  correlationId: string;
  result: AggregatedHookResult;
}
```

### 8.2 HookEventHandler as Subscriber

`HookEventHandler` subscribes to `HOOK_EXECUTION_REQUEST` during construction:

1. Receives request with `eventName` and `payload`.
2. Validates the `eventName` is a known `HookEventName`.
3. Routes to the appropriate `fire*Event()` method based on `eventName`.
4. Publishes `HOOK_EXECUTION_RESPONSE` with the `AggregatedHookResult`.

This enables components that don't have direct access to `HookSystem` (e.g., extensions, UI layer) to trigger hook events through the message bus.

### 8.3 Scope Note

Message bus integration is an extension point. The primary integration path (§5, §6) uses direct function calls. The message bus path exists for decoupled consumers and is not on the critical path for tool/model execution.

---

## 9. Error Handling

### 9.1 Error Hierarchy

```
Hook infrastructure error (HookSystem init failure, planner error)
  → Caught in fire*Event(), logged at warn level, returns empty success result
  → Caller sees undefined output, proceeds normally

Hook execution error (script crash, timeout, bad exit code)
  → Caught by HookRunner, returned as HookExecutionResult with success=false
  → HookAggregator includes in errors array but still produces finalOutput from successful hooks
  → Caller sees finalOutput from successful hooks (if any), proceeds normally

Hook output parse error (invalid JSON on exit 0)
  → Caught by HookRunner, stdout treated as systemMessage
  → HookAggregator treats as successful with decision='allow'

Trigger function error (any uncaught exception in fireBeforeToolHook etc.)
  → Caught in the trigger function's top-level try/catch
  → Returns safe default (undefined for tool hooks, { blocked: false } for model hooks)
```

### 9.2 Guarantees

- **No hook failure ever prevents tool execution or model calls.** The only way to block is an explicit block decision (exit code 2 or `decision: 'block'|'deny'`).
- **No hook failure ever throws to the caller.** Every public function in the trigger layer catches all exceptions.
- **Partial success is preserved.** If 3 hooks run and 1 fails, the outputs of the 2 successful hooks are aggregated and returned.

---

## 10. Telemetry

`HookEventHandler` logs at debug level for every event fire:

```
[llxprt:core:hooks:event-handler] BeforeTool fired for 'write_file': 2 hooks, 45ms, success
[llxprt:core:hooks:event-handler] BeforeModel fired: 1 hook, 120ms, success (modified request)
[llxprt:core:hooks:event-handler] BeforeTool fired for 'read_file': 0 hooks matched, skipped
```

The existing debug loggers in `HookRunner`, `HookPlanner`, and `HookRegistry` continue to operate at their current levels.

---

## 11. AfterModel Streaming Constraint

The current architecture processes model responses after the complete response is available (post-stream). The `GenerateContentResponse` passed to `fireAfterModelHook` represents the final aggregated response, not individual chunks.

`geminiChat.ts` collects `IContent` chunks via `for await (const iContent of streamResponse)`, then converts the last `IContent` to a `GenerateContentResponse` via `convertIContentToResponse()`. The AfterModel hook fires against this complete response.

Per-chunk hook processing (firing AfterModel for each streaming chunk) is a future optimization. The current spec fires AfterModel once per model call.

### 11.1 Streaming Interaction Details

**BeforeModel blocking and streaming:** When `fireBeforeModelHook` returns `blocked: true` with a `syntheticResponse`, the caller (`geminiChat.ts`) must skip the streaming API call entirely and instead yield the synthetic response directly. No stream is opened, no chunks are processed. If `blocked: true` without a `syntheticResponse`, the caller should return an empty/error response without streaming.

**BeforeModel request modification and streaming:** When `fireBeforeModelHook` returns a `modifiedRequest`, the caller uses the modified `GenerateContentParameters` for the streaming API call. The stream lifecycle (chunk collection, aggregation, error handling, retries) is unchanged — only the input to `provider.generateChatCompletion()` changes.

**AfterModel and response timing:** The AfterModel hook fires **after** all chunks have been streamed and the complete response is available. This means:
- The user has already seen streaming output by the time AfterModel fires
- AfterModel modifications (e.g., PII redaction) apply to the **stored/processed** version of the response, not to what was already displayed during streaming
- For display-critical modifications, the current architecture requires accepting this limitation. Per-chunk AfterModel processing is a future optimization (see §10, scope exclusions in overview.md)

**Impact on cookbook claims:** The PII Redaction recipe (usecaseexamples.md recipe #4) describes AfterModel-based redaction that "scrubs PII automatically before the response reaches the user." In practice, under the current post-stream architecture, the user will **already have seen** the unredacted streaming output by the time the AfterModel hook runs. The redaction applies to the stored/processed response used downstream (e.g., transcript, context for the next model call), but not to the real-time streaming display. Recipe #4's description ("before the response reaches the user") is aspirational and depends on future per-chunk AfterModel support. Hook authors building compliance-critical PII redaction should be aware of this gap.

**Metrics hooks:** The rewrite does not add metrics-specific hook events. Telemetry (§10) logs duration and success at debug level. If metrics hooks are needed, they should be a separate scope item.

---

## 12. File Manifest

| File | Action | Description |
|---|---|---|
| `packages/core/src/hooks/hookSystem.ts` | **Create** | HookSystem coordinator class |
| `packages/core/src/hooks/hookEventHandler.ts` | **Create** | Central event routing and input construction |
| `packages/core/src/hooks/hookSystem.test.ts` | **Create** | Tests for HookSystem |
| `packages/core/src/hooks/hookEventHandler.test.ts` | **Create** | Tests for HookEventHandler |
| `packages/core/src/hooks/index.ts` | **Modify** | Export HookSystem and HookEventHandler |
| `packages/core/src/config/config.ts` | **Modify** | Add `getHookSystem()` method, `hookSystem` field |
| `packages/core/src/core/coreToolHookTriggers.ts` | **Rewrite** | Replace fire-and-forget with result-returning functions |
| `packages/core/src/core/coreToolHookTriggers.test.ts` | **Rewrite** | Tests for new return-value semantics |
| `packages/core/src/core/geminiChatHookTriggers.ts` | **Rewrite** | Replace fake data / fire-and-forget with translator-backed, result-returning functions |
| `packages/core/src/core/geminiChatHookTriggers.test.ts` | **Rewrite** | Tests for new return-value semantics |
| `packages/core/src/core/coreToolScheduler.ts` | **Modify** | Await hook results instead of `void` fire-and-forget |
| `packages/core/src/core/geminiChat.ts` | **Modify** | Await hook results, apply modifications/blocks |
| `packages/core/src/confirmation-bus/types.ts` | **Modify** | Add HOOK_EXECUTION_REQUEST/RESPONSE types (if message bus integration is included) |

---

## 13. Invariants

1. **Single initialization.** `HookRegistry.initialize()` is called at most once per `Config` lifetime, via `HookSystem.initialize()`.

2. **No new infrastructure per call.** The rewritten trigger functions never construct `HookRegistry`, `HookPlanner`, `HookRunner`, or `HookAggregator`. They obtain these from `HookSystem` via `Config`.

3. **Translator is always used for model events.** `BeforeModel`, `AfterModel`, and `BeforeToolSelection` hook inputs are built using `defaultHookTranslator.toHookLLMRequest()` and `toHookLLMResponse()`. No manual `IContent` conversion or `{} as never` placeholders.

4. **Hook outputs are always consumed.** No `void` prefix on any hook trigger call after the rewrite. Every caller awaits the result and applies it.

5. **Fail-open is preserved.** The rewrite changes data flow but does not change error semantics. Every failure path returns a safe default that causes the agent to proceed normally.

6. **Existing hook scripts are unaffected.** The stdin JSON format, stdout JSON format, exit code semantics, environment variables, timeout behavior, and sequential chaining behavior are all unchanged. The only change visible to hook scripts is that their outputs now actually take effect.

7. **Type safety at boundaries.** Callers deal in SDK types (`GenerateContentParameters`, `GenerateContentResponse`). Scripts deal in stable hook API types (`LLMRequest`, `LLMResponse`). The translator converts at the `HookEventHandler` boundary. No raw type assertions cross module boundaries.
