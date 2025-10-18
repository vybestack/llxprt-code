/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  EmbedContentParameters,
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
import { Turn, ServerGeminiStreamEvent, GeminiEventType } from './turn.js';
import type { ChatCompressionInfo } from './turn.js';
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
import { retryWithBackoff } from '../utils/retry.js';
import { getErrorMessage } from '../utils/errors.js';
import {
  AuthType,
  ContentGenerator,
  ContentGeneratorConfig,
  createContentGenerator,
} from './contentGenerator.js';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { DEFAULT_GEMINI_FLASH_MODEL } from '../config/models.js';
import { tokenLimit } from './tokenLimits.js';
import {
  COMPRESSION_TOKEN_THRESHOLD,
  COMPRESSION_PRESERVE_THRESHOLD,
} from './compression-config.js';
import { LoopDetectionService } from '../services/loopDetectionService.js';
import { ideContext, IdeContext, File } from '../ide/ideContext.js';
import { ComplexityAnalyzer } from '../services/complexity-analyzer.js';
import { TodoReminderService } from '../services/todo-reminder-service.js';
import { isFunctionResponse } from '../utils/messageInspectors.js';

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
  private lastComplexitySuggestionTime: number = 0;
  private readonly complexitySuggestionCooldown: number;
  private lastSentIdeContext: IdeContext | undefined;
  private forceFullIdeContext = true;

  /**
   * At any point in this conversation, was compression triggered without
   * being forced and did it fail?
   */
  private hasFailedCompressionAttempt = false;

  constructor(private readonly config: Config) {
    if (config.getProxy()) {
      setGlobalDispatcher(new ProxyAgent(config.getProxy() as string));
    }

    this.logger = new DebugLogger('llxprt:core:client');
    this.embeddingModel = config.getEmbeddingModel();
    this.loopDetector = new LoopDetectionService(config);
    this.lastPromptId = this.config.getSessionId();

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
    const toolDeclarations = toolRegistry.getFunctionDeclarations();

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
    const toolDeclarations = toolRegistry.getFunctionDeclarations();
    const tools: Tool[] = [{ functionDeclarations: toolDeclarations }];
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
      const currentModel = this.config.getModel();
      for (const content of extraHistory) {
        historyService.add(ContentConverters.toIContent(content), currentModel);
      }
    }

    try {
      const userMemory = this.config.getUserMemory();
      const model = this.config.getModel();
      const providerName =
        this.config
          .getContentGeneratorConfig()
          ?.providerManager?.getActiveProviderName() ||
        this.config.getProvider() ||
        'gemini';
      const logger = new DebugLogger('llxprt:client:start');
      logger.debug(
        () => `DEBUG [client.startChat]: Model from config: ${model}`,
      );
      let systemInstruction = await getCoreSystemPromptAsync({
        userMemory,
        model,
        provider: providerName,
        tools: enabledToolNames,
      });

      // Add environment context to system instruction
      const envContextText = envParts
        .map((part) => ('text' in part ? part.text : ''))
        .join('\n');
      if (envContextText) {
        systemInstruction = `${envContextText}\n\n${systemInstruction}`;
      }

      logger.debug(
        () =>
          `DEBUG [client.startChat]: System instruction includes Flash instructions: ${systemInstruction.includes(
            'IMPORTANT: You MUST use the provided tools',
          )}`,
      );

      const generateContentConfigWithThinking = isThinkingSupported(
        this.config.getModel(),
      )
        ? {
            ...this.generateContentConfig,
            thinkingConfig: {
              thinkingBudget: -1,
              includeThoughts: true,
            },
          }
        : this.generateContentConfig;
      return new GeminiChat(
        this.config,
        this.getContentGenerator(),
        {
          systemInstruction,
          ...generateContentConfigWithThinking,
          tools,
        },
        [], // Empty initial history since we're using HistoryService
        historyService,
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
    request: PartListUnion,
    signal: AbortSignal,
    prompt_id: string,
    turns: number = this.MAX_TURNS,
    originalModel?: string,
  ): AsyncGenerator<ServerGeminiStreamEvent, Turn> {
    const logger = new DebugLogger('llxprt:client:stream');
    logger.debug(() => 'DEBUG: GeminiClient.sendMessageStream called');
    logger.debug(
      () =>
        `DEBUG: GeminiClient.sendMessageStream request: ${JSON.stringify(request, null, 2)}`,
    );
    logger.debug(
      () =>
        `DEBUG: GeminiClient.sendMessageStream typeof request: ${typeof request}`,
    );
    logger.debug(
      () =>
        `DEBUG: GeminiClient.sendMessageStream Array.isArray(request): ${Array.isArray(request)}`,
    );
    await this.lazyInitialize();

    // Ensure chat is initialized after lazyInitialize
    if (!this.chat) {
      // If we have previous history, restore it when creating the chat
      if (this._previousHistory && this._previousHistory.length > 0) {
        this.logger.debug(
          'Restoring previous history during prompt generation',
          {
            historyLength: this._previousHistory.length,
          },
        );
        // Extract the conversation history after the initial environment setup
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
    if (
      this.config.getMaxSessionTurns() > 0 &&
      this.sessionTurnCount > this.config.getMaxSessionTurns()
    ) {
      yield { type: GeminiEventType.MaxSessionTurns };
      const contentGenConfig = this.config.getContentGeneratorConfig();
      const providerManager = contentGenConfig?.providerManager;
      const providerName =
        providerManager?.getActiveProviderName() || 'backend';
      return new Turn(this.getChat(), prompt_id, providerName);
    }
    // Ensure turns never exceeds MAX_TURNS to prevent infinite loops
    const boundedTurns = Math.min(turns, this.MAX_TURNS);
    if (!boundedTurns) {
      const contentGenConfig = this.config.getContentGeneratorConfig();
      const providerManager = contentGenConfig?.providerManager;
      const providerName =
        providerManager?.getActiveProviderName() || 'backend';
      return new Turn(this.getChat(), prompt_id, providerName);
    }

    // Track the original model from the first call to detect model switching
    const initialModel = originalModel || this.config.getModel();

    const compressed = await this.tryCompressChat(prompt_id);

    if (compressed.compressionStatus === CompressionStatus.COMPRESSED) {
      yield { type: GeminiEventType.ChatCompressed, value: compressed };
    }

    // Prevent context updates from being sent while a tool call is
    // waiting for a response. The Gemini API requires that a functionResponse
    // part from the user immediately follows a functionCall part from the model
    // in the conversation history . The IDE context is not discarded; it will
    // be included in the next regular message sent to the model.
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

    // Complexity detection for proactive todo suggestions
    if (
      this.sessionTurnCount === 1 && // Only on first user message
      Array.isArray(request) &&
      request.length > 0
    ) {
      // Extract user message text
      const userMessage = request
        .filter((part) => typeof part === 'object' && 'text' in part)
        .map((part) => (part as { text: string }).text)
        .join(' ');

      if (userMessage) {
        const analysis = this.complexityAnalyzer.analyzeComplexity(userMessage);

        // Check if we should suggest todos (with cooldown)
        const currentTime = Date.now();
        if (
          analysis.shouldSuggestTodos &&
          currentTime - this.lastComplexitySuggestionTime >
            this.complexitySuggestionCooldown
        ) {
          // Generate suggestion reminder
          const suggestionReminder =
            this.todoReminderService.getComplexTaskSuggestion(
              analysis.detectedTasks,
            );

          // Inject reminder into request
          request = [
            ...(Array.isArray(request) ? request : [request]),
            { text: suggestionReminder },
          ];

          this.lastComplexitySuggestionTime = currentTime;
        }
      }
    }

    // Get provider name for error messages
    const contentGenConfig = this.config.getContentGeneratorConfig();
    const providerManager = contentGenConfig?.providerManager;
    const providerName = providerManager?.getActiveProviderName() || 'backend';

    const turn = new Turn(this.getChat(), prompt_id, providerName);

    const loopDetected = await this.loopDetector.turnStarted(signal);
    if (loopDetected) {
      yield { type: GeminiEventType.LoopDetected };
      return turn;
    }

    const resultStream = turn.run(request, signal);
    for await (const event of resultStream) {
      if (this.loopDetector.addAndCheck(event)) {
        yield { type: GeminiEventType.LoopDetected };
        return turn;
      }
      yield event;
      if (event.type === GeminiEventType.Error) {
        return turn;
      }
    }
    if (!turn.pendingToolCalls.length && signal && !signal.aborted) {
      // Check if model was switched during the call (likely due to quota error)
      const currentModel = this.config.getModel();
      if (currentModel !== initialModel) {
        // Model was switched (likely due to quota error fallback)
        // Don't continue with recursive call to prevent unwanted Flash execution
        return turn;
      }

      // nextSpeakerChecker disabled
    }
    return turn;
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
      const providerName =
        this.config
          .getContentGeneratorConfig()
          ?.providerManager?.getActiveProviderName() ||
        this.config.getProvider() ||
        'gemini';
      const systemInstruction = await getCoreSystemPromptAsync({
        userMemory,
        model: modelToUse,
        provider: providerName,
        tools: this.getEnabledToolNamesForPrompt(),
      });
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

      const result = await retryWithBackoff(apiCall, {
        onPersistent429: async (authType?: string, error?: unknown) =>
          await this.handleFlashFallback(authType, error),
        authType: this.config.getContentGeneratorConfig()?.authType,
      });

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
      const providerName =
        this.config
          .getContentGeneratorConfig()
          ?.providerManager?.getActiveProviderName() ||
        this.config.getProvider() ||
        'gemini';
      const systemInstruction = await getCoreSystemPromptAsync({
        userMemory,
        model: modelToUse,
        provider: providerName,
        tools: this.getEnabledToolNamesForPrompt(),
      });

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

      const result = await retryWithBackoff(apiCall, {
        onPersistent429: async (authType?: string, error?: unknown) =>
          await this.handleFlashFallback(authType, error),
        authType: this.config.getContentGeneratorConfig()?.authType,
      });
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

    const model = this.config.getModel();
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
      if (originalTokenCount < threshold * tokenLimit(model)) {
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
          historyService.emit('tokensUpdated', {
            totalTokens: newTokenCount,
            addedTokens: newTokenCount - originalTokenCount,
            tokenLimit: tokenLimit(this.config.getModel()),
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

  /**
   * Handles falling back to Flash model when persistent 429 errors occur for OAuth users.
   * Uses a fallback handler if provided by the config; otherwise, returns null.
   * Note: This only applies to OAuth users with Gemini models, not for other providers.
   */
  private async handleFlashFallback(
    authType?: string,
    error?: unknown,
  ): Promise<string | null> {
    // Only handle fallback for OAuth users with Gemini models, not for providers
    if (authType !== AuthType.LOGIN_WITH_GOOGLE) {
      return null;
    }

    const currentModel = this.config.getModel();
    const fallbackModel = DEFAULT_GEMINI_FLASH_MODEL;

    // Don't fallback if already using Flash model
    if (currentModel === fallbackModel) {
      return null;
    }

    // Check if config has a fallback handler (set by CLI package)
    const fallbackHandler = this.config.flashFallbackHandler;
    if (typeof fallbackHandler === 'function') {
      try {
        const accepted = await fallbackHandler(
          currentModel,
          fallbackModel,
          error,
        );
        if (accepted !== false && accepted !== null) {
          this.config.setModel(fallbackModel);
          this.config.setFallbackMode(true);
          return fallbackModel;
        }
        // Check if the model was switched manually in the handler
        if (this.config.getModel() === fallbackModel) {
          return null; // Model was switched but don't continue with current prompt
        }
      } catch (error) {
        this.logger.warn(() => 'Flash fallback handler failed:', { error });
      }
    }

    return null;
  }
}
