<!-- @plan:PLAN-20260622-MCPOAUTHTRUTH.P06a @requirement:REQ-002,REQ-003,REQ-004,REQ-INT-001,REQ-INT-002 -->
# Phase 06a — Agents Projection: Implementation Verification (BLIND GATE)

Plan ID: PLAN-20260622-MCPOAUTHTRUTH
Phase: P06a (verification)

## LLxprt Code Subagent: architect

You are an independent reviewer. Review this implementation as if for the FIRST
time. Reproduce every claim against source. Do NOT rubber-stamp. If any BLOCKING
check fails, the verdict is FAIL and you record exactly what failed with file:line.

## Prerequisites

- `test -f project-plans/issue2165/.completed/P06.md`.
- Read in full (independently): `agents-projection.md` (sections A–F), the four
  modified production files, and BOTH behavioral suites
  (`mcpProjection.behavior.test.ts`, `mcpOAuth.behavior.test.ts`).

## Automated Verification (BLOCKING — run from repo root)

```bash
set -o pipefail
set -e
AGENT="packages/agents/src/api/agent.ts"
CTRL="packages/agents/src/api/control/mcpControl.ts"
WIRE="packages/agents/src/api/control/mcpControlWiring.ts"
IDX="packages/agents/src/api/index.ts"

# A) both behavioral suites + whole agents api dir GREEN
npx vitest run packages/agents/src/api/__tests__/mcpProjection.behavior.test.ts > /tmp/v06_proj.log 2>&1 || { echo FAIL proj; tail -40 /tmp/v06_proj.log; exit 1; }
npx vitest run packages/agents/src/api/__tests__/mcpOAuth.behavior.test.ts > /tmp/v06_oauth.log 2>&1 || { echo FAIL oauth; tail -40 /tmp/v06_oauth.log; exit 1; }
npx vitest run packages/agents/src/api/__tests__/ > /tmp/v06_dir.log 2>&1 || { echo FAIL dir; tail -40 /tmp/v06_dir.log; exit 1; }

# B) typecheck + lint clean (serially)
npm run typecheck > /tmp/v06_tc.log 2>&1 || { echo FAIL typecheck; tail -40 /tmp/v06_tc.log; exit 1; }
npm run lint > /tmp/v06_lint.log 2>&1 || { echo FAIL lint; tail -40 /tmp/v06_lint.log; exit 1; }

# C) non-breaking: every PRE-EXISTING public field name still present
for name in "server:" "authenticated:" "requiresAuth:" "authUrl?:" "name:" "tools?:" "prompts?:" "resources?:"; do
  grep -q "$name" "$AGENT" || { echo "FAIL: pre-existing field '$name' missing from agent.ts"; exit 1; }
done
grep -qE "export type \{ McpOAuthStatus \}" "$AGENT" || { echo "FAIL: McpOAuthStatus type re-export"; exit 1; }
grep -q "McpOAuthStatus," "$IDX" || { echo "FAIL: barrel type surface"; exit 1; }

# D) derivation + DRY + no fabrication
grep -q "buildAuthStatus" "$CTRL" || { echo "FAIL: shared buildAuthStatus missing"; exit 1; }
grep -q "oauthStatus === 'authenticated'" "$CTRL" || { echo "FAIL: derived authenticated"; exit 1; }
if grep -nE "requiresAuth:\s*true" "$CTRL"; then echo "FAIL: hardcoded requiresAuth:true remains"; exit 1; fi
# auth() + both authenticate() exits delegate to buildAuthStatus (>=3 call sites)
CALLS=$(grep -cE "this\.buildAuthStatus\(" "$CTRL")
echo "buildAuthStatus call sites=$CALLS"
[ "$CALLS" -ge 3 ] || { echo "FAIL: expected >=3 buildAuthStatus delegations (auth + 2 authenticate exits)"; exit 1; }

# E) R-ASYNC-DETAIL: up-front resolve; buildServerDetail stays sync
grep -q "Promise.all" "$CTRL" || { echo "FAIL: details() not resolving up-front"; exit 1; }
awk '/private[ ]+buildServerDetail/{ if ($0 ~ /async/){ print "FAIL: buildServerDetail async"; exit 1 } }' "$CTRL"

# F) R-NO-REDERIVE / R-CORE-BARREL-SEAM: agents never re-derives expiry nor deep-imports mcp
if grep -nE "isTokenExpired|MCPOAuthTokenStorage|getToken\(|EXPIRY_BUFFER" "$CTRL" "$WIRE"; then
  echo "FAIL: agents re-derives token/expiry instead of delegating"; exit 1
fi
if grep -nE "from '@vybestack/llxprt-code-mcp" "$CTRL" "$WIRE" "$AGENT"; then echo "FAIL: deep mcp import"; exit 1; fi
grep -q "from '@vybestack/llxprt-code-core'" "$WIRE" || { echo "FAIL: wiring not via core barrel"; exit 1; }

# G) R-DELEGATE: no cached oauth state
if grep -nE "this\.(oauthStatus|cachedStatus|_status)\s*=" "$CTRL"; then echo "FAIL: cached state"; exit 1; fi

# H) RE-AUDIT the P05 tests are behavioral (no mock theater / reverse / any)
PF="packages/agents/src/api/__tests__/mcpProjection.behavior.test.ts"
if grep -nE "toHaveBeenCalled|mockResolvedValue|mockReturnValue|vi\.fn\(|vi\.spyOn|toThrow\('NotYetImplemented'\)|not\.toThrow\(|\bas any\b|: any\b" "$PF"; then
  echo "FAIL: P05 tests contain banned patterns"; exit 1
fi
TOTAL=$(grep -cE "^\s*it\(" "$PF"); PROP=$(grep -cE "fc\.assert\(" "$PF")
echo "P05 TOTAL=$TOTAL PROP=$PROP"
[ "$PROP" -ge 2 ] || { echo "FAIL: <2 property tests"; exit 1; }
awk -v p="$PROP" -v t="$TOTAL" 'BEGIN{ if (t==0 || (p*100)/t < 30){ print "FAIL: property < 30%"; exit 1 } }'

# I) deferred scan on changed lines
for f in "$AGENT" "$IDX" "$CTRL" "$WIRE"; do
  if git diff HEAD -- "$f" | grep -nE "^\+.*(TODO|FIXME|HACK|STUB|placeholder|for now)"; then echo "FAIL: deferred in $f"; exit 1; fi
done
echo "PASS: P06a automated gates green."
```

## Non-Vacuity Probe (REQUIRED — prove the suite catches the defect)

Temporarily revert the derivation in `mcpControl.ts` (change
`oauthStatus === 'authenticated'` back to the in-session `isMcpAuthenticated(server)`
read in `buildAuthStatus`), run `mcpProjection.behavior.test.ts`, and CONFIRM it goes
RED (independence + parity cases fail). Then restore byte-identically and confirm
GREEN again. Record both outcomes. If the suite stays GREEN under the reverted
derivation, the tests are vacuous ⇒ FAIL.

## Line-by-Line Compliance Table (REQUIRED — fold into the marker)

Fill this from the ACTUAL source you read (not from the impl doc):

| Pseudocode (agents-projection.md) | Method / Field | Implemented at file:line | Matches? |
| --- | --- | --- | --- |
| A 01-04 (deps additions) | `getOAuthStatus?` / `getRequiresAuth?` | mcpControl.ts:___ | |
| B 10-19 (buildAuthStatus + auth) | `buildAuthStatus` / `auth()` | mcpControl.ts:___ | |
| C 20-36 (authenticate exits) | both `authenticate()` returns | mcpControl.ts:___ | |
| D 40-62 (up-front resolve) | `details()` Promise.all | mcpControl.ts:___ | |
| D 63-72 (sync builder + 7th arg) | `buildServerDetail` | mcpControl.ts:___ | |
| E 80-93 (wiring closures) | `getOAuthStatus`/`getRequiresAuth` | mcpControlWiring.ts:___ | |
| F 93-96 (types + barrel) | `McpServerAuthStatus`/`McpServerDetail`/re-export | agent.ts:___ / index.ts:___ | |

## Holistic Functionality Assessment (MANDATORY — narrative, with file:line)

Write a prose assessment covering ALL of:

- **What was implemented** — describe the projection in your own words from reading
  the source (the shared `buildAuthStatus`, the up-front `Promise.all` in
  `details()`, the corrected derivation, the wiring closures).
- **Does it satisfy REQ-002/003/004 + REQ-INT-001/002?** — cite the file:line that
  makes each true (derived `authenticated`; real `requiresAuth`; new `oauthStatus`
  + `sessionAuthenticated`; agents delegates to the engine helper; session vs
  persisted independent).
- **Data flow** — trace one `auth()` call and one `details()` call from
  `mcpControlWiring` closures → `getMcpServerOAuthStatus` → projection → public field.
- **Security** — confirm NO token string / credential object / raw expiry crosses the
  boundary; only the `McpOAuthStatus` enum + booleans are exposed (R-MASKED).
- **Risks / edge cases** — undefined closures, empty config map, `performOAuth`
  rejection propagation, Promise-leak avoidance in detail fields.
- **Verdict: PASS or FAIL** — with the specific file:line evidence that decided it.

A verdict without the table AND the narrative (with real line numbers) is INVALID.

## Completion Marker

Write `project-plans/issue2165/.completed/P06a.md` containing: the filled Line-by-Line
Compliance Table; the non-vacuity probe's RED-then-GREEN outcomes; the full Holistic
Functionality Assessment; and the final PASS/FAIL verdict with file:line evidence.
