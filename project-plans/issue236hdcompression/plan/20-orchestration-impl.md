# Phase 20: Orchestration — Implementation

## Phase ID

`PLAN-20260211-HIGHDENSITY.P20`

## Prerequisites

- Required: Phase 19 completed
- Verification: `grep -r "@plan:PLAN-20260211-HIGHDENSITY.P19" packages/core/src/core/__tests__/geminiChat-density.test.ts | wc -l` → ≥ 1
- Expected files from previous phase:
  - `packages/core/src/core/__tests__/geminiChat-density.test.ts` (tests written, most failing)
- Preflight verification: Phase 01a completed

## Requirements Implemented (Expanded)

### REQ-HD-002.1: Density Optimization Before Threshold Check

**Full Text**: When `ensureCompressionBeforeSend()` runs, the system shall call a density optimization step after settling token updates and before calling `shouldCompress()`.
**Behavior**:
- GIVEN: `ensureCompressionBeforeSend()` runs
- WHEN: Token updates are settled
- THEN: `ensureDensityOptimized()` executes before `shouldCompress()`
**Why This Matters**: Density optimization runs first, potentially avoiding full compression.

### REQ-HD-002.2: Conditional Optimization

**Full Text**: If the resolved strategy does not implement `optimize`, the density optimization step shall be skipped.
**Why This Matters**: Backward compatibility with existing strategies.

### REQ-HD-002.3: No-Op When Clean

**Full Text**: If the density dirty flag is `false`, skip optimization.
**Why This Matters**: Avoids unnecessary work.

### REQ-HD-002.4: DensityResult Application

**Full Text**: Apply non-empty DensityResult via `applyDensityResult()` and await token recalculation.
**Why This Matters**: History and token count must reflect density changes.

### REQ-HD-002.5: Empty Result Short-Circuit

**Full Text**: Don't call `applyDensityResult()` for empty results.
**Why This Matters**: Avoid unnecessary async work.

### REQ-HD-002.6: Dirty Flag Set On Content Add

**Full Text**: Set `densityDirty = true` when turn-loop content is added. NOT set by compression rebuild.
**Why This Matters**: The flag gates optimization.

### REQ-HD-002.7: Dirty Flag Cleared After Optimization

**Full Text**: Set `densityDirty = false` in `finally` block after optimization completes.
**Why This Matters**: Prevents redundant optimization.

### REQ-HD-002.8: Emergency Path Optimization

**Full Text**: Emergency path calls density optimization before compression.
**Why This Matters**: May free enough space without full compression.

### REQ-HD-002.9: Raw History Input

**Full Text**: `optimize()` receives raw history via `getRawHistory()`.
**Why This Matters**: Indices refer to raw array positions.

### REQ-HD-002.10: Sequential Turn-Loop Safety

**Full Text**: Only called from sequential pre-send window.
**Why This Matters**: No concurrent history mutations.

## Implementation Tasks

### Files to Modify

- `packages/core/src/core/geminiChat.ts`
  - REPLACE stub `ensureDensityOptimized()` with full implementation
  - ADD `this.densityDirty = true;` at turn-loop content add sites
  - ENSURE hook points from P18 remain correct
  - UPDATE plan markers: `@plan:PLAN-20260211-HIGHDENSITY.P20`
  - RETAIN P18 requirement markers, ADD pseudocode references

### Implementation Mapping (Pseudocode → Code)

#### densityDirty field — pseudocode orchestration.md lines 10–17

Already added in P18. No change needed.

#### Setting densityDirty = true — pseudocode orchestration.md lines 20–40

```
Lines 20-29: Identify all turn-loop add sites in GeminiChat
Lines 30-37: Set this.densityDirty = true at each site:
  - After adding user message to history
  - In recordHistory() where AI responses are added
  - After tool result is added to history
Lines 39-40: DO NOT set in performCompression() where clear()+add() rebuilds
```

**Implementation guidance**:
- Find all `this.historyService.add(...)` calls in GeminiChat
- Classify each as turn-loop (user input, AI response, tool result) vs compression-internal
- Add `this.densityDirty = true;` to turn-loop sites only
- DO NOT add to the loop inside `performCompression()` that rebuilds after compression

#### Dirty Flag Site Completeness Audit — geminiChat.ts turn-loop path

**MANDATORY**: Before implementation, audit ALL `add()` call sites in `geminiChat.ts` turn-loop path. List each site explicitly:

1. **User message send**: where the user's input message is added to history (e.g., `this.historyService.add(userMessage)`)
2. **AI response record**: where the model's response (text, tool calls) is recorded via `recordHistory()` or direct `add()`
3. **Tool response add**: where tool execution results are added back to history (e.g., after tool call processing)
4. **Any other turn-loop add sites** discovered during audit (e.g., system prompt updates, function call results)

For each site identified above:
- Add `this.densityDirty = true;` immediately after the `add()` call
- Document the line number in the Phase Completion Marker

**Verification** (run after implementation):
```bash
# Count all densityDirty = true sites — should match the number of turn-loop add sites
grep -n "densityDirty.*=.*true" packages/core/src/core/geminiChat.ts
# Expected: ≥ 3 sites (user message, AI response, tool result)

# Cross-check: count all historyService.add calls, subtract compression-internal ones
grep -n "historyService\.add\|this\.history.*\.add" packages/core/src/core/geminiChat.ts
# Manually verify each is either (a) followed by densityDirty = true, or (b) inside performCompression
```

#### ensureDensityOptimized() — pseudocode orchestration.md lines 50–99

```
Lines 51-53: Check densityDirty — if false, return early (REQ-HD-002.3)
Lines 55-60: TRY block — resolve strategy name, get strategy from factory
Lines 62-64: If !strategy.optimize → return early (REQ-HD-002.2)
Lines 66-73: Build DensityConfig from ephemerals:
  - readWritePruning: this.runtimeContext.ephemerals.densityReadWritePruning()
  - fileDedupe: this.runtimeContext.ephemerals.densityFileDedupe()
  - recencyPruning: this.runtimeContext.ephemerals.densityRecencyPruning()
  - recencyRetention: this.runtimeContext.ephemerals.densityRecencyRetention()
  - workspaceRoot: this.runtimeContext.config.getWorkspaceRoot()
Lines 75-76: Get raw history: this.historyService.getRawHistory() (REQ-HD-002.9)
Lines 78-79: Call strategy.optimize(history, config)
Lines 81-84: Check for empty result — if 0 removals and 0 replacements, log and return (REQ-HD-002.5)
Lines 86-95: Apply result:
  - Log metadata (removals count, replacements count)
  - await this.historyService.applyDensityResult(result) (REQ-HD-002.4)
  - await this.historyService.waitForTokenUpdates()
Lines 97-99: FINALLY block — this.densityDirty = false (REQ-HD-002.7)
```

#### ensureCompressionBeforeSend hook — pseudocode orchestration.md lines 110–144

Already wired in P18. Verify the call is in the correct position:
- After `waitForTokenUpdates()` (line ~1791)
- Before `shouldCompress()` (line ~1793)

#### enforceContextWindow hook — pseudocode orchestration.md lines 150–206

Already wired in P18 with re-check logic. No additional changes needed.

### Import Requirements

```typescript
// These imports may be needed (verify against existing):
import { parseCompressionStrategyName, getCompressionStrategy } from './compression/compressionStrategyFactory.js';
import type { DensityConfig } from './compression/types.js';
```

Note: `parseCompressionStrategyName` and `getCompressionStrategy` are likely already imported in geminiChat.ts for `performCompression()`. Verify and add `DensityConfig` type import if missing.

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-HIGHDENSITY.P20
 * @requirement REQ-HD-002.1, REQ-HD-002.2, REQ-HD-002.3, REQ-HD-002.4, REQ-HD-002.5, REQ-HD-002.7, REQ-HD-002.9
 * @pseudocode orchestration.md lines 50-99
 */
private async ensureDensityOptimized(): Promise<void> {
  // REAL implementation
}
```

### Anti-Patterns to Avoid (from pseudocode)

- **DO NOT** set `densityDirty = true` inside `applyDensityResult()` or `recalculateTotalTokens()` — creates infinite loop
- **DO NOT** set `densityDirty = true` inside `performCompression()` — compression rebuild is NOT new content
- **DO NOT** call `ensureDensityOptimized()` BEFORE `waitForTokenUpdates()` — token state must be settled first
- **DO NOT** hold the compression lock during density optimization — it runs outside the lock
- **DO NOT** call `ensureDensityOptimized()` from event handlers or callbacks — only from sequential pre-send window
- **DO NOT** skip the dirty flag check ("always optimize") — unnecessary async work on every send
- **DO NOT** clear `densityDirty` before running optimization — if it throws, flag would be wrong
- **DO NOT** use `getCurated()` for optimize input — use `getRawHistory()` for correct indices
- **DO NOT** call `optimize()` without building `DensityConfig` — strategy needs all config fields

## Verification Commands

### Automated Checks

```bash
# 1. ALL P19 orchestration tests pass
npm run test -- --run packages/core/src/core/__tests__/geminiChat-density.test.ts
# Expected: All pass, 0 failures

# 2. ALL previous phase tests still pass (no regression)
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-optimize.test.ts
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-compress.test.ts
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-settings.test.ts
# Expected: All pass, 0 failures

# 3. TypeScript compiles
cd packages/core && npx tsc --noEmit
# Expected: 0 errors

# 4. Full test suite passes
npm run test -- --run
# Expected: All pass

# 5. Plan markers updated to P20
grep -c "@plan.*HIGHDENSITY.P20" packages/core/src/core/geminiChat.ts
# Expected: ≥ 1

# 6. Pseudocode references for orchestration
grep -c "@pseudocode.*orchestration" packages/core/src/core/geminiChat.ts
# Expected: ≥ 1

# 7. densityDirty set at turn-loop sites
grep -c "this.densityDirty = true" packages/core/src/core/geminiChat.ts
# Expected: ≥ 2 (user message add, AI response add, possibly tool result add)

# 8. densityDirty cleared in finally
grep -A2 "finally" packages/core/src/core/geminiChat.ts | grep "densityDirty = false"
# Expected: ≥ 1

# 9. DensityConfig built from ephemerals
grep "densityReadWritePruning\|densityFileDedupe\|densityRecencyPruning\|densityRecencyRetention" packages/core/src/core/geminiChat.ts
# Expected: ≥ 4

# 10. getRawHistory used
grep "getRawHistory" packages/core/src/core/geminiChat.ts
# Expected: ≥ 1
```

### Structural Verification Checklist

- [ ] Previous phase markers present (P19)
- [ ] No skipped phases (P19 exists)
- [ ] All listed files created/modified
- [ ] Plan markers added to all changes
- [ ] Tests pass for this phase
- [ ] No "TODO" or "NotImplemented" in phase code

### Deferred Implementation Detection (MANDATORY)

```bash
# Check for TODO/FIXME/HACK in ensureDensityOptimized and surrounding code
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/core/geminiChat.ts | grep -i density
# Expected: No matches

# Check for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/core/geminiChat.ts | grep -i density
# Expected: No matches

# Check that ensureDensityOptimized is no longer a stub
grep -A5 "ensureDensityOptimized" packages/core/src/core/geminiChat.ts | grep -c "return;"
# Expected: 0 (early returns for clean/no-optimize are OK, but bare "return;" as only content is not)

# Check for empty/trivial implementations
grep -A10 "async ensureDensityOptimized" packages/core/src/core/geminiChat.ts | head -12
# Expected: Real logic, not just "return;"
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions

1. **Does the code DO what the requirement says?**
   - [ ] REQ-HD-002.1: ensureDensityOptimized called between waitForTokenUpdates and shouldCompress — verified by reading ensureCompressionBeforeSend
   - [ ] REQ-HD-002.2: strategy.optimize check → skip if missing — verified in ensureDensityOptimized body
   - [ ] REQ-HD-002.3: densityDirty check → skip if false — verified as first statement in method
   - [ ] REQ-HD-002.4: applyDensityResult called for non-empty result, waitForTokenUpdates follows — verified
   - [ ] REQ-HD-002.5: Empty result check (0 removals + 0 replacements) → skip apply — verified
   - [ ] REQ-HD-002.6: densityDirty = true at turn-loop add sites — verified by reading all add() call sites
   - [ ] REQ-HD-002.6: densityDirty NOT set in performCompression — verified by reading performCompression
   - [ ] REQ-HD-002.7: densityDirty = false in finally block — verified
   - [ ] REQ-HD-002.8: Hook in enforceContextWindow with re-check — verified (from P18)
   - [ ] REQ-HD-002.9: getRawHistory() used — verified in ensureDensityOptimized
   - [ ] REQ-HD-002.10: Only called from ensureCompressionBeforeSend and enforceContextWindow — verified by grep

2. **Is this REAL implementation, not placeholder?**
   - [ ] ensureDensityOptimized has full 5-step pipeline (dirty check, strategy resolve, optimize, apply, clear)
   - [ ] DensityConfig built from real ephemeral accessors
   - [ ] applyDensityResult and waitForTokenUpdates actually called
   - [ ] densityDirty wired to real content add sites
   - [ ] No NotYetImplemented, no stub returns

3. **Would the test FAIL if implementation was removed?**
   - [ ] Reverting to no-op → optimization tests fail (history unchanged for prunable content)
   - [ ] Removing dirty flag → clean skip tests fail
   - [ ] Removing apply → token count tests fail
   - [ ] Removing from emergency path → emergency tests fail

4. **Is the feature REACHABLE by users?**
   - [ ] User sets `compression.strategy` to `high-density` → factory creates HighDensityStrategy
   - [ ] On each send: ensureCompressionBeforeSend → ensureDensityOptimized → optimize() runs
   - [ ] Density optimization prunes stale reads, deduplicates files, trims recency
   - [ ] If tokens still over threshold, full compress() runs
   - [ ] Full end-to-end path is wired

5. **What's MISSING?**
   - [ ] Enriched compression prompts (REQ-HD-010) — separate future phase
   - [ ] Todo-aware summarization (REQ-HD-011) — separate future phase
   - [ ] Transcript fallback reference (REQ-HD-012) — separate future phase
   - [ ] Core high-density strategy and orchestration are COMPLETE after this phase

#### Feature Actually Works

```bash
# Run orchestration tests
npm run test -- --run packages/core/src/core/__tests__/geminiChat-density.test.ts 2>&1
# Expected: ALL tests pass with 0 failures
# Actual: [paste output]

# Run all HD tests (no regression)
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-optimize.test.ts 2>&1
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-compress.test.ts 2>&1
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-settings.test.ts 2>&1
# Expected: ALL pass
# Actual: [paste output]

# Full verification cycle
npm run test && npm run lint && npm run typecheck && npm run format && npm run build
# Expected: All pass
# Actual: [paste output]

# Manual integration test
node scripts/start.js --profile-load syntheticglm47 "write me a haiku"
# Expected: Runs successfully, no density-related errors
# Actual: [paste output]
```

#### Integration Points Verified

- [ ] `parseCompressionStrategyName` and `getCompressionStrategy` imported and callable
- [ ] `DensityConfig` type matches what HighDensityStrategy.optimize() expects
- [ ] `historyService.getRawHistory()` returns readonly IContent[] (matches optimize's input type)
- [ ] `historyService.applyDensityResult()` accepts DensityResult (type check)
- [ ] `historyService.waitForTokenUpdates()` awaitable after apply
- [ ] Ephemeral accessors (`densityReadWritePruning()` etc.) callable from geminiChat context
- [ ] `runtimeContext.config.getWorkspaceRoot()` available

#### Lifecycle Verified

- [ ] densityDirty initialized to `true` (first send always optimizes)
- [ ] Content add → densityDirty = true → ensureDensityOptimized → optimize → apply → densityDirty = false
- [ ] Next send without new content → densityDirty = false → skip optimization
- [ ] Compression does NOT re-dirty (clear+add in performCompression skipped)
- [ ] Error in optimize → densityDirty = false in finally → error propagated

#### Edge Cases Verified

- [ ] Empty history → optimize returns empty result → no apply → no error
- [ ] Strategy switch mid-session (e.g., from middle-out to high-density) → next send uses new strategy
- [ ] All density features disabled via settings → optimize returns empty result → no changes
- [ ] Very large history → optimize prunes, then compress runs if still over threshold
- [ ] Emergency path → density optimization frees space → compression skipped

## Success Criteria

- ALL P19 orchestration tests pass
- ALL previous HD tests pass (no regression)
- Full test suite passes
- TypeScript compiles and lints cleanly
- Deferred implementation detection clean
- ensureDensityOptimized is fully implemented (not a stub)
- densityDirty wired to all turn-loop content add sites
- DensityConfig built from real ephemeral accessors
- getRawHistory used for optimize input
- Pseudocode line references match implementation logic
- Manual integration test passes

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/core/geminiChat.ts`
2. P18 stubs restored (no-op ensureDensityOptimized)
3. Cannot proceed to Phase 21 until fixed

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P20.md`
Contents:
```markdown
Phase: P20
Completed: [timestamp]
Files Modified:
  - packages/core/src/core/geminiChat.ts [+N lines, -M lines]
Tests Passing:
  - geminiChat-density.test.ts: [count]
  - high-density-optimize.test.ts: [count]
  - high-density-compress.test.ts: [count]
  - high-density-settings.test.ts: [count]
Verification: [paste verification output]

## Implementation Trace
- densityDirty field: pseudocode orchestration.md lines 10-17 → [actual line]
- densityDirty = true sites: pseudocode lines 20-40 → [actual lines]
- ensureDensityOptimized(): pseudocode lines 50-99 → [actual line range]
- ensureCompressionBeforeSend hook: pseudocode lines 110-144 → [actual line] (P18)
- enforceContextWindow hook: pseudocode lines 150-206 → [actual line range] (P18)

## Core High-Density Status
- Strategy interface (trigger, optimize): COMPLETE (P03-P05)
- HistoryService (applyDensityResult, getRawHistory): COMPLETE (P06-P08)
- Optimize implementation (3 pruning passes): COMPLETE (P09-P11)
- Compress implementation (summarization, truncation): COMPLETE (P12-P14)
- Settings & factory: COMPLETE (P15-P17)
- Orchestration: COMPLETE (P18-P20)
- All NotYetImplemented stubs: REPLACED
- Remaining work: enriched prompts (REQ-HD-010), todo-aware (REQ-HD-011), transcript ref (REQ-HD-012)
```
