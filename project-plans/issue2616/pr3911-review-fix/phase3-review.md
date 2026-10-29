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

## Follow-up

**Five findings are resolved; finding 5 is not fully resolved. The requested DELETE-risk check found a new high-severity shutdown defect.** This follow-up checked only findings 1–6, their six specified fix commits, and the session-DELETE cancellation risk introduced by `e4c82e58a`, at worktree HEAD `96351890f`. No source was edited.

### 1. Resolved: borrowed-client JSON and embedding leases (`07e3c1829`)

`packages/agents/src/session/session-client-acquisition-owner.ts:286–311` now admits both operations through the session's `AuxiliaryWork`, passes the composed session/caller signal into the client, and joins the leases during shutdown. `src/core/auxiliary-work.ts:11–35` aborts that session's controller and joins admitted promises without reporting caller outcomes again. The foreground shutdown joins these leases at `src/api/foreground-agent-assembly.ts:681–689`; client releases follow the auxiliary join in `src/session/session-client-owner.ts:516–536`.

The borrowed-client cases in `auxiliary-generation-lifetime.behavior.test.ts:501–652` observe transport cancellation, keep disposal pending across a 20 ms event-loop barrier while physical work remains held, then check caller failure and clean disposal. They also verify continued client/peer usability and an independent direct call whose signal stays live. Result: **5 passed**. No further action for this finding.

### 2. Resolved: foreground refresh-lock release failures (`b7d369713`)

`packages/providers/src/auth/token-refresh-helper.ts:32–58` retains release failures and consumes them with `splice(0)`. The coordinator's normal, lock-miss, disk-check and forced-refresh paths use this owner; the orchestrator also retains its refresh-before-browser release failures. `oauth-manager.ts:453–474` consumes coordinator failures after the foreground join, continues retirement after an error, and closes the owned store afterward.

The real-manager cases at `oauth-manager.dispose-flights.behavior.test.ts:651–746` cover both `getToken` and `forceRefreshToken`: the caller receives the release error, disposal contains one occurrence, and store closure follows release settlement. The clean-release control keeps provider errors/owner aborts out of disposal. Results: **15 passed** in dispose-flights and **23 passed** in refresh-race. No further action for this finding.

### 3. Resolved: multi-bucket confirmation and delay cancellation (`c4337c498`)

`packages/policy/src/confirmation-bus/message-bus.ts:189–243` accepts the operation signal, handles an already-aborted signal without publishing, and removes only the aborted request's timer, response subscription and pending entry. `packages/providers/src/auth/auth-flow-orchestrator.ts:818–827,850–874,966–1044` passes the signal to confirmation and both delay paths, checks cancellation after waits, and clears the fallback race timer. `abortable-delay.ts:12–23` uses a cancellable timer and preserves the signal's reason.

The real-manager/real-bus prompt case completes disposal without external confirmation cancellation and leaves a peer confirmation answerable. The delay case cancels a configured 60-second wait and leaves another manager usable. Results: **2 passed** in dispose-multibucket and **28 passed** in message-bus, including the three signal cases. The related named provider specifications also passed as listed below. No further action for this finding.

### 4. Resolved: iterator-finalizer failures (`7bf3c3f6b`)

`packages/agents/src/api/loop-run-lifetime.ts:73–96` now retains rejected `iterator.return()` results, joins run settlement, performs resource release, and aggregates retirement failures. The suspended-at-yield regression at `loop-run-lifetime.behavior.test.ts:81–113` observes exactly the finalizer failure in disposal and confirms release still runs once. The caller-outcome and release-failure controls remain. Result: **3 passed**. No further action for this finding.

### 5. Not resolved in full: MCP teardown characterization (`e4c82e58a`)

The fix supplies substantial missing evidence. `packages/mcp/src/client/mcp-connection-lifetime.ts:153–193` attempts explicit session termination. The fixture now records session DELETEs and socket closure and counts live sessions/sockets (`packages/agents/src/api/__tests__/helpers/mcp-cutover-server-fixture.ts:295–422`). The plain public-agent disposal test requires a real DELETE and zero residual resources; refresh and resource-read cases require operation settlement before disposal and zero sessions/sockets before fixture cleanup (`mcp-shutdown-borrowers.behavior.test.ts:85–158`). Result: **4 passed**. The four transport-level termination cases also passed.

`mcpRuntimeAssembly.ts:608–615,648–666,721–817` tracks refresh/reload operations and separates admission closure from physical connection retirement. It joins reconfiguration and accepted extension work before starting catalog disposal and manager stop. `mcp-runtime-owner-reload-retirement.behavior.test.ts:112–150` exercises a real manager and settings binding at `McpRuntimeOwner`, requires the pre-existing connection's DELETE after reload settlement, and checks zero sessions/sockets. Result: **2 passed**.

The original coverage request is still incomplete: the reload test does not exercise the `AgentProfilePreflight.bindMcpSettings` to foreground-agent transfer, and no held accepted extension start/stop test was added. The commit explicitly records both the owner-level substitution and the extension omission. Passing the owner-level reload case does not establish these other compositions. Complete the held reload case through the real preflight/foreground entry point and the accepted extension start/stop characterization before closing finding 5. The session-DELETE implementation also has the separate defect below.

### 6. Resolved: changed OAuth cases use real-manager behavior (`1f10bb3d1`)

The explicit-bucket/profile-bucket scenario at `packages/providers/src/auth/oauth-manager.spec.ts:713–835` now uses a real manager, in-memory token/profile boundaries, and a registered provider. It checks the resulting token bucket and a live provider signal; the added disposal case checks cancellation and one caller outcome without stubbing manager methods. The changed authentication mock-call blocks were removed from `oauth-manager.wiring.spec.ts`. `oauth-manager.owner-signal.behavior.test.ts:111–170` replaces those assertions with real-manager/real-bus single- and multi-bucket authentication, stored-token effects, and cancellation that skips remaining buckets.

Results: **29 passed** in oauth-manager.spec, **6 passed** in wiring, and **3 passed** in owner-signal. Untouched legacy mock cases were outside this follow-up. No further action for this finding.

### New finding 7. High: an unanswered session DELETE can block agent disposal indefinitely

**Introduced by:** `e4c82e58a`. **Status:** open.

The tracked fetch does see its transport lifetime signal, but that signal is not aborted on retirement of an established connection. `McpClient.connectOperation()` passes its connection controller into connection/transport creation (`packages/mcp/src/client/mcp-client.ts:134–145`), then clears its only controller reference after successful connection (`189–192`). Consequently `disconnect()`'s abort at `402` has no controller to abort for that connection. Admission closure cancels discovery rather than the established transport (`mcp-client-manager-helpers.ts:450–462`; `mcp-client.ts:213–217`). The connection-attempt timeout is also cleared when connection succeeds (`mcp-connection.ts:519–546`).

In `mcp-connection-lifetime.ts:119–124`, the DELETE fetch combines this still-live lifetime signal with the SDK signal. However, close awaits `terminateSession()` at `159` before aborting its local controller at `160` or invoking the SDK close at `162`. The installed SDK's `terminateSession()` awaits the DELETE fetch with its own controller signal and no timeout (`node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js:446–469`). Neither controller can interrupt this wait through the normal established-connection close path.

There is an existing 10-second deadline in `close-client-with-timeout.ts:9–35`, used by `McpClient.disconnect()` at `435`, but it only aborts a private controller and checks that controller after `await client.close()`. It never supplies the deadline signal to the client or transport. It therefore cannot interrupt an unanswered DELETE. `McpRuntimeOwner` awaits manager stop through `managerClosing` (`mcpRuntimeAssembly.ts:765–770,836–846`), so this wait propagates to agent disposal.

A read-only loopback probe used the real SDK `Client`, `StreamableHTTPClientTransport`, `createJoiningTransport`, and `closeClientWithTimeout`. After withholding the DELETE response for 10.2 seconds it produced:

```json
{"sessionDeleteObserved":true,"ownerSignalAborted":false,"deleteSignalAborted":false,"closeSettledAfterExistingDeadline":false}
```

Explicitly aborting the owner then cancelled the actual fetch and allowed close to settle:

```json
{"settledAfterOwnerAbort":true,"deleteSignalAbortedAfterOwnerAbort":true,"outcome":"Error: Timed out closing MCP client 'probe' after 10000ms"}
```

Evidence: `tmp/pr3911/follow-up-verification-96351890f/held-delete-transport-probe.log`. This probe establishes the SDK/transport/deadline stall; public-agent impact follows the inspected disposal chain above. Separate standalone public-agent probe attempts did not reach discovery readiness and were inconclusive, so they are not treated as shutdown evidence.

**Required fix:** propagate the existing close deadline into the actual DELETE fetch, or introduce an equivalent cancellable termination deadline, then abort and physically join that fetch before completing local transport retirement. Preserve the chance to send the DELETE while its signal is live; merely aborting everything before termination would skip the session cleanup just added. Do not use a timeout race that abandons the pending fetch. Add a regression with an established session whose server never answers DELETE, checking bounded disposal, fetch/socket cancellation, and cleanup-error reporting while retaining the successful DELETE and 405 cases.

### Follow-up verification

Every named focused file ran in a separate Bun process with `exec < /dev/null;`. Commands ran from their package directories: agents used `bun test --timeout 180000 ./<path>`; providers, MCP and policy used `bun test ./<path>`. Each process had an outer 110-second bound; all completed successfully, with measured durations below five seconds per file. Logs and per-file exit codes/durations are in `tmp/pr3911/follow-up-verification-96351890f/`, including `results.json`.

| Package | File | Passed |
| --- | --- | ---: |
| agents | `src/api/__tests__/auxiliary-generation-lifetime.behavior.test.ts` | 5 |
| agents | `src/api/__tests__/loop-run-lifetime.behavior.test.ts` | 3 |
| agents | `src/api/__tests__/post-config-preflight.test.ts` | 19 |
| agents | `src/api/__tests__/mcp-shutdown-borrowers.behavior.test.ts` | 4 |
| agents | `src/api/__tests__/mcp-runtime-owner-reload-retirement.behavior.test.ts` | 2 |
| agents | `src/api/__tests__/mcp-construction-owner.test.ts` | 4 |
| agents | `src/api/__tests__/mcp-credential-owner-cutover.test.ts` | 2 |
| agents | `src/api/__tests__/workspace-mcp-reload-config.behavior.test.ts` | 1 |
| agents | `src/api/__tests__/mcp-config-lifetime.test.ts` | 4 |
| agents | `src/api/__tests__/workspace-registrar-reload-owner.behavior.test.ts` | 3 |
| agents | `src/api/__tests__/session-tool-owner-risk.behavior.test.ts` | 8 |
| providers | `src/auth/oauth-manager.dispose-flights.behavior.test.ts` | 15 |
| providers | `src/auth/anthropic-oauth-provider.abort.behavior.test.ts` | 2 |
| providers | `src/auth/oauth-manager.refresh-race.spec.ts` | 23 |
| providers | `src/auth/oauth-manager.dispose-multibucket.behavior.test.ts` | 2 |
| providers | `src/auth/oauth-manager.runtime-messagebus.spec.ts` | 1 |
| providers | `src/auth/__tests__/auth-flow-orchestrator.spec.ts` | 24 |
| providers | `src/auth/__tests__/oauth-manager.user-declined.spec.ts` | 3 |
| providers | `src/auth/__tests__/oauth-manager.issue913.spec.ts` | 4 |
| providers | `src/auth/oauth-manager.spec.ts` | 29 |
| providers | `src/auth/oauth-manager.wiring.spec.ts` | 6 |
| providers | `src/auth/oauth-manager.owner-signal.behavior.test.ts` | 3 |
| mcp | `src/client/mcp-connection-lifetime.session-termination.test.ts` | 4 |
| mcp | `src/client/mcp-client.transport.test.ts` | 34 |
| mcp | `src/client/mcp-client.lifecycle.test.ts` | 11 |
| mcp | `src/client/mcp-client.disconnect-cleanup.test.ts` | 8 |
| policy | `src/confirmation-bus/message-bus.test.ts` | 28 |

Total: **252 passed, 0 failed, 0 skipped across 27 files**. The successful held-DELETE transport probe is separate from those test counts. No package-wide suite, historical red-state replay, broader review, or source change was performed.
