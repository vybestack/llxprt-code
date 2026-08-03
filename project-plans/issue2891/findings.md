# Issue #2891 — `/auth claudecode` broken on Windows (in-session)

## Reported behaviour

Version `0.11.0-nightly.260731.fc1e89567`, Windows. `llxprt --provider claudecode`:

1. Prompt → `API Error: No authentication available for Anthropic API calls. Use /auth claudecode to re-authenticate or /auth claudecode logout to clear any expired session.`
2. `/auth claudecode enable`, prompt again → same error.
3. `/auth claudecode login` → `Successfully authenticated claudecode` (token **is** persisted).
4. Prompt again → same error.
5. Exit + restart → **works**.

Reporter notes it was the first ever claudecode login on that machine, and that it also
fails in a non-elevated PowerShell (so it is not an admin/elevation problem).

Four observations any root cause must explain:

- **(a)** No lazy browser OAuth flow on the first prompt.
- **(b)** Still failing immediately after a successful in-session login.
- **(c)** Restart fixes it.
- **(d)** Reported on Windows, on a first-ever login on that machine.

## Empirical result (ground truth, not speculation)

A behavioural reproduction harness was built at
`packages/providers/src/auth/__tests__/issue2891-claudecode-stale-oauth.test.ts`
using the real object graph (real `OAuthManager`, `ProviderRegistry`,
`TokenAccessCoordinator`, `AuthFlowOrchestrator`, `KeyringTokenStore`,
`AnthropicProvider`, `AnthropicOAuthProvider`), stubbing only the outermost
browser/HTTP boundary (`AnthropicOAuthProvider.initiateAuth`).

Command:

```
bun test packages/providers/src/auth/__tests__/issue2891-claudecode-stale-oauth.test.ts
```

Observed output:

```
[issue2891] Phase E (same-session post-login) token: "sk-ant-oat-test-2891-valid"
[issue2891] Phase F (fresh graph) token: ""
```

**Phase E — the same-session post-login resolution — SUCCEEDED.**

This is the opposite of the assumed failure and is the single most important
finding so far:

> When `/auth ... login` and the chat path share **one** `OAuthManager` instance
> and **one** `AnthropicProvider` instance, the post-login same-session
> resolution already works today. There is no stale-empty-credential cache in
> the core auth chain.

The Phase F failure is a **defect in the harness**, not in the product: it calls
`settings.setOAuthEnabled('claudecode', true)` and then
`oauthManager.toggleOAuthEnabled('claudecode')`, which toggles the flag back
**off**. The harness must be corrected before it is used as a regression test.

### Consequence

CodeRabbit's hypothesis on the issue — that
`AuthFlowOrchestrator.doInitiateAuth()` fails to invalidate a runtime credential
cache, leaving a "stale empty credential" — is **not supported** by the observed
behaviour. Corroborating static evidence:
`AuthPrecedenceResolver.fetchAndCacheOAuthToken` (`packages/auth/src/auth-precedence-resolver.ts` L375-392)
returns `null` **without caching** when the token is null/empty, and
`storeRuntimeScopedToken` (`packages/auth/src/precedence.ts` L359) only stores
real tokens. There is no negative caching at that layer. Do not implement that
fix without new evidence.

## Confirmed root cause of observation (a) — no lazy OAuth

`packages/providers/src/runtime/providerSwitch.ts`:

- `handleClaudeCodeOAuth()` (L487-544) is the only code that can start a lazy
  Claude Code OAuth flow on a provider switch.
- It returns early at **L506-508** when `context.autoOAuth` is falsy.
- `autoOAuth` is defaulted to **`false`** at **L775** (`autoOAuth: options.autoOAuth ?? false`),
  and is explicitly forced to `false` at L741, at
  `packages/providers/src/runtime/profileApplication.ts` L660, and at
  `packages/cli/src/ui/hooks/useWelcomeOnboarding.ts` L374-377.

So on the `--provider claudecode` startup path the lazy browser flow is
**never** initiated; the user is only ever shown the terminal error. This fully
explains **(a)** and matches the reporter's first expectation
("lazy authentication should work so long as auth is enabled").

Note that the registration call immediately above the gate,

```ts
ensureOAuthProviderRegistered('claudecode', oauthManager, undefined, context.addItem);
```

(L499-504) passes `undefined` for the token store. That is survivable because
`ensureOAuthProviderRegistered` falls back to `oauthManager.getTokenStore?.()`
(`packages/providers/src/composition/oauth-provider-registration.ts` L52), but it
is fragile: if the manager exposes no token store the provider is silently not
registered (L53-59), and `TokenAccessCoordinator.getToken()` then returns `null`
immediately because `providerRegistry.getProvider('claudecode')` is falsy
(`packages/providers/src/auth/token-access-coordinator.ts` L495-500).

There is a second latent hazard in the same function: the dedup set is keyed per
manager (L43-50), so if `claudecode` was already registered **without** an
`addItem` UI callback, this later call **with** `context.addItem` short-circuits
at L48-50 and the OAuth provider permanently keeps a missing UI callback.

## Leading hypothesis for (b), (c), (d) — instance divergence

Since a single shared graph works (Phase E), the in-session failure most likely
comes from `/auth claudecode login` mutating a **different** `OAuthManager` /
`ProviderRegistry` instance than the one bound into the live `AnthropicProvider`.

Supporting evidence:

- `packages/providers/src/composition/providerManagerInstance.ts` holds a single
  mutable `singletonOAuthManager` (L62), set by `registerProviderManagerSingleton`
  (L713-718) and read by `getOAuthManager()` (L749).
- `/auth` resolves its manager through that singleton
  (`packages/cli/src/ui/commands/authCommand.ts` L59, L79, L100).
- The chat provider does **not**. `registerAliasProviders` receives an
  `oauthManager` parameter and binds it at construction time for the
  `claudecode` alias only
  (`packages/providers/src/composition/aliasProviderFactory.ts` L497-503 →
  `createAnthropicAliasProvider` L400-434).
- The singleton can be **replaced or reset after startup** by
  `registerCliProviderInfrastructure` (`packages/providers/src/runtime/runtimeLifecycle.ts` L139-141)
  and by runtime disposal (`packages/providers/src/runtime/runtimeRegistry.ts` L339-346,
  which either re-registers a replacement or calls `resetProviderManager()`).
  Agent runtimes register with `registerAsGlobalSingleton: false`, so multiple
  managers can coexist.

If the provider instance holds manager **A** while `/auth` mutates manager **B**,
then enabling and logging in are invisible to the chat path, and only a restart
(which rebuilds both from the persisted token/settings) recovers — exactly
**(b)** and **(c)**.

This divergence would also be timing/ordering sensitive, which is consistent
with **(d)** being reported on Windows on a first-ever login, where no persisted
token or `oauthEnabledProviders.claudecode` setting exists yet to mask it.

### Why the config snapshot alone is not the answer

`AnthropicProvider` sets `isOAuthEnabled: !!oauthManager` and
`oauthProvider: 'claudecode'` in its constructor
(`packages/providers/src/anthropic/AnthropicProvider.ts` L82-95), which
`BaseProvider` snapshots into the `AuthPrecedenceResolver` config
(`packages/providers/src/BaseProvider.ts` L144-166).
`AuthPrecedenceResolver.canResolveOAuth()` (L261-266) requires
`isOAuthEnabled === true`. Because `registerAliasProviders` always passes a real
manager for the `claudecode` alias, this snapshot is `true` in practice, so it is
**not** by itself the cause — but note that `BaseProvider.updateOAuthConfig()`
(L522-542), the only method that could refresh this snapshot, has **no
production caller** (only `BaseProvider.test.ts` L713, L719). Any fix that
depends on rebinding a manager post-construction must address this.

## Instance divergence: mechanism real, but NOT the cause here

Proven by `packages/providers/src/auth/__tests__/issue2891-oauth-manager-identity.test.ts`
(3 tests, 3 pass):

- **At normal `--provider claudecode` startup, identity HOLDS.** One
  `OAuthManager` created in `createProviderManager` (~L633) flows into BOTH
  `registerAliasProviders` → `new AnthropicProvider(..., oauthManager)` AND
  `registerProviderManagerSingleton`. It still holds after the post-Config
  recomposition, which re-points the chat path.
- **But divergence is reachable**: `registerProviderManagerSingleton`
  (L713-718) overwrites the mutable module-level `singletonOAuthManager` (L62),
  while a provider's manager reference is frozen at construction — the only
  rebinder, `BaseProvider.updateOAuthConfig` (L522-542) →
  `AuthPrecedenceResolver.updateOAuthManager`, has **no production caller**.
  Reachable via `disposeCliRuntime` (`runtimeRegistry.ts` L339-346).
- When diverged, `/auth claudecode enable` mutates the singleton while the live
  chat provider keeps the old manager — invisible.

**Verdict: a real latent hazard worth guarding, but it does NOT explain this
report, because a plain single-session startup does not diverge.**

## Leading hypothesis for (b)/(c): session-bucket poisoning

Reconstructing the reported sequence against
`packages/providers/src/auth/token-access-coordinator.ts`:

1. Startup: OAuth provider registered; lazy flow skipped (`autoOAuth` false).
2. Prompt 1: `getToken()` → OAuth not enabled yet → `shouldRequireOAuthEnabled`
   → returns `null` (L553-564) → `''` → the reported error. Matches.
3. `/auth claudecode enable` → now enabled.
4. Prompt 2: `getToken()` → no token on disk → `getTokenTriggerAuthIfNeeded`
   (L611) → `performDiskCheck` returns `undefined` → `triggerAuthFlow` (L777).
   This attempts a browser flow that fails on the user's machine; the failure is
   swallowed and `null` is returned → the same error. **Crucially,
   `triggerAuthFlow` calls `setSessionBucket(...)` (~L825), and
   `resolveImplicitBucket` also sets a session bucket at L365-371.**
5. `/auth claudecode login` → succeeds, persisting to `claudecode:default`.
6. Prompt 3: reads go through `resolveTokenRequestBucket` (L459-466) →
   `resolveImplicitBucket`, which now returns the **poisoned session bucket**
   from step 4. If that bucket is not `default`, the lookup key is
   `claudecode:<other>` → MISS → `''` → same error.
7. Restart: session-bucket state is in-process only, so it clears → the
   persisted `claudecode:default` token resolves → **works**.

This explains **(b)** and **(c)** precisely, and explains why the harness did
NOT reproduce them: in the harness the stubbed `initiateAuth` threw immediately,
before any session bucket was set, and no multi-bucket state existed.

It is also consistent with **(d)**: on a first-ever login there is no persisted
token or bucket configuration to mask the mismatch.

**Status: HYPOTHESIS — not yet reproduced.** To confirm, assert the session
bucket value after a FAILED lazy auth attempt, then verify the post-login read
key.

## Final status (resolved)

- **(a)** no lazy OAuth on the first prompt: **CONFIRMED and FIXED.**
  `createProviderSwitchContext` coerced `autoOAuth` to `false`
  (`options.autoOAuth ?? false`), and `handleClaudeCodeOAuth` returned early on
  `if (!context.autoOAuth)`. Lazy OAuth could therefore never fire on the
  `--provider claudecode` startup path. `autoOAuth` is now tri-state
  (`boolean | undefined`) and the decision is made by the exported pure function
  `resolveLazyClaudeCodeOAuthDecision`: explicit `true` always attempts,
  explicit `false` never attempts (all three existing suppression sites keep
  working), and `undefined` derives the answer, attempting only in an
  interactive, non-agent runtime. A browser is never launched headlessly.

- **(b)** login succeeds but the next prompt still fails: **NOT REPRODUCIBLE in
  the real object graph.** Two independent behavioural harnesses (one driving
  `oauthManager.authenticate` directly, one driving the real
  `AuthCommandExecutor.execute('claudecode login')` command path) both show the
  SAME live `AnthropicProvider` returning the freshly persisted token with no
  restart. Mutation-checked: the command-path test still passes with the
  `authCommand.ts` change reverted, which confirms the post-login invalidation
  is defensive hardening rather than the mechanism.

- **CodeRabbit's prescribed fix is WRONG.** It assumes a stale empty/negative
  credential cache that must be flushed after login. No such cache exists:
  `fetchAndCacheOAuthToken` returns `null` WITHOUT storing anything, and
  `storeRuntimeScopedToken` stores only real tokens. There is nothing negative
  to invalidate, which is exactly why the mutation check passes either way.

- **(d)** "first-ever login on that machine" is incidental. `probeCache` in the
  secure store caches keyring AVAILABILITY, not token values, and the
  `consecutiveKeyringFailures` threshold gates fallback selection, not token
  reads. Since the reported login succeeded and persisted, the keyring write
  worked; (d) just means no prior token existed.

- **Instance divergence: REFUTED as this bug's cause, retained as a latent
  hazard.** At startup the manager bound into the live provider IS the instance
  `getOAuthManager()` returns, and it stays that way for the session (asserted
  by a dedicated test). Divergence is still reachable AFTER startup via
  `disposeCliRuntime` / `registerCliProviderInfrastructure` singleton
  overwrites, and is behaviourally consequential because the only rebinder,
  `BaseProvider.updateOAuthConfig`, has no production caller. Tracked
  separately; deliberately out of scope here.

## What shipped

1. `providerSwitch.ts` - tri-state `autoOAuth` plus
   `resolveLazyClaudeCodeOAuthDecision`; passes a real token store to
   `ensureOAuthProviderRegistered` instead of `undefined`.
2. `runtimeAccessors.ts` - `getActiveRuntimeKind()`, never throws.
3. `authCommand.ts` - post-login re-sync, closing the DEFAULT-bucket gap that
   `activateNamedLoginBucket` never covered (defensive; see note above).
4. `oauth-provider-registration.ts` - a later `addItem` UI callback is attached
   to the already-registered provider instead of being silently dropped; the
   missing-token-store path now warns instead of logging at debug.
5. `AnthropicProvider.ts` - the dead-end error now names the exact command:
   "Run /auth claudecode login to authenticate".

## Residual risk

Because (b) could not be reproduced, the possibility remains that the
reporter's environment hit post-startup manager divergence or a session-bucket
edge case. Fix (a) makes that path far less likely to be reached at all, since
the user is now authenticated up front rather than being left to discover the
dead-end error. If (b) recurs after this fix, the divergence hazard is the next
place to look.
