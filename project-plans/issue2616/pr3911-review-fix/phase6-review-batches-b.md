# Phase 6 review: batches T6.B81–T6.B163 and T6.F1–T6.F4

Review complete at `f7c79e4f92e940b8711413284a29dadae8acfc83`, using `e7f9b4973` to check historical production writers. Scope: all 84 requested batch identifiers, T6.B81–T6.B163 plus T6.B102b, and integration fixes T6.F1–T6.F4. **Findings: 0 Critical, 0 High, 8 Medium, 1 Low.** Source and plan files were not changed; findings were appended to this report during the audit.

## Findings

### 1. Medium: B132 names a replacement that no longer checks manager lifetime

- **Batches/commits:** T6.B128 `d628ca319`, T6.B132 `fb3c2ab0a`.
- **Location:** `packages/providers/src/runtime/config-manager-lifecycle.behavior.test.ts:243-250`; `project-plans/issue2616/pr3911-review-fix/B2-batch-records/T6.B132.md:22` (scenario 6).
- **Problem:** B132 replaces its borrowed-manager disposal assertion with B128 scenario 3, claiming that target observes a live settings subscription after cleanup. B128 removed the settings write and `clientRevision + 1` assertion. The target now reads only `preflight.getActiveProviderName()` after disposal, which can return retained selection data even when all subscriptions are closed. This does not assert the cited lifetime property. The original supplied-manager route is unreachable, but describing a cached name as a covering lifetime assertion is still a conservation failure. B128 scenario 4 covers an owned manager's cleanup, not a borrowed manager surviving a borrower's cleanup.
- **Concrete fix:** Replace the old borrowed-manager assertion with a domain-level lifetime test of a production borrower that genuinely leaves the manager alive, if such a borrower exists. Otherwise classify that specific assertion as Removed with its `adoptProviderManager` proof, and give the Route B scenario an actual ownership-transfer assertion: a settings write changes the provider revision before foreground disposal and no longer changes it afterwards. Update B132's replacement reference to the behavior actually asserted.

### 2. Medium: B138 preserves a fixture-only profile-parameter contract while bypassing production

- **Batch/commit:** T6.B138 `8ef629e26`.
- **Location:** `packages/cli/src/nonInteractiveCli.slashCommandsAndThinking-owner-2.test.ts:312-344`; `packages/cli/src/cliProviderInit.ts:42-47,162`.
- **Problem:** The scenario named “preserves profile model params when the CLI provider override supplies the activation provider” passes `buildNonInteractiveActivationIntent(...)`, a test-only builder, directly to `fromConfig`. The real CLI uses `activateConfiguredProvider` and `collectProviderModelParams`, whose `!argv.provider` condition drops profile parameters when `--provider` is present. The migrated test therefore passes while the behavior it claims to conserve is absent from the production route. B138's own record documents this divergence but leaves it outside both Production failures and Unobservable reads. Replacing `agent.stream` with an empty stream does not address the missing production activation coverage.
- **Concrete fix:** Add the scenario through `activateConfiguredProvider` with the actual parsed provider override and profile/CLI parameter inputs. Resolve the expected contract against profile resolution, then either fix the production merge if preservation is intended or explicitly replace the obsolete fixture expectation with a production behavior test. Do not report this scenario as conserved solely because the test builder merges the values.

### 3. Medium: B148's fake compression result removes the missing-history guard coverage

- **Batch/commit:** T6.B148 `83d375c2b`.
- **Location:** `packages/cli/src/ui/commands/compress-command-conservation.test.ts:64-102,326-343`; `packages/agents/src/session/session-conversation-binding.ts:250-263`.
- **Problem:** The file now feeds a fake `Agent['compress']` into the CLI mapping and reconstructs `projectCompressionResult` in `agentResult`. CLI mapping tests at that boundary are valid, but they do not conserve every old scenario. In “shows error when chat has no history service”, the replacement function simply throws the expected message. Nothing builds a history-less chat or proves compression was not attempted. The cited covering test, `compression-execution.test.ts` “retains actual token inflation ...”, exercises successful preparation and checks that it preceded compression. It never makes preparation throw and never tests the missing-history guard in the session binding. Removing that production guard would leave the migrated case green.
- **Concrete fix:** Keep the CLI result-mapping cases, classify the displaced agent behavior explicitly as Replaced, and add a domain-level SessionClientOwner/conversation test with its real client whose history-service read is absent. Assert the actual error and no compression effect. Also add the preparation-rejection/no-compress assertion at `executeCompression` if that is the chosen lower-level replacement. Do not use a fake result builder as evidence that the production binding produced that result.

### 4. Medium: B96 and B97 replace client-reuse assertions with empty and undefined comparisons

- **Batches/commits:** T6.B96 `0b8763ad2`, T6.B97 `3c77f77cc`; related T6.B94 `64b81ae0c` / T6.B100 `2870e8098` records acknowledge the same observation gap.
- **Location:** `packages/cli/src/activation-bootstrap-handoff.test.ts:93-110`; `packages/cli/src/cliAgentBootstrap.test.ts:130-151,195-202`.
- **Problem:** The deleted client identity checks are said to be covered by the pre/post handoff history and `Config.getContentGeneratorConfig()` comparisons. These scenarios do not put any content into the pre-Agent history, so a newly constructed empty client satisfies the history comparison. Their Configs do not set a content-generator config, and production does not call `setContentGeneratorConfig`, so the second comparison is `undefined` against `undefined`. Neither assertion fails when handoff incorrectly builds another client. B100 removes analogous `ownerAdopted`/`mediaAdopted` assertions and cites tests with that same content-config reasoning. The plan permits dropping identity only with a discriminating behavioral assertion; matching empty state does not qualify.
- **Concrete fix:** Use an allowed public pre-Agent operation to place distinctive state before handoff and assert that exact state afterwards. If no allowed operation can do so, replace the reuse invariant with a named domain-level handoff test that genuinely detects a second construction, and record the stop-rule decision. Remove the claim that empty history or an unset Config field covers client reuse.

### 5. Medium: B102b raises the notification-recovery polling budget

- **Batch/commit:** T6.B102b `8dcb46cd3`.
- **Location:** `packages/cli/src/ui/hooks/agentStream/__tests__/useSubmitQuery.background-clear.test.tsx:202-224` (`awaitHistoryContains` and `awaitNewSessionAdmitted`); `packages/cli/src/__tests__/render.tsx:325-331` (original default).
- **Problem:** Notification recovery previously used `waitFor`'s 1,000 ms default to wait for pending work to drain and then asserted history/session admission. The replacement waits for the same recovery through history with an explicit 5,000 ms deadline, and in several cases polls session admission for another 5,000 ms. The batch record says the scenarios are Kept but does not identify this timeout increase. This violates the explicit unchanged-timers rule. `awaitNewSessionAdmitted` also retries a mutating operation and catches every rejection through `waitFor`, so an unrelated admission failure is retried instead of failing at its cause. The new 15,000 ms task-terminal poll is an additional deadline, not a retained event gate.
- **Concrete fix:** Synchronize real child completion and notification delivery through the available completion/delivery events and await those gates, then assert history and call `startNewSession()` once. Preserve existing deadlines where polling remains necessary. Do not enlarge the old notification-recovery deadline to accommodate the new producer, and do not repeatedly retry all failures from a session-changing operation.

### 6. Medium: The orchestrator's count-drop ruling contradicts the binding conservation rule

- **Batches/commits:** Cross-batch protocol; invoked by T6.B107 `b8502c706` and T6.B148 `83d375c2b`.
- **Location:** `tmp/lanes/BATCH-PROTOCOL.md:48-51`, especially line 50.
- **Problem:** The ruling permits dropping “disposed exactly once” whenever an effect proves disposal happened. Such an effect establishes at least once and cannot detect double disposal. The plan allows only internal identity lines to be dropped this way; listener/count reads instead require a named domain-level replacement asserting the same property. Applying this ruling more broadly to spy-only counts or call flags does not establish equivalent coverage. The protocol cannot authorize weaker assertions than the binding plan and Andrew's no-weakened-assertions rule.
- **Concrete fix:** Remove the blanket count-drop authorization. Require a named public/domain test for the original count or no-call invariant, or a deleted-input proof for that specific invariant. Route-forced changes to an error message are acceptable only when the failure condition and failure-reporting assertions remain intact; they must not become a general license to weaken unrelated checks.

### 7. Medium: B87's zero-listener replacement covers only the policy owner

- **Batch/commit:** T6.B87 `af47fb379`.
- **Location:** `packages/agents/src/api/__tests__/runtime-policy-owner-disposal.behavior.test.ts:21-37`; `packages/agents/src/api/__tests__/disposal.spec.ts:31`.
- **Problem:** The former “T13 messageBus has zero subscriptions after dispose” checked the Agent's whole bus after Agent disposal. Its named replacement constructs and disposes only `RuntimePolicyOwner`, without an Agent, client, hooks or tool-confirmation subscribers. Summing all event names on that smaller bus does not cover subscribers that never existed in the test. A leak in any other Agent bus consumer will not fail this replacement. The B87 record explicitly acknowledges those consumers are outside the new assertion, so the target does not assert the same thing.
- **Concrete fix:** Preserve the overall zero-subscription contract by adding named domain-level disposal/no-delivery tests for every production subscriber previously present on that bus, including the relevant session-client, hook and confirmation owners, and retain an Agent-level disposal effect. List those targets as the replacement set. A policy-only zero count cannot be the sole conservation proof for whole-Agent bus cleanup.

### 8. Medium: B148 loses the command's restore-failure UI assertions

- **Batch/commit:** T6.B148 `adc5f4754`.
- **Location:** `packages/agents/src/api/__tests__/session-restore-history-failure.behavior.test.ts:76-90`; `packages/cli/src/ui/commands/chatCommand.ts:494-504`.
- **Problem:** The new domain test preserves live and durable history after client restoration fails, but never runs the `/chat restore` command. The removed CLI scenario also asserted an error result and no UI clear/repaint. Those assertions are expressly dropped in the batch record without a replacement. A regression that clears the UI on restore failure, or reports success, will pass the new session-only test. This is a failure-reporting scenario, which the conservation rule requires to be Kept or Replaced with equivalent assertions.
- **Concrete fix:** Keep the domain rollback test and add a command-boundary failure scenario using the production command binding and a failing restore operation. Assert the error result, unchanged UI history and no clear/repaint. This can test the command's collaborator boundary without mocking the command itself. Name both targets as the replacement for the old scenario.

### 9. Low: The generation owner helper duplicates the shared session-owner assembly

- **Batches/commits:** T6.B135 `4a00f9d5c`, T6.B88 `ec4b0073f`.
- **Location:** `packages/agents/src/api/__tests__/helpers/generation-client-owner.ts:163-358`; `packages/agents/src/api/__tests__/helpers/client-owner-session.ts:80-242`.
- **Problem:** Both helpers separately implement the same Config/settings/policy/MCP/provider-file/provider/OAuth/tokenizer acquisition, provider activation, SessionClientOwner creation and cleanup sequence. The generation variant needs an unstarted chat and instance hooks, but duplicates the common assembly rather than sharing it. B135 explicitly deferred consolidation to T6.D2a; both copies remain at the reviewed head. Changes to production construction now require updates to both copies, and their confirmation-policy and cleanup details can drift. This is substantial duplicated fixture construction, rather than two thin subject-specific adapters.
- **Concrete fix:** Factor their common production-owner assembly into one helper with explicit production-constructor inputs for the provider contribution, client factory and tokenizer. Keep chat startup and generation-specific instance observation in thin adapters. Do not restore runtimeFactoryBindings or a public test-only seam. The CLI `owner-session-agents.ts` already wraps `openRouteAAgent` and is not a third copy of this domain assembly.

## Review checks and verification

The removal audit checked the cited fields against production at `e7f9b4973`, not just the final declarations. `AgentActivationBootstrap.adopt` wrote `adoptionConfig`, `adoptSettingsService`, `adoptIntent` and `adoptCredentialAuthority` at `activationPreflightState.ts:530-533`. The cited supplied-manager, bus, client, MCP, task-manager, memory and tools-callback inputs had no production writer. The historical foreground preflight writer at `profile-preflight.ts:693-709` always transferred memory. B132's five whole-scenario removals require the unreachable caller-manager/bus inputs and are justified; its separate stale lifetime replacement is finding 1. Removal of fixture-only sharing does not by itself justify removing a rollback, isolation, disposal-order or failure-reporting assertion.

Replacement targets were checked for presence and the asserted property, including definition-root retention/transfer, filesystem decoding, both caller-LSP disposal orders, memory ownership/disposal, policy subscriptions, activation-owner retirement, startup/restore rollback, task reservation/notification ownership, RecordingIntegration generation publication, provider runtime context, OAuth owner routing and CLI activation intent assembly. Findings above identify the targets that do not conserve the cited assertion. B160/B161 observe domain-owner clients through the production factory input and instance wrappers; these are not newly added prototype/static spies. B162/B163 remove the remaining capture consumers through public inputs and reads. No new skip or prototype/static spy was identified in the scoped additions. Existing spies and platform skips were distinguished from additions.

The MCP helpers `mcp-discovery-ready.ts` and `gated-recording-mcp.ts` do contain duplicate readiness code, but that duplication predates B81; it is not a new scoped finding. CLI `owner-session-agents.ts` is a thin Route A wrapper. The newly duplicated generation/session-owner assembly is finding 9. B104 adds a deadline-driven shell-file gate, and B86 uses public task-state polling with a real timer; neither is counted here as a timeout increase without an equivalent old deadline to compare. B102b has a direct old/new recovery-deadline comparison and is finding 5.

Integration fixes were checked individually:

- **T6.F1 `4116c8cb9`:** six consumer specs switch to the public core entry. No assertion change.
- **T6.F2 `9d89e5a6f`:** Darwin `EPERM` from the process-group existence probe is treated as still present, not as successful cleanup. Only `ESRCH` ends the wait; the existing 5,000 ms deadline remains. This is narrow OS-error handling and does not weaken the “group gone” assertion. Its zombie-specific explanation is broader than what EPERM alone proves, but the behavior is conservative and does not need a finding.
- **T6.F3 `0e8ba76e0`:** fake replay is scoped to its scenario and stripped from the child environment, allowing the contributed failure provider to run. Failure assertions remain.
- **T6.F4 `42d2b71d5`:** the integrated change subscribes to history-token publications and waits for expanded input plus reply; it does not contain the rejected waitFor-timeout increase. The original content assertion remains.

The cancellation concern recorded by B86 is resolved by **T6.P9 `1d9451dae`**, which checks disposal after awaited child preparation and before model startup. It is not an outstanding finding.

Focused read-only verification, one file per Bun process, stdin redirected from `/dev/null`, all completed within two minutes:

| Test | Result | Log under worktree |
| --- | --- | --- |
| agents `child-task-tool-lifetime.behavior.test.ts`, filtered to “joins cancellation during child preparation” | 1 pass, 1 filtered, 0 fail, 5 assertions | `tmp/phase6-review-b-child-preparation.log` |
| cli `compress-command-conservation.test.ts` | 15 pass, 0 fail, 37 assertions | `tmp/phase6-review-b-compress.log` |
| cli `app-input-producer.behavior.test.tsx` | 2 pass, 0 fail, 3 assertions | `tmp/phase6-review-b-app-input.log` |

Passing compression mapping tests do not disprove findings 3 or 8: those findings concern production/command paths that the replacement tests no longer exercise. No package suite, full gate, OCR run, source edit or plan edit was performed for this review.

## Follow-up

Verified these nine findings only, against `7ea7848f918460465ea7c6480a007f1e00bc7ff8`, the fix commits in `1aa0c6ac6..HEAD`, and the protocol's overriding corrections. **Resolved: 9. Not resolved: 0.** Finding 6 shares T6.F18 with batches-a finding 10, so the three reports contain 26 finding verdicts for 25 distinct fix-task identifiers.

### 1. T6.F22: resolved

`ff4219a70` changes `packages/providers/src/runtime/config-manager-lifecycle.behavior.test.ts:192-259` from a cached active-name read to an ownership-transfer test. A settings write changes the contributed provider's `clientRevision` while the receiving Agent lives, and a later write does not change it after disposal. T6.B128/B132 now classify the old supplied-manager survival assertion as Removed with its deleted `adoptProviderManager` proof, and name the actual transfer behavior rather than claiming borrowed lifetime coverage. Focused result: **7 pass, 0 fail**.

### 2. T6.F23: resolved

`d0dc9f434` fixes `packages/cli/src/cliProviderInit.ts:34-49`: profile model parameters are merged even when `--provider` selects the provider, and CLI parameters are applied afterwards. This matches `packages/cli/src/config/profileResolution.ts:77-88`, which preserves model parameters while dropping the profile's provider/model selection under an override. `cliProviderInit.profileModelParams.behavior.test.ts:53-101` parses actual provider/model arguments, invokes production `activateConfiguredProvider` on the Route B activation, and reads temperature/top-p/model from provider settings. The obsolete builder-only B138 scenario is replaced, not represented as production proof. Results: new regression **1 pass**, owner-2 **2 pass**, `cliBootstrap.providerActivation.test.ts` **9 pass**, handoff **4 pass**.

### 3. T6.F24: resolved

`9261f9a03` adds `packages/agents/src/api/__tests__/session-compression-missing-history.behavior.test.ts:31-117`. A real owner/client/chat, with an absent history-service read on the instance, reaches the production unavailable-chat guard and records zero compression calls. A separate `executeCompression` preparation rejection asserts zero compression, token, and recency reads. T6.B148 distinguishes the CLI mapping test from these agent-domain replacements. Results: missing-history **2 pass**, compression execution **8 pass**, CLI compression mapping **15 pass**.

### 4. T6.F25: resolved by the documented non-behavioral identity decision

`7ea7848f9` deletes empty-history and unset-content-config equality checks from `packages/cli/src/activation-bootstrap-handoff.test.ts` and `cliAgentBootstrap.test.ts`, and updates T6.B94/B96/B97/B100. Current production builds the activation client once into `ownedSessionClient` (`packages/agents/src/api/fromConfig-session.ts:284-309`), and foreground construction reads that field into `facadeSessionOwner` (`foreground-agent-assembly.ts:259-264`). No allowed pre-Agent operation seeds distinctive history. The records now remove the identity as non-behavioral and true by construction, rather than presenting comparisons of empty state as reuse coverage. Observable workspace, session identity, readiness, and retirement checks remain. Results: handoff **4 pass**, CLI bootstrap **9 pass**.

### 5. T6.F26: resolved

`b4f4c1c1f` removes the 5,000/15,000 ms recovery polls and mutating admission retry from `packages/cli/src/ui/hooks/agentStream/__tests__/useSubmitQuery.background-clear.test.tsx`. `helpers/notice-gates.ts:24-47` delegates the actual public notification subscription while exposing arrival, delivery-settled, and busy-evaluation events. Tests await those events, assert history once, and invoke session admission once (`background-clear.test.tsx:219-222`), with one event-loop turn for acknowledgment. Remaining `waitFor` calls use the original default, and the existing quiet-period delay remains unchanged. Result: **18 pass, 0 fail**, completed in 17.36 seconds.

### 6. T6.F18: resolved

The protocol's `Corrections after the phase 6 review` withdraw the blanket count-drop rule. Exact-count/no-call assertions require an equivalent named public/domain test or a specific deleted-input proof. Checked applications:

- `633d555d1`: `adoption-binding-failure.behavior.test.ts:89` restores one owner retirement, paired with the existing retired-operation rejection (**1 pass**).
- `3f9c9e25d`: CLI `client-tool-owner-owner-7.test.tsx:91` uses a contributed scripted provider and asserts exactly two model requests (**1 pass**).
- `36069bda4`: `session-restore-history-failure.behavior.test.ts:86-108` checks that real-client `setHistory` is never called by restore, while retaining actual restored history (**2 pass** in the file). `compression-execution.test.ts:86` asserts one recency read per outcome (**8 pass**).
- `f99f862c9`: `generate-empty-input.behavior.test.ts:25-52` asserts no detached client or provider request for empty input, then exactly one of each for real input (**1 pass**).
- `86870ac10`: T6.B10 lists the residual `startChat`/`getChat` lines by scenario and cites the deleted injected `adoptAgentClient` object. I checked the production unconfigured guard in `foregroundRunLifecycle.ts:97-102` and the foreground generation guards: they reject before client work. The removed hand-made-client calls are no longer described as covered by a zero provider-request count; that count covers model effects only. Results: `agentUnconfigured.behavior.test.ts` **12 pass**, recorder control **2 pass**.

These resolve the cited applications without equating an at-least-once effect with an exact count.

### 7. T6.F27: resolved

`cf42d4a80` adds `packages/agents/src/api/__tests__/message-bus-subscriber-disposal.behavior.test.ts:53,97,119,174`. Production-constructed scheduler/confirmation coordinator, turn execution owner, hook control, and session hook owner each return a real test-owned bus's listener count to its baseline. The existing policy-owner test supplies the policy updater. I checked the corresponding production subscription/release sites and T6.B87's replacement inventory, including its distinction between persistent owner subscriptions and host-held/per-call subscriptions. The client uses settings-model notifications rather than another persistent MessageBus subscription; its existing owner-disposal test remains in the set. Agent-level teardown effects remain in `disposal.spec.ts`. Results: new subscriber tests **4 pass**, policy owner **1 pass**, client owner disposal **2 pass**, Agent disposal **6 pass**.

### 8. T6.F28: resolved

`52061d4b6` adds `packages/cli/src/ui/commands/chatOwnerCommand.test.ts:211-237`. It invokes the production owner-command binding with a rejecting restore collaborator, asserts the exact error result, no UI load/clear/add-item calls, and retained live/durable history. The agent-domain restoration failure test remains responsible for the actual session rollback. T6.B148 names both targets, so failure reporting and rollback are no longer conflated. Results: command boundary **7 pass**, session restoration **2 pass**.

### 9. T6.F29: resolved

`eca4aa2d4` consolidates the duplicated construction in `packages/agents/src/api/__tests__/helpers/production-client-owner.ts:105-268`: Config/settings/policy/MCP/provider files/manager/OAuth/tokenizer acquisition, client-owner construction/binding, provider activation, and resource cleanup have one implementation with explicit constructor inputs. `client-owner-session.ts:62` delegates there and starts the chat; `generation-client-owner.ts:172` delegates there and retains generation-specific instance hooks, tokenizer admission, and scratch-directory cleanup. Neither adapter duplicates the provider/MCP acquisition sequence. No removed public factory seam is restored. Both adapters were exercised by this follow-up's focused tests, including owner rollback, recording identity, instructions, child settings, compression, restore, and empty-input generation; all passed.

### Follow-up verification record

Across all three reports, **236 tests passed, 0 failed, 0 skipped across 45 focused files**. Each ran one file per Bun process from the relevant package directory with `exec < /dev/null; bun test --timeout 180000 ./<path>`, with an external 119-second process limit. Every process finished below two minutes. Raw output and per-file counts are in `tmp/phase6-followup-20261025/` (`results.json`, `extra-results.json`, numbered logs). The T6.F30 affected-test-shards drift check also passed. No package suite, full gate, source edit, or OCR review was performed.
