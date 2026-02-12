# Phase 20a: Orchestration — Implementation Verification

## Phase ID

`PLAN-20260211-HIGHDENSITY.P20a`

## Purpose

Verify the orchestration implementation from P20 is complete, all P19 tests pass, density optimization is fully integrated into the GeminiChat send pipeline, and the core high-density compression feature is end-to-end functional.

## Structural Checks

```bash
# 1. TypeScript compiles cleanly
cd packages/core && npx tsc --noEmit
# Expected: 0 errors

# 2. Plan markers updated to P20
grep -c "@plan.*HIGHDENSITY.P20" packages/core/src/core/geminiChat.ts
# Expected: ≥ 1

# 3. Pseudocode references for orchestration
grep -c "@pseudocode.*orchestration" packages/core/src/core/geminiChat.ts
# Expected: ≥ 1

# 4. No deferred work in density code
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/core/geminiChat.ts | grep -i density
# Expected: No matches

# 5. No cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/core/geminiChat.ts | grep -i density
# Expected: No matches

# 6. ensureDensityOptimized is not a stub
grep -A15 "async ensureDensityOptimized" packages/core/src/core/geminiChat.ts | grep -c "densityDirty\|optimize\|applyDensityResult"
# Expected: ≥ 3 (real logic referencing these)
```

## Behavioral Verification

### All Tests Pass

```bash
# P19 orchestration tests — primary verification
npm run test -- --run packages/core/src/core/__tests__/geminiChat-density.test.ts
# Expected: All pass, 0 failures

# All HD tests — regression check
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-optimize.test.ts
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-compress.test.ts
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-settings.test.ts
# Expected: All pass, 0 failures
```

### Full Suite Regression

```bash
# Full test suite
npm run test -- --run 2>&1 | tail -10
# Expected: All pass

# Lint
npm run lint
# Expected: 0 errors

# Typecheck
npm run typecheck
# Expected: 0 errors

# Format
npm run format
# Expected: No changes

# Build
npm run build
# Expected: Success

# Manual integration test
node scripts/start.js --profile-load syntheticglm47 "write me a haiku"
# Expected: Runs successfully
```

### Pseudocode Compliance Verification

The verifier MUST read `geminiChat.ts` and compare against `analysis/pseudocode/orchestration.md`:

#### densityDirty field — pseudocode lines 10–17

- [ ] `private densityDirty: boolean = true` — initialized to true
- [ ] Field is a class property on GeminiChat

#### densityDirty = true sites — pseudocode lines 20–40

- [ ] Set at user message add site(s)
- [ ] Set at AI response record site(s)
- [ ] Set at tool result add site(s)
- [ ] NOT set inside `performCompression()` clear+add loop
- [ ] NOT set inside `applyDensityResult()` or after density operations

#### ensureDensityOptimized() — pseudocode lines 50–99

- [ ] **Line 52**: Dirty check — `if (!this.densityDirty) return`
- [ ] **Lines 57-60**: Strategy resolution — parseCompressionStrategyName + getCompressionStrategy
- [ ] **Lines 62-64**: Optimize check — `if (!strategy.optimize) return`
- [ ] **Lines 67-73**: DensityConfig built from 5 ephemeral accessors
- [ ] **Line 76**: Raw history — `this.historyService.getRawHistory()`
- [ ] **Line 79**: `strategy.optimize(history, config)` called
- [ ] **Lines 82-84**: Empty result check — 0 removals AND 0 replacements → return
- [ ] **Lines 87-91**: Debug logging with removals count, replacements count, metadata
- [ ] **Line 94**: `await this.historyService.applyDensityResult(result)`
- [ ] **Line 95**: `await this.historyService.waitForTokenUpdates()`
- [ ] **Lines 97-99**: `finally { this.densityDirty = false }`

#### ensureCompressionBeforeSend — pseudocode lines 110–144

- [ ] Call order: waitForTokenUpdates → ensureDensityOptimized → shouldCompress
- [ ] No other calls between waitForTokenUpdates and ensureDensityOptimized
- [ ] No other calls between ensureDensityOptimized and shouldCompress

#### enforceContextWindow — pseudocode lines 150–206

- [ ] ensureDensityOptimized called before performCompression
- [ ] waitForTokenUpdates after optimization
- [ ] postOptProjected recalculated
- [ ] Early return if postOptProjected <= marginAdjustedLimit
- [ ] Falls through to performCompression if still over limit

### Anti-Pattern Verification

- [ ] No densityDirty = true in performCompression
- [ ] No densityDirty = true in applyDensityResult path
- [ ] No densityDirty = true in recalculateTotalTokens path
- [ ] ensureDensityOptimized is NOT called before waitForTokenUpdates
- [ ] No compression lock held during density optimization
- [ ] ensureDensityOptimized NOT called from event handlers or callbacks
- [ ] densityDirty cleared in finally (not before try)
- [ ] getRawHistory used (not getCurated)

### Import Verification

- [ ] DensityConfig type imported (or constructed inline)
- [ ] parseCompressionStrategyName and getCompressionStrategy available (likely already imported)
- [ ] No circular imports introduced
- [ ] All existing imports preserved

## End-to-End Integration Verification

The verifier MUST trace the complete user flow:

### Complete Data Flow

1. **User sets strategy**: `/set compression.strategy high-density`
   - [ ] Settings service stores value
   - [ ] `ephemerals.compressionStrategy()` returns `'high-density'`

2. **User sends message**: New content added to history
   - [ ] `historyService.add()` called
   - [ ] `this.densityDirty = true` set

3. **Pre-send pipeline**: `ensureCompressionBeforeSend()` runs
   - [ ] `waitForTokenUpdates()` settles tokens
   - [ ] `ensureDensityOptimized()` runs:
     - [ ] densityDirty is true → proceed
     - [ ] Strategy resolved to HighDensityStrategy → has optimize method
     - [ ] DensityConfig built from 4 density settings + workspaceRoot
     - [ ] `getRawHistory()` called
     - [ ] `optimize(history, config)` runs 3 pruning passes
     - [ ] If result has changes → `applyDensityResult(result)` → `waitForTokenUpdates()`
     - [ ] densityDirty set to false in finally
   - [ ] `shouldCompress()` checks token count (post-optimization)
   - [ ] If still over threshold → `performCompression()` runs
   - [ ] If under threshold → compression skipped (density was sufficient!)

4. **Emergency path**: `enforceContextWindow()` detects over-limit
   - [ ] `ensureDensityOptimized()` runs first
   - [ ] Tokens rechecked
   - [ ] If under limit → return (density was sufficient!)
   - [ ] If still over → `performCompression()` runs

### Lifecycle State Machine

```
INIT: densityDirty = true
  → ensureDensityOptimized() → optimize → apply → densityDirty = false
  → User sends message → historyService.add() → densityDirty = true
  → ensureDensityOptimized() → optimize → apply → densityDirty = false
  → User sends message (no prunable content) → densityDirty = true
  → ensureDensityOptimized() → optimize → empty result → densityDirty = false
  → User sends again (no new content yet) → densityDirty = false → SKIP
```

- [ ] All state transitions verified in test cases
- [ ] densityDirty never gets stuck as true (always cleared in finally)
- [ ] densityDirty never gets set to true by internal operations

## Holistic Feature Completeness Check

After P20, the following are COMPLETE:

### Strategy Layer

- [ ] `CompressionStrategy` interface with `trigger` and optional `optimize` (P03-P05)
- [ ] `DensityResult`, `DensityConfig`, `DensityResultMetadata` types (P03-P05)
- [ ] `HighDensityStrategy.optimize()` — 3 pruning passes (P09-P11)
- [ ] `HighDensityStrategy.compress()` — summarization + truncation (P12-P14)
- [ ] Strategy properties: name='high-density', requiresLLM=false, trigger={mode:'continuous', defaultThreshold:0.85}

### HistoryService Layer

- [ ] `applyDensityResult()` — replacements then removals in reverse order (P06-P08)
- [ ] `getRawHistory()` — readonly view of backing array (P06-P08)
- [ ] `recalculateTotalTokens()` — full token re-estimation (P06-P08)

### Settings Layer

- [ ] 4 density settings registered in SETTINGS_REGISTRY (P15-P17)
- [ ] 4 runtime accessors wired in ephemerals (P15-P17)
- [ ] EphemeralSettings types for profile persistence (P15-P17)
- [ ] `'high-density'` in COMPRESSION_STRATEGIES tuple (P15-P17)
- [ ] Factory returns HighDensityStrategy (P15-P17)

### Orchestration Layer

- [ ] `densityDirty` field tracks content changes (P18-P20)
- [ ] `ensureDensityOptimized()` implements full density pipeline (P18-P20)
- [ ] Hook in `ensureCompressionBeforeSend` (P18-P20)
- [ ] Hook in `enforceContextWindow` with re-check (P18-P20)

### What's NOT Complete (Future Phases)

- [ ] Enriched compression prompts (REQ-HD-010)
- [ ] Todo-aware summarization (REQ-HD-011)
- [ ] Transcript fallback reference (REQ-HD-012)

## Success Criteria

- ALL P19 orchestration tests pass
- ALL previous HD tests pass (no regression)
- Full test suite, lint, typecheck, format, build all pass
- Manual integration test passes
- ensureDensityOptimized is fully implemented (not a stub)
- densityDirty wired correctly at all turn-loop sites
- DensityConfig built from real settings
- getRawHistory used
- Pseudocode compliance verified
- All anti-patterns absent
- All semantic verification items checked
- End-to-end flow verified
- Core high-density feature is FUNCTIONAL

## Failure Recovery

If verification fails:
1. Document which checks failed
2. Return to P20 to fix
3. Re-run P20a
