<!-- @plan:PLAN-20260622-MCPOAUTHTRUTH.P04 @requirement:REQ-001,REQ-INT-001 -->
# Phase 04: Canonical MCP OAuth-Status Helper — Implementation (GREEN)

## Phase ID

`PLAN-20260622-MCPOAUTHTRUTH.P04`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 03 completed (PASS).
- Verification: `test -f project-plans/issue2165/.completed/P03.md`
- Implement EXACTLY the pseudocode in
  `project-plans/issue2165/analysis/pseudocode/oauth-status-helper.md` (lines 01–28). Cite
  `@pseudocode` lines in the source.

## Purpose

Create the single canonical engine helper that answers "what is server X's OAuth status?" by composing
the existing real primitives, publish it from the `packages/mcp` barrels and the
`@vybestack/llxprt-code-core` barrel, and stand up the mutation-testing harness for it. This turns the
P03 RED suite GREEN with zero mock theater.

## Files to Modify / Create (NUMBERED — implement in order)

### 1. CREATE `packages/mcp/src/auth/oauth-status.ts` — `@pseudocode oauth-status-helper.md:01-28`

```typescript
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20260622-MCPOAUTHTRUTH.P04
 * @requirement REQ-001, REQ-INT-001
 */

import { mcpServerRequiresOAuth } from '../client/mcp-status.js';
import { MCPOAuthTokenStorage } from './oauth-token-storage.js';

/**
 * Canonical OAuth status for a single MCP server.
 * - 'not-required'  : the server does not require OAuth (no read performed)
 * - 'none'          : OAuth required but no usable persisted credential
 * - 'expired'       : a persisted credential exists but is expired
 * - 'authenticated' : a persisted, non-expired credential exists
 */
export type McpOAuthStatus =
  | 'authenticated'
  | 'expired'
  | 'none'
  | 'not-required';

/**
 * Single source of truth for an MCP server's persisted OAuth status.
 *
 * Composes the runtime "requires OAuth" map, the persisted-credential read, and the expiry math.
 * Total (never throws): any storage absence/fault maps to 'none'. Masked: returns the enum only.
 *
 * @pseudocode oauth-status-helper.md:01-28
 */
export async function getMcpServerOAuthStatus(
  serverName: string,
  opts?: { requiresOAuth?: boolean },
): Promise<McpOAuthStatus> {
  // @pseudocode 02-08 — required? (OR-combine; R-REQUIRED-OR). Do NOT read storage if not required.
  const hintRequires = opts?.requiresOAuth === true;
  const runtimeRequires = mcpServerRequiresOAuth.get(serverName) === true;
  if (!hintRequires && !runtimeRequires) {
    return 'not-required';
  }

  // @pseudocode 10-19 — persisted credential read (fault-tolerant; R-FAULT-TOLERANT / R-INNER-TOKEN).
  let credentials: Awaited<ReturnType<typeof MCPOAuthTokenStorage.getToken>>;
  try {
    credentials = await MCPOAuthTokenStorage.getToken(serverName);
  } catch {
    return 'none';
  }
  if (credentials === null || credentials === undefined) {
    return 'none';
  }

  // @pseudocode 21-27 — expiry on the INNER token (R-INNER-TOKEN). Properly typed: no `as never`.
  return MCPOAuthTokenStorage.isTokenExpired(credentials.token)
    ? 'expired'
    : 'authenticated';
}
```

Notes:
- `MCPOAuthTokenStorage.getToken` returns `Promise<MCPOAuthCredentials | null>`; `credentials.token` is
  the inner `MCPOAuthToken` that `isTokenExpired` consumes. Do NOT copy the CLI's `isTokenExpired(token
  as never)`.
- No module-level mutable cache (R-DELEGATE): the function reads live state every call.

### 2. EDIT `packages/mcp/src/auth/index.ts` — publish from the auth barrel

In the `MCPOAuthTokenStorage` export group (after line 18, the
`export type { MCPOAuthToken, MCPOAuthCredentials } from './oauth-token-storage.js';` block), ADD:

```typescript
export { getMcpServerOAuthStatus } from './oauth-status.js';
export type { McpOAuthStatus } from './oauth-status.js';
```

(`packages/mcp/src/index.ts:8` already does `export * from './auth/index.js'`, so the root barrel
surfaces these automatically.)

### 3. EDIT `packages/core/src/index.ts` — re-export from the core barrel (R-CORE-BARREL-SEAM)

- VALUE group (the `} from '@vybestack/llxprt-code-mcp';` block ending at line 503): add
  `getMcpServerOAuthStatus,` immediately after `OAuthUtils,` (line 502), before the closing `}`.
- TYPE group (the `export type { ... } from '@vybestack/llxprt-code-mcp';` block ending at line 514):
  add `McpOAuthStatus,` before the closing `}` (e.g. after `OAuthProtectedResourceMetadata,` at line
  513).

### 4. EDIT `packages/mcp/package.json` — mutation-testing harness deps + script

- Add to `devDependencies` (match the versions already used by `packages/agents`):
  ```json
  "@stryker-mutator/core": "^9.6.1",
  "@stryker-mutator/vitest-runner": "^9.6.1",
  "fast-check": "^4.2.0",
  ```
- Add to `scripts`:
  ```json
  "test:mutation": "stryker run stryker.conf.json"
  ```

### 5. CREATE `packages/mcp/stryker.conf.json` — mutate ONLY the logic-bearing helper

```json
{
  "$schema": "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",
  "mutate": ["src/auth/oauth-status.ts"],
  "testRunner": "vitest",
  "inPlace": true,
  "vitest": {},
  "coverageAnalysis": "perTest",
  "reporters": ["json", "clear-text", "progress"],
  "jsonReporter": { "fileName": "reports/mutation/mutation.json" },
  "thresholds": { "high": 80, "low": 60, "break": 80 }
}
```

> Per the LOCKED mutation policy: mutate the logic-bearing helper ONLY (4 outcomes + OR-combine +
> catch→none). Barrels/glue are NOT mutated. Survivor triage happens at the P08 gate, not here.

### 6. Install the new devDeps

From the repo root: `npm install` (workspaces) so `fast-check` + Stryker resolve for the GREEN run and
the P08 mutation gate.

## Constraints

- Implement line-by-line against `oauth-status-helper.md`; keep the early `'not-required'` return BEFORE
  any storage read (R-REQUIRED-OR); the `try` wraps the `getToken` read; map any read fault to `'none'`
  (R-FAULT-TOLERANT); compute expiry on `credentials.token` (R-INNER-TOKEN); return only the enum
  (R-MASKED); no cached state (R-DELEGATE); no `as never` / no `any`.
- Do NOT modify the existing CLI `mcpDisplay.ts` in this issue (that is #1595's deletion of the copy).
- Additive only: do not change any existing export's name/shape.

## Verification Commands

```bash
set -o pipefail
set -e
H=packages/mcp/src/auth/oauth-status.ts
AB=packages/mcp/src/auth/index.ts
CB=packages/core/src/index.ts
PJ=packages/mcp/package.json
SC=packages/mcp/stryker.conf.json
F=packages/mcp/src/auth/oauth-status.behavior.test.ts

test -f "$H" && test -f "$SC"

# Interface present.
grep -qE "export type McpOAuthStatus" "$H" || { echo "FAIL: McpOAuthStatus type missing"; exit 1; }
grep -qE "export async function getMcpServerOAuthStatus\(" "$H" || { echo "FAIL: helper signature missing"; exit 1; }
grep -qE "@pseudocode oauth-status-helper" "$H" || { echo "FAIL: pseudocode citation missing"; exit 1; }

# Composes the REAL primitives; properly typed.
grep -qE "mcpServerRequiresOAuth\.get\(" "$H" || { echo "FAIL: requires-map signal not used"; exit 1; }
grep -qE "MCPOAuthTokenStorage\.getToken\(" "$H" || { echo "FAIL: getToken not used"; exit 1; }
grep -qE "isTokenExpired\(credentials\.token\)" "$H" || { echo "FAIL: expiry not on credentials.token"; exit 1; }
if grep -nE "as never|:\s*any\b|as any" "$H"; then echo "FAIL: improper typing"; exit 1; fi

# R-REQUIRED-OR: 'not-required' returned BEFORE any getToken read (line-order check).
NR_LINE=$(grep -nE "return 'not-required'" "$H" | head -1 | cut -d: -f1)
GT_LINE=$(grep -nE "MCPOAuthTokenStorage\.getToken\(" "$H" | head -1 | cut -d: -f1)
[ -n "$NR_LINE" ] && [ -n "$GT_LINE" ] && [ "$NR_LINE" -lt "$GT_LINE" ] || { echo "FAIL: not-required must short-circuit before storage read"; exit 1; }

# R-FAULT-TOLERANT: a try/catch guards the read and the catch yields 'none'; helper never re-throws.
grep -qE "try" "$H" && grep -qE "catch" "$H" || { echo "FAIL: fault-tolerant try/catch missing"; exit 1; }
awk '/catch/{c=1} c&&/return .none./{f=1} END{exit f?0:1}' "$H" || { echo "FAIL: catch path must return 'none'"; exit 1; }
if grep -nE "throw " "$H"; then echo "FAIL: helper must not throw"; exit 1; fi

# R-MASKED: never returns a token/credential value.
if grep -nE "return (credentials|token|credentials\.token)\b" "$H"; then echo "FAIL: must return enum only, not a credential"; exit 1; fi

# Barrels publish the symbol (mcp auth + core value/type).
grep -qE "export \{ getMcpServerOAuthStatus \} from './oauth-status.js'" "$AB" || { echo "FAIL: auth barrel value export missing"; exit 1; }
grep -qE "export type \{ McpOAuthStatus \} from './oauth-status.js'" "$AB" || { echo "FAIL: auth barrel type export missing"; exit 1; }
grep -qE "getMcpServerOAuthStatus" "$CB" || { echo "FAIL: core barrel value re-export missing"; exit 1; }
grep -qE "McpOAuthStatus" "$CB" || { echo "FAIL: core barrel type re-export missing"; exit 1; }

# Mutation harness wired.
grep -qE "\"fast-check\"" "$PJ" || { echo "FAIL: fast-check devDep missing"; exit 1; }
grep -qE "@stryker-mutator/core" "$PJ" || { echo "FAIL: stryker core devDep missing"; exit 1; }
grep -qE "@stryker-mutator/vitest-runner" "$PJ" || { echo "FAIL: stryker vitest-runner devDep missing"; exit 1; }
grep -qE "\"test:mutation\"" "$PJ" || { echo "FAIL: test:mutation script missing"; exit 1; }
grep -qE "oauth-status\.ts" "$SC" || { echo "FAIL: stryker must mutate oauth-status.ts"; exit 1; }

# Target test GREEN.
( cd packages/mcp && npx vitest run src/auth/oauth-status.behavior.test.ts ) > /tmp/p04_green.log 2>&1 || { tail -60 /tmp/p04_green.log; echo "FAIL: P03 suite not green"; exit 1; }
tail -20 /tmp/p04_green.log

# Whole auth dir GREEN (no regression to the existing token-storage tests).
( cd packages/mcp && npx vitest run src/auth ) > /tmp/p04_dir.log 2>&1 || { tail -80 /tmp/p04_dir.log; echo "FAIL: auth dir regression"; exit 1; }
tail -20 /tmp/p04_dir.log

# Build (orders packages: mcp before core) + typecheck + lint.
npm run build > /tmp/p04_build.log 2>&1 || { tail -60 /tmp/p04_build.log; echo "FAIL: build"; exit 1; }
npm run typecheck > /tmp/p04_tc.log 2>&1 || { tail -60 /tmp/p04_tc.log; echo "FAIL: typecheck"; exit 1; }
npm run lint > /tmp/p04_lint.log 2>&1 || { tail -60 /tmp/p04_lint.log; echo "FAIL: lint"; exit 1; }
echo "P04 GREEN."
```

### Deferred / leftover scan (changed production lines only)

```bash
set -o pipefail
set -e
for P in packages/mcp/src/auth/oauth-status.ts; do
  if git diff HEAD -- "$P" | grep -nE "^\+.*(TODO|FIXME|HACK|XXX|placeholder|for now|NotYetImplemented)"; then
    echo "FAIL: deferred marker in added lines of $P"; exit 1; fi
done
echo "PASS: no deferred markers in changed production lines."
```

## Success Criteria

- P03 suite GREEN with zero mock theater; helper composes the real primitives per pseudocode; published
  from both barrels; mutation harness in place; build/typecheck/lint green.

## Failure Recovery

- Re-read `oauth-status-helper.md`; align line-by-line. `git checkout -- <files>` and redo if structure
  drifts. Do NOT weaken the test to pass.

## Phase Completion Marker

Create: `project-plans/issue2165/.completed/P04.md`

```markdown
Phase: P04
Completed: YYYY-MM-DD HH:MM
Files Created: [oauth-status.ts, stryker.conf.json — line counts]
Files Modified: [auth/index.ts, core/src/index.ts, mcp/package.json — diff stats]
Verification: [paste actual output of the verification commands incl. GREEN tails + build/typecheck/lint]
Pseudocode compliance: [confirm lines 01-28 mapped]
Semantic Assessment: [one-line holistic assessment]
```
