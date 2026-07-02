# Phase 11a: CLI Session Characterization Tests Verification

## Phase ID
`PLAN-20260629-ISSUE2285.P11a`

## Prerequisites
- Required: Phase 11 completed.
- Verification: `test -f project-plans/issue2285/.completed/P11.md`.

## Verification Tasks

The deepthinker verifier confirms:

1. **Characterization test file exists** and is reached by the CLI test suite.
2. **All seven suites present**: dispatch branch selection, SIGINT handler
   installation/disposal, output flush ordering, process lifecycle/unhandled
   rejection handling, piped prompt driving, terminal/mouse cleanup,
   non-interactive error output.
3. **No mock theater**: the `cliSessionDispatch` module is NOT mocked; the
   real exports execute. Each suite asserts an OBSERVABLE EFFECT (output,
   branch, handler effect, flushed payload, cleanup state), not merely that a
   seam was called.
4. **Safe `process.exit`**: no suite terminates the test runner; `process.exit`
   is replaced by a safe seam or characterized via subprocess.
5. **Tests GREEN against current behavior** (the unsplit module from before
   P12). This is the behavior contract P12 must preserve.
6. **`cliSessionDispatch.tsx` and `cli.tsx` unchanged** in this phase (P11
   only adds tests; the split is P12).
7. **typecheck passes**.
8. **No deferred language**.
9. **No lint loosening / suppression directives**.

## Verification Commands

```bash
# File exists — fail-closed (exactly one must exist)
test -f packages/cli/src/__tests__/cliSessionDispatch.characterization.test.tsx || test -f packages/cli/src/__tests__/cliSessionDispatch.characterization.test.ts || { echo "FAIL: no characterization test file found"; exit 1; }

# Module under test NOT mocked — fail-closed
MODULE_MOCKED="$(grep -rn "vi.mock.*cliSessionDispatch" packages/cli/src/__tests__/ || true)"
test -z "$MODULE_MOCKED" || { echo "FAIL: cliSessionDispatch module is mocked:"; echo "$MODULE_MOCKED"; exit 1; }

# Seven suites present — fail-closed
# Architect review finding 9: do NOT use a keyword-count grep that can pass
# on prose/comments. Require CONCRETE test blocks (it/test) named for each
# topic, matching the P11 check.
CHAR_TEST=""
for f in packages/cli/src/__tests__/cliSessionDispatch.characterization.test.tsx packages/cli/src/__tests__/cliSessionDispatch.characterization.test.ts; do
  [ -f "$f" ] && CHAR_TEST="$f" && break
done
test -n "$CHAR_TEST" || { echo "FAIL: characterization test file not found"; exit 1; }
test "$(grep -cE "(it|test)\(['\"].*[Dd]ispatch" "$CHAR_TEST" || true)" -ge 1 || { echo "FAIL: no dispatch test block"; exit 1; }
test "$(grep -cE "(it|test)\(['\"].*[Ss][Ii][Gg][Ii][Nn][Tt]|signal" "$CHAR_TEST" || true)" -ge 1 || { echo "FAIL: no SIGINT test block"; exit 1; }
test "$(grep -cE "(it|test)\(['\"].*flush|[Oo]utput" "$CHAR_TEST" || true)" -ge 1 || { echo "FAIL: no flush test block"; exit 1; }
test "$(grep -cE "(it|test)\(['\"].*unhandled|rejection|[Ll]ifecycle" "$CHAR_TEST" || true)" -ge 1 || { echo "FAIL: no lifecycle test block"; exit 1; }
test "$(grep -cE "(it|test)\(['\"].*piped|prompt|[Nn]on.?[Ii]nteractive" "$CHAR_TEST" || true)" -ge 1 || { echo "FAIL: no piped test block"; exit 1; }
test "$(grep -cE "(it|test)\(['\"].*mouse|terminal|cleanup" "$CHAR_TEST" || true)" -ge 1 || { echo "FAIL: no mouse/terminal test block"; exit 1; }
test "$(grep -cE "(it|test)\(['\"].*error|formatNonInteractive" "$CHAR_TEST" || true)" -ge 1 || { echo "FAIL: no error test block"; exit 1; }
echo "OK: all seven characterization suites have concrete test blocks"

# Characterization tests GREEN against current (unsplit) behavior — fail-closed
npm run test --workspace @vybestack/llxprt-code -- cliSessionDispatch.characterization 2>/dev/null \
  || npm run test -- packages/cli/src/__tests__/cliSessionDispatch.characterization
test $? -eq 0 || { echo "FAIL: characterization tests did not pass"; exit 1; }

# cliSessionDispatch.tsx and cli.tsx unchanged by this phase — fail-closed
git diff --name-only HEAD -- packages/cli/src/cliSessionDispatch.tsx packages/cli/src/cli.tsx | grep -q . && { echo "FAIL: production code modified by P11 (test-only phase)"; exit 1; } || echo "OK: P11 adds only test files"

# typecheck (fail-closed)
npm run typecheck
test $? -eq 0 || { echo "FAIL: typecheck"; exit 1; }

# eslint-guard (fail-closed)
npm run lint:eslint-guard
test $? -eq 0 || { echo "FAIL: eslint-guard"; exit 1; }

# P11 assertion baseline saved (architect finding 3: P12a compares against
# THIS baseline, NOT git diff HEAD). Fail-closed if missing.
test -s project-plans/issue2285/.completed/P11-assertion-baseline.sha256 || { echo "FAIL: P11-assertion-baseline.sha256 missing or empty"; exit 1; }
test -s project-plans/issue2285/.completed/P11-assertion-baseline.txt || { echo "FAIL: P11-assertion-baseline.txt missing or empty"; exit 1; }
echo "OK: P11 assertion baseline present"

# No deferred language in the new test files — fail-closed
DEFERRED="$(grep -rn -E "(TODO|FIXME|HACK|STUB|TEMPORARY|placeholder)" packages/cli/src/__tests__/cliSessionDispatch.characterization.* packages/cli/src/__tests__/cliSessionDispatch.testSeams.ts 2>/dev/null || true)"
test -z "$DEFERRED" || { echo "FAIL: deferred language:"; echo "$DEFERRED"; exit 1; }

# No suppression directives — fail-closed
SUPP="$(grep -rn -E "(eslint-disable|ts-ignore|ts-expect-error|ts-nocheck)" packages/cli/src/__tests__/cliSessionDispatch.characterization.* packages/cli/src/__tests__/cliSessionDispatch.testSeams.ts 2>/dev/null || true)"
test -z "$SUPP" || { echo "FAIL: suppression directives:"; echo "$SUPP"; exit 1; }
```

## Mock-theater audit (manual semantic check)

For each of the seven suites, the verifier reads the test and confirms:
- A safe seam (captured buffer / recording fake / safe exit / temp sink) is
  used so the REAL dispatch code runs.
- The assertion checks an OBSERVABLE EFFECT of the real code (what was
  written / which branch ran / what the handler did / what was flushed / what
  cleanup occurred), NOT only `expect(seam).toHaveBeenCalled()`.

If any suite asserts only that a seam was called, that is mock theater →
BLOCKING failure; return to P11 to add the observable-effect assertion.

## Semantic Verification Checklist

- [ ] I read each of the seven suites: each runs real dispatch code through a
      safe seam and asserts an observable effect.
- [ ] The `cliSessionDispatch` module is not mocked anywhere in the test.
- [ ] No suite calls the real `process.exit`.
- [ ] All seven suites are GREEN against the current unsplit module.
- [ ] The test files would still pass after P12 if P12 is truly
      behavior-preserving (this is the contract P12 must not break).

## Non-Deferral Gate 6 (CLI Session Ownership) Evidence — characterization portion

Fill in execution-tracker.md Gate 6 verifier evidence (characterization items)
with:
- characterization test file path.
- confirmation all seven suites present and GREEN.
- confirmation the module is not mocked (no mock theater).
- confirmation `cliSessionDispatch.tsx`/`cli.tsx` unchanged by P11.

(The split-related gate items are verified in P12a.)

## Success Criteria
- PASS: seven characterization suites present, GREEN against current behavior,
  no mock theater, module not mocked, no real process.exit, typecheck +
  eslint-guard green, gate 6 characterization evidence recorded.

## Phase Completion Marker
Create `project-plans/issue2285/.completed/P11a.md`.


The marker MUST contain structured diff evidence per the Standard Completion
Marker Template in `overview.md` (architect finding 8): files changed
(`git diff --name-only` of phase-owned files), diff stats (`git diff --stat`),
command outputs (exit status + key output), and tracker evidence (gate items
satisfied + verifier evidence).
