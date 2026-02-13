# Phase 02a: Pseudocode Verification

## Phase ID

`PLAN-20260211-HIGHDENSITY.P02a`

## Purpose

Verify pseudocode artifacts are complete, correctly numbered, cover all requirements, and contain no implementation code.

## Structural Checks

```bash
# 1. All files exist
for f in strategy-interface.md history-service.md high-density-optimize.md; do
  test -f "project-plans/issue236hdcompression/analysis/pseudocode/$f" && echo "PASS: $f" || echo "FAIL: $f"
done

# 2. Line numbering density (each file has substantial numbered content)
for f in strategy-interface.md history-service.md high-density-optimize.md; do
  count=$(grep -cE "^ *[0-9]+:" "project-plans/issue236hdcompression/analysis/pseudocode/$f")
  echo "$f: $count numbered lines"
done
# Expected: strategy-interface ≥ 30, history-service ≥ 30, high-density-optimize ≥ 80

# 3. No actual implementation code (bare imports, class declarations outside code blocks)
for f in strategy-interface.md history-service.md high-density-optimize.md; do
  # Check for lines that look like real TypeScript outside of code blocks
  grep -n "^import \|^export class \|^export function " "project-plans/issue236hdcompression/analysis/pseudocode/$f" | head -5
done
# Expected: No matches
```

## Content Verification: strategy-interface.md

The verifier MUST confirm:

- [ ] **StrategyTrigger** type defined with both `threshold` and `continuous` modes (lines ~11–13)
- [ ] **DensityResult** interface with removals, replacements, metadata (lines ~16–19)
- [ ] **DensityResultMetadata** with three count fields (lines ~22–25)
- [ ] **DensityConfig** with 5 readonly fields (lines ~28–33)
- [ ] **COMPRESSION_STRATEGIES** includes `'high-density'` (lines ~36–41)
- [ ] **CompressionStrategy** updated with `trigger` (required) and `optimize?` (optional) (lines ~47–59)
- [ ] **CompressionContext** additions: `activeTodos?`, `transcriptPath?` (lines ~62–65)
- [ ] **Existing strategies** (MiddleOut, TopDown, OneShot) each get trigger property (lines ~70–97)
- [ ] **Factory** switch includes `'high-density'` case (lines ~100–112)
- [ ] **Integration points** section present
- [ ] **Anti-pattern warnings** section present

## Content Verification: history-service.md

The verifier MUST confirm:

- [ ] **getRawHistory()** returns readonly view, no defensive copy (lines ~10–15)
- [ ] **applyDensityResult()** has 4 validation checks (duplicate removals, overlap, removal bounds, replacement bounds) (lines ~24–54)
- [ ] **Replacement before removal** ordering documented (lines ~58–61)
- [ ] **Reverse-order removal** documented (lines ~63–70)
- [ ] **recalculateTotalTokens()** chains on tokenizerLock (lines ~94–118)
- [ ] **Token accumulation** uses local variable then atomic assignment (lines ~95–104)
- [ ] **Event emission** after recalculation (lines ~113–117)
- [ ] **Anti-pattern warnings** cover: no defensive copy, tokenizerLock chaining, atomic update, import paths, descending sort, validation requirement

## Content Verification: high-density-optimize.md

The verifier MUST confirm:

- [ ] **Constants** for READ_TOOLS, WRITE_TOOLS, GLOB_CHARS, PRUNED_POINTER defined (lines ~10–15)
- [ ] **optimize()** entry point calls 3 phases conditionally (lines ~20–53)
- [ ] **pruneReadWritePairs()** has write-map building, call-map building, stale identification, block-level granularity (lines ~60–209)
- [ ] **canPruneReadManyFiles()** handles glob detection (lines ~215–255)
- [ ] **extractFilePath()** checks file_path, absolute_path, path in order (lines ~260–267)
- [ ] **resolvePath()** uses path.resolve with workspaceRoot (lines ~270–273)
- [ ] **deduplicateFileInclusions()** scans human messages, builds inclusion map, strips earlier duplicates (lines ~280–359)
- [ ] **findAllInclusions()** uses regex for delimiter matching, fail-safe on missing close (lines ~365–393)
- [ ] **pruneByRecency()** counts per tool name in reverse, enforces retention, uses pointer string (lines ~400–464)
- [ ] **isEmptyTextBlock()** helper defined (lines ~470–471)
- [ ] **REQ-HD-013.5** (malformed params → skip, don't throw) addressed
- [ ] **REQ-HD-013.6** (recencyRetention < 1 → treat as 1) addressed

## Requirement Coverage Matrix

```bash
# Check each requirement group is covered by at least one pseudocode file
for req in REQ-HD-001 REQ-HD-003 REQ-HD-004 REQ-HD-005 REQ-HD-006 REQ-HD-007 REQ-HD-013; do
  found=$(grep -rl "$req" project-plans/issue236hdcompression/analysis/pseudocode/)
  [ -n "$found" ] && echo "PASS: $req" || echo "FAIL: $req not found"
done
```

## Success Criteria

- All 3 pseudocode files exist with substantial numbered content
- All content verification checkboxes confirmed
- Requirement coverage matrix shows all key groups covered
- No implementation code outside example blocks
- Each file has interface contracts and anti-pattern warnings

## Failure Recovery

If verification fails:
1. Document which checks failed
2. Return to P02 to fix gaps
3. Re-run P02a
