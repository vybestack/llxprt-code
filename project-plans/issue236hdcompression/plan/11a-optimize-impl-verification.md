# Phase 11a: HighDensityStrategy — Optimize Implementation Verification

## Phase ID

`PLAN-20260211-HIGHDENSITY.P11a`

## Purpose

Verify the optimize implementation from P11 is complete, correct, passes all P10 tests, matches pseudocode, and contains no deferred work (except compress which is stubbed until P14).

## Structural Checks

```bash
# 1. TypeScript compiles cleanly
cd packages/core && npx tsc --noEmit
# Expected: 0 errors

# 2. Plan markers updated to P11
grep -c "@plan.*HIGHDENSITY.P11" packages/core/src/core/compression/HighDensityStrategy.ts
# Expected: ≥ 3

# 3. Pseudocode references present
grep -c "@pseudocode.*high-density-optimize" packages/core/src/core/compression/HighDensityStrategy.ts
# Expected: ≥ 5

# 4. Only compress stub remaining
grep -c "NotYetImplemented" packages/core/src/core/compression/HighDensityStrategy.ts
# Expected: 1 (compress only)

# 5. No deferred work in optimize-related methods
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/core/compression/HighDensityStrategy.ts | grep -v "NotYetImplemented.*compress" | grep -v ".test."
# Expected: No matches

# 6. No cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/core/compression/HighDensityStrategy.ts | grep -v ".test."
# Expected: No matches
```

## Behavioral Verification

### P10 Tests Pass

```bash
# ALL P10 tests must pass
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-optimize.test.ts
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
```

### Pseudocode Compliance Verification

The verifier MUST read HighDensityStrategy.ts and compare against `analysis/pseudocode/high-density-optimize.md`:

#### optimize() — pseudocode lines 20–53

- [ ] **Lines 21-27**: Initialize removals Set, replacements Map, metadata with zero counts
- [ ] **Lines 29-34**: Phase 1 conditional — `if (config.readWritePruning)` → call pruneReadWritePairs, merge results
- [ ] **Lines 36-40**: Phase 2 conditional — `if (config.fileDedupe)` → call deduplicateFileInclusions with existingRemovals
- [ ] **Lines 42-46**: Phase 3 conditional — `if (config.recencyPruning)` → call pruneByRecency with existingRemovals
- [ ] **Lines 48-53**: Build return — removals as array, replacements as ReadonlyMap, metadata
- [ ] **Merge logic**: Later phases skip indices already in removals (no conflict invariant violation)

#### pruneReadWritePairs() — pseudocode lines 60–209

- [ ] **Lines 69-91**: Write map built by walking history BACKWARDS, storing first (latest) write per resolved path
- [ ] **Lines 93-101**: callMap built — maps callId to { aiIndex, toolCallBlock }
- [ ] **Lines 103-143**: Stale read identification — checks READ_TOOLS, handles read_many_files specially, uses writeIndex > readIndex
- [ ] **Lines 145-174**: AI entry processing — all stale → removal (if no non-tool content); partial → replacement with filtered blocks
- [ ] **Lines 176-208**: Tool entry processing — all stale responses → removal; partial → replacement

#### canPruneReadManyFiles() — pseudocode lines 215–255

- [ ] **Lines 222-228**: Validates params object with paths array
- [ ] **Lines 234-248**: Iterates paths, checks for glob chars, checks concrete paths against write map
- [ ] **Lines 250-255**: Returns true only if no globs, has concrete paths, all concrete have writes

#### extractFilePath() — pseudocode lines 260–267

- [ ] Checks file_path, absolute_path, path in order (fallback chain)
- [ ] Returns undefined for non-object/missing keys (REQ-HD-013.5)

#### resolvePath() — pseudocode lines 270–273

- [ ] Absolute paths → `path.resolve(filePath)`
- [ ] Relative paths → `path.resolve(workspaceRoot, filePath)`

#### deduplicateFileInclusions() — pseudocode lines 280–359

- [ ] **Lines 298-323**: Scans human messages (skipping existingRemovals), finds all inclusions via findAllInclusions
- [ ] **Lines 326-334**: Groups by resolved path, sorts descending (latest first), preserves entries[0]
- [ ] **Lines 337-357**: Strips content from entries[1..n], collapses excessive newlines
- [ ] **Line 342**: Uses chained replacements — `replacements.get(index) ?? history[index]` as base

#### findAllInclusions() — pseudocode lines 365–393

- [ ] Uses regex to find opening `--- filepath ---` markers
- [ ] Finds matching `--- End of content ---` close marker
- [ ] **Fail-safe**: Skips unpaired markers (closeIndex === -1 → continue)
- [ ] Includes trailing newline
- [ ] Advances regex lastIndex past each inclusion

#### pruneByRecency() — pseudocode lines 400–464

- [ ] **Line 408**: Retention clamped — `Math.max(1, config.recencyRetention)`
- [ ] **Lines 415-434**: Walks history REVERSE, counts per tool_response.toolName, marks beyond retention
- [ ] **Lines 436-462**: Groups by entry, builds replacements with PRUNED_POINTER in result field
- [ ] **Line 446**: Uses chained replacements

#### isEmptyTextBlock() — pseudocode lines 470–471

- [ ] Checks `block.type === 'text'` and text is empty/whitespace-only

### Anti-Pattern Verification

The verifier MUST confirm NONE of these anti-patterns are present:

- [ ] History array or entries are NOT mutated (all changes via removals/replacements)
- [ ] `path.normalize()` is NOT used (only `path.resolve()`)
- [ ] No throws on malformed params (extractFilePath returns undefined)
- [ ] No assumption of adjacent tool_call/tool_response (uses callId matching)
- [ ] No case-folding of paths (exact comparison after resolve)
- [ ] No duplicate indices in removals or replacements
- [ ] Replacements spread original entry (`{ ...entry, blocks: newBlocks }`)

### Constants Verification

- [ ] READ_TOOLS matches pseudocode line 10 exactly
- [ ] WRITE_TOOLS matches pseudocode line 11 exactly
- [ ] PRUNED_POINTER matches pseudocode line 13 exactly
- [ ] FILE_INCLUSION_OPEN_REGEX matches pseudocode line 14
- [ ] FILE_INCLUSION_CLOSE matches pseudocode line 15

## Semantic Verification Checklist

1. **Does the code DO what the requirement says?**
   - [ ] REQ-HD-005.1–005.11: All read-write pruning behaviors verified against pseudocode
   - [ ] REQ-HD-006.1–006.5: All dedup behaviors verified
   - [ ] REQ-HD-007.1–007.6: All recency behaviors verified
   - [ ] REQ-HD-013.5: Malformed params handled gracefully
   - [ ] REQ-HD-013.6: Retention floor enforced
   - [ ] REQ-HD-013.7: Metadata counts accurate

2. **Is this REAL implementation, not placeholder?**
   - [ ] optimize() has three conditional phases with real pruning logic
   - [ ] pruneReadWritePairs builds write map, walks history, produces surgical removals/replacements
   - [ ] deduplicateFileInclusions parses delimiters, strips content, handles chained replacements
   - [ ] pruneByRecency counts per tool, replaces with pointer string

3. **Would the test FAIL if implementation was broken?**
   - [ ] Returning empty result → all pruning tests fail
   - [ ] Wrong merge logic → conflict invariant tests fail
   - [ ] Missing post-write preservation → post-write read tests fail

4. **Is the feature REACHABLE?**
   - [ ] optimize() is public
   - [ ] Will be called by orchestrator (future phase)

## Success Criteria

- ALL P10 tests pass
- Full test suite passes
- TypeScript compilation and lint pass
- Only compress() stub remaining (NotYetImplemented count = 1)
- Deferred implementation detection clean
- Pseudocode compliance verified for all methods
- All anti-patterns absent
- All semantic verification items checked

## Failure Recovery

If verification fails:
1. Document which checks failed
2. Return to P11 to fix
3. Re-run P11a
