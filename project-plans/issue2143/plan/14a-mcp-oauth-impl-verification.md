<!-- @plan:PLAN-20260622-COREAPIGAP.P14a @requirement:REQ-006 -->
# Phase 14a: MCP OAuth + details — Pseudocode-Compliance Verification

## Phase ID

`PLAN-20260622-COREAPIGAP.P14a`

## LLxprt Code Subagent: architect

## Prerequisites

- Required: Phase 14 completed (PASS)
- Verification: `test -f project-plans/issue2143/.completed/P14.md`

## Purpose

Independent gate. Confirm the P14 implementation matches `analysis/pseudocode/mcp-oauth.md`
line-by-line, preserves the existing `AgentMcpControl` surface + the existing `refresh` signature
(non-breaking REQ-009), is delegate-only (no cache), is undefined-safe, enforces the OAuth
orchestration ordering + error propagation, gives `refresh` AND `authenticate` setTools parity, projects
prompts/resources to named-field-only public types (no raw leak), binds `MCPOAuthProvider` ONLY in the
wiring (never imported into the control), and that the P13 tests are genuinely behavioral (observable
callLog ordering — no mock theater, ≥30% property, no reverse tests).

## Verification Commands

```bash
set -o pipefail
set -e
A=packages/agents/src/api/agent.ts
M=packages/agents/src/api/control/mcpControl.ts
I=packages/agents/src/api/agentImpl.ts
F=packages/agents/src/api/__tests__/mcpOAuth.behavior.test.ts

# 1. Target test + whole dir GREEN.
npx vitest run "$F" 2>&1 | tail -30
npx vitest run packages/agents/src/api/__tests__/ > /tmp/p14a_all.log 2>&1 || { echo "FAIL: regressions"; tail -60 /tmp/p14a_all.log; exit 1; }

# 2. Project typecheck + lint clean.
npm run typecheck 2>&1 | tail -15
npm run lint 2>&1 | tail -15

# 3. Non-breaking: existing six members + existing refresh signature intact.
for m in "listServers" "status" "toolsByServer" "auth" "discoveryState" "refresh"; do
  grep -qE "$m" "$A" || { echo "FAIL: existing AgentMcpControl member $m missing"; exit 1; }
done
grep -qE "refresh\(server\?: string\): Promise<void>" "$A" || { echo "FAIL: refresh signature changed"; exit 1; }

# 4. Ordering + propagation + parity (static structural checks).
#    authenticate: performOAuth BEFORE restartServer BEFORE refreshClientTools.
awk '/async authenticate\(/{f=1}
     f&&/performOAuth\(/{o=NR}
     f&&/restartServer\(/{r=NR}
     f&&/refreshClientTools\(/{t=NR}
     /^  }/{if(f){f=0}}
     END{ if(o>0 && r>0 && t>0 && o<r && r<t) exit 0; else exit 1 }' "$M" \
  || { echo "FAIL: authenticate ordering (oauth<restart<setTools) not satisfied"; exit 1; }

#    authenticate must NOT wrap performOAuth in try/catch (errors propagate).
awk '/async authenticate\(/{f=1} f&&/try[[:space:]]*\{/{c=1} /^  }/{if(f){f=0}} END{exit c?1:0}' "$M" \
  || { echo "FAIL: authenticate swallows errors (try/catch present)"; exit 1; }

#    refresh has setTools parity.
awk '/async refresh\(/{f=1} f&&/refreshClientTools/{ok=1} /^  }/{if(f){f=0}} END{exit ok?0:1}' "$M" \
  || { echo "FAIL: refresh lacks setTools parity"; exit 1; }

# 5. MCPOAuthProvider bound ONLY in wiring, never imported into the control.
if grep -nE "MCPOAuthProvider" "$M"; then echo "FAIL: control references MCPOAuthProvider directly"; exit 1; fi
grep -qE "import \{ MCPOAuthProvider \} from '@vybestack/llxprt-code-core'" "$I" || { echo "FAIL: wiring import missing"; exit 1; }
grep -qE "performOAuth:.*MCPOAuthProvider\.authenticate" "$I" || { echo "FAIL: performOAuth not bound to static in wiring"; exit 1; }

# 6. Markers + delegation; no cache.
grep -qE "@pseudocode lines 1-16" "$M" || { echo "FAIL: authenticate marker"; exit 1; }
grep -qE "@pseudocode lines 30-41" "$M" || { echo "FAIL: refresh marker"; exit 1; }
grep -qE "@pseudocode lines 50-78" "$M" || { echo "FAIL: details marker"; exit 1; }
if grep -nE "private .*(cachedDetails|serverCache|mcpCache)\b" "$M"; then echo "FAIL: cached state"; exit 1; fi

# 7. No raw prompt/resource leak: details projects named fields only.
if grep -nE "getAllResources\(\)\s*;?\s*$" "$M" | grep -v "map("; then : ; fi  # informational

# 8. Re-audit P13 tests are behavioral.
if grep -nE "toHaveBeenCalled|mockResolvedValue|mockReturnValue|vi\.fn\(|vi\.spyOn" "$F"; then echo "FAIL: mock theater"; exit 1; fi
if grep -nE "not\.toThrow\(\)" "$F"; then echo "FAIL: reverse test"; exit 1; fi
grep -qE "callLog" "$F" || { echo "FAIL: observable ordering seam missing in tests"; exit 1; }
TOTAL=$(grep -cE "(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(|(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$F" || true)
PROP_CASE_FORMS=$(grep -cE "(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$F" || true)
CLASSIC_PROP_BLOCKS=$(awk '/(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(/ { blk++; counted[blk]=0 } /fc\.assert|fc\.property/ { if (blk>0 && counted[blk]==0) { counted[blk]=1; n++ } } END { print n+0 }' "$F")
PROP=$(( PROP_CASE_FORMS + CLASSIC_PROP_BLOCKS ))
PCT=$(( PROP * 100 / TOTAL ))
echo "property CASES: $PROP / $TOTAL = ${PCT}%"
[ "$PROP" -ge 2 ] && [ "$PCT" -ge 30 ] || { echo "FAIL: property gate"; exit 1; }

# 9. Deferred scan on changed lines.
for X in "$A" "$M" "$I"; do
  git diff HEAD -- "$X" | grep -E "^\+" | grep -vE "^\+\+\+" \
    | grep -nE "(TODO|FIXME|HACK|STUB|placeholder|for now|in a real)" \
    && { echo "FAIL: deferred marker in $X"; exit 1; } || true
done
echo "PASS: gates green."
```

### Line-by-Line Compliance Table (fill in, fold into marker)

| Pseudocode lines | Method | Implemented at (file:line) | Matches? |
| --- | --- | --- | --- |
| 1-16 | authenticate (unknown/unwired guard; oauthConfig+url; performOAuth→restart→refreshClientTools; propagate) | mcpControl.ts:___ | |
| 30-41 | refresh (existing restart + NEW refreshClientTools parity; undefined-safe) | mcpControl.ts:___ | |
| 50-78 | details (opts gating; per-server projection; named-field prompts/resources; blockedServers) | mcpControl.ts:___ | |
| Dependencies/wiring | six closures wired; performOAuth→MCPOAuthProvider.authenticate(...,undefined) | agentImpl.ts:___ | |

## Holistic Functionality Assessment (MANDATORY — into marker)

- **What was implemented**: `authenticate` (real injected OAuth flow), `refresh` setTools parity,
  `details` deep projection on `AgentMcpControl`/`McpControl`; six injected closures + wiring.
- **Satisfies REQ-006?**: ordering auth→restart→setTools enforced; error propagation (no try/catch);
  refresh+authenticate both re-publish tools; details gates + projects named fields only; existing
  members + refresh signature intact?
- **Data flow**: live `this.deps` closures every call; `MCPOAuthProvider` bound only in wiring; no cache?
- **Security**: no raw `DiscoveredMCPPrompt`/`MCPResource` leak; tokens never surfaced (OAuth side-effect
  only)?
- **Risks**: undefined-safety on all six closures; any ordering regression; any import of the static into
  the control.
- **Verdict**: PASS/FAIL with file:line evidence.

## Success Criteria

- All gates pass; compliance table complete; non-breaking confirmed; ordering + parity + propagation
  proven; holistic verdict PASS.

## Phase Completion Marker

Create: `project-plans/issue2143/.completed/P14a.md` including the completed compliance table + holistic
assessment.
