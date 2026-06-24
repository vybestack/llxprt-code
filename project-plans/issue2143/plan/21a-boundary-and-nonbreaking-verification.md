<!-- @plan:PLAN-20260622-COREAPIGAP.P21a @requirement:REQ-INT-005 -->
# Phase 21a: No-Deep-Import Boundary — Verification

## Phase ID

`PLAN-20260622-COREAPIGAP.P21a`

## LLxprt Code Subagent: architect

## Prerequisites

- Required: Phase 21 completed (PASS)
- Verification: `test -f project-plans/issue2143/.completed/P21.md`

## Purpose

Confirm the no-deep-import boundary holds across the WHOLE new surface and that the scan test is
non-vacuous — i.e. it would actually FAIL if a deep import were introduced. Prove the standing T17
guard polices the new `.spec.ts` files, and that the new production controls reach core only through
the documented barrel seam.

## Verification Commands

```bash
set -o pipefail
set -e
F=packages/agents/src/api/__tests__/capabilityBoundary.adequacy.test.ts

# 1. Standing T17 guard green; whole dir green; typecheck green.
npx vitest run packages/agents/src/api/__tests__/boundary.spec.ts 2>&1 | tail -20
npx vitest run "$F" 2>&1 | tail -25
npx vitest run packages/agents/src/api/__tests__/ > /tmp/p21a_all.log 2>&1 || { echo "FAIL: regressions"; tail -60 /tmp/p21a_all.log; exit 1; }
npm run typecheck 2>&1 | tail -12

# 2. NON-VACUITY PROBE: inject a deep import into a NEW control, prove the scan test FAILS, then
#    restore. (Proves the boundary fence has teeth.)
PROBE=packages/agents/src/api/control/policyControl.ts
cp "$PROBE" /tmp/policyControl.bak
# Add a deep core/src import line at the top (syntactically harmless unused import).
printf "%s\n" "import '@vybestack/llxprt-code-core/src/index.js';" | cat - "$PROBE" > /tmp/policyControl.probe && mv /tmp/policyControl.probe "$PROBE"
if npx vitest run "$F" > /tmp/p21a_probe.log 2>&1; then
  echo "FAIL: boundary scan did NOT catch an injected deep import (vacuous)"; cp /tmp/policyControl.bak "$PROBE"; exit 1
fi
cp /tmp/policyControl.bak "$PROBE"   # RESTORE
# Re-confirm green after restore.
npx vitest run "$F" 2>&1 | tail -10
echo "non-vacuity proven: injected deep import was caught; original restored."

# 3. Whole-package shell scan agrees: no deep import / internals in any public-consumer .spec.ts.
if grep -rnE "from '[^']*(/src/|core/src|providers/src|tools/src|policy/src)" packages/agents/src/api/__tests__/*.spec.ts 2>/dev/null | grep -vE "node_modules"; then
  echo "FAIL: deep import in a .spec.ts"; exit 1; fi
if grep -rnE "internals(\.js)?'" packages/agents/src/api/__tests__/*.spec.ts 2>/dev/null; then
  echo "FAIL: .spec.ts imports internals"; exit 1; fi

# 4. New controls use the barrel, not deep core/src.
for C in policyControl tasksControl toolKeysControl; do
  P="packages/agents/src/api/control/$C.ts"
  if grep -nE "from '@vybestack/llxprt-code-core/" "$P"; then echo "FAIL: $C deep-imports core"; exit 1; fi
done
echo "PASS: P21a boundary verification green."
```

## Holistic Assessment (MANDATORY — into marker)

- **Whole-set coverage**: the scan covers ALL of this plan's new/changed files, not just the driver.
- **Non-vacuity proven**: an injected deep import made the scan FAIL; restore returned it to green —
  evidence the fence has teeth (cite the probe output).
- **Barrel seam honored**: the new controls reach core through `@vybestack/llxprt-code-core` only.
- **#1595 boundary verdict**: state explicitly that the public-consumer path (and a future CLI) can
  reach everything via the public root with no deep import. PASS/FAIL.

## Success Criteria

- Guard green; scan test green AND proven non-vacuous; new controls use the barrel; verdict PASS.

## Failure Recovery

- If the probe does NOT fail, the scan is vacuous — fix the scan test (P21) so it genuinely inspects
  the new files; re-run. If a real leak exists, reopen the owning phase.

## Phase Completion Marker

Create: `project-plans/issue2143/.completed/P21a.md` (include the non-vacuity probe output).

```markdown
Phase: P21a
Completed: YYYY-MM-DD HH:MM
Files Created: none
Files Modified: none (verification only; probe file restored)
Verification: [paste actual output incl. non-vacuity probe FAIL-then-restore]
Holistic Assessment: [PASS/FAIL; #1595 boundary verdict; non-vacuity evidence]
```
