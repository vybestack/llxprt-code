# Phase 17: Final Verification

## Phase ID

`PLAN-20260325-HOOKSPLIT.P17`

## Prerequisites

- Required: Phase 16a (Integration Impl Verification) completed
- Verification: `test -f project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P16a.md`
- Expected: All phases P00a through P16a completed successfully

## Requirements Implemented (Expanded)

### REQ-211-NR01: Full Verification Suite Passes

**Full Text**: The complete project verification suite must pass: tests, linting, type checking, formatting, build, and smoke test.
**Behavior**:
- GIVEN: All hooks schema split changes are in place (schema, migration, config types, CLI loading, integration wiring)
- WHEN: The full verification suite is executed
- THEN: Every command succeeds with exit code 0 and the smoke test produces valid output
**Why This Matters**: This is the final gate ensuring the refactor introduces zero regressions and the project is in a shippable state.

## Implementation Tasks

This phase has NO implementation tasks. It is a pure verification gate.

### Full Verification Suite

Run the complete suite in sequence. Every command must succeed.

```bash
npm run test && npm run lint && npm run typecheck && npm run format && npm run build && node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

### Individual Command Expectations

1. **`npm run test`** — All unit, integration, and behavioral tests pass. Zero failures.
2. **`npm run lint`** — No lint errors or warnings (or only pre-existing ones unrelated to this refactor).
3. **`npm run typecheck`** — TypeScript compilation succeeds with no errors.
4. **`npm run format`** — Code formatting is clean (no unformatted files). If format modifies files, they must be committed.
5. **`npm run build`** — Production build completes successfully.
6. **`node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`** — Smoke test: CLI starts, loads synthetic profile, produces a haiku response, exits cleanly.

## Verification Commands

### 1. Test Suite

```bash
npm run test
# Expected: All tests pass, exit code 0
# Watch for: Any test referencing old hooks format that was missed
```

### 2. Linting

```bash
npm run lint
# Expected: Clean, exit code 0
```

### 3. Type Checking

```bash
npm run typecheck
# Expected: Clean, exit code 0
# Watch for: Type errors from incomplete schema/interface updates
```

### 4. Formatting

```bash
npm run format
# Expected: No files changed (already formatted), exit code 0
# If files ARE changed: stage and commit them before proceeding
```

### 5. Build

```bash
npm run build
# Expected: Build succeeds, exit code 0
# Watch for: Build-time errors from missing exports or circular dependencies
```

### 6. Smoke Test

```bash
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
# Expected: CLI starts, produces a haiku, exits cleanly
# Watch for: Startup errors related to settings loading or hook initialization
```

### 7. Final Old-Format Pattern Sweep

```bash
# Absolute final check: no old-format hooks patterns in production code
grep -rn "settings\.hooks\.\(enabled\|disabled\|notifications\)" packages/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist | grep -v "\.test\." | grep -v "\.spec\."
# Expected: 0 matches
```

### 8. Plan Marker Audit

```bash
# All phases should have markers in the codebase
for phase in P03 P04 P05 P06 P07 P08 P09 P10 P11 P12 P13 P14 P15 P16; do
  count=$(grep -rc "@plan:PLAN-20260325-HOOKSPLIT.${phase}\b" packages/ integration-tests/ --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v ":0$" | wc -l)
  echo "${phase}: ${count} files"
done
# Expected: Each implementation phase has 1+ file with markers
```

### 9. Requirement Coverage Audit

```bash
# Spot-check key requirements have markers
for req in REQ-211-S01 REQ-211-M01 REQ-211-C01 REQ-211-CC01 REQ-211-HD01 REQ-211-CMD01 REQ-211-ZD01; do
  count=$(grep -rc "@requirement:${req}" packages/ integration-tests/ --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v ":0$" | wc -l)
  echo "${req}: ${count} files"
done
# Expected: Each key requirement has 1+ file with markers
```

### 10. Completion Markers Audit

```bash
ls -la project-plans/gmerge-0.26.0/211d2c5-plan/.completed/
# Expected: P00a.md through P16a.md all present
```


### Structural Verification Checklist

- [ ] Previous phase markers present
- [ ] No skipped phases
- [ ] All listed files created/modified
- [ ] Plan markers added to all changes
- [ ] Tests pass for this phase
- [ ] No "TODO" or "NotImplemented" in phase code

## Semantic Verification Checklist

1. **Does the code DO what the requirement says?**
   - [ ] Old-format settings files are transparently migrated (REQ-211-ZD01)
   - [ ] `hooksConfig` is a separate settings key (REQ-211-S01)
   - [ ] `hooks` contains only event definitions (REQ-211-S02)
   - [ ] Migration is idempotent (REQ-211-M03)
   - [ ] Config reads enablement from `hooksConfig` (REQ-211-C01)
   - [ ] No user-visible behavioral change

2. **Is this REAL implementation, not placeholder?**
   - [ ] Smoke test produces real output (haiku)
   - [ ] Build produces deployable artifacts
   - [ ] All tests exercise real code paths

3. **Would the test FAIL if implementation was removed?**
   - [ ] Migration tests fail without migrateHooksConfig
   - [ ] Schema tests fail without hooksConfig schema entry
   - [ ] Config tests fail without disabledHooks parameter
   - [ ] Integration tests fail without end-to-end wiring

4. **Is the feature REACHABLE by users?**
   - [ ] Settings file → load → migrate → merge → Config → hooks: complete path
   - [ ] Smoke test exercises the real CLI startup path

## Success Criteria

- `npm run test` — PASS
- `npm run lint` — PASS
- `npm run typecheck` — PASS
- `npm run format` — PASS (no changes)
- `npm run build` — PASS
- `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"` — PASS (produces haiku)
- No old-format patterns in production code
- Plan markers present for all implementation phases
- All completion markers present

## Failure Recovery

If any verification step fails:
1. Identify the failing command and specific error
2. Trace the error back to the responsible phase (P03–P16)
3. Fix the issue in the appropriate file
4. Re-run the FULL verification suite from the beginning (not just the failing command)
5. Do NOT proceed to commit until ALL steps pass

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P17.md`
Contents:

```markdown
Phase: P17
Completed: [YYYY-MM-DD HH:MM]
Verification Results:
  npm run test: PASS
  npm run lint: PASS
  npm run typecheck: PASS
  npm run format: PASS
  npm run build: PASS
  smoke test: PASS
Plan Status: COMPLETE
```
