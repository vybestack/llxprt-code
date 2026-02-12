# High Density Context — Technical Specification

**Issue**: #236
**Companion**: [overview.md](./overview.md) (functional overview)
**Status**: Proposal

This document specifies the technical architecture, interface changes, and code
touchpoints for the High Density Context system. It is not an implementation
plan — it does not specify phase ordering, TDD steps, or verification commands.

---

## 1. Strategy Interface Extension

### Current Interface

`packages/core/src/core/compression/types.ts` (line 52):

```typescript
export interface CompressionStrategy {
  readonly name: CompressionStrategyName;
  readonly requiresLLM: boolean;
  compress(context: CompressionContext): Promise<CompressionResult>;
}
```

Every strategy today is threshold-triggered. The orchestrator in `geminiChat.ts`
checks `shouldCompress()` and then calls `strategy.compress()`. There is no
concept of a strategy doing work outside of the threshold trigger.

### Proposed Interface

```typescript
export interface CompressionStrategy {
  readonly name: CompressionStrategyName;
  readonly requiresLLM: boolean;
  readonly trigger: StrategyTrigger;

  /**
   * Deterministic density optimization. Called lazily before each threshold
   * check. Returns surgical edits to history — removals and replacements.
   * Strategies that only operate at threshold do not implement this.
   */
  optimize?(history: readonly IContent[], config: DensityConfig): DensityResult;

  /**
   * Full compression. Called when token count exceeds the configured
   * threshold. Receives the complete compression context and returns a
   * replacement history.
   */
  compress(context: CompressionContext): Promise<CompressionResult>;
}

type StrategyTrigger =
  | { mode: 'threshold'; defaultThreshold: number }
  | { mode: 'continuous'; defaultThreshold: number };
```

Both trigger modes carry a `defaultThreshold` because even continuous
strategies need a threshold for their `compress()` fallback. The difference
is whether `optimize()` runs before the check.

**Threshold precedence:** The existing ephemeral setting
`compressionThreshold()` (from `/set compression-threshold` or profile)
always takes priority. The strategy's `trigger.defaultThreshold` is only
used when the setting is absent or unset — it replaces the current
hardcoded `COMPRESSION_TOKEN_THRESHOLD` constant in `compression-config.ts`.
Resolution order: ephemeral override → profile setting → strategy default.

### DensityResult

```typescript
export interface DensityResult {
  /** Indices into the raw history array to remove entirely */
  removals: readonly number[];

  /** Indices to replace — maps raw history index to replacement IContent */
  replacements: ReadonlyMap<number, IContent>;

  /** Metadata for logging/debugging */
  metadata: DensityResultMetadata;
}
```

**Conflict policy:** An index MUST NOT appear in both `removals` and
`replacements`. If an entry needs its content changed, use `replacements`.
If it should be deleted entirely, use `removals`. The strategy is
responsible for producing consistent results. `applyDensityResult()` should
assert this invariant and throw if violated.

**Index validity:** All indices must be within `[0, history.length)`.
`applyDensityResult()` validates bounds before applying.

```typescript

export interface DensityResultMetadata {
  readWritePairsPruned: number;
  fileDeduplicationsPruned: number;
  recencyPruned: number;
}
```

### Impact on Existing Strategies

Existing strategies (`MiddleOutStrategy`, `TopDownTruncationStrategy`,
`OneShotStrategy`) gain a `trigger` property and do not implement `optimize`.
This is backward-compatible — the orchestrator checks for `optimize` before
calling it.

```typescript
// MiddleOutStrategy (no change to compress logic)
readonly trigger: StrategyTrigger = { mode: 'threshold', defaultThreshold: 0.85 };

// TopDownTruncationStrategy
readonly trigger: StrategyTrigger = { mode: 'threshold', defaultThreshold: 0.85 };

// OneShotStrategy
readonly trigger: StrategyTrigger = { mode: 'threshold', defaultThreshold: 0.85 };
```

### Touchpoints

- `packages/core/src/core/compression/types.ts` — add `StrategyTrigger`,
  `DensityResult`, `DensityResultMetadata`, update `CompressionStrategy`
- `packages/core/src/core/compression/MiddleOutStrategy.ts` — add `trigger`
- `packages/core/src/core/compression/TopDownTruncationStrategy.ts` — add `trigger`
- `packages/core/src/core/compression/OneShotStrategy.ts` — add `trigger`

---

## 2. Orchestration Changes in geminiChat.ts

### Current Flow

`packages/core/src/core/geminiChat.ts`:

1. `ensureCompressionBeforeSend()` (line 1777) — called before every
   `sendMessage`/`sendMessageStream`
2. `shouldCompress()` (line 1743) — checks `currentTokens >= threshold * contextLimit`
3. `performCompression()` (line 2011) — resolves strategy, builds context,
   calls `strategy.compress()`, replaces history

There is a second callsite at line 1980 — an emergency path when projected
tokens exceed the hard context limit. This path also calls
`performCompression()`.

### Proposed Flow

Insert a density optimization step before the threshold check:

```
ensureCompressionBeforeSend(prompt_id, pendingTokens, source)
  │
  ├── await existing compressionPromise (if any)
  ├── await historyService.waitForTokenUpdates()
  │
  ├── [NEW] ensureDensityOptimized()
  │     ├── resolve strategy from settings
  │     ├── if strategy.optimize exists:
  │     │     ├── call strategy.optimize(history, config)
  │     │     ├── apply DensityResult to HistoryService
  │     │     ├── await token recalculation
  │     │
  │
  ├── shouldCompress(pendingTokens)  ← now checks post-optimization tokens
  │     └── if true → performCompression()
  │
```

### New Method: ensureDensityOptimized()

```typescript
private async ensureDensityOptimized(): Promise<void> {
  const strategyName = parseCompressionStrategyName(
    this.runtimeContext.ephemerals.compressionStrategy(),
  );
  const strategy = getCompressionStrategy(strategyName);

  if (!strategy.optimize) {
    return; // threshold-only strategy, nothing to do
  }

  const config: DensityConfig = {
    readWritePruning: this.runtimeContext.ephemerals.densityReadWritePruning(),
    fileDedupe: this.runtimeContext.ephemerals.densityFileDedupe(),
    recencyPruning: this.runtimeContext.ephemerals.densityRecencyPruning(),
    recencyRetention: this.runtimeContext.ephemerals.densityRecencyRetention(),
    workspaceRoot: this.runtimeContext.config.getWorkspaceRoot(),
  };

  const history = this.historyService.getRawHistory();
  const result = strategy.optimize(history, config);

  if (result.removals.length === 0 && result.replacements.size === 0) {
    return; // nothing to optimize
  }

  await this.historyService.applyDensityResult(result);
  await this.historyService.waitForTokenUpdates();
}
```

### Raw vs. Curated History

`optimize()` operates on and returns indices against the **raw** history
array, not the curated view. `getCurated()` filters out empty AI messages —
if indices were computed against the curated output but applied to the raw
array, they would be misaligned. The strategy receives
`historyService.getRawHistory()` (a new read-only accessor) and the
`DensityResult` indices refer to positions in that array.
`applyDensityResult()` mutates the raw array directly.

`getCurated()` continues to filter as before — it sees the post-optimization
raw history.

`getRawHistory()` returns a read-only typed view of the backing array
(`readonly IContent[]`). Since `optimize()` is synchronous and runs in
the sequential turn-loop window where no concurrent mutations occur (see
Locking Considerations), a defensive copy is not required for correctness.
The `readonly` typing prevents accidental mutation by the strategy.

### Avoiding Redundant Optimization

The optimize step runs before every send. To avoid re-processing history that
hasn't changed, the orchestrator tracks a dirty flag:

```typescript
private densityDirty: boolean = true;
```

Set to `true` in geminiChat when new content is added to history (in the
methods that call `historyService.add()` for user messages, AI responses,
and tool results — not in the compression/density apply paths). Set to
`false` after `ensureDensityOptimized()` runs. The optimization is skipped
when the flag is `false`.

This flag is NOT driven by `tokensUpdated` events, because those fire
during token recalculation from density optimization itself. The dirty
flag tracks content mutations, not token count changes.

A single optimization pass is sufficient — density operations do not
create new pruning opportunities. Removing a stale read does not generate
new stale reads; removing a duplicate `@` inclusion does not create new
duplicates; pruning old tool results does not change recency counts. The
flag is intentionally set only on new content addition, not after density
edits.

### Locking Considerations

`ensureDensityOptimized()` runs **before** `startCompression()`. It does not
hold the compression lock. It modifies history through a new
`applyDensityResult()` method on HistoryService that handles token
recalculation atomically. This is safe because:

- It runs sequentially in `ensureCompressionBeforeSend`, which is awaited
- `ensureCompressionBeforeSend` is called from `sendMessage()` /
  `sendMessageStream()` in the turn loop. At this point the user's message
  has been added to history but the model has not yet responded — no tool
  calls are in flight, no tool responses are being added. The turn loop
  does not proceed to streaming/tool execution until after this method
  returns. This is the same concurrency guarantee that the existing
  `shouldCompress()` → `performCompression()` path relies on.
- Token updates from the user's most recent `add()` are settled via
  `waitForTokenUpdates()` before optimization runs, ensuring index
  stability and accurate token counts.
- If the `startCompression()/endCompression()` lock is held (a prior
  compression is still flushing), the existing `compressionPromise` await
  at the top of `ensureCompressionBeforeSend` blocks until it's done
  before optimization runs.

The `applyDensityResult()` method itself does not need the compression
lock because it runs in the same sequential window. However, it MUST NOT
be called from any other context (event handlers, callbacks, etc.).

**Why no formal lock is needed for the density window:**

The `startCompression()/endCompression()` mechanism exists because
`performCompression()` calls `historyService.clear()` and then `add()` in
a loop — during which, new tool responses from the turn loop could arrive
and call `add()`. The compression lock queues those adds until the rebuild
is complete.

Density optimization does not have this problem. It runs *before* the
model is called, so there are no in-flight tool calls producing responses.

Note: `client.ts` also calls `historyService.add()` / `addAll()` — this
is for session restore (loading persisted history on startup) and initial
context setup. These paths complete before the first turn begins and do
not run concurrently with the turn loop. The safety claim applies
specifically to the `ensureCompressionBeforeSend` window during active
turns, not to the entire application lifecycle.

If the architecture ever changes (e.g., background tool execution,
multi-agent concurrent history writes, or lazy session restore during
active turns), a density-specific lock would need to be added.

### Touchpoints

- `packages/core/src/core/geminiChat.ts` —
  - `ensureCompressionBeforeSend()` (line 1777): add `ensureDensityOptimized()`
    call after `waitForTokenUpdates()` and before `shouldCompress()`
  - New private method `ensureDensityOptimized()`
  - New private field `densityDirty`
  - `performCompression()` (line 2011): the strategy is resolved once here;
    its `trigger.defaultThreshold` could be used if no override is set
  - Emergency path (line 1980): should also call `ensureDensityOptimized()`
    before attempting compression

---

## 3. HistoryService: applyDensityResult()

### Current State

`packages/core/src/services/history/HistoryService.ts`:

- `add()` (line 241) — pushes to `this.history`, calls `updateTokenCount()`
- `clear()` (line 528) — empties history and resets tokens
- `getCurated()` (line 594) — returns filtered history (skips empty AI messages)
- `startCompression()`/`endCompression()` (lines 1483/1492) — lock/unlock
- `updateTokenCount()` (line 296) — async, behind `tokenizerLock`

There is no method for surgical removal or replacement of history entries.

### New Method

```typescript
async applyDensityResult(result: DensityResult): Promise<void> {
  // Validate: no index in both removals and replacements
  const removalSet = new Set(result.removals);
  for (const index of result.replacements.keys()) {
    if (removalSet.has(index)) {
      throw new Error(`DensityResult conflict: index ${index} in both removals and replacements`);
    }
  }

  // Validate bounds
  for (const index of result.removals) {
    if (index < 0 || index >= this.history.length) {
      throw new Error(`DensityResult removal index ${index} out of bounds [0, ${this.history.length})`);
    }
  }
  for (const index of result.replacements.keys()) {
    if (index < 0 || index >= this.history.length) {
      throw new Error(`DensityResult replacement index ${index} out of bounds [0, ${this.history.length})`);
    }
  }

  // Apply replacements first (preserves indices)
  for (const [index, replacement] of result.replacements) {
    this.history[index] = replacement;
  }

  // Apply removals in reverse order (preserves indices for earlier entries)
  const sortedRemovals = [...result.removals].sort((a, b) => b - a);
  for (const index of sortedRemovals) {
    this.history.splice(index, 1);
  }

  // Recalculate total tokens through the tokenizer lock
  await this.recalculateTotalTokens();
}
```

`recalculateTotalTokens()` re-estimates tokens for the entire history. This
is necessary because selective removal makes incremental bookkeeping fragile.
This method already needs to exist or be derived from the existing
`estimateContentTokens` path.

### Token Recalculation

The current system tracks tokens incrementally (add on push, set to 0 on
clear). Density optimization requires subtraction, which means either:

**Option A: Full recalculation** — re-estimate all entries. Simple, correct,
but O(n) on every optimization pass. Acceptable if optimization is infrequent
(once per turn, not per-add).

**Option B: Track per-entry tokens** — store each entry's token count so
removal can subtract precisely. More efficient but requires a parallel
`Map<number, number>` or extending IContent with a `tokenCount` field.

Option A is recommended for initial implementation. Optimization runs at most
once per turn and history size is bounded by the context window.

`recalculateTotalTokens()` is async and runs through the existing
`tokenizerLock` promise chain to avoid racing with pending incremental
updates.

### Token Recalculation Synchronization

`recalculateTotalTokens()` must run through the existing `tokenizerLock`
promise chain to avoid racing with any pending `updateTokenCount()` calls.
The sequence is:

1. `waitForTokenUpdates()` — drain the tokenizer lock (all pending
   incremental updates complete)
2. `applyDensityResult()` — mutate history (splice/replace)
3. `recalculateTotalTokens()` — enqueue a full recalc on `tokenizerLock`
4. `waitForTokenUpdates()` — drain again before proceeding

This ensures no overlap between incremental and full recalculation.

### Touchpoints

- `packages/core/src/services/history/HistoryService.ts` — new methods:
  `applyDensityResult()`, `recalculateTotalTokens()`, `getRawHistory()`
  (read-only accessor returning `readonly IContent[]`)
- `packages/core/src/services/history/HistoryEvents.ts` — no change needed
  (the existing `tokensUpdated` event fires after recalculation)

---

## 4. HighDensityStrategy Implementation

### Registration

`packages/core/src/core/compression/types.ts`:

```typescript
export const COMPRESSION_STRATEGIES = [
  'middle-out',
  'top-down-truncation',
  'one-shot',
  'high-density',
] as const;
```

`packages/core/src/core/compression/compressionStrategyFactory.ts`:

```typescript
case 'high-density':
  return new HighDensityStrategy();
```

`packages/core/src/settings/settingsRegistry.ts` (line 960): The setting
already uses `[...COMPRESSION_STRATEGIES]` for `enumValues`, so
`'high-density'` appears automatically.

### Strategy Properties

```typescript
class HighDensityStrategy implements CompressionStrategy {
  readonly name = 'high-density' as const;
  readonly requiresLLM = false;
  readonly trigger: StrategyTrigger = { mode: 'continuous', defaultThreshold: 0.85 };
}
```

### optimize() — Continuous Density Optimization

This method examines the full history and returns surgical removals and
replacements. It is deterministic and synchronous.

#### 4a. READ → WRITE Pair Pruning

**Algorithm:**

1. Walk history in reverse, building a `Map<string, number>` of file paths
   to their latest write index. "Write" tools: `write_file`, `ast_edit`,
   `replace`, `insert_at_line`, `delete_line_range`.
2. Walk history forward. For each tool response with a "read" tool
   (`read_file`, `read_line_range`, `read_many_files`, `ast_read_file`),
   extract the file path from the associated tool call's `parameters`.
3. If that file path has a later write in the map, mark the read's tool
   response (in the `tool` speaker entry) and the corresponding tool call
   block (in the preceding `ai` speaker entry) for removal.

**Identifying file paths from tool calls:**

`ToolCallBlock.parameters` (line 122 of IContent.ts) is typed as `unknown`.
Tool calls for file operations consistently use `file_path` or
`absolute_path` as the parameter key. The strategy needs a mapping:

```typescript
const READ_TOOLS = ['read_file', 'read_line_range', 'read_many_files', 'ast_read_file'];
const WRITE_TOOLS = ['write_file', 'ast_edit', 'replace', 'insert_at_line', 'delete_line_range'];

function extractFilePath(params: unknown): string | undefined {
  if (typeof params !== 'object' || params === null) return undefined;
  const p = params as Record<string, unknown>;
  return (p.file_path ?? p.absolute_path ?? p.path) as string | undefined;
}
```

**Path normalization:** File paths extracted from tool parameters must be
normalized before comparison. Paths may be relative or absolute and may
include `./` prefixes. The strategy should use `path.resolve()` to
canonicalize paths before building the write map and checking read paths
against it. Case sensitivity depends on the filesystem (APFS can be
either); the strategy should compare resolved paths exactly as returned
by `path.resolve()` without case folding.

**Multi-file tools:** `read_many_files` takes a `paths` array which may
contain concrete file paths or glob patterns. Only concrete paths (no
`*`, `?`, or `**` characters) can be checked against the write map. Glob
entries are ignored for pruning purposes since their expansion is not
preserved in tool parameters. If all concrete paths in the array have
subsequent writes and there are no glob entries, the entire tool
call/response is removable. Otherwise the entry is kept. Relative paths
in `read_many_files` are resolved against the workspace root (available
via the tool's configuration or from `CompressionContext.runtimeContext`).

**Block-level granularity:** An `ai` speaker entry can contain multiple
`tool_call` blocks. If some calls are reads-to-remove and others are not,
the entry cannot be removed wholesale. The strategy must remove only the
specific `tool_call` blocks that are stale, leaving the rest. Similarly, the
`tool` speaker entry may contain multiple `tool_response` blocks — only the
ones with matching `callId`s are removed.

#### 4b. Duplicate `@` File Inclusion Dedup

**Current representation:** The `@` command processor
(`packages/cli/src/ui/hooks/atCommandProcessor.ts`) inlines file content
into human messages as plain text blocks with `--- filename ---` delimiters.
There is no structured metadata on IContent identifying which parts are
`@` inclusions. The content looks like:

```
Look at this file
--- path/to/file.ts ---
<file content here>
--- End of content ---
```

**Algorithm:**

1. Walk human messages, identify text blocks matching the
   `--- <filepath> ---` pattern.
2. Build a `Map<string, number>` of file paths to their latest inclusion
   message index.
3. For earlier inclusions of the same file, remove the file content
   portion from the text block (or the entire block if it's only file
   content). Use `replacements` in the DensityResult.

**Limitation:** Because `@` inclusions are unstructured text, the pattern
matching is heuristic. If the format changes, the dedup breaks. The
delimiter pattern (`--- filepath ---`) could theoretically appear in
user-authored content, though this is unlikely in practice. A more robust
approach would be to add metadata to `IContent` when `@` inclusions are
processed at the CLI layer (`atCommandProcessor.ts`), making inclusions
structurally identifiable. This is a recommended follow-up — the current
heuristic approach works with the existing format and fails safe (worst
case: no dedup, not incorrect dedup, since the strategy only prunes when
both delimiter markers match and enclose content).

#### 4c. Tool Result Recency Pruning (optional)

**Algorithm:**

1. Walk history in reverse, counting tool responses per tool name.
2. For each tool type in the configurable set, once the count exceeds N
   (default 3), replace the response content with a pointer string.
3. Return replacements (not removals — the tool call and response structure
   are preserved, only the response payload is compacted).

**Configuration:** Controlled by ephemeral settings
`compression.density.recencyPruning` (boolean, default false) and
`compression.density.recencyRetention` (number, default 3). These are
checked inside `optimize()`.

### compress() — Threshold Compression

When the token count exceeds the threshold even after `optimize()`, the
strategy's `compress()` runs. This is a more aggressive deterministic pass:

1. Determine the recent tail to preserve (using `preserveThreshold` from
   runtime context, same as other strategies).
2. For all tool responses outside the tail, replace full result payloads
   with compact one-line summaries: tool name, key parameters (file path
   or command), and outcome (success/error status). Example:
   `"[read_file: src/index.ts — success, 245 lines]"`
3. Preserve all tool call blocks, human messages, and AI text blocks intact.
4. Return the result as `CompressionResult` with the new history.

**Target token count:** The compress phase targets approximately
`compressionThreshold × contextLimit × 0.6` tokens post-compression. At
the default 85% threshold, this yields ~51%, providing headroom before the
next trigger. This follows the same formula established for
`TopDownTruncationStrategy`.

### Touchpoints

- New file: `packages/core/src/core/compression/HighDensityStrategy.ts`
- New file: `packages/core/src/core/compression/HighDensityStrategy.test.ts`
- `packages/core/src/core/compression/types.ts` — add to tuple
- `packages/core/src/core/compression/compressionStrategyFactory.ts` — add case
- `packages/core/src/core/compression/index.ts` — add export

---

## 5. Settings and Configuration

### New Settings

Added to the settings registry
(`packages/core/src/settings/settingsRegistry.ts`, after line 976):

```typescript
{
  key: 'compression.density.readWritePruning',
  category: 'cli-behavior',
  description: 'Enable READ→WRITE pair pruning in high-density strategy',
  type: 'boolean',
  default: true,
  persistToProfile: true,
},
{
  key: 'compression.density.fileDedupe',
  category: 'cli-behavior',
  description: 'Enable duplicate @ file inclusion deduplication',
  type: 'boolean',
  default: true,
  persistToProfile: true,
},
{
  key: 'compression.density.recencyPruning',
  category: 'cli-behavior',
  description: 'Enable tool result recency pruning (keep last N per tool type)',
  type: 'boolean',
  default: false,
  persistToProfile: true,
},
{
  key: 'compression.density.recencyRetention',
  category: 'cli-behavior',
  description: 'Number of recent results to keep per tool type',
  type: 'number',
  default: 3,
  persistToProfile: true,
},
```

### Runtime Access

`packages/core/src/runtime/AgentRuntimeContext.ts` — add accessors to
`ephemerals`:

```typescript
densityReadWritePruning(): boolean;
densityFileDedupe(): boolean;
densityRecencyPruning(): boolean;
densityRecencyRetention(): number;
```

`packages/core/src/runtime/createAgentRuntimeContext.ts` — wire the
accessors to resolve from live settings with defaults.

### Strategy Access to Settings

The `optimize()` method receives `readonly IContent[]` — it does not
receive `CompressionContext`. The strategy needs access to the density
settings to know which optimizations are enabled.

**Options:**

**A.** Pass a `DensityConfig` alongside history in `optimize()`:
```typescript
optimize?(history: readonly IContent[], config: DensityConfig): DensityResult;
```

**B.** The strategy reads settings at construction time (from the factory).

**C.** The strategy is configured via its constructor — the factory passes
settings when creating the instance.

Option A is cleanest — it keeps the strategy stateless and testable. The
orchestrator builds the config from ephemeral settings and passes it in.

```typescript
export interface DensityConfig {
  readonly readWritePruning: boolean;
  readonly fileDedupe: boolean;
  readonly recencyPruning: boolean;
  readonly recencyRetention: number;
  readonly workspaceRoot: string;
}
```

### Touchpoints

- `packages/core/src/settings/settingsRegistry.ts` — add 4 settings
- `packages/core/src/runtime/AgentRuntimeContext.ts` — add 4 accessors to
  ephemerals interface
- `packages/core/src/runtime/createAgentRuntimeContext.ts` — wire accessors
- `packages/core/src/types/modelParams.ts` — add optional fields to
  `EphemeralSettings` if needed for profile persistence

---

## 6. Enriched Summarization (Layer 3)

### Compression Prompt Enhancement

**Current prompt:** `packages/core/src/core/prompts.ts`,
`getCompressionPrompt()` (line 379). Produces a `<state_snapshot>` with 5
sections.

**Also loadable from:** `packages/core/src/prompt-config/defaults/compression.md`
via the `PromptResolver` hierarchy. Strategies that use prompts (MiddleOut,
OneShot) resolve prompts via `promptResolver.resolveFile()`.

**Proposed additions** to the prompt template (either in `prompts.ts` or
in the prompt markdown files):

```xml
<task_context>
    <!-- For each active task or todo item, explain WHY it exists:
         what user request originated it, what constraints apply,
         what approach was chosen, and what has been tried so far. -->
</task_context>

<user_directives>
    <!-- Specific user feedback, corrections, and preferences that
         must be honored going forward. Include exact quotes where
         possible. -->
</user_directives>

<errors_encountered>
    <!-- Errors hit during the session: exact messages, root causes,
         resolutions. Prevents repeating the same mistakes. -->
</errors_encountered>

<code_references>
    <!-- Important code snippets, file paths, and function signatures.
         Prefer exact content over prose descriptions. -->
</code_references>
```

### Todo-Aware Summarization

The todo list is managed outside the conversation context — via `todo_write`
/ `todo_read` tool calls. The model interacts with todos through the tool
interface. Todo state is defined in
`packages/core/src/tools/todo-schemas.ts`:
`{ id, content, status, subtasks }`.

After compression, the `TodoReminderService`
(`packages/core/src/services/todo-reminder-service.ts`) re-injects the
todo list as a system note, but only as terse JSON
(`[{"content": "...", "status": "...", "id": "..."}]`) — no context about
*why* each item exists.

**Proposal:** When `buildCompressionContext()` assembles the context for an
LLM strategy, include the current todo list. The strategy (or the prompt)
instructs the LLM to explain the context behind each active todo in the
summary. This way the summary bridges the persistent todo list to the
conversation it came from.

**Implementation:** The `CompressionContext` interface gains an optional
`activeTodos` field:

```typescript
export interface CompressionContext {
  // ... existing fields ...
  readonly activeTodos?: readonly Todo[];
}
```

`buildCompressionContext()` in `geminiChat.ts` (line 2046) would populate
this from the todo state if available. The todo state is accessible — the
`TodoContextTracker` (`packages/core/src/services/todo-context-tracker.ts`)
tracks the active session, and the todo list itself flows through the
`TodoEventEmitter` (`packages/core/src/tools/todo-events.ts`).

LLM strategies that use prompts would append the todo list to the
compression request when `activeTodos` is present.

### Transcript Fallback Reference

After compression, the summary message can include a pointer to the full
pre-compression conversation log. The conversation log path is managed at
the CLI level — the core layer does not currently expose it.

**Implementation:** Add an optional `transcriptPath` to `CompressionContext`.
If present, LLM strategies append to the summary:
`"Full pre-compression transcript available at: <path>"`.

This is a low-priority enhancement that depends on the CLI exposing the
log path to the core layer.

### Touchpoints

- `packages/core/src/core/prompts.ts` — update `getCompressionPrompt()` with
  new sections
- `packages/core/src/prompt-config/defaults/compression.md` — update default
  prompt file
- `packages/core/src/core/compression/types.ts` — add `activeTodos?` and
  `transcriptPath?` to `CompressionContext`
- `packages/core/src/core/geminiChat.ts` `buildCompressionContext()` (line
  2046) — populate `activeTodos`
- `packages/core/src/core/compression/MiddleOutStrategy.ts` — use
  `activeTodos` in compression request assembly
- `packages/core/src/core/compression/OneShotStrategy.ts` — same

---

## 7. File Map Summary

| File | Change Type | Purpose |
|------|-------------|---------|
| `compression/types.ts` | Modify | Add `StrategyTrigger`, `DensityResult`, `DensityConfig`, `optimize?` to interface, `'high-density'` to tuple, `activeTodos?` to context |
| `compression/HighDensityStrategy.ts` | New | Strategy implementation with `optimize()` and `compress()` |
| `compression/HighDensityStrategy.test.ts` | New | Behavioral tests |
| `compression/compressionStrategyFactory.ts` | Modify | Add `'high-density'` case |
| `compression/index.ts` | Modify | Export new strategy |
| `compression/MiddleOutStrategy.ts` | Modify | Add `trigger` property, use `activeTodos` |
| `compression/TopDownTruncationStrategy.ts` | Modify | Add `trigger` property |
| `compression/OneShotStrategy.ts` | Modify | Add `trigger` property, use `activeTodos` |
| `core/geminiChat.ts` | Modify | Add `ensureDensityOptimized()`, dirty flag, call in `ensureCompressionBeforeSend()` |
| `core/prompts.ts` | Modify | Add new `<state_snapshot>` sections |
| `services/history/HistoryService.ts` | Modify | Add `applyDensityResult()`, `recalculateTotalTokens()`, `getRawHistory()` |
| `settings/settingsRegistry.ts` | Modify | Add 4 density settings |
| `runtime/AgentRuntimeContext.ts` | Modify | Add 4 density accessors |
| `runtime/createAgentRuntimeContext.ts` | Modify | Wire density accessors |
| `prompt-config/defaults/compression.md` | Modify | Update default prompt |
