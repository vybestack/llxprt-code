# Issue #3451 — Diagnosable credential-resolution failures for subagent runtimes in a sandbox

## Problem restated from evidence

A subagent launch inside a podman sandbox failed with:

```
ProviderCacheError("Auth token unavailable for runtimeId=8c854271-...#typescriptexpert#ec0977da (REQ-SP4-003).")
```

while the parent session kept making provider calls on the same stack. The
failure is intermittent: subagents launch successfully in other concurrent
sessions on the same host.

## Root-cause analysis

### Why the parent survives and a new subagent runtime does not

The resolved-credential cache is keyed by `runtimeId`:

- `packages/auth/src/precedence.ts:119` — `runtimeScopedStates = new Map<string, RuntimeScopedState>()`
- `packages/auth/src/precedence.ts:217` — `runtimeScopedStates.get(runtimeId)`
- `packages/auth/src/precedence.ts:255-279` — `getValidCachedEntry` keyed by
  `${runtimeAuthScopeId}::${providerId}::${profileId}`

Every subagent launch mints a brand-new runtime id:

- `packages/agents/src/core/subagentOrchestrator.ts:598-601` —
  `` `${this.baseSessionId()}#${subagentName}#${suffix}` ``

So the parent resolves its credential once and is served from its runtime-scoped
entry on every subsequent call, whereas each new subagent runtime starts with an
empty cache and must perform a live credential resolution. Inside a sandbox that
live resolution is the credential-proxy hop
(`LLXPRT_CREDENTIAL_SOCKET`, `packages/providers/src/auth/proxy/credential-store-factory.ts:283,364`).

This is the asymmetry named in acceptance criterion 3. The cache scoping itself
is correct: a subagent runtime must not inherit the parent's credential cache.
What is defective is that the first-call failure in that new scope is flattened
into an empty string, which is why the symptom is intermittent and undiagnosable.

### Why the message carries no information

Three layers discard the cause:

1. `packages/auth/src/auth-precedence-resolver.ts:352-357` —
   `fetchAndCacheOAuthToken` catches every error and returns `null`, logging only
   under `DEBUG`. A proxy transport failure and "nothing configured" become the
   same `null`.
2. `packages/auth/src/auth-precedence-resolver.ts:644-652` — `readKeyFile`
   catches and returns `null` the same way.
3. `packages/providers/src/BaseProvider.ts:826-833` — `resolveAuthentication()`
   returning `null` becomes `''`, and the provider renders `''` as the
   `ProviderCacheError(...)` string at
   `AnthropicProvider.ts:220`, `OpenAIProvider.ts:228`,
   `openai-vercel/vercelModelClient.ts:185`.

The transport layer below already produces precise, distinguishable errors and
every one of them is thrown away: `packages/auth/src/proxy/proxy-socket-client.ts`
distinguishes `UNAUTHORIZED` handshake rejection, generic handshake failure,
per-request timeout (`REQUEST_TIMEOUT_MS = 30000`), and
`Credential proxy connection lost`, and it idle-closes the connection after
`IDLE_TIMEOUT_MS = 300000`. A subagent launched after the parent has been quiet
is exactly the case that must reconnect.

## Accepted behavior

### AB1 — Typed credential-resolution error

A `CredentialResolutionError` is thrown instead of an interpolated
`ProviderCacheError(...)` string. It carries a discriminated `kind`:

| kind                       | meaning                                                     |
| -------------------------- | ----------------------------------------------------------- |
| `no-credential-configured` | no auth mechanism was configured for the provider/profile   |
| `credential-not-found`     | source was reached, credential absent (proxy `NOT_FOUND`)   |
| `credential-source-failed` | configured source failed (keyfile unreadable, lookup threw) |
| `proxy-unavailable`        | credential proxy transport failed                           |
| `proxy-unauthorized`       | credential proxy refused the capability token               |

`proxy-unavailable` and `proxy-unauthorized` satisfy acceptance criterion 2:
transport failure is a distinct `kind` from `no-credential-configured` and
`credential-not-found`, both in the type and in the message.

### AB2 — Diagnostics payload

The error carries, and its operator-facing message states:

- `provider` — provider id being resolved
- `profile` — profile name, or an explicit "no profile" marker
- `runtimeId` — the failing runtime id
- `attemptedMechanisms` — ordered list of what was tried, e.g.
  `provider-auth-key`, `provider-auth-keyfile`, `global-auth-key-name`,
  `env:<VAR>`, `oauth`
- `proxyMode` — whether the process is in credential-proxy mode
- `proxyContacted` — whether a request actually reached the proxy

This satisfies acceptance criterion 1.

### AB3 — Stop swallowing causes

`readKeyFile` and `fetchAndCacheOAuthToken` stop converting failures into a
silent `null`. Each records the underlying error so the resolver can classify it.
The originating error is preserved as `cause`.

`resolveAuthentication()` keeps its `Promise<string | null>` contract so
`hasNonOAuthAuthentication` and `isOAuthOnlyAvailable` are unaffected. A new
result-returning entry point exposes the failure to callers that need it.

### AB4 — Provider call sites throw the typed error

`AnthropicProvider`, `OpenAIProvider` and `vercelModelClient` throw the typed
error carrying the resolver's diagnostics when resolution failed, and a
`no-credential-configured` error naming provider/profile/runtimeId/proxyMode when
nothing was configured.

### AB5 — Secrets stay out of the payload

No credential value, capability token or key material appears in the message or
diagnostics. Follows the existing redaction convention (`maskToken` in
`precedence.ts`, `REDACTED` in `oauth-errors.ts`).

## Explicitly out of scope

- Rewiring subagent credential plumbing. Evidence does not support a categorical
  subagent auth defect; subagents launch successfully in concurrent sessions.
  Acceptance criterion 3 is satisfied by identifying the cache-scope mechanism
  above and fixing the swallowing that made it undiagnosable, not by changing
  how subagent runtimes obtain credentials.
- Changing cache scoping, TTLs, or proxy connection lifetime.
- Retry or reconnect policy for the credential proxy.
- Issues #3449, #3450, #3440.

## Test plan (written first, behavioral, `bun:test`)

No mock theater. Transport failures are exercised against a real unix-socket
server, following `packages/auth/src/proxy/__tests__/proxy-socket-client.test.ts`.

### T1 — resolver classification (`packages/auth`)

1. Nothing configured → `kind: 'no-credential-configured'`, `proxyContacted:false`,
   `attemptedMechanisms` lists what was checked.
2. Named key configured, storage returns `null` → `kind: 'credential-not-found'`.
3. Named key configured, storage throws a transport error → `kind:'proxy-unavailable'`,
   `proxyContacted: true`, `cause` preserved.
4. Proxy handshake rejects with `UNAUTHORIZED` → `kind: 'proxy-unauthorized'`.
5. `auth-keyfile` points at an unreadable path → `kind:'credential-source-failed'`,
   cause preserved, and the failure is no longer silent.
6. OAuth manager `getToken` throws → surfaces as a classified failure rather than
   `null`.
7. Message and diagnostics contain no credential material for every case above.

### T2 — runtime-scope asymmetry (`packages/auth`)

Proves the AC3 mechanism against the real `precedence.ts` cache:

1. A runtime that has already resolved serves from cache and performs no live
   credential call.
2. A second, freshly minted runtime id for the same provider/profile misses the
   cache and performs a live call.
3. When that live call fails, the second runtime raises a classified
   `CredentialResolutionError` while the first continues to resolve from cache.

### T3 — provider surface (`packages/providers`)

For `OpenAIProvider`, `AnthropicProvider` and `vercelModelClient`:

1. Failed resolution throws `CredentialResolutionError`, not a string containing
   `ProviderCacheError(`.
2. The message names provider, profile and proxy-contacted status.
3. `requires-auth: false` and local-endpoint exemptions still bypass the error.

### T4 — end to end under a sandboxed proxy (`packages/providers`)

Using the existing credential-proxy test harness:

1. Proxy up, credential present → subagent-shaped runtime resolves successfully.
2. Proxy socket closed before the subagent runtime's first call → the launch
   fails with `kind: 'proxy-unavailable'` naming the profile and provider, while
   a parent runtime with a warm cache is unaffected.
3. Proxy up, credential absent for that profile → `kind:'credential-not-found'`,
   distinguishable from case 2.

## Verification

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
`npm run build`, then
`bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.
