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
// @plan:PLAN-20251023-STATELESS-HARDENING.P08
// @requirement:REQ-SP4-002/REQ-SP4-003
// Removed ConversationCache and peekActiveProviderRuntime dependencies to enforce stateless operation
import { DebugLogger } from '../../debug/index.js';
import { IModel } from '../IModel.js';
import {
  IContent,
  TextBlock,
  ToolCallBlock,
  ToolResponseBlock,
} from '../../services/history/IContent.js';
import { IProviderConfig } from '../types/IProviderConfig.js';
import { RESPONSES_API_MODELS } from '../openai/RESPONSES_API_MODELS.js';
import {
  parseResponsesStream,
  parseErrorResponse,
} from '../openai/parseResponsesStream.js';
import {
  BaseProvider,
  BaseProviderConfig,
  NormalizedGenerateChatOptions,
} from '../BaseProvider.js';
import type { ToolFormat } from '../../tools/IToolFormatter.js';
import { convertToolsToOpenAIResponses } from './schemaConverter.js';
import { getCoreSystemPromptAsync } from '../../core/prompts.js';
import { resolveUserMemory } from '../utils/userMemory.js';
import { resolveRuntimeAuthToken } from '../utils/authToken.js';
import { filterOpenAIRequestParams } from '../openai/openaiRequestParams.js';

export class OpenAIResponsesProvider extends BaseProvider {
  private logger: DebugLogger;
  // @plan:PLAN-20251023-STATELESS-HARDENING.P08
  // @requirement:REQ-SP4-002/REQ-SP4-003
  // Removed static cache scope and conversation cache dependencies to achieve stateless operation

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
  }

  /**
   * This provider does not support OAuth
   */

  // @plan:PLAN-20251023-STATELESS-HARDENING.P08
  // @requirement:REQ-SP4-002/REQ-SP4-003
  // Removed stateful conversation cache methods to ensure stateless operation

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
      const baseURL = this.getBaseURL() || 'https://api.openai.com/v1';
      const response = await fetch(`${baseURL}/models`, {
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

  override getCurrentModel(): string {
    return this.getModel();
  }

  override getDefaultModel(): string {
    // Return the default model for responses API
    return 'o3-mini';
  }

  override setConfig(config: IProviderConfig): void {
    // Update the providerConfig reference but don't store it locally
    // The parent class will manage it through the protected property
    super.setConfig?.(config);
  }

  // @plan:PLAN-20251023-STATELESS-HARDENING.P08
  // @requirement:REQ-SP4-002/REQ-SP4-003
  // Removed getConversationCache method to eliminate stateful conversation handling

  /**
   * OpenAI Responses API always requires payment (API key)
   */
  override isPaidMode(): boolean {
    return true;
  }

  override clearState(): void {
    super.clearState?.();
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
    _signal?: AbortSignal,
  ): Promise<unknown> {
    throw new Error('Server tools not supported by OpenAI Responses provider');
  }

  /**
   * Get current model parameters
   */

  override getModelParams(): Record<string, unknown> | undefined {
    try {
      const providerSettings =
        this.resolveSettingsService().getProviderSettings(this.name) as Record<
          string,
          unknown
        >;

      const {
        temperature,
        maxTokens,
        max_tokens: maxTokensSnake,
        enabled: _enabled,
        apiKey: _apiKey,
        baseUrl: _baseUrl,
        model: _model,
        ...custom
      } = providerSettings;

      const params: Record<string, unknown> = { ...custom };
      if (temperature !== undefined) {
        params.temperature = temperature;
      }

      const resolvedMaxTokens =
        maxTokens !== undefined ? maxTokens : maxTokensSnake;
      if (resolvedMaxTokens !== undefined) {
        params.max_tokens = resolvedMaxTokens;
      }

      return Object.keys(params).length > 0 ? params : undefined;
    } catch (error) {
      this.logger.debug(
        () => `Failed to compute model params from SettingsService: ${error}`,
      );
      return undefined;
    }
  }

  /**
   * Check if the provider is authenticated using any available method
   */
  override async isAuthenticated(): Promise<boolean> {
    return super.isAuthenticated();
  }

  /**
   * @plan PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement REQ-SP4-002/REQ-SP4-003
   * Refactored to remove constructor-captured config and global state, sourcing all per-call data from normalized options
   */
  protected override async *generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    const { contents: content, tools } = options;

    const apiKey =
      (await this.getAuthToken()) ??
      (await resolveRuntimeAuthToken(options.resolved.authToken)) ??
      '';
    if (!apiKey) {
      throw new Error('OpenAI API key is required to generate completions');
    }

    const resolvedModel = options.resolved.model || this.getDefaultModel();
    const toolNamesForPrompt =
      tools === undefined
        ? undefined
        : Array.from(
            new Set(
              tools.flatMap((group) =>
                group.functionDeclarations
                  .map((decl) => decl.name)
                  .filter((name): name is string => Boolean(name)),
              ),
            ),
          );
    // @plan:PLAN-20251023-STATELESS-HARDENING.P08
    // @requirement:REQ-SP4-002/REQ-SP4-003
    // Source user memory directly from normalized options if available, then fallback to runtime config
    const userMemory = await resolveUserMemory(
      options.userMemory,
      () => options.invocation?.userMemory,
    );

    const systemPrompt = await getCoreSystemPromptAsync(
      userMemory,
      resolvedModel,
      toolNamesForPrompt,
    );

    const input: Array<{
      role: 'user' | 'assistant' | 'system';
      content?: string;
    }> = [];

    if (systemPrompt) {
      input.push({
        role: 'system',
        content: systemPrompt,
      });
    }

    for (const c of content) {
      if (c.speaker === 'human') {
        const textBlock = c.blocks.find((b) => b.type === 'text') as
          | TextBlock
          | undefined;
        if (textBlock?.text) {
          input.push({ role: 'user', content: textBlock.text });
        }
      } else if (c.speaker === 'ai') {
        const textBlocks = c.blocks.filter(
          (b) => b.type === 'text',
        ) as TextBlock[];
        const toolCallBlocks = c.blocks.filter(
          (b) => b.type === 'tool_call',
        ) as ToolCallBlock[];

        const contentText = textBlocks.map((b) => b.text).join('');
        if (contentText || toolCallBlocks.length > 0) {
          const assistantMsg: { role: 'assistant'; content?: string } = {
            role: 'assistant',
          };

          if (contentText) {
            assistantMsg.content = contentText;
          } else {
            assistantMsg.content = `[Called ${toolCallBlocks.length} tool${toolCallBlocks.length > 1 ? 's' : ''}: ${toolCallBlocks.map((tc) => tc.name).join(', ')}]`;
          }

          input.push(assistantMsg);
        }
      } else if (c.speaker === 'tool') {
        const toolResponseBlock = c.blocks.find(
          (b) => b.type === 'tool_response',
        ) as ToolResponseBlock | undefined;
        if (toolResponseBlock) {
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

    // Convert Gemini tools to OpenAI Responses format using provider-specific converter
    const responsesTools = convertToolsToOpenAIResponses(tools);

    // @plan:PLAN-20251023-STATELESS-HARDENING.P08
    // @requirement:REQ-SP4-002/REQ-SP4-003
    // Source per-call request overrides from normalized options (ephemeral settings take precedence)
    const runtimeConfigEphemeralSettings = options.invocation?.ephemerals;
    const settingsServiceModelParams = options.settings?.getProviderSettings(
      this.name,
    );

    const filteredSettingsParams = filterOpenAIRequestParams(
      settingsServiceModelParams as Record<string, unknown> | undefined,
    );
    const filteredEphemeralParams = filterOpenAIRequestParams(
      runtimeConfigEphemeralSettings as Record<string, unknown> | undefined,
    );

    // Include both ephemeral and persistent settings, with ephemeral settings taking precedence
    const requestOverrides: Record<string, unknown> = {
      ...(filteredSettingsParams ?? {}),
      ...(filteredEphemeralParams ?? {}),
    };

    // @plan:PLAN-20251023-STATELESS-HARDENING.P08
    // @requirement:REQ-SP4-002/REQ-SP4-003
    // Prefer resolved options, then runtime config, then defaults instead of stored provider state
    const baseURLCandidate =
      options.resolved.baseURL ??
      this.getBaseURL() ??
      'https://api.openai.com/v1';
    const baseURL = baseURLCandidate.replace(/\/+$/u, '');

    const request: {
      model: string;
      input: typeof input;
      tools?: typeof responsesTools;
      stream: boolean;
      [key: string]: unknown;
    } = {
      model: resolvedModel,
      input,
      stream: true,
      ...(requestOverrides || {}),
    };

    if (responsesTools && responsesTools.length > 0) {
      request.tools = responsesTools;
    }

    const responsesURL = `${baseURL}/responses`;
    const requestBody = JSON.stringify(request);
    const bodyBlob = new Blob([requestBody], {
      type: 'application/json; charset=utf-8',
    });

    // @plan:PLAN-20251023-STATELESS-HARDENING.P08
    // @requirement:REQ-SP4-002/REQ-SP4-003
    // Source custom headers from normalized provider configuration each call
    const customHeaders = this.getCustomHeaders();
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json; charset=utf-8',
      ...(customHeaders ?? {}),
    };

    const response = await fetch(responsesURL, {
      method: 'POST',
      headers,
      body: bodyBlob,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw parseErrorResponse(response.status, errorBody, this.name);
    }

    if (response.body) {
      for await (const message of parseResponsesStream(response.body)) {
        yield message;
      }
    }
  }
}
