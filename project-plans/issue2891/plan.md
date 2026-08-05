/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

# Issue #2891 — `/auth claudecode` broken on Windows

Test-first plan. Companion to [`findings.md`](./findings.md), which holds the
full investigation record (including the hypotheses that were **refuted**).

## 1. Reported behaviour

`llxprt --provider claudecode` on Windows, first-ever Claude Code login:

| Step | Action                                | Observed                                        |
| ---- | ------------------------------------- | ----------------------------------------------- |
| 1    | prompt                                | `No authentication available…`, **no browser**   |
| 2    | `/auth claudecode enable` + prompt    | same error                                      |
| 3    | `/auth claudecode login`              | `Successfully authenticated claudecode`          |
| 4    | prompt                                | same error                                      |
| 5    | exit, restart, prompt                 | **works**                                        |

Four observations a root cause must explain:

- **(a)** no lazy browser OAuth on the first prompt;
- **(b)** still failing immediately after a successful in-session login;
- **(c)** restart fixes it;
- **(d)** Windows, first-ever login on that machine.

## 2. What the investigation established

### 2.1 Confirmed cause of (a)

`handleClaudeCodeOAuth` (`providerSwitch.ts`) returns early at
`if (!context.autoOAuth) return;`, and `autoOAuth` was defaulted to `false` in
`createProviderSwitchContext` (`options.autoOAuth ?? false`).

On the `--provider claudecode` startup path nobody passes `autoOAuth: true`, so
**the lazy browser flow could never fire.** The user is handed a dead-end error
instead of an auth prompt. This is the primary defect and it fully explains (a).

### 2.2 Refuted: the fix suggested in the issue thread

The issue proposes flushing a "stale empty credential cache" after login. There
is **no such cache to flush**:

- `auth-precedence-resolver.fetchAndCacheOAuthToken` returns `null` **without**
  writing to the cache — there is no negative caching;
- `precedence.storeRuntimeScopedToken` only ever stores real tokens.

Applying that fix as prescribed would have been a no-op on a first-ever login.
This is called out explicitly so the PR does not silently contradict the issue.

### 2.3 Refuted: `OAuthManager` instance divergence

A dedicated harness proves startup identity **holds**: the single manager built
by `createProviderManager` reaches both `registerAliasProviders` and
`registerProviderManagerSingleton`, and still holds after post-`Config`
recomposition. Divergence is therefore **not** this bug's cause.

It remains a genuine *latent* hazard (reachable post-startup via
`disposeCliRuntime` / `runtimeLifecycle` singleton overwrites, and consequential
because `BaseProvider.updateOAuthConfig` has no production caller). Filed as
**#2991** — deliberately out of scope here. The proving harness
(`issue2891-oauth-manager-identity.test.ts`) ships with this PR so the hazard
stays pinned by a test rather than living only in prose.

### 2.4 Empirically: the core chain is not stale in-session

The reproduction harness drives the real object graph (real `OAuthManager`,
`KeyringTokenStore` over a temp dir, `ProviderRegistry`,
`TokenAccessCoordinator`, `AuthFlowOrchestrator`, `AnthropicProvider`), stubbing
only `AnthropicOAuthProvider.initiateAuth`. Post-login, same session, it returns
the real token. So (b) is **not** reproducible in the core chain alone; the
residual trigger is environmental (Windows keyring/bucket state) rather than a
caching defect in the auth chain.

## 3. Changes

| # | Change | Addresses |
| - | ------ | --------- |
| 1 | `autoOAuth` becomes tri-state (`boolean \| undefined`); `createProviderSwitchContext` stops coercing to `false` | (a) |
| 2 | New pure, exported `resolveLazyClaudeCodeOAuthDecision()` policy: explicit `true`/`false` honoured; `undefined` → attempt only when interactive **and** not an `agent`/`subagent` runtime | (a) |
| 3 | New `getActiveRuntimeKind()` accessor (never throws) | supports #2 |
| 4 | `ensureOAuthProviderRegistered` now attaches a late-arriving `addItem` to an already-registered provider (previously dropped by the dedup early-return), and `warn`s (was a silent `debug`) when no token store can be resolved | latent registration gaps |
| 5 | `loginWithBucket` invalidates provider caches on the **default**-bucket path, mirroring logout and the named-bucket path | defensive; (b) |
| 6 | Dead-end error text now says `Run /auth claudecode login` | user-facing (a) |

**Design note on #2.** A pure exported policy function keeps the decision
unit-testable away from runtime wiring, and the `undefined` default is
deliberately conservative: `readConfigInteractive` returns `false` when the
signal is absent, so a browser flow can never auto-launch in a headless, agent,
or subagent context. The three existing suppression sites (profile application,
same-provider switch, welcome onboarding) pass explicit `false` and so are
unaffected.

**Design note on #5.** This is hardening, not the bug's mechanism (see §2.2) —
it is a no-op on a first-ever login and matters only when a previous real token
is being replaced. `invalidateProviderRuntimeCache` is idempotent, so the
unconditional call is safe.

## 4. Behavioural tests (no mock theater)

All tests drive real objects; only the browser-opening `initiateAuth` is stubbed.

| File | Coverage |
| ---- | -------- |
| `providers/src/runtime/__tests__/issue2891-lazy-oauth-gating.test.ts` | the tri-state policy: explicit `true`/`false`, `undefined` + interactive, `undefined` + non-interactive, agent/subagent suppression |
| `providers/src/composition/__tests__/issue2891-oauth-provider-registration.test.ts` | token store resolved from the manager; late `addItem` attached to an already-registered provider; missing token store warns |
| `providers/src/auth/__tests__/issue2891-claudecode-stale-oauth.test.ts` | full-graph repro: first prompt → enable → lazy fail → login → same-session prompt → fresh-graph restart |
| `providers/src/auth/__tests__/issue2891-oauth-manager-identity.test.ts` | startup manager identity holds; post-startup divergence is real and consequential |
| `cli/src/ui/commands/authCommand.loginWithBucket.issue2891.test.ts` | default-bucket login triggers cache invalidation |

## 5. Verification

`npm run format`, `npm run lint`, `npm run typecheck`, `npm run test`,
`npm run build`, plus
`bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.

Known-unrelated pre-existing local failures: `scripts/tests/bun-test-manifest.test.ts`
asserts POSIX separators and fails on Windows.
