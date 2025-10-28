# Pseudocode – GeminiRuntimeView & Stateless SubAgentScope (P05)

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

003. **Define `GeminiRuntimeView` interface** _(satisfies REQ-STAT6-001.2, REQ-STAT6-002.2, REQ-STAT6-002.3)_
     ```typescript
     interface GeminiRuntimeView {
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

004. **Define `GeminiRuntimeViewFactoryOptions` structure**
     ```typescript
     interface GeminiRuntimeViewFactoryOptions {
       state: AgentRuntimeState;
       settings: ReadonlySettingsSnapshot;
       providerManager?: ProviderManager;
       toolRegistry?: ToolRegistry;
       history?: HistoryService;
       telemetryTarget?: TelemetryTarget | null;
     }
     ```

005. **Implement `createGeminiRuntimeView(options)` builder** _(covers REQ-STAT6-002.2/002.3, REQ-STAT6-001.3)_
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
     006.1. Update signature to `constructor(view: GeminiRuntimeView, contentGenerator: ContentGenerator, generationConfig: GenerateContentConfig = {}, initialHistory: Content[] = [], providerContext?: ProviderRuntimeContext)`.
     006.2. Replace `this.runtimeState = runtimeState;` with `this.runtimeState = view.state;` and `this.historyService = view.history;`.
     006.3. Replace all `this.config.getEphemeralSetting(...)` calls with `view.ephemerals` equivalents.
     006.4. Replace provider manager usage (`this.config.getProviderManager?.()`) with `view.provider` adapter.
     006.5. Replace telemetry logging (`logApiRequest(this.config, ...)`) with `view.telemetry.logApiRequest(...)` (same for response/error).
     006.6. Replace tool registry access with `view.tools`.
     006.7. Remove any remaining `this.config` references.

007. **Refactor `SubAgentScope`** _(implements REQ-STAT6-001.1, REQ-STAT6-003.2)_
     007.1. Constructor becomes `private constructor(id: string, runtimeView: GeminiRuntimeView, modelConfig: ModelConfig, runConfig: RunConfig, promptConfig: PromptConfig, contentGenerator: ContentGenerator)`.
     007.2. `SubAgentScope.create(...)` builds `AgentRuntimeState` directly from subagent profile (provider, model, auth, proxy, modelParams, session).
     007.3. Build `ReadonlySettingsSnapshot` from profile (compression/context thresholds, preserve threshold, tool format override, telemetry flags/target).
     007.4. Call `createGeminiRuntimeView({ state, settings, providerManager: profile.providerManager, toolRegistry: profile.toolRegistry, telemetryTarget: profile.telemetryTarget })` to obtain view (history omitted → builder creates isolated instance).
     007.5. Instantiate content generator via `createContentGenerator(profile.contentGeneratorConfig, buildRuntimeContextAdapter(runtimeView, foregroundConfig), runtimeView.state.sessionId)`.
     007.6. Return new instance `new SubAgentScope(id, runtimeView, profile.modelConfig, profile.runConfig, profile.promptConfig, contentGenerator)`.
     007.7. Update `createChatObject` to compute generation config from runtime view ephemerals and return `new GeminiChat(this.runtimeView, this.contentGenerator, generationConfig, this.promptConfig.initialMessages ?? [])`.
     007.8. **Remove** any calls to `this.runtimeContext.setModel(...)` or other Config mutations.

008. **Provide Config compatibility adapter** _(migration aid for REQ-STAT6-003.1)_
     008.1. Implement helper `createRuntimeViewFromConfig(config: Config, history?: HistoryService): GeminiRuntimeView`.
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

010. **Traceability**
     - GeminiChat implementation references pseudocode steps 006.1–006.7.
     - SubAgentScope implementation references steps 007.1–007.8.
     - Runtime view builder references steps 005.1–005.6 and 009.1–009.5.
     - Config adapter references step 008.
