# Phase 3 review

Phase 3 needs fixes. Reviewed the complete diff `0424b24c8..1ab0696bf` against T3.1–T3.6, the binding review, and the plan's ground rules. Findings: **3 high, 2 medium, 1 low**.

## Findings

### 1. High: borrowed-client auxiliary calls lose their session cancellation and drain owner

- **Task:** T3.1 (A5)
- **Commit:** `0f4542f4b`
- **Location:** `packages/agents/src/session/session-client-acquisition-owner.ts:280–297`; `packages/agents/src/api/__tests__/auxiliary-generation-lifetime.behavior.test.ts:501–569`
- **Problem:** JSON and embedding calls now bypass the session's accepted-work tracker. The client's own tracker is closed only by `client.dispose()`, but the session deliberately does not dispose a borrowed client. Consequently the facade's disposal neither aborts these admitted calls nor joins their settlement. A held call can outlive the facade and continue using its retiring dependencies. The test removes the transport-signal assertion and checks that shutdown is pending after only two microtasks before releasing the request, which does not establish a drain barrier.
- **Concrete fix:** Keep per-session ownership of the operations admitted through this facade, including a cancellation signal and a settlement join, without disposing the borrowed client or aborting unrelated operations on it. This can be an operation lease scoped to the session instead of duplicating cleanup-error ownership in two wrappers. The session owner must abort and join its JSON/embedding leases before releasing borrowed dependencies; the client still owns its underlying resources. Restore borrowed-client tests that observe cancellation, hold physical settlement until explicitly released, and prove disposal remains pending across an event-loop barrier. Check the caller outcome once, clean disposal, and continued usability of the borrowed client and an independent peer.

### 2. High: foreground refresh-lock cleanup failures are discarded with caller outcomes

- **Task:** T3.4 (A4/A5)
- **Commit:** `a9a5535d2`
- **Location:** `packages/providers/src/auth/oauth-foreground-lifetime.ts:35–36`; `packages/providers/src/auth/token-access-coordinator.ts:1031–1032`; `packages/providers/src/auth/oauth-manager.ts:457–459`
- **Problem:** The new foreground join discards every rejection, but only authentication-lock releases gained separate cleanup-failure retention. Foreground token refresh releases its refresh lock in a `finally` outside that retention path. If `releaseRefreshLock` fails while disposal joins an admitted refresh, the caller sees the cleanup error and disposal fulfills, falsely reporting successful owner cleanup. This is an owner cleanup failure, which A5 explicitly requires disposal to report. The adjusted refresh-race tests cover provider errors and cancellation only, so they miss this distinction.
- **Evidence:** A read-only probe using the real `OAuthManager`, an in-memory token store, and a held provider refresh started `forceRefreshToken`, started disposal, then released the refresh with `releaseRefreshLock` throwing a specific error. Result: `{"callerIsCleanupError":true,"disposal":"fulfilled"}`.
- **Concrete fix:** Retain foreground refresh-lock release failures in their owning refresh/coordinator lifetime and consume them once during manager retirement, as done for authentication-lock release failures. Keep ordinary provider errors and owner aborts out of disposal. Add red-first public-manager cases for both normal and forced refresh, asserting the caller outcome, one cleanup-error occurrence in disposal, and store closure after the join.

### 3. High: disposal cannot cancel an admitted multi-bucket confirmation

- **Task:** T3.4–T3.5 (A4)
- **Commits:** `a9a5535d2`, `d16aefc08`
- **Location:** `packages/providers/src/auth/oauth-manager.ts:841–853`; `packages/providers/src/auth/auth-flow-orchestrator.ts:841–869,952–992`
- **Problem:** Multi-bucket authentication is now admitted and joined by the foreground lifetime, but its signal reaches only the individual bucket-auth callback. The confirmation callback and inter-bucket delays do not receive it. With `bucketPrompt: true`, an ordinary real message-bus confirmation remains pending after manager disposal aborts its owner signal. Retirement then blocks in `foreground.join()` before it can join flights, cancel renewals, or close the store. The real bus's default timeout is 300000 ms (`packages/policy/src/confirmation-bus/message-bus.ts:49,191–227`). This delay is unrelated to a host ignoring an abort signal: the confirmation was never given cancellation. The new cancellation test sets `bucketPrompt: false` and `bucketDelay: 0`, avoiding both waits.
- **Evidence:** A read-only probe with the real manager and real `MessageBus` waited for `BUCKET_AUTH_CONFIRMATION_REQUEST`, started disposal, and observed disposal still pending. Calling the bus's external `cancelPendingConfirmations()` allowed disposal to finish. Output: `disposedBeforeExternalPromptCancellation: false`, `disposedAfterExternalPromptCancellation: true`.
- **Concrete fix:** Propagate the composed signal through the entire multi-bucket operation, including confirmation admission and delays. Cancel and remove this operation's confirmation on abort, stop the bucket loop, and join its cleanup. Do not cancel other owners' confirmations on a shared bus. Add public-manager tests aborting during prompt and delay waits, with no manual confirmation needed to finish disposal and with an independent peer still usable.

### 4. Medium: loop retirement discards errors produced by iterator cleanup itself

- **Task:** T3.2 (A5)
- **Commit:** `fa3893da4`
- **Location:** `packages/agents/src/api/loop-run-lifetime.ts:78–94`
- **Problem:** The change ignores all results of disposal's `iterator.return()`. A generator suspended at a yield has no pending caller request to receive an exception from its `finally`; disposal initiates that cleanup and is its only observer. If the finalizer fails, disposal now fulfills. Such an error is an owner cleanup outcome, rather than the caller's generation failure or the abort caused by shutdown. The new tests cover an explicit `release` callback failing, but not this other cleanup step.
- **Evidence:** A read-only probe used the real `LoopRunLifetime` with an async generator that yields once and throws `Error('iterator finalizer failed')` in `finally`. After the first successful `next()`, `dispose()` returned `fulfilled` and ran the release callback. No caller received the finalizer failure.
- **Concrete fix:** Preserve failures generated by iterator retirement while continuing to omit outcomes already delivered to the caller. Track execution outcome and retirement outcome separately if necessary. Add a red-first test with the iterator suspended at a yield, assert the finalizer failure occurs once in disposal, and keep the abort-only and release-failure cases.

### 5. Medium: the MCP characterization does not verify the teardown contract used to drop T3.6

- **Task:** T3.6 (E2)
- **Commit:** `1ab0696bf`
- **Location:** `packages/agents/src/api/__tests__/mcp-shutdown-borrowers.behavior.test.ts:61–113`; `packages/agents/src/api/__tests__/helpers/mcp-cutover-server-fixture.ts:301–375`
- **Problem:** The refresh test releases its hold immediately after calling disposal, without checking that disposal is pending while work is held. The teardown-order assertions iterate over any recorded DELETEs but never require such an event or observe connection closure instead. The focused run passed all three tests with only four assertions in total, so every DELETE-order loop was empty. The fixture also tracks neither live sessions nor live sockets, and its final `closeAllConnections()` would hide residual connections. Thus these tests establish operation settlement before disposal returns, but not the promised connection-retirement ordering or absence of leaked sessions/sockets used to justify dropping the planned change.
- **Missing real branch:** Reload was omitted because `createAgent` has no settings binding. The application does have a reachable composition: `packages/cli/src/config/config.ts:325–327,348–359` binds MCP settings through `AgentProfilePreflight.bindMcpSettings` (`packages/agents/src/api/profile-preflight.ts:411–414`), and `AgentProfilePreflight.createForegroundAgent` transfers that binding into the foreground runtime. The runtime retains `reloadOperations` and joins them at `mcpRuntimeAssembly.ts:770–775`, but starts connection retirement earlier at `723–735`. A passing refresh case does not test that reload branch or accepted extension transitions.
- **Concrete fix:** Exercise a held reload through the real preflight-to-foreground entry point with a settings change, and cover accepted extension start/stop. Track active sessions and sockets in the server fixture; assert actual retirement events and zero residual resources before fixture cleanup, with explicit pending/settlement barriers. For workspace and skills borrowers, verify the owners' own accepted-work joins or add held-work characterization tests. Retain the existing order only where this proves safety; otherwise perform the planned admission/retirement split and facade reorder. Update the task's completion claim to match what was verified.

### 6. Low: touched OAuth specifications retain the test shapes prohibited by the task

- **Task:** T3.4 (binding coder protocol)
- **Commit:** `a9a5535d2`
- **Location:** `packages/providers/src/auth/oauth-manager.spec.ts:744–764`; `packages/providers/src/auth/oauth-manager.wiring.spec.ts:429–443`
- **Problem:** The updated cases add or change `toHaveBeenCalledWith` assertions, despite the explicit prohibition on mock-call assertions. The first case also stubs `isOAuthEnabled` and `getProfileBuckets` on the same manager being tested; the wiring case replaces the authentication orchestrator and other production collaborators with expected-value mocks. Updating the expected argument shape does not verify signal propagation into real authentication or its cancellation behavior. These test shapes predate phase 3, but the touched cases were retained and extended rather than migrated under the binding rule.
- **Concrete fix:** Replace the changed scenarios with real-manager behavior tests using registered test providers and in-memory token stores. Assert the chosen bucket's resulting token, the provider's observed signal/cancellation, and caller/disposal outcomes. Do not stub manager methods or assert collaborator calls. This need not expand into a rewrite of untouched legacy scenarios.

## Review checks and verification

The changed caller-outcome assertions in detached generation, history publication, adoption/publication, preflight disposal, workspace search, standalone loop, and foreground OAuth still observe their respective caller outcomes. The temporary cleanup, rollback, and profile-retirement tests now check cleanup failures separately. Findings 1, 2, and 4 identify where the implementation or assertions go beyond the A5 outcome-separation contract. No additional T3.3 defect was found.

No concrete reentrancy or call-order defect was found from starting `foreground.accept` operations synchronously. The async wrapper still turns a synchronous throw into a rejection, and manager retirement awaits the interactive-handler step before taking the foreground join snapshot. This does not resolve the uncancelled multi-bucket waits in finding 3.

Interactive production disposal cancels active session signals before joining retained handlers, including handlers whose logical sessions were removed earlier. A host that honors an already-aborted signal and future aborts can settle; a host that ignores cancellation deliberately keeps disposal pending under the A4 design. An arbitrary timeout that abandons that handler would defeat the required physical drain, so no bound is requested for that case. The test-handler changes in T3.5 are consistent with this contract.

For the workspace/skills facade order, definitions join pending work, checkpoints join pending operations and initialization, filesystem disposal joins reads/searches and replacement, memory joins its accepted set, and skills disposal joins its serialized tail before its final publication. Their own joins are a reason not to reorder merely because the facade joins later. They do not supply the missing reload, extension-transition, and physical-connection assertions in finding 5.

The phase diff contains no raised test timeout, new skip, allowlist/exclusion change, compatibility shim, or committed handoff. New production cleanup catches retain and rethrow errors or aggregate named retirement steps; no new swallowing fallback was found there. Existing mock-based specifications are addressed in finding 6. Commit bodies record red runs for T3.1–T3.5 and a before-run characterization for T3.6; this review did not rerun historical red states. The uncovered behaviors in findings 1–5 need regression tests.

Focused tests run during this review, one file per Bun process, with stdin closed and each command bounded below two minutes:

| Package | File | Result |
| --- | --- | --- |
| agents | `src/api/__tests__/auxiliary-generation-lifetime.behavior.test.ts` | 4 passed |
| agents | `src/api/__tests__/loop-run-lifetime.behavior.test.ts` | 2 passed |
| agents | `src/api/__tests__/post-config-preflight.test.ts` | 19 passed |
| agents | `src/api/__tests__/mcp-shutdown-borrowers.behavior.test.ts` | 3 passed |
| providers | `src/auth/oauth-manager.dispose-flights.behavior.test.ts` | 12 passed |
| providers | `src/auth/anthropic-oauth-provider.abort.behavior.test.ts` | 2 passed |

Total: **42 passed, 0 failed**. The three read-only probes described in findings 2–4 reproduced uncovered failures. `git diff --check 0424b24c8..HEAD` passed. No package suite was run, and no source or plan file was edited.
