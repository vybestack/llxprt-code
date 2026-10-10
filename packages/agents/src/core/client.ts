/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ModelGenerationSettings,
  ModelOutput,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { AgentRequestInput } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { getDirectoryContextString } from '@vybestack/llxprt-code-core/utils/environmentContext.js';
import type { Turn, ServerAgentStreamEvent } from './turn.js';

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { updateClientSystemInstruction } from './clientSystemInstruction.js';
import { setClientTools } from './clientSetTools.js';
import { ChatSession, type SendMessageParams } from './chatSession.js';
import { resetClientHistory } from './clientResetHistory.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { createClientHistoryReader } from './clientHistoryReader.js';

import { type IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  type ContentGenerator,
  type ContentGeneratorConfig,
  createContentGenerator,
} from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { restoreClientHistory } from './clientRestoreHistory.js';
import { LoopDetectionService } from '@vybestack/llxprt-code-core/services/loopDetectionService.js';
import { ComplexityAnalyzer } from '@vybestack/llxprt-code-core/services/complexity-analyzer.js';
import { TodoReminderService } from '@vybestack/llxprt-code-core/services/todo-reminder-service.js';
import { uiTelemetryService } from '@vybestack/llxprt-code-core/telemetry/uiTelemetry.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { subscribeToAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { BaseLLMClient } from './baseLlmClient.js';
import { Storage } from '@vybestack/llxprt-code-settings/storage/Storage.js';

import {
  coreEvents,
  CoreEvent,
} from '@vybestack/llxprt-code-core/utils/events.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
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
import { createChatSessionSafe } from './ChatSessionFactory.js';
import {
  MessageStreamOrchestrator,
  type MessageStreamDeps,
} from './MessageStreamOrchestrator.js';
import {
  buildEffectiveModelIdentity,
  type EffectiveModelIdentity,
  type RoutedModelProvider,
} from './modelInfoHelpers.js';
import {
  RetainedHistoryAdmissions,
  replaceDeferredArray,
  releaseDeferredArray,
  type RetainedHistoryAdmission,
} from './retainedHistoryAdmissions.js';

import {
  isHistorySource,
  clearClientHistoryForDisposal,
  hasReferenceMedia,
} from './deferredHistorySource.js';
import type { DeferredHistorySourceOptions } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { transferReinitializedHistory } from './reinitializeHistorySource.js';
import {
  replaceClientHistorySource,
  replaceClientArrayHistory,
  replaceDeferredClientSource,
} from './clientHistoryReplacement.js';

export class AgentClient implements AgentClientContract {
  private chat?: ChatSession;
  private contentGenerator?: ContentGenerator;
  private embeddingModel: string;
  private logger: DebugLogger;
  private generateContentConfig: ModelGenerationSettings = {
    temperature: 0,
    topP: 1,
  };
  private sessionTurnCount = 0;
  private readonly MAX_TURNS = 100;
  private _pendingConfig?: ContentGeneratorConfig;
  private _previousHistory?: readonly IContent[];
  private _deferredHistoryAdmission?: RetainedHistoryAdmission;
  private _releaseDeferredSource?: () => Promise<void>;
  private streamedDeferredHistory = false;
  private readonly historyAdmissions: RetainedHistoryAdmissions;
  private _storedHistoryService?: HistoryService;
  private currentSequenceModel: string | null = null;
  private activeStreamCount = 0;
  private profileChangePendingChatInvalidation = false;

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
    createTurn?: MessageStreamDeps['createTurn'],
  ) {
    if (!runtimeState.provider || runtimeState.provider === '') {
      throw new Error('AgentRuntimeState must have a valid provider');
    }
    if (!runtimeState.model || runtimeState.model === '') {
      throw new Error('AgentRuntimeState must have a valid model');
    }

    this.runtimeState = runtimeState;
    this.historyAdmissions = new RetainedHistoryAdmissions(() =>
      this.config.getLocalMediaStore(),
    );
    this._historyService = historyService;
    this.logger = new DebugLogger('llxprt:core:client');

    this._unsubscribe = subscribeToAgentRuntimeState(
      runtimeState.runtimeId,
      (event) => {
        this.logger.debug('Runtime state changed', event);
      },
    );

    void this._historyService;

    const proxyUrl = runtimeState.proxyUrl;
    if (proxyUrl) {
      setGlobalDispatcher(new ProxyAgent(proxyUrl));
    }

    const embeddingModel = config.getEmbeddingModel();
    this.embeddingModel = embeddingModel ?? runtimeState.model;
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
      todoDataDirResolver: () => Storage.getGlobalDataDir(),
    });

    this.ideContextTracker = new IdeContextTracker(config);
    this.agentHookManager = new AgentHookManager(config);

    this.messageStreamOrchestrator = new MessageStreamOrchestrator(
      this._buildOrchestratorDeps(createTurn),
    );

    coreEvents.on(CoreEvent.ModelChanged, this.handleModelChanged);
    coreEvents.on(
      CoreEvent.ModelProfileChanged,
      this.handleModelProfileChanged,
    );
  }

  private _buildOrchestratorDeps(
    createTurn?: MessageStreamDeps['createTurn'],
  ): MessageStreamDeps {
    return {
      config: this.config,
      getChat: () => this.getChat(),
      logger: this.logger,
      loopDetector: this.loopDetector,
      todoContinuationService: this.todoContinuationService,
      ideContextTracker: this.ideContextTracker,
      agentHookManager: this.agentHookManager,
      getEffectiveModelIdentity: () => this._getEffectiveModelIdentity(),
      streamHistory: (signal) => this.streamHistory(signal),
      getSessionTurnCount: () => this.sessionTurnCount,
      incrementSessionTurnCount: () => {
        this.sessionTurnCount++;
      },
      lazyInitialize: () => this.lazyInitialize(),
      startChat: (extraHistory?: readonly IContent[]) =>
        this.startChat(extraHistory),
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
      sendMessageStream: (
        req,
        sig,
        pid,
        trns,
        isInvalidStreamRetry,
        isPayloadRecoveryRetry,
      ) =>
        this.sendMessageStream(
          req,
          sig,
          pid,
          trns,
          isInvalidStreamRetry,
          isPayloadRecoveryRetry,
        ),
      createTurn,
    };
  }

  private handleModelChanged = () => {
    this.currentSequenceModel = null;
  };

  private handleModelProfileChanged = () => {
    this.currentSequenceModel = null;
    if (this.activeStreamCount > 0) {
      this.profileChangePendingChatInvalidation = true;
      return;
    }
    this.invalidateChatForProfileChange();
  };

  private invalidateChatForProfileChange(): void {
    this.profileChangePendingChatInvalidation = false;
    if (!this.chat) {
      return;
    }
    this._storedHistoryService = this.chat.getHistoryService();
    this._previousHistory = undefined;
    this.chat = undefined;
    this._baseLlmClient = undefined;
  }

  async dispose(): Promise<void> {
    const failures: unknown[] = [];
    try {
      coreEvents.off(CoreEvent.ModelChanged, this.handleModelChanged);
      coreEvents.off(
        CoreEvent.ModelProfileChanged,
        this.handleModelProfileChanged,
      );
    } catch (error: unknown) {
      failures.push(error);
    }
    if (this._unsubscribe) {
      try {
        this._unsubscribe();
        this._unsubscribe = undefined;
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    const hasChatHistoryMedia = hasReferenceMedia(this._previousHistory);
    if (
      this.chat !== undefined &&
      (hasChatHistoryMedia === true || this.streamedDeferredHistory)
    ) {
      try {
        await clearClientHistoryForDisposal(
          this.chat,
          this.streamedDeferredHistory,
        );
        this.chat = undefined;
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    try {
      await this.releaseDeferredSource();
      if (this.streamedDeferredHistory) this._storedHistoryService?.dispose();
    } catch (error) {
      failures.push(error);
    }
    failures.push(
      ...(await this.historyAdmissions.release(this.historyAdmissions.all)),
    );
    if (failures.length === 0 && this.historyAdmissions.all.length === 0) {
      this._deferredHistoryAdmission = undefined;
      this._previousHistory = undefined;
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Agent client disposal failed');
    }
  }

  async initialize(
    contentGeneratorConfig: ContentGeneratorConfig,
    options: DeferredHistorySourceOptions = {},
  ): Promise<void> {
    const activeChat = this.chat;
    if (activeChat !== undefined) {
      await transferReinitializedHistory(
        activeChat,
        this.config,
        this.runtimeState,
        options,
        {
          admissions: this.historyAdmissions,
          priorAdmission: this._deferredHistoryAdmission,
          priorSource: this._releaseDeferredSource,
          publish: (candidate) => {
            this._storedHistoryService = candidate.journal;
            this._releaseDeferredSource = candidate.release;
            this.streamedDeferredHistory = true;
            this._previousHistory = undefined;
            this._deferredHistoryAdmission = undefined;
            this.contentGenerator = undefined;
            this.chat = undefined;
            this._pendingConfig = contentGeneratorConfig;
          },
        },
      );
      return;
    }
    options.signal?.throwIfAborted();
    this.contentGenerator = undefined;
    this._pendingConfig = contentGeneratorConfig;
  }

  private async lazyInitialize() {
    if (this.isInitialized()) {
      return;
    }
    // Use pending config if available (from initialize() call), otherwise fall back to current config
    const contentGenConfig =
      this._pendingConfig ?? this.config.getContentGeneratorConfig();
    if (!contentGenConfig) {
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
    if (!this.contentGenerator) {
      throw new Error('Content generator not initialized');
    }
    return this.contentGenerator;
  }

  /**
   * Get or create the BaseLLMClient for stateless utility operations.
   * This is lazily initialized to avoid creating it when not needed.
   */
  private getBaseLlmClient(): BaseLLMClient {
    this._baseLlmClient ??= new BaseLLMClient(this.getContentGenerator());
    return this._baseLlmClient;
  }

  async addHistory(content: IContent) {
    // Ensure chat is initialized before adding history
    if (!this.hasChatInitialized()) {
      await this.resetChat();
    }
    await this.getChat().admitAndAddHistory(content);
  }

  async updateSystemInstruction(): Promise<void> {
    if (!this.isInitialized()) {
      return;
    }

    await updateClientSystemInstruction(
      this.config,
      this.runtimeState.provider,
      this.getChat(),
    );
  }

  getChat(): ChatSession {
    if (!this.chat) {
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
    if (!this.hasChatInitialized()) return this._storedHistoryService ?? null;
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

  getHistory(
    _curated: false = false,
    signal?: AbortSignal,
  ): AsyncGenerator<IContent, void, unknown> {
    return this.streamHistory(signal);
  }

  readonly streamHistory = createClientHistoryReader(
    () => this.chat,
    () => this._previousHistory,
    () => this._storedHistoryService,
  );

  async setHistory(
    history: readonly IContent[],
    { stripThoughts = false }: { stripThoughts?: boolean } = {},
  ): Promise<void> {
    return this.settleClientHistoryUpdate(
      replaceClientArrayHistory(
        history,
        this.chat,
        this.historyAdmissions,
        this._deferredHistoryAdmission,
        this.replaceDeferredHistory.bind(this),
        this.publishActiveArrayHistory.bind(this),
        stripThoughts,
      ),
    );
  }

  private publishActiveArrayHistory(): void {
    this._previousHistory = undefined;
    this.streamedDeferredHistory = true;
  }

  private async settleClientHistoryUpdate(
    operation: Promise<void>,
  ): Promise<void> {
    await operation;
    if (this.chat !== undefined) this._deferredHistoryAdmission = undefined;
    this.ideContextTracker.resetContext();
  }

  async setHistoryFromSource(
    source: AsyncIterable<IContent>,
    options: DeferredHistorySourceOptions = {},
  ): Promise<void> {
    await replaceClientHistorySource(source, options, this.chat !== undefined, {
      config: this.config,
      runtime: this.runtimeState,
      existing: this.chat?.getHistoryService() ?? this._storedHistoryService,
      admissions: this.historyAdmissions,
      prior: this._deferredHistoryAdmission,
      priorRelease: this._releaseDeferredSource,
      publish: (journal, release) => {
        this._releaseDeferredSource = release;
        this._previousHistory = undefined;
        this._deferredHistoryAdmission = undefined;
        if (this.chat === undefined) {
          this._storedHistoryService = journal;
          this.streamedDeferredHistory = true;
        }
        this.ideContextTracker.resetContext();
      },
    });
  }

  private replaceDeferredHistory(
    history: readonly IContent[],
    options: DeferredHistorySourceOptions = {},
  ): Promise<void> {
    return this.publishDeferredArrayHistory(
      replaceDeferredArray(
        this.historyAdmissions,
        history,
        this._deferredHistoryAdmission,
        this._storedHistoryService,
        options,
      ),
    );
  }

  private async publishDeferredArrayHistory(
    operation: Promise<{
      journal: HistoryService;
      retained: RetainedHistoryAdmission;
    }>,
  ): Promise<void> {
    const next = await operation;
    const priorRelease = this._releaseDeferredSource;
    this._previousHistory = undefined;
    this._deferredHistoryAdmission = next.retained;
    this._storedHistoryService = next.journal;
    this._releaseDeferredSource = undefined;
    this.streamedDeferredHistory = true;
    await priorRelease?.();
  }

  /**
   * Store history for later use when the client is initialized.
   * This is used when resuming a chat before authentication.
   * The history will be restored when lazyInitialize() is called.
   */
  async storeHistoryForLaterUse(
    history: readonly IContent[] | AsyncIterable<IContent>,
    options: DeferredHistorySourceOptions = {},
  ): Promise<void> {
    if (!isHistorySource(history)) {
      return this.replaceDeferredHistory(history, options);
    }
    if (this.hasChatInitialized())
      throw new Error('Streamed deferred history requires an inactive chat');
    return replaceDeferredClientSource(history, options, {
      config: this.config,
      runtime: this.runtimeState,
      existing: this._storedHistoryService,
      admissions: this.historyAdmissions,
      prior: this._deferredHistoryAdmission,
      priorRelease: this._releaseDeferredSource,
      publish: (journal, release) => {
        this._storedHistoryService = journal;
        this.streamedDeferredHistory = true;
        this._previousHistory = undefined;
        this._deferredHistoryAdmission = undefined;
        this._releaseDeferredSource = release;
      },
    });
  }

  private async releaseDeferredSource(): Promise<void> {
    await this._releaseDeferredSource?.();
    this._releaseDeferredSource = undefined;
  }

  /**
   * Store HistoryService instance for reuse after refreshAuth.
   * This preserves the UI's conversation display across provider switches.
   */
  storeHistoryServiceForReuse(historyService: HistoryService): void {
    this.logger.debug('Storing HistoryService for reuse', {
      hasHistoryService: true,
    });
    this._storedHistoryService = historyService;
  }

  async setTools(): Promise<void> {
    await setClientTools(
      this.config.getToolRegistry(),
      this.chat,
      () => this.startChat(this._previousHistory ?? []),
      this.todoContinuationService,
    );
  }

  clearTools(): void {
    if (this.chat && typeof this.chat.clearTools === 'function') {
      this.chat.clearTools();
    }
  }

  /**
   * Updates the UI telemetry service with the current prompt token count from chat.
   * This decouples ChatSession from directly knowing about uiTelemetryService.
   */
  private updateTelemetryTokenCount(): void {
    if (this.chat) {
      uiTelemetryService.setLastPromptTokenCount(
        this.chat.getLastPromptTokenCount(),
      );
    }
  }

  async resetChat(
    preserveHistory?: readonly IContent[] | AsyncIterable<IContent>,
  ): Promise<void> {
    this.chat ??= await this.startChat([]);
    await resetClientHistory(this.chat, preserveHistory, (source) =>
      this.setHistoryFromSource(source),
    );
    await this.discardDeferredHistory();
    this.ideContextTracker.resetContext();
    this.updateTelemetryTokenCount();
  }

  async discardDeferredHistory(): Promise<void> {
    await this.releaseDeferredSource();
    if (this._deferredHistoryAdmission) {
      const failures = await this.historyAdmissions.release([
        this._deferredHistoryAdmission,
      ]);
      if (failures.length > 0)
        throw new AggregateError(failures, 'Deferred history cleanup failed');
    }
    this._deferredHistoryAdmission = undefined;
    this._previousHistory = undefined;
  }

  async resumeChat(history: readonly IContent[]): Promise<void> {
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
  async restoreHistory(historyItems: readonly IContent[]): Promise<void> {
    this.logger.debug('restoreHistory called', {
      itemCount: historyItems.length,
      hasContentGenerator: !!this.contentGenerator,
      hasChatInitialized: this.hasChatInitialized(),
    });

    if (historyItems.length === 0) {
      this.logger.warn('restoreHistory called with empty history array');
      return Promise.resolve();
    }

    return restoreClientHistory(
      {
        admissions: this.historyAdmissions,
        logger: this.logger,
        initialize: () => this.initializeRestoredChat(),
        getHistory: () => this.getHistoryService(),
      },
      historyItems,
    );
  }

  private async initializeRestoredChat(): Promise<void> {
    if (!this.contentGenerator) {
      try {
        await this.lazyInitialize();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Cannot restore history: Content generator initialization failed. ${message}`,
        );
      }
    }
    if (!this.hasChatInitialized()) {
      try {
        this.chat = await this.startChat([]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Cannot restore history: Chat initialization failed. ${message}`,
        );
      }
    }
  }

  getCurrentSequenceModel(): string | null {
    return this.currentSequenceModel;
  }

  async addDirectoryContext(): Promise<void> {
    if (!this.chat) return;

    this.getChat().addHistory({
      speaker: 'human',
      blocks: [
        { type: 'text', text: await getDirectoryContextString(this.config) },
      ],
    });
  }

  async generateDirectMessage(
    params: SendMessageParams,
    promptId: string,
  ): Promise<ModelOutput> {
    await this.lazyInitialize();
    this.chat ??= await this.startChat([]);
    return this.getChat().generateDirectMessage(params, promptId);
  }

  async startChat(extraHistory?: readonly IContent[]): Promise<ChatSession> {
    this.ideContextTracker.resetContext();
    await this.lazyInitialize();
    const deferredAdmission = this._deferredHistoryAdmission;

    let chat: ChatSession;
    try {
      chat = await createChatSessionSafe({
        config: this.config,
        runtimeState: this.runtimeState,
        contentGenerator: this.getContentGenerator(),
        storedHistoryService: this._storedHistoryService,
        clearStoredHistoryService: () => {
          if (this._releaseDeferredSource === undefined)
            this._storedHistoryService = undefined;
        },
        extraHistory:
          deferredAdmission === undefined ||
          this._storedHistoryService?.isEmpty() === true
            ? extraHistory
            : [],
        generateContentConfig: this.generateContentConfig,
        todoContinuationService: this.todoContinuationService,
        toolRegistry: this.config.getToolRegistry(),
        createHistoryService: () => new HistoryService(),
        createChatSessionInstance: (...args) => new ChatSession(...args),
      });
    } catch (error: unknown) {
      if (deferredAdmission === undefined) throw error;
      this._deferredHistoryAdmission = undefined;
      this._previousHistory = undefined;
      return this.historyAdmissions.releaseAfterFailure(
        error,
        [deferredAdmission],
        'Chat startup failed and deferred history cleanup was incomplete',
      );
    }

    if (deferredAdmission !== undefined) {
      try {
        await chat.getHistoryService().settleMediaOwnership();
      } catch (error: unknown) {
        this._deferredHistoryAdmission = undefined;
        this._previousHistory = undefined;
        return this.historyAdmissions.releaseAfterFailure(
          error,
          [deferredAdmission],
          'Chat startup failed and deferred history cleanup was incomplete',
          () => chat.clearHistory(),
        );
      }
      this.chat = chat;
      this._previousHistory = undefined;
      this.streamedDeferredHistory = true;
      await releaseDeferredArray(
        this.historyAdmissions,
        deferredAdmission,
        'Deferred history ownership transfer to chat was incomplete',
      );
      this._deferredHistoryAdmission = undefined;
    } else {
      if (this._releaseDeferredSource !== undefined) {
        await chat.getHistoryService().settleMediaOwnership();
        await this.releaseDeferredSource();
        this._storedHistoryService = undefined;
      }
      this.chat = chat;
    }
    return chat;
  }

  private _getEffectiveModelIdentity(): EffectiveModelIdentity {
    const configFallback = this.config.getModel();
    const runtimeProviderName = this.runtimeState.provider;
    let routedProviderName = runtimeProviderName;
    let routedProvider: RoutedModelProvider | undefined = undefined;
    if (
      this.chat &&
      typeof this.chat.resolveProviderForRuntime === 'function'
    ) {
      try {
        const provider = this.chat.resolveProviderForRuntime(
          'AgentClient.getEffectiveModelIdentity',
        );
        routedProviderName = provider.name;
        routedProvider = provider;
      } catch {
        routedProviderName = runtimeProviderName;
        routedProvider = undefined;
      }
    }
    return buildEffectiveModelIdentity(
      routedProviderName,
      routedProvider,
      this.currentSequenceModel,
      configFallback,
    );
  }

  async *sendMessageStream(
    initialRequest: AgentRequestInput,
    signal: AbortSignal,
    prompt_id: string,
    turns: number = this.MAX_TURNS,
    isInvalidStreamRetry: boolean = false,
    isPayloadRecoveryRetry: boolean = false,
  ): AsyncGenerator<ServerAgentStreamEvent, Turn> {
    this.activeStreamCount++;
    try {
      return yield* this.messageStreamOrchestrator.execute(
        initialRequest,
        signal,
        prompt_id,
        turns,
        isInvalidStreamRetry,
        isPayloadRecoveryRetry,
      );
    } finally {
      this.activeStreamCount--;
      if (
        this.activeStreamCount === 0 &&
        this.profileChangePendingChatInvalidation
      ) {
        this.invalidateChatForProfileChange();
      }
    }
  }

  async generateJson(
    contents: IContent[],
    schema: Record<string, unknown>,
    abortSignal: AbortSignal,
    model: string,
    config: ModelGenerationSettings = {},
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
      this.lastPromptId ?? this.config.getSessionId(),
      this.runtimeState.provider,
    );
  }

  async generateContent(
    contents: IContent[],
    generationConfig: ModelGenerationSettings,
    abortSignal: AbortSignal,
    model: string,
  ): Promise<ModelOutput> {
    await this.lazyInitialize();
    const output = await clientLlmGenerateContent(
      this.config,
      this.getContentGenerator(),
      contents,
      generationConfig,
      abortSignal,
      model,
      this.lastPromptId ?? this.config.getSessionId(),
      this.generateContentConfig,
      this.runtimeState.provider,
    );
    return output;
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
