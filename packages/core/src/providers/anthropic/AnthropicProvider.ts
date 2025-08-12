import Anthropic from '@anthropic-ai/sdk';
import type { ClientOptions } from '@anthropic-ai/sdk';
import type { Stream } from '@anthropic-ai/sdk/streaming';
import { IModel } from '../IModel.js';
import { ITool } from '../ITool.js';
import { IMessage } from '../IMessage.js';
import { retryWithBackoff } from '../../utils/retry.js';
import { ToolFormatter } from '../../tools/ToolFormatter.js';
import type { ToolFormat } from '../../tools/IToolFormatter.js';
import { IProviderConfig } from '../types/IProviderConfig.js';
import { BaseProvider, BaseProviderConfig } from '../BaseProvider.js';
import { OAuthManager } from '../../auth/precedence.js';

export class AnthropicProvider extends BaseProvider {
  private anthropic: Anthropic;
  private toolFormatter: ToolFormatter;
  toolFormat: ToolFormat = 'anthropic';
  private baseURL?: string;
  private config?: IProviderConfig;
  private currentModel: string = 'claude-sonnet-4-latest'; // Default model using latest alias
  private modelParams?: Record<string, unknown>;

  // Model cache for latest resolution
  private modelCache: { models: IModel[]; timestamp: number } | null = null;
  private readonly modelCacheTTL = 5 * 60 * 1000; // 5 minutes

  // Retry configuration
  private readonly retryableErrorMessages = [
    'overloaded',
    'rate_limit',
    'server_error',
    'service_unavailable',
  ];

  // Model patterns for max output tokens
  private modelTokenPatterns: Array<{ pattern: RegExp; tokens: number }> = [
    { pattern: /claude-.*opus-4/i, tokens: 32000 },
    { pattern: /claude-.*sonnet-4/i, tokens: 64000 },
    { pattern: /claude-.*haiku-4/i, tokens: 200000 }, // Future-proofing for Haiku 4
    { pattern: /claude-.*3-7.*sonnet/i, tokens: 64000 },
    { pattern: /claude-.*3-5.*sonnet/i, tokens: 8192 },
    { pattern: /claude-.*3-5.*haiku/i, tokens: 8192 },
    { pattern: /claude-.*3.*opus/i, tokens: 4096 },
    { pattern: /claude-.*3.*haiku/i, tokens: 4096 },
  ];

  constructor(
    apiKey?: string,
    baseURL?: string,
    config?: IProviderConfig,
    oauthManager?: OAuthManager,
  ) {
    // Initialize base provider with auth configuration
    const baseConfig: BaseProviderConfig = {
      name: 'anthropic',
      apiKey,
      baseURL,
      cliKey: !apiKey || apiKey === '' ? undefined : apiKey,
      envKeyNames: ['ANTHROPIC_API_KEY'],
      isOAuthEnabled: !!oauthManager,
      oauthProvider: oauthManager ? 'anthropic' : undefined,
      oauthManager,
    };

    super(baseConfig);

    this.baseURL = baseURL;
    this.config = config;

    this.anthropic = new Anthropic({
      apiKey: apiKey || '', // Empty string if OAuth will be used
      baseURL,
      dangerouslyAllowBrowser: true,
    });

    this.toolFormatter = new ToolFormatter();
  }

  /**
   * Implementation of BaseProvider abstract method
   * Determines if this provider supports OAuth authentication
   */
  protected supportsOAuth(): boolean {
    // Anthropic supports OAuth authentication
    return true;
  }

  /**
   * Update the Anthropic client with resolved authentication if needed
   */
  private async updateClientWithResolvedAuth(): Promise<void> {
    const resolvedToken = await this.getAuthToken();
    if (!resolvedToken) {
      throw new Error('No authentication available for Anthropic API calls');
    }

    // Check if this is an OAuth token (starts with sk-ant-oat)
    const isOAuthToken = resolvedToken.startsWith('sk-ant-oat');

    if (isOAuthToken) {
      // For OAuth tokens, use authToken field which sends Bearer token
      // Don't pass apiKey at all - just authToken
      const oauthConfig: Record<string, unknown> = {
        authToken: resolvedToken, // Use authToken for OAuth Bearer tokens
        baseURL: this.baseURL,
        dangerouslyAllowBrowser: true,
        defaultHeaders: {
          'anthropic-beta': 'oauth-2025-04-20', // Still need the beta header
        },
      };

      this.anthropic = new Anthropic(oauthConfig as ClientOptions);
    } else {
      // Regular API key auth
      if (this.anthropic.apiKey !== resolvedToken) {
        this.anthropic = new Anthropic({
          apiKey: resolvedToken,
          baseURL: this.baseURL,
          dangerouslyAllowBrowser: true,
        });
      }
    }
  }

  async getModels(): Promise<IModel[]> {
    const authToken = await this.getAuthToken();
    if (!authToken) {
      // Return empty array if no auth - models aren't critical for operation
      console.warn('No authentication available for fetching Anthropic models');
      return [];
    }

    // Update client with resolved auth (handles OAuth vs API key)
    await this.updateClientWithResolvedAuth();

    // Check if using OAuth - the models.list endpoint doesn't work with OAuth tokens
    const isOAuthToken = authToken.startsWith('sk-ant-oat');

    if (isOAuthToken) {
      // For OAuth, return only the two working models
      console.log(
        '[OAuth] Using hardcoded model list for OAuth authentication',
      );
      return [
        {
          id: 'claude-opus-4-1-20250805',
          name: 'Claude Opus 4.1',
          provider: 'anthropic',
          supportedToolFormats: ['anthropic'],
          contextWindow: 500000,
          maxOutputTokens: 32000,
        },
        {
          id: 'claude-sonnet-4-20250514',
          name: 'Claude Sonnet 4',
          provider: 'anthropic',
          supportedToolFormats: ['anthropic'],
          contextWindow: 400000,
          maxOutputTokens: 64000,
        },
      ];
    }

    try {
      // Fetch models from Anthropic API (beta endpoint) - only for API keys
      const models: IModel[] = [];

      // Handle pagination
      for await (const model of this.anthropic.beta.models.list()) {
        models.push({
          id: model.id,
          name: model.display_name || model.id,
          provider: 'anthropic',
          supportedToolFormats: ['anthropic'],
          contextWindow: this.getContextWindowForModel(model.id),
          maxOutputTokens: this.getMaxTokensForModel(model.id),
        });
      }

      // Add "latest" aliases for Claude 4 tiers (opus, sonnet). We pick the newest
      // version of each tier based on the sorted order created above.
      const addLatestAlias = (tier: 'opus' | 'sonnet') => {
        const latest = models
          .filter((m) => m.id.startsWith(`claude-${tier}-4-`))
          .sort((a, b) => b.id.localeCompare(a.id))[0];
        if (latest) {
          models.push({
            ...latest,
            id: `claude-${tier}-4-latest`,
            name: latest.name.replace(/-\d{8}$/, '-latest'),
          });
        }
      };
      addLatestAlias('opus');
      addLatestAlias('sonnet');

      return models;
    } catch (error) {
      console.error('Failed to fetch Anthropic models:', error);
      return []; // Return empty array on error
    }
  }

  async *generateChatCompletion(
    messages: IMessage[],
    tools?: ITool[],
    _toolFormat?: string,
  ): AsyncIterableIterator<unknown> {
    const authToken = await this.getAuthToken();
    if (!authToken) {
      throw new Error(
        'Authentication required to generate Anthropic chat completions',
      );
    }

    // Update Anthropic client with resolved authentication if needed
    await this.updateClientWithResolvedAuth();

    let attemptCount = 0;

    const apiCall = async () => {
      attemptCount++;

      // Resolve model if it uses -latest alias
      const resolvedModel = await this.resolveLatestModel(this.currentModel);

      // Validate and fix message history to prevent tool_use/tool_result mismatches
      const validatedMessages =
        attemptCount > 1 ? this.validateAndFixMessages(messages) : messages;

      // Use the resolved model for the API call
      const modelForApi = resolvedModel;

      // Extract system message if present and handle tool responses
      let systemMessage: string | undefined;
      const anthropicMessages: Array<{
        role: 'user' | 'assistant';
        content:
          | string
          | Array<
              | { type: 'text'; text: string }
              | { type: 'tool_use'; id: string; name: string; input: unknown }
              | { type: 'tool_result'; tool_use_id: string; content: string }
            >;
      }> = [];

      for (const msg of validatedMessages) {
        if (msg.role === 'system') {
          systemMessage = msg.content;
        } else if (msg.role === 'tool') {
          // Anthropic expects tool responses as user messages with tool_result content
          anthropicMessages.push({
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: msg.tool_call_id || 'unknown',
                content: msg.content,
              },
            ],
          });
        } else if (msg.role === 'assistant' && msg.tool_calls) {
          // Handle assistant messages with tool calls
          const content: Array<
            | { type: 'text'; text: string }
            | { type: 'tool_use'; id: string; name: string; input: unknown }
          > = [];

          if (msg.content) {
            content.push({ type: 'text', text: msg.content });
          }

          for (const toolCall of msg.tool_calls) {
            content.push({
              type: 'tool_use',
              id: toolCall.id,
              name: toolCall.function.name,
              input: toolCall.function.arguments
                ? JSON.parse(toolCall.function.arguments)
                : {},
            });
          }

          anthropicMessages.push({
            role: 'assistant',
            content,
          });
        } else {
          // Regular user/assistant messages
          anthropicMessages.push({
            role: msg.role as 'user' | 'assistant',
            content: msg.content,
          });
        }
      }

      // Convert ITool[] to Anthropic's tool format if tools are provided
      const anthropicTools = tools
        ? this.toolFormatter.toProviderFormat(tools, 'anthropic')
        : undefined;

      // Create the stream with proper typing
      const createOptions: Parameters<
        typeof this.anthropic.messages.create
      >[0] = {
        model: modelForApi,
        messages: anthropicMessages,
        max_tokens: this.getMaxTokensForModel(resolvedModel),
        stream: true,
        ...this.modelParams,
      };

      // Add system message as top-level parameter if present
      // For OAuth, just send Claude Code spoof
      const authToken = await this.getAuthToken();
      const isOAuth = authToken && authToken.startsWith('sk-ant-oat');

      if (isOAuth) {
        createOptions.system =
          "You are Claude Code, Anthropic's official CLI for Claude.";
      } else if (systemMessage) {
        createOptions.system = systemMessage;
      }

      if (anthropicTools) {
        createOptions.tools = anthropicTools as Parameters<
          typeof this.anthropic.messages.create
        >[0]['tools'];
      }

      return this.anthropic.messages.create(createOptions) as Promise<
        Stream<Anthropic.MessageStreamEvent>
      >;
    };

    try {
      const stream = await retryWithBackoff(apiCall, {
        shouldRetry: (error: Error) => this.isRetryableError(error),
      });

      let currentUsage:
        | { input_tokens: number; output_tokens: number }
        | undefined;
      // Track current tool call being streamed
      let currentToolCall:
        | { id: string; name: string; input: string }
        | undefined;

      // Process the stream
      for await (const chunk of stream) {
        if (chunk.type === 'message_start') {
          // Initial usage info
          if (chunk.message.usage) {
            const usage = chunk.message.usage;
            if (usage.input_tokens !== null && usage.output_tokens !== null) {
              currentUsage = {
                input_tokens: usage.input_tokens,
                output_tokens: usage.output_tokens,
              };
              yield {
                role: 'assistant',
                content: '',
                usage: {
                  prompt_tokens: currentUsage.input_tokens,
                  completion_tokens: currentUsage.output_tokens,
                  total_tokens:
                    currentUsage.input_tokens + currentUsage.output_tokens,
                },
              } as IMessage;
            }
          }
        } else if (chunk.type === 'content_block_start') {
          // Handle tool use blocks
          if (chunk.content_block.type === 'tool_use') {
            currentToolCall = {
              id: chunk.content_block.id,
              name: chunk.content_block.name,
              input: '',
            };
          }
        } else if (chunk.type === 'content_block_delta') {
          // Yield content chunks
          if (chunk.delta.type === 'text_delta') {
            yield {
              role: 'assistant',
              content: chunk.delta.text,
            } as IMessage;
          } else if (
            chunk.delta.type === 'input_json_delta' &&
            currentToolCall
          ) {
            // Handle input deltas for tool calls
            currentToolCall.input += chunk.delta.partial_json;
          }
        } else if (chunk.type === 'content_block_stop') {
          // Complete the tool call
          if (currentToolCall) {
            const toolCallResult = this.toolFormatter.fromProviderFormat(
              {
                id: currentToolCall.id,
                type: 'tool_use',
                name: currentToolCall.name,
                input: currentToolCall.input
                  ? JSON.parse(currentToolCall.input)
                  : undefined,
              },
              'anthropic',
            );
            yield {
              role: 'assistant',
              content: '',
              tool_calls: toolCallResult,
            } as IMessage;
            currentToolCall = undefined;
          }
        } else if (chunk.type === 'message_delta') {
          // Update usage if provided
          if (
            chunk.usage &&
            chunk.usage.input_tokens !== null &&
            chunk.usage.output_tokens !== null
          ) {
            currentUsage = {
              input_tokens: chunk.usage.input_tokens,
              output_tokens: chunk.usage.output_tokens,
            };
            yield {
              role: 'assistant',
              content: '',
              usage: {
                prompt_tokens: currentUsage.input_tokens,
                completion_tokens: currentUsage.output_tokens,
                total_tokens:
                  currentUsage.input_tokens + currentUsage.output_tokens,
              },
            } as IMessage;
          }
        } else if (chunk.type === 'message_stop') {
          // Final usage info
          if (currentUsage) {
            yield {
              role: 'assistant',
              content: '',
              usage: {
                prompt_tokens: currentUsage.input_tokens,
                completion_tokens: currentUsage.output_tokens,
                total_tokens:
                  currentUsage.input_tokens + currentUsage.output_tokens,
              },
            } as IMessage;
          }
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Anthropic API error: ${errorMessage}`);
    }
  }

  setApiKey(apiKey: string): void {
    // Call base provider implementation
    super.setApiKey?.(apiKey);

    // Create a new Anthropic client with the updated API key
    this.anthropic = new Anthropic({
      apiKey,
      baseURL: this.baseURL,
      dangerouslyAllowBrowser: true,
    });
  }

  setBaseUrl(baseUrl?: string): void {
    // If no baseUrl is provided, clear to default (undefined)
    this.baseURL = baseUrl && baseUrl.trim() !== '' ? baseUrl : undefined;

    // Call base provider implementation
    super.setBaseUrl?.(baseUrl);

    // Create a new Anthropic client with the updated (or cleared) base URL
    // Will be updated with actual token in updateClientWithResolvedAuth
    this.anthropic = new Anthropic({
      apiKey: '', // Empty string, will be replaced when auth is resolved
      baseURL: this.baseURL,
      dangerouslyAllowBrowser: true,
    });
  }

  setModel(modelId: string): void {
    this.currentModel = modelId;
  }

  getCurrentModel(): string {
    return this.currentModel;
  }

  /**
   * Helper method to get the latest Claude 4 model ID for a given tier.
   * This can be used when you want to ensure you're using the latest model.
   * @param tier - The model tier: 'opus', 'sonnet', or 'haiku'
   * @returns The latest model ID for that tier
   */
  getLatestClaude4Model(tier: 'opus' | 'sonnet' | 'haiku' = 'sonnet'): string {
    switch (tier) {
      case 'opus':
        return 'claude-opus-4-latest';
      case 'sonnet':
        return 'claude-sonnet-4-latest';
      case 'haiku':
        // Haiku 4 not yet available, but future-proofed
        return 'claude-haiku-4-latest';
      default:
        return 'claude-sonnet-4-latest';
    }
  }

  /**
   * Resolves a model ID that may contain "-latest" to the actual model ID.
   * Caches the result to avoid frequent API calls.
   */
  private async resolveLatestModel(modelId: string): Promise<string> {
    // If it's not a latest alias, return as-is
    if (!modelId.endsWith('-latest')) {
      return modelId;
    }

    // Check cache
    const now = Date.now();
    if (
      this.modelCache &&
      now - this.modelCache.timestamp < this.modelCacheTTL
    ) {
      // Find the corresponding model from cache
      const model = this.modelCache.models.find((m) => m.id === modelId);
      if (model) {
        // The latest aliases are synthetic, find the real model
        const tier = modelId.includes('opus') ? 'opus' : 'sonnet';
        const realModel = this.modelCache.models
          .filter(
            (m) =>
              m.id.startsWith(`claude-${tier}-4-`) && !m.id.endsWith('-latest'),
          )
          .sort((a, b) => b.id.localeCompare(a.id))[0];
        return realModel ? realModel.id : modelId;
      }
    }

    try {
      // Ensure client has proper auth before calling getModels
      await this.updateClientWithResolvedAuth();

      // Fetch fresh models
      const models = await this.getModels();
      this.modelCache = { models, timestamp: now };

      // Find the real model for this latest alias
      const tier = modelId.includes('opus') ? 'opus' : 'sonnet';
      const realModel = models
        .filter(
          (m) =>
            m.id.startsWith(`claude-${tier}-4-`) && !m.id.endsWith('-latest'),
        )
        .sort((a, b) => b.id.localeCompare(a.id))[0];

      return realModel ? realModel.id : modelId;
    } catch (_error) {
      // If we can't fetch models, just use simple fallback like Claude Code does
      console.log(
        'Failed to fetch models for latest resolution, using fallback',
      );
      if (modelId.includes('opus')) {
        return 'opus';
      } else {
        return 'sonnet'; // Default to sonnet like Claude Code
      }
    }
  }

  private getMaxTokensForModel(modelId: string): number {
    // Handle latest aliases explicitly
    if (
      modelId === 'claude-opus-4-latest' ||
      modelId.includes('claude-opus-4')
    ) {
      return 32000;
    }
    if (
      modelId === 'claude-sonnet-4-latest' ||
      modelId.includes('claude-sonnet-4')
    ) {
      return 64000;
    }

    // Try to match model patterns
    for (const { pattern, tokens } of this.modelTokenPatterns) {
      if (pattern.test(modelId)) {
        return tokens;
      }
    }

    // Default for unknown models
    return 4096;
  }

  private getContextWindowForModel(modelId: string): number {
    // Claude 4 models have larger context windows
    if (modelId.includes('claude-opus-4')) {
      return 500000;
    }
    if (modelId.includes('claude-sonnet-4')) {
      return 400000;
    }
    // Claude 3.7 models
    if (modelId.includes('claude-3-7')) {
      return 300000;
    }
    // Default for Claude 3.x models
    return 200000;
  }

  private isRetryableError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;

    const errorMessage = error.message.toLowerCase();

    if (error.message.includes('rate_limit_error')) return true;

    // Check for Anthropic-specific error patterns
    if (error.message.includes('Anthropic API error:')) {
      // Extract the actual error content
      const match = error.message.match(/{"type":"error","error":({.*})}/);
      if (match) {
        try {
          const errorData = JSON.parse(match[1]);
          const errorType = errorData.type?.toLowerCase() || '';
          const errorMsg = errorData.message?.toLowerCase() || '';

          return this.retryableErrorMessages.some(
            (retryable) =>
              errorType.includes(retryable) || errorMsg.includes(retryable),
          );
        } catch {
          // If parsing fails, fall back to string matching
        }
      }
    }

    // Direct error message checking
    return this.retryableErrorMessages.some((msg) =>
      errorMessage.includes(msg),
    );
  }

  /**
   * Validates and potentially fixes the message history to ensure proper tool_use/tool_result pairing.
   * This prevents the "tool_use ids were found without tool_result blocks" error after a failed request.
   */
  private validateAndFixMessages(messages: IMessage[]): IMessage[] {
    const fixedMessages: IMessage[] = [];
    let pendingToolCalls: Array<{ id: string; name: string }> = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      if (msg.role === 'assistant' && msg.tool_calls) {
        // Track tool calls from assistant
        fixedMessages.push(msg);
        pendingToolCalls = msg.tool_calls.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
        }));
      } else if (msg.role === 'tool' && pendingToolCalls.length > 0) {
        // Match tool results with pending tool calls
        fixedMessages.push(msg);
        // Remove the matched tool call
        pendingToolCalls = pendingToolCalls.filter(
          (tc) => tc.id !== msg.tool_call_id,
        );
      } else if (
        msg.role === 'assistant' ||
        msg.role === 'user' ||
        msg.role === 'system'
      ) {
        // If we have pending tool calls and encounter a non-tool message,
        // we need to add dummy tool results to maintain consistency
        if (pendingToolCalls.length > 0 && msg.role !== 'system') {
          // Add dummy tool results for unmatched tool calls
          for (const toolCall of pendingToolCalls) {
            fixedMessages.push({
              role: 'tool' as const,
              tool_call_id: toolCall.id,
              content: 'Error: Tool execution was interrupted. Please retry.',
            } as IMessage);
          }
          pendingToolCalls = [];
        }
        fixedMessages.push(msg);
      } else {
        fixedMessages.push(msg);
      }
    }

    // Handle any remaining pending tool calls at the end
    if (pendingToolCalls.length > 0) {
      for (const toolCall of pendingToolCalls) {
        fixedMessages.push({
          role: 'tool' as const,
          tool_call_id: toolCall.id,
          content: 'Error: Tool execution was interrupted. Please retry.',
        } as IMessage);
      }
    }

    return fixedMessages;
  }

  /**
   * Anthropic always requires payment (API key or OAuth)
   */
  isPaidMode(): boolean {
    return true;
  }

  /**
   * Get the list of server tools supported by this provider
   */
  getServerTools(): string[] {
    return [];
  }

  /**
   * Invoke a server tool (native provider tool)
   */
  async invokeServerTool(
    _toolName: string,
    _params: unknown,
    _config?: unknown,
  ): Promise<unknown> {
    throw new Error('Server tools not supported by Anthropic provider');
  }

  /**
   * Set model parameters that will be merged into API calls
   * @param params Parameters to merge with existing, or undefined to clear all
   */
  setModelParams(params: Record<string, unknown> | undefined): void {
    if (params === undefined) {
      this.modelParams = undefined;
    } else {
      this.modelParams = { ...this.modelParams, ...params };
    }
  }

  /**
   * Get current model parameters
   * @returns Current parameters or undefined if not set
   */
  getModelParams(): Record<string, unknown> | undefined {
    return this.modelParams;
  }

  /**
   * Check if the provider is authenticated using any available method
   * Uses the base provider's isAuthenticated implementation
   */
  async isAuthenticated(): Promise<boolean> {
    return super.isAuthenticated();
  }
}
