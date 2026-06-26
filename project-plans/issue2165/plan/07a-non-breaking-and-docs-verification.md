<!-- @plan:PLAN-20260622-MCPOAUTHTRUTH.P07a @requirement:REQ-004,REQ-005 -->
# Phase 07a — Non-Breaking Guards + Docs: Verification (BLIND GATE)

Plan ID: PLAN-20260622-MCPOAUTHTRUTH
Phase: P07a (verification)

## LLxprt Code Subagent: architect

Independent first-time review. Reproduce every claim. Do not rubber-stamp.

## Prerequisites

- `test -f project-plans/issue2165/.completed/P07.md`.
- Read independently: the three guard files + `docs/agent-api.md` MCP section, and
  the modified `agent.ts` public shapes (to confirm the docs/anchors match the
  SHIPPED signatures).

## Automated Verification (BLOCKING)

```bash
set -o pipefail
set -e
TYPES="packages/agents/src/api/__tests__/additiveSurface.types.ts"
RUNTIME="packages/agents/src/api/__tests__/publicSurface.nonbreaking.test.ts"
NB="packages/agents/src/api/__tests__/nonBreaking.exports.test.ts"
DOCS="docs/agent-api.md"

# A) anchors + new block present; old anchors/blocks preserved
for a in _mcpOAuthStatusAnchor _mcpAuthShapeAnchor _mcpDetailShapeAnchor; do
  grep -q "$a" "$TYPES" || { echo "FAIL: anchor $a missing"; exit 1; }
done
grep -q "PLAN-20260622-MCPOAUTHTRUTH.P07" "$RUNTIME" || { echo "FAIL: runtime block missing"; exit 1; }
# pre-existing anchors still present (sample a known one — adjust to the real file)
git diff HEAD -- "$TYPES" | grep -E "^-.*_taskInfoAnchor|^-.*void " && { echo "FAIL: an existing anchor was removed/reflowed"; exit 1; } || true

# B) docs additive + public-root-only + nothing removed
grep -q "oauthStatus" "$DOCS" || { echo "FAIL: oauthStatus undocumented"; exit 1; }
grep -q "sessionAuthenticated" "$DOCS" || { echo "FAIL: sessionAuthenticated undocumented"; exit 1; }
if git diff HEAD -- "$DOCS" | grep -E "^-#|^-\`\`\`|^-\| "; then echo "FAIL: docs heading/fence/row removed"; exit 1; fi
# CCF-7: scope the public-root check to ADDED (`^+`) lines only. A whole-file grep
# false-fails on pristine docs: prose at ~:1064 mentions "getConfig() ... or a deep
# import into the core package" while DESCRIBING the anti-pattern, and `agent.getConfig()`
# is itself a DOCUMENTED public method (docs ~:760/:766/:797). Only a NEWLY-ADDED real
# deep-core import statement or a NEWLY-ADDED `.getConfig(` call should fail.
if git diff HEAD -- "$DOCS" | grep -E "^\+" | grep -E "^\+[[:space:]]*import\b.*@vybestack/llxprt-code-core"; then echo "FAIL: docs example adds a deep core import"; exit 1; fi
if git diff HEAD -- "$DOCS" | grep -E "^\+" | grep -E "\.getConfig\("; then echo "FAIL: docs example added a getConfig() call"; exit 1; fi

# C) production untouched this phase
if git diff HEAD --name-only | grep -vE "__tests__/|\.md$" | grep -E "packages/agents/src/"; then
  echo "FAIL: production source modified"; exit 1
fi

# D) guards + typecheck green
npx vitest run "$RUNTIME" > /tmp/v07_rt.log 2>&1 || { echo FAIL runtime; tail -40 /tmp/v07_rt.log; exit 1; }
npx vitest run "$NB" > /tmp/v07_nb.log 2>&1 || { echo FAIL nb; tail -40 /tmp/v07_nb.log; exit 1; }
npm run typecheck > /tmp/v07_tc.log 2>&1 || { echo FAIL typecheck; tail -40 /tmp/v07_tc.log; exit 1; }
echo "PASS: P07a automated gates green."
```

## Non-Vacuity Probe (REQUIRED — reproduce independently)

Delete `oauthStatus` from `McpServerAuthStatus` in `agent.ts`, run `npm run
typecheck`, CONFIRM `additiveSurface.types.ts` fails (`_mcpAuthShapeAnchor` Pick
error). Delete the new runtime describe block's field assertion temporarily and
confirm it would fail if `oauthStatus` were absent. Restore both byte-identically and
confirm green. Record outcomes. If the compile fence does NOT fail when the field is
removed, the anchor is vacuous ⇒ FAIL.

## Holistic Assessment (MANDATORY — narrative with file:line)

- Confirm the additive guarantee: list each pre-existing public MCP field and show it
  is still present (agent.ts:line) and that ONLY new fields/types were added.
- Confirm the docs reflect the SHIPPED semantics (corrected `authenticated`,
  real `requiresAuth`, new quad-state) and that every example is reachable from the
  public root alone (no deep import / no `getConfig`).
- Confirm CCF-6 invariants: anchors live in `.types.ts` (typecheck-visible), are
  void/`export type` consumed, and use top-level `import type`.
- Verdict: PASS / FAIL with file:line evidence.

## Completion Marker

Write `project-plans/issue2165/.completed/P07a.md` with the probe outcomes, the
additive-field inventory, the docs reachability check, and the PASS/FAIL verdict.
