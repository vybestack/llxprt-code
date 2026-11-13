# Code mode belongs in the agent-owned tool execution layer

**Recommendation:** add an opt-in `execute_tool_script` meta-tool backed by a fresh QuickJS-WASM runtime in a dedicated, credential-free child process. Expose registered tools through generated TypeScript declarations and asynchronous JSON-only bindings. Route every nested invocation through a separately owned instance of the existing scheduler, using the caller's admitted tool selection, policy, hooks, approval handler, and cancellation scope. Return one compact result to model history; retain nested execution records separately for inspection.

This requires more than registering a tool. The scheduler is not reentrant, its completion interface publishes model-formatted results, and the existing credential proxy deliberately returns credentials to the sandboxed CLI. None of those interfaces should be mistaken for the code-mode boundary. The work is concentrated in `packages/agents`, `packages/tools`, and a few contracts in `packages/core`; provider transport changes are unnecessary for the proposed first version. [S1, S4, T1, A1, P1]

## Scope and evidence

Repository: `/Volumes/XS1000/acoliver/projects/llxprt/branch-5/llxprt-code`. Research date: 2026-11-13. This is a source-reading architecture dossier, not a security audit, implementation, benchmark, or runtime compatibility certification. No source files were changed. No tests or builds were run. The initial `git status --short` produced no entries.

References below identify files actually read, with important symbols. Proposed classes, contracts, defaults, and behavior are explicitly identified as proposals. Butterfly tables give immediate edges on the traced production paths, not an exhaustive whole-repository call graph. Callback edges are labeled because a lexical search alone can miss them.

## A. Current architecture

### A1. Ownership map

| Area | Verified owner and responsibilities | Code-mode consequence |
|---|---|---|
| Tool definitions | `packages/tools`: `ToolInvocation`, `ToolBuilder`, `DeclarativeTool`, `BaseDeclarativeTool`, `BaseToolInvocation`, `ToolResult`, `ToolRegistry`. [T1, T2] | Put neutral programmatic result/schema contracts here. Do not put agent execution ownership here. |
| Builtin composition | `packages/core/src/config/toolRegistryFactory.ts`: `createToolRegistry`, host adapters, builtin registration, injected `TaskToolRegistration`. [T3] | Inject the new execution dependency from agents, following the task registration boundary rather than importing agents into core. |
| Session selection | `SessionToolCatalogOwner` merges builtins and workspace selection, applies governance, rebinds MCP session approval, and wraps tools with `ToolDispatchAdmission`. [T4, T5] | Use this admitted selection, not an independently captured map of tool objects. |
| Scheduling | Concrete `CoreToolScheduler`, `ToolDispatcher`, `ConfirmationCoordinator`, `ToolExecutor`, `ResultAggregator` are in `packages/agents`. Core owns contracts and request/result types. [S1-S7] | Nested execution belongs in agents. Do not implement a second policy/execution pipeline inside the sandbox adapter. |
| Policy | `packages/policy` owns `PolicyEngine` and confirmation `MessageBus`; core policy owners combine workspace trust and session rules. [Y1-Y4] | Reuse live policy decisions and approvals for each concrete nested call. |
| MCP | `discoverTools` creates `McpCallableTool` and `DiscoveredMCPTool`. The latter is a normal declarative tool. [M1-M3] | Call the wrapper through the scheduler, never the SDK client directly. |
| Provider transport | `IProvider.generateChatCompletion` consumes neutral `ToolDeclaration[]` and emits `IContent`; agent processors call it directly. [P1-P4] | The provider sees ordinary discovery/meta-tool calls and their responses. |
| Agent loops/subagents | `AgenticLoop`, `SubagentOrchestrator`, `ChildAgentAssembly`, `SubAgentScope`, and `TaskTool` live in agents. [L1-L4, G1-G7] | A child agent can use the same feature with its own selection/profile and budget. |
| OS/process boundary | CLI sandbox launchers select container or Seatbelt execution; core shell services manage actual shell processes. [A2-A7] | Reuse lifecycle lessons, not the CLI sandbox's mounts, environment, or credential channel. |
| UI, recording, telemetry | Agent display callbacks feed CLI scheduler hooks; history recording is separate from telemetry. [U1-U3, H1-H3] | Add nested display/audit events without adding nested messages to model history. |
| Settings | Settings registry classifies keys; `SessionSettingsOwner` reads execution and governance policies. [C1-C2] | Register application-owned feature settings, then expose a narrow session policy reader. |

### A2. Declaration, registration, and schema publication

**Definition and invocation are separate objects.** `DeclarativeTool<TParams,TResult>` implements `ToolBuilder`; it carries name, description, kind, parameter schema, display properties, and `build`. Its `schema` getter memoizes a neutral function declaration by parameter-schema identity. `BaseDeclarativeTool.build` calls schema validation through `SchemaValidator`, custom value validation, then `createInvocation`. `BaseToolInvocation` supplies the shared invocation behavior; concrete invocations implement execution. `ToolResult` contains `llmContent`, `returnDisplay`, optional metadata, error, and display suppression. It has no general typed programmatic output field or output-schema contract. [T1]

`buildAndExecute` and `validateBuildAndExecute` are convenience methods on `DeclarativeTool`. They build and execute directly. They are **not scheduler entrypoints** and must not be used by a code-mode broker to dispatch nested work. [T1]

**Registration is composed rather than globally static.** `createToolRegistry` registers filesystem/search/edit/AST tools, shell, memory/todos, web tools, optional GitHub operations, image operations, and agent-related tools. Core injects host capabilities through adapters. Task implementation is supplied through `TaskToolRegistration`, avoiding a core-to-agents implementation dependency. The factory records disabled/missing registrations and honors configured builtin inclusion/exclusion. [T3]

`ToolRegistry` stores tools in a map, normalizes names for registration/lookup, injects `ToolContext` into context-aware tools, and checks live governance for lookup and schema publication. `getAllTools`/`getAllToolNames` are inventory, not permission-filtered discovery APIs. `getEnabledTools` is the appropriate starting point for an authorized index. `getFunctionDeclarations` applies schema transforms and lazy-MCP deferral; `getFunctionDeclarationsFiltered(names)` applies governance/transforms but does not impose that same deferral. [T2]

Command discovery is a separate registry path: `discoverAllTools` invokes the configured command, parses declarations, and installs `DiscoveredTool` instances under the discovery prefix. A `DiscoveredTool` invocation invokes its configured command with JSON parameters. It is not an in-process typed API already suitable for arbitrary scripts. [T2]

**Session wrapping matters.** `SessionToolCatalogOwner.selection` exposes the `ToolSelection` structural interface. Its initialization constructs session builtins with workspace discovery handled elsewhere, and its resolution/definition paths combine workspace and builtin tools. MCP tools receive session approval rebinding. `ToolDispatchAdmission` guards accepted operations and retained callbacks against closed lifetimes, combines abort signals, and joins accepted work when closing. Code mode must retain this behavior rather than returning raw tools into a long-lived guest context. [T4-T6]

**MCP has input schemas but does not currently expose an equivalent typed output API.** `discoverTools` gets SDK definitions, filters enabled tools, and passes `inputSchema` into `DiscoveredMCPTool`. `McpCallableTool.tool()` also publishes the input schema. Its `callTool` checks authorization before and after the SDK request and enforces an aggregate byte budget over the response tree. `DiscoveredMCPToolInvocation.execute` then transforms MCP content into the existing tool content representation. That transformation does not make `outputSchema` or `structuredContent` into a general typed result contract. Preserving structured MCP output is therefore explicit new work. [M1-M3]

### A3. Request-to-history lifecycle

1. **Provider response parsing.** For a concrete inspected example, `processAnthropicStream` accumulates streamed tool input, enforces a tool-argument byte bound, and uses `completeToolCall` to process/coerce parameters and emit an `IContent` `tool_call` block. The provider interface is protocol-neutral. `StreamProcessor._sendProviderRequest` and `TurnProcessor._executeProviderCall` invoke `generateChatCompletion`; `ProviderContentGenerator` is not the live generation adapter to extend. [P1-P5]
2. **Turn normalization.** `Turn.emitFunctionCallRequests` invokes `handlePendingFunctionCall`, which retains or synthesizes an ID, normalizes the tool name, supplies args, prompt ID, agent ID, and `isClientInitiated:false`, appends to `pendingToolCalls`, and emits `AgentEventType.ToolCallRequest`. Concrete `Turn` is in agents; core's `turn.ts` contains shared protocol types. [L1, S7]
3. **Loop and execution lifetime.** `AgenticLoop` collects tool requests and dispatches through `scheduleAndAwait`. `createSchedulerWithCallbacks` acquires a lease through `TurnToolExecutionOwner`. The owner records admitted call IDs for approval routing before forwarding to the scheduler lease. `SessionSchedulerOwner` combines caller/lifetime cancellation and owns teardown. [L2, S8-S10]
4. **Admission, resolution, and validation.** `CoreToolScheduler.schedule` queues if already running/scheduling; otherwise `_schedule` deduplicates IDs, obtains governance, and calls `ToolDispatcher.resolveAndValidate`. The dispatcher applies governance and hook restrictions, resolves the tool with session/agent/interactive context, and builds the invocation. Missing, disabled, or invalid calls become structured error states. [S1-S2]
5. **Policy before confirmation.** `evaluateToolCall` first calls `ConfirmationCoordinator.tryFastApprove`. The coordinator calls `evaluatePolicyDecision`, which derives the invocation policy context and calls `MessageBus.evaluate`. ALLOW schedules; DENY returns `POLICY_VIOLATION` and publishes rejection. For ASK, `evaluateAndRoute` invokes `shouldConfirmExecute`. A missing/false confirmation detail can approve under existing behavior; real details can also be bypassed by YOLO or matching configured allowed tools. Interactive requests carry correlation IDs and call IDs; noninteractive confirmation requirements fail. Do not summarize this as “every ASK always prompts.” [S1, S3, Y1-Y3]
6. **Execution and hooks.** `attemptExecutionOfScheduledCalls` launches scheduled calls, preserving request order for overlapping mutation paths via `launchCallsWithSamePathOrdering`. `launchToolExecution` invokes `ToolExecutor.execute`. The executor runs BeforeTool, can rebuild an invocation from modified input, executes it with cancellation/live-output/PID callbacks, then runs AfterTool and applies output modifications. [S1, S4, S11]
7. **Publication and bounds.** `ResultAggregator` buffers results and publishes them in execution-index order. `publishResult` converts successful `llmContent` using `convertToFunctionResponse`; errors use `createErrorResponse` with model-facing error content. `toolOutputLimiter` supplies token limiting with warn/truncate/sample behavior. Multi-call batches divide the configured token budget, with a 1,000-token per-tool floor, so this is not a strict aggregate byte bound. Acquisition limits also exist earlier, notably shell retention and MCP result bounds. [S5-S6, M2, A6]
8. **Continuation and durable history.** `AgenticLoop.buildNextMessage` excludes client-initiated work from ordinary continuation, handles cancellation and `todo_pause`, and otherwise builds response blocks for the next model turn. Its bound recording path uses `recordCompletedToolHistory` through `bindTurnModel`; `ChatSession.recordCompletedToolCalls` is another inspected completion-recording path that eagerly adds tool responses and marks their IDs as recorded to avoid duplication. `ConversationManager.recordHistory` writes user/model content through `HistoryService.addBatch`. `RecordingIntegration` bridges history publications to the session recording service. [L2-L4, H1-H2]

The normal loop must not see each nested result as a separate provider tool response. Those nested calls were created by the script, not by provider-issued assistant tool-call blocks. Inserting them into ordinary history would both erase the context-saving benefit and risk invalid tool-call/response pairing. This is a design constraint inferred from the existing request/response recording contract. [S7, L2-L4]

### A4. Immediate caller/callee data for butterfly diagrams

Names in parentheses are callback or injected-interface dispatch, not literal direct method references. All edges below were traced in the referenced source.

| Immediate callers, left | Central function | Immediate callees, right |
|---|---|---|
| `Turn.emitFunctionCallRequests` | `Turn.handlePendingFunctionCall` [L1] | `createSyntheticFunctionCallId` when needed; `resolveRawToolName`; append request and construct request event |
| `AgenticLoop.scheduleAndAwait` | lease `schedule` returned by `TurnToolExecutionOwner.acquire` [L2, S9] | register run call IDs; underlying `SchedulerLease.schedule` |
| turn lease wrapper; `executeToolCall`'s acquired lease | lease `schedule` returned by `SessionSchedulerOwner.acquire` [S8-S9, G7] | `AbortSignal.any`; await creation; concrete `scheduler.schedule` |
| `SessionSchedulerOwner` lease callback | `CoreToolScheduler.schedule` [S1, S8] | `isRunning`; either queue request or `_schedule` |
| `CoreToolScheduler.schedule` | `CoreToolScheduler._schedule` [S1] | `deduplicateRequests`; `getToolGovernance` callback; `toolDispatcher.resolveAndValidate`; `notifyToolCallsUpdate`; `evaluateToolCall`; `attemptExecutionOfScheduledCalls`; `checkAndNotifyCompletion` |
| `CoreToolScheduler._schedule` | `ToolDispatcher.resolveAndValidate` [S1-S2] | hook-restriction filter; `isToolBlocked`; `config.getSessionId`; `toolRegistry.getTool`; `setToolContext`; `buildInvocation`; error/suggestion construction |
| `ToolDispatcher.resolveAndValidate`; `CoreToolScheduler.setArgsInternal` (reached through coordinator status callbacks) | `ToolDispatcher.buildInvocation` [S1-S3] | `tool.build(args)` |
| `CoreToolScheduler._schedule` | `CoreToolScheduler.evaluateToolCall` [S1] | coordinator `registerSignal`, `tryFastApprove`, `evaluateAndRoute`; status/error construction |
| `CoreToolScheduler.evaluateToolCall` | `ConfirmationCoordinator.tryFastApprove` / `evaluateAndRoute` [S3] | `evaluatePolicyDecision`; `approveInternal` or `handlePolicyDenial`; ASK path: `invocation.shouldConfirmExecute`, allowed-tool comparison, `setupConfirmationPrompt` |
| coordinator policy paths | `evaluatePolicyDecision` [Y3] | `getPolicyContextFromInvocation`; injected evaluator `.evaluate(toolName,args,serverName)` |
| `evaluatePolicyDecision` through its injected evaluator; bus confirmation helpers | `MessageBus.evaluate` [Y2-Y3] | injected `PolicyDecisionPort.evaluate` (session policy closure in the inspected owner composition) |
| `SessionPolicyOwner.decisions.evaluate` closure | `WorkspacePolicyOwner.evaluate` [Y4] | workspace-trust query; `PolicyEngine.evaluate` with mode/session-rule overlay |
| `WorkspacePolicyOwner.evaluate`; engine subcommand evaluation methods | `PolicyEngine.evaluate` [Y1, Y4] | server-name validation; destructive-command check; `findMatchingRule`; `evaluateMatchingRule` or `evaluateDefault` |
| `_schedule`; coordinator execution callback after approval | `CoreToolScheduler.attemptExecutionOfScheduledCalls` [S1] | `resultAggregator.beginBatch`; `launchCallsWithSamePathOrdering` whose callback calls `launchToolExecution`; `awaitBatchOrAbort`; abort finalization |
| mutation-ordering launch callback | `CoreToolScheduler.launchToolExecution` [S1] | status update; `toolExecutor.execute`; `resultAggregator.bufferResult`; `publishBufferedResults`; execution/publication error handlers |
| `CoreToolScheduler.launchToolExecution` | `ToolExecutor.execute` [S4] | `bindHookCancellation`; `triggerBeforeToolHook`; `checkHookDecision`; optional `tool.build`; `invocation.execute`; `triggerAfterToolHook`; `applyHookOutputModifications` |
| `CoreToolScheduler.publishBufferedResults`; aggregator follow-up callback | `ResultAggregator.publishBufferedResults` [S1, S5] | publish pass; `publishResult`; follow-up scheduling. `publishResult` calls `convertToFunctionResponse` or `createErrorResponse`, then injected `setSuccess`/`setError` |
| `ToolExecutor.execute` via invocation interface | `DiscoveredMCPToolInvocation.execute` [M1, S4] | `mcpTool.callTool`; `isMCPToolError`; `transformMcpContentToParts`; `getStringifiedResultForDisplay` |
| `DiscoveredMCPToolInvocation.execute` | `McpCallableTool.callTool` [M1-M2] | authorization callback before/after; SDK `client.callTool`; `measureOwnEnumerableJsonBytes`; response wrapping |
| `ToolExecutor.execute` via invocation interface | `ShellToolInvocation.execute` [A6-A7] | `validateFilterParams`; `host.stripShellWrapper`; `resolveTimeoutResolution`; `shouldRunAsBackground`; `resolveBackgroundCommand`/`executeBackground` or `executeForeground`. The foreground path subsequently calls `host.executeShellCommand`, whose adapter calls `ShellExecutionService.execute` |
| `TaskToolInvocation.attemptLaunch` through `launchChild` | `SubagentOrchestrator.launch` [G1, G3] | `loadSubagentConfig`; `profileManager.loadProfile`; `resolveRuntimeProfile`; prompt/model/run config builders; `createLaunchData`; injected `assembleChild` |
| orchestrator's injected assembly callback | `ChildAgentAssembly.assemble` [G3-G4] | workspace/provider acquisition; acquired provider-stage `assemble`; rollback on failure |
| subagent noninteractive call processing | `executeToolCall` [G6-G7] | create scheduler owner/lease; lease `schedule`; completion callback wait; lease `release` |
| `AgenticLoop` turn completion path | `AgenticLoop.buildNextMessage` [L2] | classify completions; `recordToolHistory` callback for terminal paths; `hasSuccessfulTodoPause`; `buildToolResponses` |
| `recordToolCompletions` session helper | `ChatSession.recordCompletedToolCalls` [L3-L4] | `completedToolResponses`; `addHistory`; `completedToolResponseIds`; both processors' `markToolResponsesRecorded` |

`CoreToolScheduler.checkAndNotifyCompletion` is the terminal fan-out: it removes confirmation signals, logs completed calls using `logToolCall(new ToolCallEvent(...))`, and invokes the completion callback. The callback is supplied by the loop/client/child owner; it must be different for script-only results. [S1, H3]

### A5. Isolation and credential boundaries

**The existing CLI sandbox runs the CLI, not a secret-free tool program.** `start_sandbox` selects `runSeatbeltSandbox` or `runContainerSandbox`. `loadSandboxConfig` recognizes Docker, Podman, and macOS `sandbox-exec`. `buildContainerRunArgs` mounts the workspace, global config directory, and session temporary directory, configures network/resource settings, and permits additional user flags. These are suitable composition points for an interactive coding environment, not defaults to copy into a no-authority code runner. [A2-A4]

Container credential setup starts a host credential proxy and passes `LLXPRT_CREDENTIAL_SOCKET` plus a capability token using an environment file kept outside mounted paths. `ProxySocketClient` authenticates the channel; `ProxyProviderKeyStorage.getKey` invokes `get_api_key`. `CredentialProxyServer.handleGetApiKey` deliberately returns the actual key for known names, including sandbox connections. The capability authenticates access to credentials; it is not an operation-only tool capability. **Never pass this socket, token, client, or provider storage to script code.** [A1, A5]

Seatbelt setup removes credential-proxy transport markers but starts from the parent environment. `ShellExecutionService` uses PTY or `child_process`; it owns process-group cancellation and output collection. Its sanitizer returns the full environment outside sandbox/CI and allows `LLXPRT_*` variables inside sandbox/CI. Consequently, neither a normal shell invocation nor its environment sanitizer establishes the proposed no-credentials boundary. [A6, A8]

Reusable pieces are bounded acquisition primitives (`ByteBudget`, `BoundedStreamCollector`), cancellation/join ownership patterns, and carefully reviewed IPC framing concepts. The existing framing module provides length-prefixed frames and finite frame bounds, but the new channel should have a distinct, smaller operation protocol. Do not reuse the credential client's operation dispatcher or ambient socket discovery. [A9, S8, T5]

“No credentials” means no runtime credential provisioning, ambient authority, or credential retrieval API in the guest. It cannot mean “no sensitive data can ever appear”: an authorized read tool may return a repository secret, and an authorized shell command may print host environment data. The first release should expose a selected read-only set, with filesystem access still governed by existing tool policy. Strong data-loss prevention would be a separate product contract.

### A6. Subagents and the cheap-model comparison

`TaskTool` is an agent-owned declarative tool. Its schema supports a named subagent, goal, behavior prompts, optional whitelist, expected outputs, context, run limits, and asynchronous execution. `TaskToolInvocation` prepares a launch request and calls injected `launchChild`. `SubagentOrchestrator` loads subagent/profile definitions, resolves profiles including load-balancer members, establishes runtime/session identity, and delegates to `ChildAgentAssembly`. [G1-G4]

`ChildAgentAssembly` creates child settings/configuration and provider resources; `SubAgentScope` owns a fresh chat/run state, cancellation, timeout, and output limits. This is lifecycle and configuration isolation in the current process, not a separate OS security sandbox. Interactive subagent tool calls use scheduler ownership; noninteractive calls still go through `executeToolCall`, which constructs a scheduler lease. Expected-output handling includes local `self_emitvalue`; normal tool results go through the child loop. `task` and `list_subagents` are excluded from child tool selection by the inspected governance path. [G4-G7]

Foreground task results return emitted variables, final text, and termination metadata. Async execution reserves/registers a managed task, returns an acceptance result, and transfers the run into `TaskLaunchOwner` ownership. `ChildToolDisplay` supplies execution-scoped callbacks for display rather than a second primary history stream. [G1-G2, G8, U1]

| Criterion | Script execution | Cheap child model |
|---|---|---|
| Known traversal/filter/join | One written program can perform many calls with no model decisions between them. | Requires child inference to select and sequence calls. |
| Semantic judgment | Only judgments already encoded in the program; no hidden inference API. | Can interpret ambiguous evidence and choose new research directions. |
| Parent context | Compact script return. | Compact task return, often emitted variables. |
| Other model context | Intermediate data stays in guest/host buffers. | Child has its own history and provider context. |
| Failure model | Syntax, data-shape, resource, or tool errors; deterministic control flow given tool responses. | Adds model/tool-selection errors and provider/auth/rate constraints. |
| Best use here | Mechanical gathering, joins, pagination, aggregation, repeated inspections. | Open-ended investigation, interpretation, implementation, or summarization. |

Do not claim cost or latency savings from architecture alone. Compare parent-plus-child tokens, provider requests, tool calls, correctness, approval count, peak memory, and elapsed runtime on the same tasks. An effective composition is a cheap subagent using code mode for mechanical gathering, then doing semantic analysis in its own model turn.

### A7. Class-diagram-ready existing relationships

Arrows below use `extends`, `implements`, `owns`, and `borrows` literally. Interface callbacks are not inheritance.

```text
ToolBuilder<P,R>
  implemented by DeclarativeTool<P,R>
    extended by BaseDeclarativeTool<P,R>
      extended by ShellTool, DiscoveredMCPTool, TaskTool
  methods: schema, build(params)

ToolInvocation<P,R>
  implemented by BaseToolInvocation<P,R>
    extended by concrete shell/MCP/task invocations
  methods: getDescription, toolLocations, shouldConfirmExecute, execute
  returns ToolResult { llmContent, returnDisplay, metadata?, error? }

ToolRegistry owns Map<string, AnyDeclarativeTool>
  methods: registerTool, getTool, getEnabledTools,
           getFunctionDeclarations, getFunctionDeclarationsFiltered
ToolSelection = structural subset of ToolRegistry
SessionToolCatalogOwner owns builtin registry and ToolDispatchAdmission
  borrows workspace ToolSelection and session approval/bus
  exposes selection: ToolSelection
ToolDispatchAdmission wraps tools/invocations and owns accepted work lifetime

CoreToolScheduler implements ToolSchedulerContract
  owns ToolDispatcher, ConfirmationCoordinator, ToolExecutor, ResultAggregator
  methods: schedule, cancelAll, joinExecutions, dispose
ToolDispatcher borrows ToolSelection and config
ConfirmationCoordinator borrows MessageBus and scheduler mutation callbacks
ToolExecutor invokes ToolInvocation; receives HookExecutionOwner per call
ResultAggregator owns ordered pending-result buffer; invokes status callbacks
SessionSchedulerOwner owns lazy scheduler lifetime and leases
TurnToolExecutionOwner owns approval subscription and admitted call-ID set
  creates SessionSchedulerOwner through an injected factory
AgenticLoop owns a TurnToolExecutionOwner reference and model/recording ports

PolicyEngine owns sorted rules and default decision
MessageBus owns event subscriptions; borrows a PolicyDecisionPort
WorkspacePolicyOwner owns/borrows PolicyEngine and observes workspace trust
SessionPolicyOwner borrows WorkspacePolicyOwner; owns session rules
  exposes decisions and owns/borrows MessageBus
RuntimePolicyOwner composes workspace and session policy owners

DiscoveredMCPTool owns CallableTool reference
McpCallableTool implements CallableTool and borrows MCP SDK Client
  methods: tool, callTool

TaskToolInvocation borrows launchChild callback
SubagentOrchestrator borrows profile/subagent readers and assembleChild callback
ChildAgentAssembly acquires child config/settings/provider resources
SubAgentScope owns run/chat/admission/cancellation state
  methods: create, runInteractive, runNonInteractive, cancel, dispose
TaskLaunchOwner owns accepted asynchronous child launches
ChildToolDisplay owns observer set; open returns scoped callbacks

ShellExecutionService owns process/PTY bookkeeping (static service)
  methods: execute, terminatePty, destroyAllPtys, sanitizeEnvironment
CoreShellToolHostAdapter implements IShellToolHost
  delegates executeShellCommand to ShellExecutionService
CredentialProxyServer owns socket server and request handler map
ProxySocketClient owns authenticated client transport
ProxyProviderKeyStorage borrows ProxySocketClient; method getKey
start_sandbox is a function, not a Sandbox class
```

Sources: tool hierarchy [T1-T6, M1-M2]; scheduler [S1-S10]; policy [Y1-Y4]; subagent [G1-G8, U1]; process/credential boundary [A1-A8].

## B. Proposed design

### B1. Feature boundary and dependency direction

Add two ordinary model-facing tools:

- `discover_tool_api`: paginated search/index plus explicit description of selected enabled tools. Return short descriptions, generated declarations, result-format information, and an API revision. It must not execute tools or authorize use.
- `execute_tool_script`: accepts `language`, `source`, `tools`, `api_revision`, and a short purpose. `tools` is an exact list of requested capabilities, never an authorization grant. The list is intersected with feature eligibility and caller authority; unavailable requested names cause a preflight error rather than silent removal.

Implement the execution tool and run owner in `packages/agents`, following the existing agent-owned task/tool pattern. Extend factory injection in core and session catalog composition; do not add an import from tools or core into agents. Put schema projection and neutral programmatic data contracts in `packages/tools`. Keep the QuickJS adapter private to the agent execution implementation until there is an actual second consumer. No new workspace package is needed initially. [T1-T6, G1]

Separate **what is advertised** from **what is authorized**. In compact mode, model requests advertise the two new tools plus a small set of direct control tools. The broker still resolves ordinary tools through the full admitted selection. Hiding a declaration must not remove the underlying tool from authorization, and advertising a meta-tool must not grant every nested tool. Preserve `tools.allowed`, `tools.disabled`, `excludeTools`, task whitelist restrictions, and any parent hook restriction independently. Existing governance and declaration-selection seams are the integration points. [T2, T4, S2, C2]

First release: opt-in, selected read-only builtin tools only, no remote tools merely because they claim to be read-only. No `task`, `execute_tool_script`, `todo_pause`, settings/auth/approval control, or background shell jobs inside scripts. No recursive meta-tool dispatch. Ordinary direct tools remain available as a model-selected alternative after a failed script, never an automatic runtime fallback.

### B2. Runtime choice

| Candidate | Assessment for this feature | Decision |
|---|---|---|
| Plain Bun subprocess or worker | Process isolation helps cancellation, but ordinary Bun code has filesystem/process/network facilities. Deleting a few globals is not a security boundary. Worker threads also share the host process's failure domain. | Use Bun only to run the trusted wrapper, not to evaluate the model program directly. |
| `node:vm` | A context is not a hostile-code security boundary. Passing host functions or objects can grant host authority. | Reject. |
| `isolated-vm` | V8 isolation can support this design with careful serialization, but adds a native addon/runtime compatibility burden to a Bun-oriented application. A proof of support would be required before selection. | Reject for the initial implementation. |
| QuickJS-WASM | Separate guest heap, no host facilities by default, explicit host bindings, memory/stack limits and interrupt handling. Promise jobs must be pumped explicitly. Adds a dependency and packaged WASM asset. | **Recommend**, in a dedicated trusted-wrapper subprocess. |
| Deno with permissions | A permission-controlled external runtime can work, but expands installation/version management and requires handling module loading, prompting, IPC, and permission flags consistently. | Do not add a second general-purpose runtime for this first feature. |
| Existing container sandbox | OS isolation is useful, but the current CLI profile mounts project/config paths and provisions credential access. A separate immutable runner profile could work, with no mounts/network/credentials. Container availability and nested-launch behavior complicate universal use. | Keep as a future deployment requirement if stronger OS isolation is needed, not an automatic fallback. |
| Pydantic Monty through Python | A restricted interpreter may fit a Python-facing product, but this repository's tool surface is TypeScript/JSON Schema. It adds Python/native packaging and a second language/API translation to maintain. Exact language/runtime limits would need a dedicated proof. | Do not adopt for this TypeScript-first design. |

QuickJS API claims are supported by the upstream [project documentation](https://github.com/justjake/quickjs-emscripten) and [runtime API](https://github.com/justjake/quickjs-emscripten/blob/main/doc/quickjs-emscripten-core/classes/QuickJSRuntime.md): `setMemoryLimit`, `setMaxStackSize`, `setInterruptHandler`, `newPromise`, and `executePendingJobs`. These are external runtime facts, not installed repository capabilities. No QuickJS, isolated-vm, or Monty dependency was found in the inspected workspace manifests. TypeScript is already present in the project toolchain; that does not establish that a runtime TS compiler is packaged. [C3]

**Guest contract:** initially JavaScript function-body source with an implicit async wrapper, `await`, and `return`. The generated API is described by `.d.ts` text even when the script is JavaScript. This avoids adding a TS compiler to the first runtime. A later explicit TypeScript language option can add type erasure/type diagnostics in the trusted wrapper, using a declared runtime dependency or validated build-time packaging. Never resolve `tsconfig`, imports, plugins, or modules from the user's workspace. Unsupported syntax fails before host calls.

**Wrapper contract:** one fresh process and QuickJS runtime per invocation. Spawn a fixed installed entrypoint by absolute path, with explicit minimal environment and private pipes. Do not inherit `HOME`, provider variables, `LLXPRT_*`, proxy variables, SSH agent descriptors, credential sockets, or startup injection variables. Platform-required nonsecret process variables are explicitly enumerated. The guest receives JSON data and guest-native promise functions only: no `process`, `Bun`, Node imports, `fetch`, filesystem, shell, module loader, provider object, or credential client.

The trusted wrapper can load its packaged WASM and communicate over its pipe; the guest cannot directly invoke wrapper APIs. The interpreter/WASM implementation and the binding serializer are the trust boundary. A subprocess provides kill/join and crash containment; it does not itself make arbitrary Bun code safe or protect against every engine escape. Dependency integrity, artifact packaging, and host-reference isolation are release gates. If the runtime cannot initialize, return a capability error. Never fall back to host `eval`, shell, `vm`, or a less restrictive engine.

### B3. API projection and progressive disclosure

Generate declarations from **session-visible registered schemas**, not provider-converted schemas. Provider conversion can discard expressiveness for wire compatibility. Use an exact name map and string-literal property names, for example `tools["read_file"](...)`; do not splice MCP names into executable identifiers. Escape descriptions as data/comments and limit description size. Remote descriptions remain untrusted text.

Proposed declaration shape:

```ts
type JsonValue =
  | null | boolean | number | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

type ScriptToolResult<T extends JsonValue = JsonValue> =
  | {
      readonly ok: true;
      readonly value: T;
      readonly completeness: 'complete' | 'partial' | 'unknown';
      readonly nextCursor?: string;
    }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: string;
        readonly message: string;
      };
    };

interface ScriptTools {
  readonly read_file: (
    args: ReadFileArgs
  ) => Promise<ScriptToolResult<TextReadResult>>;
}
```

`ReadFileArgs` is generated from its real input schema. `TextReadResult` requires an explicit, tested host adapter or a new structured tool result; it cannot be inferred from input properties. Existing generic tools initially return a text envelope, with completeness `unknown` unless the producer supplies evidence. Never parse a human display string and pretend it is an authoritative structured result.

Schema projection supports objects, required/optional properties, additional properties, arrays, enum/const, unions, and local references. Unsupported constraints remain in the host JSON Schema validator and are documented; unresolved or unsupported type fragments project to `unknown` with a diagnostic rather than a falsely precise type or `any`. No remote `$ref` fetching. Recursive local schemas use named types with bounded generation. Generated declarations provide model guidance; the original schema remains the execution validator. [T1]

`discover_tool_api` searches `getEnabledTools` through session admission, with a bounded page of names/descriptions. A describe operation returns selected declarations and a revision hash over names, schemas, programmatic adapters, and relevant feature settings. This does not activate unauthorized MCP servers. Integrate existing lazy-MCP publication deliberately rather than assuming all registered tools are advertised. [T2, T4]

Bind the described tool identities and schema revision at script admission. Each call rechecks live availability/policy, so disablement or session closure takes effect mid-script. A changed implementation/schema fails that call as `API_CHANGED`; it is not silently replaced with another tool. Adding an unrelated tool need not invalidate a running script. Bound discovery results, declarations, schema depth, and the host cache by bytes/items, not just tool count.

### B4. Host broker and nested scheduler ownership

Proposed host-only interfaces:

```ts
interface ScriptRunRequest {
  readonly language: 'javascript';
  readonly source: string;
  readonly tools: readonly string[];
  readonly apiRevision: string;
  readonly purpose: string;
}

interface ScriptCall {
  readonly requestId: number;
  readonly tool: string;
  readonly args: Readonly<Record<string, JsonValue>>;
}

interface ScriptRunResult {
  readonly value: JsonValue;
  readonly callCount: number;
  readonly partial: boolean;
}

interface CodeModeRuntime {
  run(
    request: ScriptRunRequest,
    invoke: (call: ScriptCall) => Promise<ScriptToolResult>,
    signal: AbortSignal,
  ): Promise<ScriptRunResult>;
}

interface NestedToolExecution {
  invoke(call: ScriptCall, signal: AbortSignal): Promise<ScriptToolResult>;
  close(): Promise<void>;
}
```

These signatures omit concrete config/bus/provider objects intentionally. Limits and identity are bound by the run owner's constructor, not accepted as guest overrides. The transport uses discriminated `call`, `result`, `log`, `complete`, and `failure` frames with protocol version, run ID, and monotonically assigned request ID. The host creates actual tool-call IDs and parent links. Guest-supplied policy identity, agent ID, server name, paths to credential sources, or approval outcomes are not protocol fields.

Add an explicit per-invocation execution context at the scheduler-to-invocation boundary. The existing invocation `execute` parameters do not carry the parent call ID, prompt ID, or hook-restriction set; `ToolContext` supplied during lookup is not a complete execution scope. Extend the neutral tools contract with immutable provenance and a host-only nested-execution port, assembled by the agents scheduler owner with the current hook owner and approval handler. The meta-tool must fail if that scope is missing. Do not infer its parent from a shared mutable tool instance, a global current-call variable, or guest-supplied IDs. This is a required extension to `ToolInvocation`/`ToolExecutor` composition, not functionality already provided by registry lookup. [T1, S2, S4, S7]

**Do not recurse into the active parent scheduler.** It queues new work while a tool is executing; the parent `execute_tool_script` would wait on a child queued behind itself. Instead, a `CodeModeRunOwner` creates a separate `TurnToolExecutionOwner` and `SessionSchedulerOwner` with the same admitted selection/policy and the parent's interactive status. This mirrors existing child execution ownership without allocating a second model/history/provider. [S1, S8-S10]

The broker constructs a normal `ToolCallRequestInfo`, preserves prompt/agent identity and inherited restrictions, and dispatches through its lease. The child completion callback resolves the corresponding guest promise. It must wait for terminal completion, not merely for `schedule()` to return: interactive scheduling can return with calls awaiting approval. [L2, S3]

Initially serialize nested calls through one FIFO broker, even when the guest uses `Promise.all`. Place queued calls in the broker; do not submit a new scheduler batch while the previous batch is active. This avoids relying on scheduler reentrancy or queue behavior and gives predictable side-effect order. Enforce finite outstanding requests, count, and cumulative bytes at acceptance. Promise jobs must be pumped after each response and in bounded slices so cancellation and transport progress cannot starve.

A script returning while host requests are still pending fails with `UNAWAITED_TOOL_CALLS`: close admission, cancel queued requests, abort/join accepted work, and report any completed effects. It must not publish success and leave work running. Duplicate/out-of-order IPC request IDs fail the run rather than replaying a tool call. An ordinary tool error that the script intentionally handles remains visible in the host-owned summary; the guest cannot erase policy failures, partial-acquisition flags, or unfinished work by returning a custom object.

For a later concurrency phase, drain an admitted wave into one scheduler batch and retain its mutation ordering. Do not create one unrelated scheduler per parallel call. Before enabling nested mutations across parent/client/subagent schedulers, extract shared workspace execution arbitration: ordinary overlapping file mutations must keep their ordering across owners, and opaque shell/MCP mutations require an exclusive lane. The orchestration meta-tool must not hold a mutation lease while awaiting its children. Keep this out of the read-only MVP, but make it a prerequisite for write-capable release. Existing ordering is within a scheduler batch. [S1, S11]

### B5. Policy and confirmation semantics

The execution contract is:

```text
feature eligibility + caller governance + request allowlist
  -> resolve/build through admitted selection
  -> prepare effective hook-adjusted invocation
  -> evaluate existing policy for concrete tool and effective arguments
  -> existing confirmation if required
  -> execute exact authorized invocation
  -> hooks/result processing
  -> guest response and audit event
```

A declared allowlist only limits names. It cannot safely preapprove future loop-generated arguments. The recommended interaction is **pause at each nested call requiring approval**. The guest awaits a promise while the existing UI displays the real tool, effective arguments/diff, originating script, parent call ID, and progress. A script-level approval allows starting the program, not bypassing child confirmations. Existing explicit user “always allow” choices retain their ordinary scope; code mode creates no blanket allow rules.

Use a child `TurnToolExecutionOwner.begin()` subscription so nested IDs are owned and approval requests reach the actual approval handler. The parent owner currently admits only IDs scheduled through its own lease; merely sharing its message bus is insufficient. Retire the child subscription on all exits and discard late replies. Headless execution returns an explicit approval-required/denied failure instead of waiting for a nonexistent UI. [S3, S9]

**Hook ordering must be made explicit before shipment.** The inspected `ToolExecutor.execute` runs BeforeTool after scheduler policy/approval, rebuilds input, and does not visibly re-evaluate policy there; rebuild errors warn and retain the prior invocation. This dossier does not assert an exploit or diagnose the full hook trust model. It does establish that “we reuse the scheduler, therefore the final arguments were checked” is too strong. Add tests for effective-argument authorization, then move input preparation into a shared scheduler step before policy evaluation. A changed/invalid hook input must fail or be reauthorized, never silently execute a different invocation. Do not add a code-mode-only policy check alongside the existing one. [S3-S4]

Approval edits also require validation/authorization of the final invocation. Avoid rerunning BeforeTool after approval, which could produce another mutation or duplicate a hook side effect. Carry an immutable prepared invocation and its effective arguments through execution. Apply the same contract to normal and nested calls.

DENY, user cancellation, revocation, and runtime/budget violations terminate the run and reject pending guest requests. Ordinary tool failures can return `{ok:false,...}` for explicit script handling. Policy failure cannot be caught in guest code to continue making unrelated calls. Completed external side effects are not rolled back; the final failure includes a bounded list of completed call IDs/statuses and states that execution may be partial.

### B6. Output, budgets, cancellation, and data lifetime

**Add a scheduler result-delivery seam, not a raw execution bypass.** `ResultAggregator.publishResult` currently formats `ToolResult.llmContent` for the model. Add a typed completion payload or sink exposing a bounded, post-hook programmatic value before model-token formatting. Normal execution keeps the existing model result path. Script execution resolves its broker response from this new sink while retaining ordinary status, policy, hooks, telemetry, and UI callbacks. Do not reconstruct data from `responseParts` after truncation. [S4-S6]

Extend `ToolResult` with a neutral optional programmatic result, explicit completeness, and producer truncation metadata. Preserve useful MCP `structuredContent` and optional output schemas explicitly; otherwise return a documented text envelope. Output-affecting hooks must apply consistently to the programmatic channel. If a hook supplies only replacement text, invalidate the typed value and return the replacement text envelope; never expose a hidden pre-hook result. Binary/media responses use bounded metadata or opaque host-owned references in a later phase, not full image/audio bytes in the initial guest.

Existing acquisition limits stay in force. Skipping the model-token limiter for intermediate values does not undo truncation already performed by a tool or its acquisition layer; shell retention and MCP result bounds are concrete inspected examples. Selected tools need pagination/completeness contracts to support exhaustive scripts. A claim such as “every TODO” is invalid when a producer reports partial or unknown coverage. [A6, A9, M2, S6]

Proposed initial finite defaults, to validate with measurements rather than treat as performance claims:

| Limit | Initial value/behavior |
|---|---|
| Script source | 64 KiB UTF-8; reject before launch |
| Guest heap / stack | 64 MiB / 1 MiB; interpreter-enforced |
| Active guest computation | 5,000 ms cumulative execution slices; excludes host/approval waits |
| Total wall lifetime | 300,000 ms, including approval waits; parent cancellation/deadline always wins |
| Nested calls | 64 per run; no resets through discovery or errors |
| Pending requests | 16, including queued requests; overflow terminates rather than allocating indefinitely |
| Executing calls | 1 in MVP |
| One serialized tool response | 1 MiB or a smaller existing producer limit; no partial JSON clipping |
| Cumulative host-to-guest data | 16 MiB per run, enforced before copying/serialization growth |
| Guest console output | 8 KiB retained; omission marker and byte count |
| Final result | 16 KiB serialized JSON and existing model-output token budget |

An over-limit final value returns a small explicit `RESULT_TOO_LARGE` error; do not silently cut JSON in the middle or fabricate a successful partial answer. Intermediate oversize results require narrower/paginated calls. Serialize incrementally with depth and byte checks; cyclic values, unsupported values, non-finite numbers, and malformed frames fail with a bounded diagnostic. These checks handle genuinely untrusted data and are not speculative fallback layers.

On cancellation or deadline: close broker admission; abort the child scheduler signal and in-flight host call; interrupt/terminate the wrapper; cancel outstanding confirmation routing; join accepted real executions; close pipes and dispose interpreter handles. `cancelAll` alone is insufficient because the scheduler explicitly tracks real executions separately from its prompt cancellation result. Reuse `SessionSchedulerOwner`'s join discipline. A host tool that ignores cancellation can still delay cleanup; do not report that it was killed merely because the guest process exited. [S1, S8]

No persistent VM/session filesystem and no script-resume facility in the first version. Do not automatically replay a failed script: a previous call may already have changed external state. Recovery is a new model/user decision with the recorded completion summary.

### B7. UI, transcript, recording, and telemetry

Display one parent script card containing the purpose, requested tool names, source, lifecycle state, final result/error, and a count of nested calls. Nested calls appear as expandable children with the same status and confirmation details as direct tools. Stream bounded progress to the existing display mechanism. `ChildToolDisplay` and CLI `useChildToolDisplay` already distinguish execution-scoped callbacks; add serializable parent/run IDs rather than treating the current in-process `symbol` as a persisted identity. [U1-U2]

Proposed metadata on execution events: `parentCallId`, `scriptRunId`, `origin:'model'|'script'`, and `sequence`. Preserve the caller's `agentId` so a code-mode call inside a subagent remains attributed to that subagent. Do not use `isClientInitiated` as a substitute for script origin: that flag already affects loop continuation. [S7, L2]

The model transcript contains only the assistant meta-tool call and its single final response. Nested calls go to a typed operational recording event, for example `tool_script_event`, containing identities, tool names, effective argument summaries, approvals, completeness/byte counts, and terminal states. `SessionEventType` already separates operational metadata from model `content`; add a proper event and replay handling rather than hiding structured records in free-form text. Replay restores display/audit state but never reexecutes scripts or inserts child responses into `IContent[]`. [H1-H2]

Record source once as the normal meta-tool argument subject to existing transcript/privacy policy. Do not duplicate raw intermediate results in the recording or telemetry by default. Keep bounded display excerpts; discard guest buffers at disposal. Report policy denial and incomplete execution even when the script tries to return an apparently successful value.

Reuse `logToolCall` for nested actual tool executions. Add script-level lifecycle metrics: runtime startup, compute/wall/approval-wait durations, call count, observed/acquired/guest/final byte counts, result completeness, reason for termination, engine version, and parent links. Do not label unmeasured hypothetical tokens as “tokens saved.” Existing telemetry gates function arguments on `logPrompts`; script source and nested data must obey that privacy setting and not leak through metadata. [H3]

### B8. Settings, model enablement, and child-agent composition

Register new keys as application/CLI behavior in `packages/settings`, not provider model parameters. Unknown keys currently fall through to model-parameter output, so adding an unregistered `codeMode` object would be incorrect. Session-scoped keys currently cannot contain dots. Use flat hyphenated names and a typed `SessionSettingsOwner.readCodeModePolicy()` reader. [C1-C2]

Proposed user-facing settings:

| Setting | Semantics |
|---|---|
| `code-mode` | `off` (default), `read-only`, later `enabled` for explicitly admitted write/network tools |
| `code-mode-tool-surface` | `alongside` initially; `compact` after disclosure/history tests |
| `code-mode-max-calls` | finite positive integer, user/profile ceiling |
| `code-mode-wall-timeout-ms` | finite deadline; intersect with parent lifetime |
| `code-mode-max-result-bytes` | finite final-result ceiling |

Keep engine choice fixed in v1. Memory/stack/wire hard caps are implementation-owned, documented limits, not a matrix of per-model knobs. Profiles may lower budgets; a child cannot increase caller-imposed ceilings. Validate all settings at admission and freeze the per-run policy. Live tool disablement still takes effect through the existing selection/policy boundary.

Do not auto-enable by provider name. Default off for all models, and allow explicit profile opt-in for models that can reliably produce valid tool JSON and short JavaScript programs. Evaluate both a capable coding model and the local/cheap model actually used in comparison. Measure valid-program rate, completeness, corrected-answer rate, inference usage, wall runtime, and permission behavior. A failed script does not trigger automatic retries or a hidden cheap-model fallback.

A subagent can receive `execute_tool_script` and `discover_tool_api` through its own profile/whitelist and runtime assembly. Omitted child whitelist currently preserves child defaults, so the child's code-mode capability set must be derived from the child's admitted selection, not silently widened from the parent registry. Preserve explicit empty whitelists. Keep `task` unavailable inside scripts even when a parent agent can delegate; this avoids recursive model fan-out. Child `self_emitvalue` remains a child-agent output operation after the script returns, not a guest-global host function. [G1, G4-G7]

### B9. Proposed class diagram

```text
ExecuteToolScriptTool extends BaseDeclarativeTool<ScriptParams,ToolResult>
  creates ExecuteToolScriptInvocation extends BaseToolInvocation
ExecuteToolScriptInvocation -> CodeModeRunOwner.run

DiscoverToolApiTool extends BaseDeclarativeTool
  -> ToolApiCatalog.search / describe
ToolApiCatalog borrows admitted ToolSelection
  -> SchemaToTypeScript projection functions (tools package)
  owns bounded revision/descriptor cache

CodeModeRunOwner owns:
  immutable per-run capability/limit snapshot
  cancellation/deadline state
  NestedToolExecutionSession
  CodeModeRuntime implementation
  operational event sink

QuickJsProcessRuntime implements CodeModeRuntime
  owns dedicated wrapper child process and bounded pipe protocol
  wrapper owns one QuickJS runtime/context and deferred guest promises
  no reference to registry, config, policy, provider, or credentials

NestedToolExecutionSession implements NestedToolExecution
  owns FIFO admission queue and request-to-completion map
  owns child TurnToolExecutionOwner + SessionSchedulerOwner
  borrows admitted ToolSelection, session policy/bus, hook owner, approval handler
  uses CoreToolScheduler without a child model/chat/history

CoreToolScheduler -> shared prepared-invocation step
CoreToolScheduler -> ResultAggregator with typed completion sink
ResultAggregator -> normal model formatter OR bounded script result adapter
  both use post-hook ToolResult and preserve terminal statuses

CodeModeEventSink -> existing display callbacks + typed recording events
CodeMode metrics -> existing RootTelemetry
SessionSettingsOwner -> immutable CodeModePolicy

Later write/concurrency phase:
WorkspaceExecutionArbiter shared by normal/client/subagent/script schedulers
  owns mutation ordering only; orchestration parents acquire no mutation lease
```

The interpreter interface earns its cost by separating untrusted execution from host policy and allowing protocol/lifecycle testing. The catalog exists because disclosure, revision binding, and schema projection share actual state. Do not introduce a generic plugin framework, workflow DSL, distributed execution service, or multiple runtime implementations for hypothetical future users.

### B10. End-to-end sequence: TODOs in files touched by ten commits

Interpret “owner” as the Git blame author of the TODO's current line, not a guaranteed organizational owner. State this in the result. Use the current workspace contents and the last ten reachable commits from a resolved HEAD; deleted/unreadable files are reported explicitly. Distinguish uncommitted lines and shallow history. This is a product interpretation of an ambiguous example, not an existing tool capability claim.

The complete example needs the later opt-in shell capability or a separately approved narrow Git-read tool. MVP read-only scripts can instead accept the changed-file list collected by an ordinary, policy-approved tool call. Do not smuggle shell into a “read-only” preset because the example needs Git.

```text
User -> AgenticLoop: find TODOs in files touched in last ten commits; group by owner
AgenticLoop -> Provider: current context + discovery/meta-tool schemas
Provider -> AgenticLoop: discover_tool_api(names for shell/read/search)
Discovery -> admitted ToolSelection: enabled descriptors, schemas, revision
Discovery -> Provider history: small typed API description
Provider -> parent scheduler: execute_tool_script(source, names, revision)
Parent scheduler -> policy/confirmation: allow or ask to start this script
Parent ToolExecutor -> CodeModeRunOwner: execute under caller lifetime
CodeModeRunOwner -> QuickJsProcessRuntime: start clean wrapper/guest
CodeModeRunOwner -> nested execution owner: begin approval routing
Guest -> private IPC -> broker: call shell to resolve HEAD/list changed paths
Broker -> child scheduler: host-issued call ID + actual command arguments
Child scheduler -> preparation/policy: effective args, ordinary shell rules
Policy -> UI: approval if needed; guest promise stays pending
UI -> confirmation bus -> child scheduler: decision for that exact call
Child executor -> shell host: approved command executes outside guest
Child result sink -> broker -> guest: bounded post-hook data + completeness
Guest: deduplicate/filter paths; loop through bounded read/search calls
For each nested call: same admitted lookup, policy, confirmation, execution path
Guest -> broker -> scheduler -> shell host: bounded Git blame queries as authorized
Guest: join TODO file/line with author; count/group; retain compact evidence
Guest -> wrapper -> owner: one JSON return
Owner: close admission, join child work, dispose process and approval routing
Owner -> parent ToolResult: compact result + coverage/partial status
Parent aggregator -> AgenticLoop -> history/provider: one meta-tool response
Provider -> User: summary, evidence locations, ownership definition, coverage limits
Nested events -> UI/operational recording throughout, never provider history
```

No dynamic shell command may concatenate untrusted filenames without correct argument treatment. Prefer a narrow host-side Git query adapter if this becomes a common workload. Shell approval still applies to the actual generated command. A repository-controlled Git configuration/hook/helper is another reason arbitrary shell is outside the MVP's selected read-only set.

If limits are hit, return the completed file count and partial coverage, not “every TODO.” If all evidence fits in raw acquisition budgets but would have exceeded model-context limits, the script can reduce it before the parent sees it. If acquisition itself truncates, code mode needs pagination; local filtering cannot recover missing data.

### B11. Test-first implementation plan and rough size

All new tests should use TypeScript and `bun:test`, with behavioral assertions and real temporary filesystem/process integration where appropriate. `dev-docs/RULES.md` requires tests before production implementation. Do not modify quality thresholds or assertions to accommodate the feature. The estimates below are rough added/changed production LoC plus tests, not delivery schedules. [C4]

| Phase | Tests written first | Implementation after failing behavior is specified | Rough magnitude |
|---|---|---|---|
| 0. Contracts and runtime proof | Run a real QuickJS guest with a fake data-only tool; absence of env/fs/network/host references; finite compute/memory; pending promise and abort; packaged WASM loading on supported launch paths. Prove final hook-adjusted args receive policy evaluation. | Specify wire/limit/result contracts; minimal private runtime harness; shared prepare-before-policy correction where tests require it. No exposed meta-tool yet. | 400-800 production, 500-900 tests |
| 1. Read-only vertical slice | Real session registry + policy + child owner; one tool call, loop, ordinary error, denial, approval pause, cancel/join, closed owner, one parent result, no nested history. | Run owner, private wrapper, bounded IPC, sequential broker, injected meta-tool, typed post-hook result sink; selected read-only adapters; feature off by default. | 1,000-1,600 production, 1,000-1,600 tests |
| 2. API disclosure and structured data | Input schema projection, odd MCP names, local refs, cyclic/unsupported schemas, escaped docs, stale revision, live revocation, bounded pages, preserved completeness; no false typed outputs. | Discovery tool, `.d.ts` projection, bounded catalog, optional structured ToolResult data and selected adapters; explicit MCP structured output/output-schema preservation. Optional TS source only after packaging proof. | 700-1,200 production, 700-1,200 tests |
| 3. Product integration | Nested cards and exact confirmation args; persistence/replay without provider-history pollution; telemetry privacy; settings never sent as model params; child whitelist/profile bounds; headless behavior. | UI/event metadata, typed operational recording/replay handling, metrics, setting readers/profile integration, prompts/docs. | 700-1,100 production, 800-1,200 tests |
| 4. Explicit write/network and concurrency | Shared ordering across normal/client/subagent/script owners; no parent-child lock deadlock; approval edits rechecked; no detached work or automatic replay; bounded concurrent waves. Compare direct tools and cheap-child baselines. | Workspace execution arbitration, selected additional capabilities, batching/concurrency where measurements justify it. Keep default enablement unchanged pending evaluation. | 500-900 production, 700-1,200 tests |

Approximate total: **3,300-5,600 production LoC and 3,700-6,100 test LoC**, spread across small files. Phase 0 is an acceptance gate, not a commitment to broaden the project if the runtime proof fails. The usable read-only slice comes before write concurrency and optional TypeScript compilation.

Required observable acceptance cases, grouped by boundary:

1. **Catalog/authorization:** a disabled tool is absent from discovery and rejected if invoked by exact name; hidden-but-authorized tools remain callable in compact mode; explicit empty whitelist stays empty; `task`/recursive script calls fail; parent hook restrictions cannot be widened.
2. **Schema correctness:** required/optional/enum/union/array/ref cases produce usable declarations; generated names/descriptions cannot execute code; unresolved schema features do not grant authority; actual host validation rejects bad arguments.
3. **Policy parity:** the same call direct and scripted gets the same policy outcome; MCP uses its existing server policy identity; destructive shell checks remain in effect; changing tool input through hooks or approval edits cannot execute unauthorized arguments.
4. **Approval routing:** a script pauses mid-loop; only its exact child call receives the response; other sessions' approvals are ignored; denial/closed session/late UI response cannot resume work; noninteractive mode fails without a hung promise.
5. **Interpreter isolation:** guest cannot read seeded credential-like environment values, process globals, module imports, prototype paths to host functions, or the credential socket; sibling runs cannot observe each other's data. Use synthetic credentials, never actual secrets.
6. **Resource/lifetime:** infinite loop, recursive stack, microtask storm, unresolved promise, oversized/cyclic JSON, huge description/result, and IPC flood stop within configured bounds; abort during approval and during tool execution leaves no accepted work orphaned; abort-ignoring host work remains visibly owned until joined.
7. **Data fidelity:** structured results are bounded and unchanged; hook replacement is respected; partial acquisition is reported; media is rejected or represented by an explicit supported reference; final oversize yields an error, not malformed JSON.
8. **History/UI:** a script making twenty nested calls yields one ordinary provider tool response; nested statuses remain inspectable; resumed history contains no unmatched child tool responses; no script is rerun on replay.
9. **Subagent composition:** separate runtime identity and allowed selection; code mode inside a child does not launch another model or expose parent credentials; parent cancellation closes child script work; emitted child outputs still return through normal task semantics.
10. **Evaluation:** identical repo snapshot and questions for direct tools, code mode, and cheap child gathering; score source-grounded correctness/completeness first, then total inference usage, call counts, approvals, memory, and runtime. Do not accept apparent token savings caused by silently dropping evidence.

### B12. Risks, decisions, and remaining product questions

**Implementation decisions already made:** JavaScript guest first with TypeScript declarations; QuickJS-WASM only; dedicated process; no credential channel; session-admitted registry; sequential broker initially; child scheduler rather than parent reentrancy; per-call approvals; one model response; separate operational records; explicit structured outputs and completeness; no recursive scripts/tasks; no automatic retry or fallback.

**Engineering risks with defined next steps:**

- **Hook/effective-argument gap:** write policy-parity tests and correct the shared preparation stage before enabling the feature. Do not certify final-argument authorization from source inspection alone. [S3-S4]
- **Early output truncation:** measure selected producers and add explicit pagination/completeness contracts. A higher guest byte budget cannot repair already truncated output. [S6, A6, M2]
- **Reentrant scheduling/deadlock:** separate run owner and sequential admission; test completion callbacks rather than assuming scheduling completion means execution completion. [S1, S8-S9]
- **Concurrent mutation scope:** existing path ordering is batch-local. Require shared arbitration before write concurrency. [S1, S11]
- **Interpreter distribution:** prove package assets, supported OS launch behavior, Bun execution, and cleanup with the exact pinned dependency. No runtime switching if unavailable.
- **Sensitive data through permitted tools:** keep runtime provisioning credential-free; document that approved tool results can contain secrets. Read-only is not equivalent to confidential-data-safe.
- **Prompt injection in schemas/tool results:** descriptions remain untrusted, host policy remains authoritative, no guest access to approval/configuration controls.
- **Persistent logs replacing context bloat:** byte-bound transcripts/events and avoid raw intermediate persistence. Existing telemetry metadata must not become a second path around prompt privacy. [H3]
- **Result accuracy:** expose partial/unknown coverage; validate deterministic aggregation against direct tools. Never infer full coverage from successful process exit.

True product-direction questions, with recommended defaults so implementation need not wait:

1. **Is broad write/network automation a launch goal?** Recommend shipping read-only opt-in first. If broad automation is required at launch, Phase 4 ownership/arbitration and approval tests become release requirements rather than follow-on work.
2. **Should ordinary tool schemas disappear by default?** Recommend `alongside` during evaluation, then offer `compact` explicitly. Default replacement should follow comparative evidence for the actual supported models.
3. **Does the product require protection against a compromised interpreter/runtime, or isolation within a trusted interpreter?** This design assumes a trusted WASM runtime and audited bindings. If an OS-level boundary against runtime compromise is mandatory, require a distinct no-mount/no-network runner container profile and accept its deployment requirements; do not imply that a scrubbed subprocess already supplies that guarantee.
4. **How much nested data should remain inspectable after the run?** Recommend bounded operational records and excerpts, with no raw intermediate persistence by default. Full evidence retention would require a separate storage/privacy budget and user-visible setting.

## Source reference ledger

All paths are relative to the repository root above. Each file listed here was read during this investigation; selected large files were read in relevant ranges rather than necessarily in full.

### Tools and catalog

- **T1:** `packages/tools/src/tools/tools.ts`: `ToolInvocation`, `BaseToolInvocation`, `ToolBuilder`, `DeclarativeTool`, `BaseDeclarativeTool`, `ToolResult`, confirmation details and `Kind`.
- **T2:** `packages/tools/src/tools/tool-registry.ts`: `ToolRegistry`, `DiscoveredTool`, registration, governance, declaration transforms, lazy MCP, command discovery.
- **T3:** `packages/core/src/config/toolRegistryFactory.ts`: `createToolRegistry`, `TaskToolRegistration`, builtin/agent tool registration and injected adapters.
- **T4:** `packages/agents/src/session/session-tool-catalog-owner.ts`: `SessionToolCatalogOwner`, `selection`, initialization, declaration/resolution/admission, MCP session rebinding.
- **T5:** `packages/core/src/services/tool-dispatch-admission.ts`: `ToolDispatchAdmission` and wrapped invocation lifetime.
- **T6:** `packages/tools/src/interfaces/tool-catalog-operations.ts`: `ToolLookup`, `ToolSelection`, `McpToolPublication`, `ToolPublication`.

### Scheduler, policy, loop, and providers

- **S1:** `packages/agents/src/core/coreToolScheduler.ts`: concrete `CoreToolScheduler`, queueing, dispatch, approval, launch, completion, cancellation/join.
- **S2:** `packages/agents/src/scheduler/tool-dispatcher.ts`: `ToolDispatcher.resolveAndValidate`, `buildInvocation`.
- **S3:** `packages/agents/src/scheduler/confirmation-coordinator.ts`: `ConfirmationCoordinator`, policy fast path, interactive routing and response/edit handling.
- **S4:** `packages/agents/src/scheduler/tool-executor.ts`: `ToolExecutor.execute`, hook input/output behavior.
- **S5:** `packages/agents/src/scheduler/result-aggregator.ts`: `ResultAggregator`, result ordering, `publishResult`, batch output settings.
- **S6:** `packages/core/src/utils/generateContentResponseUtilities.ts`; `packages/core/src/utils/toolOutputLimiter.ts`: function response/error conversion and token limits.
- **S7:** `packages/core/src/core/turn.ts`: `ToolCallRequestInfo`, `ToolCallResponseInfo`, neutral event types and note locating concrete Turn in agents.
- **S8:** `packages/agents/src/session/sessionSchedulerOwner.ts`: `SessionSchedulerOwner`, `SchedulerLease`, owned teardown.
- **S9:** `packages/agents/src/session/turn-tool-execution-owner.ts`: `TurnToolExecutionOwner.begin/acquire/retire` and approval admission.
- **S10:** `packages/agents/src/session/assembleSchedulerOwner.ts`; `packages/agents/src/session/session-execution-owner.ts`; `packages/agents/src/session/clientToolChannel.ts`: scheduler composition and loop/client execution ownership.
- **S11:** `packages/agents/src/scheduler/mutation-ordering.ts`: `launchCallsWithSamePathOrdering`, `Kind.Edit/Delete/Move` selection, lexical path normalization, batch-local dependency map, and cancellation of waiting mutations. Symlink/hardlink aliases and cross-process locking are outside its contract.
- **Y1:** `packages/policy/src/policy-engine.ts`: `PolicyEngine.evaluate`, rule priority, destructive shell checks, subcommand checks, noninteractive handling.
- **Y2:** `packages/policy/src/confirmation-bus/message-bus.ts`: `MessageBus`, decision port, publish/subscribe/confirmation.
- **Y3:** `packages/core/src/policy/policy-helpers.ts`: invocation policy context, `evaluatePolicyDecision`, denial/confirmation publication.
- **Y4:** `packages/core/src/policy/policy-owner.ts`: `WorkspacePolicyOwner`, `SessionPolicyOwner`, `RuntimePolicyOwner`.
- **L1:** `packages/agents/src/core/turn.ts`: `Turn`, tool event emission and pending-call normalization.
- **L2:** `packages/agents/src/core/agenticLoop/AgenticLoop.ts`: `scheduleAndAwait`, callback acquisition, continuation and terminal recording.
- **L3:** `packages/agents/src/core/chatSession.ts`: `recordCompletedToolCalls`, `addHistory`; `packages/agents/src/core/ConversationManager.ts`: `recordHistory` and `HistoryService.addBatch`.
- **L4:** `packages/agents/src/session/record-tool-completions.ts`; `packages/agents/src/session/bind-turn-model.ts`: completion helper and bound stream/history callbacks.
- **P1:** `packages/providers/src/IProvider.ts`: `GenerateChatOptions`, `ProviderToolset`, `IProvider.generateChatCompletion`.
- **P2:** `packages/providers/src/anthropic/AnthropicStreamProcessor.ts`: streamed argument accumulation and `completeToolCall`.
- **P3:** `packages/agents/src/core/StreamProcessor.ts`: `_sendProviderRequest`.
- **P4:** `packages/agents/src/core/TurnProcessor.ts`: `_executeProviderCall`.
- **P5:** `packages/providers/src/ProviderContentGenerator.ts`: unsupported direct generation surface.

### MCP, children, process, and product integration

- **M1:** `packages/mcp/src/client/mcp-tool.ts`: `DiscoveredMCPTool`, `DiscoveredMCPToolInvocation`, session approval rebinding, policy identity and content transformation.
- **M2:** `packages/mcp/src/client/mcp-callable-tool.ts`: `McpCallableTool`, SDK call authorization and aggregate byte bound.
- **M3:** `packages/mcp/src/client/mcp-discovery.ts`: `discoverTools`, `processToolDefinition`, SDK definition wrapping.
- **G1:** `packages/agents/src/tools/task.ts`: `TaskTool`, invocation launch/execution and result formation.
- **G2:** `packages/agents/src/tools/taskAsyncExecution.ts`: `executeAsyncTask`, background ownership and completion.
- **G3:** `packages/agents/src/core/subagentOrchestrator.ts`; `packages/agents/src/core/subagentProfileResolution.ts`: launch/profile/runtime identity.
- **G4:** `packages/agents/src/api/child-agent-assembly.ts`; `packages/agents/src/core/subagent-runtime-loader.ts`: child config/settings/provider/runtime assembly.
- **G5:** `packages/agents/src/core/subagent.ts`; `packages/agents/src/core/subagentRuntimeSetup.ts`: `SubAgentScope`, tool/chat setup and admitted child selection.
- **G6:** `packages/agents/src/core/subagentScheduler.ts`; `packages/agents/src/core/subagentToolProcessing.ts`: child tool execution contracts, emitted outputs and completion processing.
- **G7:** `packages/agents/src/core/nonInteractiveToolExecutor.ts`: `executeToolCall` through a scheduler lease.
- **G8:** `packages/agents/src/session/childToolAssembly.ts`; `packages/agents/src/session/task-launch-owner.ts`: child execution rebinding and `TaskLaunchOwner.start`, controllers, registered IDs, accepted launch promises, and notice ownership.
- **A1:** `packages/auth/src/proxy/proxy-socket-client.ts`; `packages/auth/src/proxy/proxy-provider-key-storage.ts`; `packages/providers/src/auth/proxy/credential-proxy-server.ts`: credential client/handshake and server `handleGetApiKey`.
- **A2:** `packages/cli/src/utils/sandbox.ts`: `start_sandbox` and backend selection/cleanup.
- **A3:** `packages/cli/src/config/sandboxConfig.ts`: sandbox engine/profile resolution.
- **A4:** `packages/cli/src/utils/sandbox-containers.ts`: `buildContainerRunArgs`, mounts, resource/network settings.
- **A5:** `packages/cli/src/utils/sandbox-credential-proxy.ts`; `packages/cli/src/utils/sandbox-capability.ts`; `packages/cli/src/utils/sandbox-credential-runtime.ts`: proxy setup, host-only token env file and socket lifetime.
- **A6:** `packages/core/src/services/shellExecutionService.ts`: `ShellExecutionService`, process spawn, PTY lifecycle, environment sanitizer.
- **A7:** `packages/tools/src/tools/shell.ts`; `packages/core/src/tools-adapters/CoreShellToolHostAdapter.ts`: shell invocation and host execution adapter.
- **A8:** `packages/cli/src/utils/sandbox-seatbelt.ts`; `packages/cli/src/utils/sandbox-env.ts`: environment assembly, removal of capability markers, passthrough/mount helpers.
- **A9:** `packages/tools/src/acquisition/index.ts`; `packages/auth/src/proxy/framing.ts`: bounded acquisition exports and bounded framing concepts.
- **U1:** `packages/agents/src/session/childToolDisplay.ts`: `ChildToolDisplay.open/subscribe/clear`.
- **U2:** `packages/cli/src/runtime/interactiveToolScheduler.ts`: `useScheduler`, `useChildToolDisplay`, callback identities.
- **U3:** `packages/cli/src/ui/hooks/useReactToolScheduler.ts`: `useReactToolScheduler`, execution-symbol-indexed display state, bound main display updates, and integration with `useScheduler`/`useChildToolDisplay`.
- **H1:** `packages/core/src/recording/types.ts`: session event envelope, content versus operational metadata.
- **H2:** `packages/core/src/recording/RecordingIntegration.ts`: history-to-recording ownership and persistence bridge.
- **H3:** `packages/telemetry/src/telemetry/loggers.ts`: `logToolCall`, local metrics, export/privacy treatment.
- **C1:** `packages/settings/src/settings/settingsRegistry.ts`: registry composition, setting classification, session-key constraints, profile persistence.
- **C2:** `packages/core/src/session/session-settings-owner.ts`: `readToolExecutionPolicy`, `readToolGovernance`.
- **C3:** `package.json`; `packages/agents/package.json`; dependency-name searches of `packages/*/package.json`: TypeScript toolchain, Bun scripts, no selected sandbox dependency established.
- **C4:** `dev-docs/RULES.md`: mandatory behavior-first tests, TypeScript and Bun testing conventions.

## Delivery status

Architecture mapping and proposed design are complete. This file is the only intended artifact. Source code, dependencies, settings, and `.llxprt/` were not modified. Runtime claims requiring experiments are identified as Phase 0 gates; no performance or security certification is implied. OCR review was not run, per the standing instruction to skip it.
