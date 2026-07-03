# Phase 12a: CLI Session Module Split Verification

## Phase ID
`PLAN-20260629-ISSUE2285.P12a`

## Prerequisites
- Required: Phase 12 completed.
- Verification: `test -f project-plans/issue2285/.completed/P12.md`.

## Verification Tasks

The deepthinker verifier confirms:

1. **Stable ownership**: `cliSessionDispatch.tsx` is **deleted** (preferred —
   see Barrel retention policy in P12) with cli.tsx importing directly from
   the new stable modules, OR reduced to a justified thin re-export barrel
   (logic-free, six names only, with a documented specific justification
   proving direct imports are impractical). It is NOT a re-quarantine under a
   new name, and NOT a parallel `cliSessionDispatchV2.tsx`.
2. **Stale-reference check (revision 3 — finding 15: FAIL-CLOSED,
   conditional on deleted vs retained barrel)**: if the barrel is retained,
   grep confirms NO remaining import of `cliSessionDispatch` except cli.tsx
   (the barrel consumer). If deleted, grep confirms NO remaining import of
   `cliSessionDispatch` anywhere. The verification command branches on whether
   the file exists and exits nonzero on any orphan — it is no longer advisory.
3. **Behavior preserved**: the P11 characterization tests remain GREEN with
   UNCHANGED observable-effect assertions (revision 3 finding 16: import-path
   retargeting only; assertion bodies verified identical via P11-baseline hash
   comparison — architect finding 3: NOT `git diff HEAD`, which would include
   the entire P11-added file).
4. **Six cli.tsx exports resolve**: `dispatchInteractiveOrNonInteractive`,
   `formatNonInteractiveError`, `initializeOutputListenersAndFlush`,
   `installNonInteractiveSigintHandler`, `setupUnhandledRejectionHandler`,
   `startInteractiveUI` — all resolve from cli.tsx's import source and the
   re-exports compile.
5. **`validateDnsResolutionOrder` stays in `cliBootstrap`**: NOT moved into
   any session module; cli.tsx still re-exports it from `./cliBootstrap.js`.
6. **No temporary/quarantine/holding-pen language** in cli.tsx, the new
   modules, the retained barrel (if any), or tests. **Scope note (architect
   finding 9): the executable scan covers production source + characterization
   tests only; plan/analysis docs are NOT scanned (they intentionally use
   "quarantine" to describe the problem).**
7. **typecheck passes**.
8. **CLI tests pass** (broadly, not just characterization).
9. **`lint:cli-boundary` passes** — the new session modules are in scope and
   introduce no disallowed deep imports.
10. **No deferred language** added by this phase.
11. **No lint loosening / suppression directives**.

## Verification Commands

```bash
# Six exports resolve from cli.tsx — fail-closed (each must be present)
grep -q "dispatchInteractiveOrNonInteractive" packages/cli/src/cli.tsx || { echo "FAIL: dispatchInteractiveOrNonInteractive missing from cli.tsx"; exit 1; }
grep -q "formatNonInteractiveError" packages/cli/src/cli.tsx || { echo "FAIL: formatNonInteractiveError missing from cli.tsx"; exit 1; }
grep -q "initializeOutputListenersAndFlush" packages/cli/src/cli.tsx || { echo "FAIL: initializeOutputListenersAndFlush missing from cli.tsx"; exit 1; }
grep -q "installNonInteractiveSigintHandler" packages/cli/src/cli.tsx || { echo "FAIL: installNonInteractiveSigintHandler missing from cli.tsx"; exit 1; }
grep -q "setupUnhandledRejectionHandler" packages/cli/src/cli.tsx || { echo "FAIL: setupUnhandledRejectionHandler missing from cli.tsx"; exit 1; }
grep -q "startInteractiveUI" packages/cli/src/cli.tsx || { echo "FAIL: startInteractiveUI missing from cli.tsx"; exit 1; }

# Each name is actually exported by its new home (or the barrel) — fail-closed
EXPORTED_COUNT="$(grep -rc "export.*dispatchInteractiveOrNonInteractive\|export.*formatNonInteractiveError\|export.*initializeOutputListenersAndFlush\|export.*installNonInteractiveSigintHandler\|export.*setupUnhandledRejectionHandler\|export.*startInteractiveUI" packages/cli/src/session/ packages/cli/src/cliSessionDispatch.tsx 2>/dev/null | awk -F: '{s+=$2} END{print s+0}')"
test "$EXPORTED_COUNT" -ge 6 || { echo "FAIL: not all six exports found in new homes/barrel ($EXPORTED_COUNT/6)"; exit 1; }

# validateDnsResolutionOrder NOT in session modules; still in cliBootstrap — fail-closed
SESSION_DNS="$(grep -rn "validateDnsResolutionOrder" packages/cli/src/session/ || true)"
test -z "$SESSION_DNS" || { echo "FAIL: validateDnsResolutionOrder moved to session/"; exit 1; }
grep -qn "validateDnsResolutionOrder" packages/cli/src/cliBootstrap.tsx || { echo "FAIL: validateDnsResolutionOrder not in cliBootstrap"; exit 1; }
grep -qn "export.*validateDnsResolutionOrder" packages/cli/src/cli.tsx || { echo "FAIL: validateDnsResolutionOrder not re-exported from cli.tsx"; exit 1; }

# No quarantine language — fail-closed (revision 3 finding 5 — narrowed to
# quarantine synonyms, scoped to split surface; case-insensitive)
QUARANTINE="$(grep -rn -i 'quarantine\|holding pen\|holding-pen' packages/cli/src/cliSessionDispatch.tsx packages/cli/src/session/ packages/cli/src/cli.tsx 2>/dev/null || true)"
test -z "$QUARANTINE" || { echo "FAIL: quarantine language present:"; echo "$QUARANTINE"; exit 1; }

# No parallel V2 module — fail-closed
test ! -f packages/cli/src/cliSessionDispatchV2.tsx || { echo "FAIL: parallel cliSessionDispatchV2.tsx created"; exit 1; }

# Stale-reference check (revision 3 — architect finding 15: FAIL-CLOSED,
# conditional on deleted vs retained barrel — no longer advisory).
# Branch: if cliSessionDispatch.tsx was DELETED, expect ZERO references.
# If it was RETAINED as a barrel, expect references ONLY in cli.tsx (the
# barrel consumer). Any other reference is an orphan → FAIL.
if [ ! -f packages/cli/src/cliSessionDispatch.tsx ]; then
  # DELETED: no references anywhere
  REF_COUNT="$(grep -rn "cliSessionDispatch" packages/cli/src --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist | wc -l | tr -d ' ')"
  test "$REF_COUNT" -eq 0 || { echo "FAIL: barrel DELETED but $REF_COUNT orphaned cliSessionDispatch references remain:"; grep -rn "cliSessionDispatch" packages/cli/src --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist; exit 1; }
  echo "OK: cliSessionDispatch deleted, zero references"
else
  # RETAINED as barrel: references only in cli.tsx (the barrel consumer)
  ORPHANS="$(grep -rn "cliSessionDispatch" packages/cli/src --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist | grep -v 'packages/cli/src/cli.tsx' | grep -v 'packages/cli/src/cliSessionDispatch.tsx' || true)"
  test -z "$ORPHANS" || { echo "FAIL: barrel retained but orphaned references outside cli.tsx:"; echo "$ORPHANS"; exit 1; }
  echo "OK: cliSessionDispatch retained as barrel, references confined to cli.tsx"
fi

# Characterization tests GREEN unchanged — fail-closed
# (revision 3 finding 16: verify retargeted tests changed ONLY import specifiers,
# not assertion bodies — see the assertion-body stability check below.)
npm run test --workspace @vybestack/llxprt-code -- cliSessionDispatch.characterization 2>/dev/null \
  || npm run test -- packages/cli/src/__tests__/cliSessionDispatch.characterization
test $? -eq 0 || { echo "FAIL: characterization tests not GREEN"; exit 1; }

# Assertion-body stability (architect finding 3 + revision 3 finding 16):
# Compare against the P11 BASELINE saved at the end of P11, NOT git diff HEAD
# (which would include the entire P11-added characterization test file and
# fail on its assertions). The baseline captures the assertion-body lines
# (expect calls and matchers); P12's retargeting may change ONLY import
# specifiers, so the assertion-body hash must be IDENTICAL before and after.
BASELINE_FILE="project-plans/issue2285/.completed/P11-assertion-baseline.sha256"
BASELINE_LINES="project-plans/issue2285/.completed/P11-assertion-baseline.txt"
test -s "$BASELINE_FILE" || { echo "FAIL: P11 assertion baseline missing (P11 must save it)"; exit 1; }
test -s "$BASELINE_LINES" || { echo "FAIL: P11 assertion baseline lines missing"; exit 1; }
CHAR_TEST=""
for f in packages/cli/src/__tests__/cliSessionDispatch.characterization.test.tsx packages/cli/src/__tests__/cliSessionDispatch.characterization.test.ts; do
  [ -f "$f" ] && CHAR_TEST="$f" && break
done
test -n "$CHAR_TEST" || { echo "FAIL: characterization test file not found for comparison"; exit 1; }
# Recompute the assertion-body hash from the current (post-P12) test file.
CURRENT_HASH="$(grep -nE 'expect\(|\.toBe\(|\.toEqual\(|\.toContain\(|\.toThrow\(|\.toMatch\(|\.toHaveLength\(|\.toBeGreaterThan\(|\.toBeLessThan\(|\.toBeTruthy\(|\.toBeFalsy\(|\.toBeNull\(|\.toBeUndefined\(|\.toBeDefined\(|\.toHaveBeenCalled\(|\.toHaveBeenCalledWith' "$CHAR_TEST" \
  | shasum -a 256 | awk '{print $1}')"
BASELINE_HASH="$(cat "$BASELINE_FILE")"
test "$CURRENT_HASH" = "$BASELINE_HASH" || { echo "FAIL: characterization assertion bodies changed (only import specifiers may change — finding 16). Baseline hash: $BASELINE_HASH, current hash: $CURRENT_HASH"; exit 1; }
echo "OK: characterization assertion bodies unchanged (baseline match)"

# typecheck (fail-closed)
npm run typecheck
test $? -eq 0 || { echo "FAIL: typecheck"; exit 1; }

# CLI tests broadly — fail-closed
npm run test --workspace @vybestack/llxprt-code 2>/dev/null || npm run test -- packages/cli
test $? -eq 0 || { echo "FAIL: CLI tests"; exit 1; }

# Boundary (new session modules in scope) — fail-closed
npm run lint:cli-boundary
test $? -eq 0 || { echo "FAIL: lint:cli-boundary"; exit 1; }

# eslint-guard (fail-closed)
npm run lint:eslint-guard
test $? -eq 0 || { echo "FAIL: eslint-guard"; exit 1; }

# No NEWLY INTRODUCED deferred language (architect review finding 6: pre-phase
# baseline for existing files). For existing files (cliSessionDispatch.tsx,
# cli.tsx), use git diff added-lines. For new session modules, scan whole file.
EXISTING_P12A="packages/cli/src/cliSessionDispatch.tsx packages/cli/src/cli.tsx"
NEW_DEFERRED_EXISTING="$(git diff -- $EXISTING_P12A 2>/dev/null | grep '^+' | grep -v '^+++' | grep -iE '(TODO|FIXME|HACK|STUB|TEMPORARY|placeholder|for now)' || true)"
test -z "$NEW_DEFERRED_EXISTING" || { echo "FAIL: newly introduced deferred language in existing files:"; echo "$NEW_DEFERRED_EXISTING"; exit 1; }
DEFERRED_NEW="$(grep -rn -E "(TODO|FIXME|HACK|STUB|TEMPORARY|placeholder|for now)" packages/cli/src/session/ 2>/dev/null || true)"
test -z "$DEFERRED_NEW" || { echo "FAIL: deferred language in new session modules:"; echo "$DEFERRED_NEW"; exit 1; }
echo "OK: no newly introduced deferred language (pre-existing baseline tolerated for existing files)"

# No suppression directives — fail-closed
SUPP="$(grep -rn -E "(eslint-disable|ts-ignore|ts-expect-error|ts-nocheck)" packages/cli/src/session/ packages/cli/src/cliSessionDispatch.tsx packages/cli/src/cli.tsx 2>/dev/null || true)"
test -z "$SUPP" || { echo "FAIL: suppression directives:"; echo "$SUPP"; exit 1; }
```

## Semantic Verification Checklist

- [ ] I read the new `session/` modules: each has one clear responsibility;
      none is a re-quarantine.
- [ ] The P11 characterization tests are GREEN with unchanged assertions —
      behavior was preserved by the split.
- [ ] All six cli.tsx exports resolve and the re-exports compile.
- [ ] `validateDnsResolutionOrder` is in `cliBootstrap`, not in any session
      module.
- [ ] No temporary/quarantine/holding-pen language in the split surface
      (production source + characterization tests; architect finding 9:
      plan/analysis docs are NOT scanned — they intentionally use
      "quarantine" to describe the problem).
- [ ] No parallel V2 module was created.
- [ ] The new modules are in CLI boundary scope and pass `lint:cli-boundary`.

## Non-Deferral Gate 6 (CLI Session Ownership) Evidence — split portion

Fill in execution-tracker.md Gate 6 verifier evidence (split items) with:
- confirmation `cliSessionDispatch.tsx` is split/deleted/reduced-to-barrel.
- confirmation the six cli.tsx exports resolve.
- confirmation `validateDnsResolutionOrder` stays in `cliBootstrap`.
- grep confirming no quarantine language.
- P11 characterization tests GREEN-unchanged output.
- `npm run typecheck`, CLI tests, `lint:cli-boundary`, `lint:eslint-guard`
  PASS output.

(The characterization-test portion of gate 6 was verified in P11a.)

## Success Criteria
- PASS: stable ownership achieved, behavior preserved (characterization GREEN
  unchanged), six exports resolve, validateDnsResolutionOrder unmoved, no
  quarantine language, typecheck + CLI tests + boundary + eslint-guard green,
  gate 6 split evidence recorded.

## Phase Completion Marker
Create `project-plans/issue2285/.completed/P12a.md`.


The marker MUST contain structured diff evidence per the Standard Completion
Marker Template in `overview.md` (architect finding 8): files changed
(`git diff --name-only` of phase-owned files), diff stats (`git diff --stat`),
command outputs (exit status + key output), and tracker evidence (gate items
satisfied + verifier evidence).
