/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  GenerateContentConfig,
  PartListUnion,
  Content,
  Tool,
  GenerateContentResponse,
  SendMessageParameters,
} from '@google/genai';
import {
  getDirectoryContextString,
  getEnvironmentContext,
} from '../utils/environmentContext.js';
import type { Turn, ServerGeminiStreamEvent } from './turn.js';

import type { Config } from '../config/config.js';
import type { UserTierId } from '../code_assist/types.js';
import {
  buildToolDeclarationsFromView,
  getEnabledToolNamesForPrompt,
} from './clientToolGovernance.js';
import type { GeminiChat } from './geminiChat.js';
import { DebugLogger } from '../debug/index.js';
import type { HistoryService } from '../services/history/HistoryService.js';

import {
  type ContentGenerator,
  type ContentGeneratorConfig,
  createContentGenerator,
} from './contentGenerator.js';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { LoopDetectionService } from '../services/loopDetectionService.js';

import { ComplexityAnalyzer } from '../services/complexity-analyzer.js';
import { TodoReminderService } from '../services/todo-reminder-service.js';
import { uiTelemetryService } from '../telemetry/uiTelemetry.js';
import type { AgentRuntimeState } from '../runtime/AgentRuntimeState.js';
import { subscribeToAgentRuntimeState } from '../runtime/AgentRuntimeState.js';
import { BaseLLMClient } from './baseLlmClient.js';
import type { IContent } from '../services/history/IContent.js';

import { coreEvents, CoreEvent } from '../utils/events.js';
import { estimateTokens as estimateTextTokens } from '../utils/toolOutputLimiter.js';
export {
  isThinkingSupported,
  findCompressSplitPoint,
} from './clientHelpers.js';
import {
  generateJson as clientLlmGenerateJson,
  generateContent as clientLlmGenerateContent,
  generateEmbedding as clientLlmGenerateEmbedding,
} from './clientLlmUtilities.js';
import { TodoContinuationService } from './TodoContinuationService.js';
export { PostTurnAction } from './TodoContinuationService.js';
import { IdeContextTracker } from './IdeContextTracker.js';
import { AgentHookManager } from './AgentHookManager.js';
import {
  buildSystemInstruction as factoryBuildSystemInstruction,
  createChatSessionSafe,
} from './ChatSessionFactory.js';
import {
  MessageStreamOrchestrator,
  type MessageStreamDeps,
} from './MessageStreamOrchestrator.js';

export class GeminiClient {
  private chat?: GeminiChat;
  private contentGenerator?: ContentGenerator;
  private embeddingModel: string;
  private logger: DebugLogger;
  private generateContentConfig: GenerateContentConfig = {
    temperature: 0,
    topP: 1,
  };
  private sessionTurnCount = 0;
  private readonly MAX_TURNS = 100;
  private _pendingConfig?: ContentGeneratorConfig;
  private _previousHistory?: Content[];
  private _storedHistoryService?: HistoryService;
  private currentSequenceModel: string | null = null;

  private readonly loopDetector: LoopDetectionService;
  private lastPromptId?: string;
  private readonly complexityAnalyzer: ComplexityAnalyzer;
  private readonly todoReminderService: TodoReminderService;
  private readonly todoContinuationService: TodoContinuationService;

  private readonly ideContextTracker: IdeContextTracker;
  private readonly agentHookManager: AgentHookManager;

  /**
   * Runtime state for stateless operation (Phase 5)
   * @plan PLAN-20251027-STATELESS5.P10
   * @requirement REQ-STAT5-003.1
   * @pseudocode gemini-runtime.md lines 21-42
   */
  private readonly runtimeState: AgentRuntimeState;
  private _historyService?: HistoryService;
  private _unsubscribe?: () => void;

  /**
   * BaseLLMClient for stateless utility operations (generateJson, embeddings, etc.)
   * Lazily initialized when needed
   */
  private _baseLlmClient?: BaseLLMClient;

  private readonly messageStreamOrchestrator: MessageStreamOrchestrator;

  /**
   * @plan PLAN-20251027-STATELESS5.P10
   * @requirement REQ-STAT5-003.1
   * @pseudocode gemini-runtime.md lines 11-66
   *
   * Phase 5 constructor: Accept optional AgentRuntimeState and HistoryService
   * When provided, client operates in stateless mode using runtime state
   * Otherwise falls back to Config-based operation (backward compatibility)
   */
  constructor(
    private readonly config: Config,
    runtimeState: AgentRuntimeState,
    historyService?: HistoryService,
  ) {
    if (!runtimeState.provider || runtimeState.provider === '') {
      throw new Error('AgentRuntimeState must have a valid provider');
    }
    if (!runtimeState.model || runtimeState.model === '') {
      throw new Error('AgentRuntimeState must have a valid model');
    }

    this.runtimeState = runtimeState;
    this._historyService = historyService;
    this.logger = new DebugLogger('llxprt:core:client');

    this._unsubscribe = subscribeToAgentRuntimeState(
      runtimeState.runtimeId,
      (event) => {
        this.logger.debug('Runtime state changed', event);
      },
    );

    void this._historyService;
    void this._unsubscribe;

    const proxyUrl = runtimeState.proxyUrl;
    if (proxyUrl) {
      setGlobalDispatcher(new ProxyAgent(proxyUrl));
    }

    const embeddingModel = config.getEmbeddingModel();
    this.embeddingModel = embeddingModel || runtimeState.model;
    this.loopDetector = new LoopDetectionService(config);
    this.lastPromptId = runtimeState.sessionId;

    // Initialize complexity analyzer with config settings
    const complexitySettings = config.getComplexityAnalyzerSettings();
    this.complexityAnalyzer = new ComplexityAnalyzer({
      complexityThreshold: complexitySettings.complexityThreshold,
      minTasksForSuggestion: complexitySettings.minTasksForSuggestion,
    });
    const complexitySuggestionCooldown =
      complexitySettings.suggestionCooldownMs ?? 300000;

    this.todoReminderService = new TodoReminderService();

    this.todoContinuationService = new TodoContinuationService({
      config,
      todoReminderService: this.todoReminderService,
      complexitySuggestionCooldown,
    });

    this.ideContextTracker = new IdeContextTracker(config);
    this.agentHookManager = new AgentHookManager(config);

    this.messageStreamOrchestrator = new MessageStreamOrchestrator(
      this._buildOrchestratorDeps(),
    );

    coreEvents.on(CoreEvent.ModelChanged, this.handleModelChanged);
  }

  private _buildOrchestratorDeps(): MessageStreamDeps {
    return {
      config: this.config,
      getChat: () => this.getChat(),
      logger: this.logger,
      loopDetector: this.loopDetector,
      todoContinuationService: this.todoContinuationService,
      ideContextTracker: this.ideContextTracker,
      agentHookManager: this.agentHookManager,
      getEffectiveModel: () => this._getEffectiveModelForCurrentTurn(),
      getHistory: () => this.getHistory(),
      getSessionTurnCount: () => this.sessionTurnCount,
      incrementSessionTurnCount: () => {
        this.sessionTurnCount++;
      },
      lazyInitialize: () => this.lazyInitialize(),
      startChat: (extraHistory?) => this.startChat(extraHistory),
      getPreviousHistory: () => this._previousHistory,
      setChat: (chat) => {
        this.chat = chat;
      },
      hasChat: () => this.chat !== undefined,
      complexityAnalyzer: this.complexityAnalyzer,
      getLastPromptId: () => this.lastPromptId,
      setLastPromptId: (id) => {
        this.lastPromptId = id;
      },
      resetCurrentSequenceModel: () => {
        this.currentSequenceModel = null;
      },
      updateTelemetryTokenCount: () => this.updateTelemetryTokenCount(),
      sendMessageStream: (req, sig, pid, trns, isRetry) =>
        this.sendMessageStream(req, sig, pid, trns, isRetry),
    };
  }

  private handleModelChanged = () => {
    this.currentSequenceModel = null;
  };

  dispose(): void {
    coreEvents.off(CoreEvent.ModelChanged, this.handleModelChanged);
    if (this._unsubscribe != null) {
      this._unsubscribe();
      this._unsubscribe = undefined;
    }
  }

  async initialize(contentGeneratorConfig: ContentGeneratorConfig) {
    // Preserve chat history before resetting, but only if we don't already have stored history
    // (e.g., from storeHistoryForLaterUse called before initialize)
    const previousHistory = this._previousHistory || this.chat?.getHistory();

    // Reset the client to force reinitialization with new auth
    this.contentGenerator = undefined;
    this.chat = undefined;

    // Store the new config and previous history for lazy initialization
    // This ensures the next lazyInitialize() call uses the correct auth config
    // and preserves conversation history across auth transitions
    this._pendingConfig = contentGeneratorConfig;
    this._previousHistory = previousHistory;
  }

  private async lazyInitialize() {
    if (this.isInitialized()) {
      return;
    }
    // Use pending config if available (from initialize() call), otherwise fall back to current config
    const contentGenConfig =
      this._pendingConfig || this.config.getContentGeneratorConfig();
    if (contentGenConfig == null) {
      throw new Error(
        'Content generator config not initialized. Call config.refreshAuth() first.',
      );
    }
    this.contentGenerator = await createContentGenerator(
      contentGenConfig,
      this.config,
      this.config.getSessionId(),
    );

    // Don't create chat here - that causes infinite recursion with startChat()
    // The chat will be created when needed

    // Clear pending config after successful initialization
    // Note: We do NOT clear _previousHistory as it may be needed for the chat context
    this._pendingConfig = undefined;
  }

  getContentGenerator(): ContentGenerator {
    if (this.contentGenerator == null) {
      throw new Error('Content generator not initialized');
    }
    return this.contentGenerator;
  }

  getUserTier(): UserTierId | undefined {
    return this.contentGenerator?.userTier;
  }

  /**
   * Get or create the BaseLLMClient for stateless utility operations.
   * This is lazily initialized to avoid creating it when not needed.
   */
  private getBaseLlmClient(): BaseLLMClient {
    if (this._baseLlmClient == null) {
      this._baseLlmClient = new BaseLLMClient(this.getContentGenerator());
    }
    return this._baseLlmClient;
  }

  async addHistory(content: Content) {
    // Ensure chat is initialized before adding history
    if (!this.hasChatInitialized()) {
      await this.resetChat();
    }
    this.getChat().addHistory(content);
  }

  async updateSystemInstruction(): Promise<void> {
    if (!this.isInitialized()) {
      return;
    }

    const enabledToolNames = getEnabledToolNamesForPrompt(this.config);
    const envParts = await getEnvironmentContext(this.config);
    const model = this.runtimeState.model;
    const systemInstruction = await factoryBuildSystemInstruction(
      this.config,
      enabledToolNames,
      envParts,
      model,
    );

    this.getChat().setSystemInstruction(systemInstruction);

    const historyService = this.getHistoryService();
    if (historyService != null) {
      try {
        const systemPromptTokens = await historyService.estimateTokensForText(
          systemInstruction,
          model,
        );
        historyService.setBaseTokenOffset(systemPromptTokens);
      } catch (_error) {
        historyService.setBaseTokenOffset(
          estimateTextTokens(systemInstruction),
        );
      }
    }
  }

  getChat(): GeminiChat {
    if (this.chat == null) {
      throw new Error('Chat not initialized');
    }
    return this.chat;
  }

  /**
   * Get the HistoryService from the current chat session
   * @returns The HistoryService instance, or null if chat is not initialized
   */
  getHistoryService(): HistoryService | null {
    // Removed verbose debug logging
    if (!this.hasChatInitialized()) {
      return null;
    }
    // Removed verbose debug logging
    return this.getChat().getHistoryService();
  }

  hasChatInitialized(): boolean {
    // Removed verbose debug logging
    return this.chat !== undefined;
  }

  isInitialized(): boolean {
    return this.chat !== undefined && this.contentGenerator !== undefined;
  }

  async getHistory(): Promise<Content[]> {
    // If we have stored history but no chat, return the stored history
    if (!this.hasChatInitialized() && this._previousHistory != null) {
      return this._previousHistory;
    }

    // If chat is initialized, get its current history
    if (this.hasChatInitialized()) {
      const chat = this.getChat() as unknown as {
        waitForIdle?: () => Promise<void>;
        getHistory: () => Content[];
      };
      if (typeof chat.waitForIdle === 'function') {
        await chat.waitForIdle();
      }
      return chat.getHistory();
    }

    // No history available
    return [];
  }

  async setHistory(
    history: Content[],
    { stripThoughts = false }: { stripThoughts?: boolean } = {},
  ): Promise<void> {
    const historyToSet = stripThoughts
      ? history.map((content) => {
          const newContent = { ...content };
          if (newContent.parts != null) {
            newContent.parts = newContent.parts.map((part) => {
              if (
                part &&
                typeof part === 'object' &&
                'thoughtSignature' in part
              ) {
                const newPart = { ...part };
                delete (newPart as { thoughtSignature?: string })
                  .thoughtSignature;
                return newPart;
              }
              return part;
            });
          }
          return newContent;
        })
      : history;

    // Store the history for later use
    this._previousHistory = historyToSet;

    // If chat is already initialized, update it immediately
    if (this.hasChatInitialized()) {
      this.getChat().setHistory(historyToSet);
    }
    // Otherwise, the history will be used when the chat is initialized

    // Reset IDE context tracking when history changes
    this.ideContextTracker.resetContext();
  }

  /**
   * Store history for later use when the client is initialized.
   * This is used when resuming a chat before authentication.
   * The history will be restored when lazyInitialize() is called.
   */
  storeHistoryForLaterUse(history: Content[]): void {
    this.logger.debug('Storing history for later use', {
      historyLength: history.length,
    });
    this._previousHistory = history;
  }

  /**
   * Store HistoryService instance for reuse after refreshAuth.
   * This preserves the UI's conversation display across provider switches.
   */
  storeHistoryServiceForReuse(historyService: HistoryService): void {
    this.logger.debug('Storing HistoryService for reuse', {
      hasHistoryService: !!historyService,
    });
    this._storedHistoryService = historyService;
  }

  async setTools(): Promise<void> {
    const toolRegistry = this.config.getToolRegistry();
    if (!toolRegistry) {
      return;
    }

    const toolsView =
      typeof this.chat?.getToolsView === 'function'
        ? this.chat.getToolsView()
        : undefined;
    const toolDeclarations =
      toolsView != null
        ? buildToolDeclarationsFromView(toolRegistry, toolsView)
        : toolRegistry.getFunctionDeclarations();
    this.todoContinuationService.updateTodoToolAvailabilityFromDeclarations(
      toolDeclarations,
    );

    // Debug log for intermittent tool issues
    const logger = new DebugLogger('llxprt:client:setTools');
    logger.debug(
      () => `setTools called, declarations count: ${toolDeclarations.length}`,
    );

    if (toolDeclarations.length === 0) {
      logger.warn(
        () => `WARNING: setTools called but toolDeclarations is empty!`,
        {
          stackTrace: new Error().stack,
        },
      );
    }

    const tools: Tool[] = [{ functionDeclarations: toolDeclarations }];
    // Ensure chat is initialized before setting tools
    if (!this.hasChatInitialized()) {
      await this.resetChat();
    }
    this.getChat().setTools(tools);
  }

  clearTools(): void {
    delete this.generateContentConfig.tools;
    if (this.chat != null && typeof this.chat.clearTools === 'function') {
      this.chat.clearTools();
    }
  }

  /**
   * Updates the UI telemetry service with the current prompt token count from chat.
   * This decouples GeminiChat from directly knowing about uiTelemetryService.
   */
  private updateTelemetryTokenCount(): void {
    if (this.chat != null) {
      uiTelemetryService.setLastPromptTokenCount(
        this.chat.getLastPromptTokenCount(),
      );
    }
  }

  async resetChat(): Promise<void> {
    // If chat exists, clear its history service
    if (this.chat != null) {
      const historyService = this.chat.getHistoryService();
      if (historyService) {
        // Clear the history service directly
        historyService.clear();
      } else {
        // Fallback to chat's clearHistory if no history service
        this.chat.clearHistory();
      }
      // Reset the chat's internal state
      this.ideContextTracker.resetContext();
    } else {
      // No chat exists yet, create one with empty history
      this.chat = await this.startChat([]);
    }
    this.updateTelemetryTokenCount();
    // Clear the stored history as well
    this._previousHistory = [];
  }

  async resumeChat(history: Content[]): Promise<void> {
    this.chat = await this.startChat(history);
  }

  /**
   * Restore history from a session by ensuring chat and content generator are fully initialized,
   * then adding history items to the HistoryService.
   *
   * P0 Fix: Synchronously initializes chat/content generator if needed before attempting history restore.
   * This ensures the history service is available immediately after the call completes.
   *
   * @param historyItems Array of IContent items from persisted session
   * @returns Promise that resolves when history is fully restored and chat is ready
   * @throws Error if initialization fails (e.g., auth not ready, config missing)
   */
  async restoreHistory(historyItems: IContent[]): Promise<void> {
    this.logger.debug('restoreHistory called', {
      itemCount: historyItems.length,
      hasContentGenerator: !!this.contentGenerator,
      hasChatInitialized: this.hasChatInitialized(),
    });

    if (historyItems.length === 0) {
      this.logger.warn('restoreHistory called with empty history array');
      return;
    }

    // P0 Fix Part 1: Ensure content generator is initialized
    // This will fail fast if auth/config isn't ready
    if (this.contentGenerator == null) {
      try {
        await this.lazyInitialize();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Cannot restore history: Content generator initialization failed. ${message}`,
        );
      }
    }

    // P0 Fix Part 2: Ensure chat is initialized with empty history
    // We create the chat first, then populate it with restored history
    if (!this.hasChatInitialized()) {
      try {
        this.chat = await this.startChat([]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Cannot restore history: Chat initialization failed. ${message}`,
        );
      }
    }

    // P0 Fix Part 3: Get history service and restore items
    const historyService = this.getHistoryService();
    if (historyService == null) {
      throw new Error(
        'Cannot restore history: History service unavailable after chat initialization',
      );
    }

    try {
      // Validate and fix any issues in the history service before adding items
      historyService.validateAndFix();

      // Add all history items
      historyService.addAll(historyItems);

      this.logger.debug('History restored successfully', {
        itemCount: historyItems.length,
        totalTokens: historyService.getTotalTokens(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to add history items to service: ${message}`);
    }
  }

  getCurrentSequenceModel(): string | null {
    return this.currentSequenceModel;
  }

  async addDirectoryContext(): Promise<void> {
    if (this.chat == null) {
      return;
    }

    this.getChat().addHistory({
      role: 'user',
      parts: [{ text: await getDirectoryContextString(this.config) }],
    });
  }

  async generateDirectMessage(
    params: SendMessageParameters,
    promptId: string,
  ): Promise<GenerateContentResponse> {
    await this.lazyInitialize();
    if (this.chat == null) {
      this.chat = await this.startChat([]);
    }
    return this.getChat().generateDirectMessage(params, promptId);
  }

  async startChat(extraHistory?: Content[]): Promise<GeminiChat> {
    this.ideContextTracker.resetContext();
    await this.lazyInitialize();

    const chat = await createChatSessionSafe({
      config: this.config,
      runtimeState: this.runtimeState,
      contentGenerator: this.getContentGenerator(),
      storedHistoryService: this._storedHistoryService,
      clearStoredHistoryService: () => {
        this._storedHistoryService = undefined;
      },
      extraHistory,
      generateContentConfig: this.generateContentConfig,
      todoContinuationService: this.todoContinuationService,
      toolRegistry: this.config.getToolRegistry(),
    });
    this.chat = chat;
    return chat;
  }

  private _getEffectiveModelForCurrentTurn(): string {
    if (this.currentSequenceModel) {
      return this.currentSequenceModel;
    }

    // In LLxprt, config.getModel() already handles provider-specific model resolution
    // and fallback mode, so we just return it directly
    return this.config.getModel();
  }

  async *sendMessageStream(
    initialRequest: PartListUnion,
    signal: AbortSignal,
    prompt_id: string,
    turns: number = this.MAX_TURNS,
    isInvalidStreamRetry: boolean = false,
  ): AsyncGenerator<ServerGeminiStreamEvent, Turn> {
    return yield* this.messageStreamOrchestrator.execute(
      initialRequest,
      signal,
      prompt_id,
      turns,
      isInvalidStreamRetry,
    );
  }

  async generateJson(
    contents: Content[],
    schema: Record<string, unknown>,
    abortSignal: AbortSignal,
    model: string,
    config: GenerateContentConfig = {},
  ): Promise<Record<string, unknown>> {
    await this.lazyInitialize();
    return clientLlmGenerateJson(
      this.config,
      this.getContentGenerator(),
      this.getBaseLlmClient(),
      contents,
      schema,
      abortSignal,
      model,
      { ...this.generateContentConfig, ...config },
      this.lastPromptId || this.config.getSessionId(),
    );
  }

  async generateContent(
    contents: Content[],
    generationConfig: GenerateContentConfig,
    abortSignal: AbortSignal,
    model: string,
  ): Promise<GenerateContentResponse> {
    await this.lazyInitialize();
    return clientLlmGenerateContent(
      this.config,
      this.getContentGenerator(),
      contents,
      generationConfig,
      abortSignal,
      model,
      this.lastPromptId || this.config.getSessionId(),
      this.generateContentConfig,
    );
  }

  async generateEmbedding(texts: string[]): Promise<number[][]> {
    await this.lazyInitialize();
    return clientLlmGenerateEmbedding(
      this.getBaseLlmClient(),
      texts,
      this.embeddingModel,
    );
  }
}
