/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createClientComplexity } from './clientHelpers.js';
import { resolveModelForSystemPrompt } from './systemPromptModel.js';
import { ClientSessionPolicy } from './client-session-policy.js';
import type { AgentRuntimeProviderAdapter } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';

import {
  requireInstructionReads,
  refreshClientSystemInstruction,
  createDirectoryContextMessage,
} from './chat-system-prompt.js';
import type { InstructionReadOperations } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';

import {
  assertSessionClientConfig,
  assertSessionClientProvider,
  assertClientRuntimeState,
} from './client-tool-selection.js';
import { releaseClientModelSubscriptions } from './client-model-subscriptions.js';
import { publishClientPromptTokens } from './client-telemetry.js';
import type { WorkspacePathOperations } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderManager.js';

import type {
  AgentChatContract,
  AgentRequestInput,
  AgentChatRecordingExecution,
  AgentClientContract,
} from '@vybestack/llxprt-code-core/core/clientContract.js';
import type {
  ModelGenerationSettings,
  ModelOutput,
  ToolDeclaration,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { Turn, ServerAgentStreamEvent } from './turn.js';

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  buildToolDeclarationsFromView,
  getEnabledToolNamesForPrompt,
} from './clientToolGovernance.js';
import { ChatSession, type SendMessageParams } from './chatSession.js';
import type { AdmittedModelParameters } from '@vybestack/llxprt-code-core/runtime/admittedModelParameters.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';

import { type IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  createContentGenerator,
  type ContentGenerator,
  type ContentGeneratorConfig,
} from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import type { LoopDetectionService } from '@vybestack/llxprt-code-core/services/loopDetectionService.js';
import type { ComplexityAnalyzer } from '@vybestack/llxprt-code-core/services/complexity-analyzer.js';
import { TodoReminderService } from '@vybestack/llxprt-code-core/services/todo-reminder-service.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { BaseLLMClient } from './baseLlmClient.js';
import { Storage } from '@vybestack/llxprt-code-settings/storage/Storage.js';

import {
  coreEvents,
  CoreEvent,
} from '@vybestack/llxprt-code-core/utils/events.js';
export {
  isThinkingSupported,
  findCompressSplitPoint,
} from './clientHelpers.js';
import { readClientHistory } from './clientHelpers.js';
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
  createChatSessionSafe,
  type CreateChatSessionDeps,
} from './ChatSessionFactory.js';
import {
  MessageStreamOrchestrator,
  type MessageStreamDeps,
} from './MessageStreamOrchestrator.js';
import { resolveClientModelIdentity } from './modelInfoHelpers.js';
import {
  RetainedHistoryAdmissions,
  type RetainedHistoryAdmission,
} from './retainedHistoryAdmissions.js';

import type { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';

export class AgentClient
  extends ClientSessionPolicy
  implements AgentClientContract
{
  private chat?: ChatSession;
  private contentGenerator?: ContentGenerator;
  private embeddingModel: string;
  private logger: DebugLogger;
  private generateContentConfig: ModelGenerationSettings = {
    temperature: 0,
    topP: 1,
  };
  private sessionTurnCount = 0;
  private sessionContentGeneratorConfig?: ContentGeneratorConfig;
  private _previousHistory?: readonly IContent[];
  private _deferredHistoryAdmission?: RetainedHistoryAdmission;
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

  bindIdeContext(
    ...readers: Parameters<IdeContextTracker['bindContext']>
  ): void {
    this.ideContextTracker.bindContext(...readers);
  }
  private readonly agentHookManager: AgentHookManager;

  /**
   * Runtime state for stateless operation (Phase 5)
   * @plan PLAN-20251027-STATELESS5.P10
   * @requirement REQ-STAT5-003.1
   * @pseudocode gemini-runtime.md lines 21-42
   */
  private readonly runtimeState: AgentRuntimeState;
  private _historyService?: HistoryService;

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
  private selectionManager: RuntimeProviderManager | undefined;
  private providerSelection?: AgentRuntimeProviderAdapter;

  assertConfig(config: Config): void {
    assertSessionClientConfig(this.config, config);
  }

  assertProviderManager(manager: RuntimeProviderManager): void {
    assertSessionClientProvider(this.selectionManager, manager);
  }

  private providerFileLifecycle: object | undefined;
  private composeRetryOperations: CreateChatSessionDeps['composeRetryOperations'];
  bindProviderFiles(
    lifecycle: object,
    composeRetryOperations: NonNullable<
      CreateChatSessionDeps['composeRetryOperations']
    >,
  ): void {
    this.providerFileLifecycle = lifecycle;
    this.composeRetryOperations = composeRetryOperations;
  }
  private historyTokenization: CreateChatSessionDeps['historyTokenization'];
  private promptEstimator: CreateChatSessionDeps['promptEstimator'];
  bindTokenization(
    ...operations: Parameters<
      NonNullable<AgentClientContract['bindTokenization']>
    >
  ): void {
    [this.historyTokenization, this.promptEstimator] = operations;
  }

  bindProviderSelection(
    selection: AgentRuntimeProviderAdapter,
    manager: RuntimeProviderManager,
  ): void {
    this.providerSelection = selection;
    this.selectionManager = manager;
  }

  constructor(
    private readonly config: Config,
    runtimeState: AgentRuntimeState,
    private readonly readMcpInstructions: () => string | undefined,
    readonly mediaStore: LocalMediaStore,
    private readonly workspacePaths: WorkspacePathOperations,
    historyService?: HistoryService,
    createTurn?: MessageStreamDeps['createTurn'],
    private readonly instructions?: InstructionReadOperations,
  ) {
    super();
    assertClientRuntimeState(runtimeState);

    this.runtimeState = runtimeState;
    this.historyAdmissions = new RetainedHistoryAdmissions(mediaStore);
    this._historyService = historyService;
    this.logger = new DebugLogger('llxprt:core:client');

    void this._historyService;

    const proxyUrl = runtimeState.proxyUrl;
    if (proxyUrl) {
      setGlobalDispatcher(new ProxyAgent(proxyUrl));
    }

    this.embeddingModel = config.getEmbeddingModel() ?? runtimeState.model;
    this.loopDetector = this.createLoopDetector(config);
    this.lastPromptId = runtimeState.sessionId;

    // Initialize complexity analyzer with config settings
    const complexity = createClientComplexity(
      config.getComplexityAnalyzerSettings(),
    );
    this.complexityAnalyzer = complexity.analyzer;
    const complexitySuggestionCooldown = complexity.cooldown;

    this.todoReminderService = new TodoReminderService();

    this.todoContinuationService = new TodoContinuationService({
      config,
      todoReminderService: this.todoReminderService,
      complexitySuggestionCooldown,
      todoDataDirResolver: () => Storage.getGlobalDataDir(),
    });

    this.ideContextTracker = new IdeContextTracker(config);
    this.agentHookManager = new AgentHookManager();

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
      getEffectiveModelIdentity: () =>
        resolveClientModelIdentity(
          this.runtimeState.model,
          this.runtimeState.provider,
          this.currentSequenceModel,
          this.chat,
        ),
      getHistory: () => this.getHistory(),
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
      sendMessageStream: (...args) => this.sendMessageStream(...args),
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
    const failures = releaseClientModelSubscriptions(
      this.handleModelChanged,
      this.handleModelProfileChanged,
    );
    const hasChatHistoryMedia = this._previousHistory?.some((content) =>
      content.blocks.some(
        (block) => block.type === 'media' && block.encoding === 'reference',
      ),
    );
    if (this.chat !== undefined && hasChatHistoryMedia === true) {
      try {
        await this.chat.clearHistory();
        this.chat = undefined;
      } catch (error: unknown) {
        failures.push(error);
      }
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

  async initialize(contentGeneratorConfig: ContentGeneratorConfig) {
    const activeChat = this.chat;
    let previousHistory: readonly IContent[] | undefined =
      activeChat?.getHistory() ?? this._previousHistory;
    if (activeChat !== undefined && previousHistory !== undefined) {
      const retained = await this.historyAdmissions.transferActiveHistory(
        previousHistory,
        () => activeChat.clearHistory(),
      );
      if (retained !== undefined) {
        previousHistory = retained.history;
        this._deferredHistoryAdmission = retained;
      }
    }

    this.contentGenerator = undefined;
    this.chat = undefined;
    this.sessionContentGeneratorConfig = contentGeneratorConfig;
    this._previousHistory = previousHistory;
  }

  private async lazyInitialize() {
    if (this.isInitialized()) {
      return;
    }
    const contentGenConfig = this.sessionContentGeneratorConfig;
    if (!contentGenConfig) {
      throw new Error(
        'Content generator config not initialized. Initialize the session client owner first.',
      );
    }
    this.contentGenerator = await createContentGenerator(
      contentGenConfig,
      this.config,
      this.config.getSessionId(),
    );

    // Don't create chat here - that causes infinite recursion with startChat()
    // The chat will be created when needed
  }

  getContentGeneratorConfig(): ContentGeneratorConfig | undefined {
    return this.sessionContentGeneratorConfig === undefined
      ? undefined
      : { ...this.sessionContentGeneratorConfig };
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
    return (this._baseLlmClient ??= new BaseLLMClient(
      this.getContentGenerator(),
    ));
  }

  async addHistory(content: IContent) {
    // Ensure chat is initialized before adding history
    if (!this.hasChatInitialized()) {
      await this.resetChat();
    }
    await this.getChat().admitAndAddHistory(content);
  }

  async updateSystemInstruction(
    instructions: InstructionReadOperations = requireInstructionReads(
      this.instructions,
    ),
  ): Promise<void> {
    if (!this.isInitialized()) {
      return;
    }

    const model = resolveModelForSystemPrompt(this.runtimeState.model);
    const systemInstruction = await refreshClientSystemInstruction(
      this.config,
      this.tools,
      this.readMcpInstructions,
      this.runtimeState.provider,
      this.workspacePaths.directories(),
      instructions,
      model,
      this.requireRuntimeSettings().promptPolicy ?? {},
      this.subagentDefinitions,
    );

    this.getChat().setSystemInstruction(systemInstruction);

    const historyService = this.getHistoryService();
    if (historyService) {
      const systemPromptTokens = await historyService.estimateTokensForText(
        systemInstruction,
        model,
      );
      historyService.setBaseTokenOffset(systemPromptTokens);
    }
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
    // Removed verbose debug logging
    return this.chat?.getHistoryService() ?? this._storedHistoryService ?? null;
  }

  hasChatInitialized(): boolean {
    // Removed verbose debug logging
    return this.chat !== undefined;
  }

  isInitialized(): boolean {
    return this.chat !== undefined && this.contentGenerator !== undefined;
  }

  async getHistory(): Promise<readonly IContent[]> {
    return readClientHistory(
      this.chat,
      this._previousHistory,
      this._storedHistoryService?.getAll.bind(this._storedHistoryService),
    );
  }

  async setHistory(
    history: readonly IContent[],
    {
      stripThoughts = false,
      historyOrigin,
    }: { stripThoughts?: boolean; historyOrigin?: object } = {},
  ): Promise<void> {
    const historyToSet: readonly IContent[] = stripThoughts
      ? history.map((content) => {
          const newContent = { ...content };
          newContent.blocks = newContent.blocks.map((block) => {
            if (block.type === 'thinking' && 'signature' in block) {
              const newBlock = { ...block };
              delete (newBlock as { signature?: string }).signature;
              return newBlock;
            }
            return block;
          });
          return newContent;
        })
      : history;
    const priorDeferred = this._deferredHistoryAdmission;

    if (this.hasChatInitialized()) {
      await this.getChat().setHistory(historyToSet, historyOrigin);
      this._previousHistory = this.getChat().getHistory();
      const transferFailures = await this.historyAdmissions.release(
        priorDeferred === undefined ? [] : [priorDeferred],
      );
      if (transferFailures.length > 0) {
        throw new AggregateError(
          transferFailures,
          'Deferred history cleanup after initialized update was incomplete',
        );
      }
      this._deferredHistoryAdmission = undefined;
    } else {
      await this.replaceDeferredHistory(historyToSet);
    }

    this.ideContextTracker.resetContext();
  }

  private async replaceDeferredHistory(
    history: readonly IContent[],
  ): Promise<void> {
    const retained = await this.historyAdmissions.replaceRetainedHistory(
      history,
      this._deferredHistoryAdmission,
      'agent-client-history',
    );
    this._previousHistory = retained?.history ?? history;
    this._deferredHistoryAdmission = retained;
  }

  /**
   * Store history for later use when the client is initialized.
   * This is used when resuming a chat before authentication.
   * The history will be restored when lazyInitialize() is called.
   */
  async storeHistoryForLaterUse(history: readonly IContent[]): Promise<void> {
    this.logger.debug('Storing history for later use', {
      historyLength: history.length,
    });
    await this.replaceDeferredHistory(history);
  }

  prepareHistoryRebind(
    history: HistoryService,
    previousChat?: AgentChatContract,
  ): () => void {
    const rebindChat = this.chat?.prepareHistoryRebind(history, previousChat);
    return () => {
      rebindChat?.();
      this._storedHistoryService =
        this.chat === undefined ? history : undefined;
    };
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

  async setTools(
    publicationDeclarations?: readonly ToolDeclaration[],
  ): Promise<void> {
    const toolRegistry = this.tools;

    const toolsView =
      typeof this.chat?.getToolsView === 'function'
        ? this.chat.getToolsView()
        : undefined;
    const toolDeclarations: ToolDeclaration[] =
      publicationDeclarations !== undefined
        ? [...publicationDeclarations]
        : buildToolDeclarationsFromView(toolRegistry, toolsView);
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

    if (!this.hasChatInitialized()) {
      this.chat = await this.startChat(this._previousHistory ?? []);
    }
    this.getChat().setTools(toolDeclarations);
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
    publishClientPromptTokens(this.chat?.getLastPromptTokenCount());
  }

  async resetChat(): Promise<void> {
    // If chat exists, clear its history and awaited external media resources.
    if (this.chat) {
      await this.chat.clearHistory();
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
  async restoreHistory(
    historyItems: readonly IContent[],
    historyOrigin?: object,
  ): Promise<void> {
    this.logger.debug('restoreHistory called', {
      itemCount: historyItems.length,
      hasContentGenerator: !!this.contentGenerator,
      hasChatInitialized: this.hasChatInitialized(),
    });

    if (historyItems.length === 0) {
      this.logger.warn('restoreHistory called with empty history array');
      return;
    }

    const restoreAdmission = await this.historyAdmissions.admitRetainedHistory(
      historyItems,
      'restore-history',
    );
    const admittedHistory = restoreAdmission?.history ?? historyItems;

    try {
      // P0 Fix Part 1: Ensure content generator is initialized
      // This will fail fast if auth/config isn't ready
      if (!this.contentGenerator) {
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
      if (!historyService) {
        throw new Error(
          'Cannot restore history: History service unavailable after chat initialization',
        );
      }

      try {
        // Validate and fix any issues in the history service before adding items
        historyService.validateAndFix();

        await historyService.replaceBatch(admittedHistory, undefined, {
          origin: historyOrigin,
          afterPublication: async () => {
            const releaseFailures = await this.historyAdmissions.release(
              restoreAdmission === undefined ? [] : [restoreAdmission],
            );
            if (releaseFailures.length > 0) {
              throw new AggregateError(
                releaseFailures,
                'Restored history publication cleanup failed',
              );
            }
          },
        });
        // Reset the cache anchor only after the complete restored history is
        // published, so a failed restore leaves the prior cache state intact.
        historyService.resetCacheAnchorSeq();

        this.logger.debug('History restored successfully', {
          itemCount: admittedHistory.length,
          totalTokens: historyService.getTotalTokens(),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to add history items to service: ${message}`);
      }
    } catch (error: unknown) {
      await this.historyAdmissions.releaseAfterFailure(
        error,
        restoreAdmission === undefined ? [] : [restoreAdmission],
        'History restoration failed and admitted media cleanup was incomplete',
      );
      return;
    }
  }

  getCurrentSequenceModel(): string | null {
    return this.currentSequenceModel;
  }

  async addDirectoryContext(): Promise<void> {
    if (!this.chat) {
      return;
    }

    this.getChat().addHistory(
      await createDirectoryContextMessage(this.workspacePaths.directories()),
    );
  }

  async generateDirectMessage(
    params: SendMessageParams,
    promptId: string,
    execution?: AgentChatRecordingExecution,
  ): Promise<ModelOutput> {
    await this.lazyInitialize();
    this.chat ??= await this.startChat([]);
    return this.getChat().generateDirectMessage(params, promptId, execution);
  }

  async startChat(extraHistory?: readonly IContent[]): Promise<ChatSession> {
    this.ideContextTracker.resetContext();
    await this.lazyInitialize();
    const deferredAdmission =
      extraHistory === this._deferredHistoryAdmission?.history
        ? this._deferredHistoryAdmission
        : undefined;

    let chat: ChatSession;
    try {
      chat = await createChatSessionSafe({
        config: this.config,
        historyTokenization: this.historyTokenization,
        providerFileLifecycle: this.providerFileLifecycle,
        composeRetryOperations: this.composeRetryOperations,
        promptEstimator: this.promptEstimator,
        mediaStore: this.mediaStore,
        readMcpInstructions: this.readMcpInstructions,
        instructions: requireInstructionReads(this.instructions),
        workspaceDirectories: () => this.workspacePaths.directories(),
        runtimeState: this.runtimeState,
        contentGenerator: this.getContentGenerator(),
        storedHistoryService: this._storedHistoryService,
        clearStoredHistoryService: () => {
          this._storedHistoryService = undefined;
        },
        extraHistory: deferredAdmission === undefined ? extraHistory : [],
        generateContentConfig: this.generateContentConfig,
        todoContinuationService: this.todoContinuationService,
        toolRegistry: this.tools,
        createHistoryService: () => new HistoryService(),
        createChatSessionInstance: (...args) => new ChatSession(...args),
        providerSelection: this.providerSelection,
        prepareProviderInvocation: this.prepareProviderInvocation,
        ...this.chatPolicyInputs(),
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
        await chat.setHistory(deferredAdmission.history);
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
      this._previousHistory = chat.getHistory();
      const transferFailures = await this.historyAdmissions.release([
        deferredAdmission,
      ]);
      if (transferFailures.length > 0) {
        throw new AggregateError(
          transferFailures,
          'Deferred history ownership transfer to chat was incomplete',
        );
      }
      this._deferredHistoryAdmission = undefined;
    } else {
      this.chat = chat;
    }
    return chat;
  }

  async *sendMessageStream(
    initialRequest: AgentRequestInput,
    signal: AbortSignal,
    prompt_id: string,
    turns: number = this.MAX_TURNS,
    isInvalidStreamRetry: boolean = false,
    isPayloadRecoveryRetry: boolean = false,
    recordingExecution?: AgentChatRecordingExecution,
    modelParameters?: AdmittedModelParameters,
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
        recordingExecution,
        modelParameters,
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
      this.readMcpInstructions,
      this.getContentGenerator(),
      this.getBaseLlmClient(),
      contents,
      schema,
      abortSignal,
      model,
      { ...this.generateContentConfig, ...config },
      this.lastPromptId ?? this.config.getSessionId(),
      this.runtimeState.provider,
      getEnabledToolNamesForPrompt(this.tools),
      requireInstructionReads(this.instructions),
      this.requireRuntimeSettings().promptPolicy ?? {},
      this.subagentDefinitions,
    );
  }

  async generateContent(
    contents: IContent[],
    generationConfig: ModelGenerationSettings,
    abortSignal: AbortSignal,
    model: string,
  ): Promise<ModelOutput> {
    await this.lazyInitialize();
    return clientLlmGenerateContent(
      this.config,
      this.readMcpInstructions,
      this.getContentGenerator(),
      contents,
      generationConfig,
      abortSignal,
      model,
      this.lastPromptId ?? this.config.getSessionId(),
      this.generateContentConfig,
      this.runtimeState.provider,
      getEnabledToolNamesForPrompt(this.tools),
      requireInstructionReads(this.instructions),
      this.requireRuntimeSettings().promptPolicy ?? {},
      this.subagentDefinitions,
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
