<!-- @plan:PLAN-20260622-COREAPIGAP.P02 @requirement:REQ-005 -->
# Pseudocode: Auth Detail (extend `Agent.auth` with masked OAuth metadata)

Plan ID: PLAN-20260622-COREAPIGAP
Component: G5 — extend the EXISTING `AgentAuthControl` / `AuthControl` with detailed, MASKED auth state.
Source of truth: specification.md REQ-005; domain-model.md R-NO-RAW-SECRETS, R-DELEGATE.
Analysis only — NO implementation code is written in this document.

---

## Interface Contracts

```typescript
// EXTEND the existing AgentAuthControl interface in packages/agents/src/api/agent.ts (:260-277).
// Existing members stay EXACTLY as-is (REQ-009). ADD:
interface AgentAuthControl {
  // ...existing members unchanged...
  detailedStatus(provider: string): Promise<AuthProviderDetail>;
  getHigherPriorityAuth(provider: string): Promise<string | null>;
  listBucketStatuses(provider: string): Promise<readonly AuthBucketStatus[]>;
}

// Projected public types (specification.md Data Schemas) — NEVER include token strings.
interface AuthProviderDetail {
  readonly provider: string;
  readonly authenticated: boolean;
  readonly oauthEnabled: boolean;
  readonly expiry?: number;          // unix-seconds from OAuthToken.expiry; NO access_token
}
interface AuthBucketStatus {
  readonly bucket: string;
  readonly authenticated: boolean;
  readonly expiry?: number;
  readonly isSessionBucket: boolean;
}
```

### Dependencies (NEVER stubbed)

`OAuthManager` is ALREADY on `AgentDeps` (`agentImpl.ts:121`, non-nullable) but is NOT yet threaded
into `AuthControlDeps`. The ONLY wiring change is to pass a closure resolving it into
`buildAuthControl()` (`agentImpl.ts:431`) — no new constructor parameter on AgentImpl.

```typescript
// ADD to AuthControlDeps (control/authControl.ts:34):
//   readonly getOAuthManager: () => OAuthManager
// Wired in buildAuthControl(): getOAuthManager: () => this.deps.oauthManager
//
// Live OAuthManager calls used (all async, all MASKED outputs):
//   isOAuthEnabled(provider): boolean                       // oauth-manager.ts:300 (sync)
//   isAuthenticated(provider): Promise<boolean>             // oauth-manager.ts:199
//   peekStoredToken(provider): Promise<OAuthToken | null>   // oauth-manager.ts:243 (token.expiry only)
//   getHigherPriorityAuth(provider): Promise<string | null> // oauth-manager.ts:313
//   getAuthStatusWithBuckets(provider): Promise<Array<{bucket,authenticated,expiry?,isSessionBucket}>>
//                                                           // oauth-manager.ts:395
// OAuthToken.expiry is a unix-seconds number (auth/src/types.ts OAuthTokenSchema.expiry:15).
```

---

## Numbered Pseudocode

### METHOD detailedStatus(provider): Promise<AuthProviderDetail>

```
1: // @pseudocode REQ-005.1 — masked detail: authenticated + oauthEnabled + expiry; NEVER the token
2: METHOD detailedStatus(provider) RETURNS Promise<AuthProviderDetail>
3:   SET mgr = this.deps.getOAuthManager()
4:   SET oauthEnabled = mgr.isOAuthEnabled(provider)         // oauth-manager.ts:300
5:   SET authenticated = AWAIT mgr.isAuthenticated(provider) // oauth-manager.ts:199
6:   SET expiry = undefined
7:   IF authenticated IS true THEN
8:     SET token = AWAIT mgr.peekStoredToken(provider)       // oauth-manager.ts:243 (no refresh)
9:     IF token IS NOT null THEN SET expiry = token.expiry   // ONLY the expiry number is read
10:  END IF
11:  RETURN {
12:    provider: provider,
13:    authenticated: authenticated,
14:    oauthEnabled: oauthEnabled,
15:    expiry: expiry,                                        // token.access_token is NEVER copied
16:  }
17: END METHOD
```

### METHOD getHigherPriorityAuth(provider): Promise<string | null>

```
30: // @pseudocode REQ-005.2 — direct read-through (returns a provider/source NAME, not a secret)
31: METHOD getHigherPriorityAuth(provider) RETURNS Promise<string | null>
32:   RETURN AWAIT this.deps.getOAuthManager().getHigherPriorityAuth(provider)  // oauth-manager.ts:313
33: END METHOD
```

### METHOD listBucketStatuses(provider): Promise<readonly AuthBucketStatus[]>

```
40: // @pseudocode REQ-005.3 — project bucket status; copy ONLY the four public fields
41: METHOD listBucketStatuses(provider) RETURNS Promise<readonly AuthBucketStatus[]>
42:   SET raw = AWAIT this.deps.getOAuthManager().getAuthStatusWithBuckets(provider)  // :395
43:   SET out = empty array
44:   FOR EACH b IN raw
45:     APPEND { bucket: b.bucket, authenticated: b.authenticated,
46:              expiry: b.expiry, isSessionBucket: b.isSessionBucket } TO out
47:   END FOR
48:   RETURN out
49: END METHOD
```

---

## Integration Points (Line-by-Line, REAL symbols)

| Pseudocode line | Real symbol / call | File:line (verified) |
|---|---|---|
| 3 (wiring) | `OAuthManager` on `AgentDeps` (already present) | `agentImpl.ts:121` |
| 4 | `OAuthManager.isOAuthEnabled(provider): boolean` | `providers/src/auth/oauth-manager.ts:300` |
| 5 | `OAuthManager.isAuthenticated(provider): Promise<boolean>` | `oauth-manager.ts:199` |
| 8 | `OAuthManager.peekStoredToken(provider): Promise<OAuthToken \| null>` | `oauth-manager.ts:243` |
| 9 | `OAuthToken.expiry: number` (unix-seconds) | `packages/auth/src/types.ts` `OAuthTokenSchema.expiry:15` |
| 32 | `OAuthManager.getHigherPriorityAuth(provider): Promise<string \| null>` | `oauth-manager.ts:313` |
| 42 | `OAuthManager.getAuthStatusWithBuckets(provider)` → `Array<{bucket,authenticated,expiry?,isSessionBucket}>` | `oauth-manager.ts:395` |
| n/a (wiring) | thread `getOAuthManager` into `buildAuthControl()` | `agentImpl.ts:431` |

CLI consumer this unblocks (#1595): `packages/cli/src/ui/commands/authCommand.ts`
(`peekStoredToken`, `getHigherPriorityAuth`, `getAuthStatusWithBuckets`).

---

## Anti-Pattern Warnings

- [ERROR] DO NOT: copy `token.access_token` / `token.refresh_token` onto any returned object.
  [OK] DO: read ONLY `token.expiry` (a number) for `AuthProviderDetail.expiry` (R-NO-RAW-SECRETS).
- [ERROR] DO NOT: return the raw `getAuthStatusWithBuckets` array (its shape may evolve / leak).
  [OK] DO: project to `AuthBucketStatus` copying the four named fields only.
- [ERROR] DO NOT: call `getToken()` (which may REFRESH / mint network calls) to read expiry.
  [OK] DO: use `peekStoredToken()` (no refresh, no side effects).
- [ERROR] DO NOT: skip the `authenticated` guard before peeking (avoid surfacing stale expiry for a
  logged-out provider).
  [OK] DO: only read expiry when `authenticated` is true.
- [ERROR] DO NOT: cache the OAuthManager or its results.
  [OK] DO: resolve `this.deps.getOAuthManager()` per call (R-DELEGATE).
- [ERROR] DO NOT: add a new constructor parameter to AgentImpl for the OAuthManager.
  [OK] DO: reuse the existing `this.deps.oauthManager` via a closure in `buildAuthControl()`.

---

## Behavior Decision Table

| GIVEN provider state | Method | Result (MASKED) |
|---|---|---|
| oauth enabled + authenticated, token.expiry=1700000000 | `detailedStatus(p)` | `{provider:p, authenticated:true, oauthEnabled:true, expiry:1700000000}` (no token) |
| oauth enabled, NOT authenticated | `detailedStatus(p)` | `{authenticated:false, oauthEnabled:true, expiry:undefined}` |
| authenticated but `peekStoredToken` → null | `detailedStatus(p)` | `{authenticated:true, expiry:undefined}` |
| api-key has higher precedence | `getHigherPriorityAuth(p)` | the source name string (e.g. `"key"`) |
| oauth is the winner | `getHigherPriorityAuth(p)` | `null` |
| two buckets, one session | `listBucketStatuses(p)` | length 2; each `{bucket,authenticated,expiry?,isSessionBucket}` only |
| any returned object | (all methods) | contains NO `access_token`/`refresh_token` key (R-NO-RAW-SECRETS) |
