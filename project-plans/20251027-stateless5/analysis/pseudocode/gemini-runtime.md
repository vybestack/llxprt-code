# GeminiClient & GeminiChat Runtime Integration Pseudocode

**Phase ID**: `PLAN-20251027-STATELESS5.P02`
**Analysis Date**: 2025-10-28

## Purpose

Define end-to-end call sequences for `GeminiClient` and `GeminiChat` using `AgentRuntimeState`, including interactions with `ProviderRuntimeContext`, history service injection, error handling paths, and migration checkpoints for slash commands and tests.

---

## GeminiClient Integration

### Constructor & Initialization

**@requirement:REQ-STAT5-003.1** - GeminiClient reads provider/model/auth exclusively from runtime state

#### Step 1: Constructor Signature Change

```pseudocode
1. // Phase 5 constructor (backward compatible)
2. class GeminiClient {
3.   constructor(
4.     config: Config,                        // Phase 5: Keep for backward compat
5.     runtimeState?: AgentRuntimeState,      // Phase 5: Optional, Phase 6: Required
6.     historyService?: HistoryService        // Phase 5: Optional, Phase 6: Required
7.   )
8. }
9.
10. // Internal initialization
11. function GeminiClient.constructor(config, runtimeState, historyService):
12.   // Phase 5: Dual-path initialization
13.   if runtimeState provided:
14.     this.runtimeState ← runtimeState
15.     this.config ← config  // Keep for ephemeral settings passthrough
16.     this.preferRuntimeState ← true
17.   else:
18.     // Legacy path: Create runtime state from config
19.     this.runtimeState ← createAgentRuntimeStateFromConfig(config, 'foreground-agent')
20.     this.config ← config
21.     this.preferRuntimeState ← false
22.
23.   // History service handling
24.   if historyService provided:
25.     this.historyService ← historyService
26.   else:
27.     // Legacy path: Will be created in lazyInitialize()
28.     this.historyService ← null
29.
30.   // Proxy configuration from runtime state
31.   proxyUrl ← this.runtimeState.proxyUrl
32.   if proxyUrl:
33.     setGlobalDispatcher(new ProxyAgent(proxyUrl))
34.
35.   // Subscribe to runtime state changes for telemetry
36.   this.unsubscribe ← subscribeToAgentRuntimeState(
37.     this.runtimeState.runtimeId,
38.     this.handleRuntimeStateChange.bind(this)
39.   )
40.
41.   // Initialize other services
42.   this.embeddingModel ← this.runtimeState.model  // May differ from chat model
43.   this.loopDetector ← new LoopDetectionService(this.runtimeState)
44.   this.lastPromptId ← this.runtimeState.sessionId
45.   this.complexityAnalyzer ← new ComplexityAnalyzer({ /* ... */ })
```

**Migration Checkpoint MC-01**: Tests using `new GeminiClient(config)` continue to work (legacy path)

**@requirement:REQ-STAT5-003.2** - GeminiClient subscribes to runtime state changes for telemetry

#### Step 2: Runtime State Change Handler

```pseudocode
1. function GeminiClient.handleRuntimeStateChange(event: RuntimeStateChangedEvent): void
2.   // Update telemetry context when runtime state changes
3.   if event.changes.provider || event.changes.model:
4.     updateTelemetryContext({
5.       runtimeId: event.runtimeId,
6.       provider: event.snapshot.provider,
7.       model: event.snapshot.model,
8.       timestamp: event.timestamp
9.     })
10.
11.  // Update proxy if changed
12.  if event.changes.proxyUrl:
13.    newProxyUrl ← event.snapshot.proxyUrl
14.    if newProxyUrl:
15.      setGlobalDispatcher(new ProxyAgent(newProxyUrl))
16.    else:
17.      setGlobalDispatcher(null)  // Clear proxy
18.
19.  // Note: Chat instances are NOT recreated on state change
20.  // They will read updated state on next sendMessage() call
```

#### Step 3: Lazy Initialization (Updated)

**@requirement:REQ-STAT5-004.1** - GeminiChat operates without direct Config access

```pseudocode
1. async function GeminiClient.lazyInitialize(): Promise<void>
2.   if this.contentGenerator already initialized:
3.     return  // Already initialized
4.
5.   // Get content generator config
6.   contentGenConfig ← this._pendingConfig || this.getContentGeneratorConfig()
7.   if not contentGenConfig:
8.     throw new Error('Content generator config not initialized')
9.
10.  // Create content generator with runtime state
11.  // Phase 5: Pass both config and runtime state for compatibility
12.  if this.preferRuntimeState:
13.    this.contentGenerator ← await createContentGenerator(
14.      contentGenConfig,
15.      this.runtimeState,           // New path: Use runtime state
16.      this.runtimeState.sessionId
17.    )
18.  else:
19.    // Legacy path
20.    this.contentGenerator ← await createContentGenerator(
21.      contentGenConfig,
22.      this.config,
23.      this.config.getSessionId()
24.    )
25.
26.  // Clear pending config
27.  this._pendingConfig ← undefined
28.
29. // Helper to get content generator config from runtime state
30. function GeminiClient.getContentGeneratorConfig(): ContentGeneratorConfig
31.   // Phase 5: Try runtime state first, fallback to config
32.   if this.preferRuntimeState:
33.     // Build config from runtime state
34.     providerManager ← this.config.getProviderManager()  // Still from Config in Phase 5
35.     return {
36.       providerManager,
37.       provider: this.runtimeState.provider,
38.       model: this.runtimeState.model,
39.       authType: this.runtimeState.authType,
40.       // ... other fields
41.     }
42.   else:
43.     return this.config.getContentGeneratorConfig()
```

**Migration Checkpoint MC-02**: `createContentGenerator` must accept both `Config` and `AgentRuntimeState`

---

### Chat Creation Flow

**@requirement:REQ-STAT5-004.1** - GeminiChat must operate without direct Config access

#### Step 4: Start Chat Sequence

```pseudocode
1. async function GeminiClient.startChat(extraHistory?: Content[]): Promise<GeminiChat>
2.   // Ensure content generator initialized
3.   await this.lazyInitialize()
4.
5.   // Get environment context (no longer needs Config)
6.   envParts ← await getEnvironmentContext(this.runtimeState)
7.
8.   // Get tool registry
9.   // Phase 5: Tool registry still in Config (migrated in Phase 6)
10.  toolRegistry ← this.config.getToolRegistry()
11.
12.  // Get user memory
13.  // Phase 5: User memory still in Config (migrated in Phase 6)
14.  userMemory ← this.config.getUserMemory()
15.
16.  // Get current model from runtime state
17.  model ← this.runtimeState.model
18.
19.  // Build system prompt
20.  enabledToolNames ← toolRegistry.getEnabledToolNames()
21.  systemInstruction ← await getCoreSystemPromptAsync(
22.    userMemory,
23.    model,
24.    enabledToolNames
25.  )
26.
27.  // Check if thinking mode supported
28.  generateContentConfig ← isThinkingSupported(model) ?
29.    { ...this.generateContentConfig, thinkingConfig: { ... } } :
30.    this.generateContentConfig
31.
32.  // Create history service if not provided
33.  if not this.historyService:
34.    // Legacy path: Create from config
35.    this.historyService ← await HistoryService.create(
36.      this.config.getSessionId(),
37.      this.config.getSettingsService()
38.    )
39.
40.  // Create provider runtime context
41.  providerContext ← createProviderRuntimeContext(
42.    this.runtimeState,
43.    this.config.getSettingsService(),
44.    this.config  // Phase 5: Include for backward compat
45.  )
46.
47.  // Create GeminiChat instance
48.  chat ← new GeminiChat(
49.    this.runtimeState,              // New: Runtime state
50.    this.config,                    // Phase 5: Keep for ephemeral settings
51.    this.getContentGenerator(),
52.    {
53.      systemInstruction,
54.      ...generateContentConfig,
55.      tools
56.    },
57.    initialHistory,
58.    this.historyService,
59.    providerContext                 // New: Include provider context
60.  )
61.
62.  // Store chat reference
63.  this.chat ← chat
64.
65.  return chat
```

**Migration Checkpoint MC-03**: GeminiChat constructor signature changes (backward compatible)

---

### Message Send Flow

**@requirement:REQ-STAT5-003.1** - GeminiClient reads provider/model/auth exclusively from runtime state

#### Step 5: Send Message Stream Sequence

```pseudocode
1. async function* GeminiClient.sendMessageStream(
2.   request: PartListUnion,
3.   signal: AbortSignal,
4.   prompt_id: string,
5.   turns: number = MAX_TURNS,
6.   originalModel?: string
7. ): AsyncGenerator<ServerGeminiStreamEvent, Turn>
8.
9.   // Max turns check (uses runtime state)
10.  maxSessionTurns ← this.getMaxSessionTurns()  // From runtime state or config
11.  if maxSessionTurns > 0 && this.sessionTurnCount > maxSessionTurns:
12.    yield { type: GeminiEventType.MaxSessionTurns }
13.    providerName ← this.runtimeState.provider
14.    return new Turn(this.getChat(), prompt_id, providerName)
15.
16.  // Track original model for switch detection
17.  initialModel ← originalModel || this.runtimeState.model
18.
19.  // IDE mode check (uses runtime state)
20.  ideMode ← this.getIdeMode()  // From runtime state or config
21.  if ideMode && not hasPendingToolCall:
22.    contextParts ← this.getIdeContextParts(/* ... */)
23.    // ... add context
24.
25.  // Get provider name from runtime state
26.  providerName ← this.runtimeState.provider
27.
28.  // Create turn
29.  turn ← new Turn(this.getChat(), prompt_id, providerName)
30.
31.  // Delegate to chat's sendMessage
32.  chat ← this.getChat()
33.  for await (event of chat.sendMessage(request, signal, this.runtimeState)):
34.    yield event
35.    // ... process events
36.
37.  // Model switch detection at end
38.  if not turn.pendingToolCalls.length && signal && not signal.aborted:
39.    currentModel ← this.runtimeState.model
40.    if currentModel !== initialModel:
41.      // Model was switched (quota error fallback)
42.      logger.info(`Model switched from ${initialModel} to ${currentModel}`)
43.      return turn
44.
45.  return turn
```

**Design Note**: All `config.getModel()` calls replaced with `this.runtimeState.model`

---

## GeminiChat Integration

**@requirement:REQ-STAT5-004.1** - GeminiChat operates without direct Config access
**@requirement:REQ-STAT5-004.2** - HistoryService is injected per instance

### Constructor Changes

#### Step 6: GeminiChat Constructor Signature

```pseudocode
1. class GeminiChat {
2.   // Phase 5 constructor (backward compatible)
3.   constructor(
4.     runtimeState: AgentRuntimeState,          // New: Required
5.     config: Config,                           // Phase 5: Keep for ephemeral settings
6.     contentGenerator: ContentGenerator,
7.     generationConfig: GenerateContentConfig,
8.     initialHistory: Content[],
9.     historyService: HistoryService,           // Required (not optional)
10.    providerContext?: ProviderRuntimeContext  // New: Optional provider context
11.  )
12. }
13.
14. function GeminiChat.constructor(...):
15.   // Store runtime state
16.   this.runtimeState ← runtimeState
17.   this.config ← config  // Phase 5: Keep for ephemeral settings
18.
19.   // Validate required dependencies
20.   if not historyService:
21.     throw new Error(
22.       'HistoryService must be provided to GeminiChat. ' +
23.       'Create via HistoryService.create() and pass to constructor.'
24.     )
25.
26.   // Store history service (instance-level dependency)
27.   this.historyService ← historyService
28.
29.   // Store provider context
30.   this.providerContext ← providerContext || {}
31.
32.   // Store other dependencies
33.   this.contentGenerator ← contentGenerator
34.   this.generationConfig ← generationConfig
35.
36.   // Initialize history with runtime state model
37.   currentModel ← this.runtimeState.model
38.   for each content in initialHistory:
39.     this.history.push(content)
40.     this.historyService.add(
41.       ContentConverters.toIContent(content),
42.       currentModel
43.     )
44.
45.   // Initialize logger with runtime context
46.   this.logger ← new DebugLogger(
47.     'gemini-chat',
48.     { runtimeId: runtimeState.runtimeId }
49.   )
```

**Migration Checkpoint MC-04**: All GeminiChat test constructors must pass runtime state

---

### Send Message Flow

**@requirement:REQ-STAT5-004.1** - GeminiChat provider invocations use runtime state metadata

#### Step 7: Send Message Sequence

```pseudocode
1. async function* GeminiChat.sendMessage(
2.   parts: PartListUnion,
3.   signal: AbortSignal,
4.   runtimeState?: AgentRuntimeState  // Override runtime state if provided
5. ): AsyncGenerator<ServerGeminiStreamEvent, void>
6.
7.   // Use provided runtime state or instance state
8.   effectiveRuntimeState ← runtimeState || this.runtimeState
9.
10.  // Get provider from runtime state
11.  desiredProviderName ← effectiveRuntimeState.provider
12.
13.  // Get active provider from content generator
14.  providerManager ← this.contentGenerator.getProviderManager()
15.  activeProvider ← providerManager.getActiveProvider()
16.
17.  // Provider enforcement check (Phase 5 behavior)
18.  if activeProvider.name !== desiredProviderName:
19.    try:
20.      // Attempt to switch provider
21.      providerManager.setActiveProvider(desiredProviderName)
22.      activeProvider ← providerManager.getActiveProvider()
23.      this.logger.info(`Switched provider to ${desiredProviderName}`)
24.    catch error:
25.      this.logger.error(`Failed to enforce provider '${desiredProviderName}': ${error}`)
26.      // Continue with current provider (fallback behavior)
27.
28.  // Build request payload using runtime state
29.  request ← {
30.    model: effectiveRuntimeState.model,
31.    contents: this.buildContents(parts),
32.    generationConfig: this.generationConfig,
33.    safetySettings: this.safetySettings,
34.    // Auth and baseUrl handled by provider via runtime state
35.  }
36.
37.  // Build provider context for request
38.  requestContext ← {
39.    runtimeState: effectiveRuntimeState,
40.    providerContext: this.providerContext,
41.    sessionId: effectiveRuntimeState.sessionId
42.  }
43.
44.  // Log API request with runtime state context
45.  logApiRequest(effectiveRuntimeState, {
46.    provider: desiredProviderName,
47.    model: effectiveRuntimeState.model,
48.    timestamp: Date.now()
49.  })
50.
51.  // Send request to provider
52.  try:
53.    for await (chunk of activeProvider.streamGenerateContent(request, requestContext, signal)):
54.      // Process chunk
55.      yield this.processChunk(chunk)
56.
57.      // Track history with current model
58.      if chunk.content:
59.        currentModel ← effectiveRuntimeState.model
60.        this.historyService.add(
61.          ContentConverters.toIContent(chunk.content),
62.          currentModel
63.        )
64.
65.  catch error:
66.    // Log API error with runtime state context
67.    logApiError(effectiveRuntimeState, {
68.      provider: desiredProviderName,
69.      model: effectiveRuntimeState.model,
70.      error: error.message
71.    })
72.    throw error
73.
74.  // Log API response
75.  logApiResponse(effectiveRuntimeState, {
76.    provider: desiredProviderName,
77.    model: effectiveRuntimeState.model,
78.    timestamp: Date.now()
79.  })
```

**Design Note**: Provider enforcement (lines 18-26) may be removed in Phase 6 for true stateless operation

**Risk Mitigation**: Addresses Risk Register RISK-005 (provider enforcement logic)

---

### Telemetry Integration

**@requirement:REQ-STAT5-003.2** - Telemetry uses runtime state context

#### Step 8: Telemetry Functions Adaptation

```pseudocode
1. // Phase 5: Update telemetry signature to accept AgentRuntimeState
2. function logApiRequest(
3.   runtimeStateOrConfig: AgentRuntimeState | Config,
4.   event: ApiRequestEvent
5. ): void
6.   // Extract telemetry context
7.   if runtimeStateOrConfig is AgentRuntimeState:
8.     context ← {
9.       runtimeId: runtimeStateOrConfig.runtimeId,
10.      provider: runtimeStateOrConfig.provider,
11.      model: runtimeStateOrConfig.model,
12.      sessionId: runtimeStateOrConfig.sessionId
13.    }
14.  else:
15.    // Legacy Config path
16.    context ← {
17.      runtimeId: 'foreground-agent',
18.      provider: runtimeStateOrConfig.getProvider(),
19.      model: runtimeStateOrConfig.getModel(),
20.      sessionId: runtimeStateOrConfig.getSessionId()
21.    }
22.
23.  // Log request
24.  telemetryService.logRequest({
25.    ...context,
26.    ...event
27.  })
28.
29. // Similar updates for logApiResponse() and logApiError()
```

**Migration Checkpoint MC-05**: All telemetry functions accept `AgentRuntimeState | Config`

**Risk Mitigation**: Addresses Risk Register RISK-002 (telemetry coupling)

---

## Slash Command Integration

**@requirement:REQ-STAT5-002.1** - Slash commands delegate to runtime state mutators

### Command Context Extension

#### Step 9: CommandContext Interface Update

```pseudocode
1. // Phase 5: Add runtimeState field to CommandContext
2. interface CommandContext {
3.   services: {
4.     config: Config;                      // Phase 5: Keep for backward compat
5.     runtimeState?: AgentRuntimeState;    // Phase 5: Add new field
6.     // ... other services
7.   };
8.   ui?: UIContext;
9. }
10.
11. // Factory function for creating command context
12. function createCommandContext(
13.   config: Config,
14.   runtimeState: AgentRuntimeState,
15.   ui?: UIContext
16. ): CommandContext
17.   return {
18.     services: {
19.       config,
20.       runtimeState,
21.       // ... other services
22.     },
23.     ui
24.   }
```

**Cross-reference**: Design Questions Q4 (Option A - Add parallel runtimeState field)

---

### Slash Command Handlers

**@requirement:REQ-STAT5-002.1** - Slash commands delegate to runtime state mutators

#### Step 10: /set Command Integration

```pseudocode
1. async function setCommand(context: CommandContext, key: string, value: string): Promise<void>
2.   // Phase 5: Prefer runtime state, fallback to config
3.   runtimeState ← context.services.runtimeState
4.   config ← context.services.config
5.
6.   if runtimeState:
7.     // New path: Update runtime state
8.     if key in ['provider', 'model', 'auth-type']:
9.       // These are runtime state fields
10.      updates ← {}
11.      if key === 'provider':
12.        updates.provider ← value
13.      else if key === 'model':
14.        updates.model ← value
15.      else if key === 'auth-type':
16.        updates.authType ← value
17.
18.      // Update runtime state with config mirror
19.      newRuntimeState ← updateRuntimeStateWithConfigMirror(
20.        runtimeState,
21.        updates,
22.        config  // Mirror to config for UI
23.      )
24.
25.      // Replace runtime state in context
26.      context.services.runtimeState ← newRuntimeState
27.
28.    else:
29.      // Other settings: Delegate to config (ephemeral settings)
30.      config.setEphemeralSetting(key, value)
31.
32.  else:
33.    // Legacy path: Use config only
34.    config.setEphemeralSetting(key, value)
35.
36.  // Display confirmation
37.  context.ui?.showMessage(`Set ${key} to ${value}`)
```

**Migration Checkpoint MC-06**: `/set` command works with and without runtime state

#### Step 11: /provider Command Integration

```pseudocode
1. async function providerCommand(context: CommandContext, providerName: string): Promise<void>
2.   runtimeState ← context.services.runtimeState
3.   config ← context.services.config
4.
5.   if not runtimeState:
6.     throw new Error('Runtime state not available')
7.
8.   // Validate provider exists
9.   providerManager ← config.getProviderManager()
10.  if not providerManager.hasProvider(providerName):
11.    throw new Error(`Provider '${providerName}' not found`)
12.
13.  // Get default model for provider
14.  defaultModel ← providerManager.getProvider(providerName).getDefaultModel()
15.
16.  // Batch update: provider + model + clear ephemeral settings
17.  updates ← {
18.    provider: providerName,
19.    model: defaultModel,
20.    baseUrl: undefined  // Clear custom base URL
21.  }
22.
23.  // Update runtime state atomically
24.  newRuntimeState ← updateRuntimeStateWithConfigMirror(
25.    runtimeState,
26.    updates,
27.    config
28.  )
29.
30.  // Clear provider-specific ephemeral settings in config
31.  config.setEphemeralSetting('base-url', undefined)
32.  config.setEphemeralSetting('activeProvider', undefined)
33.  // ... clear other settings
34.
35.  // Refresh auth for new provider
36.  await config.refreshAuth(newRuntimeState.authType)
37.
38.  // Replace runtime state in context
39.  context.services.runtimeState ← newRuntimeState
40.
41.  // Display confirmation
42.  context.ui?.showMessage(`Switched to provider '${providerName}' with model '${defaultModel}'`)
```

**Risk Mitigation**: Addresses Risk Register RISK-001 (atomic mutation chains)

**Migration Checkpoint MC-07**: `/provider` command uses batch update for atomicity

---

## Error Handling Paths

**@requirement:REQ-STAT5-001.1** - Clear error messages for validation failures

### Error Scenarios

#### Step 12: Missing Runtime State Error

```pseudocode
1. function ensureRuntimeState(context: CommandContext): AgentRuntimeState
2.   runtimeState ← context.services.runtimeState
3.   if not runtimeState:
4.     throw new MissingRuntimeStateError(
5.       'AgentRuntimeState not available in command context. ' +
6.       'Ensure CLI bootstrap created runtime state before executing commands.'
7.     )
8.   return runtimeState
9.
10. // Usage in slash commands:
11. async function modelCommand(context: CommandContext, modelName: string): Promise<void>
12.   runtimeState ← ensureRuntimeState(context)  // Throws if missing
13.   // ... proceed with command
```

#### Step 13: Provider Switch Error Handling

```pseudocode
1. async function switchProviderWithFallback(
2.   runtimeState: AgentRuntimeState,
3.   targetProvider: string,
4.   config: Config
5. ): Promise<AgentRuntimeState>
6.
7.   try:
8.     // Attempt provider switch
9.     updates ← {
10.      provider: targetProvider,
11.      model: getDefaultModelForProvider(targetProvider)
12.    }
13.    newRuntimeState ← updateRuntimeStateWithConfigMirror(
14.      runtimeState,
15.      updates,
16.      config
17.    )
18.    return newRuntimeState
19.
20.  catch error:
21.    if error is RuntimeStateError:
22.      // Validation failed
23.      logger.error(`Provider switch validation failed: ${error.code}`)
24.      throw new Error(
25.        `Cannot switch to provider '${targetProvider}': ${error.message}`
26.      )
27.    else:
28.      // Other error (auth, network, etc.)
29.      logger.error(`Provider switch failed: ${error.message}`)
30.      // Return original state (no change)
31.      return runtimeState
```

**Design Decision**: Provider switch errors preserve original state (no partial updates)

---

## Migration Checkpoints Summary

**@requirement:REQ-STAT5-005.3** - Documentation updated for user workflows

### Test Migration Checkpoints

1. **MC-01**: Legacy `new GeminiClient(config)` constructors continue to work
   - Location: All existing GeminiClient tests
   - Action: Tests pass without modification

2. **MC-02**: `createContentGenerator` accepts `Config | AgentRuntimeState`
   - Location: `packages/core/src/core/contentGenerator.ts`
   - Action: Add overload signature and type guard

3. **MC-03**: GeminiChat constructor accepts runtime state as first parameter
   - Location: All GeminiChat tests
   - Action: Update test fixtures to create runtime state

4. **MC-04**: GeminiChat tests must provide `HistoryService` instance
   - Location: 47 test files
   - Action: Add `createTestHistoryService()` helper

5. **MC-05**: Telemetry functions accept `AgentRuntimeState | Config`
   - Location: `packages/core/src/telemetry/*.ts`
   - Action: Add union type and type guards

6. **MC-06**: `/set` command works with and without runtime state
   - Location: `packages/cli/src/ui/commands/setCommand.ts`
   - Action: Add runtime state path, keep config fallback

7. **MC-07**: `/provider` command uses batch atomic updates
   - Location: `packages/cli/src/ui/commands/providerCommand.ts`
   - Action: Replace mutation chain with single batch update

---

## Integration Tests Required

**@requirement:REQ-STAT5-005.2** - Regression tests confirm runtime isolation

### Test Scenarios

#### Scenario 1: Provider Switch Isolation

```pseudocode
1. Test: Multiple runtime states remain isolated after provider switch
2.   Create runtimeState1 with provider='gemini'
3.   Create runtimeState2 with provider='anthropic'
4.   Update runtimeState1 to provider='openai'
5.   Assert runtimeState2.provider still equals 'anthropic'
6.   Assert runtimeState1.provider equals 'openai'
```

#### Scenario 2: History Service Injection

```pseudocode
1. Test: GeminiChat uses injected history service, not global
2.   Create historyService1 for session 'session-1'
3.   Create historyService2 for session 'session-2'
4.   Create chat1 with historyService1
5.   Create chat2 with historyService2
6.   Send message to chat1
7.   Assert historyService1 has 1 entry
8.   Assert historyService2 has 0 entries
9.   Send message to chat2
10.  Assert historyService2 has 1 entry
11.  Assert historyService1 still has 1 entry (unchanged)
```

#### Scenario 3: Event Subscription Cleanup

```pseudocode
1. Test: Unsubscribe prevents further event delivery
2.   Create runtimeState
3.   callbackInvoked ← false
4.   unsubscribe ← subscribeToAgentRuntimeState(runtimeState.runtimeId, () => {
5.     callbackInvoked ← true
6.   })
7.   Update runtimeState (should invoke callback)
8.   Assert callbackInvoked is true
9.   callbackInvoked ← false
10.  unsubscribe()  // Unsubscribe
11.  Update runtimeState again
12.  Assert callbackInvoked is false (not invoked after unsubscribe)
```

---

## Performance Expectations

**Reference**: Specification.md Performance Requirements

- Runtime state updates: <2ms
- Provider switch (batch update): <5ms
- Telemetry context extraction: <1ms
- History service injection: 0ms (already created)
- Event emission (single subscriber): <1ms

---

## Open Questions for Phase 03

1. Should `GeminiChat.sendMessage` accept optional runtime state override, or always use instance state?
2. Do we need a `RuntimeStateManager` singleton for global registry, or inline in module?
3. Should provider enforcement (Step 7, lines 18-26) remain in Phase 5, or remove immediately?

---

**@plan:PLAN-20251027-STATELESS5.P02**

## Cross-References
- **Runtime State Pseudocode**: Steps 1-14 (runtime-state.md)
- **Design Questions**: Q2, Q4, Q5 (design-questions.md)
- **Risk Register**: RISK-001, RISK-002, RISK-005, RISK-011 (risk-register.md)
- **State Coupling**: GeminiClient (45 touchpoints), GeminiChat (17 touchpoints) (state-coupling.md)
- **Next Phase**: Phase 03 (stub implementation), Phase 04 (TDD tests)
