<!-- @plan:PLAN-20260617-COREAPI.P02 @requirement:REQ-004/REQ-005 -->
# Pseudocode: provider/model switch + client rebind + history transfer

Plan ID: PLAN-20260617-COREAPI
Phase: P02 (finalized)
Component: `packages/agents/src/api/control/providerControl.ts`
Requirements: REQ-004 (switch wrapping providers/runtime), REQ-005 (context preservation)

---

## Verified real-code facts (pinned — B5 resolved before impl)

All switch/mutation functions are exported from `@vybestack/llxprt-code-providers/runtime.js`
(re-exported via `runtimeSettings.ts`). They take NO `Config` argument — they read
`{ config, settingsService, providerManager }` from the runtime registry via
`getCliRuntimeServices()`. They only resolve THIS agent's Config because
`createAgent` activated the shared runtime context (createAgent.md line 56). Verified
signatures and rebuild behavior:

- `switchActiveProvider(providerName: string, options: ProviderSwitchOptions = {}): Promise<ProviderSwitchResult>`
  (`providerSwitch.ts:803`). It REBUILDS the content generator INTERNALLY — its body
  calls `initializeContentGeneratorConfigIfSupported(context.config)`, which invokes
  `config.initializeContentGeneratorConfig()`. So after `switchActiveProvider` the
  client is already rebound and history already transferred. The facade MUST NOT call
  a separate rebuild after it. (This removes the old placeholder
  an invented switch-refresh helper.)
- `setActiveModel(modelName: string): Promise<ModelChangeResult>`
  (`providerMutations.ts:406`). It DOES NOT rebuild the content generator — it updates
  SettingsService, calls `config.setModel(modelName)`, and recomputes model defaults.
  There is NO `initializeContentGeneratorConfig` call. Therefore for a model-only
  change the facade MUST trigger the rebuild explicitly:
  `await config.initializeContentGeneratorConfig()`.
- `config.initializeContentGeneratorConfig(): Promise<void>` (`config.ts:329`) is the
  REAL rebuild + history-transfer method:
  `extractExistingState()` → `transferHistoryToNewClient()` (which calls
  `newAgentClient.storeHistoryServiceForReuse(existingHistoryService)` — SAME
  HistoryService by reference) → builds new content-generator config → new client →
  disposes the previous client. This is the named method the continuity guarantee
  (REQ-005, T4d/T4e/T4f) rests on.
- Profile application public entry is `applyProfileSnapshot` (re-exported from
  `runtime.js`, wraps the internal `applyProfileWithGuards`). It internally calls
  `switchProviderForProfile` → `switchActiveProvider`, so it ALSO rebuilds internally;
  the facade MUST NOT call a separate rebuild after it.
- **`AgenticLoop` caches its `agentClient` in a `private readonly` field (B1).**
  Verified (`packages/agents/src/core/agenticLoop/AgenticLoop.ts:162-186`): the
  constructor assigns `this.agentClient = options.agentClient` (readonly) and
  `runTurn` calls `this.agentClient.sendMessageStream(...)`
  (`AgenticLoop.ts:381-385`). The loop NEVER re-resolves the client. Therefore
  `resolveClient()` alone is NOT sufficient: after ANY client-rebinding mutation the
  EXISTING loop keeps driving the OLD client. The facade MUST own a `rebuildLoop()`
  routine that, after EVERY client-rebinding mutation, tears down the prior loop +
  its scheduler/bus subscriptions and constructs a NEW `AgenticLoop` bound to
  `config.getAgentClient()`. `reattachPerTurnSubscriptions` below is performed INSIDE
  `rebuildLoop` against the new loop. `createAgent` performs the INITIAL build via
  the same routine (createAgent.md steps 130-148).
- **Model-param mutators (B7).** Verified runtime exports
  (`packages/providers/src/runtime/runtimeAccessors.ts`): `setActiveModelParam(key,
  value)` (`:517`), `clearActiveModelParam(key)`, and `getActiveModelParams(): Record<string,
  unknown>`. These update SettingsService ephemeral model params; they DO NOT rebuild
  the content generator. The next provider call reads the current params, so the
  facade applies them LAZILY: it updates params via the runtime mutator and does NOT
  force `initializeContentGeneratorConfig` (unlike the model-only path). `getModelParams`
  reads `getActiveModelParams()` directly. T5 asserts the params reach the provider
  call on the NEXT turn.

---

## Interface Contracts

```typescript
// INPUTS:
interface SetProviderInput { provider: string; model?: string }
interface SetModelInput { model: string }
interface ApplyProfileInput { profile: Profile }   // standard or load-balancer

// OUTPUTS:
type SwitchOutput = Promise<void>                  // resolves after rebind; chat NOT reset

// DEPENDENCIES (providers/runtime.js — verified reachable from agents; NO config arg):
interface Dependencies {
  switchActiveProvider: (providerName: string, options?: ProviderSwitchOptions) => Promise<ProviderSwitchResult>
  setActiveModel: (modelName: string) => Promise<ModelChangeResult>
  applyProfileSnapshot: (profile: Profile, options?: ProfileLoadOptions) => Promise<ProfileLoadResult>
  setActiveModelParam: (key: string, value: unknown) => void          // runtimeAccessors.ts:517 (B7)
  clearActiveModelParam: (key: string) => void                        // runtimeAccessors.ts (B7)
  getActiveModelParams: () => Record<string, unknown>                 // runtimeAccessors.ts (B7)
  config: Config                                   // SAME instance registered in the runtime context
  resolveClient: () => AgentClient                 // R-CLIENT accessor (config.getAgentClient())
  rebuildLoop: (deps: RebuildLoopDeps) => Promise<void>               // B1 — constructs a fresh AgenticLoop
  loopHolder: { current?: AgenticLoop }            // mutable slot shared with createAgent (B1)
}

// rebuildLoop dependency bundle (B1) — the SAME shape createAgent.md passes:
interface RebuildLoopDeps {
  loopHolder: { current?: AgenticLoop }
  resolveClient: () => AgentClient
  config: Config
  messageBus: MessageBus
  approvalHandler?: ApprovalHandler
  displayCallbacks?: DisplayCallbacks
  AgenticLoopCtor: typeof AgenticLoop
}
```

## Integration Points

```
Line 10: rebuildLoop(...)                                 - B1; tears down prior AgenticLoop + subs,
                                                            builds a fresh one bound to resolveClient(); shared with createAgent
Line 30: await switchActiveProvider(provider)             - providers/runtime.js; REAL signature
                                                            (providerName, options?: ProviderSwitchOptions); ProviderSwitchOptions
                                                            has NO `model` field. REBUILDS content generator INTERNALLY.
                                                            The requested model (if any) is applied AFTER the switch via
                                                            setActiveModel + initializeContentGeneratorConfig (lines 34-36) —
                                                            NEVER passed as a switchActiveProvider argument.
Line 60: await config.initializeContentGeneratorConfig()  - ONLY for model-only change (setActiveModel does NOT rebuild)
         -> extractExistingState() -> transferHistoryToNewClient() -> new client
         SAME HistoryService reused by reference; prev client disposed
Line 80: await rebuildLoop(...)                           - resolveClient() returns the NEW client; the loop is RECONSTRUCTED
                                                            (AgenticLoop caches its client; re-resolution alone is insufficient — B1)
Line 130: setActiveModelParam / clearActiveModelParam     - providers/runtime.js (B7); ephemeral update; NO rebuild
Line 160: getActiveModelParams()                          - providers/runtime.js (B7); reads current params
```

## Anti-Pattern Warnings

```
[ERROR] DO NOT pass config to switchActiveProvider   [OK] it reads getCliRuntimeServices() (B5)
[ERROR] DO NOT pass a model to switchActiveProvider  [OK] ProviderSwitchOptions has NO model field; apply the model via
      — { model } is an excess-property        setActiveModel + initializeContentGeneratorConfig AFTER the switch (lines 34-36),
      error and is silently ignored;            or seed settings before the switch so resolveModelToApply picks it up.
      switchActiveProvider resolves the         switchActiveProvider signature is (providerName, options?: ProviderSwitchOptions).
      model internally via resolveModelToApply
[ERROR] DO NOT invent a switch-refresh helper  [OK] config.initializeContentGeneratorConfig() (B5)
[ERROR] DO NOT rebuild again after switchActiveProvider [OK] it already rebuilt internally
[ERROR] DO NOT resetChat on switch                    [OK] rely on config transfer path (history preserved)
[ERROR] DO NOT copy history manually                  [OK] HistoryService is handed by reference
[ERROR] DO NOT cache the old client                   [OK] re-resolve via resolveClient()
[ERROR] DO NOT keep the OLD AgenticLoop after a rebind [OK] rebuildLoop() reconstructs it (AgenticLoop caches client — B1)
[ERROR] DO NOT only reattach subscriptions on switch   [OK] reattach happens INSIDE rebuildLoop on the NEW loop (B1)
[ERROR] DO NOT rebuild the content generator on a model-param change [OK] params are lazy; next call reads them (B7)
[ERROR] DO NOT special-case LB failover               [OK] manual switch == failover (same path)
[ERROR] DO NOT skip stripThoughts normalization       [OK] the EXISTING Config transfer path performs it — NOT the facade. During history transfer
                                                            (config.initializeContentGeneratorConfig -> extractExistingState -> transferHistoryToNewClient),
                                                            the provider-incompatible thought-signature stripping (stripThoughtSignatures when
                                                            switching into Vertex, per overview/spec) is applied by the transfer path. The facade
                                                            does NOT call a separate normalization method. Verified behaviorally by T4f.
```

## Numbered Pseudocode

```
10: METHOD rebuildLoop(deps)                                  # shared by createAgent + every rebind (B1)
11:   oldLoop = deps.loopHolder.current
12:   IF oldLoop EXISTS
13:     deps.activeRunController?.abort()                      # facade-owned AbortController for the active run's signal (G1: AgenticLoop has NO cancel/dispose method; it cancels via the AbortSignal passed to run(message, signal) and self-cleans in run()'s finally — AgenticLoop.ts:300-305)
14:     unsubscribeFacadeRecordedSubscriptions(oldLoop)         # the FACADE recorded the per-turn MessageBus/scheduler subscriptions; there is NO loop method for this
15:   END IF
16:   currentClient = deps.resolveClient()                     # MUST be config.getAgentClient() after mutation
17:   newLoop = new deps.AgenticLoopCtor({
18:               agentClient: currentClient,                  # AgenticLoop caches this readonly; build fresh
19:               config: deps.config,
20:               messageBus: deps.messageBus,
21:               approvalHandler: deps.approvalHandler,
22:               displayCallbacks: deps.displayCallbacks })
23:   deps.activeRunController = createAbortController()         # fresh facade-owned controller; its .signal is passed to newLoop.run(message, signal)
24:   attachPerTurnSubscriptions(newLoop, deps.messageBus)       # subscriptions recorded BY THE FACADE into deps.busSubscriptions (unsubscribed by rebuildLoop/dispose, not by a loop method)
25:   deps.loopHolder.current = newLoop
26:   RETURN newLoop
27: END METHOD
28:
30: METHOD setProvider(provider, model?)
31:   oldClient = resolveClient()                              # the CURRENT client (pre-switch); resolveClient() is the facade's always-current accessor (R-CLIENT)
32:   prevHistoryService = oldClient.getHistoryService()       # G2: HistoryService lives on the AgentClient (AgentClientContract.getHistoryService(): HistoryService | null, clientContract.ts:54,73), NOT on Config; config's own continuity logic reads it from the client (config.ts:264,376)
33:   await switchActiveProvider(provider)                     # providers/runtime.js; REAL signature (providerName, options?: ProviderSwitchOptions);
                                                               #   ProviderSwitchOptions has NO `model` field (members: autoOAuth?, preserveEphemerals?,
                                                               #   skipModelDefaults?, addItem? — providerSwitch.ts:56-63). switchActiveProvider resolves a
                                                               #   default model internally via resolveModelToApply and REBUILDS the content generator
                                                               #   INTERNALLY — do NOT pass { model } (excess-property; silently ignored) and do NOT add a
                                                               #   separate rebuild after it.
34:   IF model IS defined AND model differs from active model
35:     await setActiveModel(model)                            # providers/runtime.js (providerMutations.ts:406) — applies the REQUESTED model; does NOT rebuild
36:     await config.initializeContentGeneratorConfig()        # explicit model-only rebuild (B5); SAME HistoryService reused by reference, prev client disposed
37:   newClient = resolveClient()                              # the NEW client (post-switch / post-model-rebuild)
38:   ASSERT newClient.getHistoryService() === prevHistoryService   # REQ-005 continuity: SAME HistoryService by reference (expected non-null — continuity transfer preserves the service); read via the NEW client, NOT config
39:   ASSERT newClient !== oldClient                          # client was rebound by Config transfer path
40:   await rebuildLoop(rebuildDeps)                           # B1: next AgenticLoop.run uses NEW client
41:   RETURN
42: END METHOD
43:
50: METHOD setModel(model)
51:   oldClient = resolveClient()                              # CURRENT client (pre-switch); R-CLIENT accessor
52:   prevHistoryService = oldClient.getHistoryService()       # G2: from the AgentClient, NOT Config (clientContract.ts:54,73)
53:   await setActiveModel(model)                              # providers/runtime.js; does NOT rebuild
54:   await config.initializeContentGeneratorConfig()          # explicit model-only rebuild (B5)
55:   newClient = resolveClient()                              # NEW client (post-rebuild)
56:   ASSERT newClient.getHistoryService() === prevHistoryService   # REQ-005 continuity (read via NEW client; expected non-null)
57:   ASSERT newClient !== oldClient
58:   await rebuildLoop(rebuildDeps)
59:   RETURN
60: END METHOD
61:
70: METHOD applyProfile(profile)
71:   oldClient = resolveClient()                              # CURRENT client (pre-switch); R-CLIENT accessor
72:   prevHistoryService = oldClient.getHistoryService()       # G2: from the AgentClient, NOT Config (clientContract.ts:54,73)
73:   result = await applyProfileSnapshot(profile)             # providers/runtime.js; rebuilds internally
74:   newClient = resolveClient()                              # NEW client (post-rebuild)
75:   ASSERT newClient.getHistoryService() === prevHistoryService   # REQ-005 continuity (read via NEW client; expected non-null)
76:   ASSERT newClient !== oldClient
77:   await rebuildLoop(rebuildDeps)
78:   RETURN result
79: END METHOD
80:
90: METHOD setModelParam(key, value)
91:   setActiveModelParam(key, value)                          # providers/runtime.js; lazy param update (B7)
92:   # no content-generator rebuild: params are read by the next provider call
93:   RETURN
94: END METHOD
95:
100: METHOD clearModelParam(key)
101:  clearActiveModelParam(key)                              # providers/runtime.js; lazy param update (B7)
102:  RETURN
103: END METHOD
104:
110: METHOD getModelParams()
111:  RETURN getActiveModelParams()                           # providers/runtime.js; current runtime params
112: END METHOD
```

## Notes for impl phase
- Lines 10-27 define the required B1 loop-rebuild mechanism. AgenticLoop caches its
  constructor client, so reattaching subscriptions is not enough; rebuildLoop must
  create a fresh loop after every client-rebinding mutation. G1: there is NO loop
  cancel/dispose method — the facade aborts its own `AbortController` (the `signal`
  passed to `run`) and unsubscribes the facade-RECORDED per-turn subscriptions
  (AgenticLoop self-cleans in run()'s `finally`).
- **D3 (pinned):** line 33 calls `switchActiveProvider(provider)` with the REAL
  signature `(providerName: string, options?: ProviderSwitchOptions)` — there is NO
  `model` field on `ProviderSwitchOptions` (members: autoOAuth?, preserveEphemerals?,
  skipModelDefaults?, addItem? — providerSwitch.ts:56-63). `{ model }` is an
  excess-property error and is silently ignored; `switchActiveProvider` resolves the
  model internally via `resolveModelToApply` (providerSwitch.ts:467,838-847). The
  REQUESTED model is applied AFTER the switch via `setActiveModel(model)` (line 35) +
  the explicit `config.initializeContentGeneratorConfig()` rebuild (line 36) — the
  SAME mechanism the setModel path (lines 53-54) already uses. NEVER pass `{ model }`
  to `switchActiveProvider`.
- Lines 33/73: `switchActiveProvider` and `applyProfileSnapshot` rebuild the content
  generator internally (verified) via `config.initializeContentGeneratorConfig`
  (`extractExistingState -> transferHistoryToNewClient -> new client, prev disposed`).
  Do NOT add a second content-generator rebuild after them; DO rebuild the AgenticLoop.
  (The setProvider model-only sub-path at lines 34-36 IS a model-only rebuild, NOT a
  second switch rebuild — it runs only when a specific model was requested and applies
  via setActiveModel, consistent with the setModel path.)
- Line 54: `setActiveModel` does NOT rebuild — the model-only path MUST call
  `config.initializeContentGeneratorConfig()` itself, otherwise the client is not
  rebound to the new model.
- Lines 38/56/75 are the REQ-005 continuity assertions
  (`existingHistoryService === newHistoryService`, read via the NEW client's
  `getHistoryService()` — G2: the HistoryService lives on the AgentClient, NOT Config;
  `prevHistoryService` is captured from the OLD client before the switch); lines
  39/57/76 assert client replacement; lines 40/58/77 assert the next AgenticLoop uses
  that new client.
- Lines 90-111 define model-param behavior: runtime mutators update lazy params and
  do not rebuild either the content generator or loop; T5 must prove the next provider
  call sees the updated params, not just getters.
- All mutators resolve THIS agent's Config only because `createAgent` activated the
  shared runtime context (createAgent.md line 58). If that context is not active, the
  mutators operate on a different/empty registry — an impl-phase precondition to assert.
