# Phase 01a: Analysis Verification

## Phase ID

`PLAN-20260211-HIGHDENSITY.P01a`

## Purpose

Verify the domain analysis artifact from P01 is complete, accurate, and covers all requirements.

## Structural Checks

```bash
# 1. File exists and is substantial
wc -l project-plans/issue236hdcompression/analysis/domain-model.md
# Expected: > 100 lines

# 2. All requirement groups referenced
for req in REQ-HD-001 REQ-HD-002 REQ-HD-003 REQ-HD-004 REQ-HD-005 REQ-HD-006 REQ-HD-007 REQ-HD-008 REQ-HD-009 REQ-HD-010 REQ-HD-011 REQ-HD-012 REQ-HD-013; do
  grep -c "$req" project-plans/issue236hdcompression/analysis/domain-model.md
done
# Expected: Each count > 0

# 3. No TypeScript implementation code
grep -c "import {" project-plans/issue236hdcompression/analysis/domain-model.md
# Expected: 0 (code blocks showing interfaces are OK, but no real imports)
```

## Content Verification

The verifier MUST read the domain model and confirm:

- [ ] **Entity completeness**: All new types (StrategyTrigger, DensityResult, DensityConfig, DensityResultMetadata) documented
- [ ] **HistoryService additions**: getRawHistory, applyDensityResult, recalculateTotalTokens documented
- [ ] **Orchestration flow**: ensureDensityOptimized, densityDirty flag, integration with ensureCompressionBeforeSend documented
- [ ] **Strategy hierarchy**: HighDensityStrategy position relative to existing strategies documented
- [ ] **Settings relationships**: 4 new density settings and their ephemeral accessors documented
- [ ] **State transitions**: Dirty flag lifecycle has clear set/clear conditions
- [ ] **Business rules**: Pruning rules (READ→WRITE, dedup, recency) have numbered entries
- [ ] **Edge cases**: At minimum 15 edge cases covering empty history, malformed params, overlapping phases
- [ ] **Error scenarios**: Validation errors, token recalculation failures, concurrency violations covered

## Preflight Verification (Phase 0.5 Embedded)

Since analysis is done, this verification also performs preflight checks:

```bash
# Dependency verification — no new dependencies needed for types phase
npm ls | head -5
# Expected: no errors

# Type verification — check existing types that will be extended
grep -A 5 "interface CompressionStrategy" packages/core/src/core/compression/types.ts
# Expected: name, requiresLLM, compress — NO trigger yet

# Call path verification — check existing strategies exist
ls packages/core/src/core/compression/MiddleOutStrategy.ts
ls packages/core/src/core/compression/TopDownTruncationStrategy.ts
ls packages/core/src/core/compression/OneShotStrategy.ts
# Expected: All exist

# Test infrastructure verification
ls packages/core/src/core/compression/__tests__/ 2>/dev/null || echo "No existing test dir — will create"
```

## Success Criteria

- All structural checks pass
- All content verification items checked
- Preflight verification finds no blockers
- No implementation code in the analysis document

## Failure Recovery

If verification fails:
1. Document which checks failed
2. Return to P01 to address gaps
3. Re-run P01a
