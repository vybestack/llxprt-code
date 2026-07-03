# Phase 12: CLI Session Module Split/Refactor

## Phase ID
`PLAN-20260629-ISSUE2285.P12`

## Prerequisites
- Required: Phase 11a completed.
- Verification: `test -f project-plans/issue2285/.completed/P11a.md`.
- **Architect review finding 4 (Verdict C cannot be bypassed):** as a
  defense-in-depth check, P12 verifies directly: if the seam audit (P10)
  verdict is C AND no revised-plan marker exists at
  `project-plans/issue2285/.completed/P10a.revised-plan.md`, P12 fails
  immediately. This is in addition to the P10a prerequisite chain.

## Requirements Implemented (Expanded)

### REQ-006.1/.3/.4: CLI Session Ownership Gate (split + export preservation + language purge)

**Full Text**: `cliSessionDispatch.tsx` must stop being a large temporary
quarantine — split along stable responsibility seams. The refactor must
preserve every exported name `cli.tsx` depends on (six names from
`cliSessionDispatch.js`) plus `validateDnsResolutionOrder` from `cliBootstrap`
(which is NOT part of the split and must not move). No temporary/quarantine
language in completed modules, migrated modules, tests, or docs.

**Behavior**:
- GIVEN: the characterization tests (P11) are GREEN against the current
  `cliSessionDispatch.tsx`, pinning its observable behavior.
- WHEN: `cliSessionDispatch.tsx` is split/refactored along stable ownership
  seams (interactive UI, non-interactive dispatch, output listeners, signal
  handlers, error reporting, terminal cleanup), the six `cli.tsx` exports are
  preserved through stable replacement modules (or a thin re-export barrel),
  all temporary/quarantine language is purged, and `validateDnsResolutionOrder`
  stays in `cliBootstrap`.
- THEN: the P11 characterization tests remain GREEN unchanged (behavior
  preserved); `cli.tsx` still resolves all six names; the module structure
  reflects stable ownership, not a quarantine.

**Why This Matters**: the quarantine module is the last piece of deliberate
debt from #2204. A cosmetic comment deletion is insufficient — the module
structure itself must reflect stable ownership boundaries.

## Implementation Tasks

### Split plan (behavior-preserving, leaf-first)

Per `analysis/pseudocode/cli-session-split.md`, extract leaf modules first
(those with no inbound dependencies within the split), then composite modules,
then **delete or rename `cliSessionDispatch.tsx`** so cli.tsx imports the six
names directly from the new stable modules (prefer deletion/renaming and
direct stable imports over retaining a thin old-name barrel, which risks
stale ownership — see Barrel retention policy below). The exact set of new modules follows the
stable responsibility seams confirmed by the P10 seam audit; the candidate
layout is:

- `packages/cli/src/session/outputListeners.ts` —
  `initializeOutputListenersAndFlush` (and any flush helpers).
- `packages/cli/src/session/signalHandlers.ts` —
  `installNonInteractiveSigintHandler`, `setupUnhandledRejectionHandler`.
- `packages/cli/src/session/errorReporting.ts` —
  `formatNonInteractiveError`, `reportNonInteractiveError`.
- `packages/cli/src/session/terminalCleanup.ts` —
  `mouseEventsExitHandler`, terminal/mouse cleanup registration helpers.
- `packages/cli/src/session/interactiveUI.ts` —
  `startInteractiveUI`, `setWindowTitle`, `appendInteractiveUiDebug`,
  `handleError` (the interactive error boundary), the Ink `render` lifecycle.
- `packages/cli/src/session/nonInteractiveSession.ts` —
  `dispatchInteractiveOrNonInteractive`, `runPipedOrPromptSession`,
  `runNonInteractiveSession`, and the `SessionDispatchOptions`-style types.

(The worker confirms the exact seam grouping by reading the current module and
the P10 seam audit; the invariant is that each new module has a single clear
responsibility and the moves are pure code-motion preserving behavior.)

### Barrel retention policy (plan-local design decision)

**Preferred: delete `cliSessionDispatch.tsx`** and update `cli.tsx` to import
the six names directly from the new stable modules. This eliminates stale
ownership risk — there is no old-name barrel to drift or accumulate debt.

A thin re-export barrel is **NOT the default**. It is permitted ONLY with all
of the following:
1. A specific, documented justification proving direct imports are impractical
   (e.g. a proven external consumer that imports from the old path and cannot
   be updated — which must be confirmed by grep, not assumed).
2. The barrel contains ONLY re-exports of the six names — NO logic, NO
   temporary/quarantine language.
3. Stale-reference checks: grep confirms NO remaining import of
   `cliSessionDispatch` anywhere except the barrel itself and cli.tsx; the
   barrel does not re-export anything not in the six-name contract.

If no such justification exists, the module is DELETED and cli.tsx imports
directly from the stable modules.

### Extraction order (numbered)

```
1. Characterization tests (P11) GREEN — the behavior contract.
2. Seam audit (P10) confirms the extraction map (or entanglements documented).
3. EXTRACT outputListeners.ts        (no inbound deps within the split)
4. EXTRACT signalHandlers.ts         (no inbound deps within the split)
5. EXTRACT errorReporting.ts         (no inbound deps within the split)
6. EXTRACT terminalCleanup.ts        (no inbound deps within the split)
7. EXTRACT interactiveUI.ts          (depends on terminalCleanup)
8. EXTRACT nonInteractiveSession.ts  (depends on outputListeners, signalHandlers, errorReporting)
9. PREFERRED: DELETE cliSessionDispatch.tsx and update cli.tsx to import the
      six names directly from the new modules.
   FALLBACK (requires specific justification + stale-reference checks):
      reduce cliSessionDispatch.tsx to a thin re-export barrel (logic-free,
      six names only, no quarantine language).
10. Update cli.tsx imports/exports to point at the new module paths (direct
    imports preferred; barrel only if justified per the policy above). The six
    re-exported names MUST resolve.
11. PURGE all temporary/quarantine/holding-pen language from cli.tsx, the new
    modules, cliSessionDispatch.tsx (ONLY if retained as a justified barrel),
    and tests. **Scope note (architect finding 9): plan/analysis docs are NOT
    scanned — they intentionally use "quarantine" to describe the problem.**
12. Stale-reference check (barrel retention policy): grep confirms no remaining import of
    `cliSessionDispatch` except cli.tsx (if barrel retained) — no orphaned
    references.
13. Run the P11 characterization tests — MUST remain GREEN unchanged.
```

### Files to Create
- The `packages/cli/src/session/*.ts` modules listed above (exact set confirmed
  by reading the current module). These are production source modules — do NOT
  add `@plan`/`@requirement` marker comment blocks to them (architect finding
  5 — markers are restricted to test files and plan artifacts).

### Files to Modify
- `packages/cli/src/cliSessionDispatch.tsx` — **PREFERRED: delete** and update
  cli.tsx to import the six names directly from the new stable modules
  (see Barrel retention policy below). FALLBACK (requires specific justification
  + stale-reference checks): reduce to a thin re-export barrel containing ONLY
  re-exports of the six names, with NO temporary/quarantine language and NO
  logic. The barrel fallback must be justified per the "Barrel retention
  policy" above.
- `packages/cli/src/cli.tsx`:
  - Update the import of the six names to point directly at the new modules
    (preferred), or the thin barrel (only if justified).
  - Keep `export { validateDnsResolutionOrder } from './cliBootstrap.js';`
    UNCHANGED — `validateDnsResolutionOrder` stays in `cliBootstrap`, NOT in
    any session module.
  - Update existing comments in cli.tsx that reference
    `./cliSessionDispatch.tsx` as the home of the helpers, so they no longer
    describe a quarantine. Do NOT add new `@plan`/`@requirement` marker
    comment blocks to cli.tsx (architect finding 5 — markers are restricted
    to test files and plan artifacts).
  - Keep the existing `@plan:PLAN-20260603-ISSUE1584.P12` / other pre-existing
    markers.

### Files NOT to Modify (invariants)
- `packages/cli/src/cliBootstrap.tsx` — `validateDnsResolutionOrder` stays
  here. Do NOT move it into any session module.
- The P11 characterization tests — they MUST remain GREEN UNCHANGED.
  **Revision 3 (architect finding 16 — retargeting constraint):** if a
  characterization test imported `cliSessionDispatch` directly and that module
  is DELETED, the test's IMPORT SPECIFIER may be retargeted to the new module
  path that now owns the behavior. This is the ONLY permitted change: import
  specifiers may change; the observable-effect ASSERTION BODIES (the
  `expect(...)` calls and their arguments) MUST remain byte-identical to what
  P11 committed. The worker MUST verify, before completing P12, that the only
  diff in each retargeted characterization test is the import specifier line
  (via `git diff` on each test file), and that the characterization tests
  still pass against the new module paths. If the split would require changing
  an assertion body, the split is NOT pure code-motion — STOP and revise the
  extraction (a changed assertion body means behavior changed or the split
  boundary is wrong).

### Marker Discipline (architect finding 5 + architect review finding 5)

Markers (`@plan`/`@requirement`) are RESTRICTED to test files and plan
artifacts. Do NOT add NEW `@plan:PLAN-20260629-ISSUE2285` marker comment blocks
to production source files (`cli.tsx`, new `session/` modules,
`cliSessionDispatch.tsx`). Update only existing comments where content changed
semantically (e.g. removing a stale quarantine reference); do NOT add
decorative `@plan` blocks to production modules.

**Pre-existing marker debt (architect review finding 5):** `cli.tsx` and other
production source files may already contain `@plan` markers from prior issues
(e.g. `@plan:PLAN-20260603-ISSUE1584.P12`). These are NOT to be removed unless
the line they annotate changes for issue #2285 scope. The prohibition is on NEW
issue2285 markers only.

## Six cli.tsx exports (MUST resolve after the split)

`packages/cli/src/cli.tsx` imports and re-exports these six names from
`./cliSessionDispatch.js` today:
- `dispatchInteractiveOrNonInteractive`
- `formatNonInteractiveError`
- `initializeOutputListenersAndFlush`
- `installNonInteractiveSigintHandler`
- `setupUnhandledRejectionHandler`
- `startInteractiveUI`

After the split, each MUST still resolve (from the new module or the thin
barrel), and cli.tsx's re-export of them MUST still compile and work. The
seventh re-export, `validateDnsResolutionOrder`, comes from `cliBootstrap.js`
and is NOT part of this split — it MUST NOT move.

## Reachability

The session modules are reached by the CLI entrypoint (`cli.tsx` →
`dispatchInteractiveOrNonInteractive` / `startInteractiveUI` / etc.) and by
`node scripts/start.js ...`. The characterization tests reach them via the
test suite. This is not an isolated feature — it is the production
interactive/non-interactive dispatch path.

## Verification Commands

```bash
# Architect review finding 4: defense-in-depth Verdict C check.
# Architect review finding 10: if the revised-plan marker exists, it MUST
# reference P12 (and P11/P13). The marker is NOT a bypass — it is a
# re-planning artifact documenting how P12 was re-reviewed.
SEAM_AUDIT="project-plans/issue2285/analysis/cli-session-seam-audit.md"
REVISED_PLAN_MARKER="project-plans/issue2285/.completed/P10a.revised-plan.md"
if [ -f "$SEAM_AUDIT" ] && grep -iq "Verdict C" "$SEAM_AUDIT" 2>/dev/null; then
  if [ ! -f "$REVISED_PLAN_MARKER" ]; then
    echo "FAIL: seam audit verdict is C and no revised-plan marker — P12 blocked"
    exit 1
  fi
  grep -qi 'P11\|P12\|P13' "$REVISED_PLAN_MARKER" || { echo "FAIL: revised-plan marker exists but does not reference P11/P12/P13 downstream changes (architect review finding 10)"; exit 1; }
  echo "OK: revised-plan marker references downstream phases (finding 10)"
fi

# Six exports still resolve from cli.tsx's import source — fail-closed
EXPORT_HITS="$(grep -c "dispatchInteractiveOrNonInteractive\|formatNonInteractiveError\|initializeOutputListenersAndFlush\|installNonInteractiveSigintHandler\|setupUnhandledRejectionHandler\|startInteractiveUI" packages/cli/src/cli.tsx || true)"
test "$EXPORT_HITS" -ge 6 || { echo "FAIL: six cli.tsx exports not all present (found $EXPORT_HITS, expected >= 6)"; exit 1; }

# validateDnsResolutionOrder STILL re-exported from cliBootstrap (NOT a session module) — fail-closed
grep -qn "validateDnsResolutionOrder" packages/cli/src/cli.tsx || { echo "FAIL: validateDnsResolutionOrder not in cli.tsx"; exit 1; }
grep -qn "validateDnsResolutionOrder" packages/cli/src/cliBootstrap.tsx || { echo "FAIL: validateDnsResolutionOrder not in cliBootstrap"; exit 1; }
SESSION_DNS="$(grep -rn "validateDnsResolutionOrder" packages/cli/src/session/ || true)"
test -z "$SESSION_DNS" || { echo "FAIL: validateDnsResolutionOrder moved into session/"; exit 1; }

# No temporary/quarantine language in the SPLIT SURFACE (revision 3 finding 5 —
# narrowed to cliSessionDispatch/split surface + issue-owned tests/artifacts;
# case-insensitive quarantine/quarantine-synonym scan, NOT a broad
# "temporary" grep that matches legitimate existing usage elsewhere).
QUARANTINE="$(grep -rn -i 'quarantine\|holding pen\|holding-pen' packages/cli/src/cliSessionDispatch.tsx packages/cli/src/session/ packages/cli/src/cli.tsx 2>/dev/null || true)"
test -z "$QUARANTINE" || { echo "FAIL: quarantine language present:"; echo "$QUARANTINE"; exit 1; }

# Characterization tests STILL GREEN (behavior preserved) — unchanged assertions — fail-closed
# (revision 3 finding 16: retargeting is constrained — only import specifiers may
# change; assertion bodies must remain byte-identical to P11's observed-behavior
# assertions. This is verified in P12a by comparing the assertion bodies.)
npm run test --workspace @vybestack/llxprt-code -- cliSessionDispatch.characterization 2>/dev/null \
  || npm run test -- packages/cli/src/__tests__/cliSessionDispatch.characterization
test $? -eq 0 || { echo "FAIL: characterization tests not GREEN after split"; exit 1; }

# CLI typecheck — fail-closed
npm run typecheck --workspace @vybestack/llxprt-code 2>/dev/null || npm run typecheck
test $? -eq 0 || { echo "FAIL: CLI typecheck"; exit 1; }

# CLI tests broadly — fail-closed
npm run test --workspace @vybestack/llxprt-code 2>/dev/null || npm run test -- packages/cli
test $? -eq 0 || { echo "FAIL: CLI tests"; exit 1; }

# Boundary still passes (new session modules are under packages/cli/src → in scope) — fail-closed
npm run lint:cli-boundary
test $? -eq 0 || { echo "FAIL: lint:cli-boundary"; exit 1; }

# eslint-guard (fail-closed)
npm run lint:eslint-guard
test $? -eq 0 || { echo "FAIL: eslint-guard"; exit 1; }
```

## Deferred Implementation Detection (revision 3 — findings 4, 5: scoped to split surface; architect review finding 6: pre-phase baseline for existing files)

**Architect review finding 6:** `cliSessionDispatch.tsx` and `cli.tsx` may
contain pre-existing deferred language from prior issues. The scan MUST
distinguish NEWLY INTRODUCED debt from pre-existing debt. For existing files
(`cliSessionDispatch.tsx`, `cli.tsx`), use git-diff added-lines. For NEW files
(`session/*.ts`), scan the whole file (everything is newly introduced).

```bash
# Architect review finding 6: for EXISTING files, use git diff added-lines so
# only NEWLY INTRODUCED deferred language FAILS.
EXISTING_P12="packages/cli/src/cliSessionDispatch.tsx packages/cli/src/cli.tsx"
NEW_DEFERRED_EXISTING="$(git diff -- $EXISTING_P12 2>/dev/null | grep '^+' | grep -v '^+++' | grep -iE '(TODO|FIXME|HACK|STUB|TEMPORARY|placeholder|for now)' || true)"
test -z "$NEW_DEFERRED_EXISTING" || { echo "FAIL: newly introduced deferred language in existing files:"; echo "$NEW_DEFERRED_EXISTING"; exit 1; }

# For NEW session modules, scan the whole file (all content is newly introduced).
DEFERRED_NEW="$(grep -rn -E "(TODO|FIXME|HACK|STUB|TEMPORARY|placeholder|for now)" packages/cli/src/session/ 2>/dev/null || true)"
test -z "$DEFERRED_NEW" || { echo "FAIL: deferred language in new session modules:"; echo "$DEFERRED_NEW"; exit 1; }
echo "OK: no newly introduced deferred language (pre-existing baseline tolerated for existing files)"
```

## Semantic Verification

- [ ] The new modules each have a single clear responsibility (not a
      re-quarantine under a new name).
- [ ] The extraction was pure code-motion: behavior preserved, proven by the
      P11 characterization tests staying GREEN without changing their
      observable-effect assertions.
- [ ] All six cli.tsx exports resolve; cli.tsx re-exports still compile.
- [ ] `validateDnsResolutionOrder` is still in `cliBootstrap`, not in any
      session module.
- [ ] No temporary/quarantine/holding-pen language remains in cli.tsx, the
      new modules, the (possibly retained) barrel, or tests. **Scope note
      (architect finding 9): the executable quarantine-language scan covers
      ONLY `packages/cli/src/cliSessionDispatch.tsx`, `packages/cli/src/session/`,
      `packages/cli/src/cli.tsx`, and the characterization test files — NOT
      plan/analysis docs, which intentionally use "quarantine" language to
      describe the problem being fixed. The "plan docs" portion of the
      requirement is satisfied by ensuring the split-surface source + tests
      are clean; plan docs are NOT scanned for quarantine language.**
- [ ] No parallel `cliSessionDispatchV2.tsx` was created (modify/extract the
      existing module, do not fork it).
- [ ] No lint/complexity loosening or suppression directives.

## Constraints (restate for the worker)

- NO `eslint-disable`, `ts-ignore`, `ts-expect-error`, `ts-nocheck`, lint
  severity downgrade, complexity threshold increase, or ignore expansion.
- Do NOT move `validateDnsResolutionOrder` out of `cliBootstrap`.
- Do NOT create a parallel `cliSessionDispatchV2` — modify/extract the
  existing module.
- Do NOT change the P11 characterization tests' observable-effect assertions
  (retarget import paths only if strictly necessary; behavior assertions stay
  identical).
- The new session modules are under `packages/cli/src` and therefore IN SCOPE
  of the CLI boundary scan — they must not introduce disallowed deep imports.

## Success Criteria
- `cliSessionDispatch.tsx` DELETED (preferred) with cli.tsx importing the new
  modules directly, OR reduced to a justified thin re-export barrel (see Barrel
  retention policy).
- P11 characterization tests GREEN unchanged (behavior preserved).
- Six cli.tsx exports resolve; `validateDnsResolutionOrder` stays in
  `cliBootstrap`.
- Stale-reference check passes: no orphaned `cliSessionDispatch` imports
  (see Barrel retention policy).
- All temporary/quarantine/holding-pen language purged from the split surface.
- typecheck, CLI tests, `lint:cli-boundary`, `lint:eslint-guard` pass.
- No deferred language, no lint loosening, no suppression directives.

## Failure Recovery

This phase does NOT use `git checkout` rollback for failure recovery (architect
finding 10 — rollback can discard unrelated/user changes). Instead:
- If the characterization tests fail after the split: the extraction changed
  behavior — inspect `git diff` to find the non-pure-code-motion change and fix
  it. The split MUST be pure code-motion.
- If cli.tsx exports do not resolve: the import paths are wrong — fix the
  specific import in cli.tsx to point at the correct new module.
- If `lint:cli-boundary` fails: a new session module introduced a disallowed
  deep import — fix the import in the new module.
- If the barrel retention caused stale-reference issues: prefer
  deletion + direct imports instead.
- Report any blocking issue. If a targeted revert is truly needed, revert ONLY
  the confirmed phase-owned files (`cliSessionDispatch.tsx`, `cli.tsx`, and the
  new `session/` modules) after inspecting each with `git diff` to confirm no
  unrelated changes.

## Phase Completion Marker
Create `project-plans/issue2285/.completed/P12.md`.


The marker MUST contain structured diff evidence per the Standard Completion
Marker Template in `overview.md` (architect finding 8): files changed
(`git diff --name-only` of phase-owned files), diff stats (`git diff --stat`),
command outputs (exit status + key output), and tracker evidence (gate items
satisfied + verifier evidence).
