# CLI Runtime Adapter Integration Pseudocode

**Phase ID**: `PLAN-20251027-STATELESS5.P02`
**Analysis Date**: 2025-10-28

## Purpose

Define the CLI runtime adapter that bridges CLI runtime helpers (`runtimeSettings.ts`) and slash commands to the `AgentRuntimeState` abstraction. This adapter handles runtime state lifecycle, Config mirroring for UI compatibility, and provides a consistent API for CLI operations.

---

## CLI Runtime Adapter Architecture

**@requirement:REQ-STAT5-002.1** - CLI helpers delegate to runtime state mutators
**@requirement:REQ-STAT5-002.2** - CLI flags hydrate runtime state before command execution

### Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     CLI Bootstrap                            │
│  1. Parse flags → 2. Create runtime state → 3. Start app    │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                   AgentRuntimeAdapter                        │
│  - Manages foreground agent runtime state                    │
│  - Exposes settings API (getProvider, setModel, etc.)        │
│  - Mirrors updates to legacy Config for UI                   │
│  - Emits events for diagnostics/status panel                 │
└─────────────────────────────────────────────────────────────┘
                              ↓
        ┌─────────────────────┴─────────────────────┐
        ↓                                             ↓
┌──────────────────┐                      ┌──────────────────────┐
│  Slash Commands  │                      │  Runtime Helpers     │
│  /set, /provider │                      │  setRuntimeProvider  │
│  /model, /key    │                      │  getRuntimeModel     │
└──────────────────┘                      └──────────────────────┘
```

---

## Adapter Interface Definition

### Step 1: AgentRuntimeAdapter Class

**@requirement:REQ-STAT5-002.3** - Legacy Config mirrors update for diagnostics

```pseudocode
1. class AgentRuntimeAdapter {
2.   private runtimeState: AgentRuntimeState;
3.   private legacyConfig: Config;  // Phase 5: Mirror for UI
4.   private runtimeId: string;
5.
6.   constructor(
7.     initialState: AgentRuntimeState,
8.     legacyConfig: Config
9.   )
10. }
11.
12. function AgentRuntimeAdapter.constructor(initialState, legacyConfig):
13.   this.runtimeState ← initialState
14.   this.legacyConfig ← legacyConfig
15.   this.runtimeId ← initialState.runtimeId
16.
17.   // Mirror initial state to Config
18.   this.mirrorStateToConfig(initialState)
19.
20.   // Subscribe to runtime state changes
21.   this.unsubscribe ← subscribeToAgentRuntimeState(
22.     this.runtimeId,
23.     this.handleStateChange.bind(this)
24.   )
25.
26. function AgentRuntimeAdapter.handleStateChange(event: RuntimeStateChangedEvent): void
27.   // Update local reference
28.   this.runtimeState ← getAgentRuntimeState(this.runtimeId)
29.
30.   // Mirror to Config for UI components
31.   this.mirrorStateToConfig(this.runtimeState)
32.
33.   // Emit adapter-level event for diagnostics
34.   this.emit('runtimeStateUpdated', {
35.     runtimeId: this.runtimeId,
36.     snapshot: event.snapshot
37.   })
```

**Design Note**: Adapter maintains both runtime state and legacy config references

---

## Bootstrap & Initialization

**@requirement:REQ-STAT5-002.2** - CLI flags hydrate runtime state before execution

### Step 2: CLI Bootstrap Sequence

```pseudocode
1. async function bootstrapForegroundAgent(
2.   cliFlags: CliFlags,
3.   config: Config
4. ): Promise<{ adapter: AgentRuntimeAdapter, client: GeminiClient }>
5.
6.   // Phase A: Resolve runtime state from flags and config
7.   runtimeStateParams ← resolveRuntimeStateFromFlags(cliFlags, config)
8.
9.   // Phase B: Create runtime state
10.  runtimeState ← createAgentRuntimeState({
11.    runtimeId: 'foreground-agent',
12.    ...runtimeStateParams
13.  })
14.
15.  // Phase C: Create adapter
16.  adapter ← new AgentRuntimeAdapter(runtimeState, config)
17.
18.  // Phase D: Create history service
19.  historyService ← await HistoryService.create(
20.    runtimeState.sessionId,
21.    config.getSettingsService()
22.  )
23.
24.  // Phase E: Create GeminiClient with runtime state
25.  client ← new GeminiClient(
26.    config,           // Phase 5: Still pass for ephemeral settings
27.    runtimeState,     // New: Runtime state
28.    historyService    // New: Injected history service
29.  )
30.
31.  return { adapter, client }
```

**Migration Checkpoint**: CLI bootstrap creates both Config and AgentRuntimeState

### Step 3: Resolve Runtime State from CLI Flags

```pseudocode
1. function resolveRuntimeStateFromFlags(
2.   flags: CliFlags,
3.   config: Config
4. ): RuntimeStateParams
5.
6.   // Start with config defaults
7.   params ← {
8.     provider: config.getProvider(),
9.     model: config.getModel(),
10.    authType: config.getAuthType(),
11.    sessionId: config.getSessionId(),
12.    proxyUrl: config.getProxy()
13.  }
14.
15.  // Override with CLI flags (precedence: flags > config)
16.  if flags.provider:
17.    params.provider ← flags.provider
18.
19.  if flags.model:
20.    params.model ← flags.model
21.
22.  if flags.key or flags.keyfile:
23.    // CLI key overrides config auth
24.    params.authType ← AuthType.API_KEY
25.    params.authPayload ← {
26.      apiKey: flags.key || readKeyFromFile(flags.keyfile)
27.    }
28.
29.  if flags.set:
30.    // Process --set flags (e.g., --set base-url=...)
31.    for each (key, value) in flags.set:
32.      if key === 'base-url':
33.        params.baseUrl ← value
34.      else if key in modelParamKeys:
35.        params.modelParams ← params.modelParams || {}
36.        params.modelParams[key] ← value
37.
38.  if flags.profileLoad:
39.    // Load profile and merge settings
40.    profileSettings ← loadProfile(flags.profileLoad)
41.    params ← mergeProfileWithParams(params, profileSettings)
42.
43.  // Resolve auth payload from config if not set by flags
44.  if not params.authPayload:
45.    params.authPayload ← extractAuthPayloadFromConfig(config, params.authType)
46.
47.  return params
```

**Cross-reference**: Design Questions Q2 (CLI flag precedence)

---

## Settings API (Public Interface)

**@requirement:REQ-STAT5-002.1** - Runtime helpers delegate to runtime state

### Step 4: Read Operations

```pseudocode
1. // Synchronous getters (delegate to runtime state)
2. function AgentRuntimeAdapter.getProvider(): string
3.   return this.runtimeState.provider
4.
5. function AgentRuntimeAdapter.getModel(): string
6.   return this.runtimeState.model
7.
8. function AgentRuntimeAdapter.getAuthType(): AuthType
9.   return this.runtimeState.authType
10.
11. function AgentRuntimeAdapter.getSessionId(): string
12.   return this.runtimeState.sessionId
13.
14. function AgentRuntimeAdapter.getBaseUrl(): string | undefined
15.   return this.runtimeState.baseUrl
16.
17. function AgentRuntimeAdapter.getRuntimeState(): AgentRuntimeState
18.   return this.runtimeState
19.
20. function AgentRuntimeAdapter.getSnapshot(): RuntimeStateSnapshot
21.   return getAgentRuntimeStateSnapshot(this.runtimeState)
```

### Step 5: Write Operations (Single Field)

**@requirement:REQ-STAT5-002.3** - Updates mirror to Config for UI

```pseudocode
1. function AgentRuntimeAdapter.setProvider(providerName: string): void
2.   // Validate provider exists
3.   providerManager ← this.legacyConfig.getProviderManager()
4.   if not providerManager.hasProvider(providerName):
5.     throw new Error(`Provider '${providerName}' not found`)
6.
7.   // Get default model for provider
8.   defaultModel ← providerManager.getProvider(providerName).getDefaultModel()
9.
10.  // Batch update: provider + model
11.  updates ← {
12.    provider: providerName,
13.    model: defaultModel,
14.    baseUrl: undefined  // Clear custom base URL
15.  }
16.
17.  // Update runtime state with config mirror
18.  this.runtimeState ← updateRuntimeStateWithConfigMirror(
19.    this.runtimeState,
20.    updates,
21.    this.legacyConfig
22.  )
23.
24. function AgentRuntimeAdapter.setModel(modelName: string): void
25.   updates ← { model: modelName }
26.   this.runtimeState ← updateRuntimeStateWithConfigMirror(
27.     this.runtimeState,
28.     updates,
29.     this.legacyConfig
30.   )
31.
32. function AgentRuntimeAdapter.setAuthType(authType: AuthType): void
33.   updates ← { authType }
34.   this.runtimeState ← updateRuntimeStateWithConfigMirror(
35.     this.runtimeState,
36.     updates,
37.     this.legacyConfig
38.   )
39.
40. function AgentRuntimeAdapter.setBaseUrl(baseUrl: string): void
41.   updates ← { baseUrl }
42.   this.runtimeState ← updateRuntimeStateWithConfigMirror(
43.     this.runtimeState,
44.     updates,
45.     this.legacyConfig
46.   )
```

### Step 6: Batch Write Operations

**@requirement:REQ-STAT5-002.3** - Multi-step operations must be atomic

```pseudocode
1. function AgentRuntimeAdapter.switchProvider(
2.   providerName: string,
3.   options?: { model?: string, clearSettings?: boolean }
4. ): void
5.
6.   // Validate provider
7.   providerManager ← this.legacyConfig.getProviderManager()
8.   if not providerManager.hasProvider(providerName):
9.     throw new Error(`Provider '${providerName}' not found`)
10.
11.  // Determine model (explicit or default)
12.  targetModel ← options?.model ||
13.    providerManager.getProvider(providerName).getDefaultModel()
14.
15.  // Build batch update
16.  updates ← {
17.    provider: providerName,
18.    model: targetModel,
19.    baseUrl: undefined  // Clear custom base URL
20.  }
21.
22.  // Clear provider-specific ephemeral settings in config
23.  if options?.clearSettings !== false:
24.    this.legacyConfig.setEphemeralSetting('base-url', undefined)
25.    this.legacyConfig.setEphemeralSetting('activeProvider', undefined)
26.    // ... clear other provider-specific settings
27.
28.  // Atomic update with config mirror
29.  this.runtimeState ← updateRuntimeStateWithConfigMirror(
30.    this.runtimeState,
31.    updates,
32.    this.legacyConfig
33.  )
34.
35.  // Refresh auth for new provider
36.  await this.legacyConfig.refreshAuth(this.runtimeState.authType)
```

**Risk Mitigation**: Addresses Risk Register RISK-001 (atomic mutation chains)

---

## Config Mirroring (Phase 5 Compatibility)

**@requirement:REQ-STAT5-002.3** - Legacy Config mirrors update for diagnostics

### Step 7: Mirror State to Config

```pseudocode
1. function AgentRuntimeAdapter.mirrorStateToConfig(state: AgentRuntimeState): void
2.   // Mirror core fields
3.   this.legacyConfig.setProvider(state.provider)
4.   this.legacyConfig.setModel(state.model)
5.   this.legacyConfig.setAuthType(state.authType)
6.
7.   // Mirror connection settings
8.   if state.baseUrl:
9.     this.legacyConfig.setEphemeralSetting('base-url', state.baseUrl)
10.  else:
11.    this.legacyConfig.setEphemeralSetting('base-url', undefined)
12.
13.  if state.proxyUrl:
14.    this.legacyConfig.setProxy(state.proxyUrl)
15.
16.  // Mirror model params as ephemeral settings
17.  if state.modelParams:
18.    for each (key, value) in state.modelParams:
19.      this.legacyConfig.setEphemeralSetting(key, value)
20.
21.  // Note: Session ID is immutable, not mirrored
22.  // Note: Auth payload is sensitive, not mirrored directly
```

**Design Decision**: One-way mirror (runtime state → config), never read from config

---

## Runtime Settings Helpers Migration

**@requirement:REQ-STAT5-002.1** - Runtime helpers delegate to adapter

### Step 8: Legacy Helper Function Updates

```pseudocode
1. // Phase 5: Update runtimeSettings.ts to use adapter
2.
3. // Global adapter instance (initialized during bootstrap)
4. let globalRuntimeAdapter: AgentRuntimeAdapter | null = null
5.
6. function setRuntimeAdapter(adapter: AgentRuntimeAdapter): void
7.   globalRuntimeAdapter ← adapter
8.
9. function getRuntimeAdapter(): AgentRuntimeAdapter
10.  if not globalRuntimeAdapter:
11.    throw new Error('Runtime adapter not initialized. Call setRuntimeAdapter() during bootstrap.')
12.  return globalRuntimeAdapter
13.
14. // Legacy helper functions (now delegate to adapter)
15. function setRuntimeProvider(providerName: string): void
16.   adapter ← getRuntimeAdapter()
17.   adapter.setProvider(providerName)
18.
19. function getRuntimeProvider(): string
20.   adapter ← getRuntimeAdapter()
21.   return adapter.getProvider()
22.
23. function setRuntimeModel(modelName: string): void
24.   adapter ← getRuntimeAdapter()
25.   adapter.setModel(modelName)
26.
27. function getRuntimeModel(): string
28.   adapter ← getRuntimeAdapter()
29.   return adapter.getModel()
30.
31. // Atomic provider switch helper
32. function switchRuntimeProvider(providerName: string, model?: string): void
33.   adapter ← getRuntimeAdapter()
34.   adapter.switchProvider(providerName, { model })
```

**Migration Checkpoint**: All 27 touchpoints in runtimeSettings.ts delegate to adapter

---

## Slash Command Integration

**@requirement:REQ-STAT5-002.1** - Slash commands use adapter API

### Step 9: CommandContext with Adapter

```pseudocode
1. // Phase 5: Add adapter to CommandContext
2. interface CommandContext {
3.   services: {
4.     config: Config;                        // Phase 5: Keep for backward compat
5.     runtimeAdapter?: AgentRuntimeAdapter;  // Phase 5: Add adapter
6.     runtimeState?: AgentRuntimeState;      // Phase 5: Direct access (optional)
7.   };
8.   ui?: UIContext;
9. }
10.
11. // Factory function
12. function createCommandContext(
13.   config: Config,
14.   adapter: AgentRuntimeAdapter,
15.   ui?: UIContext
16. ): CommandContext
17.   return {
18.     services: {
19.       config,
20.       runtimeAdapter: adapter,
21.       runtimeState: adapter.getRuntimeState(),  // Convenience accessor
22.     },
23.     ui
24.   }
```

### Step 10: Slash Command Implementations

```pseudocode
1. // /provider command
2. async function providerCommand(
3.   context: CommandContext,
4.   providerName: string
5. ): Promise<void>
6.   adapter ← context.services.runtimeAdapter
7.   if not adapter:
8.     throw new Error('Runtime adapter not available')
9.
10.  // Use adapter's atomic provider switch
11.  try:
12.    adapter.switchProvider(providerName, { clearSettings: true })
13.    context.ui?.showMessage(`Switched to provider '${providerName}'`)
14.  catch error:
15.    context.ui?.showError(`Failed to switch provider: ${error.message}`)
16.
17. // /model command
18. async function modelCommand(
19.   context: CommandContext,
20.   modelName: string
21. ): Promise<void>
22.   adapter ← context.services.runtimeAdapter
23.   if not adapter:
24.     throw new Error('Runtime adapter not available')
25.
26.  try:
27.    adapter.setModel(modelName)
28.    context.ui?.showMessage(`Set model to '${modelName}'`)
29.  catch error:
30.    context.ui?.showError(`Failed to set model: ${error.message}`)
31.
32. // /set command (extended)
33. async function setCommand(
34.   context: CommandContext,
35.   key: string,
36.   value: string
37. ): Promise<void>
38.   adapter ← context.services.runtimeAdapter
39.   config ← context.services.config
40.
41.   // Route to adapter or config based on key
42.   if key === 'provider':
43.     adapter.setProvider(value)
44.   else if key === 'model':
45.     adapter.setModel(value)
46.   else if key === 'base-url':
47.     adapter.setBaseUrl(value)
48.   else:
49.     // Other settings: Use config (ephemeral settings)
50.     config.setEphemeralSetting(key, value)
51.
52.   context.ui?.showMessage(`Set ${key} to ${value}`)
```

**Migration Checkpoint**: All slash commands use adapter for runtime state mutations

---

## Diagnostics & Status Integration

**@requirement:REQ-STAT5-005.1** - Diagnostics source data from runtime state snapshots

### Step 11: Diagnostics Command Integration

```pseudocode
1. async function diagnosticsCommand(context: CommandContext): Promise<void>
2.   adapter ← context.services.runtimeAdapter
3.   if not adapter:
4.     throw new Error('Runtime adapter not available')
5.
6.   // Get runtime state snapshot
7.   snapshot ← adapter.getSnapshot()
8.
9.   // Build diagnostics display
10.  diagnostics ← {
11.    runtimeId: snapshot.runtimeId,
12.    provider: {
13.      name: snapshot.provider,
14.      baseUrl: snapshot.baseUrl || '[default]',
15.      authType: snapshot.authType
16.    },
17.    model: {
18.      id: snapshot.model,
19.      params: snapshot.modelParams
20.    },
21.    session: {
22.      sessionId: snapshot.sessionId,
23.      updatedAt: new Date(snapshot.updatedAt).toISOString()
24.    }
25.  }
26.
27.  // Display in UI
28.  context.ui?.showDiagnostics(diagnostics)
```

### Step 12: Status Panel Integration

```pseudocode
1. // Status panel subscribes to adapter events
2. function initializeStatusPanel(adapter: AgentRuntimeAdapter, ui: UIContext): void
3.   // Subscribe to runtime state updates
4.   adapter.on('runtimeStateUpdated', (event) => {
5.     snapshot ← event.snapshot
6.     ui.updateStatusBar({
7.       provider: snapshot.provider,
8.       model: snapshot.model,
9.       authType: snapshot.authType
10.    })
11.  })
12.
13.  // Initial render
14.  initialSnapshot ← adapter.getSnapshot()
15.  ui.updateStatusBar({
16.    provider: initialSnapshot.provider,
17.    model: initialSnapshot.model,
18.    authType: initialSnapshot.authType
19.  })
```

**Design Decision**: UI components subscribe to adapter events (not direct runtime state)

---

## Error Handling & Validation

**@requirement:REQ-STAT5-001.1** - Clear error messages for validation failures

### Step 13: Adapter-Level Error Handling

```pseudocode
1. function AgentRuntimeAdapter.setProvider(providerName: string): void
2.   try:
3.     // Validate and update
4.     providerManager ← this.legacyConfig.getProviderManager()
5.     if not providerManager.hasProvider(providerName):
6.       throw new ProviderNotFoundError(
7.         `Provider '${providerName}' not found. ` +
8.         `Available providers: ${providerManager.getProviderNames().join(', ')}`
9.       )
10.
11.    // ... update runtime state
12.
13.  catch error:
14.    if error is RuntimeStateError:
15.      // Runtime state validation failed
16.      throw new AdapterError(
17.        `Cannot set provider to '${providerName}': ${error.message}`,
18.        { code: error.code, provider: providerName }
19.      )
20.    else:
21.      // Other error (network, auth, etc.)
22.      throw error
```

### Step 14: Adapter Lifecycle Cleanup

```pseudocode
1. function AgentRuntimeAdapter.dispose(): void
2.   // Unsubscribe from runtime state events
3.   if this.unsubscribe:
4.     this.unsubscribe()
5.     this.unsubscribe ← null
6.
7.   // Clear references
8.   this.runtimeState ← null
9.   this.legacyConfig ← null
10.
11.  // Remove from global registry (if applicable)
12.  removeAgentRuntimeState(this.runtimeId)
```

---

## Integration Test Scenarios

**@requirement:REQ-STAT5-005.2** - Regression tests confirm adapter behavior

### Test Scenarios

#### Scenario 1: CLI Flag Precedence

```pseudocode
1. Test: CLI flags override config defaults
2.   config ← createConfig({ provider: 'gemini', model: 'gemini-2.0-flash' })
3.   flags ← { provider: 'anthropic', model: 'claude-3-5-sonnet' }
4.   params ← resolveRuntimeStateFromFlags(flags, config)
5.   Assert params.provider equals 'anthropic'
6.   Assert params.model equals 'claude-3-5-sonnet'
```

#### Scenario 2: Adapter Mirroring

```pseudocode
1. Test: Runtime state updates mirror to Config
2.   config ← createConfig()
3.   runtimeState ← createAgentRuntimeState({ provider: 'gemini', model: 'flash' })
4.   adapter ← new AgentRuntimeAdapter(runtimeState, config)
5.   adapter.setProvider('anthropic')
6.   Assert config.getProvider() equals 'anthropic'
7.   Assert config.getModel() equals 'claude-3-5-sonnet' (default for anthropic)
```

#### Scenario 3: Atomic Provider Switch

```pseudocode
1. Test: Provider switch is atomic (no partial updates)
2.   adapter ← createAdapter()
3.   initialProvider ← adapter.getProvider()
4.   try:
5.     adapter.switchProvider('invalid-provider')
6.   catch error:
7.     // Expected error
8.   Assert adapter.getProvider() equals initialProvider (unchanged)
9.   Assert adapter.getModel() equals initial model (unchanged)
```

---

## Performance Expectations

- Adapter method calls (getProvider, setModel): <0.1ms
- Provider switch (batch update + config mirror): <5ms
- CLI flag resolution: <2ms
- Diagnostics snapshot generation: <1ms

---

## Migration Path Summary

**@requirement:REQ-STAT5-002.1** - Phased migration strategy

### Phase 5 Scope

1. Create `AgentRuntimeAdapter` class
2. Update CLI bootstrap to create adapter
3. Migrate `runtimeSettings.ts` to delegate to adapter
4. Update slash commands to use adapter API
5. Maintain Config mirroring for UI components

### Phase 6 Scope (Future)

1. Remove Config mirroring (UI reads from adapter directly)
2. Migrate ephemeral settings to runtime state
3. Remove legacy Config from adapter constructor
4. Remove adapter (direct runtime state access)

---

**@plan:PLAN-20251027-STATELESS5.P02**

## Cross-References
- **Runtime State Pseudocode**: Steps 1-14 (runtime-state.md)
- **Gemini Runtime Pseudocode**: Steps 1-13 (gemini-runtime.md)
- **Design Questions**: Q2, Q3, Q4 (design-questions.md)
- **Risk Register**: RISK-001, RISK-008, RISK-010 (risk-register.md)
- **State Coupling**: CLI Runtime Layer (27 touchpoints), Command Layer (17 touchpoints) (state-coupling.md)
- **Next Phase**: Phase 06 (adapter stub), Phase 07 (adapter TDD), Phase 08 (adapter implementation)
