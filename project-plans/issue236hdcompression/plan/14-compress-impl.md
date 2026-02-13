# Phase 14: HighDensityStrategy — Compress Implementation

## Phase ID

`PLAN-20260211-HIGHDENSITY.P14`

## Prerequisites

- Required: Phase 13 completed
- Verification: `grep -r "@plan:PLAN-20260211-HIGHDENSITY.P13" packages/core/src/core/compression/__tests__/ | wc -l` → ≥ 1
- Expected files from previous phase:
  - `packages/core/src/core/compression/__tests__/high-density-compress.test.ts`
- Preflight verification: Phase 01a completed

## Requirements Implemented (Expanded)

### REQ-HD-008.1: No LLM Call

**Full Text**: The `HighDensityStrategy.compress()` method shall not make any LLM calls.
**Behavior**:
- GIVEN: A HighDensityStrategy instance
- WHEN: `compress()` executes
- THEN: No provider is resolved, no LLM API is called, compression is entirely deterministic
**Why This Matters**: Deterministic, free compression is the core value proposition.

### REQ-HD-008.2: Recent Tail Preservation

**Full Text**: Preserve the recent tail determined by `preserveThreshold`.
**Behavior**:
- GIVEN: preserveThreshold=0.3, history of 20 entries
- WHEN: compress()
- THEN: Last 6 entries preserved intact; tail boundary adjusted for tool_call/response pairs
**Why This Matters**: Model coherence requires recent context.

### REQ-HD-008.3: Tool Response Summarization

**Full Text**: Replace tool response payloads outside the tail with compact one-line summaries.
**Behavior**:
- GIVEN: Tool response with 500-line file content, outside tail
- WHEN: Summarized
- THEN: Result becomes `'[read_file: 500 lines — success]'` or similar
**Why This Matters**: Tool responses are the largest token consumers.

### REQ-HD-008.4: Non-Tool Content Preserved

**Full Text**: Preserve all tool call blocks, human messages, and AI text blocks intact.
**Why This Matters**: Human messages and AI reasoning provide irreplaceable context.

### REQ-HD-008.5: CompressionResult Assembly

**Full Text**: Return `CompressionResult` with `newHistory` and `metadata`.
**Why This Matters**: The orchestrator expects this shape to proceed with the turn loop.

### REQ-HD-008.6: Target Token Count

**Full Text**: Target `compressionThreshold × contextLimit × 0.6`.
**Behavior**:
- GIVEN: threshold=0.85, contextLimit=128000
- WHEN: Target calculated
- THEN: ≈ 65,280 tokens
**Why This Matters**: 0.6 multiplier provides headroom before next trigger.

## Implementation Tasks

### Files to Modify

- `packages/core/src/core/compression/HighDensityStrategy.ts`
  - REPLACE stub `compress()` with full implementation
  - REPLACE stub `summarizeToolResponseBlocks()` with full implementation
  - REPLACE stub `buildToolSummaryText()` with full implementation
  - REPLACE stub `truncateToTarget()` with full implementation
  - REPLACE stub `buildMetadata()` with full implementation
  - UPDATE plan markers: `@plan:PLAN-20260211-HIGHDENSITY.P14`
  - RETAIN requirement markers from P12
  - ADD pseudocode line references

### Implementation Mapping (Pseudocode → Code)

#### compress() — pseudocode high-density-compress.md lines 10–91

```
Lines 10-12: Method signature, get history and originalCount from context
Lines 14-19: Edge case — empty history → return empty result with buildMetadata
Lines 21-24: STEP 1 — Calculate tail size from preserveThreshold
             preserveThreshold from context.runtimeContext.ephemerals.preserveThreshold()
             tailSize = Math.ceil(history.length * preserveThreshold)
             tailStartIndex = history.length - tailSize
Line 27:     Adjust for tool_call boundary — import adjustForToolCallBoundary from ./utils.js
Lines 29-34: If tail covers everything (tailStartIndex <= 0), return history unchanged
Lines 36-39: STEP 2 — Calculate target tokens
             threshold from ephemerals.compressionThreshold()
             contextLimit from ephemerals.contextLimit()
             targetTokens = Math.floor(threshold * contextLimit * 0.6)
Lines 41-46: Debug logging
Lines 48-49: STEP 3 — Build new history array
Lines 52-70: 3a — Process entries BEFORE tail:
             human → push unchanged (REQ-HD-008.4)
             ai → push unchanged (REQ-HD-008.4)
             tool → summarize via summarizeToolResponseBlocks, push with spread
Lines 72-74: 3b — Push tail entries intact
Lines 76-85: STEP 4 — Check if over target, apply truncateToTarget if needed
Lines 87-91: STEP 5 — Return { newHistory, metadata: buildMetadata(...) }
```

#### summarizeToolResponseBlocks() — pseudocode lines 100–112

```
Lines 100-112: Map over blocks array
              If block.type !== 'tool_response' → return unchanged
              Else → spread block, replace result with buildToolSummaryText(block)
```

#### buildToolSummaryText() — pseudocode lines 120–149

```
Lines 120-122: Extract toolName and outcome ('success' or 'error')
Lines 124-138: Extract keyParam from response:
              If result is string → count lines
              If result is object with file_path/absolute_path/path → use that
              If result is object with output → count chars
Lines 140-143: Build summary:
              If keyParam: '[toolName: keyParam — outcome]'
              Else: '[toolName — outcome]'
```

#### truncateToTarget() — pseudocode lines 155–175

```
Lines 155-160: Method signature — receives history array, tailStartIndex, targetTokens, context
Lines 161-163: Fallback for when summarization alone is insufficient
Lines 165-167: Copy history, estimate tokens, compute headEnd
Lines 169-173: While over target and headEnd > 0: shift oldest entry, decrement headEnd, re-estimate
Line 175:     Return trimmed result
```

**Important**: This method is async because it calls `context.estimateTokens()`.

#### buildMetadata() — pseudocode lines 180–193

```
Lines 180-193: Return CompressionResultMetadata with:
              originalMessageCount, compressedMessageCount, strategyUsed: 'high-density',
              llmCallMade (always false), topPreserved/bottomPreserved/middleCompressed: undefined
```

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-HIGHDENSITY.P14
 * @requirement REQ-HD-008.1, REQ-HD-008.2, REQ-HD-008.3, REQ-HD-008.4, REQ-HD-008.5, REQ-HD-008.6
 * @pseudocode high-density-compress.md lines 10-91
 */
async compress(context: CompressionContext): Promise<CompressionResult> {
  // REAL implementation
}
```

### Anti-Patterns to Avoid (from pseudocode)

- **DO NOT** make any LLM calls — no resolveProvider, no provider.complete() (REQ-HD-008.1)
- **DO NOT** remove tool_call blocks from AI entries — preserve intact (REQ-HD-008.4)
- **DO NOT** remove human messages — preserve intact (REQ-HD-008.4)
- **DO NOT** ignore preserveThreshold — the tail must be preserved (REQ-HD-008.2)
- **DO NOT** return newHistory shorter than the tail — truncateToTarget never removes tail entries
- **DO NOT** use response.result directly as summary — build a compact string (REQ-HD-008.3)
- **DO NOT** assume context.history is raw — compress receives CURATED history

### Import Requirements

```typescript
// Likely needed (verify existing):
import { adjustForToolCallBoundary } from './utils.js';
```

## Verification Commands

### Automated Checks

```bash
# 1. ALL P13 tests pass
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-compress.test.ts
# Expected: All pass, 0 failures

# 2. ALL P10 tests still pass (no regression)
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-optimize.test.ts
# Expected: All pass, 0 failures

# 3. TypeScript compiles
cd packages/core && npx tsc --noEmit
# Expected: 0 errors

# 4. Full test suite passes
npm run test -- --run
# Expected: All pass

# 5. Plan markers updated to P14
grep -c "@plan.*HIGHDENSITY.P14" packages/core/src/core/compression/HighDensityStrategy.ts
# Expected: ≥ 1

# 6. Pseudocode references for compress
grep -c "@pseudocode.*high-density-compress" packages/core/src/core/compression/HighDensityStrategy.ts
# Expected: ≥ 4
```

### Structural Verification Checklist

- [ ] Previous phase markers present (P13)
- [ ] No skipped phases (P13 exists)
- [ ] All listed files created/modified
- [ ] Plan markers added to all changes
- [ ] Tests pass for this phase
- [ ] No "TODO" or "NotImplemented" in phase code

### Deferred Implementation Detection (MANDATORY)

```bash
# Check for TODO/FIXME/HACK in implementation
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/core/compression/HighDensityStrategy.ts | grep -v ".test.ts"
# Expected: No matches

# Check for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/core/compression/HighDensityStrategy.ts | grep -v ".test.ts"
# Expected: No matches

# Check that NO NotYetImplemented remains
grep -c "NotYetImplemented" packages/core/src/core/compression/HighDensityStrategy.ts
# Expected: 0 (ALL stubs now implemented)

# Check for empty/trivial implementations
grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/core/src/core/compression/HighDensityStrategy.ts | grep -v ".test.ts"
# Expected: No matches (or only in edge-case branches like empty history)
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions

1. **Does the code DO what the requirement says?**
   - [ ] REQ-HD-008.1: No resolveProvider calls, no LLM API usage — verified by reading compress()
   - [ ] REQ-HD-008.2: preserveThreshold used for tail, adjustForToolCallBoundary called — verified
   - [ ] REQ-HD-008.3: Tool responses outside tail summarized via buildToolSummaryText — verified
   - [ ] REQ-HD-008.4: Human and AI entries passed through unchanged — verified by reading the for loop
   - [ ] REQ-HD-008.5: CompressionResult has newHistory + metadata with correct shape — verified
   - [ ] REQ-HD-008.6: targetTokens = floor(threshold × contextLimit × 0.6) — verified in code

2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed (0 NotYetImplemented)
   - [ ] compress() has full 5-step pipeline
   - [ ] summarizeToolResponseBlocks maps blocks with real summarization
   - [ ] buildToolSummaryText extracts tool info and builds compact strings
   - [ ] truncateToTarget iterates and removes entries until under target
   - [ ] buildMetadata returns correct CompressionResultMetadata

3. **Would the test FAIL if implementation was removed?**
   - [ ] Returning empty result → all tests fail
   - [ ] Skipping summarization → summary tests fail (full result still present)
   - [ ] Skipping tail preservation → tail tests fail
   - [ ] Adding LLM call → resolveProvider test throws
   - [ ] Wrong metadata → metadata tests fail

4. **Is the feature REACHABLE by users?**
   - [ ] compress() is public on HighDensityStrategy
   - [ ] Strategy will be registered in factory (future phase)
   - [ ] Orchestrator calls compress() when threshold exceeded (existing path)

5. **What's MISSING?**
   - [ ] Strategy factory registration — future phase
   - [ ] Orchestrator density integration — future phase
   - [ ] Settings registration — future phase

#### Feature Actually Works

```bash
# Run compress-specific tests
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-compress.test.ts 2>&1
# Expected: ALL tests pass with 0 failures
# Actual: [paste output]

# Run optimize tests (no regression)
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-optimize.test.ts 2>&1
# Expected: ALL tests pass with 0 failures
# Actual: [paste output]
```

#### Integration Points Verified

- [ ] `adjustForToolCallBoundary` imported from `./utils.js` and works correctly
- [ ] `CompressionContext` shape matches what compress() expects (history, ephemerals, estimateTokens, logger)
- [ ] `CompressionResult` shape matches what orchestrator expects (newHistory, metadata)
- [ ] `ephemerals.preserveThreshold()`, `.compressionThreshold()`, `.contextLimit()` all accessible
- [ ] `context.estimateTokens()` callable with IContent array

#### Edge Cases Verified

- [ ] Empty history → empty result, no errors
- [ ] Single entry → preserved unchanged
- [ ] Tail covering all entries → no modification
- [ ] Very large history → truncation kicks in
- [ ] Tool response with null/undefined result → summary handles gracefully
- [ ] Tool response with error flag → summary shows 'error'

## Success Criteria

- ALL P13 tests pass
- ALL P10 tests pass (no regression)
- TypeScript compiles cleanly
- Full test suite passes
- Deferred implementation detection clean (0 NotYetImplemented)
- All semantic verification items checked
- HighDensityStrategy is now FULLY implemented (optimize + compress)
- Pseudocode line references match implementation logic

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/core/compression/HighDensityStrategy.ts`
2. P12 stubs restored (compress throws, optimize still works)
3. Cannot proceed to Phase 15 until fixed

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P14.md`
Contents:
```markdown
Phase: P14
Completed: [timestamp]
Files Modified:
  - packages/core/src/core/compression/HighDensityStrategy.ts [+N lines, -M lines]
Tests Passing:
  - high-density-optimize.test.ts: [count]
  - high-density-compress.test.ts: [count]
Verification: [paste verification output]

## Holistic Functionality Assessment
[Worker MUST fill this in — see Semantic Verification Checklist]

## Implementation Trace
- compress(): pseudocode high-density-compress.md lines 10-91 → [actual line range]
- summarizeToolResponseBlocks(): pseudocode lines 100-112 → [actual line range]
- buildToolSummaryText(): pseudocode lines 120-149 → [actual line range]
- truncateToTarget(): pseudocode lines 155-175 → [actual line range]
- buildMetadata(): pseudocode lines 180-193 → [actual line range]

## Full Strategy Status
- optimize(): COMPLETE (P11)
- compress(): COMPLETE (P14)
- All NotYetImplemented stubs: REPLACED
- Remaining work: factory registration, orchestrator integration, settings (future phases)
```
