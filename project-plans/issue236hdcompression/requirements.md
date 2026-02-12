# Requirements — High Density Context

EARS (Easy Approach to Requirements Syntax) format.
Covers issue #236.

---

## REQ-HD-001: Strategy Interface Extension

### REQ-HD-001.1: Trigger Declaration
Every `CompressionStrategy` shall declare a `trigger` property of type
`StrategyTrigger`, which is either `{ mode: 'threshold'; defaultThreshold: number }`
or `{ mode: 'continuous'; defaultThreshold: number }`.

### REQ-HD-001.2: Optional Optimize Method
The `CompressionStrategy` interface shall include an optional `optimize` method
with signature `optimize(history: readonly IContent[], config: DensityConfig): DensityResult`.

### REQ-HD-001.3: Existing Strategy Trigger
The `MiddleOutStrategy`, `TopDownTruncationStrategy`, and `OneShotStrategy`
shall each declare `trigger: { mode: 'threshold', defaultThreshold: 0.85 }`.

### REQ-HD-001.4: Existing Strategy Compatibility
The `MiddleOutStrategy`, `TopDownTruncationStrategy`, and `OneShotStrategy`
shall not implement `optimize`. Their `compress` behavior shall remain unchanged.

### REQ-HD-001.5: DensityResult Structure
The `DensityResult` interface shall contain `removals` (readonly array of
indices), `replacements` (readonly map of index to `IContent`), and `metadata`
(of type `DensityResultMetadata`).

### REQ-HD-001.6: DensityResult Conflict Invariant
An index shall NOT appear in both `removals` and `replacements` within a
single `DensityResult`. `applyDensityResult()` shall throw if this invariant
is violated.

### REQ-HD-001.7: DensityResult Index Bounds
All indices in `removals` and `replacements` shall be within `[0, history.length)`.
`applyDensityResult()` shall throw if any index is out of bounds.

### REQ-HD-001.8: DensityResultMetadata
The `DensityResultMetadata` shall contain `readWritePairsPruned` (number),
`fileDeduplicationsPruned` (number), and `recencyPruned` (number).

### REQ-HD-001.9: DensityConfig Structure
The `DensityConfig` interface shall contain `readWritePruning` (boolean),
`fileDedupe` (boolean), `recencyPruning` (boolean), `recencyRetention`
(number), and `workspaceRoot` (string). All fields shall be `readonly`.

### REQ-HD-001.10: Threshold Precedence
Where an ephemeral or profile `compression-threshold` setting is set, the
system shall use that value. Where no setting is set, the system shall use
the strategy's `trigger.defaultThreshold`. Resolution order: ephemeral
override → profile setting → strategy default.

---

## REQ-HD-002: Orchestration

### REQ-HD-002.1: Density Optimization Before Threshold Check
When `ensureCompressionBeforeSend()` runs, the system shall call a density
optimization step after settling token updates and before calling
`shouldCompress()`.

### REQ-HD-002.2: Conditional Optimization
If the resolved strategy does not implement `optimize`, then the density
optimization step shall be skipped.

### REQ-HD-002.3: No-Op When Clean
If the density dirty flag is `false` (no new content added since last
optimization), then the density optimization step shall be skipped.

### REQ-HD-002.4: DensityResult Application
When `optimize()` returns a `DensityResult` with non-empty removals or
replacements, the system shall call `historyService.applyDensityResult()`
and await token recalculation before proceeding to the threshold check.

### REQ-HD-002.5: Empty Result Short-Circuit
When `optimize()` returns a `DensityResult` with zero removals and zero
replacements, the system shall not call `applyDensityResult()`.

### REQ-HD-002.6: Dirty Flag Set On Content Add
The density dirty flag shall be set to `true` when new content is added to
history via the turn loop (user messages, AI responses, tool results). It
shall NOT be set by compression or density-internal token recalculation.

### REQ-HD-002.7: Dirty Flag Cleared After Optimization
The density dirty flag shall be set to `false` after `ensureDensityOptimized()`
completes, regardless of whether optimization produced changes.

### REQ-HD-002.8: Emergency Path Optimization
The emergency compression path (projected tokens exceed hard context limit)
shall also call the density optimization step before attempting compression.

### REQ-HD-002.9: Raw History Input
The `optimize()` method shall receive the raw history array (via
`getRawHistory()`), not the curated view. `DensityResult` indices shall
refer to positions in the raw array.

### REQ-HD-002.10: Sequential Turn-Loop Safety
The `ensureDensityOptimized()` method shall only be called from the
sequential pre-send window (within `ensureCompressionBeforeSend`), where
no concurrent `historyService.add()` calls occur. The
`applyDensityResult()` method shall not be called from event handlers,
callbacks, or any context outside this sequential window.

---

## REQ-HD-003: HistoryService Changes

### REQ-HD-003.1: applyDensityResult Method
The `HistoryService` shall provide an `async applyDensityResult(result: DensityResult): Promise<void>`
method that applies replacements and removals to the raw history array.

### REQ-HD-003.2: Replacement Before Removal
`applyDensityResult()` shall apply replacements before removals, so that
removal indices are stable during the replacement pass.

### REQ-HD-003.3: Reverse-Order Removal
`applyDensityResult()` shall apply removals in reverse index order (highest
first), so that earlier indices remain stable during removal.

### REQ-HD-003.4: Token Recalculation
After applying removals and replacements, `applyDensityResult()` shall
trigger a full token recalculation through the existing `tokenizerLock`
promise chain.

### REQ-HD-003.5: getRawHistory Accessor
The `HistoryService` shall provide a `getRawHistory(): readonly IContent[]`
method that returns a read-only typed view of the backing history array.

### REQ-HD-003.6: recalculateTotalTokens
The `HistoryService` shall provide an async `recalculateTotalTokens()`
method that re-estimates tokens for all entries in the history, running
through the `tokenizerLock`.

---

## REQ-HD-004: High Density Strategy — Registration

### REQ-HD-004.1: Strategy Name
The `COMPRESSION_STRATEGIES` tuple shall include `'high-density'`.

### REQ-HD-004.2: Factory Registration
The compression strategy factory shall return a `HighDensityStrategy`
instance when `getCompressionStrategy('high-density')` is called.

### REQ-HD-004.3: Strategy Properties
The `HighDensityStrategy` shall declare `name` as `'high-density'`,
`requiresLLM` as `false`, and `trigger` as
`{ mode: 'continuous', defaultThreshold: 0.85 }`.

### REQ-HD-004.4: Settings Auto-Registration
When `'high-density'` is added to `COMPRESSION_STRATEGIES`, the
`compression.strategy` setting's `enumValues` shall automatically include
it (via the existing `[...COMPRESSION_STRATEGIES]` derivation).

---

## REQ-HD-005: READ → WRITE Pair Pruning

### REQ-HD-005.1: Stale Read Identification
When `readWritePruning` is enabled in `DensityConfig`, the `optimize()`
method shall identify tool calls where a file was read by a read tool and
subsequently written by a write tool later in history.

### REQ-HD-005.2: Read Tool Set
The system shall recognize the following as read tools: `read_file`,
`read_line_range`, `read_many_files`, `ast_read_file`.

### REQ-HD-005.3: Write Tool Set
The system shall recognize the following as write tools: `write_file`,
`ast_edit`, `replace`, `insert_at_line`, `delete_line_range`.

### REQ-HD-005.4: File Path Extraction
The system shall extract file paths from `ToolCallBlock.parameters` using
the keys `file_path`, `absolute_path`, or `path` (checked in that order).

### REQ-HD-005.5: Path Normalization
File paths shall be normalized using `path.resolve()` before comparison.
The strategy shall compare resolved paths exactly as returned, without
case folding.

### REQ-HD-005.6: Stale Read Removal
When a read tool call's file path has a later write tool call for the same
path, the read's tool response block and corresponding tool call block
shall be marked for removal.

### REQ-HD-005.7: Post-Write Reads Preserved
Read tool calls that occur after the latest write to the same file shall
NOT be marked for removal.

### REQ-HD-005.8: Block-Level Granularity
Where an `ai` speaker entry contains multiple tool call blocks and only
some are stale reads, the strategy shall replace the entry (removing only
the stale tool call blocks) rather than removing the entire entry. The
corresponding `tool` speaker entry shall have only the matching
`tool_response` blocks removed.

### REQ-HD-005.9: Multi-File Tool Handling
For `read_many_files`, only concrete file paths (no glob characters `*`,
`?`, `**`) shall be checked against the write map. If all concrete paths
have subsequent writes and no glob entries exist, the entry is removable.
Otherwise the entry shall be kept.

### REQ-HD-005.10: Disabled When Config False
When `readWritePruning` is `false` in `DensityConfig`, no READ→WRITE pair
pruning shall occur.

### REQ-HD-005.11: Workspace Root Resolution
Relative paths in tool parameters shall be resolved against
`DensityConfig.workspaceRoot`.

---

## REQ-HD-006: Duplicate `@` File Inclusion Dedup

### REQ-HD-006.1: Inclusion Detection
When `fileDedupe` is enabled in `DensityConfig`, the `optimize()` method
shall identify `@` file inclusions in human messages by matching the
`--- <filepath> ---` ... `--- End of content ---` delimiter pattern in
text blocks.

### REQ-HD-006.2: Latest Inclusion Preserved
When the same file path is `@`-included multiple times across different
human messages, the most recent inclusion shall be preserved. All earlier
inclusions of the same file shall have their file content portion removed.

### REQ-HD-006.3: Replacement Not Removal
Dedup shall use `replacements` (modified `IContent` with file content
stripped from text blocks) rather than `removals` (the human message may
contain other text that must be preserved).

### REQ-HD-006.4: Disabled When Config False
When `fileDedupe` is `false` in `DensityConfig`, no deduplication shall
occur.

### REQ-HD-006.5: Fail-Safe Heuristic
The delimiter matching shall require both opening (`--- filepath ---`) and
closing (`--- End of content ---`) markers. If markers do not pair
correctly, the text block shall be left unchanged.

---

## REQ-HD-007: Tool Result Recency Pruning

### REQ-HD-007.1: Recency Window
When `recencyPruning` is enabled in `DensityConfig`, the `optimize()` method
shall count tool responses per tool name walking history in reverse. For
each tool type, results beyond the `recencyRetention` count shall have their
response content replaced with a pointer string.

### REQ-HD-007.2: Pointer String
The replacement pointer string shall be:
`"[Result pruned — re-run tool to retrieve]"`.

### REQ-HD-007.3: Structure Preservation
Recency pruning shall use `replacements` (preserving tool call and tool
response structure). It shall NOT remove the `tool_call` or `tool_response`
entries — only the response payload content is replaced.

### REQ-HD-007.4: Default Retention
The default value for `recencyRetention` shall be 3.

### REQ-HD-007.5: Default Disabled
The default value for `recencyPruning` shall be `false`.

### REQ-HD-007.6: Disabled When Config False
When `recencyPruning` is `false` in `DensityConfig`, no recency pruning
shall occur.

---

## REQ-HD-008: Threshold Compression (compress)

### REQ-HD-008.1: No LLM Call
The `HighDensityStrategy.compress()` method shall not make any LLM calls.

### REQ-HD-008.2: Recent Tail Preservation
The `compress()` method shall preserve the recent tail of history, determined
by `preserveThreshold` from the runtime context (same as other strategies).

### REQ-HD-008.3: Tool Response Summarization
For tool responses outside the preserved tail, `compress()` shall replace
the full response payload with a compact one-line summary containing: tool
name, key parameters (file path or command), and outcome (success or error
status).

### REQ-HD-008.4: Non-Tool Content Preserved
All tool call blocks, human messages, and AI text blocks shall be preserved
intact by `compress()`.

### REQ-HD-008.5: CompressionResult Assembly
The `compress()` method shall return a `CompressionResult` with `newHistory`
containing the modified history and appropriate `metadata`.

### REQ-HD-008.6: Target Token Count
The `compress()` method shall target a post-compression token count of
approximately `compressionThreshold × contextLimit × 0.6`, providing
headroom before the next threshold trigger.

---

## REQ-HD-009: Settings

### REQ-HD-009.1: Read-Write Pruning Setting
The `SETTINGS_REGISTRY` shall include a spec for
`compression.density.readWritePruning` with type `boolean`, default `true`,
category `'cli-behavior'`, and `persistToProfile: true`.

### REQ-HD-009.2: File Dedupe Setting
The `SETTINGS_REGISTRY` shall include a spec for
`compression.density.fileDedupe` with type `boolean`, default `true`,
category `'cli-behavior'`, and `persistToProfile: true`.

### REQ-HD-009.3: Recency Pruning Setting
The `SETTINGS_REGISTRY` shall include a spec for
`compression.density.recencyPruning` with type `boolean`, default `false`,
category `'cli-behavior'`, and `persistToProfile: true`.

### REQ-HD-009.4: Recency Retention Setting
The `SETTINGS_REGISTRY` shall include a spec for
`compression.density.recencyRetention` with type `number`, default `3`,
category `'cli-behavior'`, and `persistToProfile: true`.

### REQ-HD-009.5: Runtime Accessors
The `AgentRuntimeContext` ephemerals interface shall provide accessors:
`densityReadWritePruning(): boolean`, `densityFileDedupe(): boolean`,
`densityRecencyPruning(): boolean`, `densityRecencyRetention(): number`.

### REQ-HD-009.6: Ephemeral Settings Types
The `EphemeralSettings` interface shall include optional fields for
`'compression.density.readWritePruning'` (boolean),
`'compression.density.fileDedupe'` (boolean),
`'compression.density.recencyPruning'` (boolean), and
`'compression.density.recencyRetention'` (number).

---

## REQ-HD-010: Enriched Compression Prompts

### REQ-HD-010.1: Task Context Section
The compression prompt template shall include a `<task_context>` section
instructing the LLM to capture, for each active task or todo item: why it
exists, what user request originated it, what constraints apply, what
approach was chosen, and what has been tried.

### REQ-HD-010.2: User Directives Section
The compression prompt template shall include a `<user_directives>` section
instructing the LLM to capture specific user feedback, corrections, and
preferences, using exact quotes where possible.

### REQ-HD-010.3: Errors Encountered Section
The compression prompt template shall include an `<errors_encountered>`
section instructing the LLM to record errors hit, exact messages, root
causes, and resolutions.

### REQ-HD-010.4: Code References Section
The compression prompt template shall include a `<code_references>` section
instructing the LLM to preserve important code snippets, exact file paths,
and function signatures.

### REQ-HD-010.5: Prompt File Update
The updated prompt sections shall be reflected in both `prompts.ts`
(`getCompressionPrompt()`) and the default prompt markdown file
(`compression.md` in `prompt-config/defaults/`).

---

## REQ-HD-011: Todo-Aware Summarization

### REQ-HD-011.1: CompressionContext Todo Field
The `CompressionContext` interface shall include an optional
`activeTodos?: readonly Todo[]` field.

### REQ-HD-011.2: Todo Population
When `buildCompressionContext()` assembles the context for compression, it
shall populate `activeTodos` from the current todo state if available.

### REQ-HD-011.3: Todo Inclusion in LLM Request
When an LLM-based strategy has `activeTodos` in its context, it shall append
the todo list to the compression request so the LLM can explain the context
behind each active todo in the summary.

### REQ-HD-011.4: Non-LLM Strategies Unaffected
Strategies where `requiresLLM` is `false` (including `HighDensityStrategy`)
shall ignore the `activeTodos` field.

---

## REQ-HD-012: Transcript Fallback Reference

### REQ-HD-012.1: CompressionContext Transcript Field
The `CompressionContext` interface shall include an optional
`transcriptPath?: string` field.

### REQ-HD-012.2: Transcript Pointer in Summary
Where `transcriptPath` is present, LLM-based strategies shall include a
note in the summary referencing the full pre-compression transcript path.

### REQ-HD-012.3: Low Priority
This requirement is low-priority and depends on the CLI layer exposing
the conversation log path to the core layer.

---

## REQ-HD-013: Failure Modes

### REQ-HD-013.1: Optimize Exception Propagation
If `strategy.optimize()` throws, the system shall propagate the error. The
density optimization step shall not silently swallow exceptions.

### REQ-HD-013.2: Apply Exception Propagation
If `historyService.applyDensityResult()` throws (due to conflict invariant
violation or bounds check), the system shall propagate the error.

### REQ-HD-013.3: Token Recalculation Failure
If token recalculation fails after density application, the system shall
propagate the error.

### REQ-HD-013.4: Compress Fallback Unchanged
The `HighDensityStrategy.compress()` failure behavior shall follow the
same pattern as existing strategies: propagate the error, no silent
fallback to a different strategy.

### REQ-HD-013.5: Malformed Tool Parameters
Where a tool call's `parameters` field is not an object or does not contain
a recognizable file path key, the strategy shall skip that tool call for
pruning purposes. It shall not throw.

### REQ-HD-013.6: Invalid Recency Retention
Where `recencyRetention` in `DensityConfig` is less than 1, the system
shall treat it as 1 (retain at least the most recent result per tool type).

### REQ-HD-013.7: Metadata Accuracy
The counts in `DensityResultMetadata` (`readWritePairsPruned`,
`fileDeduplicationsPruned`, `recencyPruned`) shall accurately reflect the
number of entries actually marked for removal or replacement by each
optimization pass.
