<!-- @plan:PLAN-20260622-MCPOAUTHTRUTH.P04a @requirement:REQ-001,REQ-INT-001 -->
# Phase 04a: Engine Helper — Independent Implementation Verification

## Phase ID

`PLAN-20260622-MCPOAUTHTRUTH.P04a`

## LLxprt Code Subagent: architect (BLIND, independent gate)

> Review this as a first-time, clean review. Do not assume prior passes. Reproduce every claim against
> source. Do not rubber-stamp. If anything fails, mark the phase FAILED with file:line evidence.

## Prerequisites

- Required: Phase 04 completed.
- Verification: `test -f project-plans/issue2165/.completed/P04.md`

## Purpose

Independently confirm that `getMcpServerOAuthStatus` is implemented faithfully to
`analysis/pseudocode/oauth-status-helper.md`, satisfies REQ-001 / REQ-INT-001 and all R-codes, is
published correctly from both barrels, is genuinely covered by the P03 behavioral suite (no mock
theater, ≥30% property), and introduces no regressions.

## Verification Commands

```bash
set -o pipefail
set -e
H=packages/mcp/src/auth/oauth-status.ts
F=packages/mcp/src/auth/oauth-status.behavior.test.ts

# 1. Target + dir GREEN.
( cd packages/mcp && npx vitest run src/auth/oauth-status.behavior.test.ts ) > /tmp/p04a_t.log 2>&1 || { tail -60 /tmp/p04a_t.log; echo "FAIL: target test"; exit 1; }
( cd packages/mcp && npx vitest run src/auth ) > /tmp/p04a_dir.log 2>&1 || { tail -80 /tmp/p04a_dir.log; echo "FAIL: dir regression"; exit 1; }

# 2. Build + typecheck (serial; mcp before core).
npm run build > /tmp/p04a_build.log 2>&1 || { tail -60 /tmp/p04a_build.log; echo "FAIL: build"; exit 1; }
npm run typecheck > /tmp/p04a_tc.log 2>&1 || { tail -60 /tmp/p04a_tc.log; echo "FAIL: typecheck"; exit 1; }

# 3. Structural fidelity (independent of P04's own greps).
#    early-return before read:
NR=$(grep -nE "return 'not-required'" "$H" | head -1 | cut -d: -f1)
GT=$(grep -nE "MCPOAuthTokenStorage\.getToken\(" "$H" | head -1 | cut -d: -f1)
EX=$(grep -nE "isTokenExpired\(credentials\.token\)" "$H" | head -1 | cut -d: -f1)
[ "$NR" -lt "$GT" ] && [ "$GT" -lt "$EX" ] || { echo "FAIL: order must be not-required < getToken < isTokenExpired"; exit 1; }
#    never throws / never leaks a credential / proper typing:
if grep -nE "throw " "$H"; then echo "FAIL: helper throws"; exit 1; fi
if grep -nE "return (credentials|token|credentials\.token)\b" "$H"; then echo "FAIL: leaks credential"; exit 1; fi
if grep -nE "as never|as any|:\s*any\b" "$H"; then echo "FAIL: improper typing"; exit 1; fi
#    fault path → 'none':
awk '/catch/{c=1} c&&/return .none./{f=1} END{exit f?0:1}' "$H" || { echo "FAIL: catch must return 'none'"; exit 1; }

# 4. Barrel publication (mcp auth + root + core value/type).
grep -qE "export \{ getMcpServerOAuthStatus \}" packages/mcp/src/auth/index.ts || { echo "FAIL: auth barrel value"; exit 1; }
grep -qE "export type \{ McpOAuthStatus \}" packages/mcp/src/auth/index.ts || { echo "FAIL: auth barrel type"; exit 1; }
node -e "import('@vybestack/llxprt-code-mcp').then(m=>{if(typeof m.getMcpServerOAuthStatus!=='function'){console.error('FAIL: mcp root does not surface helper');process.exit(1)}console.log('mcp root OK')}).catch(e=>{console.error(e);process.exit(1)})"
node -e "import('@vybestack/llxprt-code-core').then(m=>{if(typeof m.getMcpServerOAuthStatus!=='function'){console.error('FAIL: core barrel does not surface helper');process.exit(1)}console.log('core barrel OK')}).catch(e=>{console.error(e);process.exit(1)})"

# 5. Re-audit the P03 suite is BEHAVIORAL (no mock theater) and property-gated.
if grep -nE "toHaveBeenCalled|vi\.fn\(|vi\.spyOn|mockResolvedValue|mockReturnValue" "$F"; then echo "FAIL: mock theater in test"; exit 1; fi
grep -qE "setTokenStore" "$F" || { echo "FAIL: test not using real storage seam"; exit 1; }
TOTAL=$(grep -cE "(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(|(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$F" || true)
PROP_CASE_FORMS=$(grep -cE "(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$F" || true)
CLASSIC=$(awk '/(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(/{b++;c[b]=0} /fc\.assert|fc\.property/{if(b>0&&c[b]==0){c[b]=1;n++}} END{print n+0}' "$F")
PROP=$(( PROP_CASE_FORMS + CLASSIC ))
PCT=$(( PROP * 100 / TOTAL ))
echo "property: $PROP / $TOTAL = ${PCT}%"
[ "$PROP" -ge 2 ] && [ "$PCT" -ge 30 ] || { echo "FAIL: property gate"; exit 1; }

# 6. Deferred scan on changed production lines.
git diff HEAD -- "$H" | grep -nE "^\+.*(TODO|FIXME|HACK|placeholder|for now|NotYetImplemented)" && { echo "FAIL: deferred marker"; exit 1; } || true
echo "P04a automated checks PASS."
```

## Line-by-Line Compliance Table (fill from source; fold into the marker)

| Pseudocode (oauth-status-helper.md) | Implemented at `oauth-status.ts:line` | Matches? |
|---|---|---|
| 03 `hintRequires = opts?.requiresOAuth === true` | | |
| 04 `runtimeRequires = mcpServerRequiresOAuth.get(name) === true` | | |
| 05-08 `required` OR-combine; early `return 'not-required'` (no storage read) | | |
| 11-15 `try { getToken } catch { return 'none' }` | | |
| 17-19 `null/undefined ⇒ 'none'` | | |
| 22 `isTokenExpired(credentials.token)` | | |
| 23-27 `expired ⇒ 'expired' else 'authenticated'` | | |
| barrels | auth/index.ts + core/src/index.ts value+type | |

## MANDATORY Holistic Functionality Assessment (prose — REQUIRED)

Address each, citing `file:line`:

- **What was implemented** — describe the helper's actual control flow as written.
- **Does it satisfy REQ-001 / REQ-INT-001?** — map the five-row truth table to real branches; confirm
  reference-parity order with the CLI (`mcpDisplay.ts:69-115`).
- **Data flow** — trace `serverName/opts → requires decision → getToken → isTokenExpired(token) →
  enum`. Confirm no `Promise` leaks and no credential leaves the function.
- **Security/masking** — confirm only the enum crosses; no token/credential is returned/logged.
- **Undefined-safety / fault-tolerance** — confirm storage throw and `null` both map to `'none'`, and
  the function cannot throw.
- **Risks / regressions** — note anything that could affect existing `auth` consumers; confirm the
  barrels add (not change) exports.
- **Verdict** — PASS or FAIL with the deciding evidence (`file:line`).

## Failure Recovery

- If any check fails, write a FAILED marker enumerating the exact gap(s); P04 must be reworked before
  P05.

## Phase Completion Marker

Create: `project-plans/issue2165/.completed/P04a.md`

```markdown
Phase: P04a
Completed: YYYY-MM-DD HH:MM
Verdict: PASS | FAIL
Automated checks: [paste actual output]
Line-by-Line Compliance Table: [filled with real file:line]
Holistic Functionality Assessment: [the full prose, with file:line evidence]
```
