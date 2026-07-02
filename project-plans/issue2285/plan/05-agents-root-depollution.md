# Phase 05: Agents Root Depollution + API-Surface Guard Deny-Mode (GREEN)

## Phase ID
`PLAN-20260629-ISSUE2285.P05`

## Prerequisites
- Required: Phase 04a completed.
- Verification: `test -f project-plans/issue2285/.completed/P04a.md`.

## Purpose

Architect finding 1: the prior revision left the full repo broken between
depollution and consumer migration. This phase runs AFTER consumer migration
(P04), so removing `export * from './internals.js'` breaks nothing — all
consumers were already migrated in P04. This phase is a single GREEN boundary.

## Requirements Implemented (Expanded)

### REQ-001.1/.2/.3/.4: Agents Root Barrel Gate (depollution)

**Full Text**: `packages/agents/src/index.ts` must NOT contain
`export * from './internals.js'`. Internal names must not reappear through the
root unnoticed. Intentional curated loop API preserved. The guard covers type
and value exports.

### REQ-002.1/.2/.3/.4/.5: Public API Contract Gate (deny-mode flip)

**Full Text**: The API-surface guard is flipped to deny mode so it now
independently asserts ABSENCE of known internals and fails closed on unknown
root-surface changes. The snapshot is updated to the depolluted surface.

**Behavior**:
- GIVEN: the API-surface guard mechanism (P03) is in place and GREEN in
  characterization mode (it detects the current leak). All consumers have been
  migrated (P04) — no consumer imports internals-only names from the root.
- WHEN: `export * from './internals.js'` is removed from
  `packages/agents/src/index.ts`, the guard is flipped to deny mode
  (`DENY_MODE = true`), the snapshot is updated to the depolluted surface,
  and existing agents surface tests are surgically updated.
- THEN: the API-surface guard DENY assertions go GREEN; the snapshot matches
  the depolluted surface; existing agents surface tests pass. The FULL repo
  is GREEN — no cross-package breakage because P04 already migrated consumers.

### REQ-001 (createTaskToolRegistration + disambiguation audit — architect finding 7)

**Decision** (from preflight): `createTaskToolRegistration` REMAINS a curated
root export. It is app-glue (a named factory delegating to
`createTaskRegistration`), not a low-level internals symbol. A2A imports it
from the root legitimately. The API-surface snapshot includes it. It is NOT
removed.

**Disambiguation export audit (architect finding 7 — concrete evidence required)**:

After removing `export * from './internals.js'`, the `export *` merge conflict
that required disambiguation no longer exists for names already in
`./api/index.js`. For EACH disambiguation export (`AgenticLoopMessage`,
`ApprovalHandler`, `CompressionResult`, and any others found in `index.ts`),
this phase MUST produce **concrete emitted-declaration / root-snapshot
evidence** before deciding to remove or retain:

1. **Snapshot evidence**: after updating the depolluted snapshot, check whether
   the symbol appears in `expected-root-surface.json` (the depolluted surface).
2. **Declaration evidence**: run `npm run build --workspace @vybestack/llxprt-code-agents`
   and grep the freshly emitted `dist/index.d.ts` for the symbol name.
3. **api-barrel evidence**: grep `packages/agents/src/api/index.ts` to confirm
   whether the symbol is already re-exported from the api barrel.

For each disambiguation export, record the decision with evidence:
- **If the symbol is already in `api/index.ts`** AND appears in the depolluted
  root snapshot AND in `dist/index.d.ts`: the explicit re-export is REDUNDANT —
  remove it. Record the three-evidence items.
- **If the symbol is NOT in `api/index.ts`** but IS part of the intended public
  surface (appears in the depolluted root snapshot and `dist/index.d.ts`):
  KEEP the explicit re-export. Record the evidence and the justification.
- **If the symbol is NOT in `api/index.ts`** and is NOT part of the intended
  public surface (does NOT appear in the depolluted root snapshot after
  removing the disambiguation export): remove it as internals leakage. Record
  the evidence.

NO symbol may be removed without the three-evidence trail (snapshot +
declaration + api-barrel). This prevents accidental removal of public type
exports (architect finding 7).

## Implementation Tasks

### Files to Modify

- `packages/agents/src/index.ts`:
  - REMOVE: `export * from './internals.js';`
  - KEEP: `export * from './api/index.js';`
  - AUDIT (with evidence per finding 7): the explicit
    `export type { AgenticLoopMessage, ApprovalHandler }` and
    `export type { CompressionResult }` — remove redundant ones (with evidence)
    or justify retention (with evidence).
  - KEEP: `createTaskToolRegistration` function (curated root export).
  - Remove the `@plan:PLAN-20260617-COREAPI.P07` "non-breaking top-level barrel"
    comment that describes the internals re-export (it is no longer accurate).
  - Do NOT add `@plan`/`@requirement` markers to this production source file
    (markers are restricted to test files and plan artifacts per the
    comment-discipline policy — architect finding 5).

- `packages/agents/src/api/__tests__/publicSurface.guard.test.ts`:
  - FLIP: `DENY_MODE` from `false` to `true` (the guard now asserts denied
    names are ABSENT).
  - The deny logic and snapshot comparison now run in full enforcement mode.
  - Add `@plan:PLAN-20260629-ISSUE2285.P05` marker.

### API-Surface Guard Mode Transition (architect review finding 2)

**How the guard switches to final deny/enforcement mode:**

The standalone script (`scripts/check-agents-api-surface.mjs`) is ALWAYS
enforcement-active — it compares the report against the snapshot and exits
nonzero on mismatch. The mode transition happens through TWO coordinated
changes in P05:

1. **Snapshot update** (the script's enforcement transition): the snapshot
   (`expected-root-surface.json`) is updated from the CURRENT leaky surface
   (which includes `AgentClient`, `CoreToolScheduler`, `AgenticLoop`) to the
   DEPOLLUTED surface (which excludes them). After this update, the script's
   deny assertions enforce ABSENCE: any denied name remaining in the report
   causes a nonzero exit. There is no separate `DENY_MODE` flag in the script
   — the snapshot IS the enforcement target. In P03, the snapshot matched the
   leaky surface so the script passed (characterization). In P05, the snapshot
   matches the depolluted surface so the script enforces deny (final mode).

2. **Vitest test `DENY_MODE` flip** (the test's assertion transition): the
   `DENY_MODE` constant in `publicSurface.guard.test.ts` flips from `false`
   (P03: assert denied names are PRESENT, proving the leak is detectable) to
   `true` (P05: assert denied names are ABSENT, proving the leak is gone).
   This controls only the TEST's assertion direction, not the script's
   enforcement behavior.

Both changes happen in the SAME phase (P05) alongside the depollution, so the
repo is GREEN at the phase boundary: the root no longer leaks, the snapshot
reflects the clean surface, the script enforces deny, and the test asserts
absence. P03's current-leak proof (separate fixture evidence recorded in
P03's completion marker) preserved the leak-detection evidence without leaving
the script in a non-enforcing state.

- `packages/agents/src/api/__tests__/expected-root-surface.json`:
  - UPDATE: to the depolluted surface (regenerate by running the guard's
    snapshot-generation step — an explicit developer action producing a
    reviewable diff). Remove `AgentClient`, `CoreToolScheduler`, `AgenticLoop`
    and all other internals-only names.

- `packages/agents/src/api/__tests__/publicSurface.nonbreaking.test.ts`:
  - SURGICAL UPDATE (not mechanical inversion):
    - Test A: remove `AgenticLoop` from `expectedRootClasses` (it is no longer
      a root export). Keep the curated public functions.
    - Test B (identity `root.AgentClient === internals.AgentClient`): REMOVE
      this identity assertion. Replace with an explicit root DENY: assert
      `root.AgentClient` is `undefined` (the name is gone from the root). Keep
      the `internals.AgentClient` assertion (internals subpath still has it).
    - PROP tests: remove `AgenticLoop` from the root-key arrays.
  - Add `@plan:PLAN-20260629-ISSUE2285.P05` markers.

- `packages/agents/src/api/__tests__/nonBreaking.exports.test.ts`:
  - Test B (identity `root.AgentClient === internals.AgentClient`): REMOVE the
    identity assertion. Replace with root DENY assertion
    (`expect(root.AgentClient).toBeUndefined()`).
  - Add `@plan:PLAN-20260629-ISSUE2285.P05` markers.

### Files NOT to Modify
- `packages/agents/src/internals.ts` — stays as the internals subpath source.
- `packages/agents/package.json` — `./internals.js` export entry stays (the
  subpath is still available for legitimate non-CLI consumers).
- `packages/agents/src/app-service.ts` — orthogonal, not modified.
- `packages/agents/src/api/__tests__/apiSurfaceParser.mjs` — the parser mechanism
  is complete from P03; no change needed unless the export-star resolution
  surfaces an issue during the deny-flip.

### Marker Discipline (architect finding 5 + architect review finding 5)

Markers (`@plan`/`@requirement`) are RESTRICTED to test files and plan
artifacts. Do NOT add NEW `@plan:PLAN-20260629-ISSUE2285` marker comment blocks
to production source files (`index.ts`) — update only existing comments where
their content changed semantically (e.g. removing a stale "non-breaking barrel"
description). No decorative `@plan` comment churn in production source.

**Pre-existing marker debt (architect review finding 5):** production source
files across the repo (e.g. `packages/a2a-server/src/config/config.ts`,
`packages/tools/**`, `packages/settings/**`) already contain `@plan`/
`@requirement` markers from prior issues. The policy prohibits only NEW
issue2285 markers in production source — it does NOT imply existing markers
must be removed unless the line they annotate is changed for issue #2285 scope.

### API Guard Build Constraints (revision 3 — findings 1, 3, 8, 17, 20)

The API-surface guard uses the standalone script
(`scripts/check-agents-api-surface.mjs`, wired as `lint:agents-api-surface`)
created in P03. The Vitest test does NOT shell out to a build and does NOT
wire Vitest `globalSetup` (globalSetup runs inside the test lifecycle →
forbidden). The following constraints are MANDATORY:

1. **Standalone script, NOT globalSetup (finding 3)**: the guard runs as
   `npm run lint:agents-api-surface`, a CI/presubmit step. **Revision 4
   architect findings 1, 8**: CI inclusion is proven by verifying
   `.github/workflows/ci.yml` contains `npm run lint:agents-api-surface` (NOT
   just that the script exists and is in package.json, which proves local
   wiring, not GitHub workflow enforcement). Confirm the script exists, the
   `lint:agents-api-surface` entry is in root `package.json`, AND
   `.github/workflows/ci.yml` contains the step. Do NOT rely on grepping
   Vitest reporter output for "publicSurface.guard" (reporter formats vary).
2. **Isolated temp tsconfig extending SOURCE-path tsconfig.json (revision 4
   finding 3)**: the script builds declarations via a temp tsconfig + direct
   `tsc -p` (B1) into a temp dir, extending `packages/agents/tsconfig.json`
   (NOT `tsconfig.build.json` — source resolution is clean-CI safe), NOT via
   `scripts/build_package.js` (no outDir override) and NOT into shared `dist`.
   Fallback B2 recorded in the decision record with side-effect
   acknowledgement (finding 20).
3. **No tracked-file mutation**: the script writes ONLY to a temp/isolated
   gitignored directory (removed on exit) and the gitignored JSON report. The
   snapshot (`expected-root-surface.json`) is READ — updating it is an
   EXPLICIT developer action producing a reviewable diff.
4. **Fresh declaration contract**: the script always runs a fresh build (temp
   or shared).
5. **No shared-dist side effects (B1)**: the build targets a temp dir;
   concurrent test runs and other tests reading the shared `dist/` are
   unaffected. tsbuildinfo isolated to a temp path (finding 20).
6. **No in-lifecycle build**: the Vitest test reads the JSON surface report
   produced by the standalone script; it does NOT shell out to a build.

## Reachability

The agents root is consumed by CLI (`packages/cli/src/*`), A2A
(`packages/a2a-server/src/*`), and all library consumers. After depollution:
- Production CLI imports (already public-only) still resolve.
- A2A imports (already migrated to public factories / internals subpath in P04)
  still resolve.
- CLI test imports (already migrated to internals subpath in P04) still resolve.

The repo is GREEN end-to-end after this phase because P04 migrated all
consumers BEFORE depollution. There is NO cross-package breakage.

## Verification Commands

```bash
# Root no longer re-exports internals (fail-closed)
test "$(grep -c "export \* from './internals.js'" packages/agents/src/index.ts)" -eq 0 || { echo "FAIL: root still re-exports internals"; exit 1; }

# API-surface guard now GREEN in DENY mode (via standalone script — no in-lifecycle build, no globalSetup)
npm run lint:agents-api-surface
test $? -eq 0 || { echo "FAIL: API-surface script did not pass in deny mode"; exit 1; }
npm run test --workspace @vybestack/llxprt-code-agents -- publicSurface.guard
test $? -eq 0 || { echo "FAIL: guard test did not pass in deny mode"; exit 1; }
# Confirm the test does NOT shell out to build and does NOT wire globalSetup (revision 3)
grep -E "execSync|spawnSync|child_process|npm run build|globalSetup" packages/agents/src/api/__tests__/publicSurface.guard.test.ts && { echo "FAIL: guard test shells out to build or wires globalSetup"; exit 1; } || echo "OK: no in-lifecycle build"

# Agents package typecheck passes (fail-closed)
npm run typecheck --workspace @vybestack/llxprt-code-agents
test $? -eq 0 || { echo "FAIL: agents typecheck"; exit 1; }

# FULL REPO typecheck passes (no cross-package breakage — P04 migrated consumers) — fail-closed
npm run typecheck
test $? -eq 0 || { echo "FAIL: full repo typecheck"; exit 1; }

# Agents package tests pass (the updated surface tests) — fail-closed
npm run test --workspace @vybestack/llxprt-code-agents
test $? -eq 0 || { echo "FAIL: agents tests"; exit 1; }

# Identity assertions removed (fail-closed)
IDENTITY_HITS="$(grep -rc "root.AgentClient === internals.AgentClient" packages/agents/src/api/__tests__/publicSurface.nonbreaking.test.ts packages/agents/src/api/__tests__/nonBreaking.exports.test.ts 2>/dev/null | awk -F: '{s+=$2} END{print s+0}')"
test "$IDENTITY_HITS" -eq 0 || { echo "FAIL: identity assertions still present ($IDENTITY_HITS hits)"; exit 1; }

# Root DENY assertions added (fail-closed — at least one required)
DENY_HITS="$(grep -rc "toBeUndefined\|deny" packages/agents/src/api/__tests__/publicSurface.nonbreaking.test.ts packages/agents/src/api/__tests__/nonBreaking.exports.test.ts 2>/dev/null | awk -F: '{s+=$2} END{print s+0}')"
test "$DENY_HITS" -ge 1 || { echo "FAIL: no root DENY assertions added"; exit 1; }

# Disambiguation audit evidence (finding 7) — each symbol has a decision (fail-closed)
test -f project-plans/issue2285/analysis/disambiguation-audit.md || { echo "FAIL: disambiguation-audit.md missing"; exit 1; }
test "$(grep -c "AgenticLoopMessage\|ApprovalHandler\|CompressionResult" project-plans/issue2285/analysis/disambiguation-audit.md)" -ge 3 || { echo "FAIL: disambiguation audit missing symbol decisions"; exit 1; }
```

## Disambiguation Export Audit (architect finding 7)

Create or update
`project-plans/issue2285/analysis/disambiguation-audit.md` with the
three-evidence trail for EACH disambiguation export:

| Symbol | In api/index.ts? | In depolluted root snapshot? | In dist/index.d.ts? | Decision | Evidence |
|--------|-------------------|------------------------------|---------------------|----------|----------|
| `AgenticLoopMessage` | ... | ... | ... | remove/retain | ... |
| `ApprovalHandler` | ... | ... | ... | remove/retain | ... |
| `CompressionResult` | ... | ... | ... | remove/retain | ... |

NO symbol may be removed without this evidence trail.

## Deferred Implementation Detection (revision 3 — finding 4: scoped to phase-owned files; architect review finding 6: pre-phase baseline)

**Architect review finding 6:** deferred-language scans that grep whole
issue-owned files can fail on pre-existing debt. Use a pre-phase baseline so
only NEWLY INTRODUCED TODO/FIXME/HACK/STUB/TEMPORARY/placeholder/for-now debt
causes a failure.

```bash
# Architect review finding 6: capture the pre-phase baseline before any edits.
P05_FILES="packages/agents/src/index.ts packages/agents/src/api/__tests__/publicSurface.nonbreaking.test.ts packages/agents/src/api/__tests__/nonBreaking.exports.test.ts packages/agents/src/api/__tests__/publicSurface.guard.test.ts"
BASELINE_FILE="$(mktemp)"
grep -rn -E "(TODO|FIXME|HACK|STUB|TEMPORARY|placeholder|for now)" $P05_FILES > "$BASELINE_FILE" 2>/dev/null || true

# ... (phase edits happen here) ...

# Post-phase: fail ONLY on newly introduced deferred language (diff vs baseline)
POST_FILE="$(mktemp)"
grep -rn -E "(TODO|FIXME|HACK|STUB|TEMPORARY|placeholder|for now)" $P05_FILES > "$POST_FILE" 2>/dev/null || true
NEW_DEFERRED="$(diff "$BASELINE_FILE" "$POST_FILE" | grep '^>' || true)"
test -z "$NEW_DEFERRED" || { echo "FAIL: newly introduced deferred language:"; echo "$NEW_DEFERRED"; rm -f "$BASELINE_FILE" "$POST_FILE"; exit 1; }
rm -f "$BASELINE_FILE" "$POST_FILE"
echo "OK: no newly introduced deferred language (pre-existing baseline tolerated)"
```

## Success Criteria
- `export * from './internals.js'` removed from root.
- API-surface guard GREEN in deny mode via the standalone
  `lint:agents-api-surface` script (revision 3 finding 3; DENY names absent,
  snapshot matches depolluted surface, export-star resolution confirms no
  transitive leak).
- FULL repo typecheck passes — no cross-package breakage (P04 migrated consumers).
- Agents package typecheck + tests pass.
- Identity assertions surgically removed and replaced with root DENY assertions.
- `createTaskToolRegistration` retained as curated root export (decision recorded).
- Disambiguation exports audited with three-evidence trail per symbol (finding 7).
- API guard build constraints satisfied (findings 1, 8, 20).
- No marker comment churn in production source (finding 5).
- No deferred language (scoped — finding 4), no lint loosening.

## Failure Recovery

This phase does NOT use `git checkout` rollback for failure recovery. Instead:
- If the deny-flip fails (guard still detects a leak): the root depollution is
  incomplete — re-audit `index.ts` for any remaining internals re-export.
- If cross-package typecheck fails: P04 consumer migration was incomplete —
  return to P04 and fix the specific consumer that still imports from root.
  Do NOT re-add `export * from './internals.js'` as a workaround.
- If the snapshot does not match: regenerate via the explicit developer step.
- If agents tests fail: fix the surgical test updates.
- Report any blocking issue to the coordinator.

## Phase Completion Marker
Create `project-plans/issue2285/.completed/P05.md`.


The marker MUST contain structured diff evidence per the Standard Completion
Marker Template in `overview.md` (architect finding 8): files changed
(`git diff --name-only` of phase-owned files), diff stats (`git diff --stat`),
command outputs (exit status + key output), and tracker evidence (gate items
satisfied + verifier evidence).
