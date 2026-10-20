# Issue #3908: Codex OAuth intermittently reports disabled

## Report and acceptance

On Linux, Codex occasionally asks the user to enable OAuth even though it is enabled; sending `continue` succeeds without configuration changes. Exact incident logs are unavailable.

- Fix a demonstrated refresh-lock race that produces this symptom without changing OAuth enablement or bypassing authentication.
- Cover reactive/reactive and proactive/reactive contention using the real manager and token-store locks.
- Preserve cancellation, expiry safety, and failed-refresh behavior.

## Findings

`OpenAIResponsesProviderBase` emits `/auth codex enable` guidance when token resolution produces no token. `refreshTokenUnderLock` delegates a failed refresh-lock acquisition to `handleRefreshLockMiss`. Previously, that helper performed one immediate storage read and returned `null` if the other refresh had not finished.

`KeyringTokenStore` immediately refuses a lock already held by the same store, rather than applying the requested ten-second acquisition wait. A reactive request racing an existing refresh can therefore report missing authentication while the owner is still obtaining and persisting a new token. Independent review reproduced this through the real manager/store: an 800 ms owner succeeded while its contender returned `null` with OAuth still enabled. This is a demonstrated cause of the reported symptom, not conclusive attribution of the original incident.

## Test-first implementation and review

1. Add a failing behavioral regression before changing production code.
2. Wait for fresh stored credentials after lock contention, without stealing the owner's lock or replaying a rotating refresh token.
3. Independently review and strengthen coverage; remediate findings once, then perform final review.

The initial 475 ms polling fix was rejected in review because ordinary successful refreshes could exceed that window. The final implementation uses a 35-second monotonic polling deadline, accommodating Codex's 30-second HTTP refresh timeout, and exponential delays from 25 ms to 1 second rather than 1,400 fixed-cadence reads. Already-started storage I/O is not forcibly canceled, so this is not a hard wall-clock bound on credential I/O. A nonblocking refresh-lock probe detects when the owner has finished; after acquiring that lock, the waiter rechecks storage and returns fresh credentials or `null`, releasing the lock in `finally`. It does not replay a refresh token when the previous owner failed.

The waiter checks cancellation before and after every read, uses abort-aware sleeps, and preserves the original abort reason. Freshness uses the current 30-second safety margin, not only the timestamp captured before waiting. Exhaustion still returns `null`.

Regression coverage uses the real `OAuthManager`, `KeyringTokenStore`, and temporary secure storage with an in-memory keyring boundary. Gated network-provider refreshes take 800 ms. Every contender must receive a fresh token for both reactive and proactive owners. Parameterized profile-work tests cover cancellation and a token losing its safety margin while waiting. All pending owner/contender work is joined; the manager is disposed before removing storage.

A recursive spy defect in an interrupted test draft was found by source inspection and removed: the original storage method must be bound before installing its spy. This defect could explain the test-related memory blow-up; no OS diagnostic evidence was collected to establish causality.

Independent review round 2: **PASS**, static-only, no remaining high-severity findings. The reviewer had no shell or test-execution tools.

## Verification evidence

- Original implementation against the three strengthened regressions: **3 failed**, reproducing both slow-owner races and absent cancellation waiting. Log: `/tmp/issue3908-current-red.log`.
- Additional expiry-during-wait regression: **failed** before the current-time safety-margin correction.
- Final focused suite, pinned Bun 1.3.14: **12 passed, 0 failed**, 35 assertions, approximately 3 seconds. Log: `/tmp/issue3908-final-focused.log`.
- Final changed-file Prettier: **passed**, both files unchanged.
- Earlier test-audit comparison for the initial draft had no new findings. The final static scan reached its 45-second deadline under the 512 MiB cap; no final audit result is claimed.
- Luna smoke: **blocked** because the configured `luna` profile is not present (`Profile 'luna' not found`). No user profile/configuration was changed.
- Earlier broad `npm run test` was terminated at the foreground timeout and is **not a passing result**. Earlier full lint also did not complete.
- Final changed-file ESLint hit its 512 MiB Node heap cap and exited 134. This is **not a passing lint result**. No retry with a larger heap was launched.

## Resource constraints and remaining validation

After repeated session/system interruptions, the user explicitly requested focused checks, no subagent-run tests, and broad/memory-heavy suites last, sliced where possible. There are no queued broad local test jobs. All resumed executable checks use a systemd cgroup hard memory cap and zero swap; targeted tests use 512 MiB and a short process timeout.

Broad test/lint/typecheck/build validation is deferred to CI rather than risking further local memory exhaustion. Local full-cycle verification is incomplete and must not be represented as green. The `ocr` executable is unavailable on PATH, so external open-code review could not run; independent review was completed instead.

## Remote CI and review remediation

First CI run: all seven test shards passed (providers, agents, core, three CLI slices, and rest), along with the runtime-plugin build/typecheck/test job and smoke jobs. The typecheck step found that this target library does not declare `Promise.withResolvers`; the test gates now use ordinary typed Promise constructors without changing project compiler configuration.

CodeRabbit identified continued polling after a failed owner released its lock and excessive fixed-rate credential reads. Both points were verified against source and addressed with a nonblocking lock probe, protected final storage recheck, monotonic deadline, and capped exponential backoff. New real-manager/store regressions for an owner returning no token or throwing both failed before the correction and passed afterward; failures now settle promptly without another refresh attempt.

Final remediation focused suite: **14 passed, 0 failed**, 37 assertions, approximately 4.8 seconds, pinned Bun 1.3.14 under 512 MiB/no swap. Log: `/tmp/issue3908-remediation-focused.log`. Remote CI will validate typechecking and the broad suites on the revised commit.

Second CI run: all seven test shards, full typechecking, and both Linux E2E modes passed. The sole failure was the linter's unnecessary-condition rule on `while (true)`; the loop now directly uses its existing monotonic deadline condition and retains cancellation checking on exit. Focused regressions remain **14 passed**, 37 assertions, under the same cap (log `/tmp/issue3908-deadline-focused.log`).

Remote OCR was attempted automatically but its model connectivity preflight returned HTTP 401; the workflow's success status does not mean OCR actually reviewed the patch. Fixing that credential requires repository infrastructure access and is not a code change in this issue.

## GitHub tracking

Issue #3908: type Bug, milestone 0.12.0, labels `codex / GPT`, `oauth`, `linux`; branch `issue3908`. Adding the issue to LLxprt roadmap is blocked by the configured GitHub token's missing project scope. Do not assign the issue to the user without an explicit request. Do not merge the PR without explicit approval.
