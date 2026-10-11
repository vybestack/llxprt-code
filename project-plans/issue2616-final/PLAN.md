# Finish runtime ownership under #2616 and #3841

## Result and measurement basis

The ownership refactor has removed the named ambient registries, but #2616 is not complete. The remaining work is strict service-shape removal, owner isolation for process-global mechanisms, admission and joined shutdown, and complete S1/S2 evidence.

Measured on 2026-10-11 at `e8ad032fa74fad5467d7c2247201c0e4d1ec0248`, branch `issue2616-final`, in `tmp/pr3842-wt`. No production source was changed for this inventory. Issues #2616, #3841, #2615, #3633 and #3222, including comments, were captured first. Their ownership constraints and frozen scenario definitions govern this plan even where related issues are closed.

Raw evidence lives in this worktree's gitignored `tmp/plan2616/`. It includes `issue*.txt`, `boundary.json`, `boundary.log`, `audit-summary.json`, `findings.tsv` (owner, rule, file, exact position, enclosing symbol, source), `by-file.tsv`, `grep-summary.json`, `imports.tsv`, `state-probes.json`, and focused test logs and exit files. These are measured findings, not units of implementation scope. The appendices preserve the per-file and import-symbol inventory in this committed document.

`npm run check:runtime-boundary -- --output tmp/plan2616/boundary.json` completed with exit 0. All three scanners were complete, with no compiler diagnostics. Declarations already resolved, so a build was unnecessary for this measurement. The underlying strict audit has exit 1: there are 1,155 `runtime-service-bundle` findings and 698 `runtime-service-bag-parameter` findings. The npm command accepts them because they equal the committed baseline. All other reported rule families are zero: mutable state, module mutation, ALS violations, stale immutable allowances, ambient delegation, Config service locator and analysis-resource-limit findings.

### Acceptance status

| Requirement | Measured state | Done means |
| --- | --- | --- |
| #2616 AC1, prohibited-shape negative controls | Partial. Type-aware negative controls exist and pass, but production bundle and bag findings are ratcheted. `package.json:104`, `scripts/runtime-boundary-ratchet.ts:15-18`, `.github/workflows/ci.yml:507-514`. `runtime-state-boundary.test.ts:263-289` proves strict fixture rejection for bags, locators and delegation. | CI rejects every prohibited shape outright, including imports/references and alias variants. Each negative control fails the actual production command. No baseline or ratchet option remains. |
| AC2a, unique ambient accessor names | Exact prescribed rg returns no matches, exit 1. | Preserve zero and execute the exact check in CI. |
| AC2b, providers/runtime import absence | Fails: 70 matching import statements, agents 43, CLI 26, zed-acp 1. The exact glob includes seven test-helper/spec matches; actual production classification is agents 39, CLI 23, zed-acp 1. Both `runtimeAccessors.ts` and `runtimeSettings.ts` are absent, but runtime package exports remain. | All exact matches gone, including helper/spec paths selected by the prescribed command. Delete the old runtime export paths and obsolete implementations, without moving the same service locator behind another barrel. |
| AC2c, runtime registry/default pointer | Exact rg returns no matches. `runtimeRegistry.ts` is absent. | Preserve deletion and zero CI matches. |
| AC2d, settings/context ambient accessors | Exact rg returns no matches. | Preserve zero; retain only explicitly supplied instance operations. |
| AC2e, manager/OAuth singleton names | Exact rg returns no matches. This does not certify credential-factory singleton removal. | Preserve zero and separately complete #3841 credential ownership. |
| AC3, module state and immutable allowance | Configured audit passes with zero state findings. Mutable roots are the providers/core runtime directories and CLI RuntimeContext. Seven unfrozen tables remain exempt in `runtime-state-immutable-allowlist.json`. Scanner probes demonstrate mutation blind spots. | Strict scan remains zero after mutation tracking is strengthened; tables are frozen in source and their allowances removed. Keep a committed explicit immutable policy, even if its table list is empty. |
| AC4, ALS and execution outside scope | Configured audit passes. Sole allowance is `BaseProvider.activeCallContext`, `check-runtime-state-boundary.ts:261-268`; construction is `BaseProvider.ts:123-124`. Explicit profile/identity tests run outside identity ALS. | Keep call-option scoping only, never identity lookup. Enumerated usage and out-of-ALS public behavior tests stay green after migration. Preserve A2A request storage as request scoping. |
| AC5, enumerated WeakMap side channels | Deleted. `internalConfigAccess.ts` is absent; activation stores `#config` and `#receipt` fields at `activationPreflightState.ts:105,118`; OAuth registration consults the manager at `oauth-provider-registration.ts:44` and its instance registry at `auth/provider-registry.ts:19`. | Preserve deletion and prove owning-object state through behavior and negative controls; no new map keyed by Config substitutes for fields. |
| AC6, #2300 guard removal and foreground isolation | Registry and write-once pointer are absent. `isolatedRuntimeDefaultPointer.behavior.test.ts:14-78` passes, alongside explicit-owner tests. Existing assertions emphasize provider/OAuth ownership. | Keep deletion; directly assert foreground provider, model and settings remain unchanged through interleaved background/isolated activation and disposal. |
| AC7, frozen S1/S2 and C-scope gate | Incomplete. Frozen entries remain skipped at `integration-tests/conformance/scenarios.s1-s12.test.ts:44,61`. Focused same-label tool tests pass; S2 safe-boundary and wire-capture suites pass independently. Complete S1 auth/counters/global-isolation matrix and S2 rebuild exclusion are not demonstrated. Combined test runs fail due missing core prompts. | Implement the full frozen S1/S2 observables, remove only those skips, directly test immutable turn/tool contexts and stale queued revisions, and run both scenarios in the supported test grouping. |
| AC8, whole-project verification and smoke | Unmeasured for the full cycle. Focused results below are measured; combined-run failures prevent a green claim. No build, format mutation or live smoke was run for this documentation task. | Every implementation PR passes test, lint, typecheck, format and build plus the current `lunahigh` smoke. The cancelled StepFun subscription is not a viable gate. |

### #3841 item status

Each row confirms present source rather than claiming a reproduced cross-root incident. The tests specified below must reproduce the undesired behavior before changing it.

| Item | Current evidence | Done means |
| --- | --- | --- |
| 1a, CLI/ACP construction | CLI `RuntimeConfigBootstrap`, `cliSessionBootstrap.ts:143,202-208`; provider composition in `config/profileBootstrap.ts:443-485` and `postConfigRuntime.ts:261-265,640-698`. ACP `zed-session-agent.ts:219-266,305-335` constructs settings, policy and providers, then adopts them. | Hosts supply declarative data and host capabilities to agents-owned assembly. No host-constructed runtime graph or returned services bundle. |
| 1b, providers handles | `runtimeContextFactory.ts:179-194` exposes `IsolatedRuntimeContextHandle`; `assembleCliProviderRuntime.ts:107-114` exposes `AssembledCliProviderRuntime`; `runtimeLifecycle.ts:19-20` accepts the whole handle. | Delete these types/factories when their last callers migrate; providers receive provider-owned narrow dependencies only. |
| 1c, workspace bag passed to catalog | `session-client-owner.ts:387-445` passes `McpRuntimeOwner` into `SessionToolCatalogOwner.initialize`. | Inject filesystem, trust, IDE/LSP, definition and publication ports separately at the assembly, never a workspace services bag. |
| 1d, Config startup bag | `config.ts:89-147`, `configTypes.ts:465-492`: initialize/ensureInitialized accept unrelated services and startup callbacks. | Startup belongs to workspace/session owners. Delete Config startup sequencing and the dependency type after all callers migrate. |
| 1e, remaining ratchet | Audit reports only the two ratcheted families, matching every per-owner baseline entry. | Both zero; delete baseline, ratchet branch and option, retaining strict fixture tests. |
| 2a, interactive OAuth singleton | `interactive-auth-coordinator.ts:521`, latest-host assignment at `179-184`; discovery/request at `interactive-auth-request.ts:73,152`; CLI bind/cancel/unbind at `useUpdateAndOAuthBridges.ts:199,208-209`. | Instance-owned host coordinator, injected request port; A teardown cannot cancel or unbind B. |
| 2b, token-store singleton | `providerManagerInstance.ts:524` calls `createTokenStore`; factory globals at `credential-store-factory.ts:39-56`, replacement closes prior store at `311`. Even `createOwnedTokenStore` calls the singleton in proxy mode at `326`. | Owner-specific transports and store lifetime; switching socket/capability for B cannot close A. Credential descriptor capture is host input, not an active-owner lookup. |
| 2c, Google environment writes | `profileApplication.ts:258,267` writes project/location; actual plugin path is `plugins/google-gemini/src/gemini/geminiAuth.ts:34,42-43`. It also writes Vertex mode at `71`. | Capture host environment defaults once as declarative auth input; profiles and requests carry owner project/location/mode explicitly. No profile-time or auth-time environment writes. |
| 2d, UI telemetry singleton | `telemetry/loggers.ts:61,74-76`; singleton at `uiTelemetry.ts:531`; projector `agentStatsProjector.ts:20,36,58,65`; CLI `/clear` reset `clearCommand.ts:60`. | Session-owned metrics sink/read/reset/subscribe ports, counters isolated even for equal labels. |
| 2e, global Undici proxy | `configConstructor.ts:48,581`; `utils/fetch.ts:88-89` constructs a ProxyAgent and installs the dispatcher; request path `fetch.ts:66` uses ambient fetch. | Explicit owner-bound fetch/dispatcher, joined shutdown and close exactly once; no Config construction side effect or global dispatcher setter. |
| 2f, unscoped model-profile event | `providerSwitchAssembly.ts:99`; actual client path is `packages/agents/src/core/client.ts:257-258,311-317`. Handler has no owner filter. Related ModelChanged path is `session-settings-owner.ts:654` and `client.ts:307-309`. | Owner-local model notifications invalidate only that owner's chat/sequence. Do not retain crosstalk through the adjacent ModelChanged route. |
| 3a, activation auth/image admission | `activationPreflightState.ts:165-170` closures forward directly; disposal marks closed and waits the preflight tail at `214-224`. | These closures close synchronously when disposal begins and join accepted work. |
| 3b, session-client admission closes late | Agent stop phase at `agentImpl.ts:1278-1307` closes only selected session-client domains. Whole client access closes through `closing` at `session-client-owner.ts:505,829-833`, reached from final release at `agentImpl.ts:1353`. | Stop whole public client admission before any join, while already accepted internal cleanup can complete. |
| 3c, standalone runner | `runtimeFactories.ts:237-238` forwards run and disposes only shellOwner. | Reject runs after closure, abort/join active execution, then release shell/scheduler ownership. |
| 3d, auxiliary calls | `agentImpl.ts:1010-1041` delegates JSON/embedding without work registration; `agents/src/core/client.ts:904-923,956-963` awaits generation without owner tracking. | Track accepted calls, compose cancellation and join them before client/provider release. |
| 3e, disposed workspace forwarding | `workspaceControl.ts:192-220` forwards search/init/directory writes; disposal only joins checkpointWork at `147-159`. | Reject new work and writes; join admitted search without destroying borrowed workspace resources. |
| 3f, synchronous bootstrap rollback | `providerSwitchAssembly.ts:217,484`; `session-client-owner.ts:349-359` starts unjoined rollback. | Awaitable bootstrap and initial client binding; await cleanup before rejection, aggregate cleanup failure, delete synchronous rollback API. |
| 3g, abandoned replacement clients | `session-client-owner.ts:556-581,687,739,778` routes replacement/profile/detached construction through log-only rollback. | Await rollback for each asynchronous owning boundary, with binding plus cleanup failures retained; no log-only cleanup. |
| 3h, post-create binding failure | `policyComposition.ts:101-119`: awaited creation followed by MCP/hooks binding, without client release on those failures. | The acquiring owner releases failed clients and related binding scopes before rejecting. |
| 3i, foreground OAuth refresh joins | `oauth-manager.ts:405-406` joins proactive renewals only. Token access calls refresh at `token-access-coordinator.ts:374-382,1024`; force-refresh helper invokes provider at `token-force-refresh-helper.ts:139`. | Close token admission, cancel/join all accepted foreground and proactive work, then close owned store. |
| 4a, physical hooks on Windows | `physical-hook-fixture.ts:64` emits bash `exec` and bash quoting. | Real child execution with correct native shell invocation on POSIX and Windows, preserving cancellation and input/output/exit behavior. |
| 4b, scanner mutation holes | `runtime-state-structure-guard.ts:279-296,469-503,596-609` excludes method/import alias/binding-element mutation flows. `state-probes.json` reports a local-function mutation, but no findings for method, imported function or destructured alias cases. | All these negative controls fail; instance-owned local state remains permitted. |
| 4c, unfrozen tables | Seven exact entries in immutable allowlist, named below. | Freeze each table, remove its entry, preserve semantic output and fail restoration controls. |

### Measured behavioral results

- Guard suites: 321 pass, zero failures (`guards.log`). Includes scanner, shape, delegation, symbols, production-runner and ratchet tests. Ratchet tests at `runtime-boundary-ratchet.test.ts:93,109` explicitly accept findings equal to or below baseline; passing them does not satisfy AC1.
- Outside identity ALS and foreground ownership lane: 25 pass, 12 frozen scenario skips, zero failures (`outside-als.log`). Includes profile application, #2300 and explicit-owner tests. The skips are not evidence of S1/S2 success.
- `agent-safe-boundary-coordinator.behavior.test.ts`: seven pass when run alone (`s2-isolated.log`). Typed busy uses `AgentBusyError`; steering and HTTP/tool holds, stale revision, cancellation and disposal are covered. The commit callbacks in this suite do not replace a real profile/rebuild conformance scenario.
- `turn-revision-capture.behavior.test.ts`: thirteen pass when run alone (`capture-isolated.log`), covering admitted model/endpoint/parameter values, nested caller data, profile replacement, rollback, selected LB member and steered continuation. Explicit immutable tool-context coverage still needs closure.
- Same-label tool isolation: two pass; profile/session admission: three pass when run alone. The combined lane had two passes and three missing-core-prompt failures (`identity-focused.log`), while `profile-admission-isolated.log` passed.
- MCP notice ownership: six pass (`mcp-hosts.log`). MCP browser/auth cancellation and public-host discovery lane: nine pass (`mcp-auth.log`). Preserve `hostOwnership.behavior.test.ts`, `manager-feedback-owner.test.ts`, `mcp-auth-owner.behavior.test.ts` and agents `mcp-manual-auth-lifetime.test.ts`. Global callback dispatch is gone from `mcp/src/host/hostServices.ts`; ordinary injected capabilities and `MCP_CLIENT_UPDATE_EVENT` remain. The prior startup-wiring test path is absent. Link this deletion and measured evidence when closing #2616; retain standalone package/import tests.
- A combined exploratory C-suite run was stopped after repeated missing-core-prompt failures. Its captured diagnostic is `scenario-startChat-error.json`. The shared `turn-revision-capture.fixture.ts:248-255` creates a module-scoped prompt directory and registers afterAll cleanup, while multiple suites import it. The failure mechanism is consistent with fixture cleanup across suite boundaries; individual success supports that hypothesis, but it is not a confirmed production defect. Do not weaken assertions or mark that combined run passing.

## Ordered implementation workstreams

Numbered titles establish dependency order. Where a title has lettered handoffs below, assign each lettered handoff separately, never the parent workstream as one implementation session. Each handoff must be completed, verified and committed within the requested single-session limit. An unsubdivided title is itself one handoff. A handoff must migrate its affected callers and leave the build green. Contract-only preparation can add narrow interfaces before callers move. A replacement must remove the old path for the migrated functionality in that same handoff; when a shared old export still has another unmigrated functional caller, delete it in the handoff migrating its last caller. No duplicate implementation, alias, re-export bridge, ambient fallback or keyed services bag is permitted.

Common exit E for every handoff: run its focused Bun behavioral/negative-control tests, `npm run typecheck`, `npm run lint`, and `npm run check:runtime-boundary -- --output tmp/plan2616/step-N.json`. All nonratcheted rules and diagnostics stay zero; ratcheted counts never rise. Reconcile changed consumers against `findings.tsv` and `imports.tsv`; lower baseline entries to actual reductions rather than creating slack. Every implementation PR additionally passes the full AC8 cycle before landing. Do not relax scanner identities, package roots, assertions, required checks or ownership rules to reduce findings.

### Verification foundations

1. **Give shared behavioral fixtures suite-safe prompt lifetimes.** Files: `turn-revision-capture.fixture.ts`, `sameLabel.toolIsolation.behavior.test.ts`, `profile-session-admission.behavior.test.ts` and their prompt setup helpers. Put filesystem fixture creation/retirement inside the owning suite or test lifecycle rather than a reused module-level afterAll lifetime. Test the observed suite pair and combined C lane, in both suite orderings; retain independent results. Exit E plus no missing-prompt failures. This changes test infrastructure only, with no production harness gates.

2. **Track parameter mutation through methods and imported helpers.** Files: `runtime-state-structure-guard.ts` (`localFunction`, `mutatesParameter`, `mutatedArgumentStorage`), `runtime-state-scan.ts`, their tests. Resolve actual callee declarations and method bodies in the existing program, with bounded cycle-aware summaries. Add failing controls corresponding to method/import probes and positive instance-state examples; fix any newly exposed production violation with its owning functional step rather than suppress it. Exit E and both new controls rejected.

3. **Track destructured storage aliases.** Files: the same scanner's `storageOrigin`/`rootDeclaration` and structure tests. Follow binding elements, renamed/nested destructuring and reassignment provenance without confusing fresh local copies with module storage. Test destructured container mutation, read-only use and benign local rebinding. Exit E and the third probe rejected.

4. **Freeze runtime lookup tables and retire their allowances.** Files/symbols: `messages.ts` MISSING_RUNTIME_REQUIREMENTS and NORMALIZATION_REQUIREMENTS; `profile-application/switchProfileProvider.ts` PRESERVED_PROFILE_EPHEMERALS; `promptEnvelopeProjections.ts` STATEFUL_INCREMENTAL_PROMPT_KEYS and PROMPT_KEYS; `providerSwitch.ts` DEFAULT_PRESERVE_EPHEMERALS; `statelessHardening.ts` STATELESS_METADATA_KEYS. Use recursively frozen primitive tables, keep tuple precision, delete corresponding immutable-allowlist entries. Test existing profile/default/projection behavior and controls restoring unfrozen storage or mutating tables. Exit E and an empty, still committed table allowlist.

### Admission and joined shutdown

5. **Close activation auth/image admission at shutdown entry.** Files: `activationPreflightState.ts`, session image admission and activation-owner tests. Add one owner admission lifetime for public auth/image closures, separate from the preflight queue. Hold an accepted auth/image request, start dispose, reject subsequent requests, then release/fail held work and verify disposal joins it and a second root remains usable. Exit E; no new requests reach a retiring client.

6. **Stop all public session-client admission before joining agent work.** Files: `agentImpl.ts` stopShutdownAdmissions, `session-client-owner.ts` getAgentClient/enqueue/dispose. Introduce an explicit close-admission phase distinct from release and accepted cleanup queues. Test held turn/auth/detached-client access during dispose, concurrent/repeated disposal and borrowed-client survival. Exit E with admission closed synchronously and cleanup joined once.

7. **Make standalone loop-runner disposal own execution.** Files: `runtimeFactories.ts` createAgenticLoop/AgenticLoopRunner, `AgenticLoop.ts`, shell/scheduler owner tests. Track accepted runs and cancellation in the runner instance; stop admissions, abort/join runs, release scheduler and shell ownership. Run returns an AsyncGenerator, so admission/retirement must cover iteration, early return and held next(), without eagerly executing an unconsumed generator. Test held tool/model work, post-close run/iteration rejection, early iterator return, failure aggregation and two independent runners. Exit E with no run outliving disposal.

8. **Join accepted JSON and embedding calls.** Files: `agentImpl.ts` generateJson/generateEmbedding, `agents/src/core/client.ts` and generation helpers. Supply an auxiliary-work admission/cancellation owner, not another runtime bundle. Test held network requests, caller cancellation, rejection after shutdown begins, failure settlement and sibling-root continued requests. Exit E; provider/client release cannot precede accepted call settlement.

9. **Close and join workspace search facade work.** Files: `control/workspaceControl.ts`, workspace facade tests. Apply facade admission to initializeSearch/search and directory mutation, using the facade's own accepted-work set; do not dispose borrowed filesystem/search services. Test held/failing searches, mutation after closure and another borrowing facade still usable. Exit E and no post-dispose forwarding.

10. **Await activation-bootstrap initial acquisition and rollback.** Files: `providerSwitchAssembly.ts` assembleAgentActivationBootstrap/createActivationClient, `session-client-owner.ts` create/createWithBackgroundRollback, `postConfigRuntime.ts` and bootstrap test callers. Make bootstrap async, await `SessionClientOwner.create`, migrate every direct caller and root-surface assertion, then delete createWithBackgroundRollback. Test held binding cleanup and cleanup failure before bootstrap rejection, including adopted resources. Exit E plus no synchronous rollback symbol or caller remains.

11. **Join replacement and profile-candidate rollback.** Files: `session-client-owner.ts` createClient/replaceClient/prepareProfileClient, `profileReplacement.ts`, profile-candidate interfaces and tests. Propagate awaitable acquisition through the existing replacement transaction; preserve captured revision, old-client usability and post-commit retirement semantics. Hold/fail binding and release; rejection waits for cleanup and aggregates both errors. Exit E and those paths no longer use releaseAbandonedClient.

12. **Join detached-client construction failure.** Files: session client detached creation and `client-ownership` helpers, public detached-client tests. Complete the remaining async acquisition path; delete releaseAbandonedClient when its last caller moves. Test failed binding and failed cleanup, successful detached ownership, close-admission races and adopted resources. Exit E and zero log-only rollback references.

13. **Release clients after post-create policy binding failure.** Files: `policyComposition.ts` bindCreatedSessionClient, MCP/hook binding scopes and policy composition tests. Acquire under explicit cleanup obligation and transfer only after all bindings succeed. On failure await release and aggregate failures, including partial bindings, without destroying borrowed MCP resources. Exit E with held/failing bindMcpRuntime/bindHooks tests and exactly-once cleanup.

14. **Join foreground OAuth reads and refreshes.** Files: `oauth-manager.ts`, `token-access-coordinator.ts`, token-refresh and force-refresh helpers. Track accepted foreground operations alongside proactive work in an instance lifetime; compose cancellation rather than swallowing refresh errors. Test held renewal, normal/forced refresh, store failure, rejected late reads, and another manager continuing after A dispose. Exit E; stores close only after all accepted work settles.

### Process-global isolation

15. **Inject per-root interactive OAuth coordination.** Files: `interactive-auth-coordinator.ts`, `interactive-auth-request.ts`, token access, auth exports and `useUpdateAndOAuthBridges.ts`. Assembly owns coordinator creation and passes a request-only port to providers plus host bind/unbind operations to the originating adapter. Delete singleton export/imports in the same cutover. Test two live roots with identical provider/bucket challenges, interleaved prompts and A unmount while B completes; unavailable browser remains explicit. Exit E and zero interactiveAuthCoordinator singleton references.

16. **Give credential transports explicit root ownership.** Files: `credential-store-factory.ts`, `providerManagerInstance.ts`, isolated auth assembly and credential-proxy lifecycle callers. Replace borrowed singleton acquisition with owner-created token transports using captured socket/capability input. Do not just call createOwnedTokenStore while it still mutates the singleton. Keep inherited descriptor consumption at the host boundary and pass its result explicitly; preserve token validation and secret confinement. Test two live proxy servers/capabilities, change B's socket, dispose B and prove A still reads/refreshes. Exit E; no store can close another root's client.

17. **Remove residual credential-factory shared-client acquisition.** Files: the factory's key-storage/broker consumers and exported createTokenStore/createProviderKeyStorage/createGitHubBrokerSocketClient paths. Migrate remaining application-host consumers to their explicit host credential owner; delete shared transport caches and reset APIs when their last caller moves. Do not create a keyed credential/runtime registry. Test two live host owners, key/broker/token requests and one shutdown, retaining inherited-fd tests. Exit E and no process-level factory fallback for owner operations.

18. **Carry Google auth project/location/mode as owner input.** Files: providers `profileApplication.ts`, plugin `geminiAuth.ts` and `geminiApiClientFactory.ts`, provider request settings. Capture environment defaults only at host input construction; profile selection and auth factories use explicit settings snapshots, with no process.env writes, including Vertex mode. Test two live Gemini roots with distinct project/location/mode, interleaved profile changes and recorded requests/client configuration; A disposal cannot alter B. Exit E and environment unchanged by profile/auth operations.

19. **Own proxy fetch dispatch and release.** Files: `configConstructor.ts`, `utils/fetch.ts`, network host inputs in agents and actual fetch consumers from `fetch-consumers.txt`. Construct the dispatcher at the host/agents assembly, inject bound fetch into network consumers and close it through its owner. Delete setGlobalProxy and its Config side effect in the cutover. Test two local proxies and roots with interleaved requests, held request shutdown, dispatcher close once and B usability after A release. Exit E and no setGlobalDispatcher installation for runtime proxying.

20. **Route model notifications through the owning session.** Files: `providerSwitchAssembly.ts`, `session-settings-owner.ts` model publication, `agents/src/core/client.ts`, `client-model-subscriptions.ts`, CLI model-sync/SessionController hooks. Use owner-local subscribe/publish ports and adapter-specific projection, no runtime-id lookup/filter registry. Migrate both ModelProfileChanged and the coupled ModelChanged invalidation route; delete old runtime notification emission/subscription. Test two initialized chats, A model/profile switch while B is held, unchanged B sequence/history/request binding, A listener retirement and rollback emitting no committed change. Exit E and no cross-root chat invalidation.

21. **Read and reset CLI metrics through its agent session.** Files: `SessionContext.tsx`, `useTokenMetricsTracking.ts`, `clearCommand.ts`, `cliTerminalSession.ts`, nonInteractiveCli and support readers. Move metrics, stats subscriptions and reset actions to the existing agent/session operational surface; receive only metric read/reset/update ports, not Agent plus services. At this consumer-first step retain the current producer behavior but remove direct CLI singleton imports for migrated paths. Test live UI/noninteractive projections, clear/reset semantics and subscribe/unsubscribe. Exit E and no direct CLI global-metrics consumer remains.

22. **Make aggregation and stats session-owned, then delete the singleton.** Files: `telemetry/loggers.ts`, `uiTelemetry.ts`, `root-telemetry.ts`, `agentStatsProjector.ts`, `client-telemetry.ts`, SessionSettingsOwner and agents assembly. Instantiate aggregation in the session owner; logger producers receive an explicit sink, projectors receive snapshot/subscription ports and CLI from step 21 receives the same owner. Delete uiTelemetryService and its remaining imports/exports, without dual publication or ambient fallback. Test two live equal-label roots with interleaved requests/tool events, token totals, stats callbacks and A clear/dispose leaving B unchanged. Exit E; local aggregation works even when external export is disabled.

### Narrow services and retire runtime import paths

23. **Separate request data capture from provider runtime services.** Files: core `providerRuntimeContext.ts`, `providerRequestContext.ts`, `RuntimeProviderManager.ts`, SessionSettingsOwner; provider invocation consumers. Replace wholesale sessionSettings/settingsService context with immutable request data and separately injected retry/media/auth ports. Start with admitted invocation capture and migrate its producers/consumers together; retain immutable captured model/member/settings behavior. Test mutation after admission, steered tool continuation and two same-label owners outside ALS. Exit E with the affected core context bundle findings removed, not hidden by unknown/object casts.

24. **Inject task and child policy ports without TaskToolArgs bags.** Files: core `toolRegistryFactory.ts` TaskToolArgs/TaskToolRegistration, `subagentTypes.ts` SubAgentRuntimeOverrides, agents task registration and subagent forwarding. Keep declarative tool arguments separate from session approval/launch/provider collaborators, bound by assembly into the actual tool. Delete the old whole-bag registration and override forms after affected callers migrate. Test exactly-once task execution and bus routing, parent/child authority and same-label independent sessions. Exit E and core task bundle/bag findings reconciled.

25. **Inject workspace ports into session tool publication.** Files: `session-client-owner.ts` bindMcpRuntime, `session-tool-catalog-owner.ts` initialize, `mcpRuntimeAssembly.ts` assembly and catalog tests. Supply narrow filesystem, IDE/LSP, trust, definition, instruction and tool-publication operations separately. Keep MCP notice/auth injection intact. Delete catalog acceptance of McpRuntimeOwner. Test trust-denied tool view, contributions before publication, advisory discovery failure and two-host disposal. Exit E and catalog initialization no longer traverses a workspace owner graph.

26. **Move pure setting parsing/help to its data owner.** Files: `runtime/ephemeralSettings.ts`, `cliEphemeralSettings.ts`, CLI set schema/dialogs, ACP zed-config-options and helper/spec consumers. Move pure parsing/schema data into the settings-owned module that implements it; host consumers import that implementation, not a re-export of runtime. Owner mutation callbacks stay explicit and separate. Delete each obsolete runtime export/module after its last consumer moves. Test parsing, help/schema, CLI argument precedence and ACP option parity. Exit E and corresponding 2b matches disappear.

27. **Replace provider runtime read imports with owner read ports.** Files: `providerReadOperations.ts`, `providerStatus.ts`, CLI `createRuntimeOwnerFeatures.ts`, RuntimeContext, agents createAgent and read consumers. Bind model/provider/status/metrics reads in agents; ordinary components receive only the reads they use. Delete migrated runtime read exports/implementations, including obsolete free-accessor barrels. Test two live roots and React provider selection, missing owner failure and no default owner. Exit E and read-family import matches gone.

28. **Move model/settings mutations into narrow agent controls.** Files: `providerMutations.ts`, `providerModelParameters.ts`, `ownerSettingsOperations.ts`, `settingsResolver.ts`, agents activation/direct admission, CLI RuntimeContext and toolformat/set consumers. Keep provider-library primitives provider-owned; implement active-owner selection/mutation policy in agents using explicit parameters. Move the real implementation, not a forwarding alias. Preserve expected-revision admission and request snapshot rules. Test busy/stale writes, model/default ownership, selected LB member and unchanged sibling requests. Exit E and mutation-family imports/exports gone.

29. **Make profiles agent-owned operations.** Files: `profileApplication.ts`, `profileSnapshot.ts`, profile-application helpers, agents application/persistence/activation assemblies. Separate durable repository access, candidate preparation and provider primitives; supply each its actual port. Migrate all profile-family consumers including CLI operation callers before deleting old exports. Test durable save/load, explicit unset, endpoint/keyfile selection, cancellation/rollback and two live roots outside ALS. Exit E and profile-family 2b matches gone.

### Agents-owned assembly cutovers

30. **Move CLI profile preflight construction behind agents.** Files: `config/profileBootstrap.ts` prepareRuntimeForProfile, `postConfigRuntime.ts` preflight, agents createAgent/activation assembly. Add the agents-owned declarative preflight entry backed by the same construction path as createAgent; return a preflight operation/result, never a multi-service graph. CLI retains argument/document parsing and UI/browser capabilities only. Migrate that functional preflight path and delete its CLI provider-owner construction. Test actual profile/model/auth activation, failure cleanup and host routing. Exit E plus CLI preflight cannot construct provider/MCP owners.

31. **Move CLI foreground session construction behind agents.** Files: `cliSessionBootstrap.ts` bootstrapRuntimeAndConfig/RuntimeConfigBootstrap, `cliAgentBootstrap.ts` createForegroundAgent, `postConfigRuntime.ts` finalization, createAgent assembly. Consume the entry from step 30 or a declarative direct createAgent route; initialize workspace/session inside agents and publish only domain operation ports to rendering. Preserve recording/resume and startup order. Remove CLI foreground provider/MCP construction and RuntimeConfigBootstrap after its remaining consumers migrate. Test interactive/noninteractive startup, foreground auth, recording continuation and cleanup failure. Exit E and no host runtime bundle return.

32. **Move ACP session construction behind agents.** Files: `zed-session-agent.ts` buildZedSessionAgent/composeSessionProviderManager/ZedSessionAgent, zed setup/integration/ports. Pass declarative selection, provider contributions, host trust and terminal/browser adapters into the same agents assembly. Remove settings/policy/provider-owner construction and the default fromConfig route. Test two live ACP sessions, profile/auth isolation, resume history and one disposal leaving the other operational. Exit E; ACP retains transport ownership only.

33. **Unify isolated and child provider lifetime assembly.** Files: agents `agentRuntimeAssembly.ts`, `policyComposition.ts`, subagentOrchestrator/runtimeSetup, providers runtimeContextFactory/runtimeActivationBindings/runtimeLifecycle/assembleCliProviderRuntime/cliForegroundRuntime. Move graph construction into the existing agents assembly, inject only provider-owned primitives into providers. Migrate remaining isolated/role/test-helper consumers and delete IsolatedRuntimeContextHandle, AssembledCliProviderRuntime, activation callback no-ops and obsolete factory types/exports when their last callers move. Do not preserve the retired registration/factory seam. Test foreground/child/role separation, same concrete session bus, activation failure and ownership disposal. Exit E and all lifecycle-family 2b imports reconciled.

34. **Remove Config startup orchestration.** Files: `config.ts` initialize/ensureInitialized/performInitialization, `configTypes.ts` ConfigInitializationDependencies, agents workspace initialization/adoption, `fromConfig.ts:574-575` readiness probing, `packages/test-utils/src/core/config.ts:813` and all test-fixture callers. The runtime production manifest excludes test-utils, so its startup caller was measured separately in config-startup-callers.txt. Owners sequence IDE, parser, tools, MCP, extensions, LSP, definitions and memory explicitly; Config remains declarative. Delete dependency bag and startup methods together with final callers. Preserve readiness and partial-bootstrap rejection as owner behavior, not Config flags serving as runtime authority. Test contribution/publication order, MCP cancellation before trust join and adopted Config identity. Exit E and zero Config startup bag findings.

### Remove wholesale facade/dependency passing

35. **Narrow agent control-plane dependency injection.** Files: `agent-deps.ts` AgentDeps, `agentImpl.ts` model/settings/auth/profile control construction, `createAgent.ts` assembleFacade. Assembly retains the graph privately; pass control-specific read/mutation/auth ports as explicit constructor arguments, never an AgentDeps-shaped replacement interface. Remove migrated whole-deps accesses. Test profile/model operations, typed busy and two-root settings/auth independence. Exit E and no new bundle introduced.

36. **Narrow execution and shutdown dependency injection.** Files: remaining AgentDeps/AgentImpl, `loop/rebuildLoop.ts` RebuildLoopDeps, runtimeFactories and loop creation. Pass scheduler, execution, recording, child launch and disposal operations directly to their consumers; keep admission attached to the same agent lifetime during rebuild. Delete AgentDeps and RebuildLoopDeps wholesale shapes after final consumers migrate. Test held/failing turn disposal and no admission bypass after auth/model/profile rebuild. Exit E and dependency-bag findings gone.

37. **Preserve adoption without a FromConfig services bag.** Files: `config-types.ts` FromConfigBaseOptions/FromConfigOptions, `fromConfig.ts`, `fromConfig-cleanup.ts`, shared final assembly and adoption tests. Keep the caller's exact Config identity and explicit borrowed-resource ownership. Receive adopted collaborators through explicit parameters at the agents-owned assembly seam; no generic services options and no new preferred fromConfig callers. Delete old options bundle and its consumers in the cutover. Test caller resources usable after disposal, initial/candidate rollback and concurrent disposal. Exit E with D2 preserved and adoption findings removed.

38. **Narrow CLI model/auth/profile command collaborators.** Files: `ui/commands/types.ts` CommandContext, slashCommandHandlers, model/provider/profile/quota/set/toolformat commands and their registrars. Bind command handlers to the actual operation ports they use; invocation/UI data remains separate from runtime dependencies. Remove raw provider/client/message-bus reach-through from these consumers; do not rename CommandContext.services to another keyed runtime bag. Test public command effects, busy/stale results, auth routing and two live command hosts. Exit E and affected command findings disappear.

39. **Narrow CLI session/tool/workspace command collaborators.** Files: chatCommand/chatOwnerCommand, hooks/todo/memory/clear/extension/subagent commands and common command wiring. Inject history/session, tool, hook, task and workspace operations per handler, separate from rendering state. Delete migrated whole CommandContext runtime-passing paths and retain only nonservice invocation data. Test resume/clear, exactly-once tools, blocked workspace authority, hook execution and cancellation. Exit E and these command bag findings gone.

40. **Narrow React stream/input and noninteractive wiring.** Files: AppContainerRuntime, RuntimeContext, useAppInput, agentStream/useSubmitQuery, stream adapters and nonInteractiveCli support. Hosts may own a public command-capable Agent at their boundary, but ordinary hooks receive only stream/control/read ports; React context is owner-scoped and never backed by a module pointer. Remove raw Agent service projections and wholesale bootstrap props in the same consumer cutover. Test two live providers, steer/cancel, stats/listener teardown and noninteractive terminality. Exit E and React/input bundle/bag findings reconciled.

41. **Narrow ACP and A2A adapter dependency surfaces.** Files: zed-session-ports/agent-setup/session-loader/zedIntegration, A2A executor CoderAgentExecutorDependencies, task-runtime/task/http app. Give task streaming/approval/history and ACP recording/options their domain operations rather than the whole Agent or creation-capable services collection. Constructor-injected external factories are specific host/test boundaries, never a generic runtime registry. Test two live sessions/tasks, duplicate approvals, cancellation, resume and task disposal. Exit E and adapter findings reconciled.

42. **Delete raw runtime-service exposure from Agent.** Files: `agent.ts:1080-1161`, AgentImpl raw providerManager/agentClient/sessionClient/getMessageBus exposure, IDE client getter and remaining consumers from raw-agent-consumers.txt. Migrate any final SDK/internal caller to an actual domain operation and remove raw service getters/properties in the same step. Keep public agent commands and typed results, not an object that exposes service objects. Do not add a privileged service-access interface or cast-only escape. Test public createAgent/fromConfig behavior, child bus routing through its owning assembly, secret-safe results and exported surface negative controls. Exit E; Agent no longer seeds transitive service-bundle findings.

### Conformance and strict closure

43. **Finish S1 through public two-root behavior.** Files: frozen S1 scaffold, shared conformance driver and public identity/profile/tool tests. Use equal labels, distinct providers/workspaces/credential references; interleave turns, profile/model changes, auth prompts and disposal. Capture outgoing model/auth headers, settings, tool policy, counters and filesystem/history streams, with one root continuing after the other closes. Extend #2300 assertions to model/settings. Remove S1 skip only after every frozen observable is directly checked. Exit E plus executed S1, zero cross-root effects and preserved MCP evidence.

44. **Finish S2 and immutable request/tool contexts.** Files: frozen S2 scaffold, safe-boundary/wire-capture tests, actual profile transaction and loop rebuild public entrypoints. Assert typed second-turn busy, steering content reaches the active run, real profile transition queues or returns busy at the boundary, and auth/model/profile/session rebuild never opens another loop. Mutate input after admission and verify immutable turn/tool snapshots. Queue a command at an expected revision, commit another and prove explicit stale outcome, never silent rebase. Remove S2 skip only after complete coverage. Exit E plus executed S2 and the combined C test lane green.

45. **Run physical lifecycle hooks on native Windows and POSIX shells.** Files: physical-hook-fixture, physical lifecycle consumers and hook-runner-physical-driver. Generate native invocation/quoting from the platform, use real Bun child processes and preserve production dispatch. Test physical input/output, exit failure, held child cancellation and exactly-once shutdown; use the existing Windows CI lane rather than treating an in-process owner test as child-execution proof. Exit E plus physical tests on both platforms.

46. **Make the production boundary gate strict and prove closure.** Files: check-runtime-state-boundary.ts, runtime-boundary-ratchet.ts/tests, runtime-service-shape-baseline.json, package.json, CI, providers/package.json/runtime exports and obsolete runtime barrel. Prerequisites: every row above is done and a fresh audit has zero findings in both shape families. Reconcile every by-file finding, including inferred calls, callbacks and returns, against actual source deletions/ports. Delete baseline, --baseline parsing and ratchet evaluation, not the strict negative controls. Delete any final providers/runtime exports and obsolete modules only after all remaining consumers, including specs/helpers and dynamic imports, migrate; execute all five exact criterion-2 rg checks in CI and add controls for restoring each import/export/accessor family. Keep scanner and assembly allowances exact. Exit: strict production command exit 0, deliberately restored bundle/bag/delegation/Config getter fails CI, all criterion-2 outputs empty, S1/S2 executed, and full AC8 verification plus `bun scripts/start.ts --profile-load lunahigh "write me a haiku and nothing else"` passes. Record measured results and link PR #3842/MCP deletion evidence on both issues. No merge without Andrew's instruction.

### Separate handoffs within wider workstreams

The parent workstream supplies each handoff's ownership design, behavioral requirements and exit E. The following partitions are executable handoffs, not parallel assignments: complete them in the listed order, and delete each superseded consumer path as it moves. Do not cut a handoff in the middle of a failing build. If a dependency requires preparation, ship a behavior-neutral narrow contract first, not a forwarding implementation.

- **16a. Capture credential authority at the host boundary.** Introduce immutable socket/capability input and explicit token-transport creation contracts in the credential factory and host inputs. Preserve inherited-fd validation, close-once and secret tests. No consumer behavior changes or new service collection.
- **16b. Isolate provider-manager and isolated-runtime token stores.** Migrate `providerManagerInstance.ts` and isolated auth acquisition to the owner-created transports; remove their borrowed singleton calls. Two live proxy roots, socket replacement and A/B disposal tests must pass.
- **17a. Inject provider key reads.** Migrate BaseProvider credential construction, load-balancing memberAuthentication, profile keyResolution and CompressionProfileResolver to read-only key ports. Delete their factory lookup fallback. Test named-key resolution and member-bound credential identity through recorded requests.
- **17b. Inject CLI key/schema/profile credential reads.** Migrate keyCommand, profileSchemas and profileLoadBalancer to the explicit host credential owner. Test key CRUD and profile/bucket validation without another root's socket being closed.
- **17c. Retire shared broker/bootstrap credential acquisition.** Migrate `cli.tsx` capability startup and `githubBrokerClient.ts`; delete the remaining factory caches/reset paths. Test broker commands through two live proxy hosts and teardown, plus the descriptor controls.
- **22a. Add session metric port contracts.** Define snapshot, subscription, reset and event-sink interfaces beside telemetry implementations. No replacement bundle and no change to producers yet. Verify contract consumers typecheck and existing metrics behavior passes.
- **22b. Cut over aggregation, projections and the singleton together.** With CLI readers already migrated in step 21, bind loggers, AgentStatsProjector and client token tracking to the same session-owned aggregator and delete the singleton. This is the behavioral cutover, with two-root totals/reset/dispose assertions.
- **23a. Narrow admitted provider request capture.** Split captureProviderInvocation and its SessionSettingsOwner producers into immutable data and explicit retry/auth operations. Migrate this request path and delete its whole-context parameter. Run direct/LB capture and out-of-ALS tests.
- **23b. Remove provider runtime context's service-carrying fields.** Migrate remaining manager/context consumers, then delete ProviderRuntimeContextInit and service-carrying context fields or the obsolete context itself. Provider factories get individual dependencies; admitted data remains data. Run provider composition and two-root activation tests.
- **29a. Move durable profile snapshot and persistence operations.** Migrate profileSnapshot and profilePersistenceAssembly plus their consumers; repository writes receive document data, not runtime objects. Delete the old snapshot export after its last caller moves. Run durable save/load/explicit-unset tests.
- **29b. Move profile candidate application.** Migrate profileApplication helpers, profileApplicationAssembly and activation executor callers to agents-owned candidate operations. Delete the old application exports after final CLI operation consumers migrate. Run held/failing preparation and rollback with two roots.
- **30a. Define agents-owned preflight host inputs.** Add declarative preflight input and request-only host auth/browser contracts to the existing agents assembly, with no concrete factories or service return. Run input-validation and missing-capability tests; this is contract-only preparation.
- **30b. Migrate CLI profile preparation.** Cut over prepareRuntimeForProfile and its argument/profile entry to agents-owned preflight, retaining only profile parsing and data metadata in CLI. Remove that provider construction path; run profile/model/auth startup and rollback tests.
- **30c. Migrate post-config preflight.** Cut over postConfigRuntime's activation/profile/switch construction to the same preflight lifetime, deleting its direct owner creation. Run timeout, auth failure and owner-transfer tests. Shared old provider factory deletion waits for step 33's last caller.
- **31a. Bind foreground agent startup from declarative inputs.** Migrate createForegroundAgent and foreground session activation to the agents-owned constructor; remove its concrete runtime factories and default adoption route. Run interactive and noninteractive bootstrap behavior.
- **31b. Move recording/resume assembly and retire RuntimeConfigBootstrap.** Migrate its remaining CLI bootstrap/recording consumers to session operation ports and plain bootstrap data. Delete RuntimeConfigBootstrap and its services return. Run record/continue/resume and failure-cleanup tests.
- **33a. Migrate preferred agent provider lifetime assembly.** Move createAgent/agentRuntimeAssembly/policyComposition provider graph construction into the named assembly root. Give collaborators separate provider-owned ports; remove that root's dependency on the old handle. Run public declarative activation and partial-bootstrap tests.
- **33b. Migrate isolated role runtime assembly.** Move compression/role runtime setup to the same agents path with explicit role input and credentials. Remove that role's old handle acceptance. Test selected model/member, parameter capture and rollback while foreground remains usable.
- **33c. Migrate child runtime assembly.** Cut over subagentOrchestrator/subagentRuntimeSetup and child factory callers. Preserve concrete bus identity through owning assembly, tool authority and child-first disposal. Run the existing public child/task admission and isolation suites.
- **33d. Delete last provider runtime factory/handle consumers.** Migrate test helpers and remaining activation/lifecycle callers, then delete obsolete handle/factory/no-op binding implementations and corresponding package exports/import allowances. Run #2300, package surface and no-import controls. Do not move obsolete implementations into another folder merely to satisfy grep.
- **35a. Bind model/settings controls from explicit ports.** Remove those dependencies from AgentDeps wholesale passing and give their consuming controls only read/write/admission operations. Run model/default/revision tests.
- **35b. Bind auth/profile controls from explicit ports.** Remove the corresponding remaining whole-deps access and supply credential/profile transaction operations directly. Run owner auth/persistence/cancellation tests. The private assembly graph stays only inside the root.
- **37a. Make adopted resource acquisition explicit.** Preserve fromConfig identity while changing its assembly input from a services options object to explicit collaborator parameters, updating caller-owned tests and all external adoption callers. Migrate acquisition, not an alias of the old options.
- **37b. Retire adoption helper bundles.** Migrate fromConfig helper/cleanup/finalization arguments to narrow operations, then delete FromConfigBaseOptions/FromConfigOptions service-carrying forms. Run binding-failure, borrowed-survival and concurrent-dispose tests. Default bootstrap paths must remain outside adoption.
- **38a. Bind model/settings/provider commands.** Migrate set/toolformat/model/provider command handlers and schema/dialog reads to individual owner operations and separate invocation/UI data. Test busy/stale outcomes and provider/model effects.
- **38b. Bind auth/quota commands.** Migrate OAuth/key/quota handler registration to host credential and owner auth-read ports. Test two live command hosts, auth cancellation and quota display without raw managers.
- **38c. Bind profile commands.** Migrate profile load/save/list/LB commands to the profile operations from step 29. Remove raw sessionClient.publishTools reach-through in profileLoad. Test actual durable documents, selected binding and rollback.
- **39a. Bind history/session/media commands.** Migrate chatCommand/chatOwnerCommand, continue/copy/compress and historyServiceAccess to history/recording/media operations that return data rather than AgentClient. Test resume/copy/compression/media ownership.
- **39b. Bind tool/workspace commands.** Migrate tools/directory/memory/image and bug-report handlers to tool/workspace/image/report operations; no raw agentClient or mediaStore leak. Test denied tools/workspaces, directory context publication and image/report behavior.
- **39c. Bind hook/task/subagent commands.** Migrate hooks/todo/subagent/extension commands to owned operations. Replace returning raw/detached AgentClient with a purpose-specific role execution operation. Test task execution count, hooks, role cancellation and sibling usability.
- **39d. Remove the common runtime command bag.** Migrate final slash-command registrar/handler wiring, then delete CommandContext's runtime services collection and whole-context runtime signatures. Keep invocation/rendering data separate. Run command integration and strict synthetic command-bag controls.
- **40a. Narrow stream submission collaborators.** Migrate useSubmitQuery and noninteractive streaming consumers to stream/steer/cancel and recording ports. Test terminality, provider-ignore-cancel and admitted continuation.
- **40b. Narrow React input/context projections.** Migrate AppContainerRuntime/useAppInput/RuntimeContext and completion/history helpers to the domain ports from preceding command handoffs. Remove wholesale bootstrap props and raw service projections. Test two React roots and listener teardown.
- **41a. Narrow ACP session adapters.** Cut over zed session projections, recording/resume setup and integration methods to actual history/options/stream operations. Test two sessions, ACP commands and resume/dispose.
- **41b. Narrow A2A task adapters.** Cut over CoderAgentExecutorDependencies and Task.create/createTaskRuntime to task stream/approval/terminality operations. Test duplicate approval and cancelled/evicted tasks; no other task closes.
- **42a. Retire final SDK/internal raw-service consumers.** Use raw-agent-consumers.txt to migrate remaining direct manager/client/bus/IDE access to the corresponding domain operation. Each migrated consumer loses its old service reach-through immediately. Run public SDK and owning child/bus behavior.
- **42b. Delete raw Agent service exposure.** After zero raw consumers, delete the public service fields/getters and implementation exports, updating surface controls. Preserve Agent commands and adopted-resource identity probes through effects rather than raw objects. Run full surface and strict audit checks; no service-access escape interface.
- **43a. Implement the complete S1 driver.** Add the frozen two-root request/effect/auth/counter/history matrix against real owners and external-boundary fakes, initially alongside the still-skipped scaffold. Test the full driver in ordinary Bun grouping; do not label the frozen entry passing yet.
- **43b. Bind S1 into conformance.** Execute that driver from the frozen S1 entry, remove only its skip, link #2300 and MCP evidence and run the combined lane. The driver must already satisfy every S1 criterion before this handoff.
- **44a. Prove immutable tool/turn capture and rebuild exclusion.** Complete actual profile/auth/model/session rebuild tests and mutation/stale-queue effects, alongside the independently passing S2 coverage. Each path must use the existing agent admission lifetime. Run the combined C suite.
- **44b. Bind S2 into conformance.** Execute the completed public driver from the frozen S2 entry and remove only its skip. Assert typed outcomes and observed no-second-loop behavior without mocking the coordinator or loop under test.
- **46a. Delete runtime exports and import guard allowances.** After migrated consumers are zero, remove any final runtime barrels/export paths and corresponding `scripts/cli-boundary/config.ts` public-subpath allowances. Add exact criterion-2 CI checks and seeded import/export controls. Type-only, dynamic, spec and helper consumers are all included in deletion verification. Keep ordinary instance methods valid.
- **46b. Delete the shape ratchet and run final acceptance.** With every shape row at zero, delete baseline and ratchet option/logic, retain strict controls and execute final AC1-8 verification. No new exemptions or baseline slack. Attach actual results to the closure evidence.

## Risks and design decisions

- **Credential authority input:** inherited fd 3 can be consumed only once, while transports must belong to independent roots. Recommended answer: capture validated credentials once in an explicit application-host owner and pass immutable authority input into per-root clients. Keep descriptor/security tests; never replace this with a root-id registry or mutable environment reread. This follows the existing host ownership design; Andrew's decision is needed only if a public multi-host credential contract must change.
- **D2 adoption:** FromConfigOptions is a measured prohibited bundle, but caller-owned adoption itself is explicitly retained by #2615/#3222. Recommended answer: keep adoption and exact Config identity, change collaborator injection to explicit assembly parameters and remove only the services bag. Do not remove fromConfig or route preferred CLI/ACP construction through it. No architectural exception is requested.
- **Public raw Agent services:** existing Agent exposes providerManager, agentClient and MessageBus, which causes findings through callers and inferred returns. Recommended answer: delete those service exposures after domain consumers migrate, without compatibility aliases. Public Agent commands remain. If Andrew knows an external consumer requiring an exception, obtain a written scoped decision rather than silently exempting Agent from the scanner.
- **Smoke wording:** issue AC8 names cancelled StepFun. Recommended answer: record the standing `lunahigh` replacement explicitly in closure evidence, with its exact command. Do not restore StepFun or paid Z.ai. This is an existing instruction, not a pending profile-selection gate.
- **Scanner precision:** high finding counts include variables, inferred returns and callbacks, not just interface declarations. A narrower annotation or renamed module alone cannot prove removal. Recommended answer: retain the existing checker identities and strict controls; fix ownership and run the full audit after each functional cutover. No scanner weakening is authorized. The CLI boundary currently treats `runtime.js` and its runtime subpaths as public (`scripts/cli-boundary/config.ts:99-114`), so that guard also needs consumer-first allowance deletion when each old export disappears. Its present import pass cannot certify AC2b.
- **Model notifications:** fixing ModelProfileChanged alone would leave ModelChanged on the same global client channel. Recommended answer: migrate their shared invalidation lifetime as one functional unit, without broadening to unrelated core application events.
- **Windows physical behavior:** native Windows execution cannot be measured on this Darwin host. Recommended answer: require the Windows job for step 45; do not replace physical execution with an in-process assertion or lower required checks.
- **Verification fixture failure:** independent tests pass, but their combination fails. Recommended answer: first reproduce and fix fixture ownership without changing production prompt defaults or weakening scenario assertions. Keep the combined failure as a gate until resolved.

No new owner-approval gate is needed to implement this plan. Only a requested change to D2, public external compatibility, or credential authority semantics requires Andrew's written decision. Routine branch/PR work proceeds under the existing instructions; merging remains separately authorized.

## Unmeasured

Full repository test/lint/typecheck/format/build and live smoke were intentionally not run for a source-free planning task. Real two-root reproductions for the six remaining process-global mechanisms and held/failing tests for the nine shutdown items have not been run; their present mechanisms are confirmed by source. Windows execution is not available on this host. Package packed-consumer behavior after deleting runtime exports must be verified during the implementation cutover. These limits do not convert any unfinished item into a pass.

## Appendix A: measured owner totals

| Owner | runtime-service-bundle | runtime-service-bag-parameter |
| --- | ---: | ---: |
| a2a-server | 12 | 3 |
| agents | 244 | 102 |
| cli | 775 | 553 |
| core | 9 | 6 |
| providers | 83 | 27 |
| zed-acp | 32 | 7 |
| Total | 1,155 | 698 |

The mutable/ALS scan deliberately covers narrower roots than service-shape discovery. It does not certify the interactive-auth, telemetry, credential-factory or global dispatcher modules as globally pure. Their source-supported residuals are separately listed above.

## Appendix B: exact criterion 2 patterns

All commands use `packages/*/src --glob '!**/*.test.*'` exactly as specified. Exit 1 with no stdout means zero matches, not tool failure; all measured stderr was empty.

- 2a, zero: `rg -n "getCliRuntimeServices|getCliRuntimeContext|getCliRuntimeConfig|getCliProviderManager|getCliOAuthManager|maybeGetCliOAuthManager|isCliRuntimeStatelessReady|ensureStatelessProviderReady|getActiveProviderStatus|resolveActiveRuntimeIdentity|registerCliProviderInfrastructure" packages/*/src --glob '!**/*.test.*'`
- 2b, 70: `rg -n "from '@vybestack/llxprt-code-providers/runtime" packages/*/src --glob '!**/*.test.*'`
- 2c, zero: `rg -n "runtimeRegistry|defaultCliRuntimeId" packages/*/src --glob '!**/*.test.*'`
- 2d, zero: `rg -n "peekActiveProviderRuntimeContext|setActiveProviderRuntimeContext|setSettingsProviderRuntimeContext|clearActiveProviderRuntimeContext|clearSettingsProviderRuntimeContext|getActiveProviderRuntimeContext|createSettingsProviderRuntimeContext|resolveRuntimeSettingsService|getRuntimeSettingsService|maybeGetRuntimeSettingsService" packages/*/src --glob '!**/*.test.*'`
- 2e, zero: `rg -n "singletonManager|singletonOAuthManager|registerProviderManagerSingleton" packages/*/src --glob '!**/*.test.*'`

Exact-command import grouping: agents 43, CLI 26, zed-acp 1. Excluding spec and __tests__ helper paths for production interpretation only gives agents 39, CLI 23, zed-acp 1; the acceptance command itself still must reach zero. Namespace/default imports are absent in the measured matches. Dynamic imports are not covered by the issue's text pattern and must also disappear before deleting exports.

### Imported symbol occurrence inventory

Counts are import declarations containing that symbol, not references inside bodies.

| Imported symbol | Occurrences |
| --- | ---: |
| `IsolatedRuntimeContextHandle` | 10 |
| `ProviderSwitcher` | 9 |
| `assembleModelSelection` | 7 |
| `createIsolatedRuntimeContext` | 6 |
| `getActiveModelParams` | 5 |
| `createRuntimeActivationBindings` | 4 |
| `clearActiveModelParam` | 3 |
| `ModelSelectionOperations` | 3 |
| `NO_ACTIVE_PROVIDER_ERROR_MESSAGE` | 3 |
| `parseEphemeralSettingValue` | 3 |
| `setActiveModel` | 3 |
| `setActiveModelParam` | 3 |
| `updateActiveProviderApiKey` | 3 |
| `admitLoadBalancerModelParameters` | 2 |
| `admitModelParameters` | 2 |
| `clearSessionSetting` | 2 |
| `ephemeralSettingHelp` | 2 |
| `getActiveModelName` | 2 |
| `getActiveProviderMetrics` | 2 |
| `getActiveToolFormatState` | 2 |
| `getEphemeralSetting` | 2 |
| `getEphemeralSettings` | 2 |
| `getProfileByName` | 2 |
| `getSessionSetting` | 2 |
| `getSessionTokenUsage` | 2 |
| `getUnallowedParametersForActiveModel` | 2 |
| `listAvailableModels` | 2 |
| `listProviders` | 2 |
| `readActiveProviderName` | 2 |
| `RuntimeActivationBindings` | 2 |
| `setActiveToolFormatOverride` | 2 |
| `setEphemeralSetting` | 2 |
| `setSessionSetting` | 2 |
| `applyCliArgumentOverrides` | 1 |
| `applyCliSetArguments` | 1 |
| `applyProfileCascade` | 1 |
| `assembleCliProviderRuntime` | 1 |
| `BaseUrlUpdateResult` | 1 |
| `buildRuntimeProfileSnapshot` | 1 |
| `CliRuntimeRegistrationHandle` | 1 |
| `deleteProfileByName` | 1 |
| `finishProfileApplication` | 1 |
| `getActiveProviderName` | 1 |
| `IsolatedRuntimeContextOptions` | 1 |
| `ProfileLoadOptions` | 1 |
| `ProfileLoadResult` | 1 |
| `ProviderRuntimeStatus` | 1 |
| `readProviderStatus` | 1 |
| `saveLoadBalancerProfile` | 1 |
| `saveProfileSnapshot` | 1 |
| `setProviderApiKey` | 1 |
| `setProviderBaseUrl` | 1 |
| `switchActiveProvider` | 1 |
| `ToolFormatOverrideLiteral` | 1 |
| `updateActiveProviderBaseUrl` | 1 |

### Exact 2b matching-file inventory

| File | Matching imports |
| --- | ---: |
| `packages/agents/src/api/__tests__/helpers/buildCliStyleConfig.ts` | 2 |
| `packages/agents/src/api/__tests__/helpers/profile-owner-fixture.ts` | 1 |
| `packages/agents/src/api/__tests__/helpers/session-client-engine-fixture.ts` | 1 |
| `packages/agents/src/api/agent-deps.ts` | 1 |
| `packages/agents/src/api/agentImpl.ts` | 2 |
| `packages/agents/src/api/agentRuntimeAssembly.ts` | 2 |
| `packages/agents/src/api/config-types.ts` | 1 |
| `packages/agents/src/api/createAgent.ts` | 4 |
| `packages/agents/src/api/directProviderAdmission.ts` | 2 |
| `packages/agents/src/api/fromConfig.ts` | 3 |
| `packages/agents/src/api/policyComposition.ts` | 2 |
| `packages/agents/src/api/profileApplicationAssembly.ts` | 5 |
| `packages/agents/src/api/profilePersistenceAssembly.ts` | 3 |
| `packages/agents/src/api/providerActivationExecutor.ts` | 6 |
| `packages/agents/src/api/providerSwitchAssembly.ts` | 3 |
| `packages/agents/src/core/subagentOrchestrator.ts` | 4 |
| `packages/agents/src/core/subagentRuntimeSetup.ts` | 1 |
| `packages/cli/src/cliAgentBootstrap.ts` | 1 |
| `packages/cli/src/cliSessionBootstrap.ts` | 1 |
| `packages/cli/src/config/postConfigRuntime.ts` | 1 |
| `packages/cli/src/config/profileBootstrap.ts` | 3 |
| `packages/cli/src/runtime/createRuntimeOwnerFeatures.ts` | 6 |
| `packages/cli/src/ui/commands/setCommand.ts` | 1 |
| `packages/cli/src/ui/commands/setCommandSchema.ts` | 1 |
| `packages/cli/src/ui/commands/toolformatCommand.ts` | 1 |
| `packages/cli/src/ui/components/ModelConfigDialog.tsx` | 1 |
| `packages/cli/src/ui/contexts/RuntimeContext.tsx` | 6 |
| `packages/cli/src/ui/hooks/agentStream/__tests__/useSubmitQuery.providerIgnoreCancel.bun.tsx` | 2 |
| `packages/cli/src/ui/hooks/useProviderDialog.spec.ts` | 1 |
| `packages/cli/src/ui/hooks/useProviderDialog.ts` | 1 |
| `packages/zed-acp/src/zed-config-options.ts` | 1 |

## Appendix C: per-file service-shape findings

These are audit findings, including inferred expressions and parameters, not declarations counted as implementation scope. Exact positions and enclosing symbols are in `tmp/plan2616/findings.tsv`. Each owner/file is reconciled by the functional workstreams above; deleting the ratchet requires every row to reach zero.

| Owner | File | Bundle findings | Bag-parameter findings |
| --- | --- | ---: | ---: |
| a2a-server | `packages/a2a-server/src/agent/executor.ts` | 8 | 1 |
| a2a-server | `packages/a2a-server/src/agent/task-runtime.ts` | 0 | 1 |
| a2a-server | `packages/a2a-server/src/agent/task.ts` | 1 | 1 |
| a2a-server | `packages/a2a-server/src/config/config.ts` | 1 | 0 |
| a2a-server | `packages/a2a-server/src/http/app.ts` | 2 | 0 |
| agents | `packages/agents/src/api/activationPreflightState.ts` | 8 | 5 |
| agents | `packages/agents/src/api/agent-deps.ts` | 1 | 1 |
| agents | `packages/agents/src/api/agent-tool-assembly.ts` | 1 | 1 |
| agents | `packages/agents/src/api/agent.ts` | 1 | 0 |
| agents | `packages/agents/src/api/agentImpl.ts` | 8 | 2 |
| agents | `packages/agents/src/api/agentRuntimeAssembly.ts` | 9 | 8 |
| agents | `packages/agents/src/api/config-types.ts` | 2 | 0 |
| agents | `packages/agents/src/api/control/toolControl.ts` | 1 | 1 |
| agents | `packages/agents/src/api/createAgent.ts` | 27 | 8 |
| agents | `packages/agents/src/api/discovery.ts` | 4 | 0 |
| agents | `packages/agents/src/api/fromConfig-cleanup.ts` | 3 | 4 |
| agents | `packages/agents/src/api/fromConfig.ts` | 81 | 35 |
| agents | `packages/agents/src/api/loop/rebuildLoop.ts` | 3 | 2 |
| agents | `packages/agents/src/api/policyComposition.ts` | 13 | 3 |
| agents | `packages/agents/src/api/profileReplacement.ts` | 2 | 2 |
| agents | `packages/agents/src/api/providerSwitchAssembly.ts` | 13 | 5 |
| agents | `packages/agents/src/api/runtimeFactories.ts` | 3 | 3 |
| agents | `packages/agents/src/api/session-image-assembly.ts` | 0 | 1 |
| agents | `packages/agents/src/core/agenticLoop/AgenticLoop.ts` | 0 | 1 |
| agents | `packages/agents/src/core/agenticLoop/types.ts` | 1 | 0 |
| agents | `packages/agents/src/core/subagent.ts` | 2 | 1 |
| agents | `packages/agents/src/core/subagentAdmissionForwarding.ts` | 4 | 1 |
| agents | `packages/agents/src/core/subagentNonInteractive.ts` | 3 | 3 |
| agents | `packages/agents/src/core/subagentOrchestrator.ts` | 41 | 9 |
| agents | `packages/agents/src/core/subagentRuntimeSetup.ts` | 2 | 1 |
| agents | `packages/agents/src/session/session-client-owner.ts` | 6 | 2 |
| agents | `packages/agents/src/session/session-tool-catalog-owner.ts` | 1 | 1 |
| agents | `packages/agents/src/tools/task.ts` | 4 | 2 |
| cli | `packages/cli/src/cli.tsx` | 13 | 2 |
| cli | `packages/cli/src/cliAgentBootstrap.ts` | 5 | 1 |
| cli | `packages/cli/src/cliBootstrap.tsx` | 2 | 0 |
| cli | `packages/cli/src/cliProviderInit.ts` | 3 | 1 |
| cli | `packages/cli/src/cliSessionBootstrap.ts` | 8 | 3 |
| cli | `packages/cli/src/cliTerminalSession.ts` | 4 | 1 |
| cli | `packages/cli/src/commands/mcp/list.ts` | 1 | 0 |
| cli | `packages/cli/src/config/config.ts` | 13 | 3 |
| cli | `packages/cli/src/config/postConfigRuntime.ts` | 33 | 10 |
| cli | `packages/cli/src/config/profileBootstrap.ts` | 22 | 12 |
| cli | `packages/cli/src/nonInteractiveCli.ts` | 21 | 9 |
| cli | `packages/cli/src/nonInteractiveCliCommands.ts` | 9 | 3 |
| cli | `packages/cli/src/runtime/interactiveToolScheduler.ts` | 2 | 2 |
| cli | `packages/cli/src/services/BuiltinCommandLoader.ts` | 0 | 1 |
| cli | `packages/cli/src/services/FileCommandLoader.ts` | 1 | 2 |
| cli | `packages/cli/src/services/McpPromptLoader.ts` | 0 | 2 |
| cli | `packages/cli/src/services/prompt-processors/argumentProcessor.ts` | 0 | 1 |
| cli | `packages/cli/src/services/prompt-processors/shellProcessor.ts` | 0 | 1 |
| cli | `packages/cli/src/services/prompt-processors/types.ts` | 0 | 1 |
| cli | `packages/cli/src/session/interactiveUI.tsx` | 11 | 9 |
| cli | `packages/cli/src/session/nonInteractiveSession.ts` | 8 | 3 |
| cli | `packages/cli/src/ui/App.tsx` | 3 | 2 |
| cli | `packages/cli/src/ui/AppContainer.tsx` | 1 | 1 |
| cli | `packages/cli/src/ui/AppContainerRuntime.tsx` | 25 | 10 |
| cli | `packages/cli/src/ui/commands/aboutCommand.ts` | 6 | 6 |
| cli | `packages/cli/src/ui/commands/authCommand.ts` | 5 | 6 |
| cli | `packages/cli/src/ui/commands/baseurlCommand.ts` | 1 | 1 |
| cli | `packages/cli/src/ui/commands/bugCommand.ts` | 3 | 4 |
| cli | `packages/cli/src/ui/commands/chatCommand.ts` | 23 | 17 |
| cli | `packages/cli/src/ui/commands/chatOwnerCommand.ts` | 32 | 13 |
| cli | `packages/cli/src/ui/commands/clearCommand.ts` | 1 | 1 |
| cli | `packages/cli/src/ui/commands/compressCommand.ts` | 2 | 2 |
| cli | `packages/cli/src/ui/commands/continueCommand.ts` | 5 | 4 |
| cli | `packages/cli/src/ui/commands/continuePackageActions.ts` | 3 | 3 |
| cli | `packages/cli/src/ui/commands/copyCommand.ts` | 0 | 1 |
| cli | `packages/cli/src/ui/commands/debugCommands.ts` | 6 | 12 |
| cli | `packages/cli/src/ui/commands/diagnosticsCommand.ts` | 1 | 2 |
| cli | `packages/cli/src/ui/commands/directoryCommand.tsx` | 3 | 3 |
| cli | `packages/cli/src/ui/commands/docsCommand.ts` | 0 | 1 |
| cli | `packages/cli/src/ui/commands/dumpcontextCommand.ts` | 2 | 2 |
| cli | `packages/cli/src/ui/commands/extensionsCommand.ts` | 9 | 14 |
| cli | `packages/cli/src/ui/commands/helpCommand.ts` | 0 | 1 |
| cli | `packages/cli/src/ui/commands/historyServiceAccess.ts` | 2 | 2 |
| cli | `packages/cli/src/ui/commands/hooksCommand.ts` | 19 | 14 |
| cli | `packages/cli/src/ui/commands/ideCommand.ts` | 0 | 3 |
| cli | `packages/cli/src/ui/commands/imageCommand.ts` | 0 | 2 |
| cli | `packages/cli/src/ui/commands/initCommand.ts` | 0 | 1 |
| cli | `packages/cli/src/ui/commands/keyCommand.ts` | 7 | 6 |
| cli | `packages/cli/src/ui/commands/keyfileCommand.ts` | 1 | 1 |
| cli | `packages/cli/src/ui/commands/loggingCommand.ts` | 1 | 6 |
| cli | `packages/cli/src/ui/commands/logoutCommand.ts` | 3 | 3 |
| cli | `packages/cli/src/ui/commands/mcpAuth.ts` | 1 | 3 |
| cli | `packages/cli/src/ui/commands/mcpCommand.ts` | 10 | 6 |
| cli | `packages/cli/src/ui/commands/mcpDisplay.ts` | 0 | 1 |
| cli | `packages/cli/src/ui/commands/memoryCommand.ts` | 2 | 6 |
| cli | `packages/cli/src/ui/commands/modelCommand.ts` | 2 | 2 |
| cli | `packages/cli/src/ui/commands/mouseCommand.ts` | 0 | 1 |
| cli | `packages/cli/src/ui/commands/perfCommand.ts` | 1 | 3 |
| cli | `packages/cli/src/ui/commands/permissionsCommand.ts` | 0 | 1 |
| cli | `packages/cli/src/ui/commands/policiesCommand.ts` | 7 | 6 |
| cli | `packages/cli/src/ui/commands/privacyCommand.ts` | 0 | 1 |
| cli | `packages/cli/src/ui/commands/profileCommand.ts` | 6 | 9 |
| cli | `packages/cli/src/ui/commands/profileLoad.ts` | 2 | 3 |
| cli | `packages/cli/src/ui/commands/profileSchemas.ts` | 0 | 4 |
| cli | `packages/cli/src/ui/commands/providerCommand.ts` | 4 | 3 |
| cli | `packages/cli/src/ui/commands/quitCommand.ts` | 0 | 1 |
| cli | `packages/cli/src/ui/commands/quotaCommand.ts` | 24 | 9 |
| cli | `packages/cli/src/ui/commands/restoreCommand.ts` | 3 | 4 |
| cli | `packages/cli/src/ui/commands/schema/index.ts` | 5 | 4 |
| cli | `packages/cli/src/ui/commands/schema/types.ts` | 0 | 2 |
| cli | `packages/cli/src/ui/commands/setCommand.ts` | 5 | 6 |
| cli | `packages/cli/src/ui/commands/setCommandSchema.ts` | 4 | 6 |
| cli | `packages/cli/src/ui/commands/settingsCommand.ts` | 0 | 1 |
| cli | `packages/cli/src/ui/commands/setupCommand.ts` | 0 | 1 |
| cli | `packages/cli/src/ui/commands/setupGithubCommand.ts` | 0 | 1 |
| cli | `packages/cli/src/ui/commands/skillsCommand.ts` | 0 | 6 |
| cli | `packages/cli/src/ui/commands/statsCommand.ts` | 2 | 9 |
| cli | `packages/cli/src/ui/commands/subagentCommand.ts` | 5 | 14 |
| cli | `packages/cli/src/ui/commands/tasksCommand.ts` | 9 | 9 |
| cli | `packages/cli/src/ui/commands/themeCommand.ts` | 0 | 1 |
| cli | `packages/cli/src/ui/commands/todoCommand.ts` | 21 | 10 |
| cli | `packages/cli/src/ui/commands/todoOperations.ts` | 1 | 13 |
| cli | `packages/cli/src/ui/commands/toolformatCommand.ts` | 0 | 1 |
| cli | `packages/cli/src/ui/commands/toolkeyCommand.ts` | 0 | 1 |
| cli | `packages/cli/src/ui/commands/toolkeyfileCommand.ts` | 0 | 1 |
| cli | `packages/cli/src/ui/commands/toolsCommand.ts` | 6 | 4 |
| cli | `packages/cli/src/ui/commands/types.ts` | 1 | 2 |
| cli | `packages/cli/src/ui/commands/uiprofileCommand.ts` | 0 | 1 |
| cli | `packages/cli/src/ui/commands/vimCommand.ts` | 0 | 1 |
| cli | `packages/cli/src/ui/components/Composer.tsx` | 2 | 0 |
| cli | `packages/cli/src/ui/components/DialogManager.tsx` | 19 | 9 |
| cli | `packages/cli/src/ui/components/DialogManagerRenderers.tsx` | 0 | 1 |
| cli | `packages/cli/src/ui/components/InputPrompt.tsx` | 1 | 1 |
| cli | `packages/cli/src/ui/components/inputPromptHooks.ts` | 7 | 5 |
| cli | `packages/cli/src/ui/components/inputPromptTypes.ts` | 2 | 0 |
| cli | `packages/cli/src/ui/components/modelDialogHandler.ts` | 2 | 1 |
| cli | `packages/cli/src/ui/components/SessionBrowserDialog.tsx` | 2 | 1 |
| cli | `packages/cli/src/ui/components/SubagentManagement/SubagentManagerDialog.tsx` | 5 | 2 |
| cli | `packages/cli/src/ui/components/views/ExtensionsList.tsx` | 1 | 0 |
| cli | `packages/cli/src/ui/containers/AppContainer/hooks/useAppBootstrap.ts` | 7 | 3 |
| cli | `packages/cli/src/ui/containers/AppContainer/hooks/useAppDialogs.ts` | 10 | 6 |
| cli | `packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.ts` | 38 | 22 |
| cli | `packages/cli/src/ui/containers/AppContainer/hooks/useSessionInitialization.ts` | 3 | 2 |
| cli | `packages/cli/src/ui/contexts/AppCommandsContext.tsx` | 17 | 1 |
| cli | `packages/cli/src/ui/hooks/agentStream/checkpointPersistence.ts` | 3 | 2 |
| cli | `packages/cli/src/ui/hooks/agentStream/submitQueryTurnLifecycle.ts` | 14 | 9 |
| cli | `packages/cli/src/ui/hooks/agentStream/useAgentEventStream.ts` | 11 | 4 |
| cli | `packages/cli/src/ui/hooks/agentStream/useAgentStream.ts` | 3 | 2 |
| cli | `packages/cli/src/ui/hooks/agentStream/useAgentStreamLifecycle.ts` | 7 | 2 |
| cli | `packages/cli/src/ui/hooks/agentStream/useAgentStreamOrchestration.ts` | 15 | 7 |
| cli | `packages/cli/src/ui/hooks/agentStream/useSubmitQuery.ts` | 24 | 8 |
| cli | `packages/cli/src/ui/hooks/schemaCompletionUtils.ts` | 1 | 1 |
| cli | `packages/cli/src/ui/hooks/shellCommandProcessor.ts` | 7 | 6 |
| cli | `packages/cli/src/ui/hooks/slashCommandHandlers.ts` | 55 | 30 |
| cli | `packages/cli/src/ui/hooks/slashCommandProcessor.ts` | 3 | 1 |
| cli | `packages/cli/src/ui/hooks/slashCommandProcessorSupport.ts` | 8 | 5 |
| cli | `packages/cli/src/ui/hooks/slashCompletionEffect.ts` | 5 | 4 |
| cli | `packages/cli/src/ui/hooks/useAutoAcceptIndicator.ts` | 2 | 1 |
| cli | `packages/cli/src/ui/hooks/useCommandCompletion.tsx` | 2 | 1 |
| cli | `packages/cli/src/ui/hooks/useCoreEventHandlers.ts` | 2 | 1 |
| cli | `packages/cli/src/ui/hooks/useProviderDialog.ts` | 2 | 1 |
| cli | `packages/cli/src/ui/hooks/useReactToolScheduler.ts` | 3 | 1 |
| cli | `packages/cli/src/ui/hooks/useSessionBrowser.ts` | 2 | 1 |
| cli | `packages/cli/src/ui/hooks/useSessionBrowserHelpers.ts` | 13 | 7 |
| cli | `packages/cli/src/ui/hooks/useSessionBrowserKeypress.ts` | 3 | 2 |
| cli | `packages/cli/src/ui/hooks/useSlashCommandProcessorCore.ts` | 13 | 3 |
| cli | `packages/cli/src/ui/hooks/useSlashCompletion.tsx` | 5 | 4 |
| cli | `packages/cli/src/ui/hooks/useToolsDialog.ts` | 3 | 2 |
| cli | `packages/cli/src/ui/hooks/useWelcomeOnboarding.ts` | 3 | 2 |
| cli | `packages/cli/src/ui/layouts/DefaultAppLayout.tsx` | 7 | 10 |
| cli | `packages/cli/src/ui/layouts/DefaultAppLayoutRegions.tsx` | 0 | 5 |
| cli | `packages/cli/src/ui/utils/fuzzyFilter.ts` | 1 | 2 |
| cli | `packages/cli/src/ui/utils/ownerSessionUi.ts` | 0 | 5 |
| cli | `packages/cli/src/ui/utils/resumeOwnerSession.ts` | 1 | 2 |
| core | `packages/core/src/config/toolRegistryFactory.ts` | 4 | 3 |
| core | `packages/core/src/core/subagentTypes.ts` | 1 | 0 |
| core | `packages/core/src/runtime/contracts/RuntimeProviderManager.ts` | 0 | 1 |
| core | `packages/core/src/runtime/providerRequestContext.ts` | 0 | 1 |
| core | `packages/core/src/runtime/providerRuntimeContext.ts` | 3 | 1 |
| core | `packages/core/src/session/session-settings-owner.ts` | 1 | 0 |
| providers | `packages/providers/src/auth/profile-utils.ts` | 1 | 1 |
| providers | `packages/providers/src/composition/headlessFactory.ts` | 5 | 0 |
| providers | `packages/providers/src/composition/providerManagerFactoryOptions.ts` | 1 | 0 |
| providers | `packages/providers/src/composition/providerManagerInstance.ts` | 6 | 4 |
| providers | `packages/providers/src/logging/optionsNormalizer.ts` | 5 | 2 |
| providers | `packages/providers/src/LoggingProviderWrapper.ts` | 2 | 1 |
| providers | `packages/providers/src/ProviderManager.ts` | 22 | 6 |
| providers | `packages/providers/src/runtime/assembleCliProviderRuntime.ts` | 12 | 3 |
| providers | `packages/providers/src/runtime/cliForegroundRuntime.ts` | 2 | 0 |
| providers | `packages/providers/src/runtime/providerMutations.ts` | 1 | 0 |
| providers | `packages/providers/src/runtime/runtimeActivationBindings.ts` | 3 | 1 |
| providers | `packages/providers/src/runtime/runtimeContextFactory.ts` | 23 | 8 |
| providers | `packages/providers/src/runtime/runtimeLifecycle.ts` | 0 | 1 |
| zed-acp | `packages/zed-acp/src/runZedIntegration.ts` | 3 | 0 |
| zed-acp | `packages/zed-acp/src/zed-agent-setup.ts` | 0 | 2 |
| zed-acp | `packages/zed-acp/src/zed-session-agent.ts` | 16 | 2 |
| zed-acp | `packages/zed-acp/src/zed-session-loader.ts` | 0 | 1 |
| zed-acp | `packages/zed-acp/src/zed-session-ports.ts` | 0 | 1 |
| zed-acp | `packages/zed-acp/src/zedIntegration.ts` | 13 | 1 |
