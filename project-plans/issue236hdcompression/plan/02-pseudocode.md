# Phase 02: Pseudocode Development

## Phase ID

`PLAN-20260211-HIGHDENSITY.P02`

## Prerequisites

- Required: Phase 01 completed
- Verification: `test -f project-plans/issue236hdcompression/.completed/P01.md && echo "PASS"`
- Expected files from previous phase: `analysis/domain-model.md`

## Requirements Implemented (Expanded)

This phase creates numbered pseudocode for all components. No production code is written.

### Pseudocode Scope

**Full Text**: Create detailed, line-numbered pseudocode for every component: strategy interface types, HistoryService extensions, and HighDensityStrategy optimize/compress algorithms.

**Behavior**:
- GIVEN: The domain model and requirements
- WHEN: Pseudocode is developed
- THEN: Three pseudocode files are produced with numbered lines covering all algorithms, validation logic, and error handling

**Why This Matters**: Implementation phases reference specific pseudocode line numbers. Without numbered pseudocode, workers cannot be held accountable for algorithmic fidelity.

## Implementation Tasks

### Files to Create

- `analysis/pseudocode/strategy-interface.md`
  - Lines 10–65: Type definitions (StrategyTrigger, DensityResult, DensityResultMetadata, DensityConfig)
  - Lines 35–41: COMPRESSION_STRATEGIES tuple update
  - Lines 46–59: CompressionStrategy interface update
  - Lines 61–65: CompressionContext additions
  - Lines 70–97: Existing strategy trigger additions (MiddleOut, TopDown, OneShot)
  - Lines 100–112: Factory switch update
  - Lines 115–116: Index export update
  - Integration points and anti-pattern warnings sections

- `analysis/pseudocode/history-service.md`
  - Lines 10–15: getRawHistory() method
  - Lines 20–82: applyDensityResult() — validation (V1–V4), mutation (M1–M3), token recalc (T1)
  - Lines 90–120: recalculateTotalTokens() — tokenizerLock chaining, full re-estimation
  - Integration points and anti-pattern warnings sections

- `analysis/pseudocode/high-density-optimize.md`
  - Lines 10–14: Constants (READ_TOOLS, WRITE_TOOLS, GLOB_CHARS, PRUNED_POINTER, regex)
  - Lines 20–53: optimize() entry point — three-phase pipeline with merge
  - Lines 60–209: pruneReadWritePairs() — write map, call map, stale identification, block-level granularity
  - Lines 215–255: canPruneReadManyFiles() — glob detection, concrete path checking
  - Lines 260–267: extractFilePath() helper
  - Lines 270–273: resolvePath() helper
  - Lines 280–359: deduplicateFileInclusions() — inclusion scanning, latest preservation, text block editing
  - Lines 365–393: findAllInclusions() helper
  - Lines 400–464: pruneByRecency() — per-tool counting, retention enforcement, pointer replacement
  - Lines 470–471: isEmptyTextBlock() helper
  - Integration points and anti-pattern warnings sections

### Pseudocode Rules

- Every line MUST be numbered
- Use clear algorithmic steps (IF/FOR/WHILE/RETURN)
- Include ALL error handling paths
- Mark where validation occurs
- No actual TypeScript — only numbered pseudocode with type annotations
- Include interface contracts (inputs, outputs, dependencies) at top of each file

## Verification Commands

```bash
# Verify all pseudocode files exist
for f in strategy-interface.md history-service.md high-density-optimize.md; do
  test -f "project-plans/issue236hdcompression/analysis/pseudocode/$f" && echo "PASS: $f" || echo "FAIL: $f"
done

# Verify lines are numbered (at least 10 numbered lines per file)
for f in strategy-interface.md history-service.md high-density-optimize.md; do
  count=$(grep -cE "^ *[0-9]+:" "project-plans/issue236hdcompression/analysis/pseudocode/$f")
  [ "$count" -ge 10 ] && echo "PASS: $f has $count numbered lines" || echo "FAIL: $f has only $count numbered lines"
done

# Verify no actual TypeScript imports (implementation code)
for f in strategy-interface.md history-service.md high-density-optimize.md; do
  grep -c "^import " "project-plans/issue236hdcompression/analysis/pseudocode/$f" 2>/dev/null
done
# Expected: 0 for each (imports inside code blocks are OK)

# Verify requirement coverage
for req in REQ-HD-001 REQ-HD-003 REQ-HD-005 REQ-HD-006 REQ-HD-007 REQ-HD-013; do
  grep -rl "$req" project-plans/issue236hdcompression/analysis/pseudocode/ | head -1
done
# Expected: Each requirement found in at least one file
```

## Success Criteria

- All 3 pseudocode files exist
- Each file has ≥ 10 numbered pseudocode lines
- No bare `import` statements (implementation code) outside code block examples
- All key requirements referenced in at least one pseudocode file
- Interface contracts (inputs, outputs, dependencies) defined at top of each file
- Anti-pattern warnings section present in each file

## Failure Recovery

If this phase fails:
1. `rm -rf project-plans/issue236hdcompression/analysis/pseudocode/`
2. Re-run pseudocode generation with corrected scope

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P02.md`
Contents:
```markdown
Phase: P02
Completed: [timestamp]
Files Created:
  - analysis/pseudocode/strategy-interface.md
  - analysis/pseudocode/history-service.md
  - analysis/pseudocode/high-density-optimize.md
Verification: [paste verification output]
```
