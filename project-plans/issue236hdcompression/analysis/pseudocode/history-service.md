# Pseudocode: HistoryService Additions

**Requirement Coverage**: REQ-HD-003.1 through REQ-HD-003.6, REQ-HD-001.6, REQ-HD-001.7

---

## Interface Contracts

### INPUTS
```typescript
// applyDensityResult receives:
interface DensityResult {
  removals: readonly number[];
  replacements: ReadonlyMap<number, IContent>;
  metadata: DensityResultMetadata;
}

// getRawHistory receives: nothing (no arguments)

// recalculateTotalTokens receives: nothing (uses internal state)
```

### OUTPUTS
```typescript
// applyDensityResult returns: Promise<void>
//   Side effects:
//   - this.history mutated (entries removed/replaced)
//   - this.totalTokens recalculated
//   - 'tokensUpdated' event emitted (from recalculateTotalTokens)

// getRawHistory returns: readonly IContent[]
//   - Read-only typed view of this.history
//   - NOT a copy — performance optimization
//   - Safe because optimize() is synchronous and runs in sequential window

// recalculateTotalTokens returns: Promise<void>
//   Side effects:
//   - this.totalTokens set to sum of all entry token estimates
//   - 'tokensUpdated' event emitted
```

### DEPENDENCIES
```typescript
// Internal (already available in HistoryService):
//   this.history: IContent[]
//   this.totalTokens: number
//   this.tokenizerLock: Promise<void>
//   this.estimateContentTokens(content, modelName): Promise<number>
//   this.emit('tokensUpdated', eventData): boolean
//   this.logger: DebugLogger

// External types (must be imported):
//   DensityResult from '../core/compression/types.js'
//   CompressionStrategyError from '../core/compression/types.js'
```

---

## Pseudocode: getRawHistory()

```
 10: METHOD getRawHistory(): READONLY ARRAY OF IContent
 11:   // Returns a read-only typed view of the backing array.
 12:   // No defensive copy — the readonly typing prevents mutation by callers.
 13:   // Safe because optimize() is synchronous and runs in the sequential
 14:   // turn-loop window where no concurrent mutations occur.
 15:   RETURN this.history AS READONLY ARRAY OF IContent
```

---

## Pseudocode: applyDensityResult()

```
 20: METHOD applyDensityResult(result: DensityResult): PROMISE<void>
 21:
 22:   // === VALIDATION PHASE ===
 23:
 24:   // V1: Check for duplicates in removals
 25:   LET removalSet = NEW Set(result.removals)
 26:   IF removalSet.size !== result.removals.length
 27:     THROW NEW CompressionStrategyError(
 28:       'DensityResult contains duplicate removal indices',
 29:       'DENSITY_INVALID_RESULT'
 30:     )
 31:
 32:   // V2: Check no index appears in both removals and replacements
 33:   FOR EACH index IN result.replacements.keys()
 34:     IF removalSet.has(index)
 35:       THROW NEW CompressionStrategyError(
 36:         'DensityResult conflict: index ${index} in both removals and replacements',
 37:         'DENSITY_CONFLICT'
 38:       )
 39:
 40:   // V3: Validate removal indices are within bounds
 41:   FOR EACH index IN result.removals
 42:     IF index < 0 OR index >= this.history.length
 43:       THROW NEW CompressionStrategyError(
 44:         'DensityResult removal index ${index} out of bounds [0, ${this.history.length})',
 45:         'DENSITY_INDEX_OUT_OF_BOUNDS'
 46:       )
 47:
 48:   // V4: Validate replacement indices are within bounds
 49:   FOR EACH index IN result.replacements.keys()
 50:     IF index < 0 OR index >= this.history.length
 51:       THROW NEW CompressionStrategyError(
 52:         'DensityResult replacement index ${index} out of bounds [0, ${this.history.length})',
 53:         'DENSITY_INDEX_OUT_OF_BOUNDS'
 54:       )
 55:
 56:   // === MUTATION PHASE ===
 57:
 58:   // M1: Apply replacements first — indices are stable (no length changes)
 59:   FOR EACH [index, replacement] IN result.replacements
 60:     this.history[index] = replacement
 61:     this.logger.debug('Density: replaced history entry', { index })
 62:
 63:   // M2: Sort removals in descending order
 64:   //     Reverse order preserves earlier indices during splice
 65:   LET sortedRemovals = COPY(result.removals).sort((a, b) => b - a)
 66:
 67:   // M3: Apply removals in reverse order
 68:   FOR EACH index IN sortedRemovals
 69:     this.history.splice(index, 1)
 70:     this.logger.debug('Density: removed history entry', { index })
 71:
 72:   this.logger.debug('Density: applied result', {
 73:     replacements: result.replacements.size,
 74:     removals: result.removals.length,
 75:     newHistoryLength: this.history.length,
 76:     metadata: result.metadata,
 77:   })
 78:
 79:   // === TOKEN RECALCULATION PHASE ===
 80:
 81:   // T1: Full recalculation through tokenizerLock
 82:   AWAIT this.recalculateTotalTokens()
```

---

## Pseudocode: recalculateTotalTokens()

```
 90: METHOD recalculateTotalTokens(): PROMISE<void>
 91:   // Enqueue a full recalculation on the tokenizerLock chain.
 92:   // This ensures no race with pending incremental updateTokenCount() calls.
 93:
 94:   this.tokenizerLock = this.tokenizerLock.then(ASYNC () =>
 95:     LET newTotal = 0
 96:     LET defaultModel = 'gpt-4.1'
 97:
 98:     FOR EACH entry IN this.history
 99:       LET entryTokens = AWAIT this.estimateContentTokens(entry, defaultModel)
100:       newTotal = newTotal + entryTokens
101:
102:     // Atomically update the total
103:     LET previousTotal = this.totalTokens
104:     this.totalTokens = newTotal
105:
106:     this.logger.debug('Density: recalculated total tokens', {
107:       previousTotal,
108:       newTotal,
109:       entryCount: this.history.length,
110:     })
111:
112:     // Emit event so listeners (shouldCompress, UI, etc.) see updated count
113:     this.emit('tokensUpdated', {
114:       totalTokens: this.getTotalTokens(),  // includes baseTokenOffset
115:       addedTokens: newTotal - previousTotal,
116:       contentId: null,  // full recalc, not a single content
117:     })
118:   )
119:
120:   RETURN this.tokenizerLock
```

---

## Integration Points

```
Line 15: getRawHistory() returns this.history directly (not a copy)
  - This is intentional — optimize() is synchronous and runs before any
    concurrent add() calls can occur.
  - The readonly typing prevents the strategy from mutating entries.
  - If the concurrency model ever changes (background tool execution,
    multi-agent writes), a defensive copy MUST be added here.

Line 25-26: Duplicate removal detection
  - The Set size check catches duplicate indices in the removals array.
  - Without this, applying splice(index, 1) twice for the same index
    would remove TWO different entries — one correct, one wrong.
  - This is NOT in the spec requirements but is a critical safety check.

Line 58-61: Replacements applied BEFORE removals
  - REQ-HD-003.2 mandates this order.
  - Replacements use direct index assignment (this.history[index] = ...)
    which does NOT change array length.
  - After all replacements, removal indices are still valid.

Line 65-70: Removals in reverse order
  - REQ-HD-003.3 mandates reverse index order.
  - splice(index, 1) shifts all subsequent elements down by 1.
  - Processing highest index first means earlier indices are unaffected.

Line 94-118: recalculateTotalTokens enqueues on tokenizerLock
  - This serializes with any pending updateTokenCount() calls.
  - The sequence in the orchestrator is:
    1. waitForTokenUpdates() — drain pending incremental updates
    2. applyDensityResult() — mutate + enqueue recalc on lock
    3. waitForTokenUpdates() — drain the recalc
  - This prevents overlap between incremental and full recalculation.

Line 96: Default model 'gpt-4.1'
  - Matches the default in existing updateTokenCount() (line 304 of HistoryService.ts).
  - Token estimation is approximate — exact model match is not critical.

Line 114: getTotalTokens() includes baseTokenOffset
  - getTotalTokens() returns this.totalTokens + this.baseTokenOffset.
  - The tokensUpdated event carries the offset-adjusted value, consistent
    with how existing updateTokenCount() emits.
```

---

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Make getRawHistory() return [...this.history] (defensive copy)
        WHY: The spec explicitly says no copy is needed for correctness in the
             sequential window. A copy of potentially hundreds of IContent entries
             is wasteful. The readonly typing is the contract.
[OK]    DO: Return this.history with readonly typing.

[ERROR] DO NOT: Call recalculateTotalTokens() outside the tokenizerLock chain
        WHY: If recalculation runs concurrently with incremental updateTokenCount(),
             the totalTokens field will be corrupted. MUST chain on tokenizerLock.
[OK]    DO: this.tokenizerLock = this.tokenizerLock.then(async () => { ... })

[ERROR] DO NOT: Use this.totalTokens = 0 then add incrementally in recalculate
        WHY: If recalculation is interrupted (e.g., estimateContentTokens throws
             for one entry), totalTokens would be left at a partial value.
             Accumulate into a local variable, then assign atomically.
[OK]    DO: let newTotal = 0; ... this.totalTokens = newTotal;

[ERROR] DO NOT: Import DensityResult from a relative path to the compression module
        WHY: HistoryService is in services/history/. Compression types are in
             core/compression/. The import path must be correct relative to
             the HistoryService file location.
[OK]    DO: import { DensityResult, CompressionStrategyError } from '../../core/compression/types.js'

[ERROR] DO NOT: Apply removals in ascending order
        WHY: splice(2, 1) makes former index 3 become index 2. If we then
             splice(3, 1), we remove what was formerly at index 4, not 3.
             This produces incorrect results.
[OK]    DO: Sort removals descending (b - a), then iterate.

[ERROR] DO NOT: Skip validation and trust the strategy to produce valid results
        WHY: A bug in any strategy's optimize() could produce overlapping indices,
             out-of-bounds indices, or duplicates. applyDensityResult() is the
             safety boundary — it MUST validate.
[OK]    DO: Validate all three invariants (no duplicates, no overlap, in bounds)
        before any mutation.

[ERROR] DO NOT: Call applyDensityResult() from event handlers or callbacks
        WHY: It modifies this.history directly. If called concurrently with add(),
             history corruption occurs. Only safe in the sequential pre-send window.
[OK]    DO: Only call from ensureDensityOptimized() in the turn-loop sequence.
```
