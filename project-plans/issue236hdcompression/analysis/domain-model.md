# Domain Model — High Density Context Compression

**Issue**: #236
**Plan Phase**: Phase 1 — Analysis

---

## 1. Entity Relationships

### Core Entities

```
CompressionStrategy (interface)
├── name: CompressionStrategyName
├── requiresLLM: boolean
├── trigger: StrategyTrigger
├── optimize?(history, config): DensityResult    ← NEW optional method
└── compress(context): Promise<CompressionResult>

StrategyTrigger (discriminated union)          ← NEW type
├── { mode: 'threshold', defaultThreshold: number }
└── { mode: 'continuous', defaultThreshold: number }

DensityResult                                  ← NEW type
├── removals: readonly number[]                   (indices into raw history)
├── replacements: ReadonlyMap<number, IContent>   (index → replacement)
└── metadata: DensityResultMetadata

DensityConfig                                  ← NEW type
├── readWritePruning: boolean
├── fileDedupe: boolean
├── recencyPruning: boolean
├── recencyRetention: number
└── workspaceRoot: string

DensityResultMetadata                          ← NEW type
├── readWritePairsPruned: number
├── fileDeduplicationsPruned: number
└── recencyPruned: number
```

### Strategy Hierarchy

```
CompressionStrategy
├── MiddleOutStrategy     (trigger: threshold, requiresLLM: true)
│   └── compress() → LLM sandwich compression
├── TopDownTruncationStrategy (trigger: threshold, requiresLLM: false)
│   └── compress() → drops oldest messages
├── OneShotStrategy       (trigger: threshold, requiresLLM: true)
│   └── compress() → LLM full-summary compression
└── HighDensityStrategy   (trigger: continuous, requiresLLM: false)  ← NEW
    ├── optimize() → deterministic pruning (removals + replacements)
    └── compress() → aggressive tool-response summarization
```

### Orchestration Entity Graph

```
GeminiChat (orchestrator)
├── owns historyService: HistoryService
├── owns runtimeContext: AgentRuntimeContext
├── owns runtimeState: AgentRuntimeState
├── owns densityDirty: boolean                  ← NEW field
├── owns compressionPromise: Promise | null
│
├── ensureCompressionBeforeSend()
│   ├── awaits compressionPromise
│   ├── awaits historyService.waitForTokenUpdates()
│   ├── calls ensureDensityOptimized()          ← NEW call
│   ├── calls shouldCompress()
│   └── calls performCompression()
│
├── ensureDensityOptimized()                    ← NEW method
│   ├── resolves strategy via factory
│   ├── checks strategy.optimize exists
│   ├── checks densityDirty flag
│   ├── builds DensityConfig from ephemerals
│   ├── calls strategy.optimize(rawHistory, config)
│   ├── calls historyService.applyDensityResult()
│   └── awaits historyService.waitForTokenUpdates()
│
├── enforceContextWindow() (emergency path)
│   └── should also call ensureDensityOptimized() ← NEW
│
└── buildCompressionContext()
    ├── reads historyService.getCurated()
    ├── builds CompressionContext
    ├── populates activeTodos (NEW optional field)
    └── populates transcriptPath (NEW optional field)
```

### HistoryService Additions

```
HistoryService
├── private history: IContent[]
├── private totalTokens: number
├── private tokenizerLock: Promise<void>
├── private isCompressing: boolean
│
├── add(content, modelName)           — pushes + updateTokenCount
├── clear()                           — empties + resets tokens
├── getAll()                          — returns copy of history
├── getCurated()                      — filters empty AI messages
├── waitForTokenUpdates()             — awaits tokenizerLock
├── startCompression() / endCompression()
│
├── getRawHistory(): readonly IContent[]           ← NEW
│   └── returns read-only typed view of this.history
├── applyDensityResult(result): Promise<void>      ← NEW
│   ├── validates no overlap between removals and replacements
│   ├── validates all indices in bounds
│   ├── applies replacements (preserves indices)
│   ├── applies removals in reverse order
│   └── calls recalculateTotalTokens()
└── recalculateTotalTokens(): Promise<void>        ← NEW
    └── re-estimates all entries via tokenizerLock
```

### Settings / Configuration Relationships

```
settingsRegistry (SETTINGS_REGISTRY array)
├── 'compression.strategy'                 — existing, enumValues auto-includes 'high-density'
├── 'compression.profile'                  — existing
├── 'compression.density.readWritePruning' — NEW (boolean, default true)
├── 'compression.density.fileDedupe'       — NEW (boolean, default true)
├── 'compression.density.recencyPruning'   — NEW (boolean, default false)
└── 'compression.density.recencyRetention' — NEW (number, default 3)

AgentRuntimeContext.ephemerals
├── compressionStrategy(): string          — existing
├── compressionThreshold(): number         — existing
├── compressionProfile(): string           — existing
├── densityReadWritePruning(): boolean     — NEW accessor
├── densityFileDedupe(): boolean           — NEW accessor
├── densityRecencyPruning(): boolean       — NEW accessor
└── densityRecencyRetention(): number      — NEW accessor
```

### Prompt / Summarization Relationships

```
CompressionContext (interface)
├── history: readonly IContent[]
├── runtimeContext, runtimeState, etc.  — existing
├── activeTodos?: readonly Todo[]       ← NEW optional field
└── transcriptPath?: string             ← NEW optional field

Compression Prompt (prompts.ts / compression.md)
├── <state_snapshot> (existing 5 sections)
├── <task_context>            ← NEW section
├── <user_directives>         ← NEW section
├── <errors_encountered>      ← NEW section
└── <code_references>         ← NEW section
```

---

## 2. State Transitions

### 2a. Dirty Flag Lifecycle

```
                    ┌─────────────────────────────────────────────┐
                    │                                             │
                    v                                             │
           ┌───────────────┐                                     │
  init ──> │ dirty = true  │ <── set on every historyService.add()
           │               │     called from turn-loop paths:
           └───────┬───────┘     - user message add
                   │              - AI response add
                   │              - tool result add
                   │              NOT set by:
                   │              - applyDensityResult internal mutations
                   │              - compression rebuild (clear + add)
                   │              - token recalculation events
                   │
                   v
           ┌───────────────────────┐
           │ ensureDensityOptimized│
           │ runs (before send)    │
           └───────┬───────────────┘
                   │
                   v
           ┌───────────────┐
           │ dirty = false  │ <── set in finally block of
           │               │     ensureDensityOptimized(),
           └───────────────┘     regardless of whether
                   │              optimization produced changes
                   │
                   │  (next turn: new content added)
                   │
                   └──────────> back to dirty = true
```

**Key invariant**: The dirty flag tracks *content* mutations, not token count changes. This prevents feedback loops where density optimization itself triggers another optimization.

### 2b. Compression Trigger Flow

```
Turn begins (user sends message)
  │
  ├── historyService.add(userMessage)  ──> densityDirty = true
  │
  v
ensureCompressionBeforeSend(prompt_id, pendingTokens, source)
  │
  ├── await compressionPromise (if prior compression still running)
  ├── await historyService.waitForTokenUpdates()
  │
  ├── [NEW] ensureDensityOptimized()
  │     ├── if !densityDirty → skip (no new content)
  │     ├── resolve strategy from ephemerals
  │     ├── if !strategy.optimize → skip (threshold-only strategy)
  │     ├── build DensityConfig from ephemerals
  │     ├── rawHistory = historyService.getRawHistory()
  │     ├── result = strategy.optimize(rawHistory, config)
  │     ├── if result is empty → skip apply
  │     ├── await historyService.applyDensityResult(result)
  │     ├── await historyService.waitForTokenUpdates()
  │     └── finally: densityDirty = false
  │
  ├── shouldCompress(pendingTokens)     ← checks post-optimization tokens
  │     ├── threshold = ephemerals.compressionThreshold()
  │     ├── contextLimit = ephemerals.contextLimit()
  │     ├── compressionThreshold = threshold × contextLimit
  │     └── return currentTokens >= compressionThreshold
  │
  ├── if shouldCompress:
  │     └── performCompression(prompt_id)
  │           ├── historyService.startCompression()
  │           ├── strategy.compress(context)
  │           ├── historyService.clear() + add each new entry
  │           ├── historyService.endCompression()
  │           └── await historyService.waitForTokenUpdates()
  │
  v
Continue to model call (sendMessage / sendMessageStream)
```

### 2c. Optimize → Compress Pipeline

```
optimize(rawHistory, densityConfig)
  │
  ├── Phase 1: READ→WRITE pair pruning (if enabled)
  │     └── produces removals[] + replacements (block-level edits)
  │
  ├── Phase 2: Duplicate @ file dedup (if enabled)
  │     └── produces replacements (text block edits)
  │
  ├── Phase 3: Recency pruning (if enabled)
  │     └── produces replacements (response payload swap)
  │
  └── Merge all phases → single DensityResult
        ├── union removals (no duplicates)
        ├── merge replacements (later phases see earlier edits)
        └── accumulate metadata counts

  ↓ applied via applyDensityResult()

compress(compressionContext)         ← only runs if still over threshold
  │
  ├── Determine preserve tail (preserveThreshold)
  ├── For tool responses outside tail:
  │     └── replace payload with one-line summary
  ├── Keep all tool calls, human messages, AI text
  ├── Target: threshold × contextLimit × 0.6
  └── Return CompressionResult
```

### 2d. applyDensityResult Mutation Sequence

```
applyDensityResult(result: DensityResult)
  │
  ├── VALIDATE: no index in both removals and replacements
  ├── VALIDATE: all removal indices in [0, history.length)
  ├── VALIDATE: all replacement indices in [0, history.length)
  │
  ├── STEP 1: Apply replacements (iterate replacements map)
  │     └── this.history[index] = replacement
  │     (indices stable — no length changes yet)
  │
  ├── STEP 2: Sort removals descending
  ├── STEP 3: Apply removals in reverse order
  │     └── this.history.splice(index, 1)
  │     (reverse order preserves earlier indices)
  │
  └── STEP 4: recalculateTotalTokens()
        └── enqueue on tokenizerLock, re-estimate all entries
```

---

## 3. Business Rules

### 3a. Pruning Rules

| Rule | Description | Condition |
|------|-------------|-----------|
| **BR-PRUNE-001** | A file read is stale if a write to the same path occurs later in history | `indexOfRead < indexOfLatestWrite` for same resolved path |
| **BR-PRUNE-002** | Both the tool_call block (in AI entry) and tool_response block (in tool entry) are removed for stale reads | Matched by `callId` |
| **BR-PRUNE-003** | Reads that occur after the latest write to the same file are NOT stale | `indexOfRead > indexOfLatestWrite` → preserved |
| **BR-PRUNE-004** | When an AI entry has mixed stale/non-stale tool_call blocks, only stale blocks are removed via replacement, not whole-entry removal | Use `replacements` to edit the entry, not `removals` |
| **BR-PRUNE-005** | File paths are normalized with `path.resolve()` before comparison — no case folding | OS-native case rules apply |
| **BR-PRUNE-006** | Relative paths resolved against `DensityConfig.workspaceRoot` | Enables consistent path matching |

### 3b. Dedup Rules

| Rule | Description |
|------|-------------|
| **BR-DEDUP-001** | `@` file inclusions detected by `--- <filepath> ---` … `--- End of content ---` delimiter pairs in human messages |
| **BR-DEDUP-002** | Only the most recent inclusion of a given file path is preserved; all earlier inclusions are stripped |
| **BR-DEDUP-003** | Stripping uses `replacements` (the human message text is edited), not `removals` (the message may contain other user text) |
| **BR-DEDUP-004** | Both opening and closing delimiters must match for an inclusion to be recognized — fail-safe heuristic |

### 3c. Recency Rules

| Rule | Description |
|------|-------------|
| **BR-RECENCY-001** | Tool responses counted per `toolName`, walking history in reverse |
| **BR-RECENCY-002** | Once count exceeds `recencyRetention`, older responses have payload replaced with pointer string `"[Result pruned — re-run tool to retrieve]"` |
| **BR-RECENCY-003** | Tool call and response structure preserved — only the `result` field is replaced |
| **BR-RECENCY-004** | Default off (`recencyPruning: false`); must be explicitly enabled |
| **BR-RECENCY-005** | `recencyRetention < 1` treated as 1 (always keep at least one) |

### 3d. Threshold Rules

| Rule | Description |
|------|-------------|
| **BR-THRESH-001** | Threshold precedence: ephemeral override → profile setting → strategy `trigger.defaultThreshold` |
| **BR-THRESH-002** | Existing strategies (MiddleOut, TopDown, OneShot) get `defaultThreshold: 0.85` |
| **BR-THRESH-003** | HighDensity gets `defaultThreshold: 0.85` |
| **BR-THRESH-004** | `compress()` target: `compressionThreshold × contextLimit × 0.6` tokens |
| **BR-THRESH-005** | `shouldCompress()` uses post-optimization token count (after density optimization) |

### 3e. Conflict / Consistency Rules

| Rule | Description |
|------|-------------|
| **BR-CONFLICT-001** | An index MUST NOT appear in both `removals` and `replacements` — `applyDensityResult()` throws |
| **BR-CONFLICT-002** | Composition order: READ→WRITE pruning → file dedup → recency pruning (deterministic) |
| **BR-CONFLICT-003** | Later phases see the logical state after earlier phases (but indices still refer to original raw history) |
| **BR-CONFLICT-004** | If pruning removes an entry that dedup would also modify, removal wins (removal is more aggressive) |
| **BR-CONFLICT-005** | Metadata counts are per-phase and must accurately reflect actual operations |

---

## 4. Edge Cases

### 4a. Empty / Minimal History

| Case | Expected Behavior |
|------|-------------------|
| **EC-001**: Empty history (0 entries) | `optimize()` returns empty DensityResult (no removals, no replacements). `compress()` returns empty newHistory. |
| **EC-002**: History with 1 entry | Same as EC-001 — no pairs to detect, no duplicates possible. |
| **EC-003**: History with only human messages (no tool calls) | READ→WRITE pruning finds nothing. Dedup may find `@` inclusions. Recency pruning finds nothing. |
| **EC-004**: History with only AI messages (no tool responses) | All pruning phases find nothing — no tool responses to prune. |

### 4b. Pruning Edge Cases

| Case | Expected Behavior |
|------|-------------------|
| **EC-010**: File read with no subsequent write | Read is NOT stale — preserved. |
| **EC-011**: Multiple reads of same file before a write | ALL reads before the write are stale and removed. |
| **EC-012**: Write followed by read followed by another write | The first read (between writes) IS stale (superseded by second write). The second read (if any, after second write) is preserved. |
| **EC-013**: AI entry with 3 tool_call blocks, only 1 is stale read | Entry is replaced with a version containing only 2 tool_call blocks. Corresponding tool entry has only the stale tool_response removed. |
| **EC-014**: `read_many_files` with mix of globs and concrete paths | Only concrete paths checked. If ANY concrete path has no subsequent write, or ANY glob entry exists, the entire entry is kept. |
| **EC-015**: `read_many_files` where all concrete paths have writes and no globs | Entire entry is removable. |
| **EC-016**: Tool call with unrecognizable parameters (not object, no file_path key) | Skipped — not thrown. Logged for debugging. |

### 4c. Dedup Edge Cases

| Case | Expected Behavior |
|------|-------------------|
| **EC-020**: `@` inclusion with only opening delimiter (no closing) | Not recognized — left unchanged. Fail-safe. |
| **EC-021**: Same file `@`-included 3 times | First two stripped, only last preserved. |
| **EC-022**: Human message with `@` inclusion AND other user text | Only the file content portion is stripped; surrounding user text preserved. Uses replacement. |
| **EC-023**: `--- filepath ---` pattern appears in user-authored text (not an inclusion) | If no matching closing delimiter, left unchanged. If both delimiters match, false positive — content may be incorrectly stripped. (Acceptable risk documented in spec.) |

### 4d. Recency Edge Cases

| Case | Expected Behavior |
|------|-------------------|
| **EC-030**: Only 2 results for a tool type, retention is 3 | All 2 results preserved — count < retention. |
| **EC-031**: `recencyRetention` set to 0 | Treated as 1 — at least the most recent result is kept. |
| **EC-032**: Same callId referenced by multiple response blocks | Each response block counted independently by its position in history. |

### 4e. Overlapping / Interaction Edge Cases

| Case | Expected Behavior |
|------|-------------------|
| **EC-040**: READ→WRITE pruning removes an entry that recency pruning would also modify | Removal wins — the entry is deleted. Recency pruning skips it. |
| **EC-041**: Dedup modifies a human message, then recency pruning also modifies tool responses in same entry | These operate on different entry types (human vs tool), so no conflict. |
| **EC-042**: All pruning produces zero results | `applyDensityResult` not called. `shouldCompress` proceeds with unchanged token count. |

### 4f. Malformed Data Edge Cases

| Case | Expected Behavior |
|------|-------------------|
| **EC-050**: `ToolCallBlock.parameters` is null | `extractFilePath` returns undefined — tool call skipped for pruning. |
| **EC-051**: `ToolCallBlock.parameters` is a string (not object) | Same — skipped. |
| **EC-052**: File path in parameters is empty string | After `path.resolve()`, resolves to workspace root — unlikely to match a write. Effectively skipped. |
| **EC-053**: AI entry with zero blocks after stale block removal | Entry becomes empty — use removal instead of replacement if all blocks would be removed. |

---

## 5. Error Scenarios

### 5a. Provider / Strategy Errors

| Scenario | Handling |
|----------|----------|
| **ERR-001**: Unknown strategy name in settings | `parseCompressionStrategyName()` throws `UnknownStrategyError`. Caught at call site. |
| **ERR-002**: `strategy.optimize()` throws | Error propagates from `ensureDensityOptimized()`. The density optimization step does not silently swallow exceptions (REQ-HD-013.1). |
| **ERR-003**: `strategy.compress()` throws | Error propagates from `performCompression()`. Same pattern as existing strategies (REQ-HD-013.4). |
| **ERR-004**: LLM provider fails during compress (for LLM strategies) | `CompressionExecutionError` thrown, propagated. Not relevant for HighDensityStrategy (no LLM). |

### 5b. Validation Errors

| Scenario | Handling |
|----------|----------|
| **ERR-010**: DensityResult has index in both removals and replacements | `applyDensityResult()` throws `CompressionStrategyError` with conflict details (REQ-HD-001.6). |
| **ERR-011**: DensityResult removal index out of bounds | `applyDensityResult()` throws `CompressionStrategyError` with bounds details (REQ-HD-001.7). |
| **ERR-012**: DensityResult replacement index out of bounds | Same as ERR-011. |
| **ERR-013**: Duplicate indices in removals array | Validation should detect and throw — applying same splice twice corrupts history. |

### 5c. Token Recalculation Errors

| Scenario | Handling |
|----------|----------|
| **ERR-020**: Token estimation fails for an entry during recalculation | Error propagates (REQ-HD-013.3). |
| **ERR-021**: `tokenizerLock` chain rejects | Promise rejection propagates through `waitForTokenUpdates()`. |
| **ERR-022**: Token recalculation yields nonsensical value (negative, NaN) | Defensive check — clamp to 0 minimum. |

### 5d. Concurrency / Timing Errors

| Scenario | Handling |
|----------|----------|
| **ERR-030**: `applyDensityResult` called during active compression | MUST NOT happen — `ensureDensityOptimized()` runs before `performCompression()` in the same sequential window. If this invariant is violated, history corruption occurs. |
| **ERR-031**: `ensureDensityOptimized` called from outside turn-loop window | Architectural violation. The method should only be called from `ensureCompressionBeforeSend()`. No runtime guard — relies on call-site discipline. |
| **ERR-032**: Two concurrent `ensureCompressionBeforeSend()` calls | Prevented by the existing `compressionPromise` serialization at the top of the method. |

---

## 6. Data Flow Diagram

```
User message
  │
  v
GeminiChat.sendMessageStream()
  │
  ├── historyService.add(userMessage)
  │     └── densityDirty = true
  │
  ├── ensureCompressionBeforeSend()
  │     │
  │     ├── await compressionPromise
  │     ├── await waitForTokenUpdates()
  │     │
  │     ├── ensureDensityOptimized()
  │     │     ├── resolve strategy
  │     │     ├── build DensityConfig
  │     │     ├── rawHistory = getRawHistory()
  │     │     ├── result = strategy.optimize(rawHistory, config)
  │     │     │     ├── pruneReadWritePairs() → removals, replacements
  │     │     │     ├── deduplicateFileInclusions() → replacements
  │     │     │     ├── pruneByRecency() → replacements
  │     │     │     └── merge → DensityResult
  │     │     ├── applyDensityResult(result)
  │     │     │     ├── validate
  │     │     │     ├── apply replacements
  │     │     │     ├── apply removals (reverse order)
  │     │     │     └── recalculateTotalTokens()
  │     │     └── await waitForTokenUpdates()
  │     │
  │     ├── shouldCompress(pendingTokens)
  │     │     └── currentTokens >= threshold * contextLimit?
  │     │
  │     └── if yes: performCompression()
  │           ├── startCompression()
  │           ├── strategy.compress(context)
  │           ├── clear() + add(newHistory entries)
  │           ├── endCompression()
  │           └── await waitForTokenUpdates()
  │
  v
Model call (streaming response)
  │
  ├── historyService.add(aiResponse)
  │     └── densityDirty = true
  │
  ├── tool calls executed
  │     └── historyService.add(toolResults)
  │           └── densityDirty = true
  │
  └── next turn...
```
