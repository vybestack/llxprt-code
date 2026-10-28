# Port contracts for B6 and B3

This file settles the interface members, caller mappings, ownership and scanner acceptance for the B6 input objects (phase 5) and the B3 collaborators (phase 7). Coders implement these shapes; they do not design new ones. If a listed member turns out not to exist at the time of the task (phases 5 and 6 delete code), the coder drops it and says so in the commit body. Adding a member not listed here needs a handoff.

Every interface below was checked with the real service analyzer at `3984a8773` and passes it as written: each reaches at most one service root, including through the return types of its callable members. The one contract that failed in the previous draft (the child scope factory, whose return exposed `runtimeContext`) now returns a narrow `ChildAgentScope`, and T5.4c makes that change before the contracts that use it. The per-interface results are in "Probe results" at the end of this file.

## Rules every interface here follows

1. Two kinds of input, never mixed in one object:
   - Assembly inputs: things a constructor or factory acquires or takes ownership of once (an authority, a settings factory, a launch record, a scope factory). They are read during construction only and are not stored for later calls.
   - Operational ports: the narrow operations a running object calls later (read a value, run an operation). Each member is a function or a narrow interface named for what it does, not a whole service object.
2. Scanner acceptance without exemptions. The runtime service shape guard (`scripts/tests/runtime-service-shape-guard.ts`) reports an interface, type alias or parameter whose type reaches two or more service roots (`SettingsService`, `RuntimeSettingsState`, `ProviderManager`, `IProviderManager`, `OAuthManager`, `ProfileManager`, `MessageBus`, `AgentClientContract`, `ToolRegistry`, `HistoryService`, listed in `scripts/check-runtime-state-boundary.ts`), including through properties and the return types of function members. Exemptions exist only for `createAgent` and `assembleFacade`. Therefore each object below reaches at most one service root, and that root is named in its row. A collaborator that needs two roots takes them as two separate constructor parameters or, better, as operational ports that return plain values. No new entry is added to `assembly`, `allowances` or any other policy list.
   What the analyzer counts, measured with control probes (see "Probe results"): properties, optional and union members, `Pick<>`, indexed access such as `X['member']`, `typeof fn`, `ReturnType<>` and the return types of methods and function-typed members, including `Promise<T>`. It does not count the parameter types of callable members, and it does not see through tuple element types: a member typed `Parameters<F>[n]` or as an element of a labeled tuple (such as today's `McpRuntimeConstructionInputs`) reaches no root even when its element is a `SettingsService`. Coders therefore write every member below with its named type, never as `Parameters<...>[n]`, so the check is real.
3. Acceptance check per task: after writing the interface and before converting callers, run `cd W && npm run build:types && npm run check:runtime-boundary`; a `runtime-service-bundle` or `runtime-service-bag-parameter` finding on a new name means the split below was not followed. Fix the shape, never the policy. For a shape not yet written in source, the read-only probe in "Probe results" gives the same answer without a build.
4. Receiver binding (B6 only): operational ports are built as arrow functions or `.bind`-free closures over the owning object at the producer (`(x) => owner.op(x)`), so a port called after the producer was replaced reads the current owner only where the row says "late-bound" (the closure reads a field at call time), and reads the captured owner otherwise. The B6 producers (`ChildAgentAssembly`, the session client owner) live as long as the object they feed, so closing over them is correct. B3 has a stricter rule: nothing live closes over an assembly (see "The rule that replaces late-bound closures over the assembly").
5. Lifetime: the producer owns everything it passes unless the row says "transferred". A transfer follows the existing release model ("Release transfer" below): the producer hands over one owned close capability and flips its ownership flag in the same synchronous step; release entries are never removed from or moved between `AcquisitionRelease` scopes.

## B6 inputs (phase 5)

### `CliConfigLoadInput` (T5.3) for `loadCliConfig(input, onReady)`

Service roots reached: `SettingsService` (one). Callers: `cliSessionBootstrap.ts`, `cliSandbox.ts`, 18 test files.

| Member | Type | Kind | From (caller mapping) |
| --- | --- | --- | --- |
| `settings` | `Settings` | assembly | positional 1 |
| `extensions` | `readonly LlxprtExtension[]` | assembly | positional 2 |
| `extensionEnablementManager` | `ExtensionEnablementManager` | assembly | positional 3 |
| `sessionId` | `string` | assembly | positional 4 |
| `argv` | `CliArgs` | assembly | positional 5 |
| `cwd` | `string` (required; callers pass `process.cwd()` explicitly at the CLI entry) | assembly | positional 6 |
| `preflight` | `AgentProfilePreflight` (required) | assembly | positional 7 |
| `settingsOwner` | `SessionSettingsOwner` (required if both production callers pass one; otherwise the task reads it from `preflight` and drops the member, and the commit says which) | assembly | positional 9 |

Deleted, not mapped: positional 8 (`settingsService`), positional 10 (`authority`) and positional 11 (`contributions`). In `config.ts`, `loadCliConfig` passes these three only to `bootstrapAndLoadProfile` (`config.ts:341-349`), and `bootstrapAndLoadProfile` reads them only to build a missing preflight through `prepareRuntimeForProfile` (`config.ts:110-118`). With `preflight` required that branch is deleted, so the three have no reader left. Neither production caller passes `contributions` (`cliSessionBootstrap.ts:140-151` and `cliSandbox.ts:194-205` stop at positional 10), and no registry is created to fill it. What else changes with them: `bootstrapAndLoadProfile` drops the three parameters and takes `preflight: AgentProfilePreflight`; `config.ts` drops the `ProviderContributionRegistry` type import and its `prepareRuntimeForProfile` import (the function stays in `profileBootstrap.ts` for `cli.tsx` and `__tests__/session-client-headless-fixture.ts`); both production callers stop passing positional 8 and 10; test callers that pass any of the three drop them. If the coder finds another reader of any of the three in `config.ts` at task start, stop and report it instead of keeping the member.

The signature is `loadCliConfig(input: CliConfigLoadInput, onReady: CliConfigReadyCallbacks)`: the four ready callbacks (positional 12-15) are operational, so they are the second parameter, not a member of the assembly input. `SessionSettingsOwner` reaches the same root as `SettingsService`, so both fit in one object (probe of the full member list including the owner: `SettingsService` only). The reduced list above is a subset of the probed one, so it reaches no new root; T5.3 re-runs the probe on the declaration it writes.

`CliConfigReadyCallbacks`: `{ activationBootstrap(operation: AgentActivationOperation): void; profileApplication(application: AgentProfileApplication): void; providerSwitch(switchProvider: ProviderSwitcher): void; preflight(operation: AgentProfilePreflight): void }`, all required; a caller that does not need one passes a no-op it names (`ignoreReady`) exported next to the type, so there are no optional callbacks. Probe: no root.

### `SubAgentScope.create` (T5.4a-c): narrow result, then three input objects

`SubAgentScope.create` currently takes 26 positional values and returns `Promise<SubAgentScope>`. The class has a public `readonly runtimeContext: AgentRuntimeContext` constructor property (`core/subagent.ts:151`), and `AgentRuntimeContext` exposes `history: HistoryService`, so `typeof SubAgentScope.create` reaches `HistoryService` through its return (probe `Probe_ScopeFactory_Current`). Combined with anything that reaches another root, it is a bundle; the reviewer's two-member shape (`createChildSettings` plus `scopeFactory`) reproduces as `SettingsService` + `HistoryService`, bundle (`Probe_ReviewerShape_Current`).

#### Returned contract (T5.4c, after T5.4b and before T5.6)

`create` returns `Promise<ChildAgentScope>`, declared in `core/subagentOrchestrator.ts` next to the existing `ChildTaskRun`:

```ts
export interface ChildAgentScope extends ChildTaskRun {
  getAgentId(): string;
  dispose(): Promise<void>;
}
```

`ChildTaskRun` already exists and is what every consumer outside the class reads (`output`, `onMessage`, `onOutputReset`, `runInteractive`, `runNonInteractive`, `cancel`; `SubagentLaunchResult.scope: ChildTaskRun`, used by `task.ts`, `taskAsyncExecution.ts`, `taskStreaming.ts`). The two extra members are the only other operations production uses: `ChildAgentAssembly.assemble` calls `getAgentId()` and registers `dispose()`. T5.4b changes the parameters and keeps the return; T5.4c then changes only the return and exports `SubAgentScopeFactory = (launch: SubAgentLaunchInput, runtime: SubAgentRuntimeInput, operations: SubAgentOperationPorts) => Promise<ChildAgentScope>` next to the input types, which T5.6 uses for `ChildAgentRuntimeFactories.scopeFactory`. Probes: `ChildAgentScope` no root; the narrowed factory no root (`Probe_ScopeFactory_Narrow`); the reviewer's shape with it, `SettingsService` only (`Probe_ReviewerShape_Narrow`).

`runtimeContext` becomes `private readonly`. Its only production reader outside the class is `ChildAgentAssembly.close` (`child-agent-assembly.ts:463-470`), which disposes `firstDefinedHistory(this.loaded.history, this.scope.runtimeContext.history)`. `AgentRuntimeLoaderResult.history` is a required `HistoryService` (`core/runtime/AgentRuntimeLoader.ts:84`) and the scope's context is `this.loaded.runtimeContext`, so the fallback is never taken in production; `close` disposes `this.loaded.history` directly and the `firstDefinedHistory` import goes (the helper stays for `closeSubagentScope`, its other caller). The `scope` field of `ChildAgentAssembly` is typed `ChildAgentScope`.

Test consumers of the wide return, at the starting head (T5.4c's scope; 8 files): `core/__tests__/subagentOrchestrator-runtime.test.ts`, `subagentOrchestrator-runtime.part2.test.ts`, `subagentOrchestrator-loadBalancer.test.ts`, `subagentOrchestrator.isolatedConfigDispose.test.ts`, `subagentOrchestrator-sessionInheritance.test.ts`, `subagentOrchestrator-test-helpers.ts` (these build fake scopes `as unknown as SubAgentScope` with a `runtimeContext` member and, where a fake loader result has no `history`, rely on the fallback), `core/__tests__/subagent.stateless.test.ts` (reads `runtimeContext` from real scopes through `as unknown as` casts), and `tools/taskStreaming.test.ts` (casts a partial fake to `SubAgentScope`). Fakes become typed `ChildAgentScope` objects without casts; a fake loader result that lacked `history` gets the history its scope used to carry, so the disposal assertion still observes the same object. The `subagent.stateless.test.ts` assertions that read the scope's retained runtime (lines 446-451, 479-485, 537-547, 588-598, 641-646, 686-693) are replaced by behavior through `ChildAgentScope` execution, not by assertions on the bundles the fixture builds and freezes (those would pass for a scope that ignored its runtime or shared a history). Each scope is run with `runNonInteractive` against the content generator supplied at creation, which records each request and returns one canned final text response; scopes that check history get a real `HistoryService` through the fixture's `historyService` option instead of the default `vi.fn` history. Replacement tests, by name:

| Replacement test | Replaces (test, lines) | Observation |
| --- | --- | --- |
| `uses the supplied runtime model at the content-generation boundary` | `should construct isolated runtime context with subagent model` (641-646) | the recorded request's `model` is the subagent model, while the foreground Config's model is different and unchanged |
| `sends the supplied runtime state, not the foreground config, to the provider` | `should build runtime context directly without mutating foreground config` (686-693) | the recorded request carries the runtime state's model, its generation parameters (`temperature`, `topP` from the bundle) if the request carries generation parameters at all, and the environment context from the supplied loader; no Config mutator is called |
| `writes each run only to its own supplied history while a second scope is live` | `should allocate isolated history services for each subagent` (537-547) and `should maintain isolated history between subagents` (588-598) | scopes A and B are both created and live, with distinct `HistoryService` instances and distinct prompts; after A runs, then B, A's history holds A's prompt and reply and none of B's, and B's the reverse; A's history is unchanged by B's run |
| `leaves the supplied runtime context and state frozen and unchanged after a run` | `should receive frozen AgentRuntimeContext` (446-451) and `should have frozen runtime state within context` (479-485) | input immutability only: after a run, the supplied context and its `state` are still frozen and their model and provider values are unchanged. This is not counted as runtime-use or history-isolation coverage; the three rows above are |

No cast into private state remains.

#### Input objects (T5.4a helper, T5.4b signature)

It becomes `create(launch: SubAgentLaunchInput, runtime: SubAgentRuntimeInput, operations: SubAgentOperationPorts): Promise<ChildAgentScope>`. Production caller: `ChildAgentAssembly.createScope` (`child-agent-assembly.ts`); 24 test files.

`SubAgentLaunchInput` (assembly, roots reached: none):

| Member | Type | From `createScope` |
| --- | --- | --- |
| `name` | `string` | `this.data.subagent.name` |
| `prompt` | `PromptConfig` | `this.data.prompt` |
| `model` | `ModelConfig` | `this.data.model` |
| `run` | `RunConfig` | `this.data.run` |
| `toolConfig` | `ToolConfig \| undefined` (absent means "all tools"; this is data, not a missing dependency) | `this.data.request.toolConfig` |
| `outputConfig` | `OutputConfig \| undefined` (same reason) | `this.data.request.outputConfig` |
| `parentSignal` | `AbortSignal` (required; the only production caller has one) | `this.data.signal` |

`SubAgentRuntimeInput` (assembly, root reached: `HistoryService` only, through `admittedRuntime.history`; `ToolSelection` reaches no root):

| Member | Type | From `createScope` |
| --- | --- | --- |
| `admittedRuntime` | `AgentRuntimeContext` (required; the runtime check is deleted) | `this.loaded.runtimeContext` |
| `contentGenerator` | `ContentGenerator` (required) | `this.loaded.contentGenerator` |
| `telemetry` | `RootTelemetry` (required) | `this.loaded.telemetryRoot` |
| `toolRegistry` | `ToolSelection` (required) | `this.loaded.toolRegistry` |
| `toolsView` | `ToolRegistryView` (required) | `this.loaded.runtimeContext.tools` |
| `settingsSnapshot` | `ReadonlySettingsSnapshot` (required) | `this.loaded.settingsSnapshot` |
| `foregroundConfig` | `Config` | `this.foregroundConfig` |

`AgentRuntimeContext` reaches exactly one root (`HistoryService`), and no other member of this object reaches any, so `admittedRuntime` stays here. T8.3 narrows `AgentRuntimeContext` for three other consumers later; this object does not depend on that.

`SubAgentOperationPorts` (operational, roots reached: `MessageBus` only):

| Member | Type | From `createScope` | Binding |
| --- | --- | --- | --- |
| `instructions` | `InstructionReadOperations` | `this.instructions` | captured |
| `workspacePaths` | `WorkspacePathOperations` | `this.workspacePaths` | captured |
| `readMcpInstructions` | `() => string \| undefined` | `this.readMcpInstructions` | captured |
| `messageBus` | `MessageBus` | `this.messageBus` | captured |
| `loadEnvironmentContext` | `EnvironmentContextLoader` (required; the default moves to the caller) | the `getEnvironmentContext` closure | late-bound |
| `readApprovalMode` | `() => ApprovalMode` (required) | trust-gated closure | late-bound |
| `admitModelParameters` | `() => AdmittedModelParameters` (required) | load-balancer closure | late-bound |
| `providerFiles` | `ProviderFileLifecycle` (typed by T5.7; until then the existing type) | `this.files` | captured |
| `hooks` | `HookExecutionOwner` (required) | `this.client.hookOperations.execution(...)` | captured |
| `tryBucketFailover` | `ProviderRetryOperations['tryBucketFailover']` | `retry.tryBucketFailover` | captured |
| `readCurrentBucket` | `ProviderRetryOperations['readCurrentBucket']` | `retry.readCurrentBucket` | captured |
| `dependencies` | `SubAgentDependencies` | default `{}` moves to the caller | captured |

Delete: the three runtime "requires" checks in `create`.

Parameters of callable members are not counted, so `SubAgentScopeFactory` itself reaches no root even though its parameters reach `HistoryService` and `MessageBus`; each parameter object is checked on its own.

### `McpRuntimeOwner.create(acquisition, operations)` (T5.5)

The positional tuple `McpRuntimeConstructionInputs` and `selectMcpConstructionInputs` are deleted. Production callers (four, all in `packages/agents/src/api`): `activationPreflightState.ts`, `adopted-agent-assembly.ts`, `mcpOAuthAssembly.ts`, `skill-discovery.ts`. `packages/cli/src/integration-tests/test-utils.ts` is a test caller and moves in T5.5e like the other test callers. Phase 6 deletes the `'caller'` ownership options, so the `*Ownership` members below exist only if production still sets them after T6.D2; T5.5 runs before phase 6, so it keeps them as required members and T6.D2 deletes them. The decisions behind this section, with code references, are in `revision-notes.md` under "Phase 5 inventory decisions".

Every member of both objects is a required key. Where absence is a real composition fact, the value type includes `undefined` and the caller writes `undefined` by name; neither interface has a `?` member, so an omitted member fails to compile. The constructor applies no default for any member except `skillOperations` (unchanged, see the end of this section).

`McpPolicyHandoff` (declared in `mcp-runtime-construction.ts`, the same shape as `MemoryHandoff`): `{ readonly owner: RuntimePolicyOwner; readonly ownership: 'runtime' | 'caller' }`.

`McpRuntimeAcquisition` (assembly, root reached: `MessageBus` only, through `policy.owner`):

| Member | Type |
| --- | --- |
| `oauth` | `McpOAuthBinding` |
| `config` | `Config` |
| `managerFactory` | `typeof McpClientManager` (production passes `McpClientManager`; the constructor's `?? McpClientManager` is deleted) |
| `extensionLoader` | `ExtensionLoader \| undefined` (absence is data: no extensions) |
| `policy` | `McpPolicyHandoff \| undefined` (`undefined`: the runtime builds `new RuntimePolicyOwner(config, trust)`, with its own session bus, and owns it) |
| `lspOwner`, `lspOwnership` | `WorkspaceLspOwner \| undefined`, `'runtime' \| 'caller'` |
| `filesystemOwner`, `filesystemOwnership`, `filesystemService` | `WorkspaceFilesystemOwner \| undefined`, `'runtime' \| 'caller'`, `FileSystemService \| undefined` |
| `memoryOwner` | `MemoryHandoff \| undefined` |
| `definitionOwner`, `definitionOwnership` | `WorkspaceDefinitionOwner \| undefined`, `'runtime' \| 'caller'` |
| `trustPort`, `trustCleanup` | `WorkspaceTrustControlPort \| undefined`, `(() => Promise<void>) \| undefined` |
| `idePort` | `WorkspaceIdePort \| undefined` |

There is no `messageBus` member and no separate `policyOwnership`. The tuple's positions 3 (`messageBus`), 7 (`policyOwner`) and 8 (`policyOwnership`) become `policy`. The bus was read only by the two checks in `constructPolicyOwner` ("requires its explicit runtime owner", "must retain its session MessageBus"); the runtime's bus is always the policy owner's `session.messageBus`, whether handed off or built (`mcpRuntimeAssembly.ts:345`). With the pair as one member neither mismatch can be written, so both checks are deleted. What stays: `constructPolicyOwner(config, policy, trust)` keeps the trust check (`owner.trust !== trust`, because `trustPort` is still its own member), `retainPolicyOwner` owns the owner when `policy === undefined || policy.ownership === 'runtime'`, the authority's trust is `trustPort ?? policy?.owner.trust`, and `retainWorkspaceEnvironment` takes `policy` in place of its `messageBus`, `policyOwner` and `policyOwnership` parameters.

Probe of these 16 members: they are a subset of the 18 probed at `3984a8773` (`MessageBus` only), with the owner moved into one nested object, which the analyzer reads as a property; no new root is possible. T5.5 re-runs the probe on the declaration it writes (rule 3).

`McpRuntimeOperations` (operational, roots reached: none; probe: no root):

| Member | Type |
| --- | --- |
| `emitFeedback` | `HostFeedbackSink` (never `undefined`; see below) |
| `skillOperations` | `WorkspaceSkillAssemblyOperations \| undefined` |
| `mcpSettings` | `SessionMcpSettingsReads \| undefined` (`undefined`: this composition has no settings file; see below) |

`emitFeedback`: the CLI is the only host that supplies a sink (`cliTerminalSession.ts:155-158`). `AgentForegroundHost.mcpHost` and `AgentConfig.mcpHost` are optional public inputs, so each producer decides once, where it reads that input, what no host sink means: `const feedback = <host>?.emitFeedback ?? defaultFeedbackSink` (`@vybestack/llxprt-code-mcp/host/hostServices.js`, debug log only), passed both to `KeychainTokenStorage` and to `operations.emitFeedback`. This is the sink `McpClientManager` and `KeychainTokenStorage` substitute for `undefined` today, so behavior does not change; the difference is that the choice is visible at the caller. `McpRuntimeOwner`'s `feedback` field becomes a required `HostFeedbackSink`.

`mcpSettings`: `SessionSettingsOwner.readMcpSettingsBinding()` returns `SessionMcpSettingsReads | undefined` because only the CLI binds a settings file. Without one the runtime reads its declarations from `Config` and works; `reload()` keeps its rejection "MCP server reload is not available in this composition." (`mcpRuntimeAssembly.ts:651-656`), which reports a capability this composition does not have rather than a missing dependency.

`skillOperations` is not one of the decided items: it stays `| undefined` with the constructor's `?? DEFAULT_SKILL_OPERATIONS`, as at `28094bb75`.

Production caller mapping (T5.5 writes every member at each call; `undefined` and `'runtime'` below are written literally):

| Caller | `policy` | `emitFeedback` | `mcpSettings` | Other members |
| --- | --- | --- | --- | --- |
| `activationPreflightState.ts` `#constructForegroundMcp` | `{ owner: this.foregroundPolicy, ownership: 'caller' }`; if `foregroundPolicy` is `undefined`, throw `Error('Foreground MCP construction requires the preflight policy owner')` before the call. On this path the preflight transfer sets the policy owner and its always-defined bus together (`profile-preflight.ts:92,708-710`), so today `constructPolicyOwner` already rejects an unset owner here. `this.messageBus` is no longer passed. | `this.#foregroundHost.mcpHost?.emitFeedback ?? defaultFeedbackSink` | `this.settingsOwner.readMcpSettingsBinding()` | `managerFactory: McpClientManager`, `extensionLoader: undefined`, `lspOwner: undefined`, `lspOwnership: 'runtime'`, `filesystemService: undefined`, `idePort: undefined`; the rest one to one from today's positions |
| `adopted-agent-assembly.ts` `#adoptConstructMcp(messageBus)` | `this.adoptPolicyOwner === undefined ? undefined : { owner: this.adoptPolicyOwner, ownership: 'caller' }` (today's `runtimeOwnership(this.adoptPolicyOwner === undefined)` gives `'caller'` whenever an owner is given). Before the call, the method keeps today's two checks on its selected `messageBus` with their messages unchanged: a defined bus with no `adoptPolicyOwner` throws "MCP policy handoff requires its explicit runtime owner", and a bus that is not `adoptPolicyOwner.session.messageBus` throws "MCP policy handoff must retain its session MessageBus". Here the bus is chosen from four adoption inputs (`adopted-agent-assembly.ts:195-199`), so this is where a mismatch can originate. T6.D1 deletes the checks together with `adoptMessageBus`/`adoptPolicyOwner` if production still never sets them (none does at `28094bb75`). | `this.adoptMcpHost?.emitFeedback ?? defaultFeedbackSink` (the existing `feedback` local) | `this.adoptSettingsOwner?.readMcpSettingsBinding()` | `managerFactory: McpClientManager`, `extensionLoader: undefined`, `filesystemService: undefined`; the rest one to one |
| `mcpOAuthAssembly.ts` `assembleMcpRuntime` | Its parameters become `(config, options, policy: McpPolicyHandoff \| undefined, settingsOwner?)`: the `messageBus` and `policyOwnership` parameters are deleted and `policy` is passed through. `policyComposition.ts` `assembleOwnedMcpRuntime(config, options, policy, settingsOwner)` drops its `bus` parameter and passes `{ owner: policy, ownership: 'runtime' }`; `agentRuntimeAssembly.ts:422` stops passing `this.policyOwner.session.messageBus`; the one test caller, `__tests__/fromConfig-bootstrap-failure.behavior.test.ts:246`, passes `(optionsConfig, {}, undefined, optionsSettingsOwner)`. | `options.mcpHost?.emitFeedback ?? defaultFeedbackSink` (the existing `feedback` local) | `settingsOwner?.readMcpSettingsBinding()` | `managerFactory: McpClientManager`, `extensionLoader: undefined`, `skillOperations: undefined`; the rest one to one |
| `skill-discovery.ts` `discoverAgentSkills` | `undefined` (declarative listing; no session, no bus) | `defaultFeedbackSink` | `undefined` | `oauth: host.oauth`, `config`, `managerFactory: McpClientManager`, every owner, port and cleanup `undefined`, every `*Ownership` `'runtime'`, `skillOperations: undefined` |

Test callers (T5.5a-e): `packages/agents/src/api/__tests__/helpers/create-mcp-runtime.ts`, `createTestMcpRuntime(acquisition: McpRuntimeTestAcquisition, operations: McpRuntimeTestOperations)`, is the only test code in the repository that calls `McpRuntimeOwner.create` and the only code that applies test defaults. The two test types have the real member names and types with every member optional except `oauth` and `config`; one function in the helper fills each omitted member with today's constructor default (`managerFactory: McpClientManager`, `policy: undefined`, each `*Ownership` from `defaultWorkspaceOwnership(owner)`, `emitFeedback: defaultFeedbackSink`, every other member `undefined`). Until T5.5 it calls the positional `create`, mapping `policy` to positions 3 (`policy.owner.session.messageBus`), 7 and 8; T5.5 redeclares the two test types from the real ones (every member optional except `oauth` and `config`) and passes the filled objects straight to `McpRuntimeOwner.create(acquisition, operations)`. Routing:

- `helpers/mcp-owner-fixture.ts` `buildTestMcpRuntime` keeps its six-parameter signature (165 importing files and 209 calls, none edited). Its body builds the two test objects from its `Partial<AgentConfig>` overrides and calls `createTestMcpRuntime`, with `policy: { owner: policyOwner, ownership: 'runtime' }`. Every one of the 209 calls passes a policy owner and that owner's bus (AST scan at `28094bb75`), so its `policyOwner` parameter becomes required and `extensionLoader` becomes `ExtensionLoader | undefined` with no caller edit. Its `messageBus` parameter, now read by nothing else, is compared with `policyOwner.session.messageBus` and the fixture throws on a mismatch, as `create` does today.
- `helpers/async-child-disposal-join-fixture.ts` and `core/__tests__/subagent-test-helpers.ts` call `createTestMcpRuntime`.
- cli has no helper of its own: `integration-tests/test-utils.ts`, `__tests__/stream-media-fixture.ts`, `services/workspace-mcp-consumers.test.ts` and `ui/cliUiRuntime.agentClientSource.test.ts` import `createTestMcpRuntime` from the agents helper by relative path, as ten cli fixtures already import agents `__tests__` helpers. So T5.5 edits no cli file.

T5.5 is one atomic commit: the signature change, the four production callers and the helper body land together, after the test callers have moved through the `T5.5-inv` batches.

### `SessionToolCatalogOwner.initialize(workspace, session)` (T5.6)

`WorkspaceToolPorts` (operational, roots reached: none; probe: no root): `isWorkspaceStopped(): boolean`, `paths: WorkspacePathOperations`, `files: WorkspaceTextOperations`, `ignore: WorkspaceIgnoreOperations`, `scans: WorkspaceScanOperations`, `diagnostics: ILspService | undefined`, `ide: WorkspaceIdePort`, `trust: WorkspaceTrustControlPort`, `workspaceSelection: ToolSelection`, `profiles: ProfileDefinitionReads`, `subagents: SubagentDefinitionReads`, mapped one to one from positional 1-9, 15, 16.

`SessionToolPorts` (operational, root reached: `MessageBus` only; probe: `MessageBus` only): `readMcpInstructions(): string | undefined`, `bus: MessageBus`, `registration: TaskToolRegistration`, `summarize: ToolOutputSummarizer` (export the existing local type from `toolRegistryFactory.ts` instead of writing `Parameters<typeof createToolRegistry>[9]`, which the analyzer cannot see), `approval: McpApprovalPolicy`, `telemetry: RootTelemetry` (required if the only production caller, `session-client-owner.ts` line 362, always passes it; otherwise it stays `| undefined` and the commit says why), mapped from positional 10-14 and 17.

### `ChildAgentAssembly(launch, acquisition, factories, clientFactory, operations)` (T5.6)

Production caller: `session-client-owner.ts` (`new ChildAgentAssembly(`).

The earlier draft grouped six construction inputs into one `ChildAgentAcquisition`. The real analyzer reports that object as a bundle reaching `AgentClientContract`, `HistoryService` and `SettingsService` (`Probe_ChildAgentAcquisition_Draft`), and the reviewer's two-member reduction as `SettingsService` + `HistoryService` (`Probe_ReviewerShape_Current`, reproduced). The roots arrive through callable returns: `createChildSettings` returns a `SettingsService`; `scopeFactory` (`typeof SubAgentScope.create`) returns a `SubAgentScope` whose public `runtimeContext` exposes `history`; `runtimeLoader` (`typeof loadAgentRuntime`) returns a result with `history: HistoryService`; `clientFactory` (`AgentClientFactory`) returns an `AgentClientContract`.

Two changes fix it. First, T5.4c (after T5.4b, before this task) gives the scope factory the narrow returned contract `ChildAgentScope` (launch, run, cancel and dispose operations; no `runtimeContext`), so `scopeFactory` reaches no root and `ChildAgentAssembly` no longer holds or returns an object that exposes the child's history. Second, the remaining roots are split into separate constructor parameters, because the runtime loader (`HistoryService`) and the client factory (`AgentClientContract`) reach one root each and cannot share an object (`Probe_ChildAgentFactories_WithClient`: bundle). Each parameter below was probed with exactly these members:

`ChildAgentLaunch` (parameter 1) stays as is (the launch record). Probe: no root.

`ChildAgentAcquisition` (parameter 2, assembly; probe: `SettingsService` only):

| Member | Type |
| --- | --- |
| `authority` | `CredentialAuthority` (required at construction; the late check at launch is deleted) |
| `createChildSettings` | `() => SettingsService` |
| `foregroundConfig` | `Config` |

`ChildAgentRuntimeFactories` (parameter 3, assembly; probe: `HistoryService` only, through `runtimeLoader`):

| Member | Type |
| --- | --- |
| `runtimeLoader` | `typeof loadAgentRuntime` |
| `scopeFactory` | `SubAgentScopeFactory` (T5.4b's three-object signature, returning `Promise<ChildAgentScope>` from T5.4c; production passes `SubAgentScope.create.bind(SubAgentScope)` as today) |

`clientFactory` (parameter 4, assembly): `AgentClientFactory`, required (production passes the default factory explicitly). Probe: `AgentClientContract` only. It is its own parameter because no other input shares its root.

`ChildAgentOperations` (parameter 5, operational; probe: `MessageBus` only):

| Member | Type |
| --- | --- |
| `messageBus` | `MessageBus` |
| `requestInteractiveAuth` | `InteractiveAuthPromptOperation \| undefined` (absent means non-interactive host; data, not a missing dependency) |
| `profileReads` | `Pick<ProfileDefinitionReads, 'loadProfile'>` |
| `subagentReads` | `Pick<SubagentDefinitionReads, 'loadSubagent' \| 'listSubagents'>` |
| `telemetry` | `RootTelemetry` (required if the producer always has one) |
| `instructions` | `InstructionReadOperations` |
| `workspacePaths` | `WorkspacePathOperations` |
| `readMcpInstructions` | `() => string \| undefined` |
| `trust` | `WorkspaceTrustControlPort` (required if the producer always has one; otherwise the commit says why) |
| `tools` | `ToolSelection` (same rule) |
| `hooks` | `SessionHookOwner` (same rule) |

The probe was run on these exact member lists with `required` types; a control shows `| undefined` and optional members reach the same roots, so the conditional "required if" choices above do not change any result.

## B3 collaborators (phase 7)

Verdict: the live agent is built from persistent operational owners by a module-level function, so no live control can close over an assembly. The previous draft's late-bound closures over the assembly are gone. Every operation the moved bodies call is listed below with the owner that holds it after construction and the view member that exposes it. A garbage-collection test and a structural test check that the assembly is unreachable from the agent.

### The rule: live controls close over persistent owners, built outside the assembly

The assembly is a construction-time object. After publication nothing the live agent holds may reach it: no port, control, release entry or `AgentImpl` member may be a closure over an assembly instance (`ForegroundAssembly`, `PreferredAgentAssembly`, `AdoptedAgentAssembly`, `AgentActivationBootstrap`), and no assembly method or instance arrow field is passed to the live graph.

Avoiding `this` inside the closures is not enough. Measured with Bun 1.4.4 (`W/tmp/pr3911-plan/gc-probe2.ts`): a closure that mentions only a local still keeps the instance alive when a sibling closure created in the same method mentions `this`, because both share the method's captured scope. So the live graph is built in module-level functions whose parameters are owner values, never inside an assembly method:

- `publishAgentFacade(owners, controls, settings, providers, auth): Agent` in `packages/agents/src/api/agent-facade.ts` (the file T7.3 creates) builds the coordinator, `SessionProviderControl`, every control, `AgentOperations` and the `AgentImpl`. It replaces the `initializeFacade()`/`publishFacade()` methods.
- Each leaf gets one module-level `facadeInputsFor<Leaf>(...)` function in its own file that takes the leaf's acquired owners as parameters and returns the five records. The leaf's method calls it with field values (`facadeInputsForPreferred(this.preferredSessionClient, this.mcpRuntime, ...)`) and then calls `publishAgentFacade`. Field reads at the call site are evaluated once; no closure is created in the method.
- Release entries whose scope becomes the agent's `closeRuntime` are registered from module-level helpers for the same reason (most already close over locals; the test below shows which ones still share a method scope with a `this` closure).

Late binding (inventory note 5) is replaced by construction order: `publishAgentFacade` runs after every owner exists, so its closures capture owners directly.

### Persistent operational owners

Owners that exist before publication (all exist at the starting head):

| Owner | Type (file) | Mutable state it holds after construction | Root (probe) |
| --- | --- | --- | --- |
| session client owner | `SessionClientOwner` (`session/session-client-owner.ts`) | client, execution loop, hook operations and hook release, auxiliary work, conversation, tool catalog, bucket consent | none |
| settings owner | `SessionSettingsOwner` (core) | session overrides, named and user parameters, tool format, selected provider and model, model subscriptions | `SettingsService` |
| settings service | `SettingsService` | provider and global settings | `SettingsService` |
| provider manager | `RuntimeProviderManager` (core contract) | active provider, provider registry, metrics | none |
| OAuth manager | `OAuthManager` | auth flights, token state | `OAuthManager` |
| MCP runtime | `McpRuntimeOwner` | MCP connections, discovery, workspace trust and IDE ports | `MessageBus` |
| task and shell owners | `TaskLaunchOwner`, `ShellJobOwner` | launched tasks, shell jobs, session admission | none |
| media owner | `SessionMediaOwner \| undefined` | session media | none |
| auth state | `AgentAuthState` (`control/authState.ts`, from `createAgentAuthState()` in the leaf) | key file, raw and inline key presence, base URL, OAuth enabled set, MCP auth set | none |
| ownership record | `OwnershipRecord` (`agentBootstrap.ts`, from `recordOwnership()` in the leaf) | `disposed`, session locks, LSP and extension flags, scheduler handles, `disposeMcpRuntime` | none |
| runtime state | `AgentRuntimeState` (from `buildFacadeState()`) | read once to seed provider state | none |
| release capability | `closeRuntime: () => Promise<void> \| void` | closes the leaf's release scope (preferred: its `AcquisitionRelease` plus inherited trust rollback; adopted: its `adoptRelease`; preflight path: the preflight's release capability) | n/a (function) |

Owners created by `publishAgentFacade` and held by the agent for its whole life:

| Owner | Mutable state | Root (probe) |
| --- | --- | --- |
| `AgentExecutionCoordinator` (created first; today a field initializer of `SessionProviderOwner`) | active run, commit and settings admission, busy state | none |
| `SessionProviderControl` (below) | provider state (`AgentProviderState`: provider, model, model params, base URL, key name, load-balancer flag), the provider switcher, `ProfilesControl`, `AuthControl`, the OpenAI provider identity cache | public surface: none |
| `ToolControl`, `SessionControl`, `HookControl`, `PolicyControl`, `TasksControl`, `SkillsControl`, `AgentMemoryControl` (existing controls, same builders) | listeners, recording and session identity, hook session state | none each |
| profile persistence (`assembleProfilePersistence`) | admission and in-flight writes | none |
| `AgentOperations` (below) | none of its own; holds the three records | none |

### Every operation the moved bodies use, and its owner after construction

From `foreground-agent-assembly.ts` (`injectSteer` 448, `stream` 458-479, `getApprovalMode`/`setApprovalMode` 487-505, `resetChat` 513, `compress` 530, `generate` 551-565, `generateJson` 576, `generateEmbedding` 597, `listProviders` 607, `rebuild` 619, disposal 658-750, `initializeFacade` 751, `publishFacade` 784-835) and `session-provider-reads.ts` (field initializers 212-256, `constructProfiles` 258-309, `constructProviderSwitch` 311-328, `prepareReplacement` 330-350, `buildAuthControl` 368-415, `setProvider` 440, `setModel` 479, and the read members after them) at the starting head:

| Operation | Moved bodies that use it | Owner after construction | View member |
| --- | --- | --- | --- |
| provider admission: `assembleDirectProviderAdmission(settingsService, providers, getModel).admit()` | `stream`, `generate` | settings service and provider manager; the helper holds no state (`directProviderAdmission.ts:34-43`), so one instance is built in `publishAgentFacade` instead of one per call | `AgentTurnOwners.providerAdmission` |
| readiness: `isProviderReady()` (`ownership.disposed`, `providers.hasActiveProvider()`) | `stream`, `generate`, `generateJson`, `generateEmbedding`, `compress`, `setModel` | `SessionProviderControl` (reads the ownership record and provider manager) | `AgentTurnOwners.providers.isProviderReady` |
| recording: `createRecordingExecution(sessionControl, readHookSessionId, session.hookOperations)` | `stream`, `generate` (session id read through `sessionControl.getSessionId`), `compress` (`compressHistory(id, sessionControl, hookOperations)`), `resetChat` (`resetIdleChat(coordinator, sessionControl, ...)`) | `SessionControl` (recording, session id) and the session client owner (hook operations); `readHookSessionId` becomes `() => recording.getSessionId()` built in `AgentOperations` | `AgentTurnOwners.recording`, `AgentTurnOwners.session` |
| hook ownership: `session.hookOperations`, `session.createHookControl(sessionControl)`, `session.transferHookRelease()` once at publication, `session.closeHookAdmission()`, `hooks.finishSessionEnd()`, `hooks.detach()` | turn recording, `initializeFacade`, disposal | session client owner; `HookControl`; the transferred `releaseHooks` capability | `AgentTurnOwners.session`, `AgentDisposalOwners.hooks`, `.releaseHooks` |
| profile admission: `profiles.isApplying()`, `assertProfileIdle()` (`coordinator.assertNoCommit()` plus `isApplying`), `profiles.cancelAndJoin()` | `stream`, `resetChat`, `setProvider`, `setModel`, settings and tool-format controls, new-session admission, disposal | `ProfilesControl`, owned by `SessionProviderControl` | `AgentTurnOwners.profiles`, `.providers.assertProfileIdle`, `AgentDisposalOwners.profiles` |
| coordinator admission and release: `admit(run)`, `release(run)`, `current()`, `assertNoCommit()`, `assertSettingsAdmission()`, `assertIdle()`, `closeAdmission()`, `dispose()` | `stream`, `injectSteer`, `resetChat`, profile replacement, `setProvider`/`setModel` busy checks, provider-file admission, session control, disposal | `AgentExecutionCoordinator` | `AgentTurnOwners.coordinator`, `SessionProviderContext.coordinator`, `AgentDisposalOwners.coordinator` |
| execution resolution: `session.resolveExecution()`, `rebuildExecution()`, `isCurrentExecution()`, `prepareProfileExecution()`, `restoreChatVisibility()`, `abortExecution()` | `stream`, `rebuild`, profile replacement, provider switch, disposal | session client owner | `AgentTurnOwners.session`, `SessionProviderControl`'s `session` parameter, `AgentDisposalOwners.session` |
| MCP discovery: `awaitDiscovery()` (adopted path: behind `ownership.disposed`) | `stream` | MCP runtime; the closure is built by `facadeInputsFor<Leaf>` from the MCP runtime and the ownership record | `AgentTurnOwners.awaitMcpDiscovery`, `AgentFacadeOwners.awaitMcpDiscovery` |
| tool notifications: `notifyConfirmation`, `notifyToolUpdate` | `stream` | `ToolControl` | `AgentTurnOwners.tools` |
| side generation: `generateText`, `generateJson` (default model `getModel()`), `generateEmbedding`, `compressHistory`, `conversation.resetChat` | `generate`, `generateJson`, `generateEmbedding`, `compress`, `resetChat` | session client owner; model read from `SessionProviderControl` | `AgentTurnOwners.session`, `.providers.getModel` |
| profile preparation: `assembleProfileApplication(settingsService, providers, oauth, deferred switch, settingsOwner, workspace.profileDefinitions, prepare, coordinator.assertIdle)`, `prepareReplacement` (`coordinator.current()`, `session.isCurrentExecution`, `session.prepareProfileExecution`), `captureUserParameters()`, `config.getTargetDir()` | `constructProfiles` | `SessionProviderControl` builds and holds the `ProfilesControl` | constructor parameters `settings`, `providers`, `oauth`, `session`, `context.workspace`, `context.coordinator`, `context.config` |
| profile publication: the `publish` step calls `replacement.publish()` (session execution swap) and writes provider state (provider, model, model params, base URL, key name, load-balancer flag) and auth state (key file, raw and inline key presence, base URL) | `constructProfiles` publish callback | provider state is a private field of `SessionProviderControl`; auth state is the `AgentAuthState` owner | `SessionProviderContext.authState` |
| provider switching: `assembleProviderSwitch(config, settingsService, providers, oauth, readRuntimeKind, session.refreshAuth, settingsOwner)`; `applyFacadeProviderSwitch(..., providerState, switchProvider, selectModel, refreshAuth, restoreChatVisibility, rebuild)`; `setModel` (`selectModel`, `refreshAuth`, `restoreChatVisibility`, `rebuild`, `providerState.model`) | `setProvider`, `setModel`, profile application (deferred switch) | `SessionProviderControl`; mutates the provider manager's active provider, settings service, settings owner and provider state | `SessionProviderControlSurface.setProvider`, `.setModel`, `.switchProvider`; `SessionProviderContext.readRuntimeKind`, `.selectModel` |
| model selection: `setActiveModel(model, assembleModelSelection(settingsOwner), settingsService, providers.getActiveProvider())` (today the per-leaf `selectOwnerModel` arrow over `this`) | `setModel`, provider switch | free function `selectOwnerModel(settingsOwner, settingsService, providers)` extracted in T7.1; `facadeInputsFor<Leaf>` passes `(model) => selectOwnerModel(owner, service, providers)` | `SessionProviderContext.selectModel` |
| provider and auth mutation: `AuthControl` (auth state, `providerState.keyName`, `applyFacadeAuthBaseUrl` through `settingsOwner.writeUserParameter` and the settings service, `updateActiveProviderApiKey` on `providers.getActiveProvider()` gated by `coordinator.assertSettingsAdmission()`, OAuth reads `isOAuthEnabled`, `isAuthenticated`, `peekStoredToken`, `getHigherPriorityAuth`, `getAuthStatusWithBuckets`, bucket consent through the session owner); `authentication` (`assembleSessionAuthentication(oauth, provider => clearProviderAuthenticationCache(providers.getProviderByName(provider)))`) | `buildAuthControl`, the leaf's `#authentication` | `SessionProviderControl` builds and holds `AuthControl`; `authentication` is built by `facadeInputsFor<Leaf>` from the OAuth manager and provider manager | `SessionProviderControlSurface.auth`, `AgentFacadeControls.authentication` |
| settings, model-parameter and tool-format controls (today field initializers of `SessionProviderOwner`, closures over `this`) | `AgentImpl.settings`, `.modelParameters`, `.toolFormat` | `SessionProviderControl` (settings owner, settings service, provider manager, provider state, coordinator) | `SessionProviderControlSurface.settings`, `.modelParameters`, `.toolFormat` |
| provider reads (`providerReads`, `getModel`, `getProvider`, `getProviderStatus`, `getModelParams`, `hasActiveProvider`, `getProviderContextLimit`, `listAvailableModels`, `listProviders`) | `AgentImpl` read members | `SessionProviderControl` | `SessionProviderControlSurface` |
| session client operations: `idleClient(session.operations, coordinator, () => session.rebuildExecution())` | `AgentImpl.sessionClient` | session client owner and coordinator | built in `publishAgentFacade` |
| profile persistence: `assembleProfilePersistence(() => config.getModel(), () => config.getProvider(), settingsService, providers, () => settingsOwner.captureNamedParameters(), workspace.profileWrites)` | six `AgentImpl` profile members, disposal | profile persistence owner | built in `publishAgentFacade`; `AgentDisposalOwners.profilePersistence` |
| approval: `ide.isTrustedFolder()`, `config.getApprovalMode()`, `config.setApprovalMode()` | `getApprovalMode`, `setApprovalMode` | `IdeControl` and `Config` | `AgentApprovalOwner` |
| disposal sequence | `disposeAgent` | the owners in `AgentDisposalOwners` | `AgentDisposalOwners` |

Closures in the leaves' facade records that capture `this` at the starting head, each replaced by a value built in `facadeInputsFor<Leaf>`:

| Leaf | Closure today | Replacement |
| --- | --- | --- |
| foreground (`foreground-agent-assembly.ts` 246-307) | `runtimeHandle.cleanup` and `closeRuntime`: `() => this.releaseForegroundProviders()`; `facadeRuntimeKind`: `() => this.config.isInteractive() ? ...`; `selectOwnerModel`: `(m) => this.#selectModel(m)`; `authentication`: `#authentication()` over `this.foregroundManager`; MCP `refreshTools`: `() => this.ownedSessionClient.refreshToolDefinitions()` | the preflight's release capability passed by value; `() => config.isInteractive() ? ...` over the `config` parameter; `selectOwnerModel(...)` over owners; `authentication` over the OAuth and provider managers; `() => session.refreshToolDefinitions()` over the session parameter |
| adopted (`adopted-agent-assembly.ts` 326-388 at `edbcb0e8f`; 643-704 at `3984a8773`) | `awaitMcpDiscovery` (reads `this.adoptMcp`), `closeMcpAdmission`: `() => this.adoptMcp.closeAdmission()` (the `#adoptCloseMcpAdmission` method and its two ownership booleans are gone since phase 6), `closeRuntime` and `runtimeHandle.cleanup`: `() => this.adoptRelease.close()`, `selectOwnerModel`, `authentication`, MCP `refreshTools` | closures over the MCP runtime, definition owner, ownership record and the `adoptRelease` scope passed as parameters |
| preferred (`agentRuntimeAssembly.ts` 609-670 at `edbcb0e8f`; 700-744 at `3984a8773`) | `runtimeHandle.cleanup` and `closeRuntime`: `() => this.releaseProviders()` (reads `this.release`, `this.inheritedTrustRelease`), `disposeMcpRuntime`, `awaitMcpDiscovery`, `closeMcpAdmission` over `this.mcpRuntime`, `selectOwnerModel`, `#authentication`, `#constructMcpControl` | closures over the two release scopes and the MCP runtime passed as parameters |

### `SessionProviderControl` (T7.1), replaces `SessionProviderOwner`

Renamed from the earlier draft's `SessionProviderReads` (an existing interface name in the same file), because it mutates provider, auth and profile state. Constructed once by `publishAgentFacade`:

`new SessionProviderControl(settings: ProviderControlSettings, providers: RuntimeProviderManager, oauth: OAuthManager, session: SessionClientOwner, context: SessionProviderContext)`

| Parameter | Members | Root (probe) |
| --- | --- | --- |
| `ProviderControlSettings` | `settingsOwner: SessionSettingsOwner`, `settingsService: SettingsService` | `SettingsService` |
| `providers` | `RuntimeProviderManager` | none |
| `oauth` | `OAuthManager` | `OAuthManager` |
| `session` | `SessionClientOwner` | none |
| `SessionProviderContext` | `config: Config`, `authState: AgentAuthState`, `ownership: OwnershipRecord`, `runtimeState: AgentRuntimeState` (seeds provider state), `initialAuth: AgentAuth \| undefined`, `onOAuthPrompt: unknown` (narrowed by the existing `isOAuthPromptHandler`), `coordinator: AgentExecutionCoordinator`, `workspace: WorkspaceControl` (profile definitions), `readRuntimeKind(): RuntimeKind`, `selectModel(model: string): Promise<void>` | none |

`providerReads` is built by the module-level `createSessionProviderReads(settingsOwner, providers, readConfiguredModel, readProviderSettings): SessionProviderReads` in `session-provider-reads.ts` (T7.1, decision D5 in `inventory-phase7.md`), which runs the four `requireProviderOwner` guards first and closes over its four parameters only; the control calls it once with its own private readers, and the test helper `ProviderReadFixture` calls it from its unchanged constructor.

Public surface (`SessionProviderControlSurface`, what `publishAgentFacade` and `AgentOperations` read; probe: no root): `providerReads: SessionProviderReads`, `modelParameters`, `settings`, `toolFormat`, `execution` (the coordinator), `profiles: ProfilesControl`, `auth: AuthControl`, `switchProvider: ProviderSwitcher`, `getProvider`, `getProviderStatus`, `getModel`, `getModelParams`, `hasActiveProvider`, `getProviderContextLimit`, `listAvailableModels`, `setProvider`, `setModel`, `listProviders` (each typed `Agent['<name>']`), `isProviderReady(): boolean`, `assertProfileIdle(): void`, `readProviderName(): string`. Everything else is private, including provider state.

`rebuild` is `() => session.rebuildExecution()`, exactly the foreground's current body (`foreground-agent-assembly.ts:619-620`).

Callers that need model selection before publication (at the starting head the leaves' construction, through `selectOwnerModel`) call the free function directly. If the refreshed inventory (T7.0) shows another pre-publication caller, T7.0 lists it and T7.1 extracts it the same way; none of these free functions is stored on an assembly.

### `AgentOperations` (T7.2a-c)

Built once by `publishAgentFacade`, after `SessionProviderControl`. Its methods are what `AgentImpl` receives (arrow fields or `.bind` on the `AgentOperations` instance, never on an assembly):

`new AgentOperations(turns: AgentTurnOwners, approval: AgentApprovalOwner, disposal: AgentDisposalOwners)`

`AgentTurnOwners` (probe: no root):

| Member | Type | Used by |
| --- | --- | --- |
| `session` | `SessionClientOwner` | all seven turn methods |
| `coordinator` | `AgentExecutionCoordinator` | `stream` (`admit`, `release`), `injectSteer` (`current()?.loop`), `resetChat` (`resetIdleChat`) |
| `providerAdmission` | `DirectProviderAdmission` | `stream`, `generate` |
| `recording` | `SessionControl` | `stream`, `generate`, `compress`, `resetChat` |
| `profiles` | `Pick<ProfilesControl, 'isApplying'>` | `stream` |
| `providers` | `Pick<SessionProviderControlSurface, 'isProviderReady' \| 'assertProfileIdle' \| 'getModel'>` | readiness checks, `resetChat`, `generateJson` default model, provider admission |
| `awaitMcpDiscovery` | `AgentMcpOperations['awaitDiscovery']` | `stream` |
| `tools` | `Pick<ToolControl, 'notifyConfirmation' \| 'notifyToolUpdate'>` | `stream` |

`AgentApprovalOwner` (`getApprovalMode`, `setApprovalMode`; probe: no root): `{ isTrustedFolder(): boolean; readApprovalMode(): ApprovalMode; writeApprovalMode(mode: ApprovalMode): void }`, built in `publishAgentFacade` from the `IdeControl` and `Config` parameters. `listProviders` moves to `SessionProviderControl` (it reads only the provider manager).

`AgentDisposalOwners` (the existing `disposeAgent` sequence, moved unchanged in order in T7.2c; probe: no root):

| Member | Type | Steps that use it |
| --- | --- | --- |
| `ownership` | `OwnershipRecord` | `disposed`, `disposeMcpRuntime`, scheduler handles, config ownership, LSP and extension flags, session locks |
| `session` | `SessionClientOwner` | `closeAdmission`, `closeHookAdmission`, `joinAuxiliaryShutdown`, `closeImageAdmission`, `toolCatalog.closeAdmission`, `abortExecution`, `dispose` |
| `coordinator` | `AgentExecutionCoordinator` | captured active run, `dispose` |
| `tasks`, `shell` | `TaskLaunchOwner`, `ShellJobOwner` | admission close, abort, join, dispose |
| `hooks`, `releaseHooks` | `HookControl`, `() => Promise<void>` | admission close, session end, detach, hook release |
| `profilePersistence` | `{ closeAdmission(): void; join(): Promise<void> }` | admission close, join |
| `closeMcpAdmission` | `() => void` | admission close |
| `skills`, `workspace`, `sessionControl`, `ide`, `tools`, `profiles`, `mcp` | the existing controls | admission close, dispose, cancel and join |
| `closeRuntime` | `() => Promise<void> \| void` | provider release |
| `disposeConfig` | `() => Promise<void>` (closure over `config`, omitted when config ownership is `'caller'`) | config disposal |
| `media` | `SessionMediaOwner \| undefined` | media disposal |
| `disposeOAuth` | `() => Promise<void>` (closure over the OAuth manager: `disposeOAuthManager(oauth)`) | last step |

`disposeOAuth` is a capability rather than the `OAuthManager` object; with the object the record still reaches only `OAuthManager` (`Probe_AgentDisposalOwners_WithOAuthObject`), but the capability keeps disposal from depending on the manager's surface.

### `publishAgentFacade` inputs (T7.3, T7.4), replace `AgentFacadeInput`

The three leaves assign these members before `initializeFacade()`: 29 in the foreground leaf, 28 in the adopted leaf (it never writes `onOAuthPrompt`) and 29 in the preferred leaf (inventory note 1, at `edbcb0e8f`; the first inventory copy said 20). They become five records returned by `facadeInputsFor<Leaf>` and passed to `publishAgentFacade(owners, controls, settings, providers, auth)`; nothing keeps them after the call. Probe of each with exactly these members:

| Parameter | Members | Root (probe) |
| --- | --- | --- |
| `AgentFacadeOwners` | `session: SessionClientOwner`, `media: SessionMediaOwner \| undefined`, `tasks: TaskLaunchOwner`, `shell: ShellJobOwner`, `workspaceSkills: WorkspaceSkillOperations`, `mcpRuntime: McpRuntimeOwner`, `config: Config`, `readRuntimeKind(): RuntimeKind`, `runtimeId: string`, `runtimeState: AgentRuntimeState`, `ownership: OwnershipRecord`, `sessionIdentityOwnership: 'config' \| 'facade'`, `initialAuth: AgentAuth \| undefined`, `onOAuthPrompt: unknown`, `closeRuntime(): Promise<void> \| void`, `awaitMcpDiscovery(): Promise<ReadonlyMap<string, string>>`, `closeMcpAdmission(): void`, `selectModel(model: string): Promise<void>` | `MessageBus` (through `mcpRuntime`) |
| `AgentFacadeControls` | `workspace: WorkspaceControl`, `ide: IdeControl`, `lsp: LspControl`, `mcp: McpControl`, `editors: { editorCallbacks: EditorCallbacks }`, `display: StableDisplayCallbacksHolder`, `childDisplay: ChildToolDisplay \| undefined`, `authentication: Agent['authentication']`, `authState: AgentAuthState` | none |
| `AgentFacadeSettings` | `settingsOwner: SessionSettingsOwner`, `settingsService: SettingsService` | `SettingsService` |
| `AgentFacadeProviders` | `providers: RuntimeProviderManager` | none |
| `AgentFacadeAuth` | `oauth: OAuthManager` | `OAuthManager` |

`mcpRuntime` is in the owners record only so `publishAgentFacade` can read `workspaceSkills` and the subagent and profile definitions through `WorkspaceControl`; no live closure reads it except `awaitMcpDiscovery` and `closeMcpAdmission`, which the leaf builds. T7.4 re-runs the probe on the declarations it writes; a record reported as a bundle is split further, never exempted.

### Reachability acceptance (written in T7.4, completed in T7.7b, required in T7.8 and the phase 7 checkpoint)

Two checks. T7.4 writes both first and records them failing on its starting tree; each path's case is committed in the first task that makes it pass (preferred path in T7.4, adopted and preflight paths by T7.7b at the latest); T7.8 and the phase 7 checkpoint require all of them green.

1. Garbage-collection test, new `packages/agents/src/api/__tests__/assembly-unreachable.behavior.test.ts`. The mechanism was checked on the installed Bun (`W/tmp/pr3911-plan/gc-probe.ts`): a `WeakRef` to an object reachable only through a closure stays set after `Bun.gc(true)`, and clears once nothing holds it; `Bun.generateHeapSnapshot()` lists user class names. The test uses no test-only input:
   - Preferred path: the test does exactly what `createAgent` does (`new PreferredAgentAssembly(config, [], undefined)`, then `.assemble()`), keeps `const ref = new WeakRef(assembly)`, drops its `assembly` binding and keeps only the `agent`.
   - Adopted path (`fromConfig`) and preflight path (`AgentProfilePreflight` through `createForegroundAgent`, preflight reference dropped after transfer): the assembly instances are created inside production code, so the test counts heap-snapshot nodes whose class name is `ForegroundAssembly`, `PreferredAgentAssembly`, `AdoptedAgentAssembly` or `AgentActivationBootstrap`.
   - For each path: run one `agent.stream` turn against the fake provider so every lazy control is built; drop the other references; `Bun.gc(true)`, `await` a macrotask, `Bun.gc(true)`; assert `ref.deref() === undefined` and a zero count while `agent` is alive; then run a second `agent.stream` turn and `agent.dispose()` to show the agent still works.
   - Controls in the same file: a `WeakRef` to an object the test keeps referenced stays set, and the snapshot count sees at least one `AgentImpl` while `agent` is alive. Without them a passing assertion proves nothing.
2. Structural rule, new `scripts/tests/assembly-closure-guard.test.ts` (TypeScript AST and checker over the agents program, no exclusions). It fails when (a) `publishAgentFacade` or any `facadeInputsFor*` function is declared inside a class instead of at module level; or (b) any argument to `publishAgentFacade`, a `facadeInputsFor*` call, `new AgentImpl`, `new AgentOperations` or `new SessionProviderControl` (including object-literal members) is or contains an arrow function, a function expression or a `.bind(` call while the call sits inside one of the four assembly classes, or contains an identifier whose type is one of those classes. Fixtures: `this.stream.bind(this)` passed to `new AgentImpl` fails; `const self = this; publishAgentFacade({ ... f: () => self.x() })` fails; an arrow written in an assembly method and passed to `facadeInputsForPreferred` fails; field reads such as `facadeInputsForPreferred(this.preferredSessionClient, this.mcpRuntime)` pass; a record built in a module-level function from owner parameters passes.
   The gc test covers what the structural rule cannot see (a stored closure from an earlier method sharing a scope with `this`, a release entry, a control built before publication). The phase 7 reviewer also reads the diff for one rule: every closure that reaches `AgentImpl` is created in `agent-facade.ts`, `agent-operations.ts`, `session-provider-reads.ts` or a `facadeInputsFor<Leaf>` function.

Known changes the test forces:

- Preflight path: after transfer, the preflight still holds `#activation` and `#provisionalActivation`, and the foreground's `closeRuntime` reaches the preflight (today `() => preflight.#releaseForegroundProviders()`; the preflight's own release entries close over the preflight as well). T7.0b builds the capability from the preflight's release scope and settings owner as locals in a module-level helper; T7.7b makes the preflight drop both bootstrap references when `createForegroundAgent` succeeds. The preflight object itself may stay reachable through its release entries; it is not an assembly.
- Release entries in the adopted and preferred assemblies that are created in methods which also create `this` closures (gc-probe2 case) move into module-level helpers in the task that touches that method.

### Session acquisition records (T7.6): one record set per acquisition family

Corrected by the T7.0 inventory (decision D8 in `inventory-phase7.md`). The earlier draft of this section named one function, `acquireAdoptedSession`, and gave it the 16 foreground-field writes of inventory note 2. At `edbcb0e8f` those writes belong to a different family: the activation acquisition (`acquireActivation`, `fromConfig-session.ts:190`, preflight path only), while `acquireAdoptedSession` (`:365-390`) is the adopt path and writes only `adoptClient`. T7.6 replaces both families, so each gets its own records. Every function below is module-level. The activation family stays in `fromConfig-session.ts`, which exports only `acquireActivationSession`, `executeActivationSession` and the activation record types, for `activationPreflightState.ts`, its one importer. The adopt family moves into `adopted-agent-assembly.ts`, its one caller, and none of its functions is exported (the D9 test checks that file).

Activation family (preflight path). `acquireActivationSession(config: Config, activation: PreflightActivationInput, settings: PreflightSettingsInput, providers: PreflightProviderInput, auth: PreflightAuthInput, receiver: ActivationSessionReceiver): Promise<ProviderSwitcher>` replaces `acquireActivation`, its four steps and `bindActivationClient`; `executeActivationSession` replaces `executeActivation`. Its inputs are the four T7.0b records, which hold every value the 13 `activation*` fields and `foregroundAuthority` held, so no new input record is needed. It returns the switcher (one value) and delivers:

| Record | Members (old foreground field) | Root (probe) |
| --- | --- | --- |
| `ActivationSessionResources` | `workspaceTrust: WorkspaceTrustControlPort` (`workspaceTrust`), `trustCleanup: (() => Promise<void>) \| undefined` (`trustCleanup`), `settingsOwner: SessionSettingsOwner` (`settingsOwner`), `settingsOwnership: 'borrowed' \| 'transferred'` (`settingsOwnerOwnership`), `media: SessionMediaOwner` (`mediaOwner`), `workspaceFilesystem: WorkspaceFilesystemOwner`, `workspaceMemory: WorkspaceMemoryOwner`, `workspaceDefinitions: WorkspaceDefinitionOwner`, `sessionClient: SessionClientOwner` (`ownedSessionClient`) | `SettingsService` expected (T7.6 probes) |
| `ActivationSessionAuth` | `oauth: OAuthManager \| undefined` (`oauthManager`) | `OAuthManager` expected |
| `ActivationSessionReceiver` | `resources(acquired: ActivationSessionResources): void`, `auth(acquired: ActivationSessionAuth): void` | none |

Not in the records: `workspaceMemoryOwnership` (always `'transferred'`, its two readers are deleted in T7.0b, decision D2), the three ownership flags the acquisition sets (`ownsFilesystem`, `ownsMemory`, `ownsDefinitions`; the bootstrap sets them in its receiver, and T7.7a makes them private bootstrap fields), `providerFileLifecycle` (read only inside the acquisition), `messageBus` (a copy of `activation.bus`, which nothing reads), the provider manager (the bootstrap already holds it in `PreflightProviderInput`) and any close capability. Release: the function owns a local `AcquisitionRelease` that it rolls back if the acquisition fails, exactly as `#activationRelease` is used today (`fromConfig-session.ts:188-207`; on success nothing closes it). After a successful acquisition the bootstrap retires each owner itself, through `retireActivationOwners` and its ownership flags, as today. A close capability in the record would release the owners a second time.

Adopt family (`fromConfig` path). `acquireAdoptedProviderManager`, `acquireAdoptedOAuth`, `activateAdoptedProviders`, `acquireAdoptedSession` and `activateAdoptedSession` keep their names and take as parameters the values they read today plus the adopted assembly's `adoptRelease` scope, where they register their entries exactly as today (no entry moves, no capability is created). Each acquisition returns one owner: the manager, the OAuth manager, the session client.

| Record | Members (old field) | Root (probe) |
| --- | --- | --- |
| `AdoptedProviderResources` | `manager: RuntimeProviderManager` (`adoptManager`), `oauth: OAuthManager` (`adoptOauth`) | `OAuthManager` expected (T7.6 probes) |

`AdoptedAgentAssembly` holds it in a private field, set right after `acquireAdoptedOAuth` returns (both acquisitions run in the same `try` of `#adoptAdoptConfig`), and holds the session client from `acquireAdoptedSession` in its own private field. The `adopt*` inputs it writes move their declarations from `fromConfig-session.ts` into `AdoptedAgentAssembly`. T7.8 passes this record and the client to the held `ForegroundAssembly`.

The earlier single return `{ resources, auth }` is a bundle (`Probe_AdoptedSessionAcquired`: `OAuthManager` + `SettingsService`), which is why the activation family delivers through a receiver, whose callable parameters are not counted.

The previous draft's single return `{ resources, auth }` is a bundle (`Probe_AdoptedSessionAcquired`: `OAuthManager` + `SettingsService`), so the two records are delivered through the receiver, whose callable parameters are not counted. Ownership: every member is transferred to the adopted assembly; its receiver registers `release` in the assembly's own release scope before any further acquisition, so construction rollback releases it once.

### Release transfer: the existing model, no lifecycle API change

`AcquisitionRelease` (`packages/core/src/lifecycle/acquisition-release.ts:16-63`) has `acquire`, `close` and `rollback`, and no way to remove or move entries. This plan does not add one, and no task removes or moves entries between scopes. Transfer works the way the code already transfers preflight resources: the giving side keeps its scope and hands over one owned close capability (`() => release.close()`), and the receiving side either registers that capability once in its own scope (`'settings'` phase entry for session resources, as `fromConfig-session.ts` does with `#activationRelease`) or keeps it as its `closeRuntime`. The giving side flips one private ownership flag in the same synchronous step in which the receiver accepts, and from then on its own disposal skips that capability. At the starting head this is `activationProviderLifetime` (`() => preflight.#release.close()`, adopted by the session client through `adoptProviderLifetime`), `releaseForegroundProviders` (`() => preflight.#releaseForegroundProviders()`, the foreground's `closeRuntime`), the preflight's `#activationTransferred` and `#foregroundTransferred` flags, and the bootstrap's `ownsSessionClient = false`, `ownsSettings = false`, `mediaOwner = undefined` after `finishForeground` (`activationPreflightState.ts:196-198` at `edbcb0e8f`; 202-204 at `3984a8773`).

The one change is where the capabilities are created. After T7.0b they close over the preflight's release scope and settings owner held in locals of a module-level helper, not over `preflight`, so a capability held by the agent does not keep the preflight's other fields (and through them the bootstrap) alive (see "Reachability acceptance").

### `AdoptionLifecyclePort` and `ForegroundPreflightTransfer` (T7.7a, T7.7b)

`AdoptionLifecyclePort` replaces the two template methods left after phase 6 (decision D3 in `inventory-phase7.md`; `acceptAdoption` and `closeAcquisition` no longer exist): `{ validateIdentity(): void; publish(agent: Agent): Promise<Agent> }`. `validateIdentity` is today's `validateAdoptionIdentity` (void); `publish` is today's `publishAdoptedAgent`, which is async and returns the agent (`activationPreflightState.ts:530-546`, awaited at `adopted-agent-assembly.ts:92`). The 2026-10-24 probe (no root) used the four-member draft with a `void` `publish`; T7.7b re-probes the two-member port with the `Promise<Agent>` return and records the result (one root passes). It is construction-time only: the adopted assembly calls it during construction and does not store it past publication.

`acceptPreflightTransfer(transfer: ForegroundPreflightTransfer, settings: ForegroundPreflightSettings, providers: PreflightProviderInput, auth: PreflightAuthInput)`, declared in the foreground class, replaces the bootstrap's writes of the foreground fields that the foreground class itself reads on the preflight path (T7.7a). The bootstrap calls it once, immediately before `finishForeground()`:

| Parameter | Members (old foreground field) | Root (probe) |
| --- | --- | --- |
| `ForegroundPreflightTransfer` | `mcp: McpRuntimeOwner` (`foregroundMcp`), `mediaOwner: SessionMediaOwner \| undefined` (`mediaOwner`), `sessionClient: SessionClientOwner` (`ownedSessionClient`), `release(): Promise<void>` (`releaseForegroundProviders`, the preflight's capability) | `MessageBus` expected (T7.7a re-probes; the 2026-10-24 probe had `memoryOwnership` instead of `sessionClient`) |
| `ForegroundPreflightSettings` | `settingsOwner: SessionSettingsOwner` (`settingsOwner`) | `SettingsService` expected (T7.7a probes) |
| `PreflightProviderInput` (shared with `forPreflight`) | `settings: SettingsService` (`foregroundSettings`), `manager: RuntimeProviderManager` (`foregroundManager`) | `SettingsService` |
| `PreflightAuthInput` (shared with `forPreflight`) | `oauth: OAuthManager` (`foregroundOAuth`) | `OAuthManager` |

`memoryOwnership` (`ownsMemory`) is not a member: the foreground class never reads `ownsMemory`, and `workspaceMemoryOwnership` is constant (decisions D2 and D7). The D10 test edit (`adoption-binding-failure.behavior.test.ts` stops counting retirements through the protected `ownedSessionClient`; the exact count moves to a new `activationOwnerRetirement.test.ts` case) landed in T7.7a by the orchestrator decision of 2026-10-26, because T7.7a is what stops writing that field; T7.7b does not repeat it. `release` is the only close capability the records carry; the MCP runtime and media owner keep their existing disposal paths (`ownership.disposeMcpRuntime`, the media field).

Ownership flags (decision D7). The seven flag writes in the bootstrap (`activationPreflightState.ts` 85, 179, 180, 181, 196, 197, 198 at `edbcb0e8f`) do not go into `acceptPreflightTransfer`, because the foreground class reads none of them. Line 85 is deleted in T7.0b. `ownsFilesystem`, `ownsDefinitions`, `ownsMemory`, `ownsSessionClient` and `ownsSettings` become private bootstrap fields in T7.7a (their declarations move down from `foreground-agent-assembly.ts`, where they have no reader). The media flip stays in the bootstrap on its own private `#mediaOwner`. The bootstrap flips `#ownsSessionClient`, `#ownsSettings` and `#mediaOwner` when `finishForeground` returns, exactly as today; before that point its disposal releases them.

`ForegroundAdoptionView` (T7.7b), returned by the adopted assembly: `{ assertOpen(): void; finishForeground(): Promise<Agent>; closeConstructionAdmission(): void; acceptPreflightTransfer(transfer: ForegroundPreflightTransfer, settings: ForegroundPreflightSettings, providers: PreflightProviderInput, auth: PreflightAuthInput): void }` (T7.7b probes it; the 2026-10-24 probe of the earlier four-member draft found no root). It is used only during construction; the bootstrap drops it when `createForeground` settles. `config` is the bootstrap's own constructor input. The draft view (`assertOpen`, `sessionClient`, `definitions`, `filesystem`) listed four of the bootstrap's foreground reads; the T7.0 inventory found about fifteen (decision D4). Each has one home after phase 7:

| Bootstrap use of a foreground member (sites at `edbcb0e8f`) | Home | Task |
| --- | --- | --- |
| reads of `workspaceTrust` (274), `trustCleanup` (275, 419), `settingsOwnerOwnership` (424), `workspaceFilesystem` (87, 262, 421), `workspaceMemory` (266, 405), `workspaceDefinitions` (100, 103, 272, 403, 416) | `ActivationSessionResources`, kept privately by the bootstrap | T7.6 |
| read of `oauthManager` (140) | `ActivationSessionAuth`, kept privately by the bootstrap | T7.6 |
| reads of `workspaceMemoryOwnership` (85, 268) | deleted (dead branches) | T7.0b |
| reads of `ownedSessionClient` (89, 92, 106, 183, 300, 412) and `settingsOwner` (146, 288, 425, 460) | `ActivationSessionResources` (assigned to the foreground fields by the T7.6 receiver until T7.7a) | T7.7a |
| reads of `foregroundSettings` (138, 147, 173), `foregroundManager` (137, 144, 172), `foregroundOAuth` (140), `releaseForegroundProviders` (228) | the bootstrap's private T7.0b records and capability | T7.7a |
| `foregroundMcp` (write 291, 11 reads) | private `#mcp`, handed over as `ForegroundPreflightTransfer.mcp` | T7.7a |
| `mediaOwner` (read 418, write 198), the five `owns*` flags | private bootstrap fields | T7.7a |
| `assertConstructionOpen` (132, 167, 182, 193, 199, 533), `finishForeground` (194), `closeConstructionAdmission` (119), `acceptPreflightTransfer` | `ForegroundAdoptionView` | T7.7b |
| `config` (135, 148, 170, 230, 256, 452) | the bootstrap's own constructor input | T7.7b |

### Preflight activation (T7.0b), replaces the nested `PreparedActivation` subclass

`PreparedActivation` (`profile-preflight.ts:690-730` at `edbcb0e8f`, inside `#prepareActivation`) subclasses the bootstrap to write 20 inherited fields from the preflight's private state (inventory note 7; 21 before phase 6 deleted `activationMemoryOwnership`), then calls the inherited `acquireActivation()` and `initializePreparedActivation()` and returns `activationSwitch`. T7.0b replaces it, before any task removes a field it writes, with a static construction API on the bootstrap that takes the same values as parameters, split by root:

`AgentActivationBootstrap.forPreflight(config: Config, activation: PreflightActivationInput, settings: PreflightSettingsInput, providers: PreflightProviderInput, auth: PreflightAuthInput): AgentActivationBootstrap`, synchronous so the preflight keeps its provisional reference for disposal exactly as today, then the instance method `preparePreflight(): Promise<ProviderSwitcher>` with the old `prepare()` body (`acquireActivation`, then `initializePreparedActivation` with `cleanupAfterFailure(error, () => this.dispose())`, then return `activationSwitch`). A static method of the bootstrap may assign the bootstrap's own and inherited `protected` members on a bootstrap instance, so `forPreflight` compiles while the chain exists.

| Record | Members, with the old field each one writes | Root (probe) |
| --- | --- | --- |
| `PreflightActivationInput` | `readKind(): RuntimeKind \| undefined` (`activationReadKind`), `providerLifetime(): Promise<void>` (`activationProviderLifetime`), `filesystem: WorkspaceFilesystemOwner` (`activationFilesystem`), `memory: WorkspaceMemoryOwner` (`activationMemory`), `trust: WorkspaceTrustControlPort` (`activationTrust`), `trustCleanup: (() => Promise<void>) \| undefined` (`activationTrustCleanup`), `files: ProviderFileLifecycle` (`activationFiles`), `policy: RuntimePolicyOwner` (`foregroundPolicy`), `authority: CredentialAuthority` (`foregroundAuthority`), `runtimeContext: ProviderRuntimeContext` (`foregroundRuntimeContext`; written with the named type, not `Parameters<RuntimeProviderManager['setRuntimeContext']>[0]`), `releaseForegroundProviders(): Promise<void>` (`releaseForegroundProviders`), `bus: MessageBus \| undefined` (`activationBus`) | `MessageBus` |
| `PreflightSettingsInput` | `settingsOwner: SessionSettingsOwner` (`activationSettingsOwner`), `settingsOwnership: 'borrowed' \| 'transferred'` (`activationSettingsOwnership`) | `SettingsService` |
| `PreflightProviderInput` | `settings: SettingsService` (`activationSettings` and `foregroundSettings`, the same object), `manager: RuntimeProviderManager` (`activationManager` and `foregroundManager`) | `SettingsService` |
| `PreflightAuthInput` | `oauth: OAuthManager` (`activationOAuth` and `foregroundOAuth`) | `OAuthManager` |

That is all 20 fields: 12 in `PreflightActivationInput`, 2 in `PreflightSettingsInput`, 4 old fields (2 values) in `PreflightProviderInput`, 2 old fields (1 value) in `PreflightAuthInput` (decision D2 in `inventory-phase7.md`). `PreflightActivationInput` had a thirteenth member, `memoryOwnership: 'transferred'`, until phase 6 deleted `activationMemoryOwnership`; production always wrote `'transferred'`, so the member is dropped rather than kept as a constant.

The preflight builds the three capabilities in a module-level helper `preflightActivationCapabilities(host, release, sessionSettings, ownsSettings)` from values read once in `#prepareActivation` (`#sessionSettings` is already set at `profile-preflight.ts:603`, before `#prepareActivation` runs at 606):

- `readKind`: `() => capturePreflightRuntimeContext(host, 'post-config').runtimeKind`, the same call `#runtimeContext` makes, over the host input.
- `providerLifetime`: `() => release.close()`, over the preflight's `AcquisitionRelease`.
- `releaseForegroundProviders`: `() => runCleanupSteps([() => release.close(), () => (ownsSettings ? sessionSettings?.dispose() : undefined)])`, the body of today's `#releaseForegroundProviders`, which is deleted (its only caller is `PreparedActivation`).

Ownership and release transfer for this path are unchanged: the preflight keeps `#release`, `#activationTransferred` and `#foregroundTransferred`, and `dispose` skips the transferred capability exactly as today.

Which task removes each written field, and what it does with the `forPreflight` assignment (each of these tasks has `activationPreflightState.ts` in scope for that reason; `profile-preflight.ts` is in scope of T7.0b and T7.7b only):

| Fields written by `PreparedActivation` | Declared in | Removed by | What happens to the assignment |
| --- | --- | --- | --- |
| the 13 `activation*` fields and `foregroundAuthority` (14 fields) | `fromConfig-session.ts` (`AdoptedSessionAssembly`; `foregroundAuthority` at line 79, read at 304 by `acquireActivationClient`) | T7.6 (the middle class goes) | until T7.6 `forPreflight` assigns them from its records (`foregroundAuthority` from `activation.authority`; it stays `protected`, decision D1); in T7.6 `preparePreflight` passes the same records to `acquireActivationSession` and keeps the returned switcher in a private field |
| `foregroundPolicy`, `foregroundRuntimeContext` | `activationPreflightState.ts` (the bootstrap, lines 112 and 114) | T7.0b itself: once `PreparedActivation` and the T6.D2-deleted fixture are gone, nothing outside the class writes them, so they become `private` (`#policy`, `#runtimeContext`) | assigned by `forPreflight` as private fields |
| `foregroundSettings`, `foregroundManager`, `foregroundOAuth`, `releaseForegroundProviders` | `foreground-agent-assembly.ts` | T7.7a (writes become `acceptPreflightTransfer(transfer, settings, providers, auth)`), declarations moved by T7.8 into `ForegroundAssembly`'s constructor input | `forPreflight` stores the `PreflightProviderInput`, `PreflightAuthInput` and capability privately and the bootstrap passes them to `acceptPreflightTransfer` |

The two dead `workspaceMemoryOwnership` branches (`activationPreflightState.ts:85` and `:268`) are removed in T7.0b (decision D2): the field has one write, `'transferred'` (`fromConfig-session.ts:263`), made before either read.

After T7.0b, `profile-preflight.ts` uses only public bootstrap members (`sessionClient`, `listProfiles`, `loadProfile`, `readHistory`, `prepareProfileActivation`, `createForeground`, `closeForegroundAdmission`, `disposeForeground`, `dispose`) plus `forPreflight` and `preparePreflight`, and later tasks do not touch it except T7.7b. T7.7b clears every preflight field that references the bootstrap once `createForegroundAgent` succeeds: `#activation`, `#provisionalActivation`, and the closures built from it in `#prepareActivation` (`#readProfiles`, `#runImage`, `#readHistory`, `#profiles`), which today are bound to the bootstrap or its `sessionClient` object.

## Probe results (run 2026-10-24 at `3984a8773`)

Result: every proposed contract passes the real analyzer. The guard reports a `runtime-service-bundle` only on the five shapes the plan rejects (one control and four rejected drafts), and on nothing the plan proposes.

How it was run. `W/tmp/pr3911-plan/b6-probe.ts` builds the agents program (`packages/agents/tsconfig.noemit.json`, non-test files) plus one in-memory probe file at `packages/agents/src/api/pr3911-plan-probe.ts`, resolves the ten root symbols from `productionPolicy.services` the way `check-runtime-state-boundary.ts` does, and prints `serviceAnalyzer`'s result for every `Probe_*` declaration; it then runs `scanRuntimeServiceProgram` on the probe file. No source file is written. The CLI contracts use the same script with `packages/cli/tsconfig.noemit.json` and a virtual path under `packages/cli/src/config/`.

```
exec < /dev/null; cd /Volumes/XS1000/acoliver/projects/llxprt/branch-2/llxprt-code/tmp/w2616k && bun tmp/pr3911-plan/b6-probe.ts tmp/pr3911-plan/probe-final.ts
exec < /dev/null; cd /Volumes/XS1000/acoliver/projects/llxprt/branch-2/llxprt-code/tmp/w2616k && bun tmp/pr3911-plan/b6-probe.ts tmp/pr3911-plan/probe-cli-final.ts packages/cli/tsconfig.noemit.json packages/cli/src/config/pr3911-plan-probe.ts
```

Each probe interface uses the exact member lists written in the sections above, with named types. The first probe run in the previous draft typed most B6 members as `Parameters<F>[n]`; the analyzer does not see tuple elements, so those results were empty for the wrong reason and are discarded. Coders re-run the probe (or, once the interface exists in source, `npm run check:runtime-boundary`) in the task that writes each interface.

Controls (they make the other rows meaningful):

| Probe | Result |
| --- | --- |
| `{ v: SettingsService }` | `SettingsService` |
| `{ a: SettingsService; b: OAuthManager }` | bundle (`OAuthManager`, `SettingsService`); guard finding |
| `{ v: Parameters<(s: SettingsService) => void>[0] }` | no root (tuple elements are not analyzed) |
| union, optional, `NonNullable<>`, intersection, `Pick<>`, `X['m']`, `typeof fn`, `ReturnType<>`, method returning `T \| undefined`, method returning `Promise<T>` (each with `SettingsService`) | `SettingsService` each |
| method taking a `SettingsService` parameter | no root (parameters are not counted) |
| CLI program, `{ v: SettingsService }` | `SettingsService` |

B6 contracts:

| Interface (section) | Roots | Guard |
| --- | --- | --- |
| `CliConfigLoadInput`, 11 members including `settingsOwner` (CLI program; the final contract keeps 8 of them, see T5.3) | `SettingsService` | pass |
| `CliConfigReadyCallbacks` (CLI program) | none | pass |
| `ChildAgentScope` (new returned contract) | none | pass |
| scope factory as today, `{ scopeFactory: typeof SubAgentScope.create }` | `HistoryService` | pass alone; the reason for T5.4c |
| `{ scopeFactory: SubAgentScopeFactory }` (narrowed) | none | pass |
| reviewer's shape, `createChildSettings` + `typeof SubAgentScope.create` | bundle (`HistoryService`, `SettingsService`) | finding (rejected; reproduces the review) |
| reviewer's shape with the narrowed factory | `SettingsService` | pass |
| `SubAgentLaunchInput` | none | pass |
| `SubAgentRuntimeInput` | `HistoryService` | pass |
| `SubAgentOperationPorts` | `MessageBus` | pass |
| `McpRuntimeAcquisition` (18 members as probed; the decided 16-member list in the T5.5 section is a subset, re-probed by T5.5) | `MessageBus` | pass |
| `McpRuntimeOperations` | none | pass |
| `WorkspaceToolPorts` | none | pass |
| `SessionToolPorts` | `MessageBus` | pass |
| `ChildAgentLaunch` | none | pass |
| `ChildAgentAcquisition` | `SettingsService` | pass |
| `ChildAgentRuntimeFactories` (`runtimeLoader` + narrowed `scopeFactory`) | `HistoryService` | pass |
| factories plus `clientFactory` in one object | bundle (`AgentClientContract`, `HistoryService`) | finding (rejected; `clientFactory` is its own parameter) |
| `clientFactory` parameter (`AgentClientFactory`) | `AgentClientContract` | pass |
| `ChildAgentOperations` | `MessageBus` | pass |
| earlier `ChildAgentAcquisition` draft (six members) | bundle (`AgentClientContract`, `HistoryService`, `SettingsService`) | finding (rejected) |

B3 owners and existing controls, each alone: `SessionClientOwner`, `RuntimeProviderManager`, `AgentExecutionCoordinator`, `TaskLaunchOwner`, `ShellJobOwner`, `SessionMediaOwner`, `AgentAuthState`, `OwnershipRecord`, `AgentRuntimeState`, `ProviderRuntimeContext`, `WorkspaceControl`, `IdeControl`, `LspControl`, `McpControl`, `ToolControl`, `SessionControl`, `HookControl`, `ProfilesControl`, `AuthControl`, `PolicyControl`, `TasksControl`, `SkillsControl`, `AgentMemoryControl`, `SessionProviderReads`, `AgentFacadeComposition`, `ChildTaskRun`: no root each. `SessionSettingsOwner`: `SettingsService`. `OAuthManager`: `OAuthManager`. `McpRuntimeOwner`: `MessageBus`.

B3 contracts:

| Interface (section) | Roots | Guard |
| --- | --- | --- |
| `ProviderControlSettings` | `SettingsService` | pass |
| `SessionProviderContext` | none | pass |
| `SessionProviderControlSurface` | none | pass |
| `AgentTurnOwners` | none | pass |
| `AgentApprovalOwner` | none | pass |
| `AgentDisposalOwners` | none | pass |
| disposal record holding the `OAuthManager` object instead of `disposeOAuth` | `OAuthManager` | pass (not used; see the section) |
| `AgentFacadeOwners` | `MessageBus` | pass |
| `AgentFacadeControls` | none | pass |
| `AgentFacadeSettings` | `SettingsService` | pass |
| `AgentFacadeProviders` | none | pass |
| `AgentFacadeAuth` | `OAuthManager` | pass |
| `AdoptedSessionResources` (earlier draft; its members now form `ActivationSessionResources`, see below) | `SettingsService` | pass |
| `AdoptedSessionAuth` (earlier draft; now `ActivationSessionAuth`) | `OAuthManager` | pass |
| `AdoptedSessionReceiver` (earlier draft; now `ActivationSessionReceiver`) | none | pass |
| single return `{ resources, auth }` | bundle (`OAuthManager`, `SettingsService`) | finding (rejected; the receiver replaces it) |
| `AdoptionLifecyclePort` (earlier four-member draft, `void` `publish`) | none | pass |
| `ForegroundPreflightTransfer` (earlier draft with `memoryOwnership`) | `MessageBus` | pass |
| `ForegroundAdoptionView` (earlier four-member draft) | none | pass |
| `PreflightActivationInput` (13 members; the decided list has 12, a subset, re-probed by T7.0b) | `MessageBus` | pass |
| `PreflightSettingsInput` | `SettingsService` | pass |
| `PreflightProviderInput` | `SettingsService` | pass |
| `PreflightAuthInput` | `OAuthManager` | pass |

Not probed here because their members were settled by the T7.0 inventory decisions (`revision-notes.md`, "Phase 7 inventory decisions") after this probe run: `ActivationSessionResources`, `ActivationSessionAuth`, `ActivationSessionReceiver` and `AdoptedProviderResources` (T7.6), `ForegroundPreflightTransfer` and `ForegroundPreflightSettings` (T7.7a), `AdoptionLifecyclePort` and `ForegroundAdoptionView` (T7.7b). The task that writes each one probes it with the same script on the exact member list in this file and records the result in the commit body before converting callers. A record reported as a bundle is split by root, never exempted.

The garbage-collection mechanism used by the reachability test was checked with two scripts in the same directory: `gc-probe.ts` (a `WeakRef` held only through a closure stays set after `Bun.gc(true)` and clears when nothing holds it; heap snapshots list user class names) and `gc-probe2.ts` (a closure that does not mention `this` still retains the instance when a sibling closure from the same method does).
