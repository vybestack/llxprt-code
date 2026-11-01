# Issue #3991: request-scoped Codex credentials

## Evidence and confidence

Main baseline: `13960b4dbe`. Existing session is a global bundled CLI launched
before the latest storage patch. Workspace changes cannot replace its loaded
code. Exact loaded old version is unknown. Live recurrence alone does not prove
that current source regressed.

Independent Sonnet investigation on current source reproduced the false OAuth
error after a successful bearer read: three consecutive keyring nulls or one
thrown read at the separate account lookup abort the request. A real
SecureStore → KeyringTokenStore → OAuthManager → Codex provider prototype also
reproduced account A's bearer paired with account B's ID across WS fallback.
Its five atomic-credential cases fail on baseline. Synthetic keyring/network
only; no real credentials modified.

An unbiased fresh-source Opus run using the existing `opus` profile independently
identified duplicate lookups, profile/bucket mismatch, and pre-merge validation
of refresh responses without `id_token`. Opus specified reproductions but did
not execute tests. Its output is scoped local evidence, not a live incident trace.

## Why previous fixes were incomplete

- #3914 addresses expired-token refresh-lock contention.
- #3966 confirms up to two transient null reads at the storage boundary.
- Neither makes account identity and bearer one authorization result.
- Anthropic has no independent account-header lookup, so it lacks this additional
  failure and account-mismatch path. It can still suffer genuine storage outages.
- Native read-error fidelity remains tracked separately in #3067.

## Implementation plan and invariants

1. Promote failing real-graph atomic credential cases and verify refresh-without-
   identity failure before production edits.
2. Preserve the existing getToken fallback/peek/disk/refresh/auth semantics while
   adding a full-token resolution operation. Project only minimal account
   identity beside the bearer in authorization results. Never transport refresh
   tokens or ID tokens into request metadata/dumps.
3. Resolve a request-local bearer/account pair from the same profile/bucket-aware
   operation; carry it through HTTP, WS, fallbacks, retries and diagnostics.
   No global credential cache and no second storage read after authorization.
4. Fail closed when legacy pre-resolved bearer cannot be safely paired. Preserve
   non-Codex precedence and isolate concurrent invocations. Subsequent requests
   must observe logout/rotation; cancellation and manager lifetime remain bounded.
5. Preserve known account identity when successful refresh omits id_token, and
   retain rotated refresh credentials. Validate merged output before saving.
6. Do not turn known storage infrastructure failures into login guidance.
7. Test named buckets, rotation, fallback, concurrency, absence/logout, refresh,
   proxy sanitization and lifecycle behavior through public boundaries.

## Verification

Record RED/GREEN evidence per slice, isolated focused suites, test-audit delta,
full tests/lint/typecheck/format/build and source-launched smoke. Build/typecheck
must be serial to avoid declaration races. Independent review is capped at two
rounds. Existing configured smoke fallback is `gpt-luna-high`; `luna` is absent.

## Completion

No credentials/settings changes, no merged PR, no universal keyring availability
claim. PR must distinguish tested current-source repairs from the old running
bundle. Follow full CI/review workflow without merging.

## Recovery checkpoint (implementation subagent, 2026-10-30)

Scope: atomic request-credential slice only. Parent owns auth flows, codex
device-flow refresh without `id_token`, and the provider refresh regression;
none of those were touched.

Logs (`project-plans/.tmp-issue3991/`): `red-baseline.log` (new Codex behavior
test: 8 pass / 10 fail on baseline), `red-auth-resolver.log` (auth
credential-resolution: 16 pass / 7 fail before production edits),
`green-providers-responses.log` (combined run, 130 fail: bun cross-file mock
pollution, not reliable), `green-responses-per-file.log` (isolated per file),
`green-final.log`, `tsc-providers.log`.

GREEN, run isolated per file:
- auth `credential-resolution.test.ts`: 23 pass / 0 fail.
- `codex-request-credential.behavior.test.ts`: 18 pass / 0 fail. Real
  SecureStore -> KeyringTokenStore -> OAuthManager -> provider graph with named
  bucket (`team-b`), rotation between WS attempt and HTTP fallback, truly
  concurrent requests, rotation observed by the next request, logout before
  wire, missing identity, dumps without credential material, admission refusal,
  dispose during read, cancel during read, locked/absent/corrupt/disabled store.
- All `providers/src/auth/**` and `providers/src/openai-responses/**` test files
  run one file at a time: all pass after the fixes below. Exception seen once:
  `e2e-credential-flow` Scenario 5 (timing-sensitive, ran concurrently with
  another suite); reran twice alone, 12 pass / 0 fail.
- 51 auth/providers files matching precedence|credential|peek|fallback|bucket|
  authToken|BaseProvider: all exit 0 (`green-final.log`).

Fixes in this slice:
1. `OpenAIResponsesProviderBase.resolveResponsesRequestCredential`: non-Codex
   modes call `getAuthTokenForPrompt()` again, so existing provider/test
   specialisations of that seam still apply (fixed the prompt-envelope
   "resolves fresh authentication only when transporting" regression).
2. Seven Codex fixtures paired a constructor bearer (`codex-api-key`,
   `test-api-key`) with an OAuth manager token whose `access_token` differed.
   That is the account-mismatch pairing the contract now rejects (fail closed),
   so the fixtures were made coherent (bearer equals stored `access_token`):
   websocketFallback, codex.stateless, codex.noSyntheticInjection,
   codex.stateful.remediation, media-resolution.stateful, malformedCallId.
3. Restored the deleted ~70-line liveness test `A3/3159: keeps the WebSocket
   transport in the dump when header observation fails`. It now calls the real
   `dumpFinalizedRequest` with a credential that has no account identity (the
   current way header observation fails), and asserts method `SEND`, `wss://`
   URL, websocket transport, and empty headers. Passes.
4. New test typed with `CodexOAuthToken`; lint fixes (optional chain,
   expression complexity, prefer-const).

Static checks: `tsc --noEmit` auth: clean. Providers: 2885 lines, nearly all
pre-existing stale-declaration noise in untouched test lines; two errors in the
new test were fixed (`CodexOAuthToken`). Not re-run after the fix. Scoped eslint
on all changed TS: clean except `max-lines` in `BaseProvider.ts` (838, raw file
already 1150 lines at HEAD) and `token-access-coordinator.ts` (806 vs 800;
likely introduced here, needs a small extraction by the owner).

Gaps: no full suite/build; providers tsc not re-run after final edits; agents
`responses-lifecycle-*` tests not re-run; coordinator `max-lines` unresolved;
no live keyring/network checks. No commits.

## Recovery checkpoint (focused lint extraction, 2026-10-30)

Scope: behavior-preserving lint extraction only in `issue3991`. Initial exact
command `bunx eslint packages/providers/src/BaseProvider.ts packages/providers/src/auth/token-access-coordinator.ts --max-warnings 0`
reported only `max-lines`: BaseProvider 838 effective lines and coordinator 806,
with the existing 800-line ceiling. No limits, suppressions, refresh flows or
auth-precedence contracts changed. No new casts or `any`.

Extractions:
- New 2026 `packages/providers/src/utils/provider-settings.ts`: existing model
  parameter filtering, falsy-like fallback classification, `ProviderSettings`
  type, and provider-default projection. BaseProvider delegates and re-exports
  `ProviderSettings` so existing imports remain compatible. Credential aliases
  remain stripped; fallback model evaluation remains lazy.
- Existing `packages/providers/src/auth/token-profile-resolver.ts`: extracted
  `resolveCurrentProfileSessionBucket`, preserving scoped-session lookup first,
  sole profile bucket next, then compatible unscoped session. Coordinator
  delegates with owner-bound callbacks; refresh code is untouched.
- Added `utils/provider-settings.test.ts` and
  `auth/token-profile-session-bucket.test.ts`, exercising real helpers without
  business-logic mocks, including credential stripping, falsy values, lazy
  reads/defaults, bucket compatibility and propagated profile-read failure.

RED evidence: new helper imports failed before the exports existed (not a
claimed behavioral regression). Logs in `project-plans/.tmp-issue3991/`:
`lint-extraction-red-settings.log`, `lint-extraction-red-bucket.log`,
`lint-extraction-red-defaults.log`.

GREEN: each file below ran in its own `bun test <path>` process. All 80 tests
passed, zero failures; full output: `lint-extraction-green.log`.
- `packages/providers/src/utils/provider-settings.test.ts`: 6 pass.
- `packages/providers/src/auth/token-profile-session-bucket.test.ts`: 6 pass.
- `packages/providers/src/BaseProvider.test.ts`: 27 pass.
- `packages/providers/src/__tests__/BaseProvider.concurrentCallScoping.behavior.test.ts`: 1 pass.
- `packages/providers/src/__tests__/BaseProvider.guard.test.ts`: 2 pass.
- `packages/providers/src/__tests__/baseProvider.stateless.test.ts`: 5 pass.
- `packages/providers/src/__tests__/BaseProvider.proxyKeyStorage.test.ts`: 2 pass.
- `packages/providers/src/auth/oauth-profile-reads.behavior.test.ts`: 7 pass.
- `packages/providers/src/auth/__tests__/forceRefreshToken.bucketResolution.test.ts`: 6 pass.
- `packages/providers/src/openai-responses/codex-request-credential.behavior.test.ts`: 18 pass.

Final strict scoped ESLint: exit 0, zero warnings, using the unchanged 800-line
ceiling for both original files and all extracted helpers/tests:

```bash
bunx eslint packages/providers/src/BaseProvider.ts packages/providers/src/utils/provider-settings.ts packages/providers/src/utils/provider-settings.test.ts packages/providers/src/auth/token-access-coordinator.ts packages/providers/src/auth/token-profile-resolver.ts packages/providers/src/auth/token-profile-session-bucket.test.ts --max-warnings 0
```

Output: `lint-extraction-eslint.log`. Prettier `--check` on those same six files
passed. Scoped `git diff --check` passed. No full suite, typecheck, build,
corpus-wide test-audit, commit, push or merge was run in this focused slice.
Earlier checkpoint sections and other agents' implementation changes preserved.

## Refresh without id_token slice (#3991)

Defect (independently verified): `CodexDeviceFlow.refreshToken` built its result
with `CodexOAuthTokenSchema.parse({... account_id: undefined})` when the refresh
response had no `id_token`. The strict schema requires `account_id`, so a
successful HTTP 200 refresh threw a ZodError; `CodexOAuthProvider.refreshToken`
caught it and returned `null`. The provider's "preserve account_id/id_token"
merge was unreachable, and the rotated refresh token was never persisted.

RED (before any production change):
- `packages/auth/src/__tests__/codex-refresh-identity.test.ts`: 3 pass / 2 fail
  (no id_token -> ZodError `account_id` Required; non-rotating response -> same).
- `packages/providers/src/auth/__tests__/codex-refresh-without-id-token.behavior.test.ts`:
  3 pass / 1 fail. Failing test: refreshed and next reads return no token,
  persisted token stays `old-access`/`old-refresh`, 2 refresh calls instead of 1.
  The three passing tests (changed account, missing prior identity, malformed
  id_token) guard behavior that must not regress.

Fix:
- `auth/src/types.ts`: new `CodexRefreshedTokenSchema`/`CodexRefreshedToken`
  (`account_id` optional); exported type from `auth/src/index.ts`. Login and
  code exchange keep strict `CodexOAuthTokenSchema`.
- `codex-device-flow.ts`: `refreshToken` returns `CodexRefreshedToken`.
- `codex-oauth-provider.ts` `refreshToken`: account = refreshed id_token account
  ?? stored `account_id`; if neither, return `null` (fail closed, nothing
  persisted); id_token = refreshed ?? stored. Removed the casts; stored fields
  are read with a `typeof` check. Access JWT is never parsed.

GREEN: auth identity test 5/5; provider behavior test 4/4. Also pass:
`codex-device-flow.test.ts` 11, `codex-device-flow.di.test.ts` 17,
`codex-oauth-provider.spec.ts` 15, `codex-oauth-provider.single-flight.spec.ts` 2.
`tsc --noEmit` auth clean; providers has no errors in touched files (other
pre-existing noise untouched). eslint + prettier clean on touched files.

Not run: full suites, build, live network/keyring. Residual risk: a stored
Codex token that already lacks `account_id` now forces re-auth on refresh
instead of silently retrying forever.

## Review remediation round 1 (Opus r1: PASS with lows)

Scope: F1, F2, F4 fixed; F3 recorded. No commits, no full checks or build.

### F1: full credential without `account_id` made a second store read
Cause: `projectOAuthCredential` returned `{ token }` for a full OAuth token with
no identity. `resolveResponsesRequestCredential` could not tell that from a
legacy pre-resolved bearer and called `pairLegacyBearerWithIdentity`, which
re-reads the store.

Marker: `identity?: 'absent'` on `ResolvedBearer` (auth, exported type behind
`CredentialResolutionResult`) and on `RequestCredential` (providers). It is set
only when the OAuth source read the FULL token and it has no account id. It
holds no credential material and there is no process-level cache.
`toRequestCredential` (`providers/src/utils/authToken.ts`) copies exactly
`token`, `accountId` and `identity` in both `BaseProvider` paths
(`getRequestCredentialForPrompt`, `provideCredential`). The Codex base provider
now throws `credential-not-found` ("no account identity ... /auth codex login")
on `identity === 'absent'` without any read. A bearer-only source (manager
without `resolveToken`, constructor key, auth-key) carries no marker and keeps
the single equality-guarded legacy read.

RED (tests strengthened first):
- `codex-request-credential.behavior.test.ts` "rejects before the wire when the
  stored credential has no account identity": `readsDelta` expected 1, received
  2 (second store read). Also now asserts `kind === 'credential-not-found'` and
  the login remediation.
- `credential-resolution.test.ts` "marks a full token without an account id as
  having no identity": expected `{ token, identity: 'absent' }`, received
  `{ token }`.

GREEN: both pass; transient-null (#3965) suite unchanged and passing.

### F2: legacy mismatch fail-closed was untested
Added real-graph `it.each` in `codex-request-credential.behavior.test.ts`: a
pre-resolved constructor API key and an `auth-key` setting whose bearer
(`access-other`) differs from the stored credential (`access-A`) send nothing
and reject with `CredentialResolutionError` `credential-not-found`. These
passed immediately (the fail-closed pairing already existed); they are
regression guards, not RED-first. The `auth-key` case first failed only
because the test passed it as an ephemeral, which the resolver does not read;
the harness now sets it on the settings service.

### F4: misplaced JSDoc and weakened liveness test
- `storedStringField` moved above the `AuthFlightState` JSDoc; the "Codex OAuth
  Provider Implementation" JSDoc is directly on `CodexOAuthProvider` again.
- `openAIResponsesExecutor.liveness.test.ts`: new end-to-end executor test
  "a Codex credential without an account identity fails before any transport or
  dump, then the next request recovers". Real executor and dump writer, WS
  active, `dumpcontext: on`. First request: rejects with the missing-identity /
  login message, WS and `fetch` untouched, dump directory empty. After the
  credential gains an identity, the same deps recover: one WS send, one
  websocket-labelled dump with `ChatGPT-Account-ID` `[REDACTED]` and no account
  value in the file. The earlier low-level test is kept, renamed "dump guard",
  and its comment says it exercises the dump module alone with a context the
  executor never produces.
- Equivalence of the removed seam: the old test made the dump's SEPARATE
  `getCodexAccountId()` call throw while the handshake's call succeeded. With
  one resolved credential per request, dump and handshake read the same
  `RequestContext`, so that divergence cannot occur and no executor input
  reaches the dump's header-observation catch with a valid Codex context. The
  properties it protected are still covered: dump failure never blocks or
  mislabels (dump guard test), and a bad credential never reaches transport or
  dump (new test).

### F3 (unresolved, accepted caveat)
A refresh response with no `id_token` where the stored token also has no
account, or a malformed `id_token`, discards the server-rotated refresh token
(fail closed; the old token is kept). Pre-existing behavior narrowed by this
branch; not changed here. Mention in the PR.

### Results (each file in its own process)
- auth `credential-resolution.test.ts`: 23 pass / 0 fail
- providers `codex-request-credential.behavior.test.ts` (18 + 2 new
  mismatch cases): 20 pass / 0 fail
- providers `openAIResponsesExecutor.liveness.test.ts`: 9 pass / 0 fail
- providers `openai-responses-provider.codex-keyring-transient-null.test.ts`:
  7 pass / 0 fail
- agents `responses-lifecycle-retry.test.ts` 7 pass, and
  `subagent-interactive-retry.test.ts` 5 pass (lifecycle fixture)
- eslint (includes max-lines 800) and prettier were clean on the remediation's
  touched files. Package-only `tsc --noEmit` reported test-file errors; that
  invocation is not the authoritative full repository check and no baseline
  attribution is claimed here.
- Initial combined-file run failed the #3965 "obsolete fallback" test. Final
  independent review confirmed the process-wide keyring-disable flag leaked
  from the locked-keyring scenario. The final cleanup below fixes this.

## Final independent review and real-auth verification

- Actual Opus (`claude-opus-5-5`) final review: PASS, no HIGH findings. Two
  bounded implementation review rounds were performed independently from the
  implementation. Source-traced pairing, lifetime, auth precedence, bucket,
  refresh and dump behavior passed. Local OCR is unavailable.
- Final review's LOW-MEDIUM keyring test-state leak was fixed with
  `resetOsKeyringSessionForTesting()` before and after each real-graph case.
  The two previously incompatible files now run together: **28 pass, 0 fail**.
  That includes 21 atomic-credential cases and 7 existing #3965 regressions.
- Legacy mismatch cases now assert exactly one read and the explicit
  `could not be matched` diagnostic. A matching constructor-bearer case now
  verifies successful wire headers and exactly one identity read.
- Three separate fresh workspace-source invocations using the existing
  `gpt-luna-high` profile each returned `AUTH_OK`, exit 0. A fresh-source parent
  also invoked the existing quickcoder child successfully and reported exactly
  `AUTH_CHILD_OK`, exit 0. No auth toggles, relogin, forced refresh or credential
  edits were performed. Successful calls cannot prove there is no intermittent
  backend outage. The long-running global session still uses its original code.
- Full serial verification found actual new-code type errors: the extracted
  settings helper was too narrowly typed; a Bun `it.each` fixture inferred
  readonly buckets; a settings test supplied an invalid connection-policy key.
  All three were corrected without casts or changing production behavior.
  Do not describe the earlier failing full typecheck as passing. A final full
  typecheck is queued after the serial build to avoid declaration races.
- Remaining LOW follow-ups: malformed/no-identity refreshes still fail closed
  and can discard a server-rotated refresh token; legacy compatibility uses a
  minimal no-runtime metadata scope; the executor's defensive missing-identity
  guard uses a plain Error after the production provider's typed guard. These
  do not permit sending an unpaired credential.
- Logs remain in the project-owned issue scratch directory, outside the PR's
  staging scope. Final broad verification results will be appended when each
  phase records its actual exit status.

## Full-suite remediation (test-r2.log, exit 1)

Source: `project-plans/.tmp-issue3991/test-r2.log`. The log has 13 `(fail)`
lines. Four are the intentional failing fixtures printed by the core
`run_bun_tests` self-tests (`hang.test.ts` per-test timeout, and three
`fail.test.ts` assertion fixtures); the enclosing self-test files passed
(`Passed 15/15 isolated native Bun test files`). Nine failures in three files
were real. Providers reported `662/664 (2 failed)` and cli reported one FAIL
file; no other file failed. No claim is made about a baseline for these: all
three files exercise the new `resolveToken`/paired-credential path introduced by
this change, and each failure was traced to the cause below.

Root causes (all in test fixtures; no production regression found):

1. `lb-member-auth-identity.behavioral.spec.ts` (#2643, 2 failures).
   `RecordingOAuthManager` recorded only `getToken` calls. The resolver now
   reads the full credential through `OAuthManager.resolveToken` when present,
   so the recorder saw `[]`. Fix: the recorder also overrides `resolveToken`,
   recording the same request metadata then delegating to `super`. Assertions
   (member profile ids, session bucket scope keys, tokens, buckets) are
   unchanged; the real token store and real profile files still drive the graph.
2. `OpenAIResponsesProvider.unallowedParameters.test.ts` (3 failures).
   The Codex alias was built with bearer `unused-api-key` while the fake
   manager stored access token `codex-access-token`. A plain Codex bearer is
   paired only with the stored credential whose access token is exactly that
   bearer, so the request correctly failed closed with
   `credential-not-found` ("could not be matched to a stored account
   identity"). Fix: one `CODEX_ACCESS_TOKEN` constant is used for the
   constructor bearer and the stored token so the credential graph is coherent.
   Assertions unchanged.
3. `oauth-timing.integration.test.ts` (4 failures: includeOAuth, authOnly,
   separate provider state, prompt-time trigger). Spies/mocks were on
   `getToken`; the resolver now calls `resolveToken`, so mocked tokens were
   bypassed (resolved `null`). Fix: add a `resolveToken` spy, mock complete
   `OAuthToken` values (`oauthTokenFor`) on it, and move the positive call-count
   and call-argument assertions to `resolveToken` (same provider/metadata
   expectations). Every "must NOT trigger OAuth" assertion now checks BOTH
   `getToken` and `resolveToken`, so none can pass vacuously after the seam
   change.

Isolated results after the fixes (Bun 1.4.3 local):
- lb-member-auth-identity.behavioral.spec.ts: 6 pass, 0 fail
- OpenAIResponsesProvider.unallowedParameters.test.ts: 4 pass, 0 fail
- oauth-timing.integration.test.ts: 17 pass, 0 fail
- codex-request-credential.behavior.test.ts: 21 pass, 0 fail
- codex-refresh-without-id-token.behavior.test.ts: 4 pass; token-profile-session-bucket.test.ts: 6 pass; provider-settings.test.ts: 6 pass
- auth credential-resolution.test.ts: 23 pass; codex-refresh-identity.test.ts: 5 pass
- prettier --check and eslint on the three edited files: clean (eslint exit 0).
- Package-only `tsc --noEmit` (providers, cli) reports pre-existing-style test
  errors in unrelated files; none reference the three edited files. The
  authoritative full typecheck remains the root run. Full test/build were not
  re-run here by instruction; the parent runs the required full cycle.
- Searched for other `spyOn(manager, 'getToken')` users: the only real
  `OAuthManager` getToken spy was in oauth-timing; the rest spy on token stores.

## Final verification (r4, after fixture remediation)

Serial cycle `project-plans/.tmp-issue3991/verify-r4.sh`, every phase recorded
its own exit status: typecheck 0, lint 0, format 0, build 0, test 0, smoke 0
(`gpt-luna-high` haiku), audit 0. Providers 664/664 files; CLI 996/996 files
(10546 pass, 0 fail). The four `(fail)` lines printed inside core output are the
intentional run_bun_tests self-test fixtures; their enclosing files pass.
