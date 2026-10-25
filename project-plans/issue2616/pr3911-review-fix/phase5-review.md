# Phase 5 review

Scope: phase 5 changes in `5d66f59ab..60917af16`, reviewed against the binding B1, B6 and E7 requirements and phase 5 design decisions.

## Findings

### 1. Medium: raw-startup validation leaks the transferred key handle

- **Task:** T5.2a (B1)
- **Commit:** `af95b8514`
- **Location:** `packages/cli/src/session/interactiveUI.tsx:421-427`
- **Problem:** `startInteractiveUI` takes ownership of `startup.providerKeys` on entry, but its raw-mode persistence validation throws before entering `prepareInteractiveStartup`, the only pre-commit rollback authority. The allowed input `{ recordingOwner: 'raw', sessionPersistence: undefined, providerKeys, ... }` therefore rejects without closing the handle. The caller must not close it after handing it off, so this path has no closer. The existing five key-handle tests do not exercise this validation failure.
- **Concrete fix:** Put raw-startup validation inside the same pre-commit rollback scope as presentation, replacement and perf acquisition. Keep commit outside that scope so commit rollback cannot double-close. Add a regression through `startInteractiveUI` with raw recording and missing persistence, asserting the original failure, no render, and exactly one close; also preserve aggregation if close fails.

### 2. Medium: child-operation contracts still admit missing production dependencies

- **Task:** T5.6 (B6)
- **Commit:** `28d1298b6`
- **Location:** `packages/agents/src/api/child-agent-assembly.ts:121-127`; producer at `packages/agents/src/session/session-client-owner.ts:448-455`
- **Problem:** `ChildAgentOperations.telemetry`, `.trust` and `.hooks` all retain `| undefined`, although the sole production constructor supplies `settingsOwner.telemetry`, `workspace.trust` and `this.hookOperations`. These are concrete required values: the telemetry and hook getters either return their owners or reject an unassembled session; the workspace trust port is required. The commit justifies the wider types with test callers, contrary to the task's explicit rule to require dependencies available at the producer. Passing `undefined` still compiles, changes child telemetry/hook ownership, and permits trust to fall back to `ApprovalMode.DEFAULT`; the hooks-absent/trust-absent combination then fails later in `SessionHookComposition.bind` with “Hooks require explicit workspace trust composition.” This retains the missing-input-at-use problem B6 is meant to remove.
- **Concrete fix:** Require `RootTelemetry`, `WorkspaceTrustControlPort` and `SessionHookOwner` in this production port. Update child-launch fixtures to construct and pass the same owners the production session supplies, instead of widening the production contract for fixture convenience. Preserve trust inheritance and borrowed-owner lifetime behavior in focused child tests.

### 3. Medium: the required child tool registry is still checked late, and its settings snapshot remains nullable

- **Task:** T5.4b (B6)
- **Commit:** `b2bef573a`
- **Location:** `packages/agents/src/api/child-agent-assembly.ts:423-427`; `packages/agents/src/core/subagent.ts:140`
- **Problem:** The “SubAgentScope.create requires a ToolRegistry” check was moved from `SubAgentScope.create` to `ChildAgentAssembly.createScope`, after workspace/provider/client acquisition, activation and runtime loading. It was not eliminated by making the child runtime result encode its required tool selection. `AgentRuntimeLoaderResult.toolRegistry` is still optional even though this child path always supplies `operations.tools`. Similarly, the new `SubAgentRuntimeInput.settingsSnapshot` accepts `undefined`, although the real loader always returns the required `profile.settings` (`AgentRuntimeLoader.ts:243-244`) and the planned port requires a snapshot. A missing snapshot silently strips inherited tool governance through `buildEphemeralSettings`, rather than being rejected by the compiler.
- **Concrete fix:** Give the child runtime-loader factory a result contract with required `toolRegistry` and `settingsSnapshot`, derived from required child loader inputs, and make `SubAgentRuntimeInput.settingsSnapshot` required without `| undefined`. Adapt the general loader's types or expose a typed child-loading entry point so this guarantee is checked rather than asserted. Delete the relocated registry check and update fake loader results to provide their actual tool selection and snapshot.


### 4. Medium: child cancellation remains an optional production dependency

- **Task:** T5.4b (B6)
- **Commit:** `b2bef573a`
- **Location:** `packages/agents/src/core/subagent.ts:124-132`; producer at `packages/agents/src/api/child-agent-assembly.ts:430-438`.
- **Problem:** `SubAgentLaunchInput.parentSignal` is a required property whose value still permits `undefined`. The sole production producer always has `this.data.signal`, and the decided launch contract requires an `AbortSignal`. Writing `parentSignal: undefined` therefore still compiles and creates a child without the parent's cancellation link. Replacing a positional optional argument with a nullable named property has not enforced this dependency. Standalone test convenience does not establish a production composition that lacks the signal.
- **Concrete fix:** Require `parentSignal: AbortSignal` in the launch contract and its private constructor input. Have the test helper supply a fresh `AbortController().signal` when a test needs an independent scope. Keep the cancellation behavior tests, including a parent abort reaching a live child and not affecting a separate live scope.

## Review conclusions and checks

**Severity totals: Critical 0, High 0, Medium 4, Low 0.** Findings 2-4 are gaps in the required-input guarantees, not claims that the current production producer omits these values. Finding 1 is an unclosed handle on an accepted error path.

B1's Config credential field and accessors are removed. Agent key consumers now obtain storage through their manager or its runtime adapter, and the interactive producer obtains its own handle from its credential authority. Adding `ProviderKeyStorageLike` to `productionPolicy.runtimeObjects` adds detection; it is not an exemption. The negative control uses that production-policy entry and asserts a `config-service-locator` finding on the Config getter call.

The scanner passes with the new port shapes. The optional CLI activation callback represents whether activation ownership transfers during configuration, rather than a required operation missing at use. Replacing its absence with a no-op callback would transfer ownership to a caller that retains nothing. The optional CLI settings owner represents borrowing a supplied owner versus preparing the preflight's owner; it does not defer a missing-required-owner rejection. MCP's undefined policy represents constructing and owning a policy, and undefined MCP settings represents a composition without a reloadable settings file. Those MCP cases match the inventory decisions. Child trust, hooks, telemetry, snapshot and parent cancellation differ for the reasons recorded above.

The authority-at-acquisition change passes the existing authority at the foreground, preflight activation, adopted/fromConfig and child acquisition sites. The adopted child regression passes. No positional compatibility overload, added exclusion, raised test timeout or new test skip was found in the phase changes inspected. Existing test-only factory/prototype observation remains; its broader migration belongs to the later plan phases.

E7's production lifecycle paths now use `ProviderFileLifecycle` or a generic carrier, without the previous `object`/`instanceof` downcasts. The `never` default prevents calling `bindProviderFiles` with an arbitrary object on a bare `AgentClientContract`; the concrete binding boundary instantiates `AgentClientContract<ProviderFileLifecycle>`. That is adequate for the opaque core carrier. It does not prove implementation of the optional binding method, but no newly missing production binding was identified. The media-composition test double still uses `object` and `instanceof`; that is test-local, not a remaining production carrier.

Removing the omitted-runtime test is justified for the runtime/context/content-generator inputs that are now non-nullable required fields. It does not justify the remaining nullable dependencies in findings 2-4. The replacement runtime-use/history tests execute real scopes and observe provider requests and real history writes, rather than asserting only on fixture-built bundles. They preserve the relevant coverage for the narrowed result. The MCP filesystem rejection scenario keeps its cleanup and ownership assertions with the replacement mismatched-trust trigger.

Read-only checks run for this review, one test file per Bun process with stdin closed:

- `bun test scripts/tests/runtime-service-shape-credential-getters.test.ts`: 1 pass, 0 fail.
- In agents, `bun test src/core/__tests__/subagent.stateless.test.ts`: 10 pass, 0 fail.
- In CLI, `bun test src/session/interactiveUI.providerKeys.behavior.test.tsx`: 5 pass, 0 fail. These cases do not cover finding 1's raw-validation branch.
- In agents, `bun test src/api/__tests__/fromConfig-child-credential-authority.behavior.test.ts`: 1 pass, 0 fail.
- `npm run build:types && npm run check:runtime-boundary` was invoked; its tool output overflowed, so its combined result is not claimed. A subsequent `npm run check:runtime-boundary` returned exit 0.

No package suite was run by this reviewer. No source or plan file was edited; only this review report was created and updated. Findings are based on source inspection; no new failing reproduction test was added during the read-only review.


## Follow-up

2026-10-25, at `6509162d2`. Scope limited to findings 1-4 and fixes `8bc72bfab`, `1483b55b0` and `6509162d2`, including the requested production-caller, overload and failure-coverage judgments. **All four findings are resolved.** No source was edited and no package suite was run.

### Finding 1: resolved (`8bc72bfab`, T5.F1)

`packages/cli/src/session/interactiveUI.tsx:453-482` now validates raw persistence inside `prepareInteractiveStartup`'s rollback scope. Failure closes `startup.providerKeys` once; a close failure produces `[primaryError, closeError]`. `startInteractiveUI` calls commit after preparation returns (`:421-436`), outside this catch, so commit rollback does not encounter a second pre-commit close. The focused provider-key file passes all 7 tests, including both new raw-validation cases and the existing commit-failure case. These assert the original requirement error, no render, exactly one close, and aggregation when closing fails.

### Finding 2: resolved (`1483b55b0`, T5.F2)

`packages/agents/src/api/child-agent-assembly.ts:115-129` requires `RootTelemetry`, `WorkspaceTrustControlPort` and `SessionHookOwner`, without `undefined`. The production constructor supplies `this.settingsOwner.telemetry`, `workspace.trust` and `this.hookOperations` (`packages/agents/src/session/session-client-owner.ts:444-455`). The assembly borrows those owners for telemetry and hook/tool composition (`child-agent-assembly.ts:223-225,305-315`) and reads trust directly for approval (`:453-456`). The child-launch fixture constructs actual settings/trust/telemetry and hook owners when not supplied (`packages/agents/src/core/__tests__/child-launch-fixture.ts:74-92,118-129`); it no longer passes missing owners through this production port.

Focused checks pass for live parent trust affecting child retry/write denial, live tool-governance changes, successful and failed child disposal leaving the parent usable, and cancellation/disposal leaving sibling work usable. Relevant files are `async-child-background-isolation.behavior.test.ts`, `session-client-child-owner.behavior.test.ts`, `child-acquisition.behavior.test.ts` and `child-task-tool-lifetime.behavior.test.ts` in the table below. No production ownership transfer or disposal of the borrowed telemetry/hook owners was added by this fix.

### Finding 3: resolved (`6509162d2`, T5.F3)

The overload guarantee follows from its inputs and the existing implementation. `packages/core/src/runtime/AgentRuntimeLoader.ts:81-89` requires `profile.toolRegistry: ToolSelection`; `profile.settings` is already required by the inherited profile contract (`:44-59`). The narrowed result requires both fields (`:103-111`), and the first overload selects it for that narrowed input (`:184-189`). The implementation directly returns `profile.toolRegistry` and `profile.settings` (`:261-270`), with no cast, non-null assertion or fabricated fallback. Retaining the general implementation signature does not invalidate this input/output relationship.

The child options builder requires both supplied values and returns `ToolSelectedRuntimeLoaderOptions` (`packages/agents/src/core/subagent-runtime-loader.ts:22-35,54-66`). The assembly uses the narrowed factory/result (`packages/agents/src/api/child-agent-assembly.ts:110-112,145,386-407`) and passes both values directly to the scope (`:434-441`); the late registry check is gone. `SubAgentRuntimeInput.settingsSnapshot` and the private constructor snapshot are non-nullable (`packages/agents/src/core/subagent.ts:134-141,206`). The real loader regression asserts identity with the supplied tool selection and snapshot (`packages/agents/src/core/subagent-runtime-loader.test.ts:108-109`); the governance regression observes an actual disabled-tool response (`packages/agents/src/core/subagentNonInteractive.issue3535.test.ts:522-538`). Both pass.

**Cleanup-stage judgment:** coverage is preserved. `packages/agents/src/core/__tests__/subagent-launch-cleanup.test.ts:107-159` still exercises activation failure, loader failure, scope creation failure, and scope creation failure followed by a history-release failure. The activation trigger remains a missing replay file; the loader trigger remains missing content-generator configuration. Scope/history cases now reach the injected rejecting scope factory instead of violating the tool-registry contract. The history case still creates real admitted media and obstructs its release before scope rejection. Assertions retain the primary failure, the history `MediaStoreError`/`EISDIR` when applicable, and the token-transport close failure in that order, with unchanged error counts and parent-model assertion (`:167-197`). All four cases pass. The separate history-settlement and scheduler-cleanup files also pass.

### Finding 4: resolved (`1483b55b0`, T5.F2)

`SubAgentLaunchInput.parentSignal`, the private constructor parameter and stored parent signal are required `AbortSignal` values (`packages/agents/src/core/subagent.ts:124-131,170,207`). Binding no longer has a missing-signal exit and relays both an already-aborted parent and subsequent abort events (`:284-298`). `ChildAgentLaunch.signal` is required (`packages/agents/src/api/child-agent-assembly.ts:101`), and the producer passes it to the scope (`:432`). Independent scope fixtures receive a fresh controller signal (`packages/agents/src/core/__tests__/helpers/create-subagent-scope.ts:23-29`).

**Production-caller judgment:** requiring `SubagentOrchestrator.launch`'s signal is appropriate for every current production caller. The production orchestrator is constructed and bound into task registration at `packages/agents/src/session/session-client-owner.ts:424-461`. Repository-wide caller inspection found two execution paths: foreground task launch passes `timeoutController.signal` (`packages/agents/src/tools/task.ts:379`), whose controller relays user cancellation (`packages/agents/src/tools/taskAbortHelpers.ts:109-134`); async launch passes its independently owned `asyncAbortController.signal` (`packages/agents/src/tools/taskAsyncExecution.ts:268-323`). The async path relays foreground abort during launch, registers the same controller with the task owner, then removes the foreground relay so normal foreground completion does not cancel accepted background work. Requiring a signal preserves that distinction; it does not require passing the foreground signal to background children. No additional production launch caller without a cancellation owner was found.

Focused tests pass for an already-aborted orchestrator launch, foreground cancellation during launch, async signal identity and cancellation during launch, and parent listener cleanup. The public async-child regressions also pass for aborting the controller driving an accepted live child and leaving another same-label owner's child running to completion (`packages/agents/src/api/__tests__/async-child-background-isolation.behavior.test.ts:570-604`).

### Follow-up checks

All commands used `exec < /dev/null;` and exactly one file per Bun process. CLI command: `cd packages/cli && bun test ./src/session/interactiveUI.providerKeys.behavior.test.tsx`. Agents command for each row: `cd packages/agents && bun test --timeout 180000 ./<path>`. Each process had a 115-second shell limit and completed in under 9 seconds. **138 tests passed across 18 files; 0 failed.** Paths below are relative to the stated package.

| Package | Test file | Passed |
| --- | --- | ---: |
| CLI | `src/session/interactiveUI.providerKeys.behavior.test.tsx` | 7 |
| agents | `src/core/__tests__/subagent-launch-cleanup.test.ts` | 4 |
| agents | `src/core/subagent-runtime-loader.test.ts` | 1 |
| agents | `src/core/subagent-runtime-loader.types.test.ts` | 1 |
| agents | `src/core/subagentNonInteractive.issue3535.test.ts` | 18 |
| agents | `src/api/__tests__/session-client-child-owner.behavior.test.ts` | 5 |
| agents | `src/core/subagentOrchestrator.test.ts` | 21 |
| agents | `src/core/__tests__/child-acquisition.behavior.test.ts` | 3 |
| agents | `src/core/__tests__/child-task-tool-lifetime.behavior.test.ts` | 2 |
| agents | `src/core/__tests__/subagent-history-settlement.behavior.test.ts` | 2 |
| agents | `src/tools/task.test.ts` | 16 |
| agents | `src/api/__tests__/async-child-background-isolation.behavior.test.ts` | 8 |
| agents | `src/tools/task.async.test.ts` | 11 |
| agents | `src/core/subagent.runNonInteractive-term.test.ts` | 11 |
| agents | `src/core/__tests__/subagentOrchestrator.isolatedConfigDispose.test.ts` | 3 |
| agents | `src/core/__tests__/subagentOrchestrator-runtime.test.ts` | 13 |
| agents | `src/core/__tests__/subagentOrchestrator-sessionInheritance.test.ts` | 10 |
| agents | `src/core/__tests__/subagent-scheduler-cleanup.test.ts` | 2 |

Bun executes TypeScript without type-checking. The `.types.test.ts` run is therefore recorded as a passing Bun test, not a fresh compiler validation. Required-input conclusions above come from inspection of the declared types and their production producers; loader output behavior is additionally exercised by the identity and governance tests. No new typecheck, build, package suite, or broader review was performed for this follow-up. No action remains for findings 1-4.
