# Phase 6 review: T6.B01-T6.B80

Scope: batches T6.B01-T6.B80 and follow-ups B05b, B19b, B50b, B51b, B53b, B54b, B55b, B57b, B68b, B72b and B79b. Comparison baseline: `e7f9b4973`. Source and plan files are not changed by this review.

## Findings

Review complete: **3 High, 10 Medium, 0 Low**. Findings below include the affected commit, source location and concrete remediation.

### 1. [High] B07 replaces media-store lifetime assertions with an always-empty directory check

- **Batch / commit:** T6.B07, `8c856a217`.
- **Location:** `packages/agents/src/api/__tests__/adoption-publication-barrier.behavior.test.ts:153` (also 189, 220, 253; helper at 40).
- **Problem:** Four store-open assertions were deleted, and four store-closed rejections became `liveMediaStores(...).toHaveLength(0)`. The test never admits media to this store, so its directory is absent whether or not the store closes. The batch record explicitly acknowledges this. The remaining filesystem-owner disposal assertion cannot detect a missing or premature `SessionMediaOwner.dispose()`. These are resource-order assertions on a production-owned resource, not assertions made impossible by deleting a caller-injection field. The new test therefore passes if media cleanup is omitted or moved ahead of the held image operation.
- **Concrete fix:** Preserve the open-during-join and closed-after-release claims using a real media admission and its filesystem effects, or add a named domain-level test of the production activation-release composition that proves those same lifetime boundaries. A standalone test that `SessionMediaOwner.dispose()` closes its own store does not prove the activation invokes it at the right point.

### 2. [High] B35 moves the cancellation gate before foreground acquisition and loses the rollback case

- **Batch / commit:** T6.B35, `85546369b`.
- **Location:** `packages/agents/src/api/__tests__/post-config-preflight.test.ts:213-243`.
- **Problem:** `joins accepted foreground acquisition before activation disposal completes` previously cancelled construction while tokenizer preparation held it after token consumption. It now starts a held `activation.readHistory()` before construction, then cancels while construction is joining that earlier work. It never reaches token consumption or foreground MCP acquisition. The batch's own lost-coverage note confirms this. A broken rollback of resources acquired after token consumption now passes this test. This also introduces another prototype-spy use in this scenario instead of preserving the original scenario through an allowed production input/domain test.
- **Concrete fix:** Keep the early-public-work test if useful, but restore the late-acquisition cancellation scenario through a production constructor/input that can hold an actually acquired foreground collaborator. Assert cancellation, cleanup completion, and retained/transferred settings behavior at that boundary. If no allowed observation exists, leave this scenario unresolved under the plan's stop rule rather than count it as Kept.

### 3. [High] B68b deletes a reachable rollback scenario using an incorrect production-reachability ruling

- **Batch / commit:** T6.B68b, `e586bad74`.
- **Location:** `packages/agents/src/api/__tests__/session-recording-identity.behavior.test.ts:216` (deleted test immediately before this point); `B2-batch-records/T6.B68b.md:13`; `tmp/lanes/BATCH-PROTOCOL.md`, standing ruling for `sessionIdentityOwnership: 'config'`.
- **Problem:** `releases prepared recording and lock when reading prior history fails before adoption` was removed because `'config'` ownership allegedly has no production caller. That conclusion confuses removal of an adoption override with removal of the production behavior. At both `e7f9b4973` and HEAD, `agentRuntimeAssembly.ts` sets `sessionIdentityOwnership = 'config'` for `createAgent`, and `foreground-agent-assembly.ts:300` sets it for Route B. The deleted scenario used `buildAgent`, which calls `createAgent`; it did not supply the removed `AgentAdoptionIntent` option. Its assertions covered release of the prepared lock, recording remaining disabled, unchanged Config identity, and a successful retry when the prior-history read fails. The remaining rollback test fails later, after Config mutation, and does not exercise this earlier cleanup path. This orchestrator ruling contradicts both the production writers and the plan's prohibition on removing reachable rollback/failure scenarios.
- **Concrete fix:** Restore the scenario as a domain-level `SessionControl` test built from a production `SessionClientOwner`, wrapping the real client's `getHistory` on the instance. Keep all lock, recording-state, identity and retry assertions, with a test-owned Config accessible to the test. Correct the standing ruling to distinguish the removed override from the production Route B/C ownership mode.

### 4. [Medium] B35's named bus-identity coverage does not occur in the scenarios that drop the assertions

- **Batch / commit:** T6.B35, `85546369b`.
- **Location:** `packages/agents/src/api/__tests__/post-config-preflight.test.ts:481-517,566-595`; `B2-batch-records/T6.B35.md`, resolution U2.
- **Problem:** Both the activation-to-agent bus identity and the activation-to-OAuth bus identity were dropped with a reference to tool-confirmation coverage in T6.B09. Neither affected scenario executes a turn or delivers a confirmation. Their current reads succeed with an unrelated bus, and ordinary tool confirmations elsewhere do not prove the OAuth manager uses the activation bus. The observation rule requires a covering assertion in the same scenario that fails when the identity property breaks.
- **Concrete fix:** Exercise the relevant bus path within each affected scenario, including an OAuth prompt/response path for the OAuth bus relationship. If that cannot be expressed through the public route, provide a named domain-level replacement for that relationship rather than citing unrelated B09 tests.

### 5. [Medium] B33 replaces the lightweight content-generation path with a second JSON-generation call

- **Batch / commit:** T6.B33, `9611608ed`.
- **Location:** `packages/agents/src/api/__tests__/mcp-instruction-owner.test.ts:326-330`.
- **Problem:** The original B-side auxiliary request called `client.generateContent(...)`; the migrated request calls `agent.generateJson(...)`, duplicating A's existing path. These use different system-prompt assembly. The batch record acknowledges losing direct MCP-instruction propagation coverage for lightweight `generateContent`. This path remains production-reachable, for example `packages/core/src/utils/summarizer.ts:86`, so deleting an adoption input does not justify losing it. A regression limited to that prompt builder now passes the scenario.
- **Concrete fix:** Retain the public-agent checks and add a named domain-level test using a real `SessionClientOwner` and its factory-produced client. Call `generateContent` against the local endpoint and preserve the owner-present/peer-absent instruction assertions.

### 6. [Medium] B36's OAuth replacement reads the fixture back to itself instead of using the transferred OAuth owner

- **Batch / commit:** T6.B36, `e2403c119`.
- **Location:** `packages/agents/src/api/__tests__/preflight-release.behavior.test.ts:348-353`.
- **Problem:** The old assertion read `oauth.getTokenStore().listProviders()` after preflight disposal. The replacement saves a token through `credentials().saveToken(0, ...)` and lists it through `credentials().listProviders(0)`. Both operations bypass the production OAuth manager. They still succeed if the receiving agent's OAuth manager is wired to another token store, or its OAuth read path is no longer usable after preflight disposal. The adjacent transport-close snapshots prove transport lifetime, but not the missing manager-to-store relationship. The record explicitly says the new read does not go through the manager.
- **Concrete fix:** Exercise a token-dependent public auth operation on the receiving Agent after disposing the preflight and assert its result reflects the saved token. If the provider needs to be contributed to make this observable, scope that contribution to this scenario. Alternatively name a domain-level transfer test that preserves the manager-to-store read, paired with the existing agent-level lifetime checks.

### 7. [Medium] B64 changes a cross-provider profile replacement into a same-provider model change

- **Batch / commit:** T6.B64, `1b2f6f114`.
- **Location:** `packages/agents/src/api/__tests__/session-client-profile-engine.behavior.test.ts:44-57`.
- **Problem:** The original snapshot selected `engine-profile-provider`, distinct from the initially active `fake` provider. The migrated snapshot still selects `fake`; the active-provider assertion consequently succeeds even if provider switching is broken. The added model assertion proves only a model change. The record's justification that the replay seam registers only `fake` is a fixture limitation, not a production restriction: the plan permits contributed providers through Routes B/C, and other batches use them for this purpose. History retention across a real provider switch is no longer tested by this scenario.
- **Concrete fix:** Run this scenario with two contributed providers on Route B/C, without the fake replay seam for this scenario, and retain the history, changed-provider and selected-model assertions. Keep removal of the genuinely unreachable caller-client-survival assertions separate from this reachable provider-switch behavior.

### 8. [Medium] New domain replacements subclass production collaborators despite the domain-level construction rule

- **Batches / commits:** T6.B54b, `91a4ae4b7`; T6.B76, `c5d0bc9fc`.
- **Locations:** `packages/core/src/recording/RecordingIntegration.finalizerJoin.test.ts:41-47`; `packages/agents/src/api/__tests__/task-child-settings-admission.behavior.test.ts:30-37,142-145`.
- **Problem:** The new replacements introduce `ControlledPersistenceService extends SessionPersistenceService` and `RecordingSettingsOwner extends SessionSettingsOwner`. The former replaces `save` entirely with a controlled promise; the latter intercepts child-store creation by subclassing the production settings owner. The plan explicitly excludes production subclasses from domain-level Kept tests. Calling these production-constructed collaborators in the batch records does not satisfy that condition. The finalizer replacement also no longer runs the real persistence save for its replacement assertions.
- **Concrete fix:** Use normally constructed production collaborators. Hold/reject the real persistence write at the existing filesystem boundary, retaining the persisted-file/late-write assertions. Record child-store products with a delegating instance wrapper on the test-owned settings owner, rather than a subclass, if that observation is admitted by the constructor-input rule; otherwise use the stop rule and name an allowed replacement. Preserve the expected values and failure assertions.

### 9. [Medium] B64's preflight read rejection does not cover transfer of the original client

- **Batch / commit:** T6.B64, `1b2f6f114`.
- **Location:** `packages/agents/src/api/__tests__/session-client-profile-engine.behavior.test.ts:71-100`.
- **Problem:** The original `publishedClient(agent).toBe(client)` was dropped. Its named cover is that `route.preflight.captureHistory()` rejects after transfer and `agent.getHistory()` rejects after disposal. Both checks also pass if construction closes the old client and builds a different one. The test writes history only after construction and never reads that written history before disposal. It therefore does not verify any state crosses the handoff. This fails the observation rule's explicit history-round-trip requirement for the pre-agent/client relationship.
- **Concrete fix:** Before construction, write non-empty distinguishable history through an allowed preflight operation and read it through the Agent after construction, with an intervening turn where required by the plan. Retain the post-retirement rejection checks. If the route cannot seed history through an allowed input, name a domain-level replacement rather than treating closed-read checks as identity coverage.

### 10. [Medium] The standing count-drop ruling permits weakened disposal assertions, and B06 applies it

- **Batch / commit:** T6.B06, `2b1ab1dfa`.
- **Location:** `packages/agents/src/api/__tests__/adoption-binding-failure.behavior.test.ts:65-68`; `tmp/lanes/BATCH-PROTOCOL.md`, standing ruling beginning `A count observable only through a prototype spy`.
- **Problem:** `expect(retired).toHaveLength(1)` was dropped and replaced with a disposed-operation rejection. The latter proves retirement happened, but cannot detect a second retirement call. This is an exact-count invariant, not an internal object-identity assertion. The ruling broadly allows removing such counts whenever some effect remains, contradicting the plan's narrow exception for identity assertions and its prohibition on weakened assertions. Removing the prototype spy is required; removing the count without equivalent coverage is not.
- **Concrete fix:** Replace the exact-once check with a named production-owner/domain test that observes the relevant cleanup once through a test-owned input or delegating instance boundary. Correct the shared ruling to require equivalent exact-count coverage, rather than substituting any evidence that disposal occurred.

### 11. [Medium] B35 drops OAuth/file publication ordering without a replacement

- **Batch / commit:** T6.B35, `85546369b`.
- **Location:** `packages/agents/src/api/__tests__/post-config-preflight.test.ts:623`.
- **Problem:** The expected startup sequence changes from `['policy', 'manager', 'oauth', 'files']` to `['policy', 'manager']`. The record explicitly identifies the loss of OAuth/file publication ordering and provides no replacement. Neither resource is removed from production; only the observer that exposed them is removed. The remaining readiness checks cannot establish ordering relative to manager publication, so this Kept ordering scenario has fewer guarantees.
- **Concrete fix:** Preserve the sequencing invariant in a named test of the production preflight composition using observable OAuth/file effects or production-filled constructor inputs. If that cannot be expressed without forbidden observation, record it under the stop rule rather than marking the scenario complete with a shorter expected sequence.

### 12. [Medium] B29 removes the caller-settings survival assertion and substitutes `undefined === undefined`

- **Batch / commit:** T6.B29, `afecc5557`.
- **Location:** `packages/agents/src/api/__tests__/instruction-publication-drain.behavior.test.ts:155-157`; `B2-batch-records/T6.B29.md`, decision 4.
- **Problem:** In the `peerFirst` case, `survivor` is assigned `undefined`, and the former settings-usability check becomes `expect(survivor?.maxOutputTokens).toBe(undefined)`. No settings operation occurs. The removal is justified by claiming caller-shared settings cannot be supplied in production. That is false for `SettingsService`: `fromConfig` explicitly accepts it, and `AgentActivationBootstrap.adopt` writes `adoptSettingsService` at both the baseline and HEAD. The removed `adoptSettingsOwner` field does not make the service itself unreachable. Other migrated batches, including B12, retain caller-settings disposal coverage through Route A.
- **Concrete fix:** Keep a test-owned SettingsService alive across both retirement orders and assert a real write/read after the held close, through Route A or a named domain-level replacement. Remove the tautological assertion and correct the production-reachability rationale. Preserve the separate instruction-publication join assertion.

### 13. [Medium] B19b drops client existence/readiness checks with covers that do not access the client

- **Batch / commit:** T6.B19b, `0f8c8e43a`.
- **Location:** `packages/agents/src/api/__tests__/createAgent.activation.behavior.test.ts:219-222`; `packages/agents/src/api/__tests__/providerActivation.scopePersistence.behavior.test.ts:152-170,205-216`.
- **Problem:** The no-replay construction cases drop `publishedClient(agent).toBeDefined()` and cite `getProvider()`/`getModel()` plus a separate construction-resolves check as coverage. Those reads only establish provider/model metadata, not that the session client was constructed. The unconfigured case similarly loses its `clientReady` check. The replacement's `activate()` uses `fromConfig`, not `createAgent`, and tests scope persistence; it cannot detect omission of client initialization specifically in the preferred construction route. Client existence is also not a comparison between internal object identities, so the narrow identity-drop exception does not justify this omission.
- **Concrete fix:** Add an allowed client-dependent public operation that succeeds only if the client exists in each affected construction mode. If no Agent operation can observe the unconfigured mode, supply a named domain-level replacement of that construction step rather than treating metadata getters or successful construction through another route as readiness evidence.

## Review completion and verification limits

Confirmed findings: **13 total: 3 High, 10 Medium, 0 Low**. The two shared-ruling contradictions with concrete affected scenarios are recorded in findings 3 and 10.

The audit read the assigned batch records and follow-ups, checked the cited adoption fields with `git grep` at `e7f9b4973` and HEAD, and inspected risky batch diffs and current replacement targets. In particular, production still writes config identity ownership on Routes B/C, while the removed adoption-input fields generally have no production writers. Diff sampling covered assertion removals, identity replacements, domain substitutions, prototype observation, timeout/deadline changes and expectation-count reductions. No newly introduced skip or definite increase of an existing test timeout was established in the sampled changes. New deadline polling was inspected, including B51b's model-refresh polling; it is not itself reported as a regression without evidence that it weakens an existing timing guarantee.

Read-only focused verification, one file per Bun process from `packages/core` with stdin redirected from `/dev/null`:

- `bun test ./src/recording/RecordingIntegration.compressionOrigin.test.ts`: 1 pass, 0 fail.
- `bun test ./src/recording/RecordingIntegration.finalizerJoin.test.ts`: 2 pass, 0 fail. Passing does not resolve the construction-rule violation in finding 8.
- `bun test ./src/recording/RecordingIntegration.sharedHistoryOrigin.test.ts`: 3 pass, 0 fail.
- `bun test ./src/services/history/HistoryService.replaceAll.test.ts`: 5 pass, 0 fail.

No package suite, full gate, source change, plan change, commit or push was performed by this reviewer. Passing replacement tests establish that the checked targets execute, not that the missing invariants in the findings are covered. Review endpoint: `f7c79e4f9`.

## Follow-up

Verified these thirteen findings only, at `7ea7848f918460465ea7c6480a007f1e00bc7ff8`, using the fix diffs in `1aa0c6ac6..HEAD`, current code, batch decisions, and the protocol's overriding corrections. **Resolved: 13. Not resolved: 0.** References below are relative to `packages/agents/src/api/__tests__/` unless a different path is given.

### 1. T6.F9: resolved

`7b0ae74b3` changes `adoption-publication-barrier.behavior.test.ts:52,173,211` to admit actual media through the published Agent. Scenarios 1 and 2 now observe one live store after handoff and no store after Agent disposal. Scenarios 3 and 4 no longer claim that an always-absent directory proves closure. The decision in `7d7c11710` / T6.B07 names `activationOwnerRetirement.test.ts` and `activation-media-owner-lifetime.behavior.test.ts` as the replacement set. I checked the production composition at `packages/agents/src/api/activationPreflightState.ts:408-429`: media disposal is explicitly in `afterClient`, following the joined public work/memory/client. The retirement tests hold both successful and failing client cleanup before allowing the media step; the real media-owner test admits bytes and observes its closed store. Together these cover ordering and real closure without pretending a pre-Agent media admission route exists. Results: publication barrier **4 pass**, retirement **7 pass**, media lifetime **3 pass**.

### 2. T6.F10: resolved

`c2375d4e1` adds `post-config-preflight.test.ts:278-349` for both settings-ownership cases. A real `toolDiscoveryCommand` blocks on a FIFO after token consumption and foreground MCP acquisition. Disposal remains pending until discovery is released; publication then rejects with `AbortError`, cleanup completes, retired reads reject, and borrowed settings remain writable. The earlier public-work scenario remains separate and is no longer presented as late acquisition. No new prototype spy implements the new hold. Result: **22 pass** in the file.

### 3. T6.F11: resolved

`1091a2bf6` restores `session-recording-identity.behavior.test.ts:310-365`. A real `SessionClientOwner` supplies the client and a `SessionControl` with config-owned identity; a one-shot instance `getHistory` failure leaves the Config identity unchanged, recording disabled, and no lock, then a retry restores distinctive history and adopts the source identity. Production still selects config ownership on Routes B/C. The protocol correction explicitly distinguishes that production mode from the deleted override. Result: **6 pass**.

### 4. T6.F12: resolved

`7708259f0` adds the named domain/public-route replacement at `post-config-preflight.test.ts:612-666`. The contributed provider exposes the preflight's real OAuth manager. Its multi-bucket consent request reaches `agent.auth.subscribeBucketConsent`, and the Agent's response cancels the manager's authentication with the expected error. This discriminates manager-to-Agent bus wiring. I also checked that production passes the activation bus into the foreground handoff; the test does not claim to read that private bus directly. T6.B35 U2 names this replacement for both dropped relationships. Result: **22 pass** in the file.

### 5. T6.F13: resolved

`5b0abbcd7` adds `mcp-instruction-owner.test.ts:398-478`. Two production-built owner clients call the real lightweight `generateContent` path against a local endpoint. Each request contains its owner's MCP instruction and excludes the peer's. The original public Agent checks remain. This covers the distinct lightweight prompt builder rather than substituting another JSON call. Result: **2 pass**.

### 6. T6.F14: resolved

`555e857f7` changes `preflight-release.behavior.test.ts:348-362` to read authentication through the receiving Agent after preflight disposal. `detailedStatus('codex')` is initially unauthenticated, then reports authentication and the saved expiry after the authority's token-store write. Unlike the earlier fixture-only list read, the result depends on the receiving OAuth manager's store binding. Transport lifetime assertions remain. Result: **10 pass**.

### 7. T6.F15: resolved

`83cfa8c5e` changes `session-client-profile-engine.behavior.test.ts:35-77` to use two contributed providers without the replay seam. It asserts the first provider before the snapshot, the second provider and selected model afterwards, and retained human history. A same-provider-only implementation no longer satisfies the provider assertion. Result: **3 pass**.

### 8. T6.F16: resolved

`12c897092` removes both production subclasses. `packages/core/src/recording/RecordingIntegration.finalizerJoin.test.ts:79,122` constructs the real persistence service and holds/rejects its actual publishing rename; persisted-file, journal, listener, late-write, and cleanup-failure assertions remain. `task-child-settings-admission.behavior.test.ts:135-144` constructs a plain settings owner and records products through a delegating instance wrapper. A search finds neither prohibited subclass in these replacements. Results: finalizer **2 pass**, child settings **3 pass**.

### 9. T6.F17: resolved by the documented non-behavioral identity decision

`7ea7848f9` corrects T6.B64's claim that retirement rejections prove client identity. I checked the construction: `packages/agents/src/api/fromConfig-session.ts:284-309` installs the pre-Agent owner in `ownedSessionClient`; `foreground-agent-assembly.ts:259-264` uses that same field for the Agent and constructs no replacement there. No allowed pre-Agent input writes distinctive client history. The removed identity is therefore documented as non-behavioral and true by construction, rather than falsely covered by empty state. The post-transfer and post-disposal rejections remain as retirement assertions only. Result: profile-engine **3 pass**.

### 10. T6.F18: resolved

`633d555d1` restores the exact retirement count in `adoption-binding-failure.behavior.test.ts:27-37,89`: a delegating wrapper on the activation's production-built owner counts one disposal after failure. The existing disposed-operation rejection remains. The protocol's corrections withdraw the blanket count-drop permission and require an equivalent count/no-call assertion or a specific deleted-input proof. Result: **1 pass**. The additional cross-batch applications of this same ruling are assessed in batches-b finding 6.

### 11. T6.F19: resolved by correcting the ordering contract

`6790a9fcb` / `post-config-preflight.test.ts:761-787` now observes contributed OAuth registration before preparation, then policy/manager publication during preparation. Production `packages/agents/src/api/profile-preflight.ts:121-133,175-227` constructs the provider-file lifecycle and OAuth manager before post-config preparation. The old four-stage observer list did not describe that production order. T6.B35 U4 records the file-lifecycle handoff position as unobservable under the stop rule, rather than claiming the shortened stage list covers it. This resolves the finding's false conservation claim without inventing a public observation. Result: **22 pass** in the file.

### 12. T6.F20: resolved through the named replacement set

`f46741637` removes the peer-first `undefined === undefined` assertion from `instruction-publication-drain.behavior.test.ts:107-159`. The file retains the held-publication join and a usable surviving peer when applicable. `borrowed-settings-disposal.behavior.test.ts:82-128` independently constructs two Route A agents over the caller's real settings service, checks closed-facade rejection, and checks a peer write/turn plus caller-service read in both retirement orders. T6.B29 decision 7 correctly describes this split: caller settings and the tokenizer hold are not jointly supplied by one production construction route. Neither test is represented as covering the other's property. Results: publication drain **2 pass**, borrowed settings **2 pass**.

### 13. T6.F21: resolved

`94ebdf54a` adds a client-backed history round trip to the affected construction modes: `createAgent.activation.behavior.test.ts:23-29,47,236` and `providerActivation.scopePersistence.behavior.test.ts:63-72`. The distinct `client-probe` must survive `setHistory`/`getHistory`, including unconfigured/no-replay modes, so provider/model metadata alone cannot satisfy readiness. Results: preferred activation **10 pass**, provider-scope persistence **8 pass**.

### Follow-up verification record

All results above are from this follow-up, not copied from commit messages. Across the three reports: **236 pass, 0 fail, 0 skip, 45 focused files**. Each file ran in its own Bun process from the appropriate package directory with `exec < /dev/null; bun test --timeout 180000 ./<path>`, externally limited to 119 seconds. All completed below two minutes. Logs and per-file counts: `tmp/phase6-followup-20261025/` (`results.json`, `extra-results.json`, numbered logs). No package suites, full gate, source edits, or OCR review were performed.
