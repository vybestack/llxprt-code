<!-- @plan:PLAN-20260622-COREAPIGAP.P12 @requirement:REQ-005 -->
# Phase 12: Auth Detail — Implementation (GREEN)

## Phase ID

`PLAN-20260622-COREAPIGAP.P12`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 11 completed (PASS)
- Verification: `test -f project-plans/issue2143/.completed/P11.md`
- Pseudocode: `project-plans/issue2143/analysis/pseudocode/auth-detail.md`
  (detailedStatus lines 1-17; getHigherPriorityAuth 30-33; listBucketStatuses 40-49)

## Purpose

Make the P11 behavioral RED suite pass by EXTENDING `AgentAuthControl` (interface) and `AuthControl`
(impl) with three masked, delegating methods, and threading the already-present `OAuthManager` into
`AuthControlDeps` via a closure in `buildAuthControl()`. No new `AgentImpl` constructor parameter:
`OAuthManager` is already on `AgentDeps` (`agentImpl.ts:121`). Existing members are untouched
(REQ-009 non-breaking).

## Implementation Tasks

### Files to Modify

#### 1. `packages/agents/src/api/agent.ts` — add projected types + extend the interface

Add the two projected public types near the other projected types. They NEVER include token strings:

```ts
// @plan:PLAN-20260622-COREAPIGAP.P12 @requirement:REQ-005
export interface AuthProviderDetail {
  readonly provider: string;
  readonly authenticated: boolean;
  readonly oauthEnabled: boolean;
  readonly expiry?: number;
}

// @plan:PLAN-20260622-COREAPIGAP.P12 @requirement:REQ-005
export interface AuthBucketStatus {
  readonly bucket: string;
  readonly authenticated: boolean;
  readonly expiry?: number;
  readonly isSessionBucket: boolean;
}
```

Extend the existing `AgentAuthControl` (do NOT remove or reorder existing members):

```ts
export interface AgentAuthControl {
  login(provider: string, opts?: { readonly bucket?: string }): Promise<void>;
  logout(
    provider: string,
    opts?: { readonly bucket?: string; readonly all?: boolean },
  ): Promise<void>;
  status(provider?: string): AuthStatus;
  enableOAuth(provider: string): Promise<void>;
  disableOAuth(provider: string): Promise<void>;
  listBuckets(provider?: string): readonly AuthBucket[];
  switchBucket(provider: string, bucket: string): Promise<void>;
  mcpLogin(server: string): Promise<void>;
  readonly keys: AgentAuthKeysControl;
  setBaseUrl(
    baseUrl: string | null,
    opts?: { readonly provider?: string },
  ): Promise<void>;
  // @plan:PLAN-20260622-COREAPIGAP.P12 @requirement:REQ-005
  detailedStatus(provider: string): Promise<AuthProviderDetail>;
  getHigherPriorityAuth(provider: string): Promise<string | null>;
  listBucketStatuses(provider: string): Promise<readonly AuthBucketStatus[]>;
}
```

#### 2. `packages/agents/src/api/control/authControl.ts` — add the deps field + implement

Add the new dep (the closure resolving the live manager) to `AuthControlDeps`:

```ts
// @plan:PLAN-20260622-COREAPIGAP.P12 @requirement:REQ-005
/** Resolves the live OAuthManager (already on AgentDeps). Never cached. */
readonly getOAuthManager: () => OAuthManager;
```

Add the import (type-only, via the providers `auth.js` subpath — the same path `agentImpl.ts:25` uses):

```ts
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
```

Add the projected return types to the existing `import type { ... } from '../agent.js';` group:
`AuthProviderDetail`, `AuthBucketStatus`.

Implement the three methods on the `AuthControl` class, following the pseudocode line-by-line:

```ts
// @plan:PLAN-20260622-COREAPIGAP.P12 @requirement:REQ-005 @pseudocode lines 1-17
async detailedStatus(provider: string): Promise<AuthProviderDetail> {
  const mgr = this.deps.getOAuthManager();
  const oauthEnabled = mgr.isOAuthEnabled(provider);
  const authenticated = await mgr.isAuthenticated(provider);
  let expiry: number | undefined;
  if (authenticated) {
    const token = await mgr.peekStoredToken(provider);
    if (token !== null) {
      expiry = token.expiry;
    }
  }
  return { provider, authenticated, oauthEnabled, expiry };
}

// @plan:PLAN-20260622-COREAPIGAP.P12 @requirement:REQ-005 @pseudocode lines 30-33
async getHigherPriorityAuth(provider: string): Promise<string | null> {
  return this.deps.getOAuthManager().getHigherPriorityAuth(provider);
}

// @plan:PLAN-20260622-COREAPIGAP.P12 @requirement:REQ-005 @pseudocode lines 40-49
async listBucketStatuses(
  provider: string,
): Promise<readonly AuthBucketStatus[]> {
  const raw = await this.deps.getOAuthManager().getAuthStatusWithBuckets(provider);
  return raw.map((b) => ({
    bucket: b.bucket,
    authenticated: b.authenticated,
    expiry: b.expiry,
    isSessionBucket: b.isSessionBucket,
  }));
}
```

#### 3. `packages/agents/src/api/agentImpl.ts` — thread the manager into `buildAuthControl()`

In `buildAuthControl()` (`agentImpl.ts:431`), add ONE field to the `new AuthControl({...})` deps object
(no new constructor parameter; reuse the already-present `this.deps.oauthManager`):

```ts
// @plan:PLAN-20260622-COREAPIGAP.P12 @requirement:REQ-005
getOAuthManager: () => this.deps.oauthManager,
```

### Constraints

- Do NOT modify the P11 test file.
- Existing `AgentAuthControl` members remain byte-identical (REQ-009).
- NEVER copy `token.access_token` / `token.refresh_token` onto any returned object — read ONLY
  `token.expiry` (R-NO-RAW-SECRETS).
- Use `peekStoredToken` (no refresh) — NOT `getToken` (which may refresh / make network calls).
- Guard the expiry read behind `authenticated === true`.
- Project `getAuthStatusWithBuckets` into `AuthBucketStatus` (four named fields) — do NOT return the raw
  array.
- No cached manager / results — resolve `this.deps.getOAuthManager()` every call (R-DELEGATE).
- No new `AgentImpl` constructor parameter — reuse `this.deps.oauthManager`.

## Verification Commands

```bash
set -o pipefail
set -e
A=packages/agents/src/api/agent.ts
C=packages/agents/src/api/control/authControl.ts
I=packages/agents/src/api/agentImpl.ts
F=packages/agents/src/api/__tests__/authDetail.behavior.test.ts

# Interface extended, existing members preserved.
grep -qE "detailedStatus\(provider: string\): Promise<AuthProviderDetail>" "$A" || { echo "FAIL: detailedStatus missing on interface"; exit 1; }
grep -qE "listBucketStatuses\(provider: string\)" "$A" || { echo "FAIL: listBucketStatuses missing"; exit 1; }
grep -qE "mcpLogin\(server: string\): Promise<void>" "$A" || { echo "FAIL: existing member removed"; exit 1; }

# Deps field + wiring present.
grep -qE "getOAuthManager: \(\) => OAuthManager" "$C" || { echo "FAIL: getOAuthManager dep missing"; exit 1; }
grep -qE "getOAuthManager: \(\) => this\.deps\.oauthManager" "$I" || { echo "FAIL: buildAuthControl not threading oauthManager"; exit 1; }

# Impl present + correct seam + markers.
grep -qE "@pseudocode lines 1-17" "$C" || { echo "FAIL: detailedStatus marker missing"; exit 1; }
grep -qE "peekStoredToken" "$C" || { echo "FAIL: not using peekStoredToken"; exit 1; }

# R-NO-RAW-SECRETS: the control must NOT reference token secret fields anywhere.
if grep -nE "access_token|refresh_token" "$C"; then echo "FAIL: control references a raw secret field"; exit 1; fi
# Must NOT use the refreshing getToken for expiry.
if grep -nE "\.getToken\(" "$C"; then echo "FAIL: used refreshing getToken instead of peekStoredToken"; exit 1; fi

# No cached manager field.
if grep -nE "private .*(oauthManager|cachedManager|authCache)\b" "$C"; then echo "FAIL: cached manager state"; exit 1; fi

# RED-note cast must be gone from the test now that the dep exists.
if grep -nE "as unknown as AuthControlDeps" "$F"; then echo "FAIL: RED-note cast still present (deps now typed)"; exit 1; fi

# Tests now GREEN.
npx vitest run "$F" 2>&1 | tail -30
npx vitest run "$F" > /tmp/p12_green.log 2>&1 || { echo "FAIL: P11 suite not green"; tail -40 /tmp/p12_green.log; exit 1; }

# Whole dir still green (non-breaking).
npx vitest run packages/agents/src/api/__tests__/ > /tmp/p12_all.log 2>&1 || { echo "FAIL: regressions"; tail -60 /tmp/p12_all.log; exit 1; }

npm run typecheck 2>&1 | tail -15
npm run lint 2>&1 | tail -15
```

### Deferred Implementation Detection (MANDATORY — scoped to changed lines)

```bash
set -o pipefail
set -e
for F in packages/agents/src/api/agent.ts packages/agents/src/api/control/authControl.ts packages/agents/src/api/agentImpl.ts; do
  git diff HEAD -- "$F" | grep -E "^\+" | grep -vE "^\+\+\+" \
    | grep -nE "(TODO|FIXME|HACK|STUB|placeholder|for now|in a real)" \
    && { echo "FAIL: deferred marker in $F"; exit 1; } || true
done
echo "PASS: no deferred markers in changed lines."
```

## Success Criteria

- P11 suite GREEN; whole `__tests__` dir GREEN; typecheck + lint clean.
- Existing `AgentAuthControl` members unchanged; three masked methods added and delegating; manager
  threaded via closure (no new ctor param); no raw secret fields referenced in the control.

## Failure Recovery

- `git checkout -- packages/agents/src/api/agent.ts packages/agents/src/api/control/authControl.ts packages/agents/src/api/agentImpl.ts`

## Phase Completion Marker

Create: `project-plans/issue2143/.completed/P12.md` (same field schema as P08).
