# Phase 07a: Boundary Checker Replacement Verification

## Phase ID
`PLAN-20260629-ISSUE2285.P07a`

## Prerequisites
- Required: Phase 07 completed.
- Verification: `test -f project-plans/issue2285/.completed/P07.md`.

## Verification Tasks

The deepthinker verifier confirms:

1. **`PUBLIC_AGENT_SYMBOLS` removed**: grep returns 0 (not renamed).
2. **Bare-root symbol check removed**: `AGENTS_PACKAGE_ROOT`,
   `importedSymbolsOf`, and the `agents-internal-symbol` /
   `agents-namespace-import` classifications are gone.
3. **New specifier-based fixture tests active and GREEN**: the new tests
   (bare root allowed, internals subpath forbidden, deep source path forbidden)
   are committed un-skipped (revision 3 finding 8: P06 never wrote skipped
   tests — it produced an executable characterization proof instead; P07 adds the new tests
   un-skipped from the start). Tests are passing.
4. **Old symbol-level fixture tests removed/converted**.
5. **Internals subpath forbidden by existing rule**: agents is absent from
   `PUBLIC_SUBPATHS_BY_PACKAGE`.
6. **Preserved behaviors intact**: getConfig scan, vi.mock detection,
   thin-entry guard, scoped subpath logic, self-pruning allowlist.
7. **`npm run lint:cli-boundary` passes** and invokes
   `node scripts/check-cli-import-boundary.mjs`.
8. **P06 characterization proof reclassified/deleted (revision 3 finding 7)**:
   after the old behavior is removed, the
   `boundary-checker-characterization-proof.mjs` is converted to a GREEN
   regression proof (re-asserted against the NEW checker), deleted, or
   reclassified into the fixture test suite. It is NOT left as a stale
   artifact asserting removed old behavior.
9. **No marker comment blocks in the checker script** (finding 5).
10. **No deferred language**.
11. **No lint loosening / suppression directives**.

## Verification Commands

```bash
# Full removal (fail-closed)
SYM_HITS="$(grep -c 'PUBLIC_AGENT_SYMBOLS\|AGENTS_PACKAGE_ROOT\|importedSymbolsOf' scripts/check-cli-import-boundary.mjs || true)"
test "$SYM_HITS" -eq 0 || { echo "FAIL: removed symbols still present ($SYM_HITS hits)"; exit 1; }

CLASS_HITS="$(grep -c 'agents-internal-symbol\|agents-namespace-import' scripts/check-cli-import-boundary.mjs || true)"
test "$CLASS_HITS" -eq 0 || { echo "FAIL: removed classifications still present ($CLASS_HITS hits)"; exit 1; }

# No renamed equivalent (fail-closed)
RENAMED="$(grep -n 'createAgentRuntimeFactoryBindings\|createAgenticLoop' scripts/check-cli-import-boundary.mjs || true)"
test -z "$RENAMED" || { echo "FAIL: renamed equivalent present:"; echo "$RENAMED"; exit 1; }

# Preserved behaviors (fail-closed — all four must be present)
PRES="$(grep -c 'scanGetConfigEscapeHatch\|isNonLiteralViMock\|PUBLIC_SUBPATHS_BY_PACKAGE\|THIN_ENTRY_MAX_LINES' scripts/check-cli-import-boundary.mjs || true)"
test "$PRES" -ge 4 || { echo "FAIL: preserved behaviors missing ($PRES/4 present)"; exit 1; }

# agents NOT in the public-subpath map (fail-closed)
AGENTS_SUBPATH="$(grep -A25 'PUBLIC_SUBPATHS_BY_PACKAGE = {' scripts/check-cli-import-boundary.mjs | grep -c 'agents' || true)"
test "$AGENTS_SUBPATH" -eq 0 || { echo "FAIL: agents found in PUBLIC_SUBPATHS_BY_PACKAGE"; exit 1; }

# P07 adds the new tests un-skipped (revision 3 finding 8: no .skip — P06 never
# committed skipped tests, so there is nothing to "un-skip"; P07 adds them fresh)
git diff HEAD -- scripts/tests/cli-import-boundary.test.js | grep -E "^\+.*\.(skip|todo)|BOUNDARY_V2" && { echo "FAIL: P07 committed skipped/guarded tests"; exit 1; } || echo "OK: no skipped tests"

# Revision 3 finding 7: P06 characterization proof reclassified/deleted (not left stale)
# The proof file's assertions must match the NEW checker behavior (converted to
# a GREEN regression proof), OR the file must be deleted, OR its assertions
# moved into the fixture test suite. It must NOT still assert removed old behavior.
if [ -f project-plans/issue2285/analysis/boundary-checker-characterization-proof.mjs ]; then
  node project-plans/issue2285/analysis/boundary-checker-characterization-proof.mjs
  test $? -eq 0 || { echo "FAIL: boundary-checker-characterization-proof.mjs is stale (asserts removed old behavior) — reclassify/delete it per finding 7"; exit 1; }
  echo "OK: characterization proof converted to GREEN regression proof"
else
  echo "OK: characterization proof deleted/moved into fixture suite"
fi

# npm script invokes the checker (fail-closed)
grep -q "lint:cli-boundary" package.json || { echo "FAIL: lint:cli-boundary script missing"; exit 1; }
grep -q "check-cli-import-boundary.mjs" package.json || { echo "FAIL: checker not referenced in package.json"; exit 1; }

# Real-repo boundary check passes (fail-closed)
npm run lint:cli-boundary
test $? -eq 0 || { echo "FAIL: lint:cli-boundary"; exit 1; }

# Fixture tests (fail-closed — Vitest is the established runner for
# cli-import-boundary.test.js — node --test does NOT work because the file is
# a Vitest test using vitest imports; see P06a evidence).
npx vitest run --config ./scripts/tests/vitest.config.ts scripts/tests/cli-import-boundary.test.js
test $? -eq 0 || { echo "FAIL: fixture tests"; exit 1; }

# New specifier-based fixture tests exist and are active (fail-closed)
grep -q "internals.js" scripts/tests/cli-import-boundary.test.js || { echo "FAIL: internals.js fixture test missing"; exit 1; }
grep -q "allows a bare agents root import\|allows importing a PUBLIC agents symbol" scripts/tests/cli-import-boundary.test.js || { echo "FAIL: bare-root allow test missing"; exit 1; }

# No deferred language (revision 3 finding 4 — scoped to phase-owned files) — fail-closed
DEFERRED="$(grep -rn -E "(TODO|FIXME|HACK|STUB|TEMPORARY|placeholder|for now)" scripts/check-cli-import-boundary.mjs scripts/tests/cli-import-boundary.test.js || true)"
test -z "$DEFERRED" || { echo "FAIL: deferred language:"; echo "$DEFERRED"; exit 1; }

# eslint-guard (fail-closed)
npm run lint:eslint-guard
test $? -eq 0 || { echo "FAIL: eslint-guard"; exit 1; }
```

## Semantic Verification Checklist

- [ ] I read `analyzeFile` in the checker: only deep-import + non-literal
      vi.mock checks remain; no bare-root symbol inspection.
- [ ] I read `isDisallowedDeepImport` + `PUBLIC_SUBPATHS_BY_PACKAGE`: the
      internals subpath is forbidden because agents is absent from the map.
- [ ] I read the fixture test file: new specifier-based tests are committed
      un-skipped and GREEN (revision 3 finding 8: P06 never wrote skipped
      tests — it produced an executable characterization proof; P07 adds the new tests
      fresh); old symbol-level tests are gone.
- [ ] The P06 characterization proof was reclassified/deleted per revision 3
      finding 7.
- [ ] The new fixture tests assert the exact violation classification and the
      offending specifier literal (finding 9).
- [ ] The checker script has NO new marker comment blocks (finding 5).
- [ ] If I re-introduce `import { AgentClient } from
      '@vybestack/llxprt-code-agents/internals.js'` into a production CLI
      file, `npm run lint:cli-boundary` fails.

## Non-Deferral Gate 2 (Manual Symbol Allowlist) Evidence

Fill in execution-tracker.md Gate 2 verifier evidence with:
- grep confirming `PUBLIC_AGENT_SYMBOLS` (and `AGENTS_PACKAGE_ROOT`,
  `importedSymbolsOf`) are gone.
- grep confirming agents is absent from `PUBLIC_SUBPATHS_BY_PACKAGE`.
- `npm run lint:cli-boundary` PASS output.
- fixture test PASS output (new specifier-based tests GREEN, un-skipped).
- confirmation `npm run lint:cli-boundary` invokes
  `node scripts/check-cli-import-boundary.mjs`.

## Success Criteria
- PASS: symbol allowlist fully removed, new specifier-based tests committed
  un-skipped and GREEN (revision 3 finding 8), old tests removed/converted,
  P06 characterization proof reclassified/deleted (finding 7), preserved behaviors intact,
  real-repo boundary check green, no marker churn in checker script (finding 5),
  gate 2 evidence recorded.

## Phase Completion Marker
Create `project-plans/issue2285/.completed/P07a.md`.


The marker MUST contain structured diff evidence per the Standard Completion
Marker Template in `overview.md` (architect finding 8): files changed
(`git diff --name-only` of phase-owned files), diff stats (`git diff --stat`),
command outputs (exit status + key output), and tracker evidence (gate items
satisfied + verifier evidence).
