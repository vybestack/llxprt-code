# Phase 07: Boundary Checker Replacement (remove PUBLIC_AGENT_SYMBOLS)

## Phase ID
`PLAN-20260629-ISSUE2285.P07`

## Prerequisites
- Required: Phase 06a completed.
- Verification: `test -f project-plans/issue2285/.completed/P06a.md`.

## Purpose

Architect finding 3: the prior revision combined test and production changes
for the boundary checker. P06 wrote the executable proof characterizing the
old behavior gap (GREEN — revision 3 finding 6; P06 does NOT commit skipped
tests). This phase implements the production change (removing
`PUBLIC_AGENT_SYMBOLS`) AND adds the new specifier-based fixture tests
un-skipped from the start alongside the production change so they go GREEN
together.

**Revision 3 (architect finding 7 — characterization-proof lifecycle):** after this phase
removes the old behavior, the P06 proof
(`boundary-checker-characterization-proof.mjs`) has STALE assertions (it asserts the old
checker still flags bare-root internal-symbol imports, which is no longer true
after `PUBLIC_AGENT_SYMBOLS` removal). This phase MUST reclassify the proof:
either (a) CONVERT it to assert the NEW behavior (bare root allowed at
specifier level) so it remains a live regression guard, or (b) DELETE it if
the new fixture tests in `scripts/tests/cli-import-boundary.test.js` fully
cover the same cases. The choice and rationale are recorded in the P07
completion marker. The proof must NOT be left asserting old behavior that no
longer exists.

## Requirements Implemented (Expanded)

### REQ-003.1/.2/.3/.4: Manual Symbol Allowlist Gate (boundary checker replacement)

**Full Text**: `PUBLIC_AGENT_SYMBOLS` and its root-symbol checking logic must be
removed from `scripts/check-cli-import-boundary.mjs`. Replacement rules are
based on import specifiers and package/subpath contracts: bare agents root
allowed; `@vybestack/llxprt-code-agents/internals.js` forbidden in production
CLI; deep runtime package imports remain forbidden except narrowly justified
seams. Stale allowlist pruning, the getConfig escape-hatch scan, non-literal
`vi.mock` detection, thin-entry checks, and scoped public subpath logic must
continue to work. The existing `CLI_BOUNDARY_ROOT` fixture tests must be
updated.

**Behavior**:
- GIVEN: the agents root is depolluted (P05) and consumers migrated (P04), so
  the API-surface guard (P03/P05) now owns the "what does the root expose"
  question. P06 wrote the executable proof characterizing the old behavior gap
  (GREEN — revision 3 finding 6; P06 does NOT commit skipped tests). The
  boundary checker still carries `PUBLIC_AGENT_SYMBOLS`, a hand-maintained
  root-symbol allowlist that duplicates that contract.
- WHEN: `PUBLIC_AGENT_SYMBOLS`, the `AGENTS_PACKAGE_ROOT` bare-root symbol
  check block, and the now-unused `importedSymbolsOf` helper are removed from
  `scripts/check-cli-import-boundary.mjs`, the new specifier-based fixture
  tests are added (un-skipped from the start — P06 provides the proof, NOT
  skipped tests), the old symbol-level fixture tests are removed/converted,
  and the P06 proof is reclassified per finding 7.
- THEN: the boundary checker enforces "which package specifiers may production
  CLI import" purely via package/subpath contracts; the API-surface guard owns
  "what does the agents root expose". The internals subpath
  (`@vybestack/llxprt-code-agents/internals.js`) is forbidden in production CLI
  by the existing deep-import rule (it is a subpath NOT in
  `PUBLIC_SUBPATHS_BY_PACKAGE['@vybestack/llxprt-code-agents']`, which remains
  unset for agents). Bare-root imports are allowed at the specifier level; if
  an internal name leaked back into the root, the API-surface guard +
  typecheck catch it — NOT this checker.

**Why This Matters**: the symbol allowlist is the deliberately-preserved debt
this issue removes. Keeping it (even renamed) would leave a second hidden copy
of the public-API contract that can drift from the real root surface.

## Implementation Tasks

### Files to Modify

#### `scripts/check-cli-import-boundary.mjs`

Remove (per `analysis/pseudocode/boundary-checker-replacement.md`):
- The `PUBLIC_AGENT_SYMBOLS` constant (the entire
  `const PUBLIC_AGENT_SYMBOLS = new Set([...])` block, including its preceding
  JSDoc comment block that describes the bare-root internals leak).
- The `AGENTS_PACKAGE_ROOT` constant — it was named solely for the
  bare-root symbol check and is no longer referenced after removal.
- The bare-root symbol-check block inside `analyzeFile`: the
  `if (specifier === AGENTS_PACKAGE_ROOT && ts.isImportDeclaration(node) &&
  node.importClause) { ... }` block that calls `importedSymbolsOf` and pushes
  `agents-internal-symbol` / `agents-namespace-import` violations.
- The `importedSymbolsOf` function — it is only used by the
  removed bare-root symbol check. Confirm no other reference remains before
  deleting.
- The `agents-internal-symbol` / `agents-namespace-import` classification
  branches in the `main()` violation-reporting loop. After removal
  there are no `v.symbol` violations, so the `v.symbol !== undefined` branch
  collapses.

KEEP (unchanged — these are the preserved boundary behaviors):
- `PUBLIC_SUBPATHS_BY_PACKAGE` (the scoped per-package public-subpath map).
  It MUST remain UNSET for `@vybestack/llxprt-code-agents` so the internals
  subpath stays a deep-import violation. Do NOT add
  `@vybestack/llxprt-code-agents` to this map.
- `isDisallowedDeepImport` — it already flags
  `@vybestack/llxprt-code-agents/internals.js` (and any other agents subpath)
  as a deep import because agents has no entry in
  `PUBLIC_SUBPATHS_BY_PACKAGE`. No new logic is needed for the internals
  subpath; it is ALREADY forbidden. CONFIRM in this phase by inspection and
  the new fixture test.
- `ALLOWLIST` and the self-pruning freshness guard (section 3 of `main()`).
- `scanGetConfigEscapeHatch` and the getConfig scan (section 2 of `main()`).
- `isNonLiteralViMock` / `isViMockCall` / `specifierOf` and the non-literal
  vi.mock detection.
- The thin-entry guard (section 4 of `main()`): `CLI_INDEX` line count +
  `CLI_ENTRY` deep-import check.
- `walkDir`, `matchGlob`, `collectAllSpecifiers`, `RUNTIME_PACKAGES`,
  `TEST_DIR_GLOBS`, `PRUNED_DIR_BASE_NAMES`, etc.

Update the checker's existing top-of-file/section comments so they no longer
describe a bare-root symbol allowlist (update only where the content changed
semantically).

### Marker Discipline (architect finding 5 + architect review finding 5)

Do NOT add NEW `@plan:PLAN-20260629-ISSUE2285`/`@requirement` marker comment
blocks to `scripts/check-cli-import-boundary.mjs` — it is a production script,
and markers are restricted to test files and plan artifacts per the
comment-discipline policy. Update only existing comments where content changed
semantically; do NOT add decorative marker blocks.

**Pre-existing marker debt (architect review finding 5):** scripts and
production source may already contain markers from prior issues. The policy
prohibits only NEW issue2285 markers — it does NOT imply existing markers must
be removed unless the line they annotate changes for issue #2285 scope.

#### `project-plans/issue2285/analysis/boundary-checker-characterization-proof.mjs` (revision 3 — finding 7 reclassification)

This phase MUST reclassify the P06 proof because its assertions become stale
after the old behavior is removed. Either:
- **CONVERT**: update the proof's assertions to assert the NEW behavior (bare
  root internal-symbol imports are now ALLOWED at the specifier level) so the
  proof remains a live regression guard that would fail if the old
  symbol-allowlist behavior were reintroduced. Keep it GREEN.
- **DELETE**: remove the proof file entirely if the new fixture tests in
  `scripts/tests/cli-import-boundary.test.js` fully cover the same cases
  (bare-root allowed, internals subpath forbidden, deep path forbidden).

The choice and rationale are recorded in the P07 completion marker
(`.completed/P07.md`). The proof must NOT be left asserting old behavior that
no longer exists (it would either fail or mislead).

#### `scripts/tests/cli-import-boundary.test.js`

This phase adds the new fixture tests (un-skipped from the start — P06 does
NOT commit skipped tests; revision 3 finding 8 — it provides the executable
proof, NOT skipped tests) and removes/converts the old symbol-level tests:

ADD these new fixture tests (un-skipped, active from the moment they are
committed):
- **"allows a bare agents root import (specifier-level, always)"** —
  `import { createAgent } from '@vybestack/llxprt-code-agents'` → PASS (code
  0). This replaces the old symbol-level allow test.
- **"flags importing from the agents internals.js subpath (deep import)"** —
  `import { AgentClient } from
  '@vybestack/llxprt-code-agents/internals.js'` → FAIL (code 1), stdout
  contains the specifier and a deep-import classification (NOT
  `agents-internal-symbol`). Assert the internals subpath specifier literal
  appears.
- **"flags a deep agents source path import"** —
  `import { AgentClient } from
  '@vybestack/llxprt-code-agents/core/client.js'` → FAIL (code 1),
  deep-import classification.

REMOVE/CONVERT the old symbol-level tests (identified in P06):
- "flags importing an INTERNAL symbol (AgentClient) from the bare agents root"
  → REMOVE: bare-root symbol import is now allowed at specifier level.
- "flags importing an INTERNAL type-only symbol (CoreToolScheduler) from the
  bare root" → REMOVE.
- "flags a namespace import (import * as ns) from the bare agents root" →
  REMOVE.
- "flags a default import from the bare agents root (no default export)" →
  REMOVE.
- "allows importing PUBLIC runtime-construction factories ... from the bare
  root" → SIMPLIFY: fold into the "allows a bare agents root import" test.
- "flags importing the concrete AgenticLoop class from the bare root" →
  REMOVE.
- "flags importing an internal symbol via an alias (X as Y) from the bare
  root" → REMOVE.
- "flags internal agents symbols with NO per-file escape hatch" → REMOVE.
- "flags internal agents symbols from ANY file — no file is exempt" → REMOVE.

KEEP unchanged:
- "allows importing a PUBLIC agents symbol (createAgent) from the bare root"
  (stays valid — bare root allowed).
- All getConfig escape-hatch tests.
- All vi.mock tests, including the non-literal vi.mock test.
- The thin-entry test.
- The self-pruning allowlist tests.
- The empty-scan guard test.
- Any scoped public-subpath tests for the providers package.

### Boundary checker verification precision (architect finding 9)

The fixture assertions must target **actual declarations, usages, and violation
literals** — NOT broad greps that match harmless comments, fixture file names,
or unrelated strings. Each new test asserts the exact **violation
classification** and the **offending specifier literal** appear in stdout.

### Files NOT to Modify
- `packages/agents/src/index.ts` — already depolluted in P05.
- `packages/agents/package.json` — the `./internals.js` export entry stays.
- Any production CLI source — production CLI already imports only public
  symbols (confirmed in P01 inventory).

## Reachability

`scripts/check-cli-import-boundary.mjs` is invoked by
`npm run lint:cli-boundary`. The fixture tests run via the scripts test suite.

## Verification Commands

```bash
# PUBLIC_AGENT_SYMBOLS fully removed (not renamed) — fail-closed
test "$(grep -c 'PUBLIC_AGENT_SYMBOLS' scripts/check-cli-import-boundary.mjs || true)" -eq 0 || { echo "FAIL: PUBLIC_AGENT_SYMBOLS still present"; exit 1; }

# AGENTS_PACKAGE_ROOT removed — fail-closed
test "$(grep -c 'AGENTS_PACKAGE_ROOT' scripts/check-cli-import-boundary.mjs || true)" -eq 0 || { echo "FAIL: AGENTS_PACKAGE_ROOT still present"; exit 1; }

# importedSymbolsOf removed — fail-closed
test "$(grep -c 'importedSymbolsOf' scripts/check-cli-import-boundary.mjs || true)" -eq 0 || { echo "FAIL: importedSymbolsOf still present"; exit 1; }

# agents-internal-symbol / agents-namespace-import classifications removed — fail-closed
test "$(grep -c 'agents-internal-symbol\|agents-namespace-import' scripts/check-cli-import-boundary.mjs || true)" -eq 0 || { echo "FAIL: old classifications still present"; exit 1; }

# Preserved behaviors still present — fail-closed (all four required)
grep -q 'scanGetConfigEscapeHatch' scripts/check-cli-import-boundary.mjs || { echo "FAIL: scanGetConfigEscapeHatch missing"; exit 1; }
grep -q 'isNonLiteralViMock' scripts/check-cli-import-boundary.mjs || { echo "FAIL: isNonLiteralViMock missing"; exit 1; }
grep -q 'PUBLIC_SUBPATHS_BY_PACKAGE' scripts/check-cli-import-boundary.mjs || { echo "FAIL: PUBLIC_SUBPATHS_BY_PACKAGE missing"; exit 1; }
grep -q 'THIN_ENTRY_MAX_LINES\|thin-entry' scripts/check-cli-import-boundary.mjs || { echo "FAIL: thin-entry missing"; exit 1; }

# agents NOT added to PUBLIC_SUBPATHS_BY_PACKAGE — fail-closed
test "$(grep -A20 'PUBLIC_SUBPATHS_BY_PACKAGE' scripts/check-cli-import-boundary.mjs | grep -c 'llxprt-code-agents' || true)" -eq 0 || { echo "FAIL: agents added to PUBLIC_SUBPATHS_BY_PACKAGE"; exit 1; }

# Boundary checker passes against the real repo — fail-closed
npm run lint:cli-boundary
test $? -eq 0 || { echo "FAIL: lint:cli-boundary"; exit 1; }

# Fixture tests pass — fail-closed (Vitest is the established runner for
# cli-import-boundary.test.js — node --test does NOT work because the file is
# a Vitest test using vitest imports; see P06a evidence).
npx vitest run --config ./scripts/tests/vitest.config.ts scripts/tests/cli-import-boundary.test.js
test $? -eq 0 || { echo "FAIL: fixture tests"; exit 1; }
```

## Deferred Implementation Detection (revision 3 — finding 4: scoped to phase-owned files)

```bash
# Fail-closed — scoped ONLY to files this phase modifies (avoids unrelated hits)
DEFERRED="$(grep -rn -E "(TODO|FIXME|HACK|STUB|TEMPORARY|placeholder|for now)" scripts/check-cli-import-boundary.mjs scripts/tests/cli-import-boundary.test.js || true)"
test -z "$DEFERRED" || { echo "FAIL: deferred language:"; echo "$DEFERRED"; exit 1; }
```

## Constraints (restate for the worker)

- NO `eslint-disable`, `ts-ignore`, `ts-expect-error`, `ts-nocheck`, lint
  severity downgrade, complexity threshold increase, or ignore expansion.
- Do NOT rename `PUBLIC_AGENT_SYMBOLS` to a different constant — that is the
  same hidden allowlist. Delete it entirely.
- Do NOT add `@vybestack/llxprt-code-agents` (or `internals.js`) to
  `PUBLIC_SUBPATHS_BY_PACKAGE`.
- Do NOT add marker comment blocks to `scripts/check-cli-import-boundary.mjs`
  (finding 5).

## Success Criteria
- `PUBLIC_AGENT_SYMBOLS`, `AGENTS_PACKAGE_ROOT`, `importedSymbolsOf`, and the
  bare-root symbol-check block removed from the checker.
- `agents-internal-symbol` / `agents-namespace-import` classifications gone.
- New specifier-based fixture tests added (un-skipped from the start) and GREEN.
- Old symbol-level fixture tests removed/converted.
- Preserved behaviors intact (getConfig, vi.mock, thin-entry, scoped subpath,
  self-pruning).
- `npm run lint:cli-boundary` passes against the real repo.
- Fixture test suite passes.
- P06 proof reclassified (converted or deleted — revision 3 finding 7);
  rationale recorded in `.completed/P07.md`.
- No marker comment blocks in the checker script (finding 5).
- No deferred language (scoped — finding 4), no lint loosening.

## Failure Recovery

This phase does NOT use `git checkout` rollback for failure recovery. Instead:
- If the boundary checker fails after `PUBLIC_AGENT_SYMBOLS` removal: the
  removal was incomplete or a preserved behavior was accidentally deleted.
  Inspect `git diff` and fix the specific issue in place.
- If fixture tests fail: the test conversion was wrong — fix the specific test
  assertion. Use precise violation-literal assertions (finding 9).
- Report any blocking issue to the coordinator.

## Phase Completion Marker
Create `project-plans/issue2285/.completed/P07.md`.


The marker MUST contain structured diff evidence per the Standard Completion
Marker Template in `overview.md` (architect finding 8): files changed
(`git diff --name-only` of phase-owned files), diff stats (`git diff --stat`),
command outputs (exit status + key output), and tracker evidence (gate items
satisfied + verifier evidence).
