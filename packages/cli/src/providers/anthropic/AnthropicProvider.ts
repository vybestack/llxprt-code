import Anthropic from '@anthropic-ai/sdk';
import { Stream } from '@anthropic-ai/sdk/streaming';
import { RawMessageStreamEvent } from '@anthropic-ai/sdk/resources/messages.js';
import { IProvider, IModel, ITool, IMessage } from '../IProvider.js';
import { ToolFormatter } from '../../tools/ToolFormatter.js';
import { ToolFormat } from '../../tools/IToolFormatter.js';

export class AnthropicProvider implements IProvider {
  name: string = 'anthropic';
  private anthropic: Anthropic;
  private toolFormatter: ToolFormatter;
  toolFormat: ToolFormat = 'anthropic';
  private apiKey: string;
  private baseURL?: string;
  private currentModel: string = 'claude-sonnet-4-latest'; // Default model using latest alias

  // Model cache for latest resolution
  private modelCache: { models: IModel[]; timestamp: number } | null = null;
  private readonly modelCacheTTL = 5 * 60 * 1000; // 5 minutes

  // Retry configuration
  private readonly maxRetries = 5;
  private readonly initialRetryDelay = 1000; // 1 second
  private readonly maxRetryDelay = 60000; // 60 seconds
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

  constructor(apiKey: string, baseURL?: string) {
    this.apiKey = apiKey;
    this.baseURL = baseURL;
    this.anthropic = new Anthropic({
      apiKey,
      baseURL,
    });
    this.toolFormatter = new ToolFormatter();
  }

  async getModels(): Promise<IModel[]> {
    try {
      // Fetch models from Anthropic API (beta endpoint)
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
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        // Resolve model if it uses -latest placeholder
        const resolvedModel = await this.resolveLatestModel(this.currentModel);

        // Validate and fix message history to prevent tool_use/tool_result mismatches
        const validatedMessages =
          attempt > 0 ? this.validateAndFixMessages(messages) : messages;

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
        };

        // Add system message as top-level parameter if present
        if (systemMessage) {
          createOptions.system = systemMessage;
        }

        if (anthropicTools) {
          createOptions.tools = anthropicTools as Parameters<
            typeof this.anthropic.messages.create
          >[0]['tools'];
        }

        const stream = (await this.anthropic.messages.create(
          createOptions,
        )) as Stream<RawMessageStreamEvent>;

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

        // If we reach here, the request was successful
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if this is a retryable error
        if (!this.isRetryableError(lastError)) {
          throw new Error(`Anthropic API error: ${lastError.message}`);
        }

        // Don't retry on the last attempt
        if (attempt === this.maxRetries - 1) {
          throw new Error(
            `Anthropic API error after ${this.maxRetries} attempts: ${lastError.message}`,
          );
        }

        // Calculate backoff delay
        const delay = this.calculateBackoff(attempt);
        console.error(
          `Anthropic API error (attempt ${attempt + 1}/${this.maxRetries}), retrying in ${delay}ms:`,
          lastError.message,
        );

        // Wait before retrying
        await this.sleep(delay);
      }
    }

    // This should never be reached, but just in case
    throw new Error(
      `Anthropic API error: ${lastError?.message || 'Unknown error'}`,
    );
  }

  setApiKey(apiKey: string): void {
    if (!apiKey || apiKey.trim() === '') {
      throw new Error('Anthropic API key is required');
    }

    this.apiKey = apiKey;
    // Create a new Anthropic client with the updated API key
    this.anthropic = new Anthropic({
      apiKey,
      baseURL: this.baseURL,
    });
  }

  setBaseUrl(baseUrl?: string): void {
    // If no baseUrl is provided, clear to default (undefined)
    this.baseURL = baseUrl && baseUrl.trim() !== '' ? baseUrl : undefined;
    // Create a new Anthropic client with the updated (or cleared) base URL
    this.anthropic = new Anthropic({
      apiKey: this.apiKey,
      baseURL: this.baseURL,
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

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async resolveLatestModel(modelId: string): Promise<string> {
    // Only resolve if it ends with -latest
    if (!modelId.endsWith('-latest')) {
      return modelId;
    }

    try {
      // Check cache first
      let models: IModel[];
      const now = Date.now();

      if (
        this.modelCache &&
        now - this.modelCache.timestamp < this.modelCacheTTL
      ) {
        models = this.modelCache.models;
      } else {
        // Fetch and cache models
        models = await this.getModels();
        this.modelCache = { models, timestamp: now };
      }

      // Extract the base pattern (e.g., "claude-sonnet-4" from "claude-sonnet-4-latest")
      const basePattern = modelId.replace('-latest', '');

      // Find all models matching the base pattern (excluding -latest aliases)
      const matchingModels = models
        .filter(
          (m) =>
            m.id.startsWith(basePattern + '-') && !m.id.endsWith('-latest'),
        )
        .map((m) => m.id)
        .sort((a, b) => {
          // Extract dates and sort descending (newest first)
          const dateA = a.split('-').pop() || '';
          const dateB = b.split('-').pop() || '';
          return dateB.localeCompare(dateA);
        });

      // Return the first (newest) match, or fall back
      if (matchingModels.length > 0) {
        console.log(`Resolved ${modelId} to ${matchingModels[0]}`);
        return matchingModels[0];
      }

      // If no matches found, return the original and let it fail properly
      console.warn(`Could not resolve ${modelId}, no Claude 4 models found`);
      return modelId;
    } catch (error) {
      // If resolution fails, return the original model ID
      console.warn(`Failed to resolve latest model for ${modelId}:`, error);
      return modelId;
    }
  }

  private calculateBackoff(attempt: number): number {
    // Exponential backoff with jitter
    const exponentialDelay = Math.min(
      this.initialRetryDelay * Math.pow(2, attempt),
      this.maxRetryDelay,
    );

    // Add jitter (±25% of the delay)
    const jitter = exponentialDelay * 0.25 * (Math.random() * 2 - 1);
    return Math.floor(exponentialDelay + jitter);
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
   * Anthropic always requires payment (API key)
   */
  isPaidMode(): boolean {
    return true;
  }
}
