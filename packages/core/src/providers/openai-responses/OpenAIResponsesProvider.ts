/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * OpenAI Responses API Provider
 * This provider exclusively uses the OpenAI /responses endpoint
 * for models that support it (o1, o3, etc.)
 */
import { DebugLogger } from '../../debug/index.js';
import { IModel } from '../IModel.js';
import {
  IContent,
  TextBlock,
  ToolCallBlock,
  ToolResponseBlock,
} from '../../services/history/IContent.js';
import { ToolFormat } from '../../tools/IToolFormatter.js';
import { IProviderConfig } from '../types/IProviderConfig.js';
import { RESPONSES_API_MODELS } from '../openai/RESPONSES_API_MODELS.js';
import { ConversationCache } from '../openai/ConversationCache.js';
import {
  parseResponsesStream,
  parseErrorResponse,
} from '../openai/parseResponsesStream.js';
import { BaseProvider, BaseProviderConfig } from '../BaseProvider.js';
import { getSettingsService } from '../../settings/settingsServiceInstance.js';

export class OpenAIResponsesProvider extends BaseProvider {
  /**
   * Converts Gemini schema format (with uppercase Type enums) to standard JSON Schema format
   */
  private convertGeminiSchemaToStandard(schema: unknown): unknown {
    if (!schema || typeof schema !== 'object') {
      return schema;
    }

    const newSchema: Record<string, unknown> = { ...schema };

    // Handle properties
    if (newSchema.properties && typeof newSchema.properties === 'object') {
      const newProperties: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(newSchema.properties)) {
        newProperties[key] = this.convertGeminiSchemaToStandard(value);
      }
      newSchema.properties = newProperties;
    }

    // Handle items
    if (newSchema.items) {
      if (Array.isArray(newSchema.items)) {
        newSchema.items = newSchema.items.map((item) =>
          this.convertGeminiSchemaToStandard(item),
        );
      } else {
        newSchema.items = this.convertGeminiSchemaToStandard(newSchema.items);
      }
    }

    // Convert type from UPPERCASE enum to lowercase string
    if (newSchema.type) {
      newSchema.type = String(newSchema.type).toLowerCase();
    }

    // Convert enum values if present
    if (newSchema.enum && Array.isArray(newSchema.enum)) {
      newSchema.enum = newSchema.enum.map((v) => String(v));
    }

    // Convert minLength from string to number if present
    if (newSchema.minLength && typeof newSchema.minLength === 'string') {
      const minLengthNum = parseInt(newSchema.minLength, 10);
      if (!isNaN(minLengthNum)) {
        newSchema.minLength = minLengthNum;
      } else {
        delete newSchema.minLength;
      }
    }

    // Convert maxLength from string to number if present
    if (newSchema.maxLength && typeof newSchema.maxLength === 'string') {
      const maxLengthNum = parseInt(newSchema.maxLength, 10);
      if (!isNaN(maxLengthNum)) {
        newSchema.maxLength = maxLengthNum;
      } else {
        delete newSchema.maxLength;
      }
    }

    return newSchema;
  }

  private logger: DebugLogger;
  private currentModel: string = 'o3-mini';
  private baseURL: string;
  private conversationCache: ConversationCache;
  private modelParams?: Record<string, unknown>;

  constructor(
    apiKey: string | undefined,
    baseURL?: string,
    config?: IProviderConfig,
  ) {
    const baseConfig: BaseProviderConfig = {
      name: 'openai-responses',
      apiKey,
      baseURL: baseURL || 'https://api.openai.com/v1',
      envKeyNames: ['OPENAI_API_KEY'],
      isOAuthEnabled: false,
      oauthProvider: undefined,
      oauthManager: undefined,
    };

    super(baseConfig, config);

    this.logger = new DebugLogger('llxprt:providers:openai-responses');
    this.logger.debug(
      () =>
        `Constructor - baseURL: ${baseURL || 'https://api.openai.com/v1'}, apiKey: ${apiKey?.substring(0, 10) || 'none'}`,
    );
    this.baseURL = baseURL || 'https://api.openai.com/v1';
    this.conversationCache = new ConversationCache();

    // Initialize from SettingsService
    this.initializeFromSettings().catch((error) => {
      this.logger.debug(
        () => `Failed to initialize from SettingsService: ${error}`,
      );
    });

    // Set default model for responses API
    if (
      process.env.LLXPRT_DEFAULT_MODEL &&
      RESPONSES_API_MODELS.some((m) =>
        process.env.LLXPRT_DEFAULT_MODEL!.startsWith(m),
      )
    ) {
      this.currentModel = process.env.LLXPRT_DEFAULT_MODEL;
    }
  }

  /**
   * This provider does not support OAuth
   */
  protected supportsOAuth(): boolean {
    return false;
  }

  override getToolFormat(): ToolFormat {
    // Always use OpenAI format for responses API
    return 'openai';
  }

  override async getModels(): Promise<IModel[]> {
    // Try to fetch models dynamically from the API
    const apiKey = await this.getAuthToken();
    if (!apiKey) {
      // If no API key, return hardcoded list from RESPONSES_API_MODELS
      return RESPONSES_API_MODELS.map((modelId) => ({
        id: modelId,
        name: modelId,
        provider: 'openai-responses',
        supportedToolFormats: ['openai'],
      }));
    }

    try {
      // Fetch models from the API
      const response = await fetch(`${this.baseURL}/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (response.ok) {
        const data = (await response.json()) as { data: Array<{ id: string }> };
        const models: IModel[] = [];

        // Add all models without filtering - let them all through
        for (const model of data.data) {
          // Skip non-chat models (embeddings, audio, image, etc.)
          if (
            !/embedding|whisper|audio|tts|image|vision|dall[- ]?e|moderation/i.test(
              model.id,
            )
          ) {
            models.push({
              id: model.id,
              name: model.id,
              provider: 'openai-responses',
              supportedToolFormats: ['openai'],
            });
          }
        }

        return models.length > 0
          ? models
          : RESPONSES_API_MODELS.map((modelId) => ({
              id: modelId,
              name: modelId,
              provider: 'openai-responses',
              supportedToolFormats: ['openai'],
            }));
      }
    } catch (error) {
      this.logger.debug(() => `Error fetching models from OpenAI: ${error}`);
    }

    // Fallback to hardcoded list from RESPONSES_API_MODELS
    return RESPONSES_API_MODELS.map((modelId) => ({
      id: modelId,
      name: modelId,
      provider: 'openai-responses',
      supportedToolFormats: ['openai'],
    }));
  }

  override setModel(modelId: string): void {
    // Update SettingsService as the source of truth
    this.setModelInSettings(modelId).catch((error) => {
      this.logger.debug(
        () => `Failed to persist model to SettingsService: ${error}`,
      );
    });
    // Keep local cache for performance
    this.currentModel = modelId;
  }

  override getCurrentModel(): string {
    // Try to get from SettingsService first (source of truth)
    try {
      const settingsService = getSettingsService();
      const providerSettings = settingsService.getProviderSettings(this.name);
      if (providerSettings.model) {
        return providerSettings.model as string;
      }
    } catch (error) {
      this.logger.debug(
        () => `Failed to get model from SettingsService: ${error}`,
      );
    }
    // Fall back to cached value or default
    return this.currentModel || this.getDefaultModel();
  }

  override getDefaultModel(): string {
    // Return the default model for responses API
    return 'o3-mini';
  }

  override setApiKey(apiKey: string): void {
    // Call base provider implementation
    super.setApiKey?.(apiKey);

    // Persist to SettingsService if available
    this.setApiKeyInSettings(apiKey).catch((error) => {
      this.logger.debug(
        () => `Failed to persist API key to SettingsService: ${error}`,
      );
    });
  }

  override setBaseUrl(baseUrl?: string): void {
    // If no baseUrl is provided, use default
    this.baseURL =
      baseUrl && baseUrl.trim() !== '' ? baseUrl : 'https://api.openai.com/v1';

    // Persist to SettingsService if available
    this.setBaseUrlInSettings(this.baseURL).catch((error) => {
      this.logger.debug(
        () => `Failed to persist base URL to SettingsService: ${error}`,
      );
    });

    // Call base provider implementation
    super.setBaseUrl?.(baseUrl);
  }

  override setConfig(config: IProviderConfig): void {
    // Update the providerConfig reference but don't store it locally
    // The parent class will manage it through the protected property
    super.setConfig?.(config);
  }

  override setToolFormatOverride(format: ToolFormat | null): void {
    // Responses API only supports OpenAI format
    if (format && format !== 'openai') {
      this.logger.debug(
        () =>
          `Warning: Responses API only supports OpenAI tool format, ignoring override to ${format}`,
      );
    }
  }

  /**
   * Get the conversation cache instance
   */
  getConversationCache(): ConversationCache {
    return this.conversationCache;
  }

  /**
   * OpenAI Responses API always requires payment (API key)
   */
  override isPaidMode(): boolean {
    return true;
  }

  override clearState(): void {
    // Clear the conversation cache to prevent tool call ID mismatches
    this.conversationCache.clear();
  }

  /**
   * Get the list of server tools supported by this provider
   */
  override getServerTools(): string[] {
    return [];
  }

  /**
   * Invoke a server tool (native provider tool)
   */
  override async invokeServerTool(
    _toolName: string,
    _params: unknown,
    _config?: unknown,
  ): Promise<unknown> {
    throw new Error('Server tools not supported by OpenAI Responses provider');
  }

  /**
   * Set model parameters to be included in API calls
   */
  override setModelParams(params: Record<string, unknown> | undefined): void {
    if (params === undefined) {
      this.modelParams = undefined;
    } else {
      this.modelParams = { ...this.modelParams, ...params };
    }

    // Persist to SettingsService if available
    this.setModelParamsInSettings(this.modelParams).catch((error) => {
      this.logger.debug(
        () => `Failed to persist model params to SettingsService: ${error}`,
      );
    });
  }

  /**
   * Get current model parameters
   */
  override getModelParams(): Record<string, unknown> | undefined {
    return this.modelParams;
  }

  /**
   * Initialize provider configuration from SettingsService
   */
  private async initializeFromSettings(): Promise<void> {
    try {
      // Load saved model if available
      const savedModel = await this.getModelFromSettings();
      if (
        savedModel &&
        RESPONSES_API_MODELS.some((m) => savedModel.startsWith(m))
      ) {
        this.currentModel = savedModel;
      }

      // Load saved base URL if available
      const savedBaseUrl = await this.getBaseUrlFromSettings();
      if (savedBaseUrl !== undefined) {
        this.baseURL = savedBaseUrl || 'https://api.openai.com/v1';
      }

      // Load saved model parameters if available
      const savedParams = await this.getModelParamsFromSettings();
      if (savedParams) {
        this.modelParams = savedParams;
      }

      this.logger.debug(
        () =>
          `Initialized from SettingsService - model: ${this.currentModel}, baseURL: ${this.baseURL}, params: ${JSON.stringify(this.modelParams)}`,
      );
    } catch (error) {
      this.logger.debug(
        () =>
          `Failed to initialize OpenAI Responses provider from SettingsService: ${error}`,
      );
    }
  }

  /**
   * Check if the provider is authenticated using any available method
   */
  override async isAuthenticated(): Promise<boolean> {
    return super.isAuthenticated();
  }

  /**
   * Generate chat completion with IContent interface
   * Direct implementation for OpenAI Responses API with IContent interface
   */
  async *generateChatCompletion(
    content: IContent[],
    tools?: Array<{
      functionDeclarations: Array<{
        name: string;
        description?: string;
        parameters?: unknown;
      }>;
    }>,
    _toolFormat?: string,
  ): AsyncIterableIterator<IContent> {
    // Check if API key is available
    const apiKey = await this.getAuthToken();
    if (!apiKey) {
      throw new Error('OpenAI API key is required to generate completions');
    }

    // Build Responses API input array directly from IContent
    // For the Responses API, we only send user and assistant messages
    // Tool calls and responses from history are not sent as the API handles tools differently
    const input: Array<{
      role: 'user' | 'assistant' | 'system';
      content?: string;
    }> = [];

    for (const c of content) {
      if (c.speaker === 'human') {
        const textBlock = c.blocks.find((b) => b.type === 'text') as
          | TextBlock
          | undefined;
        if (textBlock?.text) {
          input.push({
            role: 'user',
            content: textBlock.text,
          });
        }
      } else if (c.speaker === 'ai') {
        // For AI messages, we only include the text content
        // Tool calls are part of the history but not sent to the API
        const textBlocks = c.blocks.filter(
          (b) => b.type === 'text',
        ) as TextBlock[];
        const toolCallBlocks = c.blocks.filter(
          (b) => b.type === 'tool_call',
        ) as ToolCallBlock[];

        const contentText = textBlocks.map((b) => b.text).join('');

        // If there's text content or it's a pure tool call response, include it
        if (contentText || toolCallBlocks.length > 0) {
          const assistantMsg: { role: 'assistant'; content?: string } = {
            role: 'assistant',
          };

          // Include text content if present
          if (contentText) {
            assistantMsg.content = contentText;
          } else if (toolCallBlocks.length > 0) {
            // For tool-only responses, add a brief description
            assistantMsg.content = `[Called ${toolCallBlocks.length} tool${toolCallBlocks.length > 1 ? 's' : ''}: ${toolCallBlocks.map((tc) => tc.name).join(', ')}]`;
          }

          input.push(assistantMsg);
        }
      } else if (c.speaker === 'tool') {
        // Tool responses are converted to assistant messages with the result
        const toolResponseBlock = c.blocks.find(
          (b) => b.type === 'tool_response',
        ) as ToolResponseBlock | undefined;
        if (toolResponseBlock) {
          // Add tool result as an assistant message
          const result =
            typeof toolResponseBlock.result === 'string'
              ? toolResponseBlock.result
              : JSON.stringify(toolResponseBlock.result);
          input.push({
            role: 'assistant',
            content: `[Tool ${toolResponseBlock.toolName} result]: ${result}`,
          });
        }
      }
    }

    // Convert Gemini format tools to Responses API format directly
    // Based on the ToolFormatter.toResponsesTool format
    const responsesTools = tools
      ? tools[0].functionDeclarations.map((decl) => {
          // Support both old 'parameters' and new 'parametersJsonSchema' formats
          // DeclarativeTool uses parametersJsonSchema, while legacy tools use parameters
          const toolParameters =
            'parametersJsonSchema' in decl
              ? (decl as { parametersJsonSchema?: unknown })
                  .parametersJsonSchema
              : decl.parameters;

          // Convert parameters from Gemini format to standard format
          const convertedParams = toolParameters
            ? (this.convertGeminiSchemaToStandard(toolParameters) as Record<
                string,
                unknown
              >)
            : { type: 'object', properties: {} };

          return {
            type: 'function' as const,
            name: decl.name,
            description: decl.description || null,
            parameters: convertedParams,
            strict: null,
          };
        })
      : undefined;

    // Build the request directly for Responses API
    const request: {
      model: string;
      input: typeof input;
      tools?: typeof responsesTools;
      stream: boolean;
      [key: string]: unknown;
    } = {
      model: this.currentModel,
      input,
      stream: true,
      ...(this.modelParams || {}),
    };

    if (responsesTools && responsesTools.length > 0) {
      request.tools = responsesTools;
    }

    // Make the API call
    const responsesURL = `${this.baseURL}/responses`;
    const requestBody = JSON.stringify(request);
    const bodyBlob = new Blob([requestBody], {
      type: 'application/json; charset=utf-8',
    });

    const response = await fetch(responsesURL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: bodyBlob,
    });

    // Handle errors
    if (!response.ok) {
      const errorBody = await response.text();
      throw parseErrorResponse(response.status, errorBody, this.name);
    }

    // Stream the response directly as IContent
    if (response.body) {
      for await (const message of parseResponsesStream(response.body)) {
        // The parseResponsesStream now returns IContent directly
        yield message;
      }
    }
  }
}
