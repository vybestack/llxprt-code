# Phase 29: --resume Flag Removal — Implementation

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P29`

## Prerequisites

- Required: Phase 28a completed
- Verification: `test -f project-plans/issue1385/.completed/P28a.md`
- Expected files from previous phase:
  - `packages/cli/src/config/__tests__/continueFlagRemoval.spec.ts` — 8+ tests (some failing)
  - `packages/cli/src/config/config.ts` — deprecation markers from P27
  - `packages/cli/src/utils/sessionUtils.ts` — deprecation markers from P27
- Preflight verification: Phase 0.5 completed

## Requirements Implemented (Expanded)

### REQ-RR-001: Remove --resume Option
**Full Text**: The `--resume` and `-r` CLI options shall be removed from the argument parser.
**Behavior**:
- GIVEN: The yargs configuration in config.ts
- WHEN: The `.option('resume', { alias: 'r', ... })` block is removed
- THEN: `--resume` and `-r` are no longer recognized CLI options

### REQ-RR-002: Remove resume Field
**Full Text**: The `resume` field shall be removed from the parsed CLI args interface.
**Behavior**:
- GIVEN: The args type definition
- WHEN: `resume: string | typeof RESUME_LATEST | undefined` is removed
- THEN: TypeScript catches any remaining references to `args.resume`

### REQ-RR-003: Remove Code Paths
**Full Text**: Any code paths referencing `args.resume` shall be removed.
**Behavior**:
- GIVEN: The config assignment code
- WHEN: `resume: result.resume as ...` is removed
- THEN: No runtime code references `args.resume`

### REQ-RR-004: Remove RESUME_LATEST
**Full Text**: `RESUME_LATEST` constant shall be removed from `sessionUtils.ts`.
**Behavior**:
- GIVEN: `sessionUtils.ts`
- WHEN: `export const RESUME_LATEST = 'latest'` is removed
- THEN: No module can import this symbol

### REQ-RR-005: Remove SessionSelector
**Full Text**: `SessionSelector` class and `SessionSelectionResult` interface shall be removed.
**Behavior**:
- GIVEN: `sessionUtils.ts`
- WHEN: Both are removed
- THEN: No module can import either symbol

## Implementation Tasks

### Pseudocode Reference
Implement removal per pseudocode `legacy-cleanup.md`:

- Lines 10-14: Remove `RESUME_LATEST` import from config.ts (line 52)
- Lines 16-19: Remove `.option('resume', ...)` from yargs chain (config.ts lines 349-361)
- Lines 21-24: Remove `resume` field from args type (config.ts line 167)
- Lines 26-29: Remove `resume` assignment from parsed result (config.ts line 687)
- Lines 40-43: Remove `RESUME_LATEST` from sessionUtils.ts (line 19)
- Lines 44-47: Remove `SessionSelectionResult` interface from sessionUtils.ts (line 44)
- Lines 48-51: Remove `SessionSelector` class from sessionUtils.ts (lines 161-270ish)
- Lines 60-63: Remove --resume test cases from config.spec.ts (lines 518-543) and RESUME_LATEST import (line 27)

### Files to Modify

1. **`packages/cli/src/config/config.ts`**
   - Remove import of `RESUME_LATEST` from sessionUtils (line ~52)
   - Remove `resume` field from the CLI args interface (line ~167)
   - Remove `.option('resume', { alias: 'r', type: 'string', describe: '...', coerce: ... })` (lines ~349-361)
   - Remove `resume: result.resume as string | typeof RESUME_LATEST | undefined` from parsed result (line ~687)
   - ADD marker: `@plan PLAN-20260214-SESSIONBROWSER.P29`

2. **`packages/cli/src/utils/sessionUtils.ts`**
   - Remove `export const RESUME_LATEST = 'latest';` (line 19)
   - Remove `export interface SessionSelectionResult { ... }` (line 44)
   - Remove `export class SessionSelector { ... }` (lines 161-270ish — the entire class)
   - KEEP: `SessionInfo` interface, `SessionFileEntry` interface, `getSessionFiles()`, `getAllSessionFiles()`
   - ADD marker: `@plan PLAN-20260214-SESSIONBROWSER.P29`

3. **`packages/cli/src/config/config.spec.ts`**
   - Remove import of `RESUME_LATEST` (line ~27)
   - Remove test case "should parse --resume with session-id" (lines ~518-529)
   - Remove test case "should coerce --resume latest to RESUME_LATEST" (lines ~531-543)
   - ADD marker: `@plan PLAN-20260214-SESSIONBROWSER.P29`

### DO NOT MODIFY
- `packages/cli/src/config/__tests__/continueFlagRemoval.spec.ts` — Tests from P28
- `packages/cli/src/utils/sessionCleanup.ts` — Must still work with remaining exports
- `packages/cli/src/utils/__tests__/sessionCleanup.spec.ts` — Must still pass

### Required Code Markers

```typescript
// In modified files:
// @plan PLAN-20260214-SESSIONBROWSER.P29
// @requirement REQ-RR-001, REQ-RR-002, REQ-RR-003, REQ-RR-004, REQ-RR-005
// @pseudocode legacy-cleanup.md lines 10-63
```

## Verification Commands

### Automated Checks (Structural)

```bash
# 1. --resume flag GONE from config
grep -n "option.*resume" packages/cli/src/config/config.ts | grep -v "// @plan"
# Expected: 0 matches (the option definition is gone)

# 2. RESUME_LATEST GONE from sessionUtils
grep "RESUME_LATEST" packages/cli/src/utils/sessionUtils.ts
# Expected: 0 matches

# 3. SessionSelector GONE from sessionUtils
grep "class SessionSelector" packages/cli/src/utils/sessionUtils.ts
# Expected: 0 matches

# 4. SessionSelectionResult GONE from sessionUtils
grep "interface SessionSelectionResult" packages/cli/src/utils/sessionUtils.ts
# Expected: 0 matches

# 5. RESUME_LATEST import GONE from config.ts
grep "RESUME_LATEST" packages/cli/src/config/config.ts
# Expected: 0 matches

# 6. RESUME_LATEST import GONE from config.spec.ts
grep "RESUME_LATEST" packages/cli/src/config/config.spec.ts
# Expected: 0 matches

# 7. Preserved exports still exist
grep "export interface SessionInfo" packages/cli/src/utils/sessionUtils.ts && echo "SessionInfo: OK"
grep "export interface SessionFileEntry" packages/cli/src/utils/sessionUtils.ts && echo "SessionFileEntry: OK"
grep "export.*getSessionFiles\|export.*getAllSessionFiles" packages/cli/src/utils/sessionUtils.ts | wc -l
# Expected: 2 (both preserved)

# 8. TypeScript compiles
npm run typecheck
# Expected: Pass

# 9. All tests pass (including new removal tests from P28)
npm run test -- --run packages/cli/src/config/__tests__/continueFlagRemoval.spec.ts
# Expected: ALL PASS

# 10. Session cleanup tests still pass
npm run test -- --run packages/cli/src/utils/__tests__/sessionCleanup.spec.ts
# Expected: ALL PASS

# 11. Config tests still pass (without the removed --resume tests)
npm run test -- --run packages/cli/src/config/config.spec.ts
# Expected: ALL PASS (minus the 2 removed --resume tests)

# 12. Full test suite
npm run test
# Expected: No regressions
```

### Deferred Implementation Detection

```bash
# Check for remaining deprecation markers (should all be cleaned up)
grep -rn "@deprecated.*P27" packages/cli/src/config/config.ts packages/cli/src/utils/sessionUtils.ts
# Expected: 0 matches (all deprecated items removed)

# Check for TODO/FIXME
grep -rn "TODO\|FIXME" packages/cli/src/config/config.ts packages/cli/src/utils/sessionUtils.ts | grep -v ".spec.ts"
# Expected: 0 matches (or only pre-existing)
```

### Semantic Verification Checklist

1. **Is --resume fully removed?**
   - [ ] `.option('resume', ...)` removed from yargs chain
   - [ ] `resume` field removed from args type
   - [ ] `resume` assignment removed from parsed result
   - [ ] `RESUME_LATEST` import removed from config.ts
   - [ ] `RESUME_LATEST` constant removed from sessionUtils.ts
   - [ ] `SessionSelector` class removed
   - [ ] `SessionSelectionResult` interface removed
   - [ ] Old test cases removed from config.spec.ts
   - [ ] RESUME_LATEST import removed from config.spec.ts

2. **Is --continue fully preserved?**
   - [ ] `.option('continue', ...)` still in yargs chain
   - [ ] `getContinueSessionRef()` still works
   - [ ] `--continue` / `-C` tests pass

3. **Are sessionCleanup.ts dependencies preserved?**
   - [ ] `SessionInfo` interface still exported
   - [ ] `SessionFileEntry` interface still exported
   - [ ] `getSessionFiles()` still exported
   - [ ] `getAllSessionFiles()` still exported
   - [ ] `sessionCleanup.spec.ts` passes

#### Feature Actually Works

```bash
# Verify --resume is rejected
node scripts/start.js --resume latest 2>&1 | head -5
# Expected: Unknown option error or similar

# Verify --continue still works (this may start a session, so just check flag parsing)
node scripts/start.js --help 2>&1 | grep -E "continue|resume"
# Expected: --continue present, --resume absent
```

#### Integration Points Verified

- [ ] config.ts compiles without RESUME_LATEST import
- [ ] sessionUtils.ts still exports what sessionCleanup needs
- [ ] No other file imports RESUME_LATEST, SessionSelector, or SessionSelectionResult

## Success Criteria

- All removal targets eliminated
- All preservation targets intact
- TypeScript compiles
- All tests pass (removal tests from P28 now green)
- sessionCleanup tests still pass
- Config tests still pass (minus removed --resume tests)

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/cli/src/config/config.ts`
2. `git checkout -- packages/cli/src/utils/sessionUtils.ts`
3. `git checkout -- packages/cli/src/config/config.spec.ts`
4. Re-run Phase 29 with corrected approach
5. MUST NOT modify test files from P28

## Phase Completion Marker

Create: `project-plans/issue1385/.completed/P29.md`
Contents:
```markdown
Phase: P29
Completed: YYYY-MM-DD HH:MM
Files Modified: [list with diff stats]
Lines Removed: [count]
Tests Passing: [count]
Verification: [paste of verification command outputs]
```
