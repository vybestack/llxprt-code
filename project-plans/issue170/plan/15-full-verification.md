# Phase 15: Full Verification

## Phase ID

`PLAN-20260211-COMPRESSION.P15`

## Prerequisites

- Required: Phase 14 completed (dispatcher passes, code extracted)
- Verification: `grep -r "@plan PLAN-20260211-COMPRESSION.P14" packages/core/src/`
- Expected: ALL previous phase tests passing

## Purpose

End-to-end verification that the entire feature works correctly, the build succeeds, and nothing is broken.

## Verification Checklist

### 1. Full Test Suite

```bash
npm run test
# Expected: ALL tests pass, including:
# - compression/utils.test.ts
# - compression/MiddleOutStrategy.test.ts
# - compression/TopDownTruncationStrategy.test.ts
# - compression/compressionStrategyFactory.test.ts
# - settingsRegistry.test.ts (compression settings)
# - createAgentRuntimeContext.test.ts (compression accessors)
# - client.test.ts (dispatcher tests)
```

### 2. Static Analysis

```bash
npm run lint
npm run typecheck
npm run format
npm run build
# Expected: all pass with zero errors
```

### 3. Smoke Test

```bash
node scripts/start.js --profile-load syntheticglm47 "write me a haiku"
# Expected: starts, responds, no crash
# This verifies the runtime wiring doesn't blow up on real startup
```

### 4. Deferred Implementation Detection

```bash
# No TODO/FIXME/HACK in compression module
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|WIP)" packages/core/src/core/compression/ --include="*.ts" | grep -v ".test.ts"
# Expected: 0 matches

# No cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/core/compression/ --include="*.ts" | grep -v ".test.ts"
# Expected: 0 matches

# No empty implementations
grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/core/src/core/compression/ --include="*.ts" | grep -v ".test.ts"
# Expected: 0 matches
```

### 5. Code Removal Verification

```bash
# Extracted methods are GONE from geminiChat.ts
grep -c "private getCompressionSplit\|private directCompressionCall\|private applyCompression\|private adjustForToolCallBoundary\|private findForwardValidSplitPoint\|private findBackwardValidSplitPoint" packages/core/src/core/geminiChat.ts
# Expected: 0

# getCompressionPrompt not imported in geminiChat.ts
grep "getCompressionPrompt" packages/core/src/core/geminiChat.ts
# Expected: 0 matches
```

### 6. Plan Marker Traceability

```bash
# All phases have markers
for phase in P02 P03 P04 P05 P06 P07 P08 P09 P10 P11 P12 P13 P14; do
  count=$(grep -r "@plan PLAN-20260211-COMPRESSION.${phase}" packages/core/src/ packages/cli/src/ 2>/dev/null | wc -l)
  echo "${phase}: ${count} markers"
done
# Expected: each phase has 2+ markers

# All requirements covered
for req in 001 002 003 004 005 006 007 008 009 010 011; do
  count=$(grep -r "@requirement REQ-CS-${req}" packages/core/src/ packages/cli/src/ 2>/dev/null | wc -l)
  echo "REQ-CS-${req}: ${count} markers"
done
# Expected: each requirement group has 1+ markers
```

### 7. Integration Points Verified

- [ ] `performCompression()` delegates to strategy (read both files, trace the call)
- [ ] Settings accessible via `/set compression.strategy` (autocomplete works)
- [ ] Settings accessible via `/set compression.profile` (autocomplete works)
- [ ] Runtime accessor reads ephemeral → persistent → throws
- [ ] Strategy receives `CompressionContext` without `historyService`
- [ ] Strategy returns `CompressionResult`, dispatcher rebuilds history
- [ ] Prompt loaded via `PromptResolver`, not hardcoded `getCompressionPrompt()`
- [ ] `compression.md` default ships via `ALL_DEFAULTS` / `PromptInstaller`

### 8. Behavioral Verification Questions

1. **Does the code DO what the requirements say?**
   - [ ] Read each REQ-CS requirement
   - [ ] Read the implementation
   - [ ] Can trace HOW each requirement is fulfilled

2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed
   - [ ] No empty returns in implementation
   - [ ] No "will be implemented" comments

3. **Would tests FAIL if implementation was removed?**
   - [ ] Tests verify actual outputs
   - [ ] Tests would catch broken implementation

4. **Is the feature REACHABLE by users?**
   - [ ] `/set compression.strategy` works
   - [ ] `/settings` dialog shows compression options
   - [ ] Compression triggers with configured strategy during normal use

## Success Criteria

- ALL checks pass
- ALL tests pass
- Build succeeds
- Smoke test runs without crash
- No deferred implementation detected
- All plan markers traceable
- Feature is integrated and reachable

## Phase Completion Marker

Create: `project-plans/issue170/.completed/P15.md`
Contents:
```markdown
Phase: P15
Completed: [timestamp]
Files Created: [list]
Files Modified: [list]
Tests Added: [count]
Verification: [paste command outputs]
```
