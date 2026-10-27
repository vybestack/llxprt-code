# Issue #3965: Codex requests abort on transient keyring null reads

## Reproduction and history

The native keyring binding converts backend read errors into `null` (see #3067).
A transient miss for a valid, unexpired token therefore looked like missing
OAuth credentials. Codex resolves its bearer token and account ID separately;
the account-ID lookup raised the reported `Codex mode requires OAuth
authentication - no token available` error.

The refresh-lock fix in #3914 (`b34e1a6ea7`, for #3908) remains present. It
addresses expired-token refresh contention, whereas this reproduction uses an
unexpired token. Related #3580 has broader child-lifecycle conformance requirements
and is not closed by this change. The reporter's live failure has not been
correlated with diagnostics, so this reproduction establishes a matching defect
without proving every incident shares its cause.

## Implementation

`SecureStore.get()` and `has()` now confirm a null keyring result with up to two
additional immediate reads before consulting the fallback file.

- Successful reads still require one backend operation, without added sleeps.
- One or two consecutive nulls can recover the authoritative keyring value.
- Three nulls still permit existing fallback or absence handling.
- Thrown errors, non-null values, and unavailable adapters retain their policy.
- No credential cache, authentication bypass, retry writes, or stale fallback
  resurrection mechanism is introduced. Deletion and logout retain their behavior.
- The verified-write policy from #2556 is unchanged.

## Behavioral regressions

New Bun tests:

- `packages/storage/src/secure-store/secure-store.transient-null.test.ts`
- `packages/providers/src/openai-responses/__tests__/openai-responses-provider.codex-keyring-transient-null.test.ts`

Storage cases cover successful reads, one/two transient nulls, bounded persistent
absence, fallback precedence, unavailable keyrings, deletion, thrown errors,
non-null invalid values, and `has()`.

Codex cases drive `generateChatCompletion` through real SecureStore,
KeyringTokenStore, OAuthManager, and provider components. Infrastructure doubles
supply the keyring and network. Assertions cover outgoing authorization/account
headers, genuine absence, logout, and obsolete fallback avoidance. Harness
OAuthManagers are disposed in teardown.

Before the production fix: storage had four failing cases; Codex had three,
including the exact reported error and selection of an obsolete fallback account
ID. Afterward: **20 passed, zero failed**.

## Native Linux validation

Two recorded passes used only disposable synthetic credentials through the real
native adapter and patched token store. Across **6,000 patched store reads**
(4,000 sequential and 2,000 at concurrency four), **70 underlying null reads
recovered and no store lookup returned null**. In a normal raw-adapter pass,
30/3,000 reads returned null, with at most two consecutive misses.

One separate raw-adapter phase was anomalous: 2,984/3,000 reads returned null,
including a 719-read consecutive run. Its cause was not established and it was
not reproduced through the patched store. Bounded confirmation cannot cover a
sustained outage of that duration. Native evidence is specific to this Linux
host/backend and does not establish guarantees on other systems or confirm the
live reporter's precise failure.

Dummy credentials were deleted and cleanup verified. No user credentials were
read. Disposable experiment scripts and logs remain workspace-scoped during
verification and are excluded from commits.

## Verification

| Check | Result |
| --- | --- |
| Independent review, two rounds | PASS; two low findings addressed: bounded guarantee wording and OAuthManager teardown |
| Independent focused storage/auth/refresh/provider checks | 213 passed, two existing skips, zero failures across 14 files |
| Final new regression tests | 20 passed, zero failed |
| Full `npm run lint` | Passed, all 18 groups; changed files re-linted after final edits |
| Full `npm run typecheck` | Passed after fixing an invalid test-helper option |
| `npm run format` | Passed; `.llxprt` contents verified unchanged |
| `npm run build` | Passed |
| Test-audit baseline comparison | Identical findings; no new flagged tests |
| Live smoke after build | `gpt-luna-high` returned a haiku; requested `luna` profile is absent on this host |
| OCR | Unavailable: `ocr` executable is not installed; independent agent review completed |

### Full-suite qualification

`npm run test` completed with exit 1. All storage (39/39) and provider (672/672)
files passed. Two other files failed:

- Agents `core-tools.spec.ts`: T2p exceeded its 60-second timeout. Two isolated
  reruns passed all 21 cases; the final rerun completed in 24 seconds.
- CLI `useAtCompletion.subagent.test.ts`: an enrichment-timeout assertion failed.
  Five sequential reruns passed all 15 cases each. Under artificial CPU
  contention, seven of 32 runs reproduced the same timing failure.

These failures are disclosed rather than counted as a clean full-suite pass.
No source changes were made to those components. A successful main CI run is
insufficient to establish that the failures are pre-existing; no such claim is
made here. PR CI results are the final remote verification gate.
