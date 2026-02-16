# Phase 10: HighDensityStrategy — Optimize TDD

## Phase ID

`PLAN-20260211-HIGHDENSITY.P10`

## Prerequisites

- Required: Phase 09 completed
- Verification: `grep -r "@plan:PLAN-20260211-HIGHDENSITY.P09" packages/core/src/core/compression/ | wc -l` → ≥ 2
- Expected files from previous phase:
  - `packages/core/src/core/compression/HighDensityStrategy.ts` (class skeleton with stubs)
- Preflight verification: Phase 01a completed

## Requirements Implemented (Expanded)

### REQ-HD-005.1: Stale Read Identification

**Full Text**: When `readWritePruning` is enabled in `DensityConfig`, the `optimize()` method shall identify tool calls where a file was read by a read tool and subsequently written by a write tool later in history.
**Behavior**:
- GIVEN: History with `read_file('src/foo.ts')` at index 2 and `write_file('src/foo.ts')` at index 5
- WHEN: `optimize()` is called with `readWritePruning: true`
- THEN: The read at index 2 (and its tool response) are marked for removal
**Why This Matters**: Stale file reads waste context tokens on outdated content.

### REQ-HD-005.2: Read Tool Set

**Full Text**: The system shall recognize `read_file`, `read_line_range`, `read_many_files`, `ast_read_file` as read tools.
**Behavior**:
- GIVEN: Tool calls using any of these names
- WHEN: Checking for stale reads
- THEN: All four are recognized as read operations

### REQ-HD-005.3: Write Tool Set

**Full Text**: The system shall recognize `write_file`, `ast_edit`, `replace`, `insert_at_line`, `delete_line_range` as write tools.
**Behavior**:
- GIVEN: Tool calls using any of these names
- WHEN: Building the write map
- THEN: All five are recognized as write operations

### REQ-HD-005.4: File Path Extraction

**Full Text**: The system shall extract file paths from `ToolCallBlock.parameters` using the keys `file_path`, `absolute_path`, or `path` (checked in that order).
**Behavior**:
- GIVEN: A tool call with `parameters: { absolute_path: '/foo/bar.ts' }`
- WHEN: Extracting the file path
- THEN: Returns `'/foo/bar.ts'`

### REQ-HD-005.5: Path Normalization

**Full Text**: File paths shall be normalized using `path.resolve()` before comparison. Compare resolved paths exactly, without case folding.
**Behavior**:
- GIVEN: Paths `'src/../src/foo.ts'` and `'src/foo.ts'` resolved against workspace root
- WHEN: Compared for equality
- THEN: They are equal after `path.resolve()`

### REQ-HD-005.6: Stale Read Removal

**Full Text**: When a read tool call's file path has a later write, the read's tool response block and corresponding tool call block shall be marked for removal.
**Behavior**:
- GIVEN: read_file('foo.ts') at index 2, write_file('foo.ts') at index 4
- WHEN: `optimize()` runs
- THEN: Both the AI entry with the tool_call and the tool entry with the tool_response for the read are removed/replaced

### REQ-HD-005.7: Post-Write Reads Preserved

**Full Text**: Read tool calls that occur after the latest write to the same file shall NOT be marked for removal.
**Behavior**:
- GIVEN: write_file('foo.ts') at index 2, read_file('foo.ts') at index 4
- WHEN: `optimize()` runs
- THEN: The read at index 4 is preserved (it reflects the current file state)

### REQ-HD-005.8: Block-Level Granularity

**Full Text**: Where an `ai` speaker entry contains multiple tool call blocks and only some are stale reads, the strategy shall replace the entry (removing only the stale tool call blocks) rather than removing the entire entry.
**Behavior**:
- GIVEN: AI entry with [tool_call(read_file, 'a.ts'), tool_call(grep, 'pattern')]
- AND: write_file('a.ts') occurs later
- WHEN: `optimize()` runs
- THEN: AI entry is REPLACED with only [tool_call(grep, 'pattern')]; it is NOT removed entirely

### REQ-HD-005.9: Multi-File Tool Handling

**Full Text**: For `read_many_files`, only concrete file paths (no glob characters `*`, `?`, `**`) shall be checked against the write map. If all concrete paths have subsequent writes and no glob entries exist, the entry is removable.
**Behavior**:
- GIVEN: `read_many_files({ paths: ['src/a.ts', 'src/b.ts'] })` and both have later writes
- WHEN: Checking removability
- THEN: Entry is removable (all concrete, all have writes)
- BUT: `read_many_files({ paths: ['src/*.ts'] })` is NOT removable (contains glob)

### REQ-HD-005.10: Disabled When Config False

**Full Text**: When `readWritePruning` is `false` in `DensityConfig`, no READ→WRITE pair pruning shall occur.
**Behavior**:
- GIVEN: Stale reads exist in history
- WHEN: `optimize()` called with `readWritePruning: false`
- THEN: No read-write pruning occurs; metadata.readWritePairsPruned is 0

### REQ-HD-005.11: Workspace Root Resolution

**Full Text**: Relative paths in tool parameters shall be resolved against `DensityConfig.workspaceRoot`.
**Behavior**:
- GIVEN: `read_file({ file_path: 'src/foo.ts' })` and workspaceRoot is `/workspace`
- WHEN: Path is resolved
- THEN: Compared as `/workspace/src/foo.ts`

### REQ-HD-006.1: Inclusion Detection

**Full Text**: When `fileDedupe` is enabled, identify `@` file inclusions in human messages by matching `--- <filepath> ---` ... `--- End of content ---` delimiter pattern.
**Behavior**:
- GIVEN: Human message text with `--- src/foo.ts ---\nfile content\n--- End of content ---`
- WHEN: Scanning for inclusions
- THEN: `src/foo.ts` is identified as an included file

### REQ-HD-006.2: Latest Inclusion Preserved

**Full Text**: When the same file is `@`-included multiple times, the most recent inclusion shall be preserved. All earlier inclusions shall have their content stripped.
**Behavior**:
- GIVEN: `@src/foo.ts` in message at index 3 and again at index 7
- WHEN: `optimize()` runs with `fileDedupe: true`
- THEN: Inclusion at index 3 is stripped; inclusion at index 7 is preserved

### REQ-HD-006.3: Replacement Not Removal

**Full Text**: Dedup shall use `replacements` rather than `removals` (the human message may contain other text).
**Behavior**:
- GIVEN: Human message "Please fix this:\n--- src/foo.ts ---\ncontent\n--- End of content ---"
- WHEN: Content is stripped as duplicate
- THEN: Message becomes "Please fix this:\n" via replacement (not removed entirely)

### REQ-HD-006.4: Disabled When Config False

**Full Text**: When `fileDedupe` is `false`, no deduplication shall occur.
**Behavior**:
- GIVEN: Duplicate file inclusions exist
- WHEN: `optimize()` called with `fileDedupe: false`
- THEN: No dedup occurs; metadata.fileDeduplicationsPruned is 0

### REQ-HD-006.5: Fail-Safe Heuristic

**Full Text**: Delimiter matching shall require both opening and closing markers. If markers do not pair correctly, the text block shall be left unchanged.
**Behavior**:
- GIVEN: Text with `--- src/foo.ts ---` but no `--- End of content ---`
- WHEN: Scanning for inclusions
- THEN: The text is left unchanged (not partially stripped)

### REQ-HD-007.1: Recency Window

**Full Text**: Count tool responses per tool name walking in reverse. Results beyond `recencyRetention` count shall have response content replaced with a pointer string.
**Behavior**:
- GIVEN: 5 `read_file` results in history, recencyRetention=3
- WHEN: `optimize()` runs with `recencyPruning: true`
- THEN: The 2 oldest `read_file` results have content replaced with pointer string

### REQ-HD-007.2: Pointer String

**Full Text**: The replacement pointer string shall be: `"[Result pruned — re-run tool to retrieve]"`.
**Behavior**:
- GIVEN: A pruned tool response
- WHEN: Its result is replaced
- THEN: result equals `'[Result pruned — re-run tool to retrieve]'`

### REQ-HD-007.3: Structure Preservation

**Full Text**: Recency pruning shall use `replacements`, preserving tool call and tool response structure. Only the response payload content is replaced.
**Behavior**:
- GIVEN: A tool entry with `tool_response` blocks
- WHEN: Pruned by recency
- THEN: The entry is REPLACED (not removed); `type`, `callId`, `toolName` are intact; only `result` changes

### REQ-HD-007.4: Default Retention

**Full Text**: The default value for `recencyRetention` shall be 3.
**Behavior**:
- GIVEN: DensityConfig with recencyRetention=3
- WHEN: 4 results exist for the same tool
- THEN: Only the oldest 1 is pruned

### REQ-HD-007.6: Disabled When Config False

**Full Text**: When `recencyPruning` is `false`, no recency pruning shall occur.
**Behavior**:
- GIVEN: Old tool results exist
- WHEN: `optimize()` called with `recencyPruning: false`
- THEN: No recency pruning occurs; metadata.recencyPruned is 0

### REQ-HD-013.5: Malformed Tool Parameters

**Full Text**: Where a tool call's `parameters` field is not an object or does not contain a recognizable file path key, the strategy shall skip that tool call for pruning purposes. It shall not throw.
**Behavior**:
- GIVEN: Tool call with `parameters: null` or `parameters: { foo: 'bar' }`
- WHEN: Extracting file path
- THEN: Returns undefined; tool call is skipped (no error thrown)

### REQ-HD-013.6: Invalid Recency Retention

**Full Text**: Where `recencyRetention` is less than 1, the system shall treat it as 1.
**Behavior**:
- GIVEN: DensityConfig with `recencyRetention: 0`
- WHEN: Recency pruning runs
- THEN: Retention floor is 1 (at least the most recent result per tool is kept)

### REQ-HD-013.7: Metadata Accuracy

**Full Text**: The counts in `DensityResultMetadata` shall accurately reflect the number of entries actually marked for removal or replacement by each optimization pass.
**Behavior**:
- GIVEN: 2 stale reads pruned, 1 dedup, 3 recency prunes
- WHEN: `optimize()` returns
- THEN: `metadata.readWritePairsPruned === 2`, `metadata.fileDeduplicationsPruned === 1`, `metadata.recencyPruned === 3`

## Implementation Tasks

### Files to Create

- `packages/core/src/core/compression/__tests__/high-density-optimize.test.ts`
  - MUST include: `@plan:PLAN-20260211-HIGHDENSITY.P10`
  - MUST include: `@requirement:REQ-HD-005.1` through `REQ-HD-005.11`, `REQ-HD-006.1` through `REQ-HD-006.5`, `REQ-HD-007.1` through `REQ-HD-007.6`, `REQ-HD-013.1` through `REQ-HD-013.7`

### Test Cases (Behavioral — NOT mock theater)

All tests operate on a REAL `HighDensityStrategy` instance. History entries are constructed as real `IContent` objects matching the type definitions. Tests call `strategy.optimize(history, config)` and assert on the returned `DensityResult`. No mocking of strategy internals.

#### READ→WRITE Pruning Tests

1. **`stale read is removed when a later write exists for the same file`** `@requirement:REQ-HD-005.1, REQ-HD-005.6`
   - GIVEN: [ai:read_file('a.ts'), tool:response(a.ts), ai:write_file('a.ts'), tool:response(a.ts)]
   - WHEN: `optimize()` with `readWritePruning: true`
   - THEN: Read's AI entry and tool response are in removals or replacements; write entries untouched

2. **`post-write read is preserved`** `@requirement:REQ-HD-005.7`
   - GIVEN: [ai:write_file('a.ts'), tool:response, ai:read_file('a.ts'), tool:response]
   - WHEN: `optimize()` with `readWritePruning: true`
   - THEN: Read entries are NOT in removals or replacements

3. **`all read tool types are recognized`** `@requirement:REQ-HD-005.2`
   - GIVEN: One entry each for `read_file`, `read_line_range`, `read_many_files`, `ast_read_file` — each followed by a write to the same file
   - WHEN: `optimize()` runs
   - THEN: All four read types produce removals/replacements

4. **`all write tool types are recognized`** `@requirement:REQ-HD-005.3`
   - GIVEN: `read_file('a.ts')` followed by each write tool type: `write_file`, `ast_edit`, `replace`, `insert_at_line`, `delete_line_range`
   - WHEN: `optimize()` runs
   - THEN: Each write type causes the preceding read to be marked stale

5. **`file_path, absolute_path, and path keys all extract correctly`** `@requirement:REQ-HD-005.4`
   - GIVEN: Three tool calls using `file_path`, `absolute_path`, and `path` respectively
   - WHEN: Extracting paths for pruning
   - THEN: All three are extracted correctly

6. **`paths are normalized via path.resolve before comparison`** `@requirement:REQ-HD-005.5, REQ-HD-005.11`
   - GIVEN: `read_file({ file_path: 'src/../src/foo.ts' })` and `write_file({ file_path: 'src/foo.ts' })`
   - WHEN: `optimize()` runs with workspaceRoot `/workspace`
   - THEN: Paths resolve to the same value; read is marked stale

7. **`block-level granularity preserves non-stale tool calls in same AI entry`** `@requirement:REQ-HD-005.8`
   - GIVEN: AI entry with [tool_call(read_file, 'a.ts'), tool_call(search, 'pattern')], write_file('a.ts') later
   - WHEN: `optimize()` runs
   - THEN: AI entry is in `replacements` with only the search tool_call remaining (not in removals)

8. **`read_many_files with all concrete paths having writes is removable`** `@requirement:REQ-HD-005.9`
   - GIVEN: `read_many_files({ paths: ['a.ts', 'b.ts'] })` and both have later writes
   - WHEN: `optimize()` runs
   - THEN: The read_many_files entry is marked for removal

9. **`read_many_files with glob paths is not removable`** `@requirement:REQ-HD-005.9`
   - GIVEN: `read_many_files({ paths: ['src/*.ts'] })`
   - WHEN: `optimize()` runs (even if concrete files in that glob were written)
   - THEN: The read_many_files entry is NOT removable

10. **`read-write pruning disabled when config false`** `@requirement:REQ-HD-005.10`
    - GIVEN: Stale reads in history
    - WHEN: `optimize()` with `readWritePruning: false`
    - THEN: `result.removals` and `result.replacements` are empty (for RW phase); `metadata.readWritePairsPruned === 0`

11. **`malformed tool parameters are skipped without throwing`** `@requirement:REQ-HD-013.5`
    - GIVEN: Tool call with `parameters: null`, another with `parameters: { unrelated: true }`
    - WHEN: `optimize()` runs
    - THEN: No error thrown; those tool calls are simply skipped

12. **`relative paths resolved against workspaceRoot`** `@requirement:REQ-HD-005.11`
    - GIVEN: `read_file({ file_path: 'src/foo.ts' })`, workspaceRoot `/project`
    - WHEN: Path is resolved
    - THEN: Matches `/project/src/foo.ts`

#### @ File Deduplication Tests

13. **`duplicate file inclusions are stripped, latest preserved`** `@requirement:REQ-HD-006.1, REQ-HD-006.2`
    - GIVEN: Human message at index 2 with `--- src/foo.ts ---\ncontent1\n--- End of content ---`, another at index 5 with same file
    - WHEN: `optimize()` with `fileDedupe: true`
    - THEN: Index 2 is in `replacements` with file content stripped; index 5 preserved

14. **`dedup uses replacement not removal`** `@requirement:REQ-HD-006.3`
    - GIVEN: Human message "Fix this:\n--- src/foo.ts ---\ncontent\n--- End of content ---\nPlease"
    - WHEN: Duplicate stripped
    - THEN: Message in `replacements` retains "Fix this:\n\nPlease" (surrounding text preserved)

15. **`file dedup disabled when config false`** `@requirement:REQ-HD-006.4`
    - GIVEN: Duplicate inclusions exist
    - WHEN: `optimize()` with `fileDedupe: false`
    - THEN: No dedup replacements; `metadata.fileDeduplicationsPruned === 0`

16. **`unpaired delimiters leave text unchanged`** `@requirement:REQ-HD-006.5`
    - GIVEN: Text with opening `--- src/foo.ts ---` but no closing `--- End of content ---`
    - WHEN: Scanning for inclusions
    - THEN: No inclusions detected; text left unchanged

#### Recency Pruning Tests

17. **`old tool results beyond retention are replaced with pointer`** `@requirement:REQ-HD-007.1, REQ-HD-007.2`
    - GIVEN: 5 `read_file` tool responses, recencyRetention=3
    - WHEN: `optimize()` with `recencyPruning: true`
    - THEN: 2 oldest `read_file` responses have `result` set to `'[Result pruned — re-run tool to retrieve]'`

18. **`per-tool-name counting`** `@requirement:REQ-HD-007.1`
    - GIVEN: 4 `read_file` responses and 4 `grep` responses, retention=3
    - WHEN: `optimize()` runs
    - THEN: 1 oldest `read_file` pruned, 1 oldest `grep` pruned (counted separately)

19. **`structure preservation — only result field changes`** `@requirement:REQ-HD-007.3`
    - GIVEN: A pruned tool response
    - WHEN: Checking the replacement
    - THEN: `type`, `callId`, `toolName`, `error`, `isComplete` are all preserved; only `result` is replaced

20. **`recency pruning disabled when config false`** `@requirement:REQ-HD-007.6`
    - GIVEN: Old tool results exist
    - WHEN: `optimize()` with `recencyPruning: false`
    - THEN: No recency replacements; `metadata.recencyPruned === 0`

21. **`recencyRetention < 1 is treated as 1`** `@requirement:REQ-HD-013.6`
    - GIVEN: recencyRetention=0, 3 `read_file` responses
    - WHEN: `optimize()` runs
    - THEN: 2 oldest pruned (retention floor = 1, so 1 kept)

#### Optimize Merge / Cross-Cutting Tests

22. **`optimize merges phases in deterministic order`**
    - GIVEN: History triggering all three pruning phases
    - WHEN: `optimize()` runs with all options enabled
    - THEN: `DensityResult` contains combined removals and replacements; no index in both

23. **`metadata counts are accurate across all phases`** `@requirement:REQ-HD-013.7`
    - GIVEN: Known stale reads, duplicate inclusions, and old results
    - WHEN: `optimize()` returns
    - THEN: `metadata.readWritePairsPruned`, `metadata.fileDeduplicationsPruned`, `metadata.recencyPruned` match actual counts

24. **`entries already removed by RW pruning are skipped by dedup and recency`**
    - GIVEN: An entry removed by read-write pruning that also matches dedup or recency criteria
    - WHEN: Later phases process it
    - THEN: It is NOT added to replacements (already in removals)

25. **`empty history returns empty result`**
    - GIVEN: Empty history array
    - WHEN: `optimize()` runs
    - THEN: `removals: []`, `replacements: new Map()`, all metadata counts 0

26. **`all config options false returns empty result`**
    - GIVEN: Non-empty history, all pruning options disabled
    - WHEN: `optimize()` runs
    - THEN: `removals: []`, `replacements: new Map()`, all metadata counts 0

#### Failure Mode Tests (REQ-HD-013.1 through 013.4)

27. **`optimize gracefully degrades on unexpected tool structure`** `@requirement:REQ-HD-013.1`
    - GIVEN: History containing a tool call with unexpected structure (e.g., missing `blocks`, malformed `type` field, or completely alien entry shape)
    - WHEN: `optimize()` runs
    - THEN: Returns empty removals for that tool (does not crash); other well-formed entries are still processed normally

28. **`compress tolerates empty optimize results`** `@requirement:REQ-HD-013.2`
    - GIVEN: `optimize()` returned an empty `DensityResult` (0 removals, 0 replacements)
    - WHEN: `compress()` is called after applying that empty result (effectively a no-op apply)
    - THEN: `compress()` operates normally on the unchanged history without errors

29. **`individual pruning pass failure does not block other passes`** `@requirement:REQ-HD-013.3`
    - GIVEN: History where read-write pruning encounters an internal error (e.g., via a pathologically crafted entry that causes path resolution to fail)
    - WHEN: `optimize()` runs with all pruning options enabled
    - THEN: The failing pass is caught per-pass; file dedup and recency pruning still execute and produce their results
    - AND: Metadata for the failed pass shows 0; other passes' metadata is accurate

30. **`applyDensityResult validation rejects invalid indices`** `@requirement:REQ-HD-013.4`
    - Cross-reference: Primary coverage in P07 (`high-density-history.test.ts`) which tests `applyDensityResult` directly
    - GIVEN: A `DensityResult` with removal indices outside the history bounds (e.g., index 999 in a 5-entry history)
    - WHEN: `applyDensityResult()` is called
    - THEN: Invalid indices are rejected (skipped or error thrown, per P07 specification)
    - Note: This test verifies the contract from the optimize-side perspective — ensure optimize never produces out-of-bounds indices

#### Property-Based Tests (≥ 30% of total)

31. **`removals and replacements never overlap`**
    - Property: For any valid history and config, no index appears in both `result.removals` and `result.replacements.keys()`

32. **`all indices in result are within bounds`**
    - Property: For any history of length N, all removal and replacement indices are in `[0, N)`

33. **`metadata counts are non-negative`**
    - Property: All three metadata count fields are ≥ 0

34. **`disabling all options produces empty result`**
    - Property: For any history, config with all booleans false → removals empty, replacements empty

35. **`optimize is idempotent on its own output`**
    - Property: Applying the result and running optimize again produces an empty result (nothing more to prune)

36. **`post-write reads are never removed`**
    - Property: For any history, reads occurring after the last write to the same file are never in removals

37. **`recency pruning preserves at least retention-count results per tool`**
    - Property: For any history and retention N, after pruning, at least min(N, total) results per tool are unpruned

38. **`replacement entries preserve speaker and metadata`**
    - Property: For any replacement in the result, `replacement.speaker === original.speaker` and timestamp metadata is preserved

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-HIGHDENSITY.P10
 * @requirement REQ-HD-005.1, REQ-HD-005.6
 * @pseudocode high-density-optimize.md lines 60-209
 */
it('stale read is removed when a later write exists for the same file', () => { ... });
```

## Verification Commands

```bash
# 1. Test file exists
test -f packages/core/src/core/compression/__tests__/high-density-optimize.test.ts && echo "PASS" || echo "FAIL"

# 2. Sufficient test count
count=$(grep -c "it(" packages/core/src/core/compression/__tests__/high-density-optimize.test.ts)
[ "$count" -ge 30 ] && echo "PASS: $count tests" || echo "FAIL: only $count tests"

# 3. Plan markers present
grep -c "@plan.*HIGHDENSITY.P10" packages/core/src/core/compression/__tests__/high-density-optimize.test.ts
# Expected: ≥ 1

# 4. Requirement markers present
grep -c "@requirement.*REQ-HD-005" packages/core/src/core/compression/__tests__/high-density-optimize.test.ts
# Expected: ≥ 8
grep -c "@requirement.*REQ-HD-006" packages/core/src/core/compression/__tests__/high-density-optimize.test.ts
# Expected: ≥ 4
grep -c "@requirement.*REQ-HD-007" packages/core/src/core/compression/__tests__/high-density-optimize.test.ts
# Expected: ≥ 4
grep -c "@requirement.*REQ-HD-013" packages/core/src/core/compression/__tests__/high-density-optimize.test.ts
# Expected: ≥ 7

# 5. No mock theater
grep -c "toHaveBeenCalled\b" packages/core/src/core/compression/__tests__/high-density-optimize.test.ts
# Expected: 0

# 6. No reverse testing (expecting NotYetImplemented)
grep -c "NotYetImplemented" packages/core/src/core/compression/__tests__/high-density-optimize.test.ts
# Expected: 0

# 7. Property-based test ratio
prop_count=$(grep -c "fc\.\|test\.prop\|fc\.assert\|fc\.property" packages/core/src/core/compression/__tests__/high-density-optimize.test.ts)
total=$(grep -c "it(" packages/core/src/core/compression/__tests__/high-density-optimize.test.ts)
echo "Property tests: $prop_count / $total total"
# Expected: ratio ≥ 0.30

# 8. Tests run but FAIL (stubs throw NotYetImplemented)
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-optimize.test.ts 2>&1 | tail -15
# Expected: Tests exist but most fail

# 9. No compile errors
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-optimize.test.ts 2>&1 | grep -ic "cannot find\|SyntaxError"
# Expected: 0
```

## Success Criteria

- Test file created with ≥ 30 behavioral test cases
- ≥ 30% property-based tests
- No mock theater (no `toHaveBeenCalled`)
- No reverse testing (no `NotYetImplemented` expectations)
- Tests compile and run (failures from stubs, not infrastructure)
- All three pruning categories covered with multiple tests each
- Cross-cutting merge/conflict tests present
- Plan, requirement, and pseudocode markers present
- No modifications to production code (tests only)

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/core/compression/__tests__/high-density-optimize.test.ts`
2. Re-run Phase 10 with corrected test cases

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P10.md`
Contents:
```markdown
Phase: P10
Completed: [timestamp]
Files Created: packages/core/src/core/compression/__tests__/high-density-optimize.test.ts [N lines]
Tests Added: [count]
Tests Passing: [count]
Tests Failing: [count] (expected — stubs not implemented)
Verification: [paste verification output]
```
