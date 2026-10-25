# Phase 6 production review

Review in progress. Scope: production changes in e7f9b4973..HEAD and the requested D2b coverage decision. Findings will be appended as verified.

## Findings

### 1. Medium: D2b leaves test-only construction and task-registration inputs in production

**Commit:** `f7c79e4f9` (T6.D2b). **Locations:** `packages/agents/src/api/policyComposition.ts:66-68,83,91`; `packages/agents/src/session/session-client-owner.ts:339,406-408,457`; `packages/agents/src/api/agentRuntimeAssembly.ts:439-441`.

Removing `runtimeFactoryBindings` removed the last production writer of `bindCreatedSessionClient`'s `factory` and `registration` inputs. Its only production caller now passes `undefined` to both. Likewise, all three production `bindMcpRuntime` callers omit or pass `undefined` for the registration transform, leaving `bindTaskRegistration`'s transform branch unreachable except from tests. This retains the same test-only production route B2 and the Must-not list require deleting. The D2b commit explicitly leaves these inputs for follow-up, but the phase's final state still contains them.

**Concrete fix:** Delete the factory and registration parameters from `bindCreatedSessionClient`, delete the registration parameter from `bindMcpRuntime` and the transform parameter/branch from `bindTaskRegistration`, and update their callers. Migrate `policy-client-binding-rollback.behavior.test.ts` onto a production-reachable failure at the relevant owner boundary. Do **not** delete `acquireSessionClient`'s factory parameter or `SessionClientOwner.create`'s factory: `ChildAgentAssembly.prepareClient` still passes `this.clientFactory` (`child-agent-assembly.ts:294`), supplied by `SessionClientOwner.bindTaskRegistration` through `buildAgentClientFactory()` (`session-client-owner.ts:432`). Those lower-level inputs remain used in production.

### 2. Low: D1a preserves obsolete adoption cleanup code solely for tests

**Commit:** `9eb6e2fab` (T6.D1a). **Locations:** `packages/agents/src/api/adopted-definition-assembly.ts:9-37`; `packages/agents/src/api/fromConfig-cleanup.ts:36-58`.

D1a removes every production caller of `adoptedDefinitionCleanup` and `cleanupFailedFromConfig` but leaves both implementations. Repository-wide reference searches find only their declarations and tests. Their parameters preserve exactly the removed adoption shapes: separately supplied definitions and ownership, borrowed workspace ownership, transferred images/GitHub, and an adoption preflight closer. The commit says they remain because domain-level tests call them. A test of a function with no production consumer does not conserve production rollback coverage and is not a reason to retain the deleted route.

**Concrete fix:** Delete `adopted-definition-assembly.ts` and `cleanupFailedFromConfig`. Repoint their cleanup/error-preservation scenarios to the live `cleanupFailedAdoption` path or to public `fromConfig` construction failures, retaining rollback and failure-reporting assertions where those behaviors remain reachable. Remove scenarios specific to inputs that D1a deleted.

### 3. Medium: P6 reports the same transferred-owner cleanup failure twice

**Commit:** `800f3b8b9` (T6.P6). **Locations:** `packages/agents/src/api/agentRuntimeAssembly.ts:219`; `packages/agents/src/api/transferred-workspace-owners.ts:23-24,40-42,53-55`.

The outer rollback unconditionally disposes transferred owners even after MCP has accepted and disposed them in `finish()`'s failure cleanup. Memoized disposal avoids a second physical release, but returns the same **rejected** promise, so the outer rollback appends its failure a second time. The comment claiming this is a no-op is false for failures. This also creates two cleanup authorities for the same transfer.

**Reproduction through `createAgent`:** Supply a real `WorkspaceFilesystemOwner` with a workspace-owned `StandardFileSystemService` and a `release` callback that throws `PROBE_FILESYSTEM_FAILURE`; transfer it with `filesystemOwnership: 'agent'`; use `provider: 'openai'` and a strict activation intent for a nonexistent provider. A read-only Bun probe produced `releases: 1`, but aggregate leaves were `["createAgent activation failed: Provider 'nonexistent-probe-provider' not found", "PROBE_FILESYSTEM_FAILURE", "PROBE_FILESYSTEM_FAILURE"]`. Both cleanup leaves were the same error object.

**Concrete fix:** Give transferred owners one rollback authority and an explicit handoff when MCP accepts responsibility, including the MCP-construction failure path. Outer cleanup must release only owners not already handled by that authority. Do not deduplicate arbitrary error objects: independent cleanup steps can legitimately throw the same object. Add a public `createAgent` regression test with the failure setup above, asserting one physical release and one reported cleanup failure, with the activation error first.

### 4. Medium: D2b removes native-acquisition rollback and join coverage without replacement

**Commit:** `f7c79e4f9` (T6.D2b). **Location:** `packages/agents/src/api/__tests__/preflight-acquisition-closure.behavior.test.ts:48-143`.

The memory-only scenario disposes before native acquisition begins. The rewritten host-failure scenario throws in `beforePreparation`, before `#preparePostConfiguration` creates the session settings binding, provisional activation, or client. Neither exercises disposal with a provisional native acquisition, retirement of the acquired client, or preservation of borrowed settings after native acquisition fails. The existing `post-config-preflight.test.ts` failed-preparation scenario also throws during manager publication, before native acquisition; its foreground-acquisition join tests start after preparation has completed. These are different ownership windows. The deleted static spies should stay deleted, but the conservation rule explicitly forbids dropping rollback/join scenarios merely because their old fixture is invalid. An async function's microtask-only completion still permits disposal to interleave.

**Concrete fix:** Add production-route replacements in this file. For post-native rollback, call `preparePostConfiguration` with a real, already-disposed host-supplied memory owner: `bindActivationClient` calls `client.bindWorkspaceInstructions(memory)` only after native client acquisition, and the real memory subscription rejects. Assert the original failure is retained, preflight admission is closed, borrowed settings still work, and credential handles close exactly once. For the join window, use the supplied settings owner's instance `subscribeModelChanges` boundary to queue disposal while initial native binding is unwinding, then assert accepted preparation settles before disposal releases its credentials and that repeated disposal joins the same cleanup. Keep any held client-cleanup assertion at the `SessionClientOwner` domain boundary using its still-production-filled factory parameter. Do not restore `spyOn(SessionClientOwner, 'create')` or add a test-only public input.

## Verification and scope

Reviewed through `f7c79e4f92e940b8711413284a29dadae8acfc83`, including all production diffs for T6.P1-P9, D1a, D1b, D2b and both D2a deletion commits. No production or plan files were edited.

The remaining requested changes have no additional finding: P1 strips the two existing public factory inputs before strict schema validation; P2 moves host credential acquisition inside rollback; P3 creates the trust-subscribing hook system while trust is live without eagerly initializing hook definitions; P4 reads the manager actually activated; P5 starts from deferred restored history rather than resetting it; P7 preserves retirement ordering and error ordering; P8 marks the journaled seed before subscribing; P9 checks closed admission after awaited preparation. For an already-aborted parent, `bindParentSignal` immediately aborts the new controller. Interactive `Turn.run` checks it before requesting a stream; the noninteractive consumer returns before iterating the lazy provider stream. I found no additional model-start regression in that case. P6's synchronous definition-admission close and early transferred-owner release address their reported bugs, with the duplicate-failure defect in finding 3.

The P1-P6/P8-P9 regression scenarios use public construction/Agent operations or production child-owner construction rather than the deleted capture routes. P7 is a refactor with characterization and owner-retirement unit coverage, not a bug fix requiring an invented red test. Historical red results are described in the commits; this review ran current-head tests, not reconstructed pre-fix worktrees.

Ran the plan's D2a/D2b verification greps directly: the forbidden capture exports, prototype/static capture hooks, runtime-factory descriptor/type, removed activation inputs, borrowed-client input, and removed adoption handoff validators have no hits. All six named obsolete fixture files are absent. `AgentAdoptionIntent` has exactly `sessionId` and `activation`. Remaining declared `adopt*` fields are production-populated inputs or derived state. These literal checks pass, but do not detect the residual code in findings 1 and 2. `bun scripts/check-agents-api-surface.ts` passed.

Focused tests, one file per Bun process from `packages/agents`, with stdin closed and each invocation below two minutes: **52 passed, 0 failed across 10 files**.

- `src/api/__tests__/preferred-acquisition.behavior.test.ts`: 13 passed.
- `src/core/__tests__/child-task-tool-lifetime.behavior.test.ts`: 2 passed.
- `src/api/__tests__/set-history-then-add-history.behavior.test.ts`: 2 passed.
- `src/api/__tests__/createAgent.injectedFactories.behavior.test.ts`: 3 passed.
- `src/api/__tests__/generate-history.behavior.test.ts`: 9 passed.
- `src/api/activationOwnerRetirement.test.ts`: 7 passed.
- `src/api/__tests__/hook-session-shutdown.behavior.test.ts`: 9 passed.
- `src/api/__tests__/workspace-definition-transfer.behavior.test.ts`: 3 passed.
- `src/api/__tests__/preflight-acquisition-closure.behavior.test.ts`: 3 passed.
- `src/api/__tests__/providerActivation-owner-3.behavior.test.ts`: 1 passed.

The inline production-route probe for finding 3 reproduced duplicate aggregate leaves. A second inline probe verified finding 4's disposed-memory replacement route: preparation rejected with `Workspace memory is disposed`, preflight reads rejected as disposed, and the borrowed settings owner remained writable. Neither probe edited source files. No package suite or concurrent full gate was run by this reviewer.

Additional dead declaration covered by finding 2: `packages/agents/src/api/fromConfig.ts:9-18` retains `PrepareSessionTools` and its tool-type imports after D1a removed its only consumer, `adoptPrepareSessionTools`. A repository-wide reference search finds only the declaration. Delete it with the orphaned adoption helpers.

**Counts:** Critical 0; High 0; Medium 3; Low 1. **Total: 4 findings.**
