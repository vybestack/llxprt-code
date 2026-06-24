<!-- @plan:PLAN-20260622-COREAPIGAP.P13 @requirement:REQ-006 -->
# Phase 13: MCP OAuth + refresh setTools parity + deep details (extend `agent.mcp`) — Behavioral TDD

## Phase ID

`PLAN-20260622-COREAPIGAP.P13`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 12a completed (PASS)
- Verification: `test -f project-plans/issue2143/.completed/P12a.md`
- Pseudocode (for context — DO NOT implement here): `analysis/pseudocode/mcp-oauth.md`

## Requirements Implemented (Expanded)

### REQ-006: OAuth + setTools parity + deep details on `AgentMcpControl`

**Full Text**: EXTEND the existing `AgentMcpControl` (agent.ts:232-239) — keeping its existing
members (`listServers`/`status`/`toolsByServer`/`auth`/`discoveryState`/`refresh`) EXACTLY as-is in
SIGNATURE (REQ-009 non-breaking) — with the real OAuth flow, tool-publish parity, and deep details:

- **REQ-006.1** `authenticate(server): Promise<McpServerAuthStatus>` — the REAL OAuth flow. Orchestrates
  (in this exact order) the injected `performOAuth` → `manager.restartServer(server)` →
  `refreshClientTools()`, then returns `{server, authenticated:true, requiresAuth:true}`. An unknown
  server (or unwired `performOAuth`) is a no-op returning `{authenticated:false, requiresAuth:true}` —
  NO OAuth attempted. A `performOAuth` rejection PROPAGATES (no restart, no setTools) — the control does
  NOT catch (R-MCP-OAUTH-FLOW).
- **REQ-006.2** `refresh(server?)` gains setTools parity: after the existing restart it ALSO calls
  `refreshClientTools()` (R-REFRESH-PARITY). Signature unchanged.
- **REQ-006.3** `details(opts?): Promise<McpDetailStatus>` — deep per-server projection; `includeTools`
  default true, `includePrompts`/`includeResources` default false; projects prompts/resources to
  named-field-only public types; includes `blockedServers`.
- **REQ-006.4** undefined-safe: manager/registries/`performOAuth` absent → no-op / empty projection
  (R-UNDEFINED-SAFE); existing `auth(server)` per-agent-flag read is UNCHANGED.

**Behavior (GIVEN/WHEN/THEN)**:
- GIVEN a configured server `s` + wired `performOAuth` + present manager → `authenticate("s")` records
  the call order `oauth(s) → restart(s) → setTools` and returns `authenticated:true`.
- GIVEN `authenticate("unknown")` (not in configs) → returns `authenticated:false`; `performOAuth` is
  NEVER invoked; no restart/setTools.
- GIVEN `performOAuth` rejects → `authenticate("s")` rejects; restart + setTools are NEVER invoked.
- GIVEN a present manager → `refresh("s")` records `restart(s) → setTools`; `refresh()` records
  `restart-all → setTools`.
- GIVEN `getManager()` returns undefined → `refresh()` is a no-op; `setTools` is NEVER invoked.
- GIVEN two configured servers → `details()` returns two `servers` each with `tools`, no
  `prompts`/`resources`; `details({includePrompts:true})` adds projected prompts;
  `details({includeResources:true})` adds resources filtered by server; undefined configs → empty
  `servers`.

## Implementation Tasks

### Files to Create

- `packages/agents/src/api/__tests__/mcpOAuth.behavior.test.ts`

  `.behavior.test.ts` is **T17-exempt**, so it MAY deep-import the control + core types. Use the BLESSED
  direct-construction precedent `new McpControl(deps)` (mirrors `mcp-discovery.spec.ts` /
  `helpers/fakeMcpManager.ts`). Drive REAL ordering through observable closures — **NOT mock theater**:

  1. **Observable-order deps (the no-mock-theater seam).** Build a local helper in the test that creates
     an `McpControlDeps`-shaped object closing over a shared `callLog: string[]`:
     - `performOAuth: async (server) => { callLog.push('oauth:' + server); }` (a variant that rejects:
       `async () => { callLog.push('oauth:attempt'); throw new Error('oauth boom'); }`)
     - `getManager: () => fakeManager` where `fakeManager = { restartServer: async (n) => { callLog.push('restart:' + n); }, restart: async () => { callLog.push('restart-all'); } } as unknown as McpClientManager`
       (or `() => undefined` for the undefined-safe case)
     - `refreshClientTools: async () => { callLog.push('setTools'); }`
     - `getServerConfigs: () => ({ s: fakeServerConfig({ oauth: { enabled: true }, httpUrl: 'https://x' }) })`
       (reuse `fakeServerConfig` from `helpers/fakeMcpManager.ts`)
     - `getBlockedServers`, `getPromptRegistry`, `getResourceRegistry`, `isMcpAuthenticated`,
       `getToolRegistry` as real small projections for the details tests.
     Because the NEW closures are not yet on `McpControlDeps` at RED, construct via
     `new McpControl(deps as unknown as McpControlDeps)` (RED-note cast — removed in P14). Asserting on
     the ORDER/CONTENT of `callLog` is behavioral (mirrors `fakeMcpManager.restartedServers()`), never
     `toHaveBeenCalled`.
  2. **authenticate order (T14)** — success path: assert `callLog` deep-equals
     `['oauth:s', 'restart:s', 'setTools']` AND the returned status is `{server:'s', authenticated:true,
     requiresAuth:true}`.
  3. **authenticate unknown server (T14b)** — `authenticate('nope')` returns `authenticated:false`;
     `callLog` is empty (performOAuth NEVER ran).
  4. **authenticate propagation (T14c)** — with the rejecting `performOAuth`, `await expect(
     control.authenticate('s')).rejects.toThrow('oauth boom')`; `callLog` contains `'oauth:attempt'` but
     NOT `'restart:s'` and NOT `'setTools'`.
  5. **refresh parity (T15)** — `refresh('s')` → `callLog` deep-equals `['restart:s', 'setTools']`;
     `refresh()` (no arg) → `['restart-all', 'setTools']`.
  6. **refresh undefined-safe (T16)** — deps with `getManager: () => undefined` → `refresh()` resolves
     and `callLog` is empty (`setTools` NOT called).
  7. **details projection (T-details)** — two configured servers + a real tool registry view → `details()`
     yields two `servers`, each `tools` defined, `prompts`/`resources` undefined; `blockedServers`
     mirrors `getBlockedServers()`. `details({includePrompts:true})` → each server has projected
     `prompts` (named-field-only). `details({includeResources:true})` → resources filtered by
     `serverName`. `getServerConfigs:()=>undefined` → `servers` is `[]`.

  - Markers `@plan:PLAN-20260622-COREAPIGAP.P13`, `@requirement:REQ-006`.

### Required scenarios

```
T14    authenticate('s') success → callLog === ['oauth:s','restart:s','setTools']; returns
       {server:'s', authenticated:true, requiresAuth:true}
T14b   authenticate('nope') (not in configs) → returns authenticated:false; callLog === [] (no OAuth)
T14c   performOAuth rejects → authenticate('s') rejects('oauth boom'); callLog has 'oauth:attempt' but
       NOT 'restart:s' and NOT 'setTools'
T15    refresh('s') → callLog === ['restart:s','setTools']; refresh() → ['restart-all','setTools']
T16    getManager()===undefined → refresh() resolves; callLog === [] (setTools NOT called)
Td1    details() (2 servers) → servers length 2; each tools defined; prompts/resources undefined;
       blockedServers mirrors getBlockedServers()
Td2    details({includePrompts:true}) → each server.prompts projected {name,description}; 
       details({includeResources:true}) → each server.resources filtered by serverName, projected
       {name?,uri}
Td3    getServerConfigs()===undefined → details().servers === []
PROP   for generated names NOT in a fixed config set, authenticate(name) → authenticated:false and
       callLog stays [] (performOAuth never runs); MIN-2 cases
PROP   for generated server names present in configs, authenticate(name) → callLog ===
       ['oauth:'+name,'restart:'+name,'setTools'] and returns authenticated:true; MIN-2 cases
PROP   for a generated config map (1..4 servers), details().servers length === number of config keys
       and every server.name is a config key; MIN-2 cases
```

### Constraints

- Assert real VALUES (callLog order/content, returned status fields, projected arrays) — NEVER
  `toHaveBeenCalled`, NEVER `vi.fn()`/`vi.spyOn`/`mockResolvedValue`.
- The observable closures record into a shared array (behavioral ordering seam) — this is the SAME
  no-mock-theater idiom `helpers/fakeMcpManager.ts` already uses (`restartedServers()`).
- Existing `AgentMcpControl` members (`listServers`/`status`/`toolsByServer`/`auth`/`discoveryState`)
  MUST remain callable (do not assert their removal).
- ≥30% property-based (fast-check), MIN-2 distinct property cases.
- RED is behavioral: `authenticate`/`details` do not exist on `McpControl` yet (missing-method
  TypeError), and `refresh` lacks the `setTools` step so the parity assertion fails on VALUE.

## Verification Commands

```bash
set -o pipefail
set -e
F=packages/agents/src/api/__tests__/mcpOAuth.behavior.test.ts
test -f "$F"

if grep -nE "toHaveBeenCalled" "$F"; then echo "FAIL: mock theater"; exit 1; fi
if grep -nE "mockResolvedValue|mockReturnValue|vi\.spyOn|vi\.fn\(" "$F"; then echo "FAIL: mock theater (spy/stub)"; exit 1; fi
if grep -nE "not\.toThrow\(\)" "$F"; then echo "FAIL: reverse test"; exit 1; fi

# Core behaviours all exercised (BLOCKING).
grep -qE "authenticate\(" "$F" || { echo "FAIL: authenticate not exercised"; exit 1; }
grep -qE "details\(" "$F" || { echo "FAIL: details not exercised"; exit 1; }
grep -qE "\.refresh\(" "$F" || { echo "FAIL: refresh parity not exercised"; exit 1; }
grep -qE "setTools" "$F" || { echo "FAIL: setTools-parity ordering not asserted"; exit 1; }
grep -qE "callLog" "$F" || { echo "FAIL: observable ordering seam absent"; exit 1; }

# Property-based >= 30% (BLOCKING; MIN-2).
TOTAL=$(grep -cE "(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(|(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$F" || true)
PROP_CASE_FORMS=$(grep -cE "(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$F" || true)
CLASSIC_PROP_BLOCKS=$(awk '
  /(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(/ { blk++; counted[blk]=0 }
  /fc\.assert|fc\.property/ { if (blk>0 && counted[blk]==0) { counted[blk]=1; n++ } }
  END { print n+0 }' "$F")
PROP=$(( PROP_CASE_FORMS + CLASSIC_PROP_BLOCKS ))
if [ "$TOTAL" -eq 0 ]; then echo "FAIL: no tests"; exit 1; fi
PCT=$(( PROP * 100 / TOTAL ))
echo "property CASES: $PROP / $TOTAL = ${PCT}%"
if [ "$PROP" -lt 2 ]; then echo "FAIL: <2 property cases"; exit 1; fi
if [ "$PCT" -lt 30 ]; then echo "FAIL: property ${PCT}% < 30%"; exit 1; fi

# RED-state enforcement.
set +e
npx vitest run "$F" > /tmp/p13_red.log 2>&1
STATUS=$?
set -e
tail -40 /tmp/p13_red.log
if [ "$STATUS" -eq 0 ]; then echo "FAIL: unexpectedly all-green before P14"; exit 1; fi
if grep -qiE "Cannot find module|SyntaxError|Failed to resolve import|ReferenceError" /tmp/p13_red.log; then
  echo "FAIL: RED is a module/compile error, not behavioral"; exit 1
fi
echo "RED confirmed behavioral (expected until P14)."
```

### Semantic Verification Checklist (BLOCKS progression)

- [ ] T14/T14b/T14c drive the REAL orchestration order via the observable callLog seam.
- [ ] T15 asserts setTools parity for both `refresh('s')` and `refresh()`.
- [ ] T16 proves undefined-manager refresh is a no-op (setTools NOT called).
- [ ] Td1-Td3 assert the deep-details projection (named fields only) + blockedServers + undefined-safe.
- [ ] ≥30% property; MIN-2; no mock theater; no reverse tests; behavioral RED.

## Success Criteria

- Behavioral RED suite covering authenticate ordering + propagation + no-op, refresh setTools parity,
  undefined-safety, and deep details projection.

## Failure Recovery

- `git checkout -- "$F"`; rewrite.

## Deferred Implementation Detection (MANDATORY — scoped)

```bash
set -o pipefail
set -e
F=packages/agents/src/api/__tests__/mcpOAuth.behavior.test.ts
test -f "$F" || { echo "missing test"; exit 1; }
if grep -nE "(TODO|FIXME|HACK|XXX|TEMPORARY|WIP|placeholder|for now|in a real|coming soon)" "$F"; then echo "FAIL: deferred marker"; exit 1; fi
if grep -niE "toThrow\(.*NotYetImplemented|should (not )?be implemented" "$F"; then echo "FAIL: reverse pattern"; exit 1; fi
if grep -nE "\b(it|test|describe)\.skip\b|\bxit\b|\bxdescribe\b" "$F"; then echo "FAIL: skipped test"; exit 1; fi
echo "PASS: no deferred markers."
```

## Phase Completion Marker

Create: `project-plans/issue2143/.completed/P13.md`

```markdown
Phase: P13
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line holistic assessment]
```
