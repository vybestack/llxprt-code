<!-- @plan:PLAN-20260621-COREAPIREMED.P02 @requirement:REQ-001,REQ-005,REQ-INT-001 -->
# Pseudocode: Config-Injection Seam (`fromConfig`)

Component target: `packages/agents/src/api/fromConfig.ts` (CREATE) +
`packages/agents/src/api/createAgent.ts` (MODIFY: extract shared finalize) +
`packages/agents/src/api/agentBootstrap.ts` (MODIFY: `adoptExternalConfig`).
Requirements: REQ-001, REQ-001.1/.2/.3, REQ-005, REQ-INT-001.

---

## Interface Contracts

```typescript
// INPUTS this component receives:
interface FromConfigOptions {
  readonly config: Config;                        // adopted, caller-owned
  readonly messageBus?: MessageBus;               // CRIT-2: caller (#1595) hands the SHARED bus here;
                                                  //   Config has NO getMessageBus() accessor to read it back.
  readonly onApproval?: ApprovalHandler;
  readonly onOAuthPrompt?: OAuthPromptHandler;
  readonly editorCallbacks?: EditorCallbacks;
  readonly toolSchedulerFactory?: AgentSchedulerFactory;
  readonly sessionId?: string;
}

// NOTE (CRIT-2): `Config` has NO getMessageBus() accessor (verified: only initialize({messageBus?})
// consumes one). The shared bus is therefore passed in explicitly by the caller (#1595) via
// `FromConfigOptions.messageBus` and forwarded into createIsolatedRuntimeContext's EXISTING
// `messageBus?` seam (runtimeContextFactory.ts ~L199, adopted at ~L482-484). Do NOT read it back
// off the Config.

// NOTE (CRIT-1): The provider manager is ADOPTED from the supplied Config via
// `config.getProviderManager()` (Config.getProviderManager(): RuntimeProviderManager | undefined,
// configBaseCore.ts:265) and forwarded into createIsolatedRuntimeContext's NEW `providerManager?`
// seam (added in P03-P05). The factory builds a manager ONLY when none is supplied.
//
// TYPE-SAFETY (CRIT-1, verified): the P03-P05 seam types `providerManager?` as the STRUCTURAL core
// interface `RuntimeProviderManager` (NOT the concrete providers `ProviderManager` class). Because
// `config.getProviderManager()` ALSO returns `RuntimeProviderManager | undefined`, fromConfig passes
// the value DIRECTLY into the option with ZERO assertion — no `as ProviderManager`, no `as any`, no
// `as unknown as ...`. The `RuntimeProviderManager | undefined` from getProviderManager() is exactly
// the option's `RuntimeProviderManager | undefined` shape (undefined → factory builds one). This is
// what makes the adoption path type-safe under the no-`any`/no-unsafe-assertion rule.

// OUTPUTS this component produces:
//   Promise<Agent>  (the SAME facade type createAgent returns)

// DEPENDENCIES this component requires (NEVER stubbed):
interface Dependencies {
  createIsolatedRuntimeContext: typeof import('@vybestack/llxprt-code-providers/runtime.js').createIsolatedRuntimeContext;
  finalizeAgent: (...) => Promise<Agent>;         // EXTRACTED shared helper (existing logic)
  generateRuntimeId: () => string;                // existing import (createAgent.ts:57)
}
```

The existing `finalizeAgent` (createAgent.ts:210) and `assembleFacade` (createAgent.ts:327) are
the SHARED path. `fromConfig` MUST call the SAME extracted finalize, NOT a parallel copy.

---

## Numbered Pseudocode

```
# ---- fromConfig() : public adopt entry ----
10: FUNCTION fromConfig(options: FromConfigOptions) -> Promise<Agent>
11:   IF options.config is null/undefined
12:     THROW AgentBootstrapError('fromConfig requires an existing Config')
13:   VALIDATE the small validatable portion: FromConfigValidatableSchema.parse({ sessionId: options.sessionId })
14:   SET config = options.config                      # ADOPT — do NOT construct
15:   SET runtimeId = options.sessionId ?? deriveRuntimeIdFromConfig(config) ?? generateRuntimeId()
16:   SET settingsService = config.getSettingsService()    # reachable from Config (no new SS)
17:   SET messageBus = resolveMessageBus(options.messageBus, config)  # CRIT-2: adopt caller bus; see 60-69
18:   SET adoptedManager = config.getProviderManager()    # CRIT-1: existing manager on the adopted Config (may be undefined).
                                                          # Type is RuntimeProviderManager | undefined — EXACTLY the
                                                          # providerManager? option's type; passed in with NO assertion.
19:   # ---- adopt runtime context (NOT construct a second ProviderManager) ----
20:   SET handle = createIsolatedRuntimeContext({
21:                  runtimeId,
22:                  settingsService,                  # SAME instance as config's
23:                  config,                           # adopt external Config (options field exists: factory L187)
24:                  messageBus,                       # adopt caller bus via EXISTING seam (factory L199, L482-484)
25:                  providerManager: adoptedManager,  # CRIT-1: adopt via NEW seam (P03-P05); factory builds one only if undefined
26:                  model: safeActiveModelName(config),
27:                  prepare: (ctx) => registerProvidersOntoManager(ctx.providerManager, ctx, ctx.config)
28:                })
29:   AWAIT handle.activate()                          # register so switch pipeline resolves THESE
30:   # ---- conditional init/auth (skip if already done) ----
31:   IF NOT isConfigInitialized(config)
32:     AWAIT config.initialize({ messageBus })
33:   IF NOT hasPostAuthClient(config)
34:     SET resolvedAuth = resolveAuthForAdoptedConfig(config)
35:     AWAIT config.refreshAuth(resolvedAuth.authMethod)
36:   # ---- SHARED finalize (identical to createAgent) ----
37:   RETURN AWAIT finalizeAgent({
38:            config,
39:            handle,
40:            messageBus,
41:            runtimeId,
42:            sessionId: options.sessionId,
43:            onApproval: options.onApproval,
44:            onOAuthPrompt: options.onOAuthPrompt,
45:            editorCallbacks: options.editorCallbacks,
46:            toolSchedulerFactory: options.toolSchedulerFactory,
47:            configOwnership: 'caller'             # REQ-001.3 marker threaded to dispose
48:          })
49: END FUNCTION

# ---- createAgent() : MODIFIED to share finalize, behavior UNCHANGED ----
50: FUNCTION createAgent(rawConfig: AgentConfig) -> Promise<Agent>
51:   # steps unchanged from shipped impl through refreshAuth (createAgent.ts:71-183)
52:   SET parsed = AgentConfigSchema.parse(rawConfig)
53:   SET runtimeId = parsed.sessionId ?? generateRuntimeId()
54:   SET config = new Config(params)                 # UNCHANGED — createAgent still constructs
55:   SET handle = createIsolatedRuntimeContext({ ...constructed-config... })
56:   AWAIT handle.activate()
57:   AWAIT config.initialize({ messageBus })
58:   AWAIT config.refreshAuth(resolvedAuth.authMethod)
59:   RETURN AWAIT finalizeAgent({ config, handle, messageBus, runtimeId,
60:            sessionId: parsed.sessionId, onApproval: parsed.onApproval, ...,
61:            configOwnership: 'agent' })            # REQ-001.3 — created Config is Agent-owned
62: END FUNCTION

# ---- resolveMessageBus(callerBus, config) : adopt caller bus, never construct a second (CRIT-2) ----
63: FUNCTION resolveMessageBus(callerBus: MessageBus | undefined, config) -> MessageBus
64:   IF callerBus exists                            # caller (#1595) passed the SHARED bus explicitly
65:     RETURN callerBus
66:   # Config has NO getMessageBus() accessor (verified) — DO NOT attempt to read one back.
67:   # When no shared bus is supplied, build ONE from the config's policy engine, exactly as
68:   # createAgent does today (this is a single bus for this runtime, not a "second" one).
69:   SET policy = config.getPolicyEngine()
70:   SET bus = new MessageBus(policy, config.getDebugMode())
71:   RETURN bus
72: END FUNCTION

# ---- guards for conditional init/auth ----
# NOTE: Config has NO public isInitialized() accessor (verified: config.ts has only the PRIVATE
# getAgentClientIfReady() at :192 and the agent client's own client.isInitialized() at :197). The
# ONLY public readiness signal is config.getAgentClient() (configBaseCore.ts:523, PUBLIC), whose
# field is definite-assignment (`agentClient!`) so it is runtime-undefined BEFORE Config.initialize()
# despite the non-nullable return TYPE. Guard the runtime-undefined case with `?.` and use the
# client's own isInitialized().
73: FUNCTION isConfigInitialized(config) -> boolean
74:   RETURN config.getAgentClient()?.isInitialized() === true   # public readiness signal; no Config.isInitialized()
75: END FUNCTION
76: FUNCTION hasPostAuthClient(config) -> boolean
77:   RETURN config.getAgentClient()?.isInitialized() === true   # post-auth client is present AND initialized
78: END FUNCTION
```

---

## Integration Points (Line-by-Line)

```
Line 14: SET config = options.config
         - MUST NOT call `new Config(...)`. Adoption only.
Line 17: resolveMessageBus(options.messageBus, config)  (CRIT-2)
         - Adopt the caller-supplied bus; Config has NO getMessageBus() — do NOT read one back.
Line 18: adoptedManager = config.getProviderManager()  (CRIT-1)
         - Config.getProviderManager(): RuntimeProviderManager | undefined (configBaseCore.ts:265).
         - The P03-P05 seam option is `providerManager?: RuntimeProviderManager`, so this value is
           passed DIRECTLY into createIsolatedRuntimeContext with NO assertion / NO `any`. There is
           no bridge/narrowing helper needed — the types already match.
Line 20-28: createIsolatedRuntimeContext({ config, settingsService, messageBus, providerManager, ... })
         - `config` option field EXISTS at runtimeContextFactory.ts:187.
         - `messageBus` option field EXISTS at runtimeContextFactory.ts:199 (adopted at L482-484).
         - `providerManager` option field is ADDED by P03-P05 (NEW seam) and adopted at the former
           unconditional `new ProviderManager(...)` site. When `adoptedManager` is undefined the
           factory constructs one (single manager for that runtime, unchanged default).
         - prepare callback registers providers via the SAME registerProvidersOntoManager
           helper createAgent uses (createAgent.ts:438) — do NOT inline a copy.
Line 29: AWAIT handle.activate()
         - REQUIRED so getCliRuntimeServices() resolves THESE instances (B5).
Line 31-35: conditional init/auth
         - MUST skip if the adopted Config is already initialized/authed (CLI Config from
           loadCliConfig is typically already initialized). Double-init would create a second
           client / leak.
         - The readiness signal is `config.getAgentClient()?.isInitialized() === true` (lines 73-78).
           There is NO public `Config.isInitialized()` (verified: config.ts has the PRIVATE
           getAgentClientIfReady() at :192 and the client's own isInitialized() at :197). The public
           `getAgentClient()` (configBaseCore.ts:523) returns a definite-assignment field that is
           runtime-undefined before initialize(), so the `?.` guard is required. The fromConfig tests
           (P08) MUST prove an already-initialized Config is NOT double-initialized.
Line 37-48: finalizeAgent(...)
         - SAME extracted helper used by createAgent (Line 59). Single source of finalize.
         - configOwnership threaded to the dispose orchestration (REQ-001.3).
Line 54: createAgent still constructs (UNCHANGED) — proves non-breaking (REQ-006.2).
Line 63-72: resolveMessageBus(callerBus, config)  (CRIT-2)
         - Returns callerBus when supplied; otherwise builds ONE bus from the policy engine exactly
           as createAgent does today. NEVER references a non-existent Config.getMessageBus().
```

---

## Anti-Pattern Warnings

```
[ERROR] DO NOT: const config = new Config(params)        // inside fromConfig — must ADOPT
[OK]   DO:     const config = options.config

[ERROR] DO NOT: const ss = new SettingsService()         // second settings store
[OK]   DO:     const ss = config.getSettingsService()    // reachable from adopted Config

[ERROR] DO NOT: copy finalize logic into fromConfig      // parallel implementation
[OK]   DO:     call the extracted shared finalizeAgent(...)

[ERROR] DO NOT: always call config.initialize()+refreshAuth() // double-init an already-ready Config
[OK]   DO:     guard with isConfigInitialized()/hasPostAuthClient()

[ERROR] DO NOT: dispose options.config in Agent.dispose() // caller-owned
[OK]   DO:     thread configOwnership:'caller' so dispose skips it (REQ-001.3)

[ERROR] DO NOT: create fromConfig as createAgent overload changing createAgent's type
[OK]   DO:     export a SEPARATE fromConfig function (additive, non-breaking)

[ERROR] DO NOT: cast the adopted manager — `config.getProviderManager() as ProviderManager`,
                `... as any`, `... as unknown as ProviderManager`   // unsafe; defeats no-`any` rule
[OK]   DO:     pass `config.getProviderManager()` straight into the `providerManager?:
              RuntimeProviderManager` option (types already match; undefined → factory builds one)
```
