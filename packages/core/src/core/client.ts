/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  EmbedContentParameters,
  GenerateContentConfig,
  Part,
  SchemaUnion,
  PartListUnion,
  Content,
  Tool,
  GenerateContentResponse,
} from '@google/genai';
import { getFolderStructure } from '../utils/getFolderStructure.js';
import {
  Turn,
  ServerGeminiStreamEvent,
  GeminiEventType,
  ChatCompressionInfo,
} from './turn.js';
import { Config } from '../config/config.js';
import { UserTierId } from '../code_assist/types.js';
import { getCoreSystemPrompt, getCompressionPrompt } from './prompts.js';
import { ReadManyFilesTool } from '../tools/read-many-files.js';
import { getResponseText } from '../utils/generateContentResponseUtilities.js';
import { checkNextSpeaker } from '../utils/nextSpeakerChecker.js';
import { reportError } from '../utils/errorReporting.js';
import { GeminiChat } from './geminiChat.js';
import { retryWithBackoff } from '../utils/retry.js';
import { getErrorMessage } from '../utils/errors.js';
import { isFunctionResponse } from '../utils/messageInspectors.js';
import { tokenLimit } from './tokenLimits.js';
import {
  AuthType,
  ContentGenerator,
  ContentGeneratorConfig,
  createContentGenerator,
} from './contentGenerator.js';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { DEFAULT_GEMINI_FLASH_MODEL } from '../config/models.js';
import { LoopDetectionService } from '../services/loopDetectionService.js';
import { ideContext } from '../ide/ideContext.js';
import { logNextSpeakerCheck } from '../telemetry/loggers.js';
import {
  MalformedJsonResponseEvent,
  NextSpeakerCheckEvent,
} from '../telemetry/types.js';
import { ClearcutLogger } from '../telemetry/clearcut-logger/clearcut-logger.js';
import { ComplexityAnalyzer } from '../services/complexity-analyzer.js';
import { TodoReminderService } from '../services/todo-reminder-service.js';

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
  private generateContentConfig: GenerateContentConfig = {
    temperature: 0,
    topP: 1,
  };
  private sessionTurnCount = 0;
  private readonly MAX_TURNS = 100;
  private _pendingConfig?: ContentGeneratorConfig;
  private _previousHistory?: Content[];
  /**
   * Threshold for compression token count as a fraction of the model's token limit.
   * If the chat history exceeds this threshold, it will be compressed.
   */
  private readonly COMPRESSION_TOKEN_THRESHOLD = 0.7;
  /**
   * The fraction of the latest chat history to keep. A value of 0.3
   * means that only the last 30% of the chat history will be kept after compression.
   */
  private readonly COMPRESSION_PRESERVE_THRESHOLD = 0.3;

  private readonly loopDetector: LoopDetectionService;
  private lastPromptId?: string;
  private readonly complexityAnalyzer: ComplexityAnalyzer;
  private readonly todoReminderService: TodoReminderService;
  private lastComplexitySuggestionTime: number = 0;
  private readonly complexitySuggestionCooldown: number;

  constructor(private config: Config) {
    if (config.getProxy()) {
      setGlobalDispatcher(new ProxyAgent(config.getProxy() as string));
    }

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
    // Preserve chat history before resetting
    const previousHistory = this.chat?.getHistory();

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

    // If we have previous history, restore it when creating the chat
    // This preserves conversation context across auth transitions
    if (this._previousHistory && this._previousHistory.length > 0) {
      // Extract the conversation history after the initial environment setup
      // The first two messages are always the environment context and acknowledgment
      const conversationHistory = this._previousHistory.slice(2);
      this.chat = await this.startChat(conversationHistory);
    } else {
      this.chat = await this.startChat();
    }

    // Clear pending config and history after successful initialization
    this._pendingConfig = undefined;
    this._previousHistory = undefined;
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
    this.getChat().addHistory(content);
  }

  getChat(): GeminiChat {
    if (!this.chat) {
      throw new Error('Chat not initialized');
    }
    return this.chat;
  }

  isInitialized(): boolean {
    return this.chat !== undefined && this.contentGenerator !== undefined;
  }

  getHistory(): Content[] {
    return this.getChat().getHistory();
  }

  setHistory(history: Content[]) {
    this.getChat().setHistory(history);
  }

  async setTools(): Promise<void> {
    const toolRegistry = await this.config.getToolRegistry();
    const toolDeclarations = toolRegistry.getFunctionDeclarations();
    const tools: Tool[] = [{ functionDeclarations: toolDeclarations }];
    this.getChat().setTools(tools);
  }

  async resetChat(): Promise<void> {
    this.chat = await this.startChat();
  }

  async addDirectoryContext(): Promise<void> {
    if (!this.chat) {
      return;
    }

    this.getChat().addHistory({
      role: 'user',
      parts: [{ text: await this.getDirectoryContext() }],
    });
  }

  private async getDirectoryContext(): Promise<string> {
    const workspaceContext = this.config.getWorkspaceContext();
    const workspaceDirectories = workspaceContext.getDirectories();

    const folderStructures = await Promise.all(
      workspaceDirectories.map((dir) =>
        getFolderStructure(dir, {
          fileService: this.config.getFileService(),
        }),
      ),
    );

    const folderStructure = folderStructures.join('\n');
    const dirList = workspaceDirectories.map((dir) => `  - ${dir}`).join('\n');
    const workingDirPreamble = `I'm currently working in the following directories:\n${dirList}\n Folder structures are as follows:\n${folderStructure}`;
    return workingDirPreamble;
  }

  private async getEnvironment(): Promise<Part[]> {
    const today = new Date().toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const platform = process.platform;

    const workspaceContext = this.config.getWorkspaceContext();
    const workspaceDirectories = workspaceContext.getDirectories();

    const folderStructures = await Promise.all(
      workspaceDirectories.map((dir) =>
        getFolderStructure(dir, {
          fileService: this.config.getFileService(),
        }),
      ),
    );

    const folderStructure = folderStructures.join('\n');

    let workingDirPreamble: string;
    if (workspaceDirectories.length === 1) {
      workingDirPreamble = `I'm currently working in the directory: ${workspaceDirectories[0]}`;
    } else {
      const dirList = workspaceDirectories
        .map((dir) => `  - ${dir}`)
        .join('\n');
      workingDirPreamble = `I'm currently working in the following directories:\n${dirList}`;
    }

    const context = `
  This is the CLI. We are setting up the context for our chat.
  Today's date is ${today}.
  My operating system is: ${platform}
  ${workingDirPreamble}
  Here is the folder structure of the current working directories:\n
  ${folderStructure}
          `.trim();

    const initialParts: Part[] = [{ text: context }];
    const toolRegistry = await this.config.getToolRegistry();

    // Add full file context if the flag is set
    if (this.config.getFullContext()) {
      try {
        const readManyFilesTool = toolRegistry.getTool(
          'read_many_files',
        ) as ReadManyFilesTool;
        if (readManyFilesTool) {
          // Read all files in the target directory
          const result = await readManyFilesTool.execute(
            {
              paths: ['**/*'], // Read everything recursively
              useDefaultExcludes: true, // Use default excludes
            },
            AbortSignal.timeout(30000),
          );
          if (result.llmContent) {
            initialParts.push({
              text: `\n--- Full File Context ---\n${result.llmContent}`,
            });
          } else {
            console.warn(
              'Full context requested, but read_many_files returned no content.',
            );
          }
        } else {
          console.warn(
            'Full context requested, but read_many_files tool not found.',
          );
        }
      } catch (error) {
        // Not using reportError here as it's a startup/config phase, not a chat/generation phase error.
        console.error('Error reading full file context:', error);
        initialParts.push({
          text: '\n--- Error reading full file context ---',
        });
      }
    }

    return initialParts;
  }

  async startChat(extraHistory?: Content[]): Promise<GeminiChat> {
    const envParts = await this.getEnvironment();
    const toolRegistry = await this.config.getToolRegistry();
    const toolDeclarations = toolRegistry.getFunctionDeclarations();
    const tools: Tool[] = [{ functionDeclarations: toolDeclarations }];
    const history: Content[] = [
      {
        role: 'user',
        parts: envParts,
      },
      {
        role: 'model',
        parts: [{ text: 'Got it. Thanks for the context!' }],
      },
      ...(extraHistory ?? []),
    ];
    try {
      const userMemory = this.config.getUserMemory();
      const model = this.config.getModel();
      if (process.env.DEBUG) {
        console.log('DEBUG [client.startChat]: Model from config:', model);
      }
      const systemInstruction = getCoreSystemPrompt(userMemory, model);
      if (process.env.DEBUG) {
        console.log(
          'DEBUG [client.startChat]: System instruction includes Flash instructions:',
          systemInstruction.includes(
            'IMPORTANT: You MUST use the provided tools',
          ),
        );
      }

      const generateContentConfigWithThinking = isThinkingSupported(
        this.config.getModel(),
      )
        ? {
            ...this.generateContentConfig,
            thinkingConfig: {
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
        history,
      );
    } catch (error) {
      await reportError(
        error,
        'Error initializing chat session.',
        history,
        'startChat',
      );
      throw new Error(`Failed to initialize chat: ${getErrorMessage(error)}`);
    }
  }

  async *sendMessageStream(
    request: PartListUnion,
    signal: AbortSignal,
    prompt_id: string,
    turns: number = this.MAX_TURNS,
    originalModel?: string,
  ): AsyncGenerator<ServerGeminiStreamEvent, Turn> {
    if (process.env.DEBUG) {
      console.log('DEBUG: GeminiClient.sendMessageStream called');
      console.log(
        'DEBUG: GeminiClient.sendMessageStream request:',
        JSON.stringify(request, null, 2),
      );
      console.log(
        'DEBUG: GeminiClient.sendMessageStream typeof request:',
        typeof request,
      );
      console.log(
        'DEBUG: GeminiClient.sendMessageStream Array.isArray(request):',
        Array.isArray(request),
      );
    }
    await this.lazyInitialize();

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

    if (compressed) {
      yield { type: GeminiEventType.ChatCompressed, value: compressed };
    }

    if (this.config.getIdeModeFeature() && this.config.getIdeMode()) {
      const ideContextState = ideContext.getIdeContext();
      const openFiles = ideContextState?.workspaceState?.openFiles;

      if (openFiles && openFiles.length > 0) {
        const contextParts: string[] = [];
        const firstFile = openFiles[0];
        const activeFile = firstFile.isActive ? firstFile : undefined;

        if (activeFile) {
          contextParts.push(
            `This is the file that the user is looking at:\n- Path: ${activeFile.path}`,
          );
          if (activeFile.cursor) {
            contextParts.push(
              `This is the cursor position in the file:\n- Cursor Position: Line ${activeFile.cursor.line}, Character ${activeFile.cursor.character}`,
            );
          }
          if (activeFile.selectedText) {
            contextParts.push(
              `This is the selected text in the file:\n- ${activeFile.selectedText}`,
            );
          }
        }

        const otherOpenFiles = activeFile ? openFiles.slice(1) : openFiles;

        if (otherOpenFiles.length > 0) {
          const recentFiles = otherOpenFiles
            .map((file) => `- ${file.path}`)
            .join('\n');
          const heading = activeFile
            ? `Here are some other files the user has open, with the most recent at the top:`
            : `Here are some files the user has open, with the most recent at the top:`;
          contextParts.push(`${heading}\n${recentFiles}`);
        }

        if (contextParts.length > 0) {
          request = [
            { text: contextParts.join('\n') },
            ...(Array.isArray(request) ? request : [request]),
          ];
        }
      }
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
    }
    if (!turn.pendingToolCalls.length && signal && !signal.aborted) {
      // Check if model was switched during the call (likely due to quota error)
      const currentModel = this.config.getModel();
      if (currentModel !== initialModel) {
        // Model was switched (likely due to quota error fallback)
        // Don't continue with recursive call to prevent unwanted Flash execution
        return turn;
      }

      // Only check next speaker for Gemini provider
      const contentGenConfig = this.config.getContentGeneratorConfig();
      const providerManager = contentGenConfig?.providerManager;
      const providerName = providerManager?.getActiveProviderName() || 'gemini';
      if (providerName === 'gemini') {
        const nextSpeakerCheck = await checkNextSpeaker(
          this.getChat(),
          this,
          signal,
        );
        logNextSpeakerCheck(
          this.config,
          new NextSpeakerCheckEvent(
            prompt_id,
            turn.finishReason?.toString() || '',
            nextSpeakerCheck?.next_speaker || '',
          ),
        );
        if (nextSpeakerCheck?.next_speaker === 'model') {
          const nextRequest = [{ text: 'Please continue.' }];
          // This recursive call's events will be yielded out, but the final
          // turn object will be from the top-level call.
          yield* this.sendMessageStream(
            nextRequest,
            signal,
            prompt_id,
            boundedTurns - 1,
            initialModel,
          );
        }
      }
    }
    return turn;
  }

  async generateJson(
    contents: Content[],
    schema: SchemaUnion,
    abortSignal: AbortSignal,
    model?: string,
    config: GenerateContentConfig = {},
  ): Promise<Record<string, unknown>> {
    await this.lazyInitialize();
    // Use current model from config instead of hardcoded Flash model
    const modelToUse =
      model || this.config.getModel() || DEFAULT_GEMINI_FLASH_MODEL;
    try {
      const userMemory = this.config.getUserMemory();
      const systemInstruction = getCoreSystemPrompt(userMemory, modelToUse);
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
              responseSchema: schema,
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
        ClearcutLogger.getInstance(this.config)?.logMalformedJsonResponseEvent(
          new MalformedJsonResponseEvent(modelToUse),
        );
        text = text
          .substring(prefix.length, text.length - suffix.length)
          .trim();
      }

      try {
        // Extract JSON from potential markdown wrapper
        const cleanedText = extractJsonFromMarkdown(text);
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
    model?: string,
  ): Promise<GenerateContentResponse> {
    await this.lazyInitialize();
    const modelToUse = model ?? this.config.getModel();
    const configToUse: GenerateContentConfig = {
      ...this.generateContentConfig,
      ...generationConfig,
    };

    try {
      const userMemory = this.config.getUserMemory();
      const systemInstruction = getCoreSystemPrompt(userMemory, modelToUse);

      const requestConfig = {
        abortSignal,
        ...configToUse,
        systemInstruction,
      };

      const apiCall = () =>
        this.getContentGenerator().generateContent(
          {
            model: modelToUse,
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
        `Error generating content via API with model ${modelToUse}.`,
        {
          requestContents: contents,
          requestConfig: configToUse,
        },
        'generateContent-api',
      );
      throw new Error(
        `Failed to generate content with model ${modelToUse}: ${getErrorMessage(error)}`,
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

  async tryCompressChat(
    prompt_id: string,
    force: boolean = false,
  ): Promise<ChatCompressionInfo | null> {
    await this.lazyInitialize();
    const curatedHistory = this.getChat().getHistory(true);

    // Regardless of `force`, don't do anything if the history is empty.
    if (curatedHistory.length === 0) {
      return null;
    }

    const model = this.config.getModel();

    const { totalTokens: originalTokenCount } =
      await this.getContentGenerator().countTokens({
        model,
        contents: curatedHistory,
      });
    if (originalTokenCount === undefined) {
      console.warn(`Could not determine token count for model ${model}.`);
      return null;
    }

    // Don't compress if not forced and we are under the limit.
    if (
      !force &&
      originalTokenCount < this.COMPRESSION_TOKEN_THRESHOLD * tokenLimit(model)
    ) {
      return null;
    }

    let compressBeforeIndex = findIndexAfterFraction(
      curatedHistory,
      1 - this.COMPRESSION_PRESERVE_THRESHOLD,
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
        },
      },
      prompt_id,
    );
    this.chat = await this.startChat([
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

    const { totalTokens: newTokenCount } =
      await this.getContentGenerator().countTokens({
        // model might change after calling `sendMessage`, so we get the newest value from config
        model: this.config.getModel(),
        contents: this.getChat().getHistory(),
      });
    if (newTokenCount === undefined) {
      console.warn('Could not determine compressed history token count.');
      return null;
    }

    return {
      originalTokenCount,
      newTokenCount,
    };
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
        console.warn('Flash fallback handler failed:', error);
      }
    }

    return null;
  }
}
