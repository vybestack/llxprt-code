# Pseudocode – AgentRuntimeContext & Stateless SubAgentScope (P05)

> @plan PLAN-20251028-STATELESS6.P05

001. **Define `ReadonlySettingsSnapshot` interface**
     ```typescript
     interface ReadonlySettingsSnapshot {
       compressionThreshold?: number;
       contextLimit?: number;
       preserveThreshold?: number;
       toolFormatOverride?: string;
       telemetry?: {
         enabled: boolean;
         target: TelemetryTarget | null;
         redaction?: TelemetryRedactionConfig;
       };
     }
     ```

002. **Define `ToolRegistryView` interface**
     ```typescript
     interface ToolRegistryView {
       listToolNames(): string[];
       getToolMetadata(name: string): ToolMetadata | undefined;
     }
     ```

003. **Define `AgentRuntimeContext` interface** _(satisfies REQ-STAT6-001.2, REQ-STAT6-002.2, REQ-STAT6-002.3)_
     ```typescript
     interface AgentRuntimeContext {
       readonly state: AgentRuntimeState;
       readonly history: HistoryService;
       readonly ephemerals: {
         compressionThreshold(): number;
         contextLimit(): number;
         preserveThreshold(): number;
         toolFormatOverride(): string | undefined;
       };
       readonly telemetry: {
         logApiRequest(event: ApiRequestEvent): void;
         logApiResponse(event: ApiResponseEvent): void;
         logApiError(event: ApiErrorEvent): void;
       };
       readonly provider: {
         getActiveProvider(): IProvider;
         setActiveProvider(name: string): void; // may throw for read-only adapters
       };
       readonly tools: ToolRegistryView;
     }
     ```

004. **Define `AgentRuntimeContextFactoryOptions` structure**
     ```typescript
     interface AgentRuntimeContextFactoryOptions {
       state: AgentRuntimeState;
       settings: ReadonlySettingsSnapshot;
       providerManager?: ProviderManager;
       toolRegistry?: ToolRegistry;
       history?: HistoryService;
       telemetryTarget?: TelemetryTarget | null;
     }
     ```

005. **Implement `createAgentRuntimeContext(options)` builder** _(covers REQ-STAT6-002.2/002.3, REQ-STAT6-001.3)_
     005.1. `const history = options.history ?? new HistoryService();`
     005.2. Compute ephemerals with defaults `DEFAULTS = { compressionThreshold: 0.8, contextLimit: 60_000, preserveThreshold: 0.2 }` and expose closures returning values or overrides.
     005.3. Build provider adapter:
           - If `options.providerManager` present, forward `getActiveProvider` and `setActiveProvider` to manager.
           - Else, `getActiveProvider` derives from runtime state; `setActiveProvider` throws `Error('Read-only runtime view cannot mutate provider')`.
     005.4. Build telemetry adapter:
           - `const telemetryTarget = options.settings.telemetry?.enabled !== false ? options.telemetryTarget : null;`
           - Helper `enrich(event)` returns event with metadata `{ provider, model, sessionId }` from runtime state.
           - `logApiRequest/Response/Error` forward enriched events to `telemetryTarget` when defined; otherwise no-op.
     005.5. Build tool registry view:
           - `const registry = options.toolRegistry ?? options.providerManager?.getToolRegistry?.();`
           - `listToolNames()` returns registry tool names or `[]`.
           - `getToolMetadata(name)` returns registry tool or `undefined`.
     005.6. Freeze and return:
           ```typescript
           return Object.freeze({ state: options.state, history, ephemerals, telemetry, provider, tools });
           ```

006. **Refactor `GeminiChat` constructor** _(implements REQ-STAT6-001.2, REQ-STAT6-002.2/002.3)_
     006.1. Update signature to `constructor(view: AgentRuntimeContext, contentGenerator: ContentGenerator, generationConfig: GenerateContentConfig = {}, initialHistory: Content[] = [], providerContext?: ProviderRuntimeContext)`.
     006.2. Replace `this.runtimeState = runtimeState;` with `this.runtimeState = view.state;` and `this.historyService = view.history;`.
     006.3. Replace all `this.config.getEphemeralSetting(...)` calls with `view.ephemerals` equivalents.
     006.4. Replace provider manager usage (`this.config.getProviderManager?.()`) with `view.provider` adapter.
     006.5. Replace telemetry logging (`logApiRequest(this.config, ...)`) with `view.telemetry.logApiRequest(...)` (same for response/error).
     006.6. Replace tool registry access with `view.tools`.
     006.7. Remove any remaining `this.config` references.

007. **Refactor `SubAgentScope`** _(implements REQ-STAT6-001.1, REQ-STAT6-003.2)_
     007.1. Constructor becomes `private constructor(id: string, runtimeContext: AgentRuntimeContext, modelConfig: ModelConfig, runConfig: RunConfig, promptConfig: PromptConfig, contentGenerator: ContentGenerator)`.
     007.2. `SubAgentScope.create(...)` builds `AgentRuntimeState` directly from subagent profile (provider, model, auth, proxy, modelParams, session).
     007.3. Build `ReadonlySettingsSnapshot` from profile (compression/context thresholds, preserve threshold, tool format override, telemetry flags/target).
     007.4. Call `createAgentRuntimeContext({ state, settings, providerManager: profile.providerManager, toolRegistry: profile.toolRegistry, telemetryTarget: profile.telemetryTarget })` to obtain view (history omitted → builder creates isolated instance).
     007.5. Instantiate content generator via `createContentGenerator(profile.contentGeneratorConfig, buildRuntimeContextAdapter(runtimeContext, foregroundConfig), runtimeContext.state.sessionId)`.
     007.6. Return new instance `new SubAgentScope(id, runtimeContext, profile.modelConfig, profile.runConfig, profile.promptConfig, contentGenerator)`.
     007.7. Update `createChatObject` to compute generation config from runtime view ephemerals and return `new GeminiChat(this.runtimeContext, this.contentGenerator, generationConfig, this.promptConfig.initialMessages ?? [])`.
     007.8. **Remove** any calls to `this.runtimeContext.setModel(...)` or other Config mutations.

008. **Provide Config compatibility adapter** _(migration aid for REQ-STAT6-003.1)_
     008.1. Implement helper `createRuntimeContextFromConfig(config: Config, history?: HistoryService): AgentRuntimeContext`.
     008.2. Derive runtime state using existing `AgentRuntimeState` helpers (`createAgentRuntimeStateFromConfig`).
     008.3. Capture settings snapshot (`compression-threshold`, `context-limit`, `compression-preserve-threshold`, `tool-format-override`, telemetry settings).
     008.4. Forward `config.getProviderManager?.()` and `config.getToolRegistry()` into runtime view builder.
     008.5. Return frozen runtime view for foreground agent paths until Config removal.

009. **Edge case handling** _(supports REQ-STAT6-001.3, REQ-STAT6-003.2)_
     009.1. Provider adapter for read-only views throws on `setActiveProvider` (prevents foreground mutation).
     009.2. Builder always creates new `HistoryService` when none supplied (ensures isolation).
     009.3. Ephemeral getters fallback to defaults to avoid `undefined` runtime behaviour.
     009.4. Telemetry adapter becomes no-op when telemetry disabled.
     009.5. Tool registry view gracefully handles missing registry by returning empty data.

010. **Traceability & Phase Mapping**

     **Step-to-Phase Mapping:**
     - **Steps 001-005** → **P06 (Stub Implementation)**: Interface definitions and factory scaffolding
       - Interface definitions (001-004)
       - Builder factory with frozen object creation (005)
       - Edge case handling (009)
       - Config compatibility adapter (008)

     - **Steps 006** → **P08 (GeminiChat Unit Implementation)**: GeminiChat refactor to use AgentRuntimeContext
       - Constructor signature change (006.1-006.2)
       - Ephemeral settings migration (006.3)
       - Provider/tool adapter integration (006.4, 006.6)
       - Telemetry adapter integration (006.5)
       - Config field elimination (006.7)

     - **Steps 007** → **P07 (SubAgentScope Integration)**: SubAgentScope isolation implementation
       - Constructor signature change (007.1)
       - Direct runtime state construction (007.2-007.4)
       - Content generator initialization (007.5)
       - Factory method refactor (007.6)
       - GeminiChat instantiation (007.7)
       - Config mutation elimination (007.8) ← **CRITICAL for REQ-STAT6-003.1**

     **Requirements Cross-Reference:**
     - REQ-STAT6-001.1 (Factory construction): Steps 005, 007.2-007.6, 008
     - REQ-STAT6-001.2 (GeminiChat Config elimination): Steps 006.1-006.7
     - REQ-STAT6-001.3 (Immutability): Steps 005.6, 009.1
     - REQ-STAT6-002.1 (Runtime state data): Step 003 (state field in interface)
     - REQ-STAT6-002.2 (Ephemeral settings): Steps 001, 003, 005.2, 006.3, 009.3
     - REQ-STAT6-002.3 (Telemetry integration): Steps 003, 005.4, 006.5
     - REQ-STAT6-003.1 (Config isolation): Steps 007.8, 008, 009.1
     - REQ-STAT6-003.2 (History isolation): Steps 005.1, 007.4, 009.2
     - REQ-STAT6-003.3 (Telemetry runtime correlation): Step 005.4
