# Phase 28: Deprecation & Cleanup

## Phase ID

`PLAN-20260211-HIGHDENSITY.P28`

## Prerequisites

- Required: Phase 27 completed
- Verification: `npm run test -- --run packages/core/src/core/compression/__tests__/migration-compatibility.test.ts` → All pass
- Expected files from previous phase:
  - `packages/core/src/core/compression/__tests__/migration-compatibility.test.ts` (migration tests passing)
- Preflight verification: Phase 01a completed

## Requirements Implemented (Expanded)

### Deprecation: Remove Legacy Code (if any)

Per the integration phase requirements (dev-docs/PLAN.md), every plan must include a deprecation phase to remove old implementation code that was replaced. For high-density compression:

- No existing code was REPLACED — the feature is additive
- However, stub-phase artifacts may remain: `NotYetImplemented` throws, temporary markers, placeholder comments

### Cleanup: Remove Stub Phase Artifacts

**Behavior**:
- GIVEN: All implementation phases (P03–P26) are complete
- WHEN: A code scan is performed
- THEN: No `NotYetImplemented`, `STUB`, `TEMPORARY`, `WIP`, or phase-transition TODO markers remain in production code
**Why This Matters**: Stub artifacts left in production code are confusing and may cause runtime errors if hit.

### Cleanup: Verify Plan Marker Consistency

**Behavior**:
- GIVEN: Multiple phases modified the same files
- WHEN: Plan markers are checked
- THEN: Each file references the LATEST phase that modified it, and all requirement markers are present
**Why This Matters**: Stale plan markers make traceability audits confusing.

## Implementation Tasks

### Scan and Clean

#### 1. Remove NotYetImplemented Throws

```bash
# Find any remaining NotYetImplemented in HD files
grep -rn "NotYetImplemented" \
  packages/core/src/core/compression/HighDensityStrategy.ts \
  packages/core/src/core/compression/density/ \
  packages/core/src/core/compression/compressionStrategyFactory.ts \
  packages/core/src/core/compression/types.ts \
  packages/core/src/core/geminiChat.ts \
  packages/core/src/settings/settingsRegistry.ts \
  2>/dev/null
```

If any found: remove the throw and replace with the actual implementation (should already be done by impl phases).

#### 2. Remove Stub/Temporary Markers

```bash
# Find stub-phase artifacts
grep -rn -E "(STUB|TEMPORARY|WIP|XXX)" \
  packages/core/src/core/compression/ \
  packages/core/src/core/geminiChat.ts \
  packages/core/src/core/prompts.ts \
  packages/core/src/settings/settingsRegistry.ts \
  2>/dev/null | grep -v test | grep -v node_modules
```

If any found: remove the marker or resolve the deferred work.

#### 3. Remove Phase-Transition TODOs

```bash
# Find TODOs that reference future phases
grep -rn -E "TODO.*P[0-9]|FIXME.*phase|TODO.*phase" \
  packages/core/src/core/compression/ \
  packages/core/src/core/geminiChat.ts \
  packages/core/src/core/prompts.ts \
  2>/dev/null | grep -v test
```

If any found: the referenced phase is now complete — remove the TODO.

#### 4. Verify No Dead Code

```bash
# Check for unused imports in HD files
cd packages/core && npx tsc --noEmit --noUnusedLocals 2>&1 | grep -i "density\|high.density\|HighDensity"
```

If any found: remove the unused import.

#### 5. Update Plan Markers to Final Phase

Files modified across multiple phases should reference their latest modification:

- `packages/core/src/core/compression/types.ts` — last modified P21 (activeTodos, transcriptPath)
- `packages/core/src/core/compression/HighDensityStrategy.ts` — last modified P14 (compress impl) or P11 (optimize impl)
- `packages/core/src/core/geminiChat.ts` — last modified P23 (buildCompressionContext)
- `packages/core/src/core/prompts.ts` — last modified P21 (enriched sections)
- `packages/core/src/core/compression/MiddleOutStrategy.ts` — last modified P23 (todo injection)
- `packages/core/src/core/compression/OneShotStrategy.ts` — last modified P23 (todo injection)

### Files Potentially Modified

- Any files listed above where cleanup artifacts are found
- Cleanup changes should be minimal — removing markers, not changing logic

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-HIGHDENSITY.P28
 */
// Cleanup: removed [artifact] left from P[NN] stub phase
```

## Verification Commands

### Automated Checks

```bash
# 1. No NotYetImplemented in production code
grep -rn "NotYetImplemented" packages/core/src/core/compression/ packages/core/src/core/geminiChat.ts packages/core/src/core/prompts.ts packages/core/src/settings/settingsRegistry.ts 2>/dev/null | grep -v test | grep -v "__tests__"
# Expected: 0 matches

# 2. No STUB/TEMPORARY/WIP markers in production code
grep -rn -E "(STUB|TEMPORARY|WIP|XXX)" packages/core/src/core/compression/ packages/core/src/core/geminiChat.ts packages/core/src/core/prompts.ts 2>/dev/null | grep -v test | grep -v "__tests__" | grep -v node_modules
# Expected: 0 matches

# 3. No phase-transition TODOs
grep -rn -E "TODO.*P[0-9]|FIXME.*phase" packages/core/src/core/compression/ packages/core/src/core/geminiChat.ts 2>/dev/null | grep -v test
# Expected: 0 matches

# 4. TypeScript compiles
cd packages/core && npx tsc --noEmit
# Expected: 0 errors

# 5. All tests pass (cleanup didn't break anything)
npm run test -- --run
# Expected: All pass

# 6. Full verification cycle
npm run lint && npm run typecheck && npm run format && npm run build
# Expected: All pass

# 7. Manual test
node scripts/start.js --profile-load syntheticglm47 "write me a haiku"
# Expected: Runs successfully
```

### Semantic Verification Checklist (MANDATORY)

1. **Is production code clean?**
   - [ ] No NotYetImplemented throws
   - [ ] No STUB/TEMPORARY/WIP markers
   - [ ] No phase-transition TODOs
   - [ ] No dead imports
   - [ ] No cop-out comments

2. **Are plan markers consistent?**
   - [ ] Each HD file has plan markers referencing its latest modification phase
   - [ ] Requirement markers are present and accurate

3. **Did cleanup break anything?**
   - [ ] All tests pass
   - [ ] TypeScript compiles
   - [ ] Lint passes
   - [ ] Manual test succeeds

## Success Criteria

- Zero NotYetImplemented, STUB, TEMPORARY, WIP, or XXX in production HD code
- Zero phase-transition TODOs in production code
- All tests pass
- Full verification cycle passes
- Code is clean and ready for final verification

## Failure Recovery

If this phase fails:
1. Revert cleanup changes that broke tests
2. Fix the underlying issue (stub that was supposed to be replaced wasn't)
3. Re-run P28

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P28.md`
Contents:
```markdown
Phase: P28
Completed: [timestamp]
Artifacts Removed:
  - [list of removed stubs/markers, or "none found — code was clean"]
Files Modified:
  - [list, or "none"]
Verification: [paste verification output]
```
