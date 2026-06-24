<!-- @plan:PLAN-20260617-COREAPI.P02 @requirement:REQ-001 -->
# Pseudocode: createAgent (bootstrap composition)

Plan ID: PLAN-20260617-COREAPI
Phase: P02 (finalized)
Component: `packages/agents/src/api/createAgent.ts`
Requirements: REQ-001 (bootstrap), REQ-002 (adapter call), REQ-007 (loop), REQ-016 (ownership)

---

## INPUTS / OUTPUTS / DEPENDENCIES

See **Interface Contracts** section below for the full INPUTS, OUTPUTS, and
DEPENDENCIES blocks (these sections are required for every pseudocode file so impl
phases can cite exact numbered step labels).

---

---

## Verified real-code facts (pinned — do not re-derive in impl)

- **Shared runtime context is REQUIRED (B5/B6).** The provider switch/mutation
  pipeline (`switchActiveProvider`, `setActiveModel`, `applyProfileSnapshot`,
  `updateActiveProvider*`) does NOT take a `Config` argument. Each reads its
  services via `getCliRuntimeServices()` → `{ config, settingsService, providerManager }`
  from a process-level runtime registry. The registry is populated by
  `setCliRuntimeContext(settingsService, config, { runtimeId })`
  (`packages/providers/src/runtime/runtimeLifecycle.ts`, re-exported from
  `@vybestack/llxprt-code-providers/runtime.js`). Therefore the Agent's Config,
  SettingsService and ProviderManager MUST be the SAME instances the runtime
  registry holds, under ONE `runtimeId`.
- **DO NOT use bare `createHeadlessProviderManager` (B6).** Verified
  (`packages/providers/src/composition/headlessFactory.ts`): it constructs its OWN
  `new SettingsService()` with a hardcoded `runtimeId: 'headless'` and does not
  expose that SettingsService/runtime context. Composing Config separately would
  give Config and ProviderManager two divergent settings sources, breaking
  auth/profile/settings precedence.
- **Use `createIsolatedRuntimeContext` instead (B6).** Verified
  (`packages/providers/src/runtime/runtimeContextFactory.ts:449`, re-exported as
  `createIsolatedRuntimeContext` from `@vybestack/llxprt-code-providers/runtime.js`).
  It builds a SHARED `SettingsService` + `Config` + `ProviderManager` +
  `OAuthManager` under one `runtimeId`, wires them with
  `createSettingsProviderRuntimeContext`, and returns an
  `IsolatedRuntimeContextHandle`:
  `{ runtimeId, metadata, settingsService, config, providerManager, oauthManager,
     activate(), cleanup() }`. Calling `handle.activate()` registers the context
  (via `setCliRuntimeContext`) so the switch pipeline resolves these exact
  instances. `handle.cleanup()` unregisters + tears down (wired into dispose, see
  dispose.md). The handle can adopt an externally-built `Config` via
  `options.config`; if omitted it builds one from `options` (see
  `resolveRuntimeConfig`).
- **`createAgentRuntimeState` requires `runtimeId` (B4).** Verified
  (`packages/core/src/runtime/AgentRuntimeState.ts`): `RuntimeStateParams` requires
  `runtimeId: string`, `provider: string`, `model: string` (optional `baseUrl?`,
  `proxyUrl?`, `modelParams?`, `sessionId?`). It throws
  `RuntimeStateError(RUNTIME_ID_MISSING)` when `runtimeId` is absent. The
  `runtimeId` MUST be the SAME id used for the runtime context above.
- **`handle.activate()` is ASYNC and MUST be awaited (B2).** Verified
  (`packages/providers/src/runtime/runtimeContextFactory.ts:310-319`,
  `:520-528`): `createIsolatedRuntimeContext` returns a handle whose
  `activate(): Promise<void> | void` runs an async activation closure
  (`buildActivateClosure`). The registration via `setCliRuntimeContext` happens
  INSIDE that closure. If activation is not awaited, `getCliRuntimeServices()` may
  resolve a stale/empty runtime when a switch/auth/profile mutation runs. The impl
  MUST `await handle.activate()` (line 56).
- **The runtime context builds its OWN private `MessageBus` and binds the
  context-created `OAuthManager` to it (B2).** Verified
  (`runtimeContextFactory.ts:472-479`): `createIsolatedRuntimeContext` constructs
  `const sessionMessageBus = new MessageBus(config.getPolicyEngine(),
  config.getDebugMode())` and passes it to `resolveOAuthManager(sessionMessageBus,
  ...)`. The returned `IsolatedRuntimeContextHandle`
  (`runtimeContextFactory.ts:218-228`) DOES NOT expose that bus, and `Config` has NO
  `getMessageBus`/`setMessageBus` method (verified — no such symbol in
  `packages/core/src/config/config.ts`). Therefore the pseudocode MUST NOT invent
  `handle.config.getMessageBus?()`. If `createAgent` builds a SEPARATE `MessageBus`
  for `Config.initialize`/`AgenticLoop`, the context-owned `OAuthManager` would
  publish OAuth prompts/status on a DIFFERENT channel than the one the Agent observes
  for tool confirmation/hooks — splitting REQ-006/008/015 across two buses.
- **PINNED bus-ownership model (B2) — REQUIRES a small production change to
  `createIsolatedRuntimeContext`.** `IsolatedRuntimeContextOptions`
  (`runtimeContextFactory.ts:185-208`) currently has NO `messageBus` field. The
  #1594 plan plans ONE caller-provided-bus seam implemented in P15: extend
  `IsolatedRuntimeContextOptions` with an optional `messageBus?: MessageBus`; when
  provided, `createIsolatedRuntimeContext` uses THAT instance as `sessionMessageBus`
  (instead of constructing its own) so the context-created `OAuthManager` binds to
  it. `createAgent` then constructs ONE `MessageBus` and threads the SAME instance
  through: the runtime-context options (→ OAuthManager), `config.initialize({
  messageBus })`, `AgenticLoop({ messageBus })`, hooks control, and tool control.
  This is the single observable channel REQ-006/008/015 require. (If the maintainer
  rejects the production change, the only conforming alternative is to NOT rely on
  the context-created OAuthManager and construct ALL bus-bound resources — including
  a replacement OAuthManager — from one explicit bus; the plan prefers the small
  seam.)
- **`AgenticLoop` caches its `agentClient` in a `private readonly` field (B1).**
  Verified (`packages/agents/src/core/agenticLoop/AgenticLoop.ts:162-186`): the
  constructor assigns `this.agentClient = options.agentClient` (readonly) and
  `runTurn` calls `this.agentClient.sendMessageStream(...)`
  (`AgenticLoop.ts:381-385`). The loop NEVER re-resolves the client. Therefore the
  "never cache the client" invariant CANNOT be satisfied by `resolveClient()` alone:
  after any client-rebinding mutation (`setProvider`/`setModel`/`setModelParam`/
  `applyProfile`/`auth.*` → `config.initializeContentGeneratorConfig()` replaces the
  config-owned client), the EXISTING `AgenticLoop` would keep driving the OLD client.
  PINNED mechanism: the Agent facade OWNS a `rebuildLoop()` operation that, after
  EVERY client-rebinding mutation, tears down the prior loop + its scheduler/bus
  subscriptions and constructs a NEW `AgenticLoop({ agentClient:
  config.getAgentClient(), config, messageBus, approvalHandler, displayCallbacks })`.
  `createAgent` performs the INITIAL `rebuildLoop()` (the loop is built once here and
  the same routine is reused on switch — see switch-rebind.md). `resolveClient()`
  remains the accessor `rebuildLoop()` uses to fetch the post-mutation client.

---

## Interface Contracts

```typescript
// INPUTS:
interface CreateAgentInput { config: AgentConfig }   // validated by AgentConfigSchema

// OUTPUTS:
type CreateAgentOutput = Promise<Agent>

// DEPENDENCIES (real, injected/imported — NEVER stubbed in impl):
interface Dependencies {
  createIsolatedRuntimeContext: (o: IsolatedRuntimeContextOptions) => IsolatedRuntimeContextHandle // providers/runtime.js
                                                                                                   // IsolatedRuntimeContextOptions extended with
                                                                                                   // `messageBus?: MessageBus` by P15 (B2)
  MessageBusCtor: typeof MessageBus                          // core (the ONE shared bus — B2)
  ConfigCtor: typeof Config                                  // core
  toConfigParameters: (c: AgentConfig) => ConfigParameters   // config-adapter.md
  buildAgentClientFactory: () => AgentClientFactory          // agents (owns AgentClient)
  createAgentRuntimeState: (o: RuntimeStateParams) => AgentRuntimeState // core (runtimeId REQUIRED)
  AgenticLoopCtor: typeof AgenticLoop                        // agents
  buildAgent: (deps) => Agent                                // agent facade ctor
}
```

> **`rebuildLoop` ownership (B1).** The `Agent` facade owns `rebuildLoop()` (defined
> in switch-rebind.md and used by every client-rebinding mutation). `createAgent`
> calls it ONCE for the initial loop (line 141 below constructs the first loop via
> the same routine the facade reuses). The facade NEVER hands a cached `AgentClient`
> to a long-lived loop; each `rebuildLoop()` constructs a fresh `AgenticLoop` bound to
> the CURRENT `config.getAgentClient()` and first aborts the prior run's
> facade-owned `AbortController` + unsubscribes the facade-RECORDED per-turn
> subscriptions (AgenticLoop has NO cancel/dispose method; it cancels via the
> AbortSignal passed to `run()` and self-cleans in run()'s `finally`).

## Integration Points

```
Line 37: new MessageBus(config_.getPolicyEngine(), config_.getDebugMode())
         - core; the ONE shared bus threaded into context options + initialize + every loop rebuild (B2)
Line 41: createIsolatedRuntimeContext({ runtimeId, config, messageBus, ... })
         - providers/runtime.js; builds SHARED Config+SettingsService+ProviderManager+OAuthManager
         - we pass our pre-built Config (with agentClientFactory) via options.config so the
           handle adopts it and binds the SAME SettingsService to the ProviderManager (B6)
         - we pass options.messageBus (P15 bootstrap seam) so the context-created OAuthManager binds to OUR bus (B2)
Line 58: await handle.activate()  - ASYNC (B2); registers context via setCliRuntimeContext({runtimeId})
                                     so switchActiveProvider/setActiveModel/applyProfileSnapshot resolve it (B5)
Line 81: await config.initialize({messageBus})- core; async; creates transient pre-auth client (DO NOT bind)
Line 96: await config.refreshAuth(authType)   - core (configBase.ts); creates NEW client, transfers history, disposes prev
Line 116: config.getAgentClient()             - core; resolve POST-auth client only
Line 141: rebuildLoop(...)                    - facade routine (switch-rebind.md): constructs the FIRST
                                                 AgenticLoop bound to config.getAgentClient(); reused on every switch (B1)
Line 63: switchActiveProvider(config.provider)- providers/runtime.js; REAL signature
                                                 (providerName, options?: ProviderSwitchOptions); ProviderSwitchOptions has
                                                 NO model field. switchActiveProvider rebuilds internally; the requested
                                                 model is applied AFTER the switch via setActiveModel + initializeContentGeneratorConfig
                                                 (lines 64-66) — NEVER passed as a switchActiveProvider argument.
```

## Anti-Pattern Warnings

```
[ERROR] DO NOT use bare createHeadlessProviderManager       [OK] createIsolatedRuntimeContext (shared settings) (B6)
[ERROR] DO NOT build Config + ProviderManager from 2 SettingsServices [OK] one shared context, one runtimeId
[ERROR] DO NOT call createAgentRuntimeState without runtimeId [OK] pass the shared runtimeId (B4)
[ERROR] DO NOT cache the AgentClient on the Agent          [OK] resolve config.getAgentClient() per call
[ERROR] DO NOT bind to the transient pre-auth client       [OK] bind only after refreshAuth (line 90+)
[ERROR] DO NOT refreshAuth before the context is active     [OK] order: context -> activate -> init -> auth
[ERROR] DO NOT swallow bootstrap errors                    [OK] let ordering errors reject the promise
[ERROR] DO NOT re-implement scheduling/continuation        [OK] delegate to AgenticLoop
[ERROR] DO NOT pass a model to switchActiveProvider        [OK] signature is (providerName, options?: ProviderSwitchOptions);
                                                              ProviderSwitchOptions has NO model field. Apply the model via
                                                              setActiveModel + initializeContentGeneratorConfig (lines 64-66/67-69).
```

## Numbered Pseudocode

```
10: METHOD createAgent(rawConfig)
11:   config = AgentConfigSchema.parse(rawConfig)            # validate; throws ZodError on bad input
12:   resolvedAuth = resolveAuthType(config.auth)            # map AgentConfig.auth -> authType + provider auth
13:   runtimeId = config.sessionId ?? generateRuntimeId()    # SINGLE id shared by context + runtime-state (B4/B6)
14:
20:   # ---- Step 1: ConfigParameters (adapter) + agentClientFactory injection ----
21:   agentClientFactory = buildAgentClientFactory()         # agents owns AgentClient
22:   params = toConfigParameters(config)                    # config-adapter.md
23:   params.agentClientFactory = agentClientFactory         # ensure config-owned client exists
24:   IF config.toolSchedulerFactory EXISTS
25:     params.toolSchedulerFactory = wrapSchedulerFactory(config.toolSchedulerFactory)
26:     # caller owns factory function; Agent owns scheduler instances it creates (T19/P24)
27:
30:   # ---- Step 2: construct Config ----
31:   config_ = new ConfigCtor(params)
32:
33:   # ---- Step 2b: construct the ONE shared MessageBus (B2) ----
34:   #   This single instance is threaded through: runtime-context options (-> OAuthManager),
35:   #   config_.initialize({messageBus}), every AgenticLoop rebuild, hooks control, tool control.
36:   #   It is the single observable channel REQ-006/008/015 require.
37:   messageBus = new MessageBusCtor(config_.getPolicyEngine(), config_.getDebugMode())
38:   settingsService = config_.getSettingsService()             # shared service passed to runtime context
39:
40:   # ---- Step 3: SHARED runtime context (Config + SettingsService + ProviderManager + OAuth) (B6) ----
41:   handle = createIsolatedRuntimeContext({
42:              runtimeId: runtimeId,
43:              settingsService: settingsService,
44:              config: config_,                             # adopt OUR Config; binds its SettingsService to the manager
45:              model: config.model,
46:              messageBus: messageBus })                    # P15 seam: context-created OAuthManager binds to THIS bus
47:   manager      = handle.providerManager                   # SAME SettingsService as config_ (B6 invariant)
48:   oauthManager = handle.oauthManager                      # bound to OUR `messageBus` because we passed it via options (B2)
49:   settingsService = handle.settingsService                # === config_.getSettingsService()
51:   # NOTE (B2): Config has NO getMessageBus/setMessageBus and the handle does NOT
52:   #   expose its session bus. `messageBus` is the ONE instance we constructed at
53:   #   constructed above and threaded into createIsolatedRuntimeContext.options.messageBus
54:   #   (the P15 bootstrap seam) so the context-created OAuthManager binds to THIS bus. Do
55:   #   NOT invent `handle.config.getMessageBus?()` and do NOT construct a second bus.
56:
57:   # ---- Step 4: ACTIVATE so the switch pipeline resolves THESE instances (B5) ----
58:   await handle.activate()                                # ASYNC (B2): setCliRuntimeContext(settingsService, config_, {runtimeId})
59:                                                          #   must be awaited or getCliRuntimeServices() may resolve a stale/empty runtime
60:
61:   # ---- Step 4b: apply initial provider/auth/baseUrl through REAL runtime mutators ----
62:   IF config.provider differs from runtime active provider
63:     await switchActiveProvider(config.provider)           # providers/runtime.js; signature is
                                                            #   (providerName: string, options?: ProviderSwitchOptions)
                                                            #   ProviderSwitchOptions has NO `model` field
                                                            #   (members: autoOAuth?, preserveEphemerals?,
                                                            #    skipModelDefaults?, addItem? — providerSwitch.ts:56-63).
                                                            #   switchActiveProvider REBUILDS the content generator
                                                            #   INTERNALLY (resolveModelToApply picks the default model);
                                                            #   it does NOT take a passed model.
64:     IF config.model differs from active model
65:       await setActiveModel(config.model)                 # providers/runtime.js (providerMutations.ts:406) — applies the
                                                            #   requested model; setActiveModel does NOT rebuild
66:       await config_.initializeContentGeneratorConfig()   # explicit rebuild (model-only changes do NOT auto-rebuild — P00a/B5)
67:   ELSE IF config.model differs from active model
68:     await setActiveModel(config.model)
69:     await config_.initializeContentGeneratorConfig()     # explicit model-only rebuild (B5)
70:   IF resolvedAuth.apiKey IS defined
71:     await updateActiveProviderApiKey(resolvedAuth.apiKey)
72:   IF resolvedAuth.baseUrl IS defined
73:     await updateActiveProviderBaseUrl(resolvedAuth.baseUrl)
74:   # provider/apiKey/baseUrl are NOT createIsolatedRuntimeContext options; passing
75:   # them there would be an excess-property/type error and would not configure auth.
76:   # NOTE: NEVER pass a model to switchActiveProvider — there is no `model` field on
77:   # ProviderSwitchOptions. The model is applied via setActiveModel + the explicit
78:   # initializeContentGeneratorConfig rebuild (or by seeding settings before the switch
79:   # so resolveModelToApply picks it up). Passing config.model as the 2nd arg is a type error.
80:
81:   # ---- Step 5: initialize (tools, MCP, extensions, scheduler) ----
82:   await config_.initialize({ messageBus })               # creates transient pre-auth client (DO NOT bind)
83:
95:   # ---- Step 6: auth (creates real client, transfers state, disposes prev) ----
96:   await config_.refreshAuth(resolvedAuth.authType)       # configBase.refreshAuth
97:
105:  # ---- Step 7: runtime state (runtimeId REQUIRED — B4) ----
106:  runtimeState = createAgentRuntimeState({
107:                   runtimeId: runtimeId,                  # MUST match the context runtimeId (B4)
108:                   provider: config.provider,
109:                   model: config.model,
110:                   baseUrl: resolvedAuth.baseUrl,
111:                   modelParams: config.modelParams,
112:                   sessionId: config.sessionId })
113:
115:  # ---- Step 8: bind POST-auth client ----
116:  client = config_.getAgentClient()                      # the real, post-auth client
117:  IF client IS null OR undefined
118:    THROW AgentBootstrapError('no post-auth agent client')
119:
130:  # ---- Step 9: build the multi-turn loop via the facade's rebuildLoop routine (B1) ----
131:  #   The loop is NOT cached "by ref"; AgenticLoop holds agentClient in a `private
132:  #   readonly` field (AgenticLoop.ts:162-186) and NEVER re-resolves it. So the facade
133:  #   owns rebuildLoop() (switch-rebind.md steps 10-27): it constructs a FRESH
134:  #   AgenticLoop bound to the CURRENT config.getAgentClient() and first aborts the
135:  #   prior run's facade-owned AbortController + unsubscribes the facade-RECORDED
136:  #   per-turn scheduler/bus subscriptions (NO loop cancel/dispose method exists —
137:  #   AgenticLoop cancels via the AbortSignal passed to run() and self-cleans in
138:  #   run()'s finally, AgenticLoop.ts:300-305). createAgent performs the INITIAL
139:  #   build; every client-rebinding mutation reuses the SAME routine.
140:  loopHolder = createLoopHolder()                         # mutable slot the facade + rebuildLoop share
141:  rebuildLoop({                                           # switch-rebind.md steps 10-27 (initial build: no prior loop to tear down)
142:    loopHolder,
143:    resolveClient: () => config_.getAgentClient(),        # R-CLIENT accessor (post-auth client)
144:    config: config_,
145:    messageBus,                                           # the ONE shared bus (B2)
146:    approvalHandler: config.onApproval,                   # may be undefined; loop SAFELY DENIES ASK_USER then (B7)
147:    displayCallbacks: deriveDisplayCallbacks(config.editorCallbacks),
148:    AgenticLoopCtor })
149:
150:  # ---- Step 10: assemble facade with ownership record ----
151:  ownership = recordOwnership({ runtimeHandle: handle, config: config_,
152:                                providerManager: manager, oauthManager,
153:                                messageBus, loopHolder, runtimeState })   # ownership holds the SLOT, not a fixed loop (B1)
154:  agent = buildAgent({ config: config_, providerManager: manager, oauthManager,
155:                       settingsService, runtimeId, runtimeHandle: handle,
156:                       messageBus, loopHolder, runtimeState, ownership,
157:                       rebuildLoop,                                       # facade reuses this on switch/auth/profile (B1)
158:                       resolveClient: () => config_.getAgentClient(),   # R-CLIENT
159:                       onOAuthPrompt: config.onOAuthPrompt,
160:                       editorCallbacks: config.editorCallbacks })
161:
165:  # ---- Step 11: fire SessionStart lifecycle hook ----
166:  await agent.hooks.trigger('SessionStart')              # REQ-015
167:
175:  RETURN agent
176: END METHOD
```

> **rebuildLoop contract (B1) — defined in switch-rebind.md steps 10-27.** Inputs:
> `{ loopHolder, resolveClient, config, messageBus, approvalHandler, displayCallbacks,
> AgenticLoopCtor }`. Behavior: (1) if `loopHolder.current` exists, abort the
> facade-owned `AbortController` for its active run (the `signal` passed into
> `AgenticLoop.run(message, signal)` — AgenticLoop has NO cancel/dispose method;
> it self-cleans in run()'s `finally` block: `unsubscribe(); this.isRunning = false`,
> AgenticLoop.ts:300-305) and unsubscribe the facade-RECORDED per-turn scheduler/bus
> subscriptions (the facade records these; there is NO loop method for this); (2)
> construct `new AgenticLoopCtor({ agentClient: resolveClient(), config, messageBus,
> approvalHandler, displayCallbacks })` bound to the CURRENT post-mutation client;
> (3) record a FRESH facade-owned `AbortController` for the new loop's next `run` and
> re-attach per-turn scheduler/bus subscriptions (recorded BY THE FACADE) to the new
> loop; (4) set `loopHolder.current` to the new loop. `createAgent` calls it once
> (initial build); `setProvider`/`setModel`/`setModelParam`/`applyProfile`/`auth.*`
> each call it AFTER the underlying client rebind so the next `run` drives the NEW
> client (verified `AgenticLoop` caches its client and never re-resolves it).

## Notes for impl phase
- **Lines 150-156 (ownership record — T13 anchor).** `recordOwnership(...)` returns
  the SAME mutable `OwnershipRecord` that `dispose()` receives (dispose.md
  Interface Contracts) and that holds the idempotency guard (`ownership.disposed`)
  plus the NET-NEW T13 completion markers (`lspShutDown` / `extensionsDisposed` /
  `sessionLocksReleased`). The facade MUST retain this record on a field literally
  named `ownership` (`this.ownership = ownership`) so it is reachable for disposal
  and observable by the T13 harness (`disposalProbe.captureProbe` reads
  `impl.ownership`). Do NOT clone or re-wrap it per call — dispose() mutates THIS
  instance and the harness captured the SAME reference pre-dispose.
- Line 37 constructs the ONE shared `MessageBus`; lines 41-48 thread it into the
  runtime context options (P15 bootstrap seam) so the context-created `OAuthManager` binds to
  it; line 81 passes the SAME instance to `config.initialize`; the same instance is
  used by every `rebuildLoop`, hooks control, and tool control (B2 single channel).
- Lines 41-50 encode the B6 shared-settings invariant: `manager` and `config_`
  observe the SAME `SettingsService` (`handle.settingsService === config_.getSettingsService()`).
  The harness asserts this identity/behavior (T25 sub-assertion; see specification.md).
- Line 58 `await handle.activate()` is ASYNC (B2) and is what makes
  `switchActiveProvider`/`setActiveModel`/`applyProfileSnapshot` (switch-rebind.md)
  resolve THIS agent's Config — without awaiting it those mutators may operate on a
  stale/empty runtime context (B5).
- **D2 (pinned):** line 63 calls `switchActiveProvider(config.provider)` with the REAL
  signature `(providerName: string, options?: ProviderSwitchOptions)` — there is NO
  `model` field on `ProviderSwitchOptions` (members: autoOAuth?, preserveEphemerals?,
  skipModelDefaults?, addItem? — providerSwitch.ts:56-63). `switchActiveProvider`
  resolves a default model internally via `resolveModelToApply` and REBUILDS the content
  generator internally; it does NOT take a passed model. The REQUESTED model is applied
  AFTER the switch via `setActiveModel(config.model)` (line 65/68) + the explicit
  `config_.initializeContentGeneratorConfig()` rebuild (line 66/69), because
  model-only changes do NOT auto-rebuild (P00a/B5). NEVER pass `config.model` as the
  2nd arg to `switchActiveProvider` (it is a type error and the model is silently not
  applied that way).
- Steps 106-112 encode the B4 fix: `createAgentRuntimeState` is called with the
  REQUIRED `runtimeId` (the same shared id), never `{provider, model}` alone.
- Step 116 encodes R-CLIENT post-auth binding.
- Steps 140-148 (B1): the loop is built via `rebuildLoop` (switch-rebind.md steps
  10-27), NOT cached "by ref". `AgenticLoop` holds its `agentClient` in a
  `private readonly` field and never re-resolves it, so every client-rebinding
  mutation MUST reconstruct the loop via the same routine. (B1/G1: there is NO loop
  cancel/dispose method — `rebuildLoop` aborts the facade-owned `AbortController` for
  the active run and unsubscribes facade-RECORDED per-turn subscriptions; the loop
  self-cleans in run()'s `finally`.)
- Step 146: with no `approvalHandler`, the loop converts an unsatisfiable
  non-interactive `ASK_USER` into a SAFE TOOL DENIAL (it does NOT throw) — see B7 in
  specification.md and tool-confirmation-merge.md.
- Line 158 `resolveClient` is the only client accessor the facade/`rebuildLoop` use
  (never a cached ref).
- `handle.cleanup()` is invoked by `dispose()` (dispose.md) to unregister the
  runtime context and tear down shared resources.
