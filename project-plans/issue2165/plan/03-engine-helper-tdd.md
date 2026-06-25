<!-- @plan:PLAN-20260622-MCPOAUTHTRUTH.P03 @requirement:REQ-001,REQ-INT-001 -->
# Phase 03: Canonical MCP OAuth-Status Helper — Behavioral TDD (RED)

## Phase ID

`PLAN-20260622-MCPOAUTHTRUTH.P03`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 02a completed (PASS).
- Verification: `test -f project-plans/issue2165/.completed/P02a.md`
- Pseudocode reference (READ, DO NOT implement here):
  `project-plans/issue2165/analysis/pseudocode/oauth-status-helper.md` (lines 01–28).

> This phase writes the FAILING behavioral test ONLY. The production helper
> `packages/mcp/src/auth/oauth-status.ts` is created in P04. Writing any production
> source in this phase is a failure.

## Requirements Implemented (Expanded)

### REQ-001: Canonical engine helper `getMcpServerOAuthStatus`

**Full Text**: `packages/mcp` MUST export a single canonical async helper
`getMcpServerOAuthStatus(serverName: string, opts?: { requiresOAuth?: boolean }): Promise<McpOAuthStatus>`
and the union type `McpOAuthStatus = 'authenticated' | 'expired' | 'none' | 'not-required'`, computing
the real persisted-credential OAuth status by composing the existing primitives
`mcpServerRequiresOAuth` (`client/mcp-status.ts:46`), static `MCPOAuthTokenStorage.getToken`
(`auth/oauth-token-storage.ts:104`), and static `MCPOAuthTokenStorage.isTokenExpired`
(`auth/oauth-token-storage.ts:130`).

- **REQ-001.3 (R-REQUIRED-OR)**: `required = (opts?.requiresOAuth === true) OR (mcpServerRequiresOAuth.get(serverName) === true)`. If NOT required, return `'not-required'` WITHOUT reading storage.
- **REQ-001.4 (R-INNER-TOKEN)**: expiry is computed on `credentials.token` (the inner `MCPOAuthToken`), never the wrapper.
- **REQ-001.5 (R-FAULT-TOLERANT)**: any storage absence / read throw ⇒ `'none'`; the helper NEVER throws.
- **REQ-001.6 (R-MASKED)**: only the enum value crosses the boundary; no token / credential field is returned, logged, or formatted.

### REQ-INT-001: Reference parity with the proven CLI logic

**Full Text**: the helper's decision order MUST mirror the proven CLI reference
(`mcpDisplay.ts buildOAuthStatusSuffix` / `resolveTokenStatus`, `mcpDisplay.ts:69-115`): decide
required (OR-combine) → read persisted token → `null` ⇒ `none` → expired ⇒ `expired` → else
`authenticated`; any storage fault ⇒ `none`.

**Behavior (GIVEN/WHEN/THEN)** — the five-row truth table the test must pin:

| GIVEN required (OR-combine) | GIVEN getToken | GIVEN isTokenExpired(credentials.token) | THEN result |
|---|---|---|---|
| false | (must NOT be called) | (not called) | `'not-required'` |
| true | throws | — | `'none'` |
| true | null | — | `'none'` |
| true | present | true | `'expired'` |
| true | present | false | `'authenticated'` |

## Implementation Tasks

### Files to Create

- `packages/mcp/src/auth/oauth-status.behavior.test.ts`
  - Markers `@plan:PLAN-20260622-MCPOAUTHTRUTH.P03`, `@requirement:REQ-001,REQ-INT-001`.

**Behavioral RED seam (no mock theater).** Drive the REAL engine primitives:

1. **Token storage** — reuse the package's proven in-memory seam (verified in
   `oauth-token-storage.test.ts:12-80`):
   ```ts
   import type { OAuthCredentials, TokenStorage } from './token-storage/types.js';
   import type { MCPOAuthToken } from './token-store.js';
   import { MCPOAuthTokenStorage } from './oauth-token-storage.js';

   class MockTokenStorage implements TokenStorage {
     private readonly tokens = new Map<string, OAuthCredentials>();
     private shouldThrow = false;
     setShouldThrow(v: boolean) { this.shouldThrow = v; }
     async getCredentials(s: string) { if (this.shouldThrow) throw new Error('store get'); return this.tokens.get(s) ?? null; }
     async setCredentials(c: OAuthCredentials) { this.tokens.set(c.serverName, { ...c }); }
     async deleteCredentials(s: string) { this.tokens.delete(s); }
     async listServers() { return [...this.tokens.keys()]; }
     async getAllCredentials() { return new Map(this.tokens); }
     async clearAll() { this.tokens.clear(); }
   }
   ```
   `beforeEach`: `store = new MockTokenStorage(); MCPOAuthTokenStorage.setTokenStore(store);`
2. **Requires-OAuth map** — `import { mcpServerRequiresOAuth } from '../client/mcp-status.js';`
   `afterEach`: `mcpServerRequiresOAuth.clear();` (the map is module-global + monotonic; clear isolates cases).
3. **Subject under test** — import the *existing* auth barrel namespace, NOT the not-yet-created file:
   ```ts
   import * as mcpAuth from './index.js'; // EXISTS today; member is undefined until P04
   ```
   Call `await mcpAuth.getMcpServerOAuthStatus(server, opts)`. At RED this is a property access on the
   barrel namespace that resolves to `undefined`, so calling it throws a behavioral
   `TypeError: ...is not a function` — NOT a module-resolution error. (You MAY
   `import type { McpOAuthStatus } from './index.js'` — type-only, erased by vitest, safe at RED — but
   prefer asserting against the string literals directly.)

**Expiry buffer (CRITICAL, ground-truthed):** `EXPIRY_BUFFER_MS = 5*60*1000`
(`oauth-token-storage.ts:17`) and `isTokenExpired` returns `true` when `Date.now() + buffer >= expiresAt`.
So:
- an **authenticated** (non-expired) token needs `expiresAt > Date.now() + 5*60*1000` (use `+ 10*60*1000`);
- an **expired** token needs `expiresAt <= Date.now() + 5*60*1000` (use `Date.now() + 60_000`, or a past value);
- `isInvalidExpiry(undefined/null/false/''/0/NaN)` ⇒ treated as **not expired** (do not rely on this for the "expired" case).

Build a credential as:
```ts
const token: MCPOAuthToken = { accessToken: 'a', tokenType: 'Bearer', expiresAt };
await store.setCredentials({ serverName, token, updatedAt: Date.now() });
```

### Required scenarios

```
T1   NOT-REQUIRED, no storage read: requiresOAuth NOT set on the map AND no opts (or opts.requiresOAuth
     !== true); set store.setShouldThrow(true) to PROVE storage is never touched →
     result === 'not-required' (and NO throw).
T2   REQUIRED via opts, no creds: getMcpServerOAuthStatus(s, { requiresOAuth: true }) with empty store →
     'none'.
T3   REQUIRED via map, no creds: mcpServerRequiresOAuth.set(s, true); getMcpServerOAuthStatus(s) (no opts)
     with empty store → 'none'.
T4   REQUIRED + non-expired creds: seed token expiresAt = Date.now() + 10*60*1000 →
     getMcpServerOAuthStatus(s, { requiresOAuth: true }) === 'authenticated'.
T5   REQUIRED + expired creds: seed token expiresAt = Date.now() + 60_000 (within buffer) →
     'expired'. (Add a second assertion with a PAST expiresAt = Date.now() - 1000 → 'expired'.)
T6   REQUIRED + storage throws: store.setShouldThrow(true); getMcpServerOAuthStatus(s, { requiresOAuth:
     true }) → 'none' (NEVER throws — wrap the call in an expect(...).resolves form or assert the value).
PROP1 authenticated-for-future-expiry: for generated expiry offsets ms in [6*60*1000 .. 60*60*1000]
     (strictly beyond buffer), required via opts, creds seeded → result === 'authenticated'. MIN-2.
PROP2 OR-combine requiredness: for generated (hint:boolean, runtime:boolean), set the map to `runtime`
     and pass opts.requiresOAuth = hint, with an EMPTY store → result === ((hint || runtime) ? 'none' :
     'not-required'); the call NEVER throws. MIN-2.
PROP3 fault-tolerance: for generated server names, required via opts, store.setShouldThrow(true) →
     result === 'none' (never throws). MIN-2.
```

### Constraints

- Assert real return VALUES (the 4 enum literals) — NEVER `toHaveBeenCalled` / spies / `vi.fn`.
- ≥30% property-based (fast-check), MIN-2 distinct cases each property.
- Seed ONLY through the real `MockTokenStorage` + `MCPOAuthTokenStorage.setTokenStore` seam and the real
  `mcpServerRequiresOAuth` map. Do NOT spy on `getToken` / `isTokenExpired` / mock the helper.
- RED is BEHAVIORAL: positive cases fail because `mcpAuth.getMcpServerOAuthStatus` is `undefined` until
  P04 (a `TypeError`, not a module/compile error).
- `fast-check` is added as a devDep in P04; at RED it is not yet installed. **Author the property tests
  now** (they are part of the RED suite) — they will execute at GREEN. If the RED run cannot resolve
  `fast-check`, that is acceptable for RED ONLY for the property cases; the classic cases T1–T6 MUST
  still produce a behavioral (non-module) failure for the subject. (Prefer: keep the `import fast-check`
  line; the RED guard below tolerates a `fast-check` resolution failure but still requires at least one
  behavioral subject failure.) See the RED block for the exact gate.

## Verification Commands

```bash
set -o pipefail
set -e
F=packages/mcp/src/auth/oauth-status.behavior.test.ts
test -f "$F"

# No production source created in this phase.
test ! -f packages/mcp/src/auth/oauth-status.ts || { echo "FAIL: production helper exists in TDD phase"; exit 1; }

# Mock-theater / reverse-test bans.
if grep -nE "toHaveBeenCalled" "$F"; then echo "FAIL: mock theater"; exit 1; fi
if grep -nE "vi\.fn\(|vi\.spyOn|mockResolvedValue|mockReturnValue" "$F"; then echo "FAIL: spy/stub mock theater"; exit 1; fi
if grep -nE "not\.toThrow\(\)|NotYetImplemented" "$F"; then echo "FAIL: reverse test"; exit 1; fi
if grep -nE ":\s*any\b|as any" "$F"; then echo "FAIL: any"; exit 1; fi

# Behavioral seam present: real storage seam + real requires map + subject via the barrel namespace.
grep -qE "setTokenStore" "$F" || { echo "FAIL: must use real MCPOAuthTokenStorage.setTokenStore seam"; exit 1; }
grep -qE "mcpServerRequiresOAuth" "$F" || { echo "FAIL: must drive the real requires map"; exit 1; }
grep -qE "from ['\"]\./index\.js['\"]" "$F" || { echo "FAIL: subject must be reached via the existing auth barrel (./index.js)"; exit 1; }
grep -qE "getMcpServerOAuthStatus" "$F" || { echo "FAIL: subject not exercised"; exit 1; }
# All four enum outcomes asserted.
for lit in "'authenticated'" "'expired'" "'none'" "'not-required'"; do
  grep -qF "$lit" "$F" || { echo "FAIL: outcome $lit not asserted"; exit 1; }
done

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

# RED-state enforcement (behavioral, not module/compile).
set +e
( cd packages/mcp && npx vitest run src/auth/oauth-status.behavior.test.ts ) > /tmp/p03_red.log 2>&1
STATUS=$?
set -e
tail -40 /tmp/p03_red.log
if [ "$STATUS" -eq 0 ]; then echo "FAIL: unexpectedly all-green before P04"; exit 1; fi
# The SUBJECT failure must be behavioral. A 'fast-check' resolution failure (devDep added in P04) is
# tolerated, but there must be a genuine behavioral subject failure (undefined helper => TypeError).
if grep -qiE "getMcpServerOAuthStatus is not a function|is not a function" /tmp/p03_red.log; then
  echo "RED confirmed behavioral: subject helper undefined until P04."
else
  # If the only failures are module/syntax errors unrelated to the missing helper, reject.
  if grep -qiE "Cannot find module '\./oauth-status|SyntaxError|Failed to resolve import '\./oauth-status|ReferenceError" /tmp/p03_red.log; then
    echo "FAIL: RED is a module/compile error against the helper file, not a behavioral undefined-call"; exit 1
  fi
  echo "WARN: could not positively match the TypeError string; inspect /tmp/p03_red.log to confirm the subject failed behaviorally."
  exit 1
fi
```

### Semantic Verification Checklist (BLOCKS progression)

- [ ] Subject reached via the EXISTING auth barrel namespace (`./index.js`); the helper file is NOT
      imported by path and is NOT created in this phase.
- [ ] Real `MCPOAuthTokenStorage.setTokenStore(MockTokenStorage)` seam + real `mcpServerRequiresOAuth`
      map drive every case; no spies, no `getToken`/`isTokenExpired` mocking.
- [ ] All four outcomes (`authenticated`/`expired`/`none`/`not-required`) asserted; the not-required
      case proves storage is NEVER read (throwing store still yields `not-required`).
- [ ] Expiry buffer respected (authenticated uses `+10min`; expired uses `+60s` and a past value).
- [ ] ≥30% property; MIN-2 each; no mock theater; no reverse tests; no `any`.
- [ ] RED is behavioral (undefined-helper `TypeError`), not a module/compile error.

## Success Criteria

- A behavioral RED suite covering the full five-row truth table + OR-combine + fault-tolerance, ≥30%
  property, driving only the real storage/map seams.

## Failure Recovery

- `git checkout -- "$F"`; rewrite.

## Deferred Implementation Detection (MANDATORY — scoped)

```bash
set -o pipefail
set -e
F=packages/mcp/src/auth/oauth-status.behavior.test.ts
test -f "$F" || { echo "missing test"; exit 1; }
if grep -nE "(TODO|FIXME|HACK|XXX|TEMPORARY|WIP|placeholder|for now|in a real|coming soon)" "$F"; then echo "FAIL: deferred marker"; exit 1; fi
if grep -niE "toThrow\(.*NotYetImplemented|should (not )?be implemented" "$F"; then echo "FAIL: reverse pattern"; exit 1; fi
if grep -nE "\b(it|test|describe)\.skip\b|\bxit\b|\bxdescribe\b" "$F"; then echo "FAIL: skipped test"; exit 1; fi
echo "PASS: no deferred markers."
```

## Phase Completion Marker

Create: `project-plans/issue2165/.completed/P03.md`

```markdown
Phase: P03
Completed: YYYY-MM-DD HH:MM
Files Created: [oauth-status.behavior.test.ts with line count]
Tests Added: [count classic + property]
Property ratio: [PROP / TOTAL = %]
RED evidence: [paste the tail of /tmp/p03_red.log showing the behavioral TypeError]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line holistic assessment]
```
