<!-- @plan:PLAN-20260622-COREAPIGAP.P11 @requirement:REQ-005 -->
# Phase 11: Auth Detail (extend `agent.auth` with masked OAuth metadata) — Behavioral TDD

## Phase ID

`PLAN-20260622-COREAPIGAP.P11`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 10a completed (PASS)
- Verification: `test -f project-plans/issue2143/.completed/P10a.md`

## Requirements Implemented (Expanded)

### REQ-005: Detailed (masked) auth state on `AgentAuthControl`

**Full Text**: EXTEND the existing `AgentAuthControl` (agent.ts:264-276) — keeping ALL existing members
(`login`/`logout`/`status`/`enableOAuth`/`disableOAuth`/`listBuckets`/`switchBucket`/`mcpLogin`/`keys`/
`setBaseUrl`) EXACTLY as-is (REQ-009 non-breaking) — with detailed, MASKED auth metadata sourced from
the live `OAuthManager`. NO raw secret strings are ever returned (R-NO-RAW-SECRETS).
- **REQ-005.1**: `detailedStatus(provider): Promise<AuthProviderDetail>` — `{provider, authenticated,
  oauthEnabled, expiry?}`. `expiry` is read ONLY from `peekStoredToken(...).expiry` (a unix-seconds
  number) and ONLY when `authenticated === true`. `access_token` / `refresh_token` are NEVER copied.
- **REQ-005.2**: `getHigherPriorityAuth(provider): Promise<string | null>` — read-through that returns a
  source NAME (e.g. `"key"`) or `null`; never a secret.
- **REQ-005.3**: `listBucketStatuses(provider): Promise<readonly AuthBucketStatus[]>` — projects each
  bucket to `{bucket, authenticated, expiry?, isSessionBucket}` (the four public fields only).

**Behavior (GIVEN/WHEN/THEN)**:
- GIVEN a provider with OAuth enabled + a stored non-expired token (expiry=E) → `detailedStatus(p)` is
  `{provider:p, authenticated:true, oauthEnabled:true, expiry:E}` and contains NO `access_token` key.
- GIVEN OAuth enabled but no stored token → `detailedStatus(p)` is `{authenticated:false,
  oauthEnabled:true, expiry:undefined}`.
- GIVEN OAuth NOT enabled for a provider → `detailedStatus(p).oauthEnabled === false`.
- GIVEN a provider with two buckets (one a session bucket) → `listBucketStatuses(p)` has length 2 and
  each element has exactly the four public fields.
- GIVEN no higher-priority method → `getHigherPriorityAuth(p)` is `null`.

## Implementation Tasks

### Files to Create

- `packages/agents/src/api/__tests__/authDetail.behavior.test.ts`

  Drive REAL `OAuthManager` state hermetically — NO mock theater. The blessed hermetic seam (used across
  many real provider tests, e.g. `oauthManager.proactive-renewal.test.ts:85`, behavioral
  `test-utils.ts:138`) is an in-memory `TokenStore` + a real `OAuthManager`:

  1. **Build a real, seedable OAuthManager** (`.behavior.test.ts` is T17-exempt — may import the
     providers `auth.js` subpath and the control file directly):
     - Implement a tiny in-memory `TokenStore` in the test (mirror `MemoryTokenStore` in
       `packages/providers/src/auth/__tests__/behavioral/test-utils.ts:11` — `saveToken`/`getToken`/
       `removeToken`/`listProviders`/`listBuckets`/`getBucketStats`/lock no-ops). Do NOT import the
       providers internal `__tests__` file; declare the store inline in the behavior test (keeps imports
       to the public `auth.js` types + node).
     - `import { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js'` and
       `import type { OAuthToken, OAuthProvider } from '@vybestack/llxprt-code-providers/auth.js'`.
     - `const store = new MemoryTokenStore();` `const mgr = new OAuthManager(store);`
     - Register a real `OAuthProvider` object (plain object literal implementing `name`/`initiateAuth`/
       `getToken`/`refreshToken`) via `mgr.registerProvider(provider)` so `isOAuthEnabled(name)` is true.
     - Seed authentication by `await store.saveToken('myprov', { access_token: 'SECRET-do-not-leak',
       refresh_token: 'REFRESH-do-not-leak', expiry: <now+3600 unix-seconds>, token_type: 'Bearer',
       scope: '' })`. After seeding, `mgr.isAuthenticated('myprov')` resolves true and
       `mgr.peekStoredToken('myprov')` returns the token (no refresh).
  2. **Construct the control directly over the real manager** (BLESSED direct-construction precedent —
     `new HookControl(realDeps)` / `new McpControl(deps)`):
     - `import { AuthControl } from '../control/authControl.js'` and build the minimal real
       `AuthControlDeps` (the existing fields are easy to supply; the NEW field is
       `getOAuthManager: () => mgr`). Then assert through `authControl.detailedStatus(...)` etc.
     - Rationale: the buildAgent harness wires a keyring-backed shared store (non-hermetic), so the
       detailed-OAuth path is driven via the real manager over an in-memory store. This is real
       behavior (no spies/stubs), just a hermetic store — exactly the providers-package convention.
  3. **Scenarios** below. Critically, the **no-leak property** must enumerate `Object.keys(...)` (deeply)
     of every returned object across generated inputs and assert NO `access_token` / `refresh_token`
     key appears.

  - Markers `@plan:PLAN-20260622-COREAPIGAP.P11`, `@requirement:REQ-005`.

### Required scenarios

```
T13   detailedStatus: oauth-enabled + seeded non-expired token (expiry=E) →
      {provider, authenticated:true, oauthEnabled:true, expiry:E}; Object.keys has NO access_token/
      refresh_token
T13b  detailedStatus edge: (a) enabled but NO stored token → {authenticated:false, oauthEnabled:true,
      expiry:undefined}; (b) provider with oauth NOT enabled → oauthEnabled:false
T13c  listBucketStatuses: seed two buckets (default + a session bucket via setSessionBucket) → length 2,
      each element keys === {bucket, authenticated, expiry?, isSessionBucket} (no extra/secret keys)
T13d  getHigherPriorityAuth: with no higher-priority method configured → null (string-or-null contract)
PROP  no-secret-leak: for a generated token (random access_token/refresh_token strings, expiry number),
      seed + detailedStatus(p) → returned object (deep keys) contains neither access_token nor
      refresh_token; and expiry, when present, strictly equals the seeded number; MIN-2 cases
PROP  expiry-gating: for a generated boolean authed-state, detailedStatus only carries a defined expiry
      when authenticated is true (authenticated=false ⇒ expiry===undefined); MIN-2 cases
```

### Constraints

- Use a REAL `OAuthManager` over an in-memory `TokenStore`; register a REAL provider object. NEVER
  `vi.fn()`, `vi.spyOn`, `mockResolvedValue`, or `toHaveBeenCalled`.
- The no-leak assertions must walk the returned object's keys (deep) — a behavioral guarantee, not a
  structure-only `toHaveProperty`.
- Use `peekStoredToken` semantics: seeding a token + asserting `expiry` round-trips proves the value path
  WITHOUT triggering a refresh (do not seed an expired token for the authed-detail positive case).
- ≥30% property-based (fast-check), MIN-2 distinct property cases.
- Existing `AgentAuthControl` members remain callable (do not assert their removal).
- Positive cases fail at RED because `detailedStatus`/`getHigherPriorityAuth`/`listBucketStatuses` do not
  exist on `AuthControl` yet (missing-method TypeError = behavioral RED).

### RED-note (parses despite the not-yet-extended deps)

`AuthControlDeps` will not have `getOAuthManager` until P12, so a statically-typed construction could be
a *compile* error rather than a *behavioral* RED. To keep the RED behavioral: construct the deps object
and cast through `unknown` to `AuthControlDeps` at the single construction site (e.g.
`new AuthControl(deps as unknown as AuthControlDeps)`), so the file PARSES and the positive assertions
fail at runtime with a missing-method `TypeError`. (P12 removes the need for the cast by adding the field;
the impl-phase verification greps that the cast is gone.)

## Verification Commands

```bash
set -o pipefail
set -e
F=packages/agents/src/api/__tests__/authDetail.behavior.test.ts
test -f "$F"

if grep -nE "toHaveBeenCalled" "$F"; then echo "FAIL: mock theater"; exit 1; fi
if grep -nE "mockResolvedValue|mockReturnValue|vi\.spyOn|vi\.fn\(" "$F"; then echo "FAIL: mock theater (spy/stub)"; exit 1; fi
if grep -nE "not\.toThrow\(\)" "$F"; then echo "FAIL: reverse test"; exit 1; fi

# Real hermetic manager (not a fake) + the three methods exercised (BLOCKING).
grep -qE "new OAuthManager\(" "$F" || { echo "FAIL: not driving a real OAuthManager"; exit 1; }
grep -qE "detailedStatus" "$F" || { echo "FAIL: detailedStatus not exercised"; exit 1; }
grep -qE "listBucketStatuses" "$F" || { echo "FAIL: listBucketStatuses not exercised"; exit 1; }
grep -qE "getHigherPriorityAuth" "$F" || { echo "FAIL: getHigherPriorityAuth not exercised"; exit 1; }

# No-leak assertion must enumerate keys (behavioral, not structure-only).
grep -qE "Object\.keys|JSON\.stringify" "$F" || { echo "FAIL: no-leak not enumerated over keys"; exit 1; }
grep -qE "access_token|refresh_token" "$F" || { echo "FAIL: no-leak does not name the secret keys"; exit 1; }

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
npx vitest run "$F" > /tmp/p11_red.log 2>&1
STATUS=$?
set -e
tail -40 /tmp/p11_red.log
if [ "$STATUS" -eq 0 ]; then echo "FAIL: unexpectedly all-green before P12"; exit 1; fi
if grep -qiE "Cannot find module|SyntaxError|Failed to resolve import|ReferenceError" /tmp/p11_red.log; then
  echo "FAIL: RED is a module/compile error, not behavioral"; exit 1
fi
echo "RED confirmed behavioral (expected until P12)."
```

### Semantic Verification Checklist (BLOCKS progression)

- [ ] Drives a REAL `OAuthManager` over an in-memory `TokenStore` with a REAL registered provider.
- [ ] No-leak property walks returned keys and names `access_token`/`refresh_token` as forbidden.
- [ ] `expiry` round-trips the seeded number; gated behind `authenticated === true`.
- [ ] Bucket projection asserts exactly the four public fields.
- [ ] ≥30% property; MIN-2; no mock theater; no reverse tests; behavioral RED.

## Success Criteria

- Behavioral RED suite covering masked detailedStatus, bucket-status projection, higher-priority
  read-through, and the no-raw-secrets guarantee.

## Failure Recovery

- `git checkout -- "$F"`; rewrite.

## Deferred Implementation Detection (MANDATORY — scoped)

```bash
set -o pipefail
set -e
F=packages/agents/src/api/__tests__/authDetail.behavior.test.ts
test -f "$F" || { echo "missing test"; exit 1; }
if grep -nE "(TODO|FIXME|HACK|XXX|TEMPORARY|WIP|placeholder|for now|in a real|coming soon)" "$F"; then echo "FAIL: deferred marker"; exit 1; fi
if grep -niE "toThrow\(.*NotYetImplemented|should (not )?be implemented" "$F"; then echo "FAIL: reverse pattern"; exit 1; fi
if grep -nE "\b(it|test|describe)\.skip\b|\bxit\b|\bxdescribe\b" "$F"; then echo "FAIL: skipped test"; exit 1; fi
echo "PASS: no deferred markers."
```

## Phase Completion Marker

Create: `project-plans/issue2143/.completed/P11.md`

```markdown
Phase: P11
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line holistic assessment]
```
