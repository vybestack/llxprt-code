# Phase 11: HighDensityStrategy — Optimize Implementation

## Phase ID

`PLAN-20260211-HIGHDENSITY.P11`

## Prerequisites

- Required: Phase 10 completed
- Verification: `grep -r "@plan:PLAN-20260211-HIGHDENSITY.P10" packages/core/src/core/compression/__tests__/ | wc -l` → ≥ 1
- Expected files from previous phase:
  - `packages/core/src/core/compression/__tests__/high-density-optimize.test.ts`
- Preflight verification: Phase 01a completed

## Requirements Implemented (Expanded)

### REQ-HD-005.1: Stale Read Identification

**Full Text**: When `readWritePruning` is enabled in `DensityConfig`, the `optimize()` method shall identify tool calls where a file was read by a read tool and subsequently written by a write tool later in history.
**Behavior**:
- GIVEN: History with read_file('a.ts') at index 2 and write_file('a.ts') at index 5
- WHEN: `optimize()` called with `readWritePruning: true`
- THEN: The read at index 2 is identified as stale and marked for removal
**Why This Matters**: Stale reads consume large amounts of context for outdated file content.

### REQ-HD-005.2: Read Tool Set

**Full Text**: The system shall recognize `read_file`, `read_line_range`, `read_many_files`, `ast_read_file` as read tools.
**Why This Matters**: Missing a read tool type means stale reads slip through unpruned.

### REQ-HD-005.3: Write Tool Set

**Full Text**: The system shall recognize `write_file`, `ast_edit`, `replace`, `insert_at_line`, `delete_line_range` as write tools.
**Why This Matters**: Missing a write tool type means writes aren't tracked, so reads appear non-stale.

### REQ-HD-005.4: File Path Extraction

**Full Text**: Extract file paths from `ToolCallBlock.parameters` using `file_path`, `absolute_path`, or `path` (checked in that order).
**Why This Matters**: Different tools use different parameter names. The extraction must be flexible but deterministic.

### REQ-HD-005.5: Path Normalization

**Full Text**: File paths normalized using `path.resolve()`. Compare exactly, no case folding.
**Why This Matters**: Without normalization, `src/../src/foo.ts` and `src/foo.ts` would not match.

### REQ-HD-005.6: Stale Read Removal

**Full Text**: Mark the read's tool response block and corresponding tool call block for removal.
**Why This Matters**: Both the AI's tool_call and the tool's response must be cleaned up together.

### REQ-HD-005.7: Post-Write Reads Preserved

**Full Text**: Reads after the latest write shall NOT be removed.
**Why This Matters**: Post-write reads reflect current file state — they're still valuable context.

### REQ-HD-005.8: Block-Level Granularity

**Full Text**: If an AI entry has mixed stale and non-stale tool calls, replace (not remove) the entry.
**Why This Matters**: Removing the entire AI entry would lose non-stale tool calls and text content.

### REQ-HD-005.9: Multi-File Tool Handling

**Full Text**: `read_many_files` — only concrete paths checked. Removable only if no globs and all concrete paths have writes.
**Why This Matters**: Glob results are unpredictable; we can't know what files were actually read.

### REQ-HD-005.10: Disabled When Config False

**Full Text**: When `readWritePruning` is false, skip the entire phase.

### REQ-HD-005.11: Workspace Root Resolution

**Full Text**: Relative paths resolved against `DensityConfig.workspaceRoot`.

### REQ-HD-006.1: Inclusion Detection

**Full Text**: Match `--- <filepath> ---` ... `--- End of content ---` pattern in human messages.
**Why This Matters**: This is the standard format for `@` file inclusions in the CLI.

### REQ-HD-006.2: Latest Inclusion Preserved

**Full Text**: Most recent inclusion preserved, earlier ones stripped.
**Why This Matters**: The latest inclusion has the most current file content.

### REQ-HD-006.3: Replacement Not Removal

**Full Text**: Use replacements (strip file content from text block), not removals.
**Why This Matters**: Human messages may contain surrounding text that must be preserved.

### REQ-HD-006.4: Disabled When Config False

**Full Text**: When `fileDedupe` is false, skip deduplication.

### REQ-HD-006.5: Fail-Safe Heuristic

**Full Text**: Require both opening and closing markers. Unpaired markers → leave unchanged.
**Why This Matters**: Partial stripping would corrupt the message.

### REQ-HD-007.1: Recency Window

**Full Text**: Count per tool name in reverse. Beyond retention → replace with pointer.
**Why This Matters**: Old tool results are rarely referenced; reclaiming their space is high-value.

### REQ-HD-007.2: Pointer String

**Full Text**: `"[Result pruned — re-run tool to retrieve]"`

### REQ-HD-007.3: Structure Preservation

**Full Text**: Use replacements, preserving tool_call/response structure. Only result payload changes.
**Why This Matters**: The model needs to see that a tool was called, even if the result is pruned.

### REQ-HD-007.4: Default Retention

**Full Text**: Default `recencyRetention` is 3.

### REQ-HD-007.6: Disabled When Config False

**Full Text**: When `recencyPruning` is false, skip recency pruning.

### REQ-HD-013.5: Malformed Tool Parameters

**Full Text**: Skip unrecognizable params, don't throw.
**Why This Matters**: History may contain third-party tools with arbitrary parameter shapes.

### REQ-HD-013.6: Invalid Recency Retention

**Full Text**: Retention < 1 treated as 1 (keep at least the most recent).
**Why This Matters**: Zero retention would prune everything, which is never useful.

### REQ-HD-013.7: Metadata Accuracy

**Full Text**: Counts in metadata accurately reflect actual pruning counts per phase.
**Why This Matters**: Debugging and logging depend on accurate metrics.

## Implementation Tasks

### Files to Modify

- `packages/core/src/core/compression/HighDensityStrategy.ts`
  - REPLACE stub `optimize()` with full implementation
  - REPLACE stub `pruneReadWritePairs()` with full implementation
  - REPLACE stub `deduplicateFileInclusions()` with full implementation
  - REPLACE stub `pruneByRecency()` with full implementation
  - ADD helper functions: `extractFilePath()`, `resolvePath()`, `canPruneReadManyFiles()`, `findAllInclusions()`, `isEmptyTextBlock()`
  - UPDATE plan markers: `@plan:PLAN-20260211-HIGHDENSITY.P11`
  - RETAIN requirement markers from P09
  - ADD pseudocode line references

### Implementation Mapping (Pseudocode → Code)

#### optimize() — pseudocode lines 20–53

```
Line 20-27: Method signature, initialize removals Set, replacements Map, metadata
Line 29-34: Phase 1 — if readWritePruning, call pruneReadWritePairs, merge results
Line 36-40: Phase 2 — if fileDedupe, call deduplicateFileInclusions, merge (skip overlaps with removals)
Line 42-46: Phase 3 — if recencyPruning, call pruneByRecency, merge (skip overlaps with removals)
Line 48-53: Build final DensityResult — convert Set to array, Map to ReadonlyMap
```

Key merge logic:
- Lines 33, 39, 45: When merging later phases, skip indices already in `removals` Set
- This prevents the conflict invariant violation (index in both removals and replacements)

#### pruneReadWritePairs() — pseudocode lines 60–209

```
Lines 60-67:  Method signature, init removals/replacements/prunedCount
Lines 69-91:  STEP 1 — Build write map (latest write index per resolved path)
              Walk history BACKWARDS. For ai entries, check tool_call blocks against WRITE_TOOLS.
              Extract path, resolve, store first occurrence (latest).
Lines 93-101: STEP 2 — Build callMap (callId → aiIndex + toolCallBlock)
Lines 103-143: STEP 3 — Identify stale read tool calls
              For each AI entry, count tool_calls, check if each is a read tool.
              read_many_files gets special handling via canPruneReadManyFiles().
              Single-file reads: extract path, resolve, check against latestWrite.
              Mark stale if writeIndex > readIndex.
Lines 145-174: STEP 4a — Process AI entries with stale tool calls
              If ALL tool_calls stale and no meaningful non-tool blocks → removal.
              If SOME stale → replacement with filtered blocks (block-level granularity).
Lines 176-208: STEP 4b — Process tool entries — remove/replace tool_response blocks for stale callIds
              If ALL responses stale and entry has only response blocks → removal.
              If SOME stale → replacement with filtered blocks.
```

#### canPruneReadManyFiles() — pseudocode lines 215–255

```
Lines 215-220: Method signature (params, workspaceRoot, latestWrite, readIndex)
Lines 222-228: Validate params is object with paths array
Lines 230-248: For each path: if contains glob chars → hasGlob=true; else check against latestWrite
Lines 250-255: Return true only if !hasGlob && hasAnyConcrete && allConcreteHaveWrite
```

#### extractFilePath() — pseudocode lines 260–267

```
Lines 260-267: Check params is object, try file_path ?? absolute_path ?? path, return string or undefined
```

#### resolvePath() — pseudocode lines 270–273

```
Lines 270-273: If absolute → path.resolve(filePath); else → path.resolve(workspaceRoot, filePath)
```

#### deduplicateFileInclusions() — pseudocode lines 280–359

```
Lines 280-284: Method signature (history, config, existingRemovals)
Lines 286-296: Init replacements, prunedCount, inclusions map
Lines 298-323: STEP 1 — Scan human messages for @ file inclusions
              Skip entries in existingRemovals. For each text block, call findAllInclusions().
              Group by resolved file path.
Lines 325-357: STEP 2 — For files with multiple inclusions, strip all but latest
              Sort by messageIndex desc, startOffset desc. entries[0] is latest (preserved).
              For entries[1..n]: build replacement by removing content from startOffset to endOffset.
              Collapse excessive newlines. Use chained replacements (line 342).
```

#### findAllInclusions() — pseudocode lines 365–393

```
Lines 365-369: Returns array of { filePath, startOffset, endOffset }
Lines 371-391: Regex scan with FILE_INCLUSION_OPEN_REGEX (global multiline).
              For each opening match, find FILE_INCLUSION_CLOSE after it.
              If no close → skip (fail-safe, REQ-HD-006.5).
              Include trailing newline. Advance regex past inclusion.
```

#### pruneByRecency() — pseudocode lines 400–464

```
Lines 400-404: Method signature (history, config, existingRemovals)
Lines 406-408: Init replacements, prunedCount, retention clamped to min 1
Lines 410-434: STEP 1 — Walk history in REVERSE. For tool entries (not in existingRemovals),
              count tool_response blocks per toolName. Beyond retention → mark for pruning.
Lines 436-462: STEP 2 — Group by entry index. Build replacements:
              Use chained replacements (line 446). Replace result with PRUNED_POINTER.
              Preserve all other fields via spread.
```

#### isEmptyTextBlock() — pseudocode line 470–471

```
Line 470-471: block.type === 'text' && (!block.text || block.text.trim() === '')
```

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-HIGHDENSITY.P11
 * @requirement REQ-HD-005.1, REQ-HD-005.6, REQ-HD-005.7, REQ-HD-005.8
 * @pseudocode high-density-optimize.md lines 60-209
 */
private pruneReadWritePairs(...): ... { ... }
```

### Anti-Patterns to Avoid (from pseudocode)

- **DO NOT** mutate the history array or its entries — all changes via removals/replacements
- **DO NOT** use `path.normalize()` — use `path.resolve()` (REQ-HD-005.5)
- **DO NOT** throw on malformed params — return undefined, continue (REQ-HD-013.5)
- **DO NOT** assume tool_call and tool_response are adjacent — use callId matching
- **DO NOT** case-fold paths — compare exactly as resolved (REQ-HD-005.5)
- **DO NOT** use curated history indices — optimize receives raw history
- **DO NOT** create replacements without spreading original entry metadata
- **DO NOT** allow same index in both removals and replacements

## Verification Commands

### Automated Checks

```bash
# 1. ALL P10 tests pass
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-optimize.test.ts
# Expected: All pass, 0 failures

# 2. TypeScript compiles
cd packages/core && npx tsc --noEmit
# Expected: 0 errors

# 3. Full test suite passes
npm run test -- --run
# Expected: All pass

# 4. Plan markers updated to P11
grep -c "@plan.*HIGHDENSITY.P11" packages/core/src/core/compression/HighDensityStrategy.ts
# Expected: ≥ 3

# 5. Pseudocode references present
grep -c "@pseudocode.*high-density-optimize" packages/core/src/core/compression/HighDensityStrategy.ts
# Expected: ≥ 5
```

### Structural Verification Checklist

- [ ] Previous phase markers present (P10)
- [ ] No skipped phases (P10 exists)
- [ ] All listed files created/modified
- [ ] Plan markers added to all changes
- [ ] Tests pass for this phase
- [ ] No "TODO" or "NotImplemented" in phase code (except compress stub — P14)

### Deferred Implementation Detection (MANDATORY)

```bash
# Check for TODO/FIXME/HACK in implementation
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/core/compression/HighDensityStrategy.ts | grep -v ".test.ts"
# Expected: No matches

# Check for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/core/compression/HighDensityStrategy.ts | grep -v ".test.ts"
# Expected: No matches

# Check for empty/trivial implementations
grep -rn "NotYetImplemented" packages/core/src/core/compression/HighDensityStrategy.ts
# Expected: 1 match only (compress — still stubbed, implemented in P14)

# Check that optimize does NOT still throw
grep -A3 "optimize(" packages/core/src/core/compression/HighDensityStrategy.ts | grep "NotYetImplemented"
# Expected: 0 matches
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions

1. **Does the code DO what the requirement says?**
   - [ ] REQ-HD-005.1: Stale reads identified by comparing read paths against write map — verified by reading pruneReadWritePairs
   - [ ] REQ-HD-005.7: Post-write reads preserved — `writeIndex <= index` check skips them
   - [ ] REQ-HD-005.8: Block-level granularity — partial replacement for mixed entries
   - [ ] REQ-HD-005.9: read_many_files glob handling — canPruneReadManyFiles checks for glob chars
   - [ ] REQ-HD-006.2: Latest inclusion preserved — sort descending, skip entries[0]
   - [ ] REQ-HD-006.5: Fail-safe — findAllInclusions skips unpaired delimiters
   - [ ] REQ-HD-007.1: Per-tool counting — toolCounts map keyed by toolName
   - [ ] REQ-HD-007.3: Structure preservation — spread operator preserves all fields, only result replaced
   - [ ] REQ-HD-013.5: Malformed params — extractFilePath returns undefined, loop continues
   - [ ] REQ-HD-013.6: Retention floor — Math.max(1, config.recencyRetention)
   - [ ] REQ-HD-013.7: Metadata accuracy — prunedCount incremented per actual pruning

2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed
   - [ ] optimize() has full three-phase pipeline, not just a pass-through
   - [ ] pruneReadWritePairs builds write map, identifies stales, produces removals/replacements
   - [ ] deduplicateFileInclusions scans delimiters, strips duplicate content
   - [ ] pruneByRecency walks reverse, counts per tool, replaces with pointer

3. **Would the test FAIL if implementation was removed?**
   - [ ] Returning empty DensityResult → all pruning tests fail
   - [ ] Removing write map → stale reads not identified
   - [ ] Removing dedup → duplicate inclusions not stripped
   - [ ] Removing recency → old results not pruned

4. **Is the feature REACHABLE by users?**
   - [ ] optimize() is public on HighDensityStrategy
   - [ ] Strategy will be registered in factory (future phase)
   - [ ] Orchestrator will call optimize() (future phase)

5. **What's MISSING?**
   - [ ] compress() — still stubbed (Phase 14)
   - [ ] Strategy factory registration — future phase
   - [ ] Orchestrator integration — future phase

#### Feature Actually Works

```bash
# Run optimize-specific tests
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-optimize.test.ts 2>&1
# Expected: ALL tests pass with 0 failures
# Actual: [paste output]
```

#### Integration Points Verified

- [ ] IContent type matches what tests and implementation expect (speaker, blocks, etc.)
- [ ] DensityResult type matches optimize() return (removals as number[], replacements as ReadonlyMap)
- [ ] DensityConfig fields match what pruning methods access (readWritePruning, fileDedupe, etc.)
- [ ] path.resolve() imported from 'node:path'
- [ ] Constants (READ_TOOLS, WRITE_TOOLS) match actual tool names in the tool registry

#### Edge Cases Verified

- [ ] Empty history → empty result
- [ ] All config options false → empty result
- [ ] Malformed params → skipped without error
- [ ] Retention floor (< 1 → 1)
- [ ] Single-entry history
- [ ] History with no tool calls
- [ ] Read with no subsequent write → preserved

## Success Criteria

- ALL P10 tests pass
- TypeScript compiles cleanly
- Full test suite passes
- Deferred implementation detection clean (except compress stub)
- All semantic verification items checked
- Only `compress()` still throws NotYetImplemented
- Pseudocode line references match implementation logic

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/core/compression/HighDensityStrategy.ts`
2. Stubs from P09 will be restored
3. Cannot proceed to Phase 12 until fixed

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P11.md`
Contents:
```markdown
Phase: P11
Completed: [timestamp]
Files Modified:
  - packages/core/src/core/compression/HighDensityStrategy.ts [+N lines, -M lines]
Tests Passing: [all count from high-density-optimize.test.ts]
Verification: [paste verification output]

## Holistic Functionality Assessment
[Worker MUST fill this in — see Semantic Verification Checklist]

## Implementation Trace
- optimize(): pseudocode lines 20-53 → [actual line range]
- pruneReadWritePairs(): pseudocode lines 60-209 → [actual line range]
- canPruneReadManyFiles(): pseudocode lines 215-255 → [actual line range]
- extractFilePath(): pseudocode lines 260-267 → [actual line range]
- resolvePath(): pseudocode lines 270-273 → [actual line range]
- deduplicateFileInclusions(): pseudocode lines 280-359 → [actual line range]
- findAllInclusions(): pseudocode lines 365-393 → [actual line range]
- pruneByRecency(): pseudocode lines 400-464 → [actual line range]
- isEmptyTextBlock(): pseudocode lines 470-471 → [actual line range]
```
