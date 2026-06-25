<!-- @plan:PLAN-20260622-MCPOAUTHTRUTH.P07 @requirement:REQ-004,REQ-005 -->
# Phase 07 — Non-Breaking Surface Guards + Docs

Plan ID: PLAN-20260622-MCPOAUTHTRUTH
Phase: P07 (impl — test/docs only; NO production source changes)

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- `test -f project-plans/issue2165/.completed/P06a.md` (the projection landed and
  passed its BLIND gate).
- Read in full: the three guard files and the docs target:
  - `packages/agents/src/api/__tests__/additiveSurface.types.ts` (COMPILE fence)
  - `packages/agents/src/api/__tests__/publicSurface.nonbreaking.test.ts` (RUNTIME)
  - `packages/agents/src/api/__tests__/nonBreaking.exports.test.ts` (RUNTIME)
  - `docs/agent-api.md` (MCP section ~`:312-372`)

## Requirements Under Test

- **REQ-004 (non-breaking facet)** — GIVEN the existing public surface, WHEN the new
  `oauthStatus` / `sessionAuthenticated` fields and the `McpOAuthStatus` type are
  added, THEN NO existing export/field is removed or reshaped (purely additive), and
  the new symbols are anchored so a future removal/rename fails the build/suite.
- **REQ-005 (docs)** — GIVEN the public API docs, WHEN a #1595 consumer reads them,
  THEN the corrected `authenticated`/`requiresAuth` semantics and the new
  `oauthStatus`/`sessionAuthenticated` fields are documented with copy-paste-accurate,
  PUBLIC-ROOT-ONLY examples (no deep core import, no `getConfig()`).

## Part 1 — Compile fence: `additiveSurface.types.ts`

This is a `.types.ts` (CCF-6): typecheck-VISIBLE, build-EXCLUDED, vitest-IGNORED.
Anchors must be `void`-consumed or `export type` (noUnusedLocals). Use top-level
`import type` (consistent-type-imports). **Do NOT reformat the existing
`_taskInfoAnchor` line or any existing anchor — APPEND only.**

Append (mirroring the existing const-anchor idiom):

```ts
// @plan:PLAN-20260622-MCPOAUTHTRUTH.P07 @requirement:REQ-004
import type {
  McpOAuthStatus,
  McpServerAuthStatus,
  McpServerDetail,
} from '@vybestack/llxprt-code-agents';

// McpOAuthStatus must remain a 4-member union (additive quad-state).
const _mcpOAuthStatusAnchor: McpOAuthStatus[] = [
  'authenticated',
  'expired',
  'none',
  'not-required',
];
void _mcpOAuthStatusAnchor;

// New fields must exist on both projected shapes (removal => compile error).
const _mcpAuthShapeAnchor: Pick<
  McpServerAuthStatus,
  'oauthStatus' | 'sessionAuthenticated' | 'authenticated' | 'requiresAuth'
> = {
  oauthStatus: 'authenticated',
  sessionAuthenticated: false,
  authenticated: true,
  requiresAuth: true,
};
void _mcpAuthShapeAnchor;

const _mcpDetailShapeAnchor: Pick<
  McpServerDetail,
  'oauthStatus' | 'sessionAuthenticated' | 'requiresAuth'
> = {
  oauthStatus: 'not-required',
  sessionAuthenticated: false,
  requiresAuth: false,
};
void _mcpDetailShapeAnchor;
```

## Part 2 — Runtime guards

In `publicSurface.nonbreaking.test.ts`, APPEND a NEW describe block (the existing
blocks MUST remain untouched + green):

```ts
describe('REQ-004 @plan:PLAN-20260622-MCPOAUTHTRUTH.P07 — additive MCP OAuth surface', () => {
  it('exposes McpOAuthStatus as a type-only export (no runtime root key)', async () => {
    const root = await import('@vybestack/llxprt-code-agents');
    // type-only: must NOT appear as a runtime key (mirrors the ApprovalMode/type precedent)
    expect(Object.prototype.hasOwnProperty.call(root, 'McpOAuthStatus')).toBe(false);
  });

  it('preserves every previously-public MCP field name (additive only)', () => {
    // structural assertion over a constructed projection shape — see types fence
    const sample: McpServerAuthStatus = {
      server: 's',
      authenticated: false,
      requiresAuth: false,
      oauthStatus: 'not-required',
      sessionAuthenticated: false,
    };
    expect(Object.keys(sample).sort()).toStrictEqual(
      ['authenticated', 'oauthStatus', 'requiresAuth', 'server', 'sessionAuthenticated'].sort(),
    );
  });
});
```

(If `nonBreaking.exports.test.ts` enumerates the runtime root/internals key sets,
ADD `McpOAuthStatus` to the EXPECTED type-only-absent assertions consistent with the
existing precedent — do not remove any existing expectation.) Include at least one
`fc.assert` property over the four `McpOAuthStatus` members proving each is a valid
`oauthStatus` value on the constructed shape (keeps the file's property ratio honest).

## Part 3 — Docs: `docs/agent-api.md`

ADD (do not rewrite) to the MCP section (~`:312-372`):

- A short subsection documenting `oauthStatus: 'authenticated' | 'expired' | 'none' |
  'not-required'` and `sessionAuthenticated: boolean` on both `McpServerAuthStatus`
  and `McpServerDetail`, and a one-line CORRECTION note that `authenticated` now means
  "a valid persisted OAuth token exists" (`oauthStatus === 'authenticated'`) and
  `requiresAuth` is now the real per-server value.
- One copy-paste example that imports ONLY from `@vybestack/llxprt-code-agents` and
  reads `agent.mcp.auth(server)` / `agent.mcp.details()` — NO deep core import, NO
  `agent.getConfig()`.

## Constraints

- **TEST/DOCS ONLY** — do NOT modify any production source in this phase.
- Do NOT weaken or delete any existing anchor/assertion/section.
- Examples must match the SHIPPED signatures exactly (copy-paste accurate).

## Verification (BLOCKING — run from repo root)

```bash
set -o pipefail
set -e
TYPES="packages/agents/src/api/__tests__/additiveSurface.types.ts"
RUNTIME="packages/agents/src/api/__tests__/publicSurface.nonbreaking.test.ts"
DOCS="docs/agent-api.md"

# 1) compile fence anchors present + typecheck sees them
grep -q "_mcpOAuthStatusAnchor" "$TYPES" || { echo "FAIL: union anchor missing"; exit 1; }
grep -q "_mcpAuthShapeAnchor" "$TYPES" || { echo "FAIL: auth-shape anchor missing"; exit 1; }
grep -q "_mcpDetailShapeAnchor" "$TYPES" || { echo "FAIL: detail-shape anchor missing"; exit 1; }
# top-level import type, not inline import()
if grep -nE "import\(" "$TYPES"; then echo "FAIL: inline import() in types fence"; exit 1; fi

# 2) runtime guard: new describe block added, old blocks preserved
grep -q "PLAN-20260622-MCPOAUTHTRUTH.P07" "$RUNTIME" || { echo "FAIL: new describe block missing"; exit 1; }

# 3) docs: new fields documented + example imports public root only
grep -q "oauthStatus" "$DOCS" || { echo "FAIL: oauthStatus undocumented"; exit 1; }
grep -q "sessionAuthenticated" "$DOCS" || { echo "FAIL: sessionAuthenticated undocumented"; exit 1; }
if grep -nE "llxprt-code-core|getConfig\(" "$DOCS" | grep -nE "import|require"; then
  echo "FAIL: docs example uses a non-public-root import"; exit 1
fi

# 4) NO production source modified by this phase
if git diff HEAD --name-only | grep -vE "__tests__/|\.md$" | grep -E "packages/agents/src/"; then
  echo "FAIL: production source modified in a test/docs-only phase"; exit 1
fi

# 5) existing docs sections preserved (no removed heading/fence/table row)
if git diff HEAD -- "$DOCS" | grep -E "^-#|^-\`\`\`|^-\| "; then
  echo "FAIL: an existing docs heading/fence/row was removed"; exit 1
fi

# 6) guards + typecheck green
npx vitest run "$RUNTIME" > /tmp/p07_rt.log 2>&1 || { echo "FAIL: runtime guard red"; tail -40 /tmp/p07_rt.log; exit 1; }
npx vitest run packages/agents/src/api/__tests__/nonBreaking.exports.test.ts > /tmp/p07_nb.log 2>&1 || { echo "FAIL: nonBreaking exports red"; tail -40 /tmp/p07_nb.log; exit 1; }
npm run typecheck > /tmp/p07_tc.log 2>&1 || { echo "FAIL: typecheck (compile fence)"; tail -40 /tmp/p07_tc.log; exit 1; }
echo "PASS: P07 non-breaking guards + docs green."
```

## Non-Vacuity Probe (REQUIRED)

Temporarily delete the `oauthStatus` field from `McpServerAuthStatus` in
`agent.ts`, run `npm run typecheck`, and CONFIRM `additiveSurface.types.ts` FAILS to
compile (the `_mcpAuthShapeAnchor` Pick errors). Restore byte-identically and confirm
green. Record both outcomes. (Then revert your probe edit — production stays
unchanged by this phase.)

## Success Criteria

- Compile anchors + runtime describe block + docs added; no existing
  anchor/assertion/section removed; no production source modified; typecheck +
  guards green; non-vacuity probe demonstrated.

## Completion Marker

Write `project-plans/issue2165/.completed/P07.md` with: the exact appended anchors and
describe block; the docs additions; the non-vacuity probe RED-then-GREEN outcomes;
confirmation `git diff HEAD --name-only` shows ONLY `__tests__/` + `.md` changes.
