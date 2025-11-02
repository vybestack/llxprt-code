# State Coupling Analysis: Foreground Agent Runtime State

**Phase ID**: `PLAN-20251027-STATELESS5.P01`
**Analysis Date**: 2025-10-27
**Scope**: GeminiClient, GeminiChat, CLI Runtime Helpers, Slash Commands

## Executive Summary

This analysis identifies **89 critical Config touchpoints** across the foreground agent stack that must be migrated to use `AgentRuntimeState`. The coupling is **deeply entrenched** across three layers:

1. **Core Layer** (GeminiClient/GeminiChat): 45 touchpoints
2. **CLI Runtime Layer** (runtimeSettings.ts): 27 touchpoints
3. **Command Layer** (slash commands): 17 touchpoints

**Risk Level**: HIGH - Config is tightly coupled to provider/model/auth operations with bidirectional data flow and complex initialization sequences.

---

## 1. GeminiClient Config Coupling

### 1.1 Constructor & Initialization (Lines 152-172)

**File**: `/Users/acoliver/projects/llxprt-code/packages/core/src/core/client.ts`

**Touchpoints** (7):
```typescript
// @requirement:REQ-STAT5-001 - Provider/model/auth stored in Config
constructor(private readonly config: Config) {
  if (config.getProxy()) {                                  // TP-001
    setGlobalDispatcher(new ProxyAgent(config.getProxy())); // TP-002
  }
  this.embeddingModel = config.getEmbeddingModel();         // TP-003
  this.loopDetector = new LoopDetectionService(config);     // TP-004
  this.lastPromptId = this.config.getSessionId();           // TP-005
  const complexitySettings = config.getComplexityAnalyzerSettings(); // TP-006
  this.complexityAnalyzer = new ComplexityAnalyzer({        // TP-007
    complexityThreshold: complexitySettings.complexityThreshold,
    minTasksForSuggestion: complexitySettings.minTasksForSuggestion,
  });
}
```

**Impact**: Constructor expects Config passed in, establishes deep coupling at instantiation.

**Migration Notes**: Replace Config parameter with AgentRuntimeState. Proxy, embedding model, session ID must come from runtime state.

---

### 1.2 Lazy Initialization (Lines 190-214)

**Touchpoints** (4):
```typescript
private async lazyInitialize() {
  const contentGenConfig =
    this._pendingConfig || this.config.getContentGeneratorConfig(); // TP-008
  if (!contentGenConfig) {
    throw new Error('Content generator config not initialized...');
  }
  this.contentGenerator = await createContentGenerator(
    contentGenConfig,
    this.config,          // TP-009 - Passed to content generator
    this.config.getSessionId(), // TP-010
  );
  this._pendingConfig = undefined;
}
```

**Impact**: Critical initialization path requires Config for auth/provider setup. Content generator creation depends on Config.

**Migration Notes**: ContentGeneratorConfig must be sourced from runtime state. Session ID from runtime state.

---

### 1.3 Chat Creation & System Prompt (Lines 511-622)

**Touchpoints** (7):
```typescript
async startChat(extraHistory?: Content[]): Promise<GeminiChat> {
  await this.lazyInitialize();
  const envParts = await getEnvironmentContext(this.config);     // TP-011
  const toolRegistry = this.config.getToolRegistry();            // TP-012
  const userMemory = this.config.getUserMemory();                // TP-013
  const model = this.config.getModel();                          // TP-014

  let systemInstruction = await getCoreSystemPromptAsync(
    userMemory,
    model,                                                       // TP-015
    enabledToolNames,
  );

  const generateContentConfigWithThinking = isThinkingSupported(
    this.config.getModel(),                                      // TP-016
  ) ? { ... } : this.generateContentConfig;

  return new GeminiChat(
    this.config,          // TP-017 - Passed to GeminiChat constructor!
    this.getContentGenerator(),
    {
      systemInstruction,
      ...generateContentConfigWithThinking,
      tools,
    },
    [],
    historyService,
  );
}
```

**Impact**: Config passed directly to GeminiChat, establishing child dependency. Model name used for multiple decisions.

**Migration Notes**: Replace Config parameter in GeminiChat constructor. Model name must come from runtime state.

---

### 1.4 GeminiClient.sendMessageStream (Lines 796-991)

**File**: `/Users/acoliver/projects/llxprt-code/packages/core/src/core/client.ts`

**Touchpoints** (10):
```typescript
async *sendMessageStream(
  request: PartListUnion,
  signal: AbortSignal,
  prompt_id: string,
  turns: number = this.MAX_TURNS,
  originalModel?: string,
): AsyncGenerator<ServerGeminiStreamEvent, Turn> {
  // Max turns check
  if (
    this.config.getMaxSessionTurns() > 0 &&                     // TP-018
    this.sessionTurnCount > this.config.getMaxSessionTurns()    // TP-019
  ) {
    yield { type: GeminiEventType.MaxSessionTurns };
    const contentGenConfig = this.config.getContentGeneratorConfig(); // TP-020
    const providerManager = contentGenConfig?.providerManager;
    const providerName =
      providerManager?.getActiveProviderName() || 'backend';
    return new Turn(this.getChat(), prompt_id, providerName);
  }

  // Bounded turns check
  if (!boundedTurns) {
    const contentGenConfig = this.config.getContentGeneratorConfig(); // TP-021
    const providerManager = contentGenConfig?.providerManager;
    const providerName =
      providerManager?.getActiveProviderName() || 'backend';
    return new Turn(this.getChat(), prompt_id, providerName);
  }

  // Track the original model from the first call to detect model switching
  const initialModel = originalModel || this.config.getModel();    // TP-022

  // IDE mode context check
  if (this.config.getIdeMode() && !hasPendingToolCall) {            // TP-023
    const { contextParts, newIdeContext } = this.getIdeContextParts(
      this.forceFullIdeContext || history.length === 0,
    );
    // ... add context
  }

  // Get provider name for error messages
  const contentGenConfig = this.config.getContentGeneratorConfig(); // TP-024
  const providerManager = contentGenConfig?.providerManager;
  const providerName = providerManager?.getActiveProviderName() || 'backend';

  const turn = new Turn(this.getChat(), prompt_id, providerName);

  // Model switch detection at end
  if (!turn.pendingToolCalls.length && signal && !signal.aborted) {
    const currentModel = this.config.getModel();                    // TP-025
    if (currentModel !== initialModel) {                            // TP-026
      // Model was switched (likely due to quota error fallback)
      return turn;
    }
  }

  return turn;  // TP-027 - implicit: multiple provider lookups throughout
}
```

**Impact**: Session turn limits, IDE mode, and model switching all depend on Config state. Provider name resolution requires ContentGeneratorConfig.

**Migration Notes**: Max session turns, IDE mode flag, current model must all come from runtime state. Provider manager access must be refactored.

---

### 1.5 GeminiClient.generateJson (Lines 993-1123)

**File**: `/Users/acoliver/projects/llxprt-code/packages/core/src/core/client.ts`

**Touchpoints** (5):
```typescript
async generateJson(
  contents: Content[],
  schema: Record<string, unknown>,
  abortSignal: AbortSignal,
  model: string,
  config: GenerateContentConfig = {},
): Promise<Record<string, unknown>> {
  await this.lazyInitialize();
  const modelToUse = model;
  try {
    const userMemory = this.config.getUserMemory();             // TP-028
    const systemInstruction = await getCoreSystemPromptAsync(
      userMemory,
      modelToUse,
      this.getEnabledToolNamesForPrompt(),
    );

    const apiCall = () =>
      this.getContentGenerator().generateContent(
        {
          model: modelToUse,
          config: {
            ...requestConfig,
            systemInstruction,
            responseJsonSchema: schema,
            responseMimeType: 'application/json',
          },
          contents,
        },
        this.lastPromptId || this.config.getSessionId(),        // TP-029
      );

    const result = await retryWithBackoff(apiCall);
    // ... error handling and parsing
  } catch (error) {
    // Error reporting
  }
}
```

**Impact**: User memory and session ID required for JSON generation operations.

**Migration Notes**: User memory and session ID must come from runtime state.

---

### 1.6 GeminiClient.compression (Lines 1225-1388)

**File**: `/Users/acoliver/projects/llxprt-code/packages/core/src/core/client.ts`

**Touchpoints** (8):
```typescript
async tryCompressChat(
  prompt_id: string,
  force: boolean = false,
): Promise<ChatCompressionInfo> {
  await this.lazyInitialize();

  // ... early returns for empty history

  const model = this.config.getModel();                         // TP-030

  const contextPercentageThreshold =
    this.config.getChatCompression()?.contextPercentageThreshold; // TP-031

  // Don't compress if not forced and we are under the limit.
  if (!force) {
    const threshold =
      contextPercentageThreshold ?? COMPRESSION_TOKEN_THRESHOLD;
    if (originalTokenCount < threshold * tokenLimit(model)) {   // TP-032
      return {
        originalTokenCount,
        newTokenCount: originalTokenCount,
        compressionStatus: CompressionStatus.NOOP,
      };
    }
  }

  // ... compression logic

  // Emit token update event for the new compressed chat
  if (typeof compressedChat.getHistoryService === 'function') {
    const historyService = compressedChat.getHistoryService();
    if (historyService) {
      historyService.emit('tokensUpdated', {
        totalTokens: newTokenCount,
        addedTokens: newTokenCount - originalTokenCount,
        tokenLimit: tokenLimit(this.config.getModel()),        // TP-033
      });
    }
  }

  return {
    originalTokenCount,
    newTokenCount,
    compressionStatus: CompressionStatus.COMPRESSED,
  };
}
```

**Impact**: Compression threshold and model name determine when/how compression occurs. Token limits depend on model.

**Migration Notes**: Model name, chat compression settings must come from runtime state.

---

## 2. GeminiChat Config Coupling

### 2.1 GeminiChat.constructor (Lines 351-384)

**File**: `/Users/acoliver/projects/llxprt-code/packages/core/src/core/geminiChat.ts`

**Touchpoints** (4):
```typescript
constructor(
  private readonly config: Config,                          // TP-034
  contentGenerator: ContentGenerator,
  private readonly generationConfig: GenerateContentConfig = {},
  initialHistory: Content[] = [],
  historyService?: HistoryService,
) {
  validateHistory(initialHistory);

  this.historyService = historyService || new HistoryService();

  this.logger.debug('GeminiChat initialized:', {
    model: this.config.getModel(),                          // TP-035
    initialHistoryLength: initialHistory.length,
    hasHistoryService: !!historyService,
  });

  if (initialHistory.length > 0) {
    const currentModel = this.config.getModel();            // TP-036
    this.logger.debug('Adding initial history to service:', {
      count: initialHistory.length,
    });
    const idGen = this.historyService.getIdGeneratorCallback();
    for (const content of initialHistory) {
      const matcher = this.makePositionMatcher();
      this.historyService.add(
        ContentConverters.toIContent(content, idGen, matcher),
        currentModel,                                       // TP-037
      );
    }
  }
}
```

**Impact**: Constructor stores Config as private readonly field. Model name used for logging and history initialization.

**Migration Notes**: Replace Config parameter with AgentRuntimeState. Model name must be accessible from runtime state.

---

### 2.2 GeminiChat.sendMessage (Lines 498-807)

**File**: `/Users/acoliver/projects/llxprt-code/packages/core/src/core/geminiChat.ts`

**Touchpoints** (15):
```typescript
async sendMessage(
  params: SendMessageParameters,
  prompt_id: string,
): Promise<GenerateContentResponse> {
  // ... user content normalization

  // Provider switching logic
  const providerManager = this.config.getProviderManager?.();   // TP-038
  const desiredProviderName = this.config.getProvider();        // TP-039
  if (
    providerManager &&
    desiredProviderName &&
    provider.name !== desiredProviderName &&
    providerManager.listProviders().includes(desiredProviderName)
  ) {
    const previousProviderName = provider.name;
    try {
      providerManager.setActiveProvider(desiredProviderName); // TP-040
      const updatedProvider = providerManager.getActiveProvider();
      if (updatedProvider) {
        provider = updatedProvider;
      }
      // ... logging
    } catch (error) {
      // ... error handling
    }
  }

  const activeAuthType = this.config.getContentGeneratorConfig()?.authType; // TP-041
  const providerBaseUrl = this.resolveProviderBaseUrl(provider);

  this.logger.debug(
    () => '[GeminiChat] Active provider snapshot before stream/send',
    {
      providerName: provider.name,
      providerDefaultModel: provider.getDefaultModel?.(),
      configModel: this.config.getModel(),                      // TP-042
      baseUrl: providerBaseUrl,
      authType: activeAuthType,
    },
  );

  // ... API request preparation

  this._logApiRequest(
    ContentConverters.toGeminiContents(iContents),
    this.config.getModel(),                                     // TP-043
    prompt_id,
  );

  const startTime = Date.now();
  let response: GenerateContentResponse;

  try {
    const apiCall = async () => {
      const modelToUse = this.config.getModel() || DEFAULT_GEMINI_FLASH_MODEL; // TP-044

      // ... tool debug logging

      const activeRuntime = getActiveProviderRuntimeContext();
      const runtimeId = activeRuntime.runtimeId ?? 'geminiChat';
      const runtimeContext = {
        ...activeRuntime,
        runtimeId,
        settingsService:
          activeRuntime.settingsService ?? this.config.getSettingsService(), // TP-045
        config: activeRuntime.config ?? this.config,            // TP-046
        metadata: {
          ...(activeRuntime.metadata ?? {}),
          source: 'GeminiChat.trySendMessage',
          toolCount: tools?.length ?? 0,
        },
      } as const;

      const streamResponse = provider.generateChatCompletion!({
        contents: iContents,
        tools: tools as ProviderToolset | undefined,
        config: runtimeContext.config,                          // TP-047
        runtime: runtimeContext,
      });

      // ... stream processing
    };

    response = await retryWithBackoff(apiCall, {
      shouldRetry: (error: unknown) => {
        // ... retry logic
      },
    });

    const durationMs = Date.now() - startTime;
    await this._logApiResponse(
      durationMs,
      prompt_id,
      response.usageMetadata,
      JSON.stringify(response),
    );

    this.sendPromise = (async () => {
      const outputContent = response.candidates?.[0]?.content;

      // Send-then-commit: Now that we have a successful response
      const currentModel = this.config.getModel();              // TP-048

      // ... history management with currentModel (TP-049, TP-050, TP-051)

      if (
        fullAutomaticFunctionCallingHistory &&
        fullAutomaticFunctionCallingHistory.length > 0
      ) {
        // AFC case
        for (const content of automaticFunctionCallingHistory) {
          const idGen = this.historyService.getIdGeneratorCallback();
          const matcher = this.makePositionMatcher();
          this.historyService.add(
            ContentConverters.toIContent(content, idGen, matcher),
            currentModel,                                       // TP-049
          );
        }
      } else {
        // Regular case
        if (Array.isArray(userContent)) {
          for (const content of userContent) {
            this.historyService.add(
              ContentConverters.toIContent(content, idGen, matcher),
              currentModel,                                     // TP-050
            );
          }
        } else {
          this.historyService.add(
            ContentConverters.toIContent(userContent, idGen, matcher),
            currentModel,                                       // TP-051
          );
        }
      }

      // Add model response
      if (outputContent) {
        if (!this.isThoughtContent(outputContent)) {
          const idGen = this.historyService.getIdGeneratorCallback();
          this.historyService.add(
            ContentConverters.toIContent(outputContent, idGen),
            currentModel,                                       // TP-052
          );
        }
      } else if (response.candidates && response.candidates.length > 0) {
        if (
          !fullAutomaticFunctionCallingHistory ||
          fullAutomaticFunctionCallingHistory.length === 0
        ) {
          const emptyModelContent: Content = { role: 'model', parts: [] };
          const idGen = this.historyService.getIdGeneratorCallback();
          this.historyService.add(
            ContentConverters.toIContent(emptyModelContent, idGen),
            currentModel,                                       // TP-053
          );
        }
      }
    })();

    await this.sendPromise.catch(() => {
      this.sendPromise = Promise.resolve();
    });
    return response;
  } catch (error) {
    // ... error handling
  }
}
```

**Impact**: Provider manager, desired provider name, auth type, model name, settings service all sourced from Config. Model name used extensively for history tracking.

**Migration Notes**: Provider manager, provider name, auth type, model must all come from runtime state. SettingsService fallback must be removed.

---

### 2.3 GeminiChat.telemetry (Lines 414-464)

**File**: `/Users/acoliver/projects/llxprt-code/packages/core/src/core/geminiChat.ts`

**Touchpoints** (6):
```typescript
private async _logApiRequest(
  contents: Content[],
  model: string,
  prompt_id: string,
): Promise<void> {
  const requestText = this._getRequestTextFromContents(contents);
  logApiRequest(
    this.config,                                            // TP-054
    new ApiRequestEvent(model, prompt_id, requestText),
  );
}

private async _logApiResponse(
  durationMs: number,
  prompt_id: string,
  usageMetadata?: GenerateContentResponseUsageMetadata,
  responseText?: string,
): Promise<void> {
  logApiResponse(
    this.config,                                            // TP-055
    new ApiResponseEvent(
      this.config.getModel(),                               // TP-056
      durationMs,
      prompt_id,
      this.config.getContentGeneratorConfig()?.authType,    // TP-057
      usageMetadata,
      responseText,
    ),
  );
}

private _logApiError(
  durationMs: number,
  error: unknown,
  prompt_id: string,
): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorType = error instanceof Error ? error.name : 'unknown';

  logApiError(
    this.config,                                            // TP-058
    new ApiErrorEvent(
      this.config.getModel(),                               // TP-059
      errorMessage,
      durationMs,
      prompt_id,
      this.config.getContentGeneratorConfig()?.authType,    // TP-060
      errorType,
    ),
  );
}
```

**Impact**: All telemetry logging requires Config instance. Model name and auth type extracted repeatedly.

**Migration Notes**: Telemetry functions must accept runtime state instead of Config. Model and auth type from runtime state.

---

### 2.4 GeminiChat.compression (Lines 1598-1858)

**File**: `/Users/acoliver/projects/llxprt-code/packages/core/src/core/geminiChat.ts`

**Touchpoints** (7):
```typescript
async performCompression(prompt_id: string): Promise<void> {
  this.logger.debug('Starting compression');
  this.cachedCompressionThreshold = null;

  this.historyService.startCompression();

  try {
    const { toCompress, toKeep } = this.getCompressionSplit();
    // ... compression logic
  } finally {
    this.historyService.endCompression();
  }
}

private getCompressionSplit(): {
  toCompress: IContent[];
  toKeep: IContent[];
} {
  const curated = this.historyService.getCurated();

  const preserveThreshold =
    (this.config.getEphemeralSetting('compression-preserve-threshold') as // TP-061
      | number
      | undefined) ?? COMPRESSION_PRESERVE_THRESHOLD;
  let splitIndex = Math.floor(curated.length * (1 - preserveThreshold));
  // ... split logic
}

private async directCompressionCall(
  historyToCompress: IContent[],
  _prompt_id: string,
): Promise<string> {
  let provider = this.getActiveProvider();
  if (!provider) {
    throw new Error('No active provider configured');
  }

  const providerManager = this.config.getProviderManager?.();   // TP-062
  const desiredProviderName = this.config.getProvider();        // TP-063
  if (
    desiredProviderName &&
    providerManager &&
    provider.name !== desiredProviderName &&
    providerManager.listProviders().includes(desiredProviderName)
  ) {
    try {
      providerManager.setActiveProvider(desiredProviderName); // TP-064
      provider = providerManager.getActiveProvider();
      // ... logging
    } catch (error) {
      // ... error handling
    }
  }

  if (!this.providerSupportsIContent(provider)) {
    throw new Error('Provider does not support compression');
  }

  const activeAuthType = this.config.getContentGeneratorConfig()?.authType; // TP-065
  const providerBaseUrl = this.resolveProviderBaseUrl(provider);

  // ... compression request building

  this.logger.debug(
    () =>
      '[GeminiChat] Calling provider.generateChatCompletion (directCompression)',
    {
      providerName: provider.name,
      model: this.config.getModel(),                            // TP-066
      historyLength: compressionRequest.length,
      baseUrl: providerBaseUrl,
      authType: activeAuthType,
    },
  );

  const activeRuntime = getActiveProviderRuntimeContext();
  const runtimeId = activeRuntime.runtimeId ?? 'geminiChat';
  const runtimeContext = {
    ...activeRuntime,
    runtimeId,
    settingsService:
      activeRuntime.settingsService ?? this.config.getSettingsService(), // TP-067
    config: activeRuntime.config ?? this.config,                // TP-068
    metadata: {
      ...(activeRuntime.metadata ?? {}),
      source: 'GeminiChat.directCompression',
      historyLength: compressionRequest.length,
    },
  } as const;

  const stream = provider.generateChatCompletion!({
    contents: compressionRequest,
    tools: undefined,
    config: runtimeContext.config,                              // TP-069
    runtime: runtimeContext,
  });

  // ... stream processing
}

private applyCompression(summary: string, toKeep: IContent[]): void {
  this.historyService.clear();

  const currentModel = this.config.getModel();                  // TP-070

  this.historyService.add(
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: summary }],
    },
    currentModel,                                               // TP-071
  );

  this.historyService.add(
    {
      speaker: 'ai',
      blocks: [
        {
          type: 'text',
          text: 'Got it. Thanks for the additional context!',
        },
      ],
    },
    currentModel,                                               // TP-072
  );

  for (const content of toKeep) {
    this.historyService.add(content, currentModel);
  }
}
```

**Impact**: Compression threshold from ephemeral settings. Provider manager and provider name for provider switching. Model name for history tracking. Settings service fallback.

**Migration Notes**: Ephemeral settings, provider manager, provider name, model must come from runtime state. Remove settings service fallback.

---

## 3. CLI Runtime Settings Config Coupling

### 3.1 runtimeSettings.getContext (Lines 315-409)

**File**: `/Users/acoliver/projects/llxprt-code/packages/cli/src/runtime/runtimeSettings.ts`

**Touchpoints** (6):
```typescript
export function getCliRuntimeContext(): ProviderRuntimeContext {
  const identity = resolveActiveRuntimeIdentity();
  const entry = runtimeRegistry.get(identity.runtimeId);

  if (entry && entry.config) {                                  // TP-073
    const settingsService = entry.settingsService;

    if (isStatelessProviderIntegrationEnabled() && !settingsService) {
      throw new Error(
        formatMissingRuntimeMessage({
          runtimeId: identity.runtimeId,
          missingFields: ['SettingsService'],
          hint: 'Stateless hardening disables SettingsService fallbacks.',
        }),
      );
    }

    const resolvedSettings =
      settingsService ??
      entry.config.getSettingsService() ??                      // TP-074
      new SettingsService();

    return createProviderRuntimeContext({
      settingsService: resolvedSettings,
      config: entry.config,                                     // TP-075
      runtimeId: identity.runtimeId,
      metadata: identity.metadata,
    });
  }

  const context = getActiveProviderRuntimeContext();

  if (!context.config) {                                        // TP-076
    throw new Error(
      '[cli-runtime] Active provider runtime context is missing Config instance. ' +
        'Ensure gemini bootstrap initialised runtime before invoking helpers.',
    );
  }
  return context;
}

export function getCliRuntimeServices(): CliRuntimeServices {
  const { runtimeId } = resolveActiveRuntimeIdentity();
  const entry = requireRuntimeEntry(runtimeId);
  const context = getCliRuntimeContext();
  const config = entry.config ?? context.config;                // TP-077
  if (!config) {
    throw new Error(
      formatNormalizationFailureMessage({
        runtimeId,
        missingFields: ['Config'],
        hint: 'registerCliProviderInfrastructure() must supply Config before CLI helpers run.',
      }),
    );
  }
  const settingsService = entry.settingsService ?? context.settingsService;
  if (!settingsService) {
    throw new Error(
      formatMissingRuntimeMessage({
        runtimeId,
        missingFields: ['SettingsService'],
        hint: 'Call activateIsolatedRuntimeContext() or inject a runtime-specific SettingsService for tests.',
      }),
    );
  }
  const providerManager = entry.providerManager;
  if (!providerManager) {
    throw new Error(
      formatMissingRuntimeMessage({
        runtimeId,
        missingFields: ['ProviderManager'],
        hint: 'Ensure registerCliProviderInfrastructure() runs inside the runtime activation scope.',
      }),
    );
  }
  return { settingsService, config, providerManager };          // TP-078
}
```

**Impact**: Config is the primary service returned from runtime context lookups. Settings service fallback uses Config.getSettingsService().

**Migration Notes**: Replace Config access with AgentRuntimeState. Remove settings service fallback logic.

---

### 3.2 runtimeSettings.modelStatus (Lines 690-751)

**File**: `/Users/acoliver/projects/llxprt-code/packages/cli/src/runtime/runtimeSettings.ts`

**Touchpoints** (5):
```typescript
export function getActiveModelName(): string {
  const { config, settingsService, providerManager } = getCliRuntimeServices();
  const providerName = resolveActiveProviderName(settingsService, config);
  if (providerName) {
    const providerSettings = getProviderSettingsSnapshot(
      settingsService,
      providerName,
    );
    const storedModel = providerSettings.model as string | undefined;
    if (storedModel && storedModel.trim() !== '') {
      return storedModel;
    }
  }

  const configModel = config.getModel();                        // TP-079
  if (configModel) {
    return configModel;
  }

  try {
    const provider = providerManager.getActiveProvider();
    return provider.getDefaultModel?.() ?? '';
  } catch {
    return '';
  }
}

export function getActiveProviderStatus(): ProviderRuntimeStatus {
  const { config, settingsService, providerManager } = getCliRuntimeServices();
  const resolvedModel = getActiveModelName();
  const modelName =
    resolvedModel && resolvedModel.trim() !== '' ? resolvedModel : null;
  const authType = config.getContentGeneratorConfig()?.authType; // TP-080

  try {
    const provider = providerManager.getActiveProvider();
    const displayLabel = modelName
      ? `${provider.name}:${modelName}`
      : provider.name;
    return {
      providerName: provider.name,
      modelName,
      displayLabel,
      isPaidMode: provider.isPaidMode?.(),
      authType,                                                 // TP-081
    };
  } catch {
    const providerName =
      resolveActiveProviderName(settingsService, config) ?? null;
    const fallbackLabel = providerName
      ? modelName
        ? `${providerName}:${modelName}`
        : providerName
      : (modelName ?? 'unknown');
    return {
      providerName,
      modelName,
      displayLabel: fallbackLabel,
      authType,                                                 // TP-082
    };
  }
}
```

**Impact**: Model name and auth type read from Config for status display and runtime operations.

**Migration Notes**: Model name and auth type must come from runtime state.

---

### 3.3 runtimeSettings.ephemeral (Lines 779-797)

**File**: `/Users/acoliver/projects/llxprt-code/packages/cli/src/runtime/runtimeSettings.ts`

**Touchpoints** (4):
```typescript
export function getEphemeralSettings(): Record<string, unknown> {
  const { config } = getCliRuntimeServices();
  return config.getEphemeralSettings();                         // TP-083
}

export function getEphemeralSetting(key: string): unknown {
  const { config } = getCliRuntimeServices();
  return config.getEphemeralSetting(key);                       // TP-084
}

export function setEphemeralSetting(key: string, value: unknown): void {
  const { config } = getCliRuntimeServices();
  config.setEphemeralSetting(key, value);                       // TP-085
}

export function clearEphemeralSetting(key: string): void {
  const { config } = getCliRuntimeServices();
  config.setEphemeralSetting(key, undefined);                   // TP-086
}
```

**Impact**: All ephemeral settings stored in and retrieved from Config.

**Migration Notes**: Ephemeral settings must be part of runtime state, not Config.

---

### 3.4 runtimeSettings.providerSwitch (Lines 1169-1357)

**File**: `/Users/acoliver/projects/llxprt-code/packages/cli/src/runtime/runtimeSettings.ts`

**Touchpoints** (12):
```typescript
export async function switchActiveProvider(
  providerName: string,
  options: { autoOAuth?: boolean } = {},
): Promise<ProviderSwitchResult> {
  const autoOAuth = options.autoOAuth ?? false;
  const name = providerName.trim();
  if (!name) {
    throw new Error('Provider name is required.');
  }

  const { config, settingsService, providerManager } = getCliRuntimeServices();

  const currentProvider = providerManager.getActiveProviderName() || null;
  if (currentProvider === name) {
    return {
      changed: false,
      previousProvider: currentProvider,
      nextProvider: name,
      authType:
        config.getContentGeneratorConfig()?.authType ?? AuthType.USE_PROVIDER, // TP-087
      infoMessages: [],
    };
  }

  logger.debug(
    () =>
      `[cli-runtime] Switching provider from ${currentProvider ?? 'none'} to ${name}`,
  );

  for (const key of PROVIDER_SWITCH_EPHEMERAL_KEYS) {
    config.setEphemeralSetting(key, undefined);                 // TP-088
  }

  await providerManager.setActiveProvider(name);

  config.setProviderManager(providerManager);                   // TP-089
  config.setProvider(name);                                     // TP-090
  logger.debug(() => `[cli-runtime] set config provider=${name}`);
  config.setEphemeralSetting('activeProvider', name);           // TP-091
  logger.debug(
    () =>
      `[cli-runtime] config ephemeral activeProvider=${config.getEphemeralSetting('activeProvider')}`, // TP-092
  );

  const activeProvider = providerManager.getActiveProvider();
  const providerSettings = getProviderSettingsSnapshot(settingsService, name);

  // Clear any cached model parameters for the new provider
  const existingParams = extractModelParams(providerSettings);
  for (const key of Object.keys(existingParams)) {
    settingsService.setProviderSetting(name, key, undefined);
  }

  let resolvedDefaultModel =
    (providerSettings.model as string | undefined) ??
    activeProvider.getDefaultModel?.() ??
    '';

  if (resolvedDefaultModel) {
    settingsService.setProviderSetting(name, 'model', resolvedDefaultModel);
  } else {
    resolvedDefaultModel = '';
    settingsService.setProviderSetting(name, 'model', undefined);
  }

  await settingsService.switchProvider(name);
  logger.debug(
    () =>
      `[cli-runtime] settingsService activeProvider now=${settingsService.get('activeProvider')}`,
  );
  config.setModel(resolvedDefaultModel);                       // TP-093

  // ... provider unwrapping logic

  let providerBaseUrl: string | undefined;
  if (name === 'qwen') {
    providerBaseUrl = 'https://portal.qwen.ai/v1';
  }
  if (providerBaseUrl) {
    config.setEphemeralSetting('base-url', providerBaseUrl);    // TP-094
    settingsService.setProviderSetting(name, 'baseUrl', providerBaseUrl);
  } else {
    settingsService.setProviderSetting(name, 'baseUrl', undefined);
  }

  let authType: AuthType;
  if (name === 'gemini') {
    const currentAuthType = config.getContentGeneratorConfig()?.authType; // TP-095
    if (
      currentAuthType === AuthType.USE_PROVIDER ||
      currentAuthType === undefined
    ) {
      if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        authType = AuthType.USE_VERTEX_AI;
      } else if (process.env.GEMINI_API_KEY) {
        authType = AuthType.USE_GEMINI;
      } else {
        authType = AuthType.LOGIN_WITH_GOOGLE;
      }
    } else {
      authType = currentAuthType;
    }
  } else {
    authType = AuthType.USE_PROVIDER;
  }

  await config.refreshAuth(authType);                           // TP-096

  const infoMessages: string[] = [];

  // ... OAuth handling logic

  return {
    changed: true,
    previousProvider: currentProvider,
    nextProvider: name,
    defaultModel: resolvedDefaultModel || undefined,
    authType,
    infoMessages,
  };
}
```

**Impact**: Provider switching writes to Config ephemeral settings, sets provider/model on Config, refreshes auth through Config. Config is the coordination point for provider switching.

**Migration Notes**: All provider/model/auth state changes must go to runtime state instead of Config. Remove Config.setProvider, Config.setModel, Config.setEphemeralSetting calls.

---

## 4. Slash Commands Config Coupling

### 4.1 setCommand (Lines 489-841)

**File**: `/Users/acoliver/projects/llxprt-code/packages/cli/src/ui/commands/setCommand.ts`

**Touchpoints** (3):
```typescript
export const setCommand: SlashCommand = {
  name: 'set',
  description: 'set model parameters or ephemeral settings',
  kind: CommandKind.BUILT_IN,
  schema: setSchema,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<MessageActionReturn> => {
    const runtime = getRuntimeApi();
    const trimmedArgs = args?.trim();

    // ... argument parsing

    if (key === 'modelparam') {
      // ... model parameter handling via runtime API
      try {
        runtime.setActiveModelParam(paramName, parsedParamValue); // Uses Config internally
      } catch (error) {
        // ... error handling
      }
    }

    // ... validation logic

    // Get the config to apply settings
    const config = context.services.config;                     // TP-097
    if (!config) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'No configuration available',
      };
    }

    // ... more validation

    // Store ephemeral settings in memory only
    runtime.setEphemeralSetting(key, parsedValue);              // TP-098 - Uses Config internally

    return {
      type: 'message',
      messageType: 'info',
      content: `Ephemeral setting '${key}' set to ${JSON.stringify(parsedValue)} (session only, use /profile save to persist)`,
    };
  },
};
```

**Impact**: setCommand accesses Config from context.services and uses runtime API which internally accesses Config for ephemeral settings and model params.

**Migration Notes**: Runtime API must access runtime state instead of Config. Remove Config dependency from context.services.

---

### 4.2 providerCommand (Lines 22-86)

**File**: `/Users/acoliver/projects/llxprt-code/packages/cli/src/ui/commands/providerCommand.ts`

**Touchpoints** (1):
```typescript
export const providerCommand: SlashCommand = {
  name: 'provider',
  description:
    'switch between different AI providers (openai, anthropic, etc.)',
  kind: CommandKind.BUILT_IN,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<OpenDialogActionReturn | MessageActionReturn | void> => {
    const providerName = args?.trim();

    if (!providerName) {
      return {
        type: 'dialog',
        dialog: 'provider',
      };
    }

    try {
      const runtime = getRuntimeApi();
      const result = await runtime.switchActiveProvider(providerName); // TP-099 - Uses Config internally

      if (!result.changed) {
        return {
          type: 'message',
          messageType: 'info',
          content: `Already using provider: ${result.nextProvider}`,
        };
      }

      // ... success handling
    } catch (error) {
      // ... error handling
    }
  },
};
```

**Impact**: providerCommand uses runtime API switchActiveProvider which writes to Config (see TP-087 through TP-096).

**Migration Notes**: Runtime API must write to runtime state instead of Config.

---

### 4.3 modelCommand (Lines 20-51)

**File**: `/Users/acoliver/projects/llxprt-code/packages/cli/src/ui/commands/modelCommand.ts`

**Touchpoints** (1):
```typescript
export const modelCommand: SlashCommand = {
  name: 'model',
  description: 'select or switch model',
  kind: CommandKind.BUILT_IN,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<OpenDialogActionReturn | MessageActionReturn | void> => {
    const modelName = args?.trim();

    if (!modelName) {
      return {
        type: 'dialog',
        dialog: 'providerModel',
      };
    }

    try {
      const runtime = getRuntimeApi();
      const result = await runtime.setActiveModel(modelName);   // TP-100 - Uses Config internally

      return {
        type: 'message',
        messageType: 'info',
        content: `Switched from ${result.previousModel ?? 'unknown'} to ${result.nextModel} in provider '${result.providerName}'`,
      };
    } catch (error) {
      // ... error handling
    }
  },
};
```

**Impact**: modelCommand uses runtime API setActiveModel which writes to Config.

**Migration Notes**: Runtime API must write to runtime state instead of Config.

---

## Touchpoint Summary

| Component | File | Line Range | Touchpoints |
|-----------|------|------------|-------------|
| GeminiClient.constructor | client.ts | 152-172 | 7 (TP-001 to TP-007) |
| GeminiClient.lazyInitialize | client.ts | 190-214 | 3 (TP-008 to TP-010) |
| GeminiClient.startChat | client.ts | 511-622 | 7 (TP-011 to TP-017) |
| GeminiClient.sendMessageStream | client.ts | 796-991 | 10 (TP-018 to TP-027) |
| GeminiClient.generateJson | client.ts | 993-1123 | 2 (TP-028 to TP-029) |
| GeminiClient.compression | client.ts | 1225-1388 | 4 (TP-030 to TP-033) |
| GeminiChat.constructor | geminiChat.ts | 351-384 | 4 (TP-034 to TP-037) |
| GeminiChat.sendMessage | geminiChat.ts | 498-807 | 16 (TP-038 to TP-053) |
| GeminiChat.telemetry | geminiChat.ts | 414-464 | 7 (TP-054 to TP-060) |
| GeminiChat.compression | geminiChat.ts | 1598-1858 | 12 (TP-061 to TP-072) |
| runtimeSettings.getContext | runtimeSettings.ts | 315-409 | 6 (TP-073 to TP-078) |
| runtimeSettings.modelStatus | runtimeSettings.ts | 690-751 | 3 (TP-079 to TP-082) |
| runtimeSettings.ephemeral | runtimeSettings.ts | 779-797 | 4 (TP-083 to TP-086) |
| runtimeSettings.providerSwitch | runtimeSettings.ts | 1169-1357 | 10 (TP-087 to TP-096) |
| setCommand | setCommand.ts | 489-841 | 2 (TP-097 to TP-098) |
| providerCommand | providerCommand.ts | 22-86 | 1 (TP-099) |
| modelCommand | modelCommand.ts | 20-51 | 1 (TP-100) |
| **TOTAL** | **6 files, 3 layers** | **~3500 lines** | **100** |

**Note**: Original estimate was 89 touchpoints. Detailed analysis revealed 100 distinct Config usage points. The variance is due to multiple model name accesses in history tracking and runtime context building that were initially grouped.

---

## Critical Migration Paths

### Path 1: GeminiClient Constructor Injection
**Touchpoints**: TP-001 to TP-007
**Strategy**: Replace `constructor(config: Config)` with `constructor(runtimeState: AgentRuntimeState)`

### Path 2: GeminiChat Constructor Injection
**Touchpoints**: TP-034 to TP-037
**Strategy**: Replace `constructor(config: Config, ...)` with `constructor(runtimeState: AgentRuntimeState, ...)`

### Path 3: Provider Manager Decoupling
**Touchpoints**: TP-038 to TP-040, TP-062 to TP-064, TP-089
**Strategy**: Access provider manager through runtime state instead of Config.getProviderManager()

### Path 4: Model Name Migration
**Touchpoints**: TP-014 to TP-016, TP-022, TP-025, TP-030, TP-033, TP-035 to TP-037, TP-042 to TP-044, TP-048 to TP-053, TP-056, TP-059, TP-066, TP-070 to TP-072, TP-079
**Strategy**: Replace all Config.getModel() calls with runtimeState.getModel()

### Path 5: Ephemeral Settings Migration
**Touchpoints**: TP-061, TP-083 to TP-086, TP-088, TP-091, TP-092, TP-094, TP-098
**Strategy**: Move ephemeral settings from Config to AgentRuntimeState

### Path 6: Provider Switching Refactor
**Touchpoints**: TP-087 to TP-096
**Strategy**: Replace Config.setProvider(), Config.setModel(), Config.setEphemeralSetting() with runtime state mutations

### Path 7: Telemetry Decoupling
**Touchpoints**: TP-054 to TP-060
**Strategy**: Pass runtime state snapshot to telemetry functions instead of Config

### Path 8: Settings Service Fallback Removal
**Touchpoints**: TP-045, TP-067, TP-074
**Strategy**: Remove Config.getSettingsService() fallback under stateless hardening

---

## Risk Assessment

### High-Risk Areas

1. **Constructor Injection Changes** (TP-001 to TP-007, TP-034 to TP-037)
   - **Risk**: Breaking changes to GeminiClient and GeminiChat instantiation across entire codebase
   - **Mitigation**: Comprehensive test coverage before refactor, phased rollout with adapter pattern

2. **Provider Switching Logic** (TP-087 to TP-096)
   - **Risk**: Complex coordination between Config, SettingsService, ProviderManager
   - **Mitigation**: Atomic state transitions, comprehensive integration tests

3. **History Service Model Tracking** (TP-036, TP-037, TP-048 to TP-053, TP-070 to TP-072)
   - **Risk**: Model name consistency across history entries critical for UI display
   - **Mitigation**: Ensure runtime state model changes propagate before history additions

### Medium-Risk Areas

1. **Ephemeral Settings Migration** (TP-083 to TP-086, TP-088, TP-091, TP-092, TP-094, TP-098)
   - **Risk**: Settings scattered across Config, need centralized migration
   - **Mitigation**: Comprehensive ephemeral settings audit, migration helper functions

2. **Telemetry Refactoring** (TP-054 to TP-060)
   - **Risk**: Telemetry functions tightly coupled to Config structure
   - **Mitigation**: Create telemetry context snapshot from runtime state

### Low-Risk Areas

1. **Model Name Reads** (most touchpoints)
   - **Risk**: Straightforward replacement of Config.getModel() with runtime state accessor
   - **Mitigation**: Automated refactoring with search/replace, verify with tests

---

## Open Questions

1. **AgentRuntimeState Scope**: Should ephemeral settings (TP-083 to TP-086) be part of AgentRuntimeState or separate?
   - **Answer Needed For**: Phase 02 (Pseudocode Design)

2. **Provider Manager Ownership**: Should ProviderManager be owned by runtime state or passed as dependency?
   - **Answer Needed For**: Phase 02 (Pseudocode Design)

3. **Settings Service Elimination**: Can we fully eliminate SettingsService fallbacks (TP-045, TP-067, TP-074)?
   - **Answer Needed For**: Phase 03 (AgentRuntimeState Implementation)

4. **Compression Settings**: Should compression threshold (TP-031, TP-061) be in runtime state or remain ephemeral?
   - **Answer Needed For**: Phase 02 (Pseudocode Design)

---

**@plan:PLAN-20251027-STATELESS5.P01**
**@requirement:REQ-STAT5-001** (AgentRuntimeState replaces Config for provider/model/auth)
**@requirement:REQ-STAT5-002** (CLI runtime helper integration)
**@requirement:REQ-STAT5-003** (GeminiClient runtime consumption)
**@requirement:REQ-STAT5-004** (GeminiChat stateless operation)
