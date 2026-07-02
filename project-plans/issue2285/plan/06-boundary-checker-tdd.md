# Phase 06: Boundary Checker Replacement — Current-Behavior Characterization Proof

## Phase ID
`PLAN-20260629-ISSUE2285.P06`

## Prerequisites
- Required: Phase 05a completed.
- Verification: `test -f project-plans/issue2285/.completed/P05a.md`.

## Purpose

Architect finding 3: the prior revision's boundary-checker replacement phase
combined test and production changes into a single phase, weakening test-first
sequencing. This phase writes the executable characterization proof for the
boundary checker BEFORE any production change to
`scripts/check-cli-import-boundary.mjs`.

**Revision 5 architect finding 7 (characterization naming):** this phase was
previously titled "Boundary Checker Replacement TDD — Failing Tests (RED)"
which is misleading. The committed artifact is a PASSING current-behavior
characterization proof, not a failing test. Workers seeing "RED" or "TDD"
naming could mistakenly create or expect committed failing tests. The phase is
renamed to "Current-Behavior Characterization Proof" and all RED/TDD language
is replaced with "characterization" language to accurately describe what is
committed: a proof that PASSES today by characterizing the old behavior, and
documents which behavior must disappear in P07.

**Revision 6 architect finding 10 (characterization is RED-equivalent, not
true TDD):** the characterization proof is the RED-equivalent artifact in the
test-first sequence. It does NOT leave CI red (the no-red-CI rule is
inviolable). Instead, it establishes the behavior gap by ASSERTING the old
behavior exists (GREEN today), and P07 converts the same assertions to assert
the new behavior (GREEN after P07). The proof is the executable contract
between P06 and P07: P06 commits it characterizing the old checker; P07
updates its assertions to characterize the new checker. The filename retains
the `tdd` suffix for phase-sequence stability (P00→P13a), but the semantics
are characterization, not committed-failing-test TDD. No unskipped failing
fixture is needed outside CI — the characterization proof's GREEN-today
assertions of the old behavior gap ARE the test-first evidence that P07
converts to GREEN-new-behavior assertions.

**Architect finding (revision 2): the prior revision committed the new tests
in a SKIPPED/`.skip` state. That does NOT prove the tests would fail against
the old checker (the characterization intent), and a skipped test proves
nothing at commit time. This
revision replaces the skipped-tests approach with an EXECUTABLE ISOLATED
CHARACTERIZATION PROOF: a standalone, self-contained Node script (under the
plan analysis dir)
that imports the CURRENT (old) checker, runs it against fixture inputs
encoding the new specifier-based rules, and asserts the OLD checker's current
behavior. The proof PASSES today by characterizing the old behavior (it
asserts the gap exists); it is not a failing assertion that would leave CI
red.**

**Revision 3 (architect finding 6 — characterization/verification
consistency): the prior revision was internally inconsistent: it said the
proof "FAILS today" while the verification required the proof to "pass today."
A committed proof that fails today would leave CI red, violating the
no-red-CI rule. The corrected contract: the proof PASSES today by ASSERTING
the old behavior gap EXISTS (e.g. it asserts the old checker STILL flags
bare-root internal-symbol imports because `PUBLIC_AGENT_SYMBOLS` is present —
that assertion is TRUE today, so the proof is GREEN). The characterization
intent is captured by the proof DOCUMENTING which old behavior must disappear
in P07; the proof itself is GREEN at commit. This is internally consistent:
the proof passes today (characterization), and P07 updates its assertions
after the old behavior is removed.**

**Revision 3 (architect finding 6 — internals-subpath gap): the prior revision
treated the internals-subpath gap as "possible." Current analysis
(`analysis/import-inventory.md` section 1 and the boundary checker's
`PUBLIC_SUBPATHS_BY_PACKAGE`) shows the internals subpath
(`@vybestack/llxprt-code-agents/internals.js`) is NOT in the agents package's
declared public subpaths for the boundary checker, so it is ALREADY caught as
a deep import today. The proof must NOT assert an internals-subpath gap that
does not exist. Instead, the proof DOCUMENTS the current behavior: the old
checker already forbids the internals subpath in production CLI (as a deep
import). The gap the proof captures is the SYMBOL-LEVEL behavior
(`PUBLIC_AGENT_SYMBOLS` flagging bare-root internal imports), which is what P07
removes.**

This phase is TEST/PROOF-ONLY. It does NOT modify
`scripts/check-cli-import-boundary.mjs`. No phase leaves CI red: the proof is
committed GREEN (characterizing current behavior), and the new specifier-based
fixture tests are added in P07 alongside the production change.

## Requirements Implemented (Expanded)

### REQ-003.4: Boundary Checker Replacement (test-first fixture preparation)

**Full Text**: The existing `CLI_BOUNDARY_ROOT` fixture tests must be updated
to the new specifier-based rules. This phase prepares the test changes; P07
implements the production change that makes them pass.

**Behavior**:
- GIVEN: the agents root is depolluted (P05) and consumers migrated (P04).
  The boundary checker still carries `PUBLIC_AGENT_SYMBOLS`, a hand-maintained
  root-symbol allowlist.
- WHEN: an EXECUTABLE ISOLATED PROOF is written as a standalone Node script
  that imports the CURRENT (old) checker, runs it against fixture inputs
  encoding the new specifier-based rules, and asserts the OLD checker's current
  behavior. Old symbol-level tests are identified for removal/conversion in
  P07.
- THEN: the proof is committed GREEN — it PASSES today by asserting the old
  behavior gap EXISTS (the old checker still flags bare-root internal-symbol
  imports because `PUBLIC_AGENT_SYMBOLS` is present; and it already flags the
  internals subpath as a deep import). The proof documents which old behavior
  must disappear in P07. The new specifier-based fixture tests are added in
  P07 (un-skipped from the start) alongside the production change. The test
  intent is clear, executable, and reviewable before implementation. (Revision
  3 finding 6: the proof is GREEN at commit, not RED.)

**Why This Matters**: test-first sequencing means an executable proof
establishes the expected behavior gap BEFORE the production change. The
verifier can RUN the proof and confirm the old checker does not satisfy the
new contract (establishing characterization intent) before P07 turns it
GREEN. A skipped test proves nothing; an executable proof proves the gap is
real.

## Implementation Tasks

### Files to Modify
- `scripts/tests/cli-import-boundary.test.js` — **revision 4 architect finding
  11**: this phase annotates (in a comment block within the test file) the old
  symbol-level tests that must be removed/converted in P07. This is an explicit
  modification to a real test file and is listed here for transparency. The
  annotation identifies the specific test names for P07 removal but does NOT
  remove or skip them in P06. See the file description below for the exact
  annotation scope.

### Files to Create

#### `project-plans/issue2285/analysis/boundary-checker-characterization-proof.mjs`

This is the EXECUTABLE ISOLATED CHARACTERIZATION PROOF. It is a standalone, self-contained
Node script (a plan artifact, NOT a production script) that:

1. Imports the CURRENT (old) checker module
   (`scripts/check-cli-import-boundary.mjs`) via a dynamic import of its
   exported analysis function, OR shells out to
   `node scripts/check-cli-import-boundary.mjs` against a temp fixture
   directory containing fixture files encoding the new specifier-based rules.
2. Runs the old checker against these fixture inputs (fixture files generated
   by Node — revision 3 finding 18 — not by sed/printf):
   - Fixture A: `import { createAgent } from '@vybestack/llxprt-code-agents'`
     (bare root) — the new contract says this MUST be allowed.
   - Fixture B: `import { AgentClient } from '@vybestack/llxprt-code-agents/internals.js'`
     (internals subpath) — the new contract says this MUST be flagged as a
     deep-import violation.
   - Fixture C: `import { AgentClient } from '@vybestack/llxprt-code-agents/core/client.js'`
     (deep source path) — the new contract says this MUST be flagged.
3. Asserts the CURRENT behavior with explicit assertions (revision 3 finding 6
   — the proof PASSES today by characterizing what the old checker DOES):
   - **Symbol-level gap (the real gap)**: the old checker, when run against a
     fixture importing an INTERNAL symbol (e.g. `AgentClient`) from the BARE
     root, STILL flags it (because `PUBLIC_AGENT_SYMBOLS` is present). The
     proof ASSERTS this old behavior exists — this assertion is TRUE today, so
     the proof is GREEN. P07 removes `PUBLIC_AGENT_SYMBOLS`, after which bare
     root imports are allowed at the specifier level and this proof's assertion
     is UPDATED in P07 to reflect the new behavior.
   - **Internals-subpath (revision 3 finding 6 — already caught, no false gap)**:
     the proof ASSERTS the old checker ALREADY flags the internals subpath as a
     deep-import violation (per current analysis — it is not in the agents
     declared public subpaths). This assertion is TRUE today. The proof does
     NOT assert a gap that does not exist. (If the proof run discovers the old
     checker does NOT flag the internals subpath, that is a real finding —
     record it and adjust; but do not assume a gap the analysis says is absent.)
4. The proof runs in a temp directory (mktemp via Node) — it never edits
   production source. The fixture files live under the temp dir and are
   generated by a Node script (revision 3 finding 18).
5. The proof exits 0 if the OLD behavior is characterized correctly (i.e. it
   is a passing characterization that documents the gap with real assertions).
   It exits nonzero if the old checker behaves differently than documented
   (the gap does not exist as expected — investigate). **It does NOT leave CI
   red (revision 3 finding 6).**

The proof file is an executable `.mjs` script and is therefore **marker-free**
(revision 5 architect findings 1, 5). Attribution for this proof lives in this
adjacent plan artifact (`06-boundary-checker-tdd.md`). The proof file includes
a plain descriptive header comment (NO `@plan`/`@requirement` markers):
```javascript
/**
 * Boundary checker current-behavior characterization proof.
 *
 * Characterizes the CURRENT (old) boundary checker behavior with explicit
 * assertions documenting the gap the new specifier-based rules will close in
 * P07. It is NOT a skipped test — it runs and passes today by asserting the
 * old behavior exists.
 *
 * Plan: PLAN-20260629-ISSUE2285.P06 (see 06-boundary-checker-tdd.md)
 */
```

#### `scripts/tests/cli-import-boundary.test.js`

This phase IDENTIFIES the old symbol-level tests for removal/conversion in
P07 (annotation only — no test changes committed in P06). The new
specifier-based fixture tests are added in P07 (un-skipped from the start)
alongside the production change.

IDENTIFY (annotate in a comment block within the test file — markers allowed
here since this is a test file) these old symbol-level tests that must be
removed/converted in P07:
- "flags importing an INTERNAL symbol (AgentClient) from the bare agents root"
- "flags importing an INTERNAL type-only symbol (CoreToolScheduler) from the
  bare root"
- "flags a namespace import (import * as ns) from the bare agents root"
- "flags a default import from the bare agents root (no default export)"
- "flags importing the concrete AgenticLoop class from the bare root"
- "flags importing an internal symbol via an alias (X as Y) from the bare root"
- "flags internal agents symbols with NO per-file escape hatch"
- "flags internal agents symbols from ANY file — no file is exempt"

Do NOT remove them yet and do NOT add the new tests as skipped: removing old
tests or adding skipped new tests now would weaken the proof. The executable
characterization proof (`boundary-checker-characterization-proof.mjs`) establishes the gap; P07 adds the
new un-skipped tests AND removes the old tests together with the production
change.

### Boundary checker test precision (architect finding 9)

The new fixture tests must target **actual declarations, usages, and violation
literals** — NOT broad greps that match harmless comments, fixture file names,
or unrelated strings. Specifically:
- The new fixture tests assert the exact **violation classification** and the
  **offending specifier literal** appear in stdout (e.g. the literal
  `@vybestack/llxprt-code-agents/internals.js`), not a broad keyword grep
  that could match a comment.
- Do NOT use greps like `grep -rn "agents"` that would match harmless test
  fixtures or comments. Each assertion must be scoped to the specific
  identifier, specifier literal, or classification string being verified.

### Files NOT to Modify
- `scripts/check-cli-import-boundary.mjs` — this phase is TEST-ONLY. The
  production change is P07.
- Any production CLI source.

### Required Code Markers (test files and plan artifacts ONLY — NOT executable scripts)

```javascript
/**
 * @plan PLAN-20260629-ISSUE2285.P06
 * @requirement REQ-003
 * @pseudocode boundary-checker-replacement.md
 */
```

These markers belong ONLY in the boundary checker test file
(`scripts/tests/cli-import-boundary.test.js`) — a real `.test.js`/`.test.ts`
file. Do NOT add marker comment blocks to:
- the executable characterization proof
  (`boundary-checker-characterization-proof.mjs`) — revision 5 architect
  findings 1, 5: executable `.mjs` scripts are marker-free; attribution lives
  in this adjacent `.md` plan artifact
- the boundary checker script (`scripts/check-cli-import-boundary.mjs`) — that
  is a production script, and markers are restricted to test files and plan
  artifacts per the comment-discipline policy (architect finding 5)

Markers are restricted to test files (`.test.ts`, `.spec.ts`) and plan
artifacts (`.md`) only.

## Reachability

The executable characterization proof (`boundary-checker-characterization-proof.mjs`) runs via `node`
directly. `scripts/tests/cli-import-boundary.test.js` imports Vitest APIs
(`describe`, `expect`, `it`) and must run through the project's existing
Vitest runner (`npx vitest run --config ./scripts/tests/vitest.config.ts`),
NOT Node's built-in test runner (`node --test` fails because the file imports
Vitest). It also runs via `npm run test`. The boundary checker is the
production CLI boundary enforcement mechanism. This is not an isolated
feature.

## Verification Commands

```bash
# Executable characterization proof exists and is runnable
test -f project-plans/issue2285/analysis/boundary-checker-characterization-proof.mjs
node project-plans/issue2285/analysis/boundary-checker-characterization-proof.mjs
test $? -eq 0 || { echo "FAIL: characterization proof did not characterize the old behavior"; exit 1; }

# Old symbol-level tests still present (removed in P07 with the production change) — fail-closed
OLD_TEST_COUNT="$(grep -c "INTERNAL symbol.*bare agents root\|namespace import.*bare agents root\|AgenticLoop class from the bare root" scripts/tests/cli-import-boundary.test.js || true)"
test "$OLD_TEST_COUNT" -ge 1 || { echo "FAIL: old symbol-level tests not found (expected >= 1 pending P07 removal)"; exit 1; }

# Fixture tests still PASS overall (no new skipped tests committed in P06).
# This test file imports Vitest APIs (describe/expect/it), so it must run via
# the project's Vitest runner — NOT `node --test` (which fails on Vitest
# imports).
npx vitest run --config ./scripts/tests/vitest.config.ts scripts/tests/cli-import-boundary.test.js
test $? -eq 0 || { echo "FAIL: existing fixture tests do not pass"; exit 1; }

# No new skipped/guarded tests committed in P06 (the characterization proof replaces them)
git diff HEAD -- scripts/tests/cli-import-boundary.test.js | grep -E "^\+.*\.(skip|todo)|BOUNDARY_V2" && { echo "FAIL: P06 committed skipped/guarded tests (use the executable characterization proof instead)"; exit 1; } || echo "OK: no skipped tests committed in P06"

# No deferred language (fail-closed)
DEFERRED="$(grep -rn -E "(TODO|FIXME|HACK|STUB|TEMPORARY|placeholder|for now)" project-plans/issue2285/analysis/boundary-checker-characterization-proof.mjs scripts/tests/cli-import-boundary.test.js || true)"
test -z "$DEFERRED" || { echo "FAIL: deferred language:"; echo "$DEFERRED"; exit 1; }
```

## Characterization Proof (executable, committed, GREEN today — revision 3 finding 6)

The executable proof (`boundary-checker-characterization-proof.mjs`) IS the
characterization proof. It runs against the CURRENT (old) checker and PASSES
today by asserting the old behavior EXISTS (characterization of the gap). It
does NOT fail/leave CI red. No temporary un-skip/re-skip is needed — the proof
is committed and runs in CI today, GREEN.

```bash
# The proof runs and PASSES today (characterizes the old behavior gap — GREEN).
node project-plans/issue2285/analysis/boundary-checker-characterization-proof.mjs
test $? -eq 0 || { echo "FAIL: proof did not pass (old behavior not characterized as expected)"; exit 1; }
```

Record the proof's output in the completion marker. The proof documents:
- The old checker STILL flags bare-root internal-symbol imports (because
  `PUBLIC_AGENT_SYMBOLS` is present) — this assertion is TRUE today (GREEN).
- The old checker ALREADY flags the internals subpath as a deep-import
  violation (per current analysis — revision 3 finding 6; no false gap).

**Lifecycle note (revision 3 — architect finding 7):** after P07 removes the
old behavior, this proof's assertions are STALE (the old checker no longer
flags bare-root internal-symbol imports). P07 MUST reclassify this proof: it
either (a) CONVERTS the proof to assert the NEW behavior (bare root allowed at
specifier level) — keeping it as a live regression guard, or (b) DELETES it if
the new fixture tests in `scripts/tests/cli-import-boundary.test.js` fully
cover the same cases. The choice is recorded in P07. The proof must NOT be
left asserting old behavior that no longer exists (that would make it fail or
mislead). See P07 for the concrete reclassification step.

## Deferred Implementation Detection (revision 3 — finding 4: scoped to phase-owned files)

```bash
# Fail-closed — scoped ONLY to files this phase creates (avoids unrelated hits)
DEFERRED="$(grep -rn -E "(TODO|FIXME|HACK|STUB|TEMPORARY|placeholder|for now)" project-plans/issue2285/analysis/boundary-checker-characterization-proof.mjs scripts/tests/cli-import-boundary.test.js || true)"
test -z "$DEFERRED" || { echo "FAIL: deferred language:"; echo "$DEFERRED"; exit 1; }
```

## Success Criteria
- Executable proof (`boundary-checker-characterization-proof.mjs`) created and GREEN — it
  characterizes the CURRENT (old) boundary checker behavior with explicit
  assertions documenting the gap the new specifier-based rules will close in
  P07. It PASSES today (revision 3 finding 6 — characterization, not a
  committed failing test). No skipped/guarded tests committed.
- Old symbol-level tests identified for P07 removal (annotated in the test
  file).
- The proof targets actual violation literals/specifiers, not broad greps
  (finding 9). Fixture files generated by Node (finding 18).
- Fixture test suite PASSES overall (no new skipped tests committed in P06).
- Proof is GREEN at commit (characterization), documenting the old behavior
  that P07 removes (revision 3 finding 6). Its post-P07 lifecycle is specified
  (revision 3 finding 7 — convert/delete in P07).
- No deferred language (scoped — finding 4), no lint loosening.

## Failure Recovery

This phase does NOT use `git checkout` rollback for failure recovery. Instead:
- If the characterization proof fails (the old behavior is not as documented): investigate
  whether the old checker already satisfies part of the new contract and
  update the proof's assertions to match reality.
- If the existing fixture tests fail: do NOT add new tests in P06 — the
  production change is P07. Report the issue.
- Report any blocking issue to the coordinator.

## Phase Completion Marker
Create `project-plans/issue2285/.completed/P06.md`.


The marker MUST contain structured diff evidence per the Standard Completion
Marker Template in `overview.md` (architect finding 8): files changed
(`git diff --name-only` of phase-owned files), diff stats (`git diff --stat`),
command outputs (exit status + key output), and tracker evidence (gate items
satisfied + verifier evidence).
