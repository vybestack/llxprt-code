/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  EmbedContentParameters,
  GenerateContentConfig,
  PartListUnion,
  Part,
  Content,
  Tool,
  FunctionDeclaration,
  GenerateContentResponse,
  SendMessageParameters,
} from '@google/genai';
import {
  getDirectoryContextString,
  getEnvironmentContext,
} from '../utils/environmentContext.js';
import {
  Turn,
  ServerGeminiStreamEvent,
  GeminiEventType,
  DEFAULT_AGENT_ID,
} from './turn.js';
import type { ChatCompressionInfo, ToolCallResponseInfo } from './turn.js';
import { CompressionStatus } from './turn.js';
import { Config } from '../config/config.js';
import { UserTierId } from '../code_assist/types.js';
import { getCoreSystemPromptAsync, getCompressionPrompt } from './prompts.js';
import { getResponseText } from '../utils/generateContentResponseUtilities.js';
import { reportError } from '../utils/errorReporting.js';
import { GeminiChat } from './geminiChat.js';
import { DebugLogger } from '../debug/index.js';
import { HistoryService } from '../services/history/HistoryService.js';
import { ContentConverters } from '../services/history/ContentConverters.js';
import type {
  ReadonlySettingsSnapshot,
  ToolRegistryView,
} from '../runtime/AgentRuntimeContext.js';
import type { ToolRegistry } from '../tools/tool-registry.js';
import { createProviderRuntimeContext } from '../runtime/providerRuntimeContext.js';
import { loadAgentRuntime } from '../runtime/AgentRuntimeLoader.js';
import { retryWithBackoff } from '../utils/retry.js';
import { getErrorMessage } from '../utils/errors.js';
import {
  AuthType,
  ContentGenerator,
  ContentGeneratorConfig,
  createContentGenerator,
} from './contentGenerator.js';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { tokenLimit } from './tokenLimits.js';
import {
  COMPRESSION_TOKEN_THRESHOLD,
  COMPRESSION_PRESERVE_THRESHOLD,
} from './compression-config.js';
import { LoopDetectionService } from '../services/loopDetectionService.js';
import { ideContext, IdeContext, File } from '../ide/ideContext.js';
import {
  ComplexityAnalyzer,
  type ComplexityAnalysisResult,
} from '../services/complexity-analyzer.js';
import { TodoReminderService } from '../services/todo-reminder-service.js';
import { TodoStore } from '../tools/todo-store.js';
import type { Todo } from '../tools/todo-schemas.js';
import { isFunctionResponse } from '../utils/messageInspectors.js';
import { estimateTokens as estimateTextTokens } from '../utils/toolOutputLimiter.js';
import type { AgentRuntimeState } from '../runtime/AgentRuntimeState.js';
import { subscribeToAgentRuntimeState } from '../runtime/AgentRuntimeState.js';

const COMPLEXITY_ESCALATION_TURN_THRESHOLD = 3;
const TODO_PROMPT_SUFFIX = 'Use TODO List to organize this effort.';
function isThinkingSupported(model: string) {
  if (model.startsWith('gemini-2.5')) return true;
  return false;
}

/**
 * Extracts JSON from a string that might be wrapped in markdown code blocks
 * @param text - The raw text that might contain markdown-wrapped JSON
 * @returns The extracted JSON string or the original text if no markdown found
 */
function extractJsonFromMarkdown(text: string): string {
  // Try to match ```json ... ``` or ``` ... ```
  const markdownMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (markdownMatch && markdownMatch[1]) {
    return markdownMatch[1].trim();
  }

  // If no markdown found, return trimmed original text
  return text.trim();
}

/**
 * Returns the index of the content after the fraction of the total characters in the history.
 *
 * Exported for testing purposes.
 */
export function findIndexAfterFraction(
  history: Content[],
  fraction: number,
): number {
  if (fraction <= 0 || fraction >= 1) {
    throw new Error('Fraction must be between 0 and 1');
  }

  const contentLengths = history.map(
    (content) => JSON.stringify(content).length,
  );

  const totalCharacters = contentLengths.reduce(
    (sum, length) => sum + length,
    0,
  );
  const targetCharacters = totalCharacters * fraction;

  let charactersSoFar = 0;
  for (let i = 0; i < contentLengths.length; i++) {
    charactersSoFar += contentLengths[i];
    if (charactersSoFar >= targetCharacters) {
      return i;
    }
  }
  return contentLengths.length;
}

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

  private readonly loopDetector: LoopDetectionService;
  private lastPromptId?: string;
  private readonly complexityAnalyzer: ComplexityAnalyzer;
  private readonly todoReminderService: TodoReminderService;
  private todoToolsAvailable = false;
  private lastComplexitySuggestionTime: number = 0;
  private readonly complexitySuggestionCooldown: number;
  private lastSentIdeContext: IdeContext | undefined;
  private forceFullIdeContext = true;
  private lastTodoToolTurn?: number;
  private consecutiveComplexTurns = 0;
  private lastComplexitySuggestionTurn?: number;
  private toolActivityCount = 0;
  private toolCallReminderLevel: 'none' | 'base' | 'escalated' = 'none';
  private lastTodoSnapshot?: Todo[];

  /**
   * At any point in this conversation, was compression triggered without
   * being forced and did it fail?
   */
  private hasFailedCompressionAttempt = false;

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
    if (
      runtimeState.authType === AuthType.API_KEY &&
      !runtimeState.authPayload?.apiKey
    ) {
      throw new Error(
        'AgentRuntimeState must include apiKey when authType is API_KEY',
      );
    }
    if (
      runtimeState.authType === AuthType.OAUTH &&
      !runtimeState.authPayload?.token
    ) {
      throw new Error(
        'AgentRuntimeState must include token when authType is OAUTH',
      );
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
      setGlobalDispatcher(new ProxyAgent(proxyUrl as string));
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
    this.complexitySuggestionCooldown =
      complexitySettings.suggestionCooldownMs ?? 300000;

    this.todoReminderService = new TodoReminderService();
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

  getUserTier(): UserTierId | undefined {
    return this.contentGenerator?.userTier;
  }

  private processComplexityAnalysis(
    analysis: ComplexityAnalysisResult,
  ): string | undefined {
    if (!this.todoToolsAvailable) {
      this.consecutiveComplexTurns = 0;
      return undefined;
    }

    if (!analysis.isComplex || !analysis.shouldSuggestTodos) {
      this.consecutiveComplexTurns = 0;
      return undefined;
    }

    this.consecutiveComplexTurns += 1;

    const alreadySuggestedThisTurn =
      this.lastComplexitySuggestionTurn === this.sessionTurnCount;
    const currentTime = Date.now();
    const withinCooldown =
      currentTime - this.lastComplexitySuggestionTime <
      this.complexitySuggestionCooldown;

    if (alreadySuggestedThisTurn || withinCooldown) {
      return undefined;
    }

    const reminder = this.shouldEscalateReminder()
      ? this.todoReminderService.getEscalatedComplexTaskSuggestion(
          analysis.detectedTasks,
        )
      : this.todoReminderService.getComplexTaskSuggestion(
          analysis.detectedTasks,
        );

    this.lastComplexitySuggestionTime = currentTime;
    this.lastComplexitySuggestionTurn = this.sessionTurnCount;

    return reminder;
  }

  private shouldEscalateReminder(): boolean {
    if (this.consecutiveComplexTurns < COMPLEXITY_ESCALATION_TURN_THRESHOLD) {
      return false;
    }

    const turnsSinceTodo =
      this.lastTodoToolTurn === undefined
        ? Number.POSITIVE_INFINITY
        : this.sessionTurnCount - this.lastTodoToolTurn;

    return turnsSinceTodo >= COMPLEXITY_ESCALATION_TURN_THRESHOLD;
  }

  private isTodoToolCall(name: unknown): boolean {
    if (typeof name !== 'string') {
      return false;
    }
    const normalized = name.toLowerCase();
    return normalized === 'todo_write' || normalized === 'todo_read';
  }

  private appendTodoSuffixToRequest(request: PartListUnion): PartListUnion {
    if (!Array.isArray(request)) {
      return request;
    }

    const suffixAlreadyPresent = request.some(
      (part) =>
        typeof part === 'object' &&
        part !== null &&
        'text' in part &&
        typeof part.text === 'string' &&
        part.text.includes(TODO_PROMPT_SUFFIX),
    );

    if (suffixAlreadyPresent) {
      return request;
    }

    (request as Part[]).push({ text: TODO_PROMPT_SUFFIX } as Part);
    return request;
  }

  private recordModelActivity(event: ServerGeminiStreamEvent): void {
    if (!this.todoToolsAvailable) {
      return;
    }
    if (event.type !== GeminiEventType.ToolCallResponse) {
      return;
    }

    this.toolActivityCount += 1;

    if (this.toolActivityCount > 4) {
      this.toolCallReminderLevel = 'escalated';
    } else if (
      this.toolActivityCount === 4 &&
      this.toolCallReminderLevel === 'none'
    ) {
      this.toolCallReminderLevel = 'base';
    }
  }

  private async readTodoSnapshot(): Promise<Todo[]> {
    try {
      const sessionId = this.config.getSessionId();
      const store = new TodoStore(sessionId, DEFAULT_AGENT_ID);
      return await store.readTodos();
    } catch (_error) {
      return [];
    }
  }

  private getActiveTodos(todos: Todo[]): Todo[] {
    const inProgress = todos.filter((todo) => todo.status === 'in_progress');
    const pending = todos.filter((todo) => todo.status === 'pending');
    return [...inProgress, ...pending];
  }

  private areTodoSnapshotsEqual(
    a: readonly Todo[],
    b: readonly Todo[],
  ): boolean {
    if (a.length !== b.length) {
      return false;
    }
    const normalize = (todos: readonly Todo[]) =>
      todos
        .map((todo) => ({
          id: `${todo.id ?? ''}`,
          status: (todo.status ?? 'pending').toLowerCase(),
          content: todo.content ?? '',
          priority: todo.priority ?? 'medium',
        }))
        .sort((left, right) => left.id.localeCompare(right.id));
    const normalizedA = normalize(a);
    const normalizedB = normalize(b);
    return normalizedA.every(
      (todo, index) =>
        JSON.stringify(todo) === JSON.stringify(normalizedB[index]),
    );
  }

  private async getTodoReminderForCurrentState(options?: {
    todoSnapshot?: Todo[];
    activeTodos?: Todo[];
    escalate?: boolean;
  }): Promise<{
    reminder: string | null;
    todos: Todo[];
    activeTodos: Todo[];
  }> {
    const todos = options?.todoSnapshot ?? (await this.readTodoSnapshot());
    const activeTodos = options?.activeTodos ?? this.getActiveTodos(todos);

    let reminder: string | null = null;
    if (todos.length === 0) {
      reminder = this.todoReminderService.getCreateListReminder([]);
    } else if (activeTodos.length > 0) {
      reminder = options?.escalate
        ? this.todoReminderService.getEscalatedActiveTodoReminder(
            activeTodos[0],
          )
        : this.todoReminderService.getUpdateActiveTodoReminder(activeTodos[0]);
    }

    return { reminder, todos, activeTodos };
  }

  private appendSystemReminderToRequest(
    request: PartListUnion,
    reminderText: string,
  ): PartListUnion {
    if (Array.isArray(request)) {
      const cloned = [...request];
      const alreadyPresent = cloned.some(
        (part) =>
          typeof part === 'object' &&
          part !== null &&
          'text' in part &&
          typeof part.text === 'string' &&
          part.text === reminderText,
      );
      if (!alreadyPresent) {
        cloned.push({ text: reminderText } as Part);
      }
      return cloned;
    }

    return [{ text: reminderText } as Part];
  }

  private shouldDeferStreamEvent(event: ServerGeminiStreamEvent): boolean {
    return (
      event.type === GeminiEventType.Content ||
      event.type === GeminiEventType.Finished ||
      event.type === GeminiEventType.Citation
    );
  }

  private isTodoPauseResponse(
    response: ToolCallResponseInfo | undefined,
  ): boolean {
    if (!response?.responseParts) {
      return false;
    }
    return response.responseParts.some((part) => {
      if (
        part &&
        typeof part === 'object' &&
        'functionResponse' in part &&
        part.functionResponse &&
        typeof part.functionResponse === 'object'
      ) {
        const name = (part.functionResponse as { name?: unknown }).name;
        return typeof name === 'string' && name.toLowerCase() === 'todo_pause';
      }
      return false;
    });
  }

  async addHistory(content: Content) {
    // Ensure chat is initialized before adding history
    if (!this.hasChatInitialized()) {
      await this.resetChat();
    }
    this.getChat().addHistory(content);
  }

  getChat(): GeminiChat {
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
    if (!this.hasChatInitialized()) {
      return null;
    }
    const historyService = this.getChat().getHistoryService();
    // Removed verbose debug logging
    return historyService;
  }

  hasChatInitialized(): boolean {
    const result = this.chat !== undefined;
    // Removed verbose debug logging
    return result;
  }

  isInitialized(): boolean {
    return this.chat !== undefined && this.contentGenerator !== undefined;
  }

  async getHistory(): Promise<Content[]> {
    // If we have stored history but no chat, return the stored history
    if (!this.hasChatInitialized() && this._previousHistory) {
      return this._previousHistory;
    }

    // If chat is initialized, get its current history
    if (this.hasChatInitialized()) {
      return this.getChat().getHistory();
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
          if (newContent.parts) {
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
    this.forceFullIdeContext = true;
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
    const toolDeclarations = toolsView
      ? this.buildToolDeclarationsFromView(toolRegistry, toolsView)
      : toolRegistry.getFunctionDeclarations();
    this.updateTodoToolAvailabilityFromDeclarations(toolDeclarations);

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

  async resetChat(): Promise<void> {
    // If chat exists, clear its history service
    if (this.chat) {
      const historyService = this.chat.getHistoryService();
      if (historyService) {
        // Clear the history service directly
        historyService.clear();
      } else {
        // Fallback to chat's clearHistory if no history service
        this.chat.clearHistory();
      }
      // Reset the chat's internal state
      this.forceFullIdeContext = true;
    } else {
      // No chat exists yet, create one with empty history
      this.chat = await this.startChat([]);
    }
    // Clear the stored history as well
    this._previousHistory = [];
  }

  async addDirectoryContext(): Promise<void> {
    if (!this.chat) {
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
    if (!this.chat) {
      this.chat = await this.startChat([]);
    }
    return this.getChat().generateDirectMessage(params, promptId);
  }

  async startChat(extraHistory?: Content[]): Promise<GeminiChat> {
    this.forceFullIdeContext = true;
    this.hasFailedCompressionAttempt = false;

    // Ensure content generator is initialized before creating chat
    await this.lazyInitialize();
    const envParts = await getEnvironmentContext(this.config);
    const toolRegistry = this.config.getToolRegistry();
    const enabledToolNames = this.getEnabledToolNamesForPrompt();

    // CRITICAL: Reuse stored HistoryService if available to preserve UI conversation display
    // This is essential for maintaining conversation history across provider switches
    let historyService: HistoryService;
    if (this._storedHistoryService) {
      this.logger.debug(
        'Reusing stored HistoryService to preserve UI conversation',
      );
      historyService = this._storedHistoryService;
      // Clear the stored reference after using it
      this._storedHistoryService = undefined;
    } else {
      // Create new HistoryService only if we don't have a stored one
      historyService = new HistoryService();
    }

    // Add extraHistory if provided
    if (extraHistory && extraHistory.length > 0) {
      // @plan PLAN-20251027-STATELESS5.P10
      // @requirement REQ-STAT5-003.1
      const currentModel = this.runtimeState.model;
      for (const content of extraHistory) {
        historyService.add(ContentConverters.toIContent(content), currentModel);
      }
    }

    try {
      const userMemory = this.config.getUserMemory();
      // @plan PLAN-20251027-STATELESS5.P10
      // @requirement REQ-STAT5-003.1
      const model = this.runtimeState.model;
      // Provider name removed from prompt call signature
      const logger = new DebugLogger('llxprt:client:start');
      logger.debug(
        () => `DEBUG [client.startChat]: Model from config: ${model}`,
      );
      let systemInstruction = await getCoreSystemPromptAsync(
        userMemory,
        model,
        enabledToolNames,
      );

      // Add environment context to system instruction
      const envContextText = envParts
        .map((part) => ('text' in part ? part.text : ''))
        .join('\n');
      if (envContextText) {
        systemInstruction = `${envContextText}\n\n${systemInstruction}`;
      }

      let systemPromptTokens = 0;
      try {
        systemPromptTokens = await historyService.estimateTokensForText(
          systemInstruction,
          model,
        );
      } catch (error) {
        this.logger.debug(
          () =>
            `Failed to count system instruction tokens for model ${model}, using fallback`,
          { error },
        );
        systemPromptTokens = estimateTextTokens(systemInstruction);
      }
      historyService.setBaseTokenOffset(systemPromptTokens);

      logger.debug(
        () =>
          `DEBUG [client.startChat]: System instruction includes Flash instructions: ${systemInstruction.includes(
            'IMPORTANT: You MUST use the provided tools',
          )}`,
      );

      // @plan PLAN-20251027-STATELESS5.P10
      // @requirement REQ-STAT5-003.1
      const generateContentConfigWithThinking = isThinkingSupported(
        this.runtimeState.model,
      )
        ? {
            ...this.generateContentConfig,
            thinkingConfig: {
              thinkingBudget: -1,
              includeThoughts: true,
            },
          }
        : this.generateContentConfig;
      // @plan PLAN-20251028-STATELESS6.P10
      // @requirement REQ-STAT6-001.2
      // Create runtime context from config (foreground agent)
      const rawCompressionThreshold = this.config.getEphemeralSetting(
        'compression-threshold',
      );
      const compressionThreshold =
        typeof rawCompressionThreshold === 'number'
          ? rawCompressionThreshold
          : undefined;

      const rawContextLimit = this.config.getEphemeralSetting('context-limit');
      const contextLimit =
        typeof rawContextLimit === 'number' &&
        Number.isFinite(rawContextLimit) &&
        rawContextLimit > 0
          ? rawContextLimit
          : undefined;

      const rawPreserveThreshold = this.config.getEphemeralSetting(
        'compression-preserve-threshold',
      );
      const preserveThreshold =
        typeof rawPreserveThreshold === 'number'
          ? rawPreserveThreshold
          : undefined;

      const settings: ReadonlySettingsSnapshot = {
        compressionThreshold: compressionThreshold ?? 0.8,
        contextLimit,
        preserveThreshold: preserveThreshold ?? 0.2,
        telemetry: {
          enabled: true,
          target: null,
        },
        tools: this.getToolGovernanceEphemerals(),
      };

      const providerRuntime = createProviderRuntimeContext({
        settingsService: this.config.getSettingsService(),
        config: this.config,
        runtimeId: this.runtimeState.runtimeId,
        metadata: { source: 'GeminiClient.startChat' },
      });

      const runtimeBundle = await loadAgentRuntime({
        profile: {
          config: this.config,
          state: this.runtimeState,
          settings,
          providerRuntime,
          contentGeneratorConfig: this.config.getContentGeneratorConfig(),
          toolRegistry,
          providerManager: this.config.getProviderManager?.(),
        },
        overrides: {
          historyService,
          contentGenerator: this.getContentGenerator(),
        },
      });

      const filteredDeclarations = this.buildToolDeclarationsFromView(
        toolRegistry,
        runtimeBundle.toolsView,
      );
      this.updateTodoToolAvailabilityFromDeclarations(filteredDeclarations);
      const tools: Tool[] = [{ functionDeclarations: filteredDeclarations }];

      return new GeminiChat(
        runtimeBundle.runtimeContext,
        runtimeBundle.contentGenerator,
        {
          systemInstruction,
          ...generateContentConfigWithThinking,
          tools,
        },
        [], // Empty initial history since we're using HistoryService
      );
    } catch (error) {
      await reportError(
        error,
        'Error initializing chat session.',
        extraHistory ?? [],
        'startChat',
      );
      throw new Error(`Failed to initialize chat: ${getErrorMessage(error)}`);
    }
  }

  private getIdeContextParts(forceFullContext: boolean): {
    contextParts: string[];
    newIdeContext: IdeContext | undefined;
  } {
    const currentIdeContext = ideContext.getIdeContext();
    if (!currentIdeContext) {
      return { contextParts: [], newIdeContext: undefined };
    }

    if (forceFullContext || !this.lastSentIdeContext) {
      // Send full context as JSON
      const openFiles = currentIdeContext.workspaceState?.openFiles || [];
      const activeFile = openFiles.find((f) => f.isActive);
      const otherOpenFiles = openFiles
        .filter((f) => !f.isActive)
        .map((f) => f.path);

      const contextData: Record<string, unknown> = {};

      if (activeFile) {
        contextData.activeFile = {
          path: activeFile.path,
          cursor: activeFile.cursor
            ? {
                line: activeFile.cursor.line,
                character: activeFile.cursor.character,
              }
            : undefined,
          selectedText: activeFile.selectedText || undefined,
        };
      }

      if (otherOpenFiles.length > 0) {
        contextData.otherOpenFiles = otherOpenFiles;
      }

      if (Object.keys(contextData).length === 0) {
        return { contextParts: [], newIdeContext: currentIdeContext };
      }

      const jsonString = JSON.stringify(contextData, null, 2);
      const contextParts = [
        "Here is the user's editor context as a JSON object. This is for your information only.",
        '```json',
        jsonString,
        '```',
      ];

      if (this.config.getDebugMode()) {
        this.logger.debug(() => 'IDE Context:', {
          context: contextParts.join('\n'),
        });
      }
      return {
        contextParts,
        newIdeContext: currentIdeContext,
      };
    } else {
      // Calculate and send delta as JSON
      const delta: Record<string, unknown> = {};
      const changes: Record<string, unknown> = {};

      const lastFiles = new Map(
        (this.lastSentIdeContext.workspaceState?.openFiles || []).map(
          (f: File) => [f.path, f],
        ),
      );
      const currentFiles = new Map(
        (currentIdeContext.workspaceState?.openFiles || []).map((f: File) => [
          f.path,
          f,
        ]),
      );

      const openedFiles: string[] = [];
      for (const [path] of currentFiles.entries()) {
        if (!lastFiles.has(path)) {
          openedFiles.push(path);
        }
      }
      if (openedFiles.length > 0) {
        changes.filesOpened = openedFiles;
      }

      const closedFiles: string[] = [];
      for (const [path] of lastFiles.entries()) {
        if (!currentFiles.has(path)) {
          closedFiles.push(path);
        }
      }
      if (closedFiles.length > 0) {
        changes.filesClosed = closedFiles;
      }

      const lastActiveFile = (
        this.lastSentIdeContext.workspaceState?.openFiles || []
      ).find((f: File) => f.isActive);
      const currentActiveFile = (
        currentIdeContext.workspaceState?.openFiles || []
      ).find((f: File) => f.isActive);

      if (currentActiveFile) {
        if (!lastActiveFile || lastActiveFile.path !== currentActiveFile.path) {
          changes.activeFileChanged = {
            path: currentActiveFile.path,
            cursor: currentActiveFile.cursor
              ? {
                  line: currentActiveFile.cursor.line,
                  character: currentActiveFile.cursor.character,
                }
              : undefined,
            selectedText: currentActiveFile.selectedText || undefined,
          };
        } else {
          const lastCursor = lastActiveFile.cursor;
          const currentCursor = currentActiveFile.cursor;
          if (
            currentCursor &&
            (!lastCursor ||
              lastCursor.line !== currentCursor.line ||
              lastCursor.character !== currentCursor.character)
          ) {
            changes.cursorMoved = {
              path: currentActiveFile.path,
              cursor: {
                line: currentCursor.line,
                character: currentCursor.character,
              },
            };
          }

          const lastSelectedText = lastActiveFile.selectedText || '';
          const currentSelectedText = currentActiveFile.selectedText || '';
          if (lastSelectedText !== currentSelectedText) {
            changes.selectionChanged = {
              path: currentActiveFile.path,
              selectedText: currentSelectedText,
            };
          }
        }
      } else if (lastActiveFile) {
        changes.activeFileChanged = {
          path: null,
          previousPath: lastActiveFile.path,
        };
      }

      if (Object.keys(changes).length === 0) {
        return { contextParts: [], newIdeContext: currentIdeContext };
      }

      delta.changes = changes;
      const jsonString = JSON.stringify(delta, null, 2);
      const contextParts = [
        "Here is a summary of changes in the user's editor context, in JSON format. This is for your information only.",
        '```json',
        jsonString,
        '```',
      ];

      if (this.config.getDebugMode()) {
        this.logger.debug(() => 'IDE Context:', {
          context: contextParts.join('\n'),
        });
      }
      return {
        contextParts,
        newIdeContext: currentIdeContext,
      };
    }
  }

  async *sendMessageStream(
    initialRequest: PartListUnion,
    signal: AbortSignal,
    prompt_id: string,
    turns: number = this.MAX_TURNS,
  ): AsyncGenerator<ServerGeminiStreamEvent, Turn> {
    const logger = new DebugLogger('llxprt:client:stream');
    logger.debug(() => 'DEBUG: GeminiClient.sendMessageStream called');
    logger.debug(
      () =>
        `DEBUG: GeminiClient.sendMessageStream request: ${JSON.stringify(initialRequest, null, 2)}`,
    );
    logger.debug(
      () =>
        `DEBUG: GeminiClient.sendMessageStream typeof request: ${typeof initialRequest}`,
    );
    logger.debug(
      () =>
        `DEBUG: GeminiClient.sendMessageStream Array.isArray(request): ${Array.isArray(initialRequest)}`,
    );
    await this.lazyInitialize();

    if (!this.chat) {
      if (this._previousHistory && this._previousHistory.length > 0) {
        this.logger.debug(
          'Restoring previous history during prompt generation',
          {
            historyLength: this._previousHistory.length,
          },
        );
        const conversationHistory = this._previousHistory.slice(2);
        this.chat = await this.startChat(conversationHistory);
        this.logger.debug('Chat started with restored history', {
          conversationHistoryLength: conversationHistory.length,
        });
      } else {
        this.chat = await this.startChat();
      }
    }

    if (this.lastPromptId !== prompt_id) {
      this.loopDetector.reset(prompt_id);
      this.lastPromptId = prompt_id;
    }

    this.sessionTurnCount++;
    this.toolActivityCount = 0;
    this.toolCallReminderLevel = 'none';

    if (
      this.config.getMaxSessionTurns() > 0 &&
      this.sessionTurnCount > this.config.getMaxSessionTurns()
    ) {
      yield { type: GeminiEventType.MaxSessionTurns };
      const contentGenConfig = this.config.getContentGeneratorConfig();
      const providerManager = contentGenConfig?.providerManager;
      const providerName =
        providerManager?.getActiveProviderName() || 'backend';
      return new Turn(
        this.getChat(),
        prompt_id,
        DEFAULT_AGENT_ID,
        providerName,
      );
    }

    const boundedTurns = Math.min(turns, this.MAX_TURNS);
    if (!boundedTurns) {
      const contentGenConfig = this.config.getContentGeneratorConfig();
      const providerManager = contentGenConfig?.providerManager;
      const providerName =
        providerManager?.getActiveProviderName() || 'backend';
      return new Turn(
        this.getChat(),
        prompt_id,
        DEFAULT_AGENT_ID,
        providerName,
      );
    }

    const compressed = await this.tryCompressChat(prompt_id);
    if (compressed.compressionStatus === CompressionStatus.COMPRESSED) {
      yield { type: GeminiEventType.ChatCompressed, value: compressed };
    }

    const history = await this.getHistory();
    const lastMessage =
      history.length > 0 ? history[history.length - 1] : undefined;
    const hasPendingToolCall =
      !!lastMessage &&
      lastMessage.role === 'model' &&
      (lastMessage.parts?.some((p) => 'functionCall' in p) || false);

    if (this.config.getIdeMode() && !hasPendingToolCall) {
      const { contextParts, newIdeContext } = this.getIdeContextParts(
        this.forceFullIdeContext || history.length === 0,
      );
      if (contextParts.length > 0) {
        this.getChat().addHistory({
          role: 'user',
          parts: [{ text: contextParts.join('\n') }],
        });
      }
      this.lastSentIdeContext = newIdeContext;
      this.forceFullIdeContext = false;
    }

    let baseRequest: PartListUnion = Array.isArray(initialRequest)
      ? [...(initialRequest as Part[])]
      : initialRequest;
    let retryCount = 0;
    const MAX_RETRIES = 2;
    let lastTurn: Turn | undefined;
    let hadToolCallsThisTurn = false; // Track if model executed tools - preserve across retries

    while (retryCount < MAX_RETRIES) {
      let request: PartListUnion = Array.isArray(baseRequest)
        ? [...(baseRequest as Part[])]
        : baseRequest;

      // Complexity analysis only on first iteration
      if (retryCount === 0) {
        let shouldAppendTodoSuffix = false;

        if (Array.isArray(request) && request.length > 0) {
          const userMessage = request
            .filter((part) => typeof part === 'object' && 'text' in part)
            .map((part) => (part as { text: string }).text)
            .join(' ')
            .trim();

          if (userMessage.length > 0) {
            const analysis =
              this.complexityAnalyzer.analyzeComplexity(userMessage);
            const complexityReminder = this.processComplexityAnalysis(analysis);
            if (complexityReminder) {
              shouldAppendTodoSuffix = true;
            }
          } else {
            this.consecutiveComplexTurns = 0;
          }
        } else {
          this.consecutiveComplexTurns = 0;
        }

        if (shouldAppendTodoSuffix) {
          request = this.appendTodoSuffixToRequest(request);
        }
        baseRequest = Array.isArray(request)
          ? [...(request as Part[])]
          : request;
      } else {
        this.consecutiveComplexTurns = 0;
      }

      // Apply todo reminder if one is pending from previous iteration
      if (this.todoToolsAvailable && this.toolCallReminderLevel !== 'none') {
        const reminderResult = await this.getTodoReminderForCurrentState({
          todoSnapshot: this.lastTodoSnapshot,
          escalate: this.toolCallReminderLevel === 'escalated',
        });
        if (reminderResult.reminder) {
          request = this.appendSystemReminderToRequest(
            request,
            reminderResult.reminder,
          );
          this.lastTodoSnapshot = reminderResult.todos;
        }
        this.toolCallReminderLevel = 'none';
        this.toolActivityCount = 0;
      }

      const contentGenConfig = this.config.getContentGeneratorConfig();
      const providerManager = contentGenConfig?.providerManager;
      const providerName =
        providerManager?.getActiveProviderName() || 'backend';

      const turn = new Turn(
        this.getChat(),
        prompt_id,
        DEFAULT_AGENT_ID,
        providerName,
      );
      lastTurn = turn;

      const loopDetected = await this.loopDetector.turnStarted(signal);
      if (loopDetected) {
        yield { type: GeminiEventType.LoopDetected };
        return turn;
      }

      // Reset flags for this iteration (hadToolCallsThisTurn persists across duplicate todo retries)
      let todoPauseSeen = false;
      const deferredEvents: ServerGeminiStreamEvent[] = [];
      const resultStream = turn.run(request, signal);

      // Stream events, deferring Content/Finished/Citation until we decide on a retry
      for await (const event of resultStream) {
        if (this.loopDetector.addAndCheck(event)) {
          yield { type: GeminiEventType.LoopDetected };
          return turn;
        }

        this.recordModelActivity(event);

        // Track tool execution during this turn
        if (event.type === GeminiEventType.ToolCallRequest) {
          hadToolCallsThisTurn = true;
        }

        if (event.type === GeminiEventType.ToolCallResponse) {
          if (this.isTodoPauseResponse(event.value)) {
            todoPauseSeen = true;
          }
        }

        // Handle duplicate todo writes
        if (
          event.type === GeminiEventType.ToolCallRequest &&
          this.isTodoToolCall(event.value?.name)
        ) {
          this.lastTodoToolTurn = this.sessionTurnCount;
          this.consecutiveComplexTurns = 0;

          const requestedTodos = Array.isArray(event.value?.args?.todos)
            ? (event.value.args.todos as Todo[])
            : [];
          if (requestedTodos.length > 0) {
            this.lastTodoSnapshot = requestedTodos.map((todo) => ({
              id: `${(todo as Todo).id ?? ''}`,
              content: (todo as Todo).content ?? '',
              status: (todo as Todo).status ?? 'pending',
              priority: (todo as Todo).priority ?? 'medium',
            }));
          }
        }

        if (this.shouldDeferStreamEvent(event)) {
          deferredEvents.push(event);
        } else {
          yield event;
        }

        if (event.type === GeminiEventType.Error) {
          for (const deferred of deferredEvents) {
            yield deferred;
          }
          return turn;
        }
      }

      // Turn stream is now complete. Decide if we should retry.

      // Check if model made progress by executing tools FIRST
      if (hadToolCallsThisTurn) {
        // Model executed tools - that's progress, flush deferred events and exit
        const reminderState = await this.getTodoReminderForCurrentState();
        for (const deferred of deferredEvents) {
          yield deferred;
        }
        this.lastTodoSnapshot = reminderState.todos;
        this.toolCallReminderLevel = 'none';
        this.toolActivityCount = 0;
        return turn;
      }

      // No tool work detected - check todo/pause state
      const reminderState = await this.getTodoReminderForCurrentState();
      const latestSnapshot = reminderState.todos;
      const activeTodos = reminderState.activeTodos;

      if (todoPauseSeen) {
        // Model explicitly paused - respect that
        for (const deferred of deferredEvents) {
          yield deferred;
        }
        this.lastTodoSnapshot = latestSnapshot;
        this.toolCallReminderLevel = 'none';
        this.toolActivityCount = 0;
        return turn;
      }

      // Check if todos are still pending
      const todosStillPending = activeTodos.length > 0;
      const hasPendingReminder =
        this.todoToolsAvailable && this.toolCallReminderLevel !== 'none';

      if (!todosStillPending && !hasPendingReminder) {
        // All todos complete or list is empty, and no reminder pending - return normally
        for (const deferred of deferredEvents) {
          yield deferred;
        }
        this.lastTodoSnapshot = latestSnapshot;
        this.toolCallReminderLevel = 'none';
        this.toolActivityCount = 0;
        return turn;
      }

      // Model tried to return with incomplete todos or has pending reminder - check if we should retry
      retryCount++;

      if (retryCount >= MAX_RETRIES) {
        // Hit retry limit - return anyway, let continuation service handle it
        for (const deferred of deferredEvents) {
          yield deferred;
        }
        this.lastTodoSnapshot = latestSnapshot;
        this.toolCallReminderLevel = 'none';
        this.toolActivityCount = 0;
        return turn;
      }

      // If we have a pending reminder (from toolActivityCount), it will be injected
      // at the start of the next iteration. Otherwise, prepare a followUp reminder.
      if (!hasPendingReminder) {
        // Prepare retry with escalated reminder
        const previousSnapshot = this.lastTodoSnapshot ?? [];
        const snapshotUnchanged = this.areTodoSnapshotsEqual(
          previousSnapshot,
          latestSnapshot,
        );

        const followUpReminder = (
          await this.getTodoReminderForCurrentState({
            todoSnapshot: latestSnapshot,
            activeTodos,
            escalate: snapshotUnchanged,
          })
        ).reminder;

        this.lastTodoSnapshot = latestSnapshot;

        if (!followUpReminder) {
          // No reminder to add - flush and return
          for (const deferred of deferredEvents) {
            yield deferred;
          }
          this.toolCallReminderLevel = 'none';
          this.toolActivityCount = 0;
          return turn;
        }

        // Set up retry request with reminder
        baseRequest = this.appendSystemReminderToRequest(
          baseRequest,
          followUpReminder,
        );
      } else {
        // hasPendingReminder is true - reminder will be injected at loop start
        this.lastTodoSnapshot = latestSnapshot;
      }

      // Loop back for one more try
    }

    // Shouldn't reach here, but return last turn if we do
    return lastTurn!;
  }

  async generateJson(
    contents: Content[],
    schema: Record<string, unknown>,
    abortSignal: AbortSignal,
    model: string,
    config: GenerateContentConfig = {},
  ): Promise<Record<string, unknown>> {
    await this.lazyInitialize();
    // Use the provided model parameter directly
    const modelToUse = model;
    try {
      const userMemory = this.config.getUserMemory();
      // Provider name removed from prompt call signature
      const systemInstruction = await getCoreSystemPromptAsync(
        userMemory,
        modelToUse,
        this.getEnabledToolNamesForPrompt(),
      );
      const requestConfig = {
        abortSignal,
        ...this.generateContentConfig,
        ...config,
      };

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
          this.lastPromptId || this.config.getSessionId(),
        );

      const result = await retryWithBackoff(apiCall);

      let text = getResponseText(result);
      if (!text) {
        const error = new Error(
          'API returned an empty response for generateJson.',
        );
        await reportError(
          error,
          'Error in generateJson: API returned an empty response.',
          contents,
          'generateJson-empty-response',
        );
        throw error;
      }

      const prefix = '```json';
      const suffix = '```';
      if (text.startsWith(prefix) && text.endsWith(suffix)) {
        // Note: upstream added logMalformedJsonResponse here but our telemetry doesn't have it
        text = text
          .substring(prefix.length, text.length - suffix.length)
          .trim();
      }

      try {
        // Extract JSON from potential markdown wrapper
        const cleanedText = extractJsonFromMarkdown(text);

        // Special case: Gemini sometimes returns just "user" or "model" for next speaker checks
        // This happens particularly with non-ASCII content in the conversation
        if (
          (cleanedText === 'user' || cleanedText === 'model') &&
          contents.some((c) =>
            c.parts?.some(
              (p) => 'text' in p && p.text?.includes('next_speaker'),
            ),
          )
        ) {
          this.logger.warn(
            () =>
              `[generateJson] Gemini returned plain text "${cleanedText}" instead of JSON for next speaker check. Converting to valid response.`,
          );
          return {
            reasoning: 'Gemini returned plain text response',
            next_speaker: cleanedText,
          };
        }

        return JSON.parse(cleanedText);
      } catch (parseError) {
        // Log both the original and cleaned text for debugging
        await reportError(
          parseError,
          'Failed to parse JSON response from generateJson.',
          {
            responseTextFailedToParse: text,
            cleanedTextFailedToParse: extractJsonFromMarkdown(text),
            originalRequestContents: contents,
          },
          'generateJson-parse',
        );
        throw new Error(
          `Failed to parse API response as JSON: ${getErrorMessage(
            parseError,
          )}`,
        );
      }
    } catch (error) {
      if (abortSignal.aborted) {
        throw error;
      }

      // Avoid double reporting for the empty response case handled above
      if (
        error instanceof Error &&
        error.message === 'API returned an empty response for generateJson.'
      ) {
        throw error;
      }

      await reportError(
        error,
        'Error generating JSON content via API.',
        contents,
        'generateJson-api',
      );
      throw new Error(
        `Failed to generate JSON content: ${getErrorMessage(error)}`,
      );
    }
  }

  async generateContent(
    contents: Content[],
    generationConfig: GenerateContentConfig,
    abortSignal: AbortSignal,
    model: string,
  ): Promise<GenerateContentResponse> {
    await this.lazyInitialize();
    const modelToUse = model;
    const configToUse: GenerateContentConfig = {
      ...this.generateContentConfig,
      ...generationConfig,
    };

    try {
      const userMemory = this.config.getUserMemory();
      // Provider name removed from prompt call signature
      const systemInstruction = await getCoreSystemPromptAsync(
        userMemory,
        modelToUse,
        this.getEnabledToolNamesForPrompt(),
      );

      const requestConfig = {
        abortSignal,
        ...configToUse,
        systemInstruction,
      };

      const apiCall = () =>
        this.getContentGenerator().generateContent(
          {
            model,
            config: requestConfig,
            contents,
          },
          this.lastPromptId || this.config.getSessionId(),
        );

      const result = await retryWithBackoff(apiCall);
      return result;
    } catch (error: unknown) {
      if (abortSignal.aborted) {
        throw error;
      }

      await reportError(
        error,
        `Error generating content via API with model ${model}.`,
        {
          requestContents: contents,
          requestConfig: configToUse,
        },
        'generateContent-api',
      );
      throw new Error(
        `Failed to generate content with model ${model}: ${getErrorMessage(error)}`,
      );
    }
  }

  async generateEmbedding(texts: string[]): Promise<number[][]> {
    await this.lazyInitialize();
    if (!texts || texts.length === 0) {
      return [];
    }
    const embedModelParams: EmbedContentParameters = {
      model: this.embeddingModel,
      contents: texts,
    };

    const embedContentResponse =
      await this.getContentGenerator().embedContent(embedModelParams);
    if (
      !embedContentResponse.embeddings ||
      embedContentResponse.embeddings.length === 0
    ) {
      throw new Error('No embeddings found in API response.');
    }

    if (embedContentResponse.embeddings.length !== texts.length) {
      throw new Error(
        `API returned a mismatched number of embeddings. Expected ${texts.length}, got ${embedContentResponse.embeddings.length}.`,
      );
    }

    return embedContentResponse.embeddings.map((embedding, index) => {
      const values = embedding.values;
      if (!values || values.length === 0) {
        throw new Error(
          `API returned an empty embedding for input text at index ${index}: "${texts[index]}"`,
        );
      }
      return values;
    });
  }

  /**
   * Manually trigger chat compression
   * Returns compression info if successful, null if not needed
   */
  async tryCompressChat(
    prompt_id: string,
    force: boolean = false,
  ): Promise<ChatCompressionInfo> {
    await this.lazyInitialize();

    if (!this.hasChatInitialized()) {
      return {
        originalTokenCount: 0,
        newTokenCount: 0,
        compressionStatus: CompressionStatus.NOOP,
      };
    }

    const curatedHistory = this.getChat().getHistory(true);

    // Regardless of `force`, don't do anything if the history is empty.
    if (
      curatedHistory.length === 0 ||
      (this.hasFailedCompressionAttempt && !force)
    ) {
      return {
        originalTokenCount: 0,
        newTokenCount: 0,
        compressionStatus: CompressionStatus.NOOP,
      };
    }

    // Note: chat variable used later in method

    // @plan PLAN-20251027-STATELESS5.P10
    // @requirement REQ-STAT5-003.1
    const model = this.runtimeState.model;
    // Get the ACTUAL token count from the history service, not the curated subset
    const historyService = this.getChat().getHistoryService();
    const originalTokenCount = historyService
      ? historyService.getTotalTokens()
      : 0;
    if (originalTokenCount === undefined) {
      console.warn(`Could not determine token count for model ${model}.`);
      this.hasFailedCompressionAttempt = !force && true;
      return {
        originalTokenCount: 0,
        newTokenCount: 0,
        compressionStatus:
          CompressionStatus.COMPRESSION_FAILED_TOKEN_COUNT_ERROR,
      };
    }

    const contextPercentageThreshold =
      this.config.getChatCompression()?.contextPercentageThreshold;

    // Don't compress if not forced and we are under the limit.
    if (!force) {
      const threshold =
        contextPercentageThreshold ?? COMPRESSION_TOKEN_THRESHOLD;
      const userContextLimit = this.config.getEphemeralSetting(
        'context-limit',
      ) as number | undefined;
      if (
        originalTokenCount <
        threshold * tokenLimit(model, userContextLimit)
      ) {
        return {
          originalTokenCount,
          newTokenCount: originalTokenCount,
          compressionStatus: CompressionStatus.NOOP,
        };
      }
    }

    let compressBeforeIndex = findIndexAfterFraction(
      curatedHistory,
      1 - COMPRESSION_PRESERVE_THRESHOLD,
    );
    // Find the first user message after the index. This is the start of the next turn.
    while (
      compressBeforeIndex < curatedHistory.length &&
      (curatedHistory[compressBeforeIndex]?.role === 'model' ||
        isFunctionResponse(curatedHistory[compressBeforeIndex]))
    ) {
      compressBeforeIndex++;
    }

    const historyToCompress = curatedHistory.slice(0, compressBeforeIndex);
    const historyToKeep = curatedHistory.slice(compressBeforeIndex);

    this.getChat().setHistory(historyToCompress);

    const { text: summary } = await this.getChat().sendMessage(
      {
        message: {
          text: 'First, reason in your scratchpad. Then, generate the <state_snapshot>.',
        },
        config: {
          systemInstruction: { text: getCompressionPrompt() },
          maxOutputTokens: originalTokenCount,
        },
      },
      prompt_id,
    );

    // For compression, we don't want to preserve the HistoryService
    // because we're creating a new compressed conversation state
    // The UI should reflect that compression happened
    const compressedChat = await this.startChat([
      {
        role: 'user',
        parts: [{ text: summary }],
      },
      {
        role: 'model',
        parts: [{ text: 'Got it. Thanks for the additional context!' }],
      },
      ...historyToKeep,
    ]);
    this.forceFullIdeContext = true;

    // Use HistoryService's token count for consistency with the UI display
    const compressedHistoryService = compressedChat.getHistoryService();
    const newTokenCount = compressedHistoryService
      ? compressedHistoryService.getTotalTokens()
      : 0;
    if (newTokenCount === undefined || newTokenCount === 0) {
      console.warn('Could not determine compressed history token count.');
      this.hasFailedCompressionAttempt = !force && true;
      return {
        originalTokenCount,
        newTokenCount: originalTokenCount,
        compressionStatus:
          CompressionStatus.COMPRESSION_FAILED_TOKEN_COUNT_ERROR,
      };
    }

    // TODO: Add proper telemetry logging once available
    console.debug(
      `Chat compression: ${originalTokenCount} -> ${newTokenCount} tokens`,
    );

    if (newTokenCount > originalTokenCount) {
      this.getChat().setHistory(curatedHistory);
      this.hasFailedCompressionAttempt = !force && true;
      return {
        originalTokenCount,
        newTokenCount,
        compressionStatus:
          CompressionStatus.COMPRESSION_FAILED_INFLATED_TOKEN_COUNT,
      };
    } else {
      this.chat = compressedChat; // Chat compression successful, set new state.

      // Emit token update event for the new compressed chat
      // This ensures the UI updates with the new token count
      // Only emit if compression was successful
      if (typeof compressedChat.getHistoryService === 'function') {
        const historyService = compressedChat.getHistoryService();
        if (historyService) {
          const userContextLimit = this.config.getEphemeralSetting(
            'context-limit',
          ) as number | undefined;
          // @plan PLAN-20251027-STATELESS5.P10
          // @requirement REQ-STAT5-003.1
          historyService.emit('tokensUpdated', {
            totalTokens: newTokenCount,
            addedTokens: newTokenCount - originalTokenCount,
            tokenLimit: tokenLimit(this.runtimeState.model, userContextLimit),
          });
        }
      }
    }

    return {
      originalTokenCount,
      newTokenCount,
      compressionStatus: CompressionStatus.COMPRESSED,
    };
  }

  private getToolGovernanceEphemerals():
    | {
        allowed?: string[];
        disabled?: string[];
      }
    | undefined {
    const allowedList = this.readToolList(
      this.config.getEphemeralSetting('tools.allowed'),
    );
    const disabledList = this.readToolList(
      this.config.getEphemeralSetting('tools.disabled') ??
        this.config.getEphemeralSetting('disabled-tools'),
    );

    const hasAllowed = allowedList.length > 0;
    const hasDisabled = disabledList.length > 0;

    if (!hasAllowed && !hasDisabled) {
      return undefined;
    }

    return {
      allowed: hasAllowed ? allowedList : undefined,
      disabled: hasDisabled ? disabledList : undefined,
    };
  }

  private readToolList(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    const filtered = value.filter(
      (entry): entry is string =>
        typeof entry === 'string' && entry.trim().length > 0,
    );
    return filtered.length > 0 ? [...filtered] : [];
  }

  private buildToolDeclarationsFromView(
    toolRegistry: ToolRegistry | undefined,
    view: ToolRegistryView,
  ): FunctionDeclaration[] {
    if (!toolRegistry) {
      return [];
    }

    const allowedNames = view.listToolNames();
    if (allowedNames.length === 0) {
      return [];
    }

    const declarations: FunctionDeclaration[] = [];
    if (typeof toolRegistry.getAllTools === 'function') {
      const toolsByName = new Map(
        toolRegistry.getAllTools().map((tool) => [tool.name, tool]),
      );
      for (const name of allowedNames) {
        const tool = toolsByName.get(name);
        if (!tool) {
          continue;
        }
        const schema = (tool as { schema?: FunctionDeclaration }).schema;
        if (schema) {
          declarations.push(schema);
        }
      }
      return declarations;
    }

    if (typeof toolRegistry.getFunctionDeclarations === 'function') {
      const declarationsByName = new Map(
        toolRegistry
          .getFunctionDeclarations()
          .map((decl) => [decl.name, decl] as const),
      );
      for (const name of allowedNames) {
        const declaration = declarationsByName.get(name);
        if (declaration) {
          declarations.push(declaration);
        }
      }
    }
    return declarations;
  }

  private getEnabledToolNamesForPrompt(): string[] {
    const toolRegistry = this.config.getToolRegistry();
    if (
      !toolRegistry ||
      typeof (toolRegistry as { getEnabledTools?: unknown }).getEnabledTools !==
        'function'
    ) {
      return [];
    }
    return Array.from(
      new Set(
        toolRegistry
          .getEnabledTools()
          .map((tool) => tool.name)
          .filter(Boolean),
      ),
    );
  }

  private updateTodoToolAvailabilityFromDeclarations(
    declarations: Array<{ name?: string }>,
  ): void {
    const normalizedNames = new Set(
      declarations
        .map((decl) => decl?.name)
        .filter((name): name is string => typeof name === 'string')
        .map((name) => name.toLowerCase()),
    );

    this.todoToolsAvailable =
      normalizedNames.has('todo_write') && normalizedNames.has('todo_read');
  }
}
