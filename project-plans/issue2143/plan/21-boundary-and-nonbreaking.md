<!-- @plan:PLAN-20260622-COREAPIGAP.P21 @requirement:REQ-INT-005 -->
# Phase 21: No-Deep-Import Boundary (whole new surface)

## Phase ID

`PLAN-20260622-COREAPIGAP.P21`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 20a completed (PASS)
- Verification: `test -f project-plans/issue2143/.completed/P20a.md`

## Requirements Implemented (Expanded)

### REQ-INT-005: No-deep-import boundary — the #1595 mission, enforced across the whole new set

**Full Text**: Every new capability MUST be reachable using ONLY the public root
`@vybestack/llxprt-code-agents`. The public-consumer path (the `.spec.ts` adequacy/boundary surface,
and the eventual #1595 production CLI) MUST NOT import `./internals.js`, any other
`@vybestack/llxprt-code-agents/<subpath>`, `/dist/`, or any deep `core/`, `providers/`, `tools/`,
`auth/`, `settings/`, `ide-integration/`, `policy/` path. The NEW production source files (the three
new controls + the extended controls + barrel + command-map) may import the CORE BARREL
`@vybestack/llxprt-code-core` (the documented adapter seam) but MUST NOT introduce a NEW deep
`core/src`/`providers/src` path.
**Behavior**:
- GIVEN: the full set of files this plan added/changed
- WHEN: the boundary is scanned
- THEN: no public-consumer `.spec.ts` deep-imports anything; the new production controls reach core
  only through the `@vybestack/llxprt-code-core` barrel (never `core/src/...`); and the T17 guard
  (`boundary.spec.ts`) is GREEN with the new `.spec.ts` files in its scan scope
**Why This Matters**: deep imports are exactly what #1595 must eliminate. The adequacy driver (P20)
proves ONE file is clean; this phase proves the WHOLE new surface is clean and that the standing T17
guard polices it — so a future regression (a new deep import) is caught automatically.

## Background — verified facts

- `boundary.spec.ts` (the standing T17 guard) scans every `*.spec.ts` under `packages/agents/src/`,
  allowing only: public root `@vybestack/llxprt-code-agents`, `@vybestack/llxprt-code-agents/app-service.js`,
  `node:*`, `vitest`/`vitest/*`, `fast-check`/`fast-check/*`, and relative paths resolving within
  `src/`. It FORBIDS `@vybestack/llxprt-code-agents/internals.js`, any other agents subpath, `/dist/`,
  the seven deep prefixes, and src-escaping relatives. `.test.ts` files are EXEMPT (they may
  deep-import — that is where the per-component `.behavior.test.ts` files live).
- The new adequacy driver `capabilityGaps.integration.spec.ts` (P20) is a `.spec.ts`, so it is
  already in scope. The per-component `.behavior.test.ts` files are `.test.ts`, intentionally exempt.
- The new PRODUCTION controls (`control/policyControl.ts`, `tasksControl.ts`, `toolKeysControl.ts`)
  and the extended controls/agentImpl import core via the `@vybestack/llxprt-code-core` BARREL (the
  same adapter seam the existing controls use), NOT `core/src/...`. This phase pins that.

## Implementation Tasks

### Files to Create

- `packages/agents/src/api/__tests__/capabilityBoundary.adequacy.test.ts` — a STATIC import-scan over
  THIS plan's added/changed files (a `.test.ts`, so it is exempt from T17 itself but encodes the
  REQ-INT-005 contract executably). Marker `@plan:PLAN-20260622-COREAPIGAP.P21
  @requirement:REQ-INT-005`. It MUST:
  - Read (via `node:fs`) the source text of the NEW production files and assert NONE imports a deep
    `core/src`, `providers/src`, `tools/src`, or `policy/src` path (the barrel
    `@vybestack/llxprt-code-core` IS allowed; a `core/src/...` deep path is NOT).
  - Read the adequacy driver `capabilityGaps.integration.spec.ts` and assert it imports ONLY the
    public root + node/vitest/fast-check + `./helpers/agentHarness.js` (mirror the P20 import
    allow-list) and contains no `getConfig`.
  - Assert the production controls reach core through the BARREL: each `control/*Control.ts` that
    touches core imports from `'@vybestack/llxprt-code-core'` (exact specifier), never
    `'@vybestack/llxprt-code-core/...'` deep.
  - **≥30% property-based, MIN-2 cases**, e.g.: (1) property over the list of new production file
    paths: each file's text contains zero deep `core/src|providers/src|tools/src|policy/src` matches;
    (2) property over the list of public-consumer spec file paths: each imports only allow-listed
    specifiers. (Both properties iterate a real `fc.constantFrom(...filePaths)`.)
  - NO mock theater, NO reverse tests, no `any`.

### Files to Modify

- None in production unless the scan reveals a deep-import leak introduced by this plan; if so, route
  the symbol through the `@vybestack/llxprt-code-core` barrel (additive) and record it here.

### Constraints

- The scan enumerates the plan's real changed files; do not hardcode a guessed list — derive it from
  the known new/changed paths (the three new control files, the extended controls `mcpControl.ts`/
  `authControl.ts`/`hooks.ts`/`toolControl.ts`, `agentImpl.ts`, `agent.ts`, `api/index.ts`,
  `app-services/command-api-map.ts`) and the new `.spec.ts` driver.
- This phase does not relax the standing T17 guard; it adds a complementary whole-set scan and proves
  the guard is green.

## Verification Commands

```bash
set -o pipefail
set -e
F=packages/agents/src/api/__tests__/capabilityBoundary.adequacy.test.ts
test -f "$F"

# 1. Standing T17 guard is GREEN with the new .spec.ts driver in scope.
npx vitest run packages/agents/src/api/__tests__/boundary.spec.ts 2>&1 | tail -20

# 2. Whole-package shell boundary scan over the PUBLIC-CONSUMER spec surface: no deep imports
#    anywhere in *.spec.ts (the T17-policed set). (.test.ts is intentionally exempt.)
if grep -rnE "from '[^']*(/src/|core/src|providers/src|tools/src|policy/src)" packages/agents/src/api/__tests__/*.spec.ts 2>/dev/null | grep -vE "node_modules"; then
  echo "FAIL: deep import in a public-consumer .spec.ts"; exit 1
fi
if grep -rnE "from '[^']*internals(\.js)?'" packages/agents/src/api/__tests__/*.spec.ts 2>/dev/null; then
  echo "FAIL: a .spec.ts imports internals (public-consumer path forbidden)"; exit 1
fi

# 3. NEW production controls reach core via the BARREL, never a deep core/src path.
for C in policyControl tasksControl toolKeysControl; do
  P="packages/agents/src/api/control/$C.ts"
  test -f "$P" || { echo "FAIL: missing new control $P"; exit 1; }
  if grep -nE "from '@vybestack/llxprt-code-core/" "$P"; then echo "FAIL: $C deep-imports core (use the barrel)"; exit 1; fi
done
# Extended controls + agentImpl likewise must not introduce a NEW deep core/src path.
for P in packages/agents/src/api/agentImpl.ts packages/agents/src/api/control/mcpControl.ts; do
  if grep -nE "from '@vybestack/llxprt-code-core/src/|from '[^']*core/src/" "$P"; then echo "FAIL: $P deep-imports core/src"; exit 1; fi
done

# 4. The new scan test + whole dir GREEN; typecheck GREEN.
npx vitest run "$F" 2>&1 | tail -25
npx vitest run packages/agents/src/api/__tests__/ > /tmp/p21_all.log 2>&1 || { echo "FAIL: regressions"; tail -60 /tmp/p21_all.log; exit 1; }
npm run typecheck 2>&1 | tail -12

# 5. Property gate + discipline.
TOTAL=$(grep -cE "(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(|(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$F" || true)
PROP_CASE_FORMS=$(grep -cE "(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$F" || true)
CLASSIC_PROP_BLOCKS=$(awk '/(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(/ { blk++; counted[blk]=0 } /fc\.assert|fc\.property/ { if (blk>0 && counted[blk]==0) { counted[blk]=1; n++ } } END { print n+0 }' "$F")
PROP=$(( PROP_CASE_FORMS + CLASSIC_PROP_BLOCKS ))
PCT=$(( PROP * 100 / TOTAL ))
echo "property CASES: $PROP / $TOTAL = ${PCT}%"
[ "$PROP" -ge 2 ] && [ "$PCT" -ge 30 ] || { echo "FAIL: property gate"; exit 1; }
if grep -nE "toHaveBeenCalled|mockResolvedValue|mockReturnValue|vi\.fn\(|vi\.spyOn|not\.toThrow\(\)" "$F"; then echo "FAIL: discipline"; exit 1; fi
echo "PASS: P21 boundary green."
```

### Semantic Verification Checklist

- [ ] Standing T17 `boundary.spec.ts` green with the new `.spec.ts` driver in scope.
- [ ] No public-consumer `.spec.ts` deep-imports or imports internals.
- [ ] New production controls reach core via the `@vybestack/llxprt-code-core` BARREL only (no
      `core/src` deep path).
- [ ] Whole-set static scan test green; ≥30% property; no mock theater.

## Success Criteria

- The whole new surface honors the no-deep-import boundary; the standing guard polices it; scan test
  green.

## Failure Recovery

- Route any leaked deep import through the public root / core barrel (additive); never relax the
  guard or exempt a public-consumer file.

## Phase Completion Marker

Create: `project-plans/issue2143/.completed/P21.md`

```markdown
Phase: P21
Completed: YYYY-MM-DD HH:MM
Files Created: [capabilityBoundary.adequacy.test.ts with line count]
Files Modified: [list or none]
Tests Added: [count]
Verification: [paste actual output incl. boundary.spec.ts green]
Semantic Assessment: [one-line: whole new surface is deep-import-free; T17 guard polices it]
```
