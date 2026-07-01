# Phase 06a: Boundary Checker Characterization Proof Verification

## Phase ID
`PLAN-20260629-ISSUE2285.P06a`

## Prerequisites
- Required: Phase 06 completed.
- Verification: `test -f project-plans/issue2285/.completed/P06.md`.

## Verification Tasks

The deepthinker verifier confirms:

1. **Executable proof exists and PASSES (revision 3 finding 6 — GREEN
   characterization, not RED)**: the file
   `project-plans/issue2285/analysis/boundary-checker-characterization-proof.mjs` exists,
   is runnable, and PASSES today by characterizing the CURRENT (old) boundary
   checker behavior with explicit assertions. It does NOT leave CI red.
2. **Test file modification explicit and verified (revision 4 finding 11)**:
   `scripts/tests/cli-import-boundary.test.js` IS modified in P06 (annotation
   only — a comment block identifying old symbol-level tests for P07 removal).
   This is an explicit modification to a real test file. The verifier confirms
   the diff contains ONLY annotation comments (no test bodies changed, no
   tests removed, no new tests added, no skipped tests) — the modification is
   purely the identification comment block.
3. **No skipped/guarded tests committed in P06**: the diff for
   `scripts/tests/cli-import-boundary.test.js` contains NO new `.skip`,
   `.todo`, or `BOUNDARY_V2` guarded tests. The proof replaces them.
4. **Old symbol-level tests identified for removal**: the old tests pending
   P07 removal are annotated in the test file (this is the only P06
   modification to this file).
5. **Test precision (finding 9)**: the proof asserts exact violation
   classifications and specifier literals, not broad greps.
6. **Internals-subpath behavior correctly characterized (revision 3 finding 6)**:
   the proof asserts the CURRENT behavior (old checker already flags the
   internals subpath as a deep import per current analysis); it does NOT
   assert a false gap.
7. **Fixture suite PASSES**: `npx vitest run --config ./scripts/tests/vitest.config.ts scripts/tests/cli-import-boundary.test.js`
   passes (the test file imports Vitest APIs — `describe`/`expect`/`it` — so
   it must run through the project's Vitest runner, not Node's built-in
   `node --test` runner).
8. **No production checker change**: `scripts/check-cli-import-boundary.mjs`
   is NOT modified in this phase (proof-only).
9. **No deferred language (scoped to phase-owned files — finding 4)**.
10. **No lint loosening / suppression directives**.

## Verification Commands

```bash
# Executable proof exists and PASSES (revision 3 finding 6 — GREEN characterization)
test -f project-plans/issue2285/analysis/boundary-checker-characterization-proof.mjs
node project-plans/issue2285/analysis/boundary-checker-characterization-proof.mjs
test $? -eq 0 || { echo "FAIL: proof did not pass (old behavior not characterized)"; exit 1; }

# No new skipped/guarded tests committed in P06 (fail-closed)
git diff HEAD -- scripts/tests/cli-import-boundary.test.js | grep -E "^\+.*\.(skip|todo)|BOUNDARY_V2" && { echo "FAIL: P06 committed skipped/guarded tests"; exit 1; } || echo "OK: no skipped tests committed"

# Old symbol-level tests still present (pending P07 removal) — fail-closed
OLD_TEST_COUNT="$(grep -c "INTERNAL symbol.*bare agents root\|namespace import.*bare agents root\|AgenticLoop class from the bare root" scripts/tests/cli-import-boundary.test.js || true)"
test "$OLD_TEST_COUNT" -ge 1 || { echo "FAIL: old symbol-level tests not found (expected >= 1 pending P07 removal)"; exit 1; }

# Fixture suite passes (fail-closed).
# This test file imports Vitest APIs (describe/expect/it), so it must run via
# the project's Vitest runner — NOT `node --test` (which fails on Vitest
# imports).
npx vitest run --config ./scripts/tests/vitest.config.ts scripts/tests/cli-import-boundary.test.js
test $? -eq 0 || { echo "FAIL: existing fixture tests do not pass"; exit 1; }

# Production checker NOT modified by this phase — fail-closed
git diff --name-only HEAD -- scripts/check-cli-import-boundary.mjs | grep -q . && { echo "FAIL: production checker modified by P06 (proof-only phase)"; exit 1; } || echo "OK: checker unchanged by P06"

# No deferred language (revision 3 finding 4 — scoped to phase-owned files, fail-closed)
DEFERRED="$(grep -rn -E "(TODO|FIXME|HACK|STUB|TEMPORARY|placeholder|for now)" project-plans/issue2285/analysis/boundary-checker-characterization-proof.mjs scripts/tests/cli-import-boundary.test.js || true)"
test -z "$DEFERRED" || { echo "FAIL: deferred language:"; echo "$DEFERRED"; exit 1; }

# eslint-guard (fail-closed)
npm run lint:eslint-guard
test $? -eq 0 || { echo "FAIL: eslint-guard"; exit 1; }
```

## Semantic Verification Checklist

- [ ] I read the executable proof: it imports/shells out to the CURRENT
      (old) checker, runs it against Node-generated fixture inputs (finding 18)
      encoding the new specifier-based rules, and asserts the old behavior with
      explicit assertions (not skipped tests). It PASSES today (GREEN —
      revision 3 finding 6).
- [ ] The proof correctly characterizes the internals-subpath behavior
      (revision 3 finding 6 — asserts current behavior, no false gap).
- [ ] **The P06 modification to `scripts/tests/cli-import-boundary.test.js`
      is annotation-only** (revision 4 finding 11): the diff adds ONLY a
      comment block identifying old tests for P07 removal. No test bodies,
      test removals, new tests, or skipped tests were committed.
- [ ] NO new skipped/guarded tests were committed in P06.
- [ ] The old symbol-level tests are annotated as pending P07 removal (this
      is the only modification to this file).
- [ ] The production checker (`check-cli-import-boundary.mjs`) was NOT
      modified in this phase.
- [ ] No deferred language, no lint loosening.

## Success Criteria
- PASS: executable proof created and GREEN (characterizes old behavior —
  revision 3 finding 6), no skipped tests committed, old tests annotated for
  removal, fixture suite GREEN, production checker unchanged, no deferred
  language (scoped — finding 4).

## Phase Completion Marker
Create `project-plans/issue2285/.completed/P06a.md`.


The marker MUST contain structured diff evidence per the Standard Completion
Marker Template in `overview.md` (architect finding 8): files changed
(`git diff --name-only` of phase-owned files), diff stats (`git diff --stat`),
command outputs (exit status + key output), and tracker evidence (gate items
satisfied + verifier evidence).
