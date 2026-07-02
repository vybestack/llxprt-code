# Phase 11: CLI Session Characterization Tests (BEFORE split)

## Phase ID
`PLAN-20260629-ISSUE2285.P11`

## Prerequisites
- Required: Phase 10a completed.
- Verification: `test -f project-plans/issue2285/.completed/P10a.md`.
- **Architect review finding 4 (Verdict C cannot be bypassed):** if the seam
  audit (P10) verdict is C, P10a does NOT create a completion marker (so the
  prerequisite above fails). As a DEFENSE-IN-DEPTH check, P11 ALSO verifies
  directly: if the seam audit verdict is C AND no revised-plan marker exists
  at `project-plans/issue2285/.completed/P10a.revised-plan.md`, P11 fails
  immediately regardless of whether a `P10a.md` marker exists. This prevents
  a coordinator from accidentally creating `P10a.md` and bypassing the stop
  condition.

## Requirements Implemented (Expanded)

### REQ-006.2: CLI Session Ownership Gate (characterization tests first)

**Note (architect finding 2)**: the exact seam audit (P10) is analysis-only —
it confirmed the extractable seams (or identified entanglements for
documentation) WITHOUT extracting any production code. These characterization
tests target the CURRENT `cliSessionDispatch.tsx`
surface, establishing the behavior contract
the P12 split must preserve. The seam audit ensures characterization targets
proven seams, not an unproven monolith. No extraction happens before these
tests.

**Full Text**: Characterization tests must be written and observed against
current `cliSessionDispatch.tsx` behavior BEFORE splitting, in a separate
numbered phase. The tests must include explicit observable assertions for
dispatch branch selection, SIGINT handler installation/disposal, output flush
ordering, process lifecycle/error handling, piped prompt driving,
terminal/mouse cleanup, and non-interactive error output. Because this area
is side-effectful, tests may isolate infrastructure boundaries (process, TTY,
Ink render, filesystem diagnostics), but must NOT mock the session-dispatch
module or assert only that mocks were called (no mock theater). Tests
involving `process.exit` use safe boundary seams or subprocess-style
characterization rather than terminating the test runner.

**Behavior**:
- GIVEN: `packages/cli/src/cliSessionDispatch.tsx` is the current (still
  unsplit) quarantine module exporting the six names `cli.tsx` depends on.
- WHEN: behavior-preserving characterization tests are written and run against
  the CURRENT implementation.
- THEN: the tests pass GREEN against current behavior, establishing the
  behavior contract that the split (P12) must preserve unchanged.

**Why This Matters**: the split (P12) is behavior-preserving ONLY if there is
a captured behavior contract to preserve. These characterization tests ARE
that contract. They must be written and observed GREEN before any split work.

## What "characterization" means here

These tests characterize the CURRENT behavior of `cliSessionDispatch.tsx` —
they pin down what the module actually does today so the P12 refactor can
prove it changes nothing observable. They are NOT aspirational tests of ideal
behavior. If current behavior is surprising, the test pins the surprise; the
refactor must preserve it (fixing surprises is out of scope for this issue).

## Permissible boundary isolation vs forbidden mock theater

**PERMISSIBLE (replace external effects so the REAL dispatch code runs):**
- Replace `process.stdout`/`process.stderr` writes with captured string
  buffers (so output can be asserted without polluting test output).
- Replace `process.exit` with a safe seam: a sentinel-throwing stub or a
  subprocess-style characterization. NEVER let the real `process.exit`
  terminate the test runner.
- Replace Ink `render` with a recording fake that captures the rendered
  element tree without a real TTY.
- Replace filesystem diagnostics (`appendFileSync` / log sinks) with a
  temp-directory sink or in-memory buffer.
- Replace `enableMouseEvents`/`disableMouseEvents`/terminal-sequence writes
  with captured spies that record calls but write nowhere.
- Replace stdin with a controllable readable stream for piped-prompt driving.

**FORBIDDEN (mock theater):**
- Mocking the `cliSessionDispatch` module itself (e.g. `vi.mock(
  './cliSessionDispatch.js')`) and asserting only that the mock was called.
- Asserting a replacement was called WITHOUT also checking the resulting
  output, cleanup state, handler effect, selected execution branch, or flushed
  payload that the real code produced.

The distinguishing rule: a replacement is a SEAM that lets real code run; an
assertion must verify the real code's OBSERVABLE EFFECT (what it wrote, which
branch it took, what it flushed, what handler it installed), not merely that
the seam was invoked.

## Implementation Tasks

### Files to Create

Characterization tests live alongside the module under test. Create:

- `packages/cli/src/__tests__/cliSessionDispatch.characterization.test.tsx`
  (or `.test.ts` if no JSX is needed; use `.tsx` if the recording fake
  inspects the React tree). MUST include:
  ```typescript
  /**
   * @plan PLAN-20260629-ISSUE2285.P11
   * @requirement REQ-006
   * @pseudocode cli-session-split.md (characterization contract)
   */
  ```

  Required characterization suites (each asserts an OBSERVABLE EFFECT of the
  REAL dispatch code, running through safe seams):

  1. **Dispatch branch selection** — given interactive vs non-interactive
     options (e.g. `hasPipedInput` true/false, prompt present/absent), the
     real `dispatchInteractiveOrNonInteractive` selects the correct branch.
     Assert the observable consequence of each branch (e.g. which runner
     executed, what was written, which UI path was taken) — NOT just that a
     seam was called.
  2. **SIGINT handler installation/disposal** —
     `installNonInteractiveSigintHandler` installs a handler on `process` and
     returns a disposer; calling the disposer removes it. Assert the handler
     effect (e.g. that a SIGINT during non-interactive mode triggers the
     documented cleanup/exit behavior through the safe `process.exit` seam),
     and that disposal restores prior state.
  3. **Output flush ordering** — `initializeOutputListenersAndFlush` flushes
     buffered output in the documented order. Assert the captured stdout/stderr
     buffer contents and ordering after flush, not just that flush ran.
  4. **Process lifecycle / unhandled rejection handling** —
     `setupUnhandledRejectionHandler` installs a handler for
     `unhandledRejection`; assert that an emitted unhandled rejection is
     handled with the observable effect (e.g. error written to the captured
     stderr buffer, exit via the safe seam). Restore the prior handler after.
  5. **Piped prompt driving** — with stdin replaced by a controllable stream,
     the piped/prompt session reads the piped input and drives the session.
     Assert the input was consumed and produced the expected dispatch/output.
  6. **Terminal/mouse cleanup** — `startInteractiveUI` (or the relevant path)
     registers mouse/terminal cleanup; assert that on exit the
     disable/cleanup calls occurred AND the terminal state was restored (via
     the captured spies), and that the cleanup is registered in the correct
     order relative to other cleanup.
  7. **Non-interactive error output** — `formatNonInteractiveError` formats
     errors for non-interactive output; assert the formatted string shape for
     representative error inputs (plain Error, structured error, unknown). For
     the reporting path, assert the error is written to the captured stderr
     buffer in the expected format.

### Safe seams helper (if shared across suites)

- `packages/cli/src/__tests__/cliSessionDispatch.testSeams.ts` — shared
  helpers for the safe seams (captured stdout/stderr buffer, safe
  `process.exit` sentinel, recording Ink render fake, temp FS sink,
  mouse/terminal captured spies, controllable stdin). These are test
  infrastructure; they are NOT mocks of the module under test.

### Files NOT to Modify
- `packages/cli/src/cliSessionDispatch.tsx` — this phase CHARACTERIZES current
  behavior; it does NOT change the module. The split is P12.
- `packages/cli/src/cli.tsx` — untouched in this phase.

### Required Code Markers (test files only)

```typescript
/**
 * @plan PLAN-20260629-ISSUE2285.P11
 * @requirement REQ-006
 */
```

## Reachability

The characterization tests import the REAL `cliSessionDispatch` exports and
exercise them through safe seams. They run via `npm run test` (the CLI package
test suite). This is not an isolated feature — it pins the behavior of the
production session-dispatch path.

## Verification Commands

```bash
# Architect review finding 4: defense-in-depth Verdict C check. If the seam
# audit verdict is C and no revised-plan marker exists, P11 fails regardless
# of whether P10a.md exists (prevents bypassing the stop condition).
# Architect review finding 10: if the revised-plan marker DOES exist, it MUST
# reference P11 (the downstream phase being re-planned). The marker is NOT a
# bypass — it is a re-planning artifact that documents how P11 was re-reviewed.
SEAM_AUDIT="project-plans/issue2285/analysis/cli-session-seam-audit.md"
REVISED_PLAN_MARKER="project-plans/issue2285/.completed/P10a.revised-plan.md"
if [ -f "$SEAM_AUDIT" ] && grep -iq "Verdict C" "$SEAM_AUDIT" 2>/dev/null; then
  if [ ! -f "$REVISED_PLAN_MARKER" ]; then
    echo "FAIL: seam audit verdict is C and no revised-plan marker — P11 blocked"
    exit 1
  fi
  # Finding 10: the revised-plan marker MUST reference P11 (and P12/P13)
  grep -qi 'P11\|P12\|P13' "$REVISED_PLAN_MARKER" || { echo "FAIL: revised-plan marker exists but does not reference P11/P12/P13 downstream changes (architect review finding 10)"; exit 1; }
  echo "OK: revised-plan marker references downstream phases (finding 10)"
fi

# Characterization test file exists — fail-closed
test -f packages/cli/src/__tests__/cliSessionDispatch.characterization.test.tsx \
  || test -f packages/cli/src/__tests__/cliSessionDispatch.characterization.test.ts \
  || { echo "FAIL: no characterization test file found"; exit 1; }

# Tests pass GREEN against current (unsplit) behavior — fail-closed
npm run test --workspace @vybestack/llxprt-code -- cliSessionDispatch.characterization 2>/dev/null \
  || npm run test -- packages/cli/src/__tests__/cliSessionDispatch.characterization
test $? -eq 0 || { echo "FAIL: characterization tests did not pass"; exit 1; }

# No mock theater: the module under test is NOT mocked — fail-closed
MODULE_MOCKED="$(grep -rn "vi.mock.*cliSessionDispatch" packages/cli/src/__tests__/ || true)"
test -z "$MODULE_MOCKED" || { echo "FAIL: cliSessionDispatch module is mocked:"; echo "$MODULE_MOCKED"; exit 1; }
# Also check no assert-only-toHaveBeenCalled without an observable-effect assertion
# (manual review — see Semantic Verification)

# All seven characterization suites present — fail-closed
# Architect review finding 9: do NOT use a keyword-count grep that can pass
# on prose/comments. Require CONCRETE test definitions (it/test blocks whose
# NAMES contain the suite topic), not keyword hits in comment bodies.
CHAR_TEST=""
for f in packages/cli/src/__tests__/cliSessionDispatch.characterization.test.tsx packages/cli/src/__tests__/cliSessionDispatch.characterization.test.ts; do
  [ -f "$f" ] && CHAR_TEST="$f" && break
done
test -n "$CHAR_TEST" || { echo "FAIL: characterization test file not found"; exit 1; }
# Count DISTINCT test blocks (it/test with matching names) — not keyword hits.
DISPATCH_TEST="$(grep -cE "(it|test)\(['\"].*[Dd]ispatch" "$CHAR_TEST" || true)"
SIGINT_TEST="$(grep -cE "(it|test)\(['\"].*[Ss][Ii][Gg][Ii][Nn][Tt]|signal" "$CHAR_TEST" || true)"
FLUSH_TEST="$(grep -cE "(it|test)\(['\"].*flush|[Oo]utput" "$CHAR_TEST" || true)"
REJECTION_TEST="$(grep -cE "(it|test)\(['\"].*unhandled|rejection|[Ll]ifecycle" "$CHAR_TEST" || true)"
PIPED_TEST="$(grep -cE "(it|test)\(['\"].*piped|prompt|[Nn]on.?[Ii]nteractive" "$CHAR_TEST" || true)"
MOUSE_TEST="$(grep -cE "(it|test)\(['\"].*mouse|terminal|cleanup" "$CHAR_TEST" || true)"
ERROR_TEST="$(grep -cE "(it|test)\(['\"].*error|formatNonInteractive" "$CHAR_TEST" || true)"
test "$DISPATCH_TEST" -ge 1 || { echo "FAIL: no dispatch-branch test block (it/test named dispatch)"; exit 1; }
test "$SIGINT_TEST" -ge 1 || { echo "FAIL: no SIGINT/signal test block"; exit 1; }
test "$FLUSH_TEST" -ge 1 || { echo "FAIL: no output-flush test block"; exit 1; }
test "$REJECTION_TEST" -ge 1 || { echo "FAIL: no unhandled-rejection/lifecycle test block"; exit 1; }
test "$PIPED_TEST" -ge 1 || { echo "FAIL: no piped-prompt/non-interactive test block"; exit 1; }
test "$MOUSE_TEST" -ge 1 || { echo "FAIL: no mouse/terminal-cleanup test block"; exit 1; }
test "$ERROR_TEST" -ge 1 || { echo "FAIL: no non-interactive-error test block"; exit 1; }
echo "OK: all seven characterization suites have concrete test blocks"

# typecheck (test files compile) — fail-closed
npm run typecheck
test $? -eq 0 || { echo "FAIL: typecheck"; exit 1; }

# eslint-guard (fail-closed)
npm run lint:eslint-guard
test $? -eq 0 || { echo "FAIL: eslint-guard"; exit 1; }

# Save P11 baseline hash of characterization assertion bodies (architect
# finding 3: P12a must compare against THIS baseline, NOT git diff HEAD which
# would include the entire P11-added file). The baseline captures the
# assertion-relevant lines (expect/toBe/toEqual/toContain/toThrow etc.) so
# P12a can prove the split changed ONLY import specifiers, not assertion
# bodies. Store under the plan's .completed directory (plan artifact).
COMPLETED_DIR="project-plans/issue2285/.completed"
mkdir -p "$COMPLETED_DIR"
CHAR_TEST=""
for f in packages/cli/src/__tests__/cliSessionDispatch.characterization.test.tsx packages/cli/src/__tests__/cliSessionDispatch.characterization.test.ts; do
  [ -f "$f" ] && CHAR_TEST="$f" && break
done
test -n "$CHAR_TEST" || { echo "FAIL: characterization test file not found for baseline"; exit 1; }
# Extract assertion-body lines (expect calls and matchers) and hash them.
grep -nE 'expect\(|\.toBe\(|\.toEqual\(|\.toContain\(|\.toThrow\(|\.toMatch\(|\.toHaveLength\(|\.toBeGreaterThan\(|\.toBeLessThan\(|\.toBeTruthy\(|\.toBeFalsy\(|\.toBeNull\(|\.toBeUndefined\(|\.toBeDefined\(|\.toHaveBeenCalled\(|\.toHaveBeenCalledWith' "$CHAR_TEST" \
  | shasum -a 256 | awk '{print $1}' > "$COMPLETED_DIR/P11-assertion-baseline.sha256"
test -s "$COMPLETED_DIR/P11-assertion-baseline.sha256" || { echo "FAIL: P11 assertion baseline not saved"; exit 1; }
# Also save the full list of assertion lines for P12a to compare against.
grep -nE 'expect\(|\.toBe\(|\.toEqual\(|\.toContain\(|\.toThrow\(|\.toMatch\(|\.toHaveLength\(|\.toBeGreaterThan\(|\.toBeLessThan\(|\.toBeTruthy\(|\.toBeFalsy\(|\.toBeNull\(|\.toBeUndefined\(|\.toBeDefined\(|\.toHaveBeenCalled\(|\.toHaveBeenCalledWith' "$CHAR_TEST" \
  > "$COMPLETED_DIR/P11-assertion-baseline.txt"
echo "OK: P11 assertion baseline saved (hash + line list)"
```

## Deferred Implementation Detection

```bash
# Fail-closed
DEFERRED="$(grep -rn -E "(TODO|FIXME|HACK|STUB|TEMPORARY|placeholder|for now)" packages/cli/src/__tests__/cliSessionDispatch.characterization.test.tsx packages/cli/src/__tests__/cliSessionDispatch.characterization.test.ts packages/cli/src/__tests__/cliSessionDispatch.testSeams.ts 2>/dev/null || true)"
test -z "$DEFERRED" || { echo "FAIL: deferred language:"; echo "$DEFERRED"; exit 1; }
```

## Semantic Verification

- [ ] Each of the seven suites asserts an OBSERVABLE EFFECT of the real
      dispatch code (output written, branch taken, handler effect, flushed
      payload, cleanup state), not merely that a seam was called.
- [ ] The `cliSessionDispatch` module is NOT mocked; the real exports run.
- [ ] `process.exit` is never allowed to terminate the test runner (safe seam
      or subprocess characterization).
- [ ] Tests are GREEN against the current unsplit implementation.
- [ ] No lint/complexity loosening or suppression directives.

## Constraints (restate for the worker)

- NO `eslint-disable`, `ts-ignore`, `ts-expect-error`, `ts-nocheck`, lint
  severity downgrade, complexity threshold increase, or ignore expansion.
- Do NOT mock the `cliSessionDispatch` module. Do NOT write tests that only
  assert a replacement was called without verifying the real code's effect.
- Do NOT modify `cliSessionDispatch.tsx` or `cli.tsx` in this phase.

## Success Criteria
- Characterization test file created with all seven suites (dispatch branch,
  SIGINT install/dispose, output flush ordering, process lifecycle/unhandled
  rejection, piped prompt driving, terminal/mouse cleanup, non-interactive
  error output).
- Safe seams used (no real `process.exit`, no real TTY, captured buffers);
  module under test NOT mocked.
- Tests GREEN against current behavior.
- **Revision 3 finding 16 (retargeting-stability contract)**: these
  characterization tests are written so that P12's split can retarget them by
  changing ONLY import specifiers (from `cliSessionDispatch` to the new
  `session/*` modules), with assertion bodies remaining byte-identical. The
  tests assert OBSERVABLE EFFECTS (output, handler effects, branch selection,
  flush payloads) — not module-internal structure — so they survive the split.
  P12a verifies this contract via git diff (assertion bodies unchanged except
  import specifiers).
- typecheck passes; eslint-guard passes.
- No deferred language, no lint loosening, no suppression directives.

## Failure Recovery

This phase does NOT use `git checkout` rollback for failure recovery (architect
finding 10 — rollback can discard unrelated/user changes). Instead:
- If a characterization suite fails against current behavior: the assertion
  does not match actual behavior — fix the assertion to pin the REAL current
  behavior (characterization pins what IS, not what should be).
- If a suite is mock theater (asserts only a seam was called): rewrite it to
  assert an observable effect of the real dispatch code.
- If `process.exit` terminates the test runner: replace the exit call with a
  safe seam (sentinel throw or subprocess characterization).
- Report any blocking issue. If removal of test files is truly needed, remove
  ONLY the characterization test file and testSeams helper (phase-owned new
  files), after confirming they contain no unrelated changes.

## Phase Completion Marker
Create `project-plans/issue2285/.completed/P11.md`. Also ensure


The marker MUST contain structured diff evidence per the Standard Completion
Marker Template in `overview.md` (architect finding 8): files changed
(`git diff --name-only` of phase-owned files), diff stats (`git diff --stat`),
command outputs (exit status + key output), and tracker evidence (gate items
satisfied + verifier evidence).
`project-plans/issue2285/.completed/P11-assertion-baseline.sha256` and
`P11-assertion-baseline.txt` exist (architect finding 3: P12a compares against
this baseline, NOT `git diff HEAD`).
