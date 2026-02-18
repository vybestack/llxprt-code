# Phase 27: --resume Flag Removal — Stub

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P27`

## Prerequisites

- Required: Phase 26a completed
- Verification: `test -f project-plans/issue1385/.completed/P26a.md`
- Expected files from previous phase:
  - `packages/cli/src/ui/commands/formatSessionSection.ts` — implemented
- Preflight verification: Phase 0.5 completed

## Requirements Implemented (Expanded)

### REQ-RR-001: Remove --resume Option
**Full Text**: The `--resume` and `-r` CLI options shall be removed from the argument parser.
**Behavior**:
- GIVEN: The CLI argument parser definition in config.ts
- WHEN: This phase is complete
- THEN: The `.option('resume', { alias: 'r', ... })` block is removed from the yargs chain
**Why This Matters**: `--resume` duplicates `--continue` and creates confusion.

### REQ-RR-002: Remove resume Field
**Full Text**: The `resume` field shall be removed from the parsed CLI args interface.
**Behavior**:
- GIVEN: The parsed args type definition in config.ts
- WHEN: This phase is complete
- THEN: The `resume: string | typeof RESUME_LATEST | undefined` field is removed
**Why This Matters**: Dead fields in the interface create maintenance burden.

### REQ-RR-003: Remove Code Paths Referencing args.resume
**Full Text**: Any code paths referencing `args.resume` shall be removed.
**Behavior**:
- GIVEN: The runtime code in config.ts
- WHEN: This phase is complete
- THEN: The `resume: result.resume as string | typeof RESUME_LATEST | undefined` assignment is removed
**Why This Matters**: Dead code paths are confusing and may break in unexpected ways.

### REQ-RR-004: Remove RESUME_LATEST
**Full Text**: `RESUME_LATEST` constant in `sessionUtils.ts` shall be removed.
**Behavior**:
- GIVEN: `sessionUtils.ts` exports `RESUME_LATEST`
- WHEN: This phase is complete
- THEN: The constant is removed and no imports reference it
**Why This Matters**: No longer needed after --resume flag removal.

### REQ-RR-005: Remove SessionSelector
**Full Text**: `SessionSelector` class and `SessionSelectionResult` interface in `sessionUtils.ts` shall be removed.
**Behavior**:
- GIVEN: `sessionUtils.ts` exports `SessionSelector` and `SessionSelectionResult`
- WHEN: This phase is complete
- THEN: Both are removed (they were only used by the --resume code path)
**Why This Matters**: Dead code. The new `/continue` command uses `SessionDiscovery.resolveSessionRef()` from core.

### REQ-RR-006: Preserve --continue
**Full Text**: Existing `--continue` / `-C` behavior shall be unaffected.
**Behavior**:
- GIVEN: A user running `llxprt --continue`
- WHEN: The --resume flag is removed
- THEN: `--continue` works identically to before this change
**Why This Matters**: `--continue` is the correct mechanism for startup-time resume.

### REQ-RR-007: Preserve --list-sessions
**Full Text**: The `--list-sessions` flag shall be unaffected.
**Behavior**:
- GIVEN: A user running `llxprt --list-sessions`
- WHEN: The --resume flag is removed
- THEN: `--list-sessions` works identically to before this change

### REQ-RR-008: Preserve --delete-session
**Full Text**: The `--delete-session` flag shall be unaffected.
**Behavior**:
- GIVEN: A user running `llxprt --delete-session <ref>`
- WHEN: The --resume flag is removed
- THEN: `--delete-session` works identically to before this change

## Implementation Tasks

### Approach: Stub Phase = Deprecation Markers

For legacy cleanup, the "stub" phase marks the items for removal with deprecation comments, establishing the scope of the change before tests and actual removal.

### Files to Modify

- `packages/cli/src/config/config.ts`
  - Line 52: Mark `import { RESUME_LATEST } from '../utils/sessionUtils.js';` with `// @deprecated PLAN-20260214-SESSIONBROWSER.P27 — remove in P29`
  - Line 167: Mark `resume: string | typeof RESUME_LATEST | undefined;` with deprecation comment
  - Lines 349-361: Mark `.option('resume', { ... })` with deprecation comment
  - Line 687: Mark `resume: result.resume as ...` with deprecation comment
  - ADD marker: `@plan PLAN-20260214-SESSIONBROWSER.P27`

- `packages/cli/src/utils/sessionUtils.ts`
  - Line 19: Mark `RESUME_LATEST` with deprecation comment
  - Line 44: Mark `SessionSelectionResult` with deprecation comment
  - Line 161: Mark `SessionSelector` class with deprecation comment
  - ADD marker: `@plan PLAN-20260214-SESSIONBROWSER.P27`

### What MUST NOT Be Touched

- `SessionInfo` interface (line 24) — used by `sessionCleanup.ts`
- `SessionFileEntry` interface (line 54) — used by `sessionCleanup.ts`
- `getSessionFiles()` function — used by `sessionCleanup.ts`
- `getAllSessionFiles()` function — used by `sessionCleanup.spec.ts` and `sessionCleanup.ts`
- `--continue` / `-C` option and its entire flow
- `--list-sessions` option
- `--delete-session` option

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260214-SESSIONBROWSER.P27
 * @requirement REQ-RR-001, REQ-RR-002, REQ-RR-003, REQ-RR-004, REQ-RR-005
 */
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check deprecation markers were added
grep -c "@deprecated.*PLAN-20260214-SESSIONBROWSER.P27" packages/cli/src/config/config.ts
# Expected: 4 (import, field, option, assignment)

grep -c "@deprecated.*PLAN-20260214-SESSIONBROWSER.P27" packages/cli/src/utils/sessionUtils.ts
# Expected: 3 (RESUME_LATEST, SessionSelectionResult, SessionSelector)

# Verify preserved exports are untouched
grep "export interface SessionInfo" packages/cli/src/utils/sessionUtils.ts
grep "export interface SessionFileEntry" packages/cli/src/utils/sessionUtils.ts
grep "export.*getSessionFiles" packages/cli/src/utils/sessionUtils.ts
grep "export.*getAllSessionFiles" packages/cli/src/utils/sessionUtils.ts
# Expected: All 4 present

# TypeScript compiles (deprecation comments don't break anything)
npm run typecheck
# Expected: Pass

# Full test suite still passes (nothing removed yet)
npm run test
# Expected: Pass
```

### Semantic Verification Checklist

1. **Are the right things marked for removal?**
   - [ ] RESUME_LATEST marked
   - [ ] SessionSelector class marked
   - [ ] SessionSelectionResult interface marked
   - [ ] .option('resume', ...) marked
   - [ ] resume field type marked
   - [ ] resume assignment marked
   - [ ] RESUME_LATEST import in config.ts marked

2. **Are the right things PRESERVED?**
   - [ ] SessionInfo NOT marked
   - [ ] SessionFileEntry NOT marked
   - [ ] getSessionFiles NOT marked
   - [ ] getAllSessionFiles NOT marked
   - [ ] --continue NOT marked
   - [ ] --list-sessions NOT marked
   - [ ] --delete-session NOT marked

## Success Criteria

- All items to remove are annotated with deprecation markers
- All items to preserve are untouched
- TypeScript compiles
- Full test suite passes

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/cli/src/config/config.ts`
2. `git checkout -- packages/cli/src/utils/sessionUtils.ts`
3. Re-run Phase 27

## Phase Completion Marker

Create: `project-plans/issue1385/.completed/P27.md`
Contents:
```markdown
Phase: P27
Completed: YYYY-MM-DD HH:MM
Files Modified: [list with diff stats]
Deprecation Markers Added: 7
Verification: [paste of verification command outputs]
```
