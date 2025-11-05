/**
 * @plan PLAN-20251023-STATELESS-HARDENING.P08
 * @requirement REQ-SP2-001
 * @project-plans/debuglogging/requirements.md
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ClientOptions } from '@anthropic-ai/sdk';
import type {
  ToolUseBlock,
  TextDelta,
  InputJSONDelta,
} from '@anthropic-ai/sdk/resources/messages/index.js';
import { DebugLogger } from '../../debug/index.js';
import { IModel } from '../IModel.js';
import { ToolFormatter } from '../../tools/ToolFormatter.js';
import type { ToolFormat } from '../../tools/IToolFormatter.js';
import { IProviderConfig } from '../types/IProviderConfig.js';
import {
  BaseProvider,
  BaseProviderConfig,
  NormalizedGenerateChatOptions,
} from '../BaseProvider.js';
import { OAuthManager } from '../../auth/precedence.js';
import {
  IContent,
  ContentBlock,
  ToolCallBlock,
  ToolResponseBlock,
  TextBlock,
} from '../../services/history/IContent.js';
import {
  processToolParameters,
  logDoubleEscapingInChunk,
} from '../../tools/doubleEscapeUtils.js';
import { getCoreSystemPromptAsync } from '../../core/prompts.js';
import type { ProviderTelemetryContext } from '../types/providerRuntime.js';
import { resolveUserMemory } from '../utils/userMemory.js';
import {
  retryWithBackoff,
  getErrorStatus,
  isNetworkTransientError,
} from '../../utils/retry.js';
import { getSettingsService } from '../../settings/settingsServiceInstance.js';

export class AnthropicProvider extends BaseProvider {
  // @plan PLAN-20251023-STATELESS-HARDENING.P08
  // All properties are stateless - no runtime/client caches or constructor-captured config
  // @requirement REQ-SP4-002: Eliminate provider-level caching and memoization
  // @requirement REQ-SP4-003: Auth tokens resolved per call via NormalizedGenerateChatOptions

  // Model patterns for max output tokens - static configuration only
  private static modelTokenPatterns: Array<{
    pattern: RegExp;
    tokens: number;
  }> = [
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
      envKeyNames: ['ANTHROPIC_API_KEY'],
      isOAuthEnabled: !!oauthManager,
      oauthProvider: oauthManager ? 'anthropic' : undefined,
      oauthManager,
    };

    super(baseConfig, config);

    // @plan PLAN-20251023-STATELESS-HARDENING.P08
    // No logger instances stored as instance variables - create on demand
    // @requirement REQ-SP4-002: Eliminate constructor-captured config and user-memory
  }

  /**
   * Implementation of BaseProvider abstract method
   * Determines if this provider supports OAuth authentication
   */
  protected supportsOAuth(): boolean {
    // Anthropic supports OAuth authentication
    return true;
  }

  // @plan PLAN-20251023-STATELESS-HARDENING.P08
  // Create loggers on-demand to avoid instance state
  // @requirement REQ-SP4-002: Eliminate provider-level caching
  private getLogger() {
    return new DebugLogger('llxprt:anthropic:provider');
  }

  private getStreamingLogger() {
    return new DebugLogger('llxprt:anthropic:streaming');
  }

  private getToolsLogger() {
    return new DebugLogger('llxprt:anthropic:tools');
  }

  private getAuthLogger() {
    return new DebugLogger('llxprt:anthropic:auth');
  }

  private getErrorsLogger() {
    return new DebugLogger('llxprt:anthropic:errors');
  }

  private instantiateClient(authToken: string, baseURL?: string): Anthropic {
    const isOAuthToken = authToken.startsWith('sk-ant-oat');
    const clientConfig: Record<string, unknown> = {
      dangerouslyAllowBrowser: true,
    };

    if (baseURL && baseURL.trim() !== '') {
      clientConfig.baseURL = baseURL;
    }

    if (isOAuthToken) {
      clientConfig.authToken = authToken;
      clientConfig.defaultHeaders = {
        'anthropic-beta': 'oauth-2025-04-20',
      };
    } else {
      clientConfig.apiKey = authToken || '';
    }

    return new Anthropic(clientConfig as ClientOptions);
  }

  /**
   * @plan PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement REQ-SP4-002
   * @project-plans/20251023stateless4/analysis/pseudocode/provider-cache-elimination.md line 11
   * Build provider client per call with fresh SDK instance
   */
  private async buildProviderClient(
    options: NormalizedGenerateChatOptions,
    telemetry?: ProviderTelemetryContext,
  ): Promise<{ client: Anthropic; authToken: string }> {
    const authLogger = this.getAuthLogger();
    const runtimeAuthToken = options.resolved.authToken;
    let authToken: string | undefined;

    if (
      typeof runtimeAuthToken === 'string' &&
      runtimeAuthToken.trim() !== ''
    ) {
      authToken = runtimeAuthToken;
    } else if (
      runtimeAuthToken &&
      typeof runtimeAuthToken === 'object' &&
      'provide' in runtimeAuthToken &&
      typeof runtimeAuthToken.provide === 'function'
    ) {
      try {
        const freshToken = await runtimeAuthToken.provide();
        if (!freshToken) {
          throw new Error(
            `ProviderCacheError("Auth token unavailable for runtimeId=${options.runtime?.runtimeId} (REQ-SP4-003).")`,
          );
        }
        authToken = freshToken;
        authLogger.debug(() => 'Refreshed OAuth token for call');
      } catch (error) {
        throw new Error(
          `ProviderCacheError("Auth token unavailable for runtimeId=${options.runtime?.runtimeId} (REQ-SP4-003)."): ${error}`,
        );
      }
    }

    if (!authToken) {
      authToken = await this.getAuthToken();
    }

    if (!authToken) {
      authLogger.debug(
        () => 'No authentication available for Anthropic API calls',
      );
      throw new Error(
        'No authentication available for Anthropic API calls. Use /auth anthropic to re-authenticate or /auth anthropic logout to clear any expired session.',
      );
    }

    authLogger.debug(() => 'Creating fresh client instance (stateless)');
    const baseURL = options.resolved.baseURL;
    const client = this.instantiateClient(authToken, baseURL);

    telemetry?.record?.('stateless-provider.call', {
      providerName: 'anthropic',
      cacheEliminated: true,
    });

    return { client, authToken };
  }

  private createToolFormatter(): ToolFormatter {
    return new ToolFormatter();
  }

  /**
   * @plan PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement REQ-SP4-002
   * @project-plans/20251023stateless4/analysis/pseudocode/provider-cache-elimination.md line 15
   * No operation - stateless provider has no cache to clear
   */
  clearClientCache(_runtimeKey?: string): void {
    this.getLogger().debug(
      () => 'Cache clear called on stateless provider - no operation',
    );
  }

  override clearAuthCache(): void {
    this.getAuthLogger().debug(() => 'Clearing auth cache');
    super.clearAuthCache();
  }

  override async getModels(): Promise<IModel[]> {
    const authToken = await this.getAuthToken();
    if (!authToken) {
      this.getAuthLogger().debug(
        () =>
          'No authentication available for model listing, returning defaults',
      );
      // Return default models instead of throwing
      return this.getDefaultModels();
    }

    // Check if using OAuth - the models.list endpoint doesn't work with OAuth tokens
    const isOAuthToken = authToken.startsWith('sk-ant-oat');

    if (isOAuthToken) {
      // For OAuth, return only the working models
      this.getAuthLogger().debug(
        () => 'Using hardcoded model list for OAuth authentication',
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
          id: 'claude-opus-4-1',
          name: 'Claude Opus 4.1',
          provider: 'anthropic',
          supportedToolFormats: ['anthropic'],
          contextWindow: 500000,
          maxOutputTokens: 32000,
        },
        {
          id: 'claude-sonnet-4-5-20250929',
          name: 'Claude Sonnet 4.5',
          provider: 'anthropic',
          supportedToolFormats: ['anthropic'],
          contextWindow: 400000,
          maxOutputTokens: 64000,
        },
        {
          id: 'claude-sonnet-4-5',
          name: 'Claude Sonnet 4.5',
          provider: 'anthropic',
          supportedToolFormats: ['anthropic'],
          contextWindow: 400000,
          maxOutputTokens: 64000,
        },
        {
          id: 'claude-sonnet-4-20250514',
          name: 'Claude Sonnet 4',
          provider: 'anthropic',
          supportedToolFormats: ['anthropic'],
          contextWindow: 400000,
          maxOutputTokens: 64000,
        },
        {
          id: 'claude-sonnet-4',
          name: 'Claude Sonnet 4',
          provider: 'anthropic',
          supportedToolFormats: ['anthropic'],
          contextWindow: 400000,
          maxOutputTokens: 64000,
        },
        {
          id: 'claude-haiku-4-5-20251001',
          name: 'Claude Haiku 4.5',
          provider: 'anthropic',
          supportedToolFormats: ['anthropic'],
          contextWindow: 500000,
          maxOutputTokens: 16000,
        },
        {
          id: 'claude-haiku-4-5',
          name: 'Claude Haiku 4.5',
          provider: 'anthropic',
          supportedToolFormats: ['anthropic'],
          contextWindow: 500000,
          maxOutputTokens: 16000,
        },
      ];
    }

    try {
      // @plan PLAN-20251023-STATELESS-HARDENING.P08: Create fresh client for each operation
      // Fetch models from Anthropic API (beta endpoint) - only for API keys
      const models: IModel[] = [];
      const baseURL = this.getBaseURL();
      const client = this.instantiateClient(authToken, baseURL);

      this.getLogger().debug(() => 'Fetching models from Anthropic API');

      // Handle pagination
      for await (const model of client.beta.models.list()) {
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

      this.getLogger().debug(
        () => `Fetched ${models.length} models from Anthropic API`,
      );
      return models;
    } catch (error) {
      this.getErrorsLogger().debug(
        () => `Failed to fetch Anthropic models: ${error}`,
      );
      return []; // Return empty array on error
    }
  }

  override getCurrentModel(): string {
    // Always return from getDefaultModel - providers must not cache model state
    // @plan PLAN-20251023-STATELESS-HARDENING.P08 @requirement REQ-SP4-002
    const defaultModel = this.getDefaultModel();
    this.getLogger().debug(() => `Using default model: ${defaultModel}`);
    return defaultModel;
  }

  override getDefaultModel(): string {
    // Return hardcoded default - do NOT call getModel() to avoid circular dependency
    return 'claude-sonnet-4-5-20250929';
  }

  /**
   * Returns default model list when no authentication is available
   */
  private getDefaultModels(): IModel[] {
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
        id: 'claude-sonnet-4-5-20250929',
        name: 'Claude Sonnet 4.5',
        provider: 'anthropic',
        supportedToolFormats: ['anthropic'],
        contextWindow: 400000,
        maxOutputTokens: 64000,
      },
      {
        id: 'claude-haiku-4-5-20251001',
        name: 'Claude Haiku 4.5',
        provider: 'anthropic',
        supportedToolFormats: ['anthropic'],
        contextWindow: 500000,
        maxOutputTokens: 16000,
      },
    ];
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
    // @plan PLAN-20251023-STATELESS-HARDENING.P08: Use static instead of instance property
    for (const { pattern, tokens } of AnthropicProvider.modelTokenPatterns) {
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

  /**
   * Anthropic always requires payment (API key or OAuth)
   */
  override isPaidMode(): boolean {
    return true;
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
    throw new Error('Server tools not supported by Anthropic provider');
  }

  /**
   * Get current model parameters from SettingsService per call
   * @returns Current parameters or undefined if not set
   * @plan PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement REQ-SP4-003
   * Gets model parameters from SettingsService per call (stateless)
   */
  override getModelParams(): Record<string, unknown> | undefined {
    try {
      const settingsService = this.resolveSettingsService();
      const providerSettings = settingsService.getProviderSettings(this.name);

      const reservedKeys = new Set([
        'enabled',
        'apiKey',
        'api-key',
        'apiKeyfile',
        'api-keyfile',
        'baseUrl',
        'base-url',
        'model',
        'toolFormat',
        'tool-format',
        'toolFormatOverride',
        'tool-format-override',
        'defaultModel',
      ]);

      const params: Record<string, unknown> = {};
      if (providerSettings) {
        for (const [key, value] of Object.entries(providerSettings)) {
          if (reservedKeys.has(key) || value === undefined || value === null) {
            continue;
          }
          params[key] = value;
        }
      }

      return Object.keys(params).length > 0 ? params : undefined;
    } catch (error) {
      this.getLogger().debug(
        () =>
          `Failed to get Anthropic provider settings from SettingsService: ${error}`,
      );
      return undefined;
    }
  }

  /**
   * Check if the provider is authenticated using any available method
   * Uses the base provider's isAuthenticated implementation
   */
  override async isAuthenticated(): Promise<boolean> {
    return super.isAuthenticated();
  }

  /**
   * Detect the appropriate tool format for the current model/configuration
   * @returns The detected tool format
   */
  detectToolFormat(): ToolFormat {
    // @plan PLAN-20251023-STATELESS-HARDENING.P08: Don't reference deprecated instance fields
    // Tools format should be derived from runtime context only
    try {
      const settingsService = getSettingsService();

      // First check SettingsService for toolFormat override in provider settings
      // Note: This is synchronous access to cached settings, not async
      const currentSettings = settingsService['settings'];
      const providerSettings = currentSettings?.providers?.[this.name];
      const toolFormatOverride = providerSettings?.toolFormat as
        | ToolFormat
        | 'auto'
        | undefined;

      // If explicitly set to a specific format (not 'auto'), use it
      if (toolFormatOverride && toolFormatOverride !== 'auto') {
        return toolFormatOverride;
      }

      // Auto-detect based on model name if set to 'auto' or not set
      const modelName = this.getCurrentModel().toLowerCase();

      // Check for GLM models which require Qwen handling
      if (modelName.includes('glm-')) {
        return 'qwen';
      }

      // Check for qwen models
      if (modelName.includes('qwen')) {
        return 'qwen';
      }

      // Default to 'anthropic' format
      return 'anthropic';
    } catch (error) {
      this.getLogger().debug(
        () => `Failed to detect tool format from SettingsService: ${error}`,
      );

      // Fallback detection without SettingsService
      const modelName = this.getCurrentModel().toLowerCase();

      if (modelName.includes('glm-')) {
        return 'qwen';
      }

      if (modelName.includes('qwen')) {
        return 'qwen';
      }

      return 'anthropic';
    }
  }

  override getToolFormat(): ToolFormat {
    // Use the same detection logic as detectToolFormat()
    return this.detectToolFormat();
  }

  /**
   * Normalize tool IDs from various formats to Anthropic format
   * Handles IDs from OpenAI (call_xxx), Anthropic (toolu_xxx), and history (hist_tool_xxx)
   */
  private normalizeToAnthropicToolId(id: string): string {
    // If already in Anthropic format, return as-is
    if (id.startsWith('toolu_')) {
      return id;
    }

    // For history format, extract the UUID and add Anthropic prefix
    if (id.startsWith('hist_tool_')) {
      const uuid = id.substring('hist_tool_'.length);
      return 'toolu_' + uuid;
    }

    // For OpenAI format, extract the UUID and add Anthropic prefix
    if (id.startsWith('call_')) {
      const uuid = id.substring('call_'.length);
      return 'toolu_' + uuid;
    }

    // Unknown format - assume it's a raw UUID
    return 'toolu_' + id;
  }

  /**
   * Normalize tool IDs from Anthropic format to history format
   */
  private normalizeToHistoryToolId(id: string): string {
    // If already in history format, return as-is
    if (id.startsWith('hist_tool_')) {
      return id;
    }

    // For Anthropic format, extract the UUID and add history prefix
    if (id.startsWith('toolu_')) {
      const uuid = id.substring('toolu_'.length);
      return 'hist_tool_' + uuid;
    }

    // For OpenAI format, extract the UUID and add history prefix
    if (id.startsWith('call_')) {
      const uuid = id.substring('call_'.length);
      return 'hist_tool_' + uuid;
    }

    // Unknown format - assume it's a raw UUID
    return 'hist_tool_' + id;
  }

  /**
   * @plan PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement REQ-SP4-002, REQ-SP4-003
   * @project-plans/20251023stateless4/analysis/pseudocode/provider-cache-elimination.md line 11
   */
  protected override async *generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    const { client, authToken } = await this.buildProviderClient(
      options,
      options.resolved.telemetry,
    );
    const callFormatter = this.createToolFormatter();
    const { contents: content, tools } = options;
    // Convert IContent directly to Anthropic API format (no IMessage!)
    const anthropicMessages: Array<{
      role: 'user' | 'assistant';
      content:
        | string
        | Array<
            | { type: 'text'; text: string }
            | { type: 'tool_use'; id: string; name: string; input: unknown }
            | {
                type: 'tool_result';
                tool_use_id: string;
                content: string;
                is_error?: boolean;
              }
          >;
    }> = [];

    // Extract system message if present
    // let systemMessage: string | undefined;

    // Filter out orphaned tool responses at the beginning of the conversation
    // NOTE: These shouldn't be truly orphaned since the same history works with
    // OpenAI/Cerebras. Likely Anthropic has stricter formatting requirements
    // for tool responses that we're not fully meeting yet.
    let startIndex = 0;
    while (
      startIndex < content.length &&
      content[startIndex].speaker === 'tool'
    ) {
      this.getToolsLogger().debug(
        () => `Skipping orphaned tool response at beginning of conversation`,
      );
      startIndex++;
    }
    const filteredContent = content.slice(startIndex);

    // Group consecutive tool responses together for Anthropic API
    let pendingToolResults: Array<{
      type: 'tool_result';
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    }> = [];

    const flushToolResults = () => {
      if (pendingToolResults.length > 0) {
        anthropicMessages.push({
          role: 'user',
          content: pendingToolResults,
        });
        pendingToolResults = [];
      }
    };

    const serializeToolResult = (result: unknown): string | undefined => {
      if (result === undefined || result === null) {
        return undefined;
      }
      if (typeof result === 'string') {
        return result;
      }
      try {
        return JSON.stringify(result);
      } catch (error) {
        this.getToolsLogger().debug(
          () =>
            `Failed to stringify tool result, falling back to string conversion: ${error}`,
        );
        return String(result);
      }
    };

    const blocksToText = (blocks: ContentBlock[]): string => {
      let combined = '';
      for (const block of blocks) {
        if (block.type === 'text') {
          combined += block.text;
        } else if (block.type === 'code') {
          const language = block.language ? block.language : '';
          combined += `\n\n\u0060\u0060\u0060${language}\n${block.code}\n\u0060\u0060\u0060\n`;
        }
      }
      return combined.trimStart();
    };

    for (const c of filteredContent) {
      const toolResponseBlocks = c.blocks.filter(
        (b) => b.type === 'tool_response',
      ) as ToolResponseBlock[];
      const nonToolResponseBlocks = c.blocks.filter(
        (b) => b.type !== 'tool_response',
      );
      const toolTextContent = toolResponseBlocks.length
        ? blocksToText(nonToolResponseBlocks)
        : '';
      const onlyToolResponseContent =
        toolResponseBlocks.length > 0 &&
        nonToolResponseBlocks.every(
          (block) => block.type === 'text' || block.type === 'code',
        );

      if (toolResponseBlocks.length > 0) {
        for (const toolResponseBlock of toolResponseBlocks) {
          const serializedResult = serializeToolResult(
            toolResponseBlock.result,
          );
          let contentPayload = toolTextContent || serializedResult || '';

          if (!contentPayload) {
            contentPayload = '[empty tool result]';
          }

          const toolResult: {
            type: 'tool_result';
            tool_use_id: string;
            content: string;
            is_error?: boolean;
          } = {
            type: 'tool_result',
            tool_use_id: this.normalizeToAnthropicToolId(
              toolResponseBlock.callId,
            ),
            content: contentPayload,
          };

          if (toolResponseBlock.error) {
            toolResult.is_error = true;
          }

          pendingToolResults.push(toolResult);
        }
      }

      if (c.speaker === 'human') {
        const skipHumanMessage = onlyToolResponseContent;

        // Flush any pending tool results before adding a human message
        flushToolResults();

        if (skipHumanMessage) {
          continue;
        }

        const textBlock = c.blocks.find((b) => b.type === 'text') as
          | TextBlock
          | undefined;

        // Add text block as user message
        anthropicMessages.push({
          role: 'user',
          content: textBlock?.text || '',
        });
      } else if (c.speaker === 'ai') {
        // Flush any pending tool results before adding an AI message
        flushToolResults();
        const textBlocks = c.blocks.filter(
          (b) => b.type === 'text',
        ) as TextBlock[];
        const toolCallBlocks = c.blocks.filter(
          (b) => b.type === 'tool_call',
        ) as ToolCallBlock[];

        if (toolCallBlocks.length > 0) {
          // Build content array with text and tool_use blocks
          const contentArray: Array<
            | { type: 'text'; text: string }
            | { type: 'tool_use'; id: string; name: string; input: unknown }
          > = [];

          // Add text if present
          const contentText = textBlocks.map((b) => b.text).join('');
          if (contentText) {
            contentArray.push({ type: 'text', text: contentText });
          }

          // Add tool uses
          for (const tc of toolCallBlocks) {
            // Ensure parameters are an object, not a string
            let parametersObj = tc.parameters;
            if (typeof parametersObj === 'string') {
              try {
                parametersObj = JSON.parse(parametersObj);
              } catch (e) {
                this.getToolsLogger().debug(
                  () => `Failed to parse tool parameters as JSON: ${e}`,
                );
                parametersObj = {};
              }
            }
            contentArray.push({
              type: 'tool_use',
              id: this.normalizeToAnthropicToolId(tc.id),
              name: tc.name,
              input: parametersObj,
            });
          }

          anthropicMessages.push({
            role: 'assistant',
            content: contentArray,
          });
        } else {
          // Text-only message
          const contentText = textBlocks.map((b) => b.text).join('');
          anthropicMessages.push({
            role: 'assistant',
            content: contentText,
          });
        }
      } else if (c.speaker === 'tool') {
        if (toolResponseBlocks.length === 0) {
          throw new Error('Tool content must have a tool_response block');
        }
        if (onlyToolResponseContent) {
          // Content already captured in pending tool results
          continue;
        }
      } else {
        throw new Error(`Unknown speaker type: ${c.speaker}`);
      }
    }

    // Flush any remaining tool results at the end
    flushToolResults();

    // Validate that all tool_results have corresponding tool_uses
    // Anthropic requires strict pairing between tool_use and tool_result
    const toolUseIds = new Set<string>();
    const toolResultIds = new Set<string>();

    for (const msg of anthropicMessages) {
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_use') {
            toolUseIds.add(block.id);
          }
        }
      } else if (msg.role === 'user' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_result') {
            toolResultIds.add(block.tool_use_id);
          }
        }
      }
    }

    // Remove orphaned tool results (results without corresponding tool uses)
    const orphanedResults = Array.from(toolResultIds).filter(
      (id) => !toolUseIds.has(id),
    );
    if (orphanedResults.length > 0) {
      this.getToolsLogger().debug(
        () =>
          `Found ${orphanedResults.length} orphaned tool results, removing them`,
      );

      // Filter out messages that only contain orphaned tool results
      const filteredMessages = anthropicMessages.filter((msg) => {
        if (msg.role === 'user' && Array.isArray(msg.content)) {
          const filteredContent = msg.content.filter(
            (block) =>
              block.type !== 'tool_result' ||
              !orphanedResults.includes(block.tool_use_id),
          );
          if (filteredContent.length === 0) {
            // Remove empty user messages
            return false;
          }
          msg.content = filteredContent;
        }
        return true;
      });

      // Replace the messages array
      anthropicMessages.length = 0;
      anthropicMessages.push(...filteredMessages);
    }

    // Ensure the conversation starts with a valid message type
    // Anthropic requires the first message to be from the user
    if (anthropicMessages.length > 0 && anthropicMessages[0].role !== 'user') {
      // If the first message is not from the user, add a minimal user message
      this.getLogger().debug(
        () => `First message is not from user, adding placeholder user message`,
      );
      anthropicMessages.unshift({
        role: 'user',
        content: 'Continue the conversation',
      });
    }

    // Ensure we have at least one message
    if (anthropicMessages.length === 0) {
      anthropicMessages.push({
        role: 'user',
        content: 'Hello',
      });
    }

    // Detect if we need qwen-style parameter processing (for GLM-4.5, qwen models)
    // but ALWAYS use anthropic format for the tool structure sent to the API
    const detectedFormat = this.detectToolFormat();
    const needsQwenParameterProcessing = detectedFormat === 'qwen';

    // Convert Gemini format tools to anthropic format (always for Anthropic API)
    const anthropicTools = callFormatter.convertGeminiToFormat(
      tools,
      'anthropic', // Always use anthropic format for the API structure
    ) as
      | Array<{
          name: string;
          description: string;
          input_schema: {
            type: 'object';
            properties?: Record<string, unknown>;
            required?: string[];
          };
        }>
      | undefined;

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

    const isOAuth = authToken.startsWith('sk-ant-oat');

    // Get streaming setting from ephemeral settings (default: enabled)
    const streamingSetting =
      this.providerConfig?.getEphemeralSettings?.()?.['streaming'];
    const streamingEnabled = streamingSetting !== 'disabled';

    // Build request with proper typing
    const currentModel = options.resolved.model;

    // @plan PLAN-20251023-STATELESS-HARDENING.P08: Get userMemory from normalized runtime context
    const userMemory = await resolveUserMemory(
      options.userMemory,
      () => options.invocation?.userMemory,
    );

    // Derive model parameters on demand from ephemeral settings
    const configEphemeralSettings = options.invocation?.ephemerals ?? {};
    const requestOverrides =
      (configEphemeralSettings['anthropic'] as
        | Record<string, unknown>
        | undefined) || {};

    // For OAuth mode, inject core system prompt as the first human message
    if (isOAuth) {
      const corePrompt = await getCoreSystemPromptAsync(
        userMemory,
        currentModel,
        toolNamesForPrompt,
      );
      if (corePrompt) {
        anthropicMessages.unshift({
          role: 'user',
          content: `<system>\n${corePrompt}\n</system>\n\nUser provided conversation begins here:`,
        });
      }
    }

    const systemPrompt = !isOAuth
      ? await getCoreSystemPromptAsync(
          userMemory,
          currentModel,
          toolNamesForPrompt,
        )
      : undefined;
    const requestBody = {
      model: currentModel,
      messages: anthropicMessages,
      max_tokens: this.getMaxTokensForModel(currentModel),
      stream: streamingEnabled,
      ...requestOverrides, // Use derived ephemeral overrides instead of memoized instance state
      ...(isOAuth
        ? {
            system: "You are Claude Code, Anthropic's official CLI for Claude.",
          }
        : systemPrompt
          ? { system: systemPrompt }
          : {}),
      ...(anthropicTools && anthropicTools.length > 0
        ? { tools: anthropicTools }
        : {}),
    };

    // Debug log the tools being sent to Anthropic
    if (anthropicTools && anthropicTools.length > 0) {
      this.getToolsLogger().debug(
        () => `[AnthropicProvider] Sending tools to API:`,
        {
          toolCount: anthropicTools.length,
          toolNames: anthropicTools.map((t) => t.name),
          firstTool: anthropicTools[0],
          requestHasTools: 'tools' in requestBody,
        },
      );
    }

    // Make the API call with retry logic
    const customHeaders = this.getCustomHeaders();
    const apiCall = () =>
      customHeaders
        ? client.messages.create(
            requestBody as Parameters<typeof client.messages.create>[0],
            { headers: customHeaders },
          )
        : client.messages.create(
            requestBody as Parameters<typeof client.messages.create>[0],
          );

    const { maxAttempts, initialDelayMs } = this.getRetryConfig();
    const response = await retryWithBackoff(apiCall, {
      maxAttempts,
      initialDelayMs,
      shouldRetry: this.shouldRetryAnthropicResponse.bind(this),
      trackThrottleWaitTime: this.throttleTracker,
    });

    if (streamingEnabled) {
      // Handle streaming response - response is already a Stream when streaming is enabled
      const stream =
        response as unknown as AsyncIterable<Anthropic.MessageStreamEvent>;
      let currentToolCall:
        | { id: string; name: string; input: string }
        | undefined;

      this.getStreamingLogger().debug(() => 'Processing streaming response');

      for await (const chunk of stream) {
        if (chunk.type === 'content_block_start') {
          if (chunk.content_block.type === 'tool_use') {
            const toolBlock = chunk.content_block as ToolUseBlock;
            this.getStreamingLogger().debug(
              () => `Starting tool use: ${toolBlock.name}`,
            );
            currentToolCall = {
              id: toolBlock.id,
              name: toolBlock.name,
              input: '',
            };
          }
        } else if (chunk.type === 'content_block_delta') {
          if (chunk.delta.type === 'text_delta') {
            const textDelta = chunk.delta as TextDelta;
            this.getStreamingLogger().debug(
              () => `Received text delta: ${textDelta.text.length} chars`,
            );
            // Emit text immediately as IContent
            yield {
              speaker: 'ai',
              blocks: [{ type: 'text', text: textDelta.text }],
            } as IContent;
          } else if (
            chunk.delta.type === 'input_json_delta' &&
            currentToolCall
          ) {
            const jsonDelta = chunk.delta as InputJSONDelta;
            currentToolCall.input += jsonDelta.partial_json;

            // Check for double-escaping patterns
            logDoubleEscapingInChunk(
              jsonDelta.partial_json,
              currentToolCall.name,
              needsQwenParameterProcessing ? 'qwen' : 'anthropic',
            );
          }
        } else if (chunk.type === 'content_block_stop') {
          if (currentToolCall) {
            const activeToolCall = currentToolCall;
            this.getStreamingLogger().debug(
              () => `Completed tool use: ${activeToolCall.name}`,
            );
            // Process tool parameters with double-escape handling
            const processedParameters = processToolParameters(
              activeToolCall.input,
              activeToolCall.name,
              needsQwenParameterProcessing ? 'qwen' : 'anthropic',
            );

            yield {
              speaker: 'ai',
              blocks: [
                {
                  type: 'tool_call',
                  id: this.normalizeToHistoryToolId(activeToolCall.id),
                  name: activeToolCall.name,
                  parameters: processedParameters,
                },
              ],
            } as IContent;
            currentToolCall = undefined;
          }
        } else if (chunk.type === 'message_delta' && chunk.usage) {
          // Emit usage metadata
          this.getStreamingLogger().debug(() => `Received usage metadata`);
          yield {
            speaker: 'ai',
            blocks: [],
            metadata: {
              usage: {
                promptTokens: chunk.usage.input_tokens || 0,
                completionTokens: chunk.usage.output_tokens || 0,
                totalTokens:
                  (chunk.usage.input_tokens || 0) +
                  (chunk.usage.output_tokens || 0),
              },
            },
          } as IContent;
        }
      }
    } else {
      // Handle non-streaming response
      const message = response as Anthropic.Message;
      const blocks: ContentBlock[] = [];

      // Process content blocks
      for (const contentBlock of message.content) {
        if (contentBlock.type === 'text') {
          blocks.push({ type: 'text', text: contentBlock.text } as TextBlock);
        } else if (contentBlock.type === 'tool_use') {
          // Process tool parameters with double-escape handling
          const processedParameters = processToolParameters(
            JSON.stringify(contentBlock.input),
            contentBlock.name,
            needsQwenParameterProcessing ? 'qwen' : 'anthropic',
          );

          blocks.push({
            type: 'tool_call',
            id: this.normalizeToHistoryToolId(contentBlock.id),
            name: contentBlock.name,
            parameters: processedParameters,
          } as ToolCallBlock);
        }
      }

      // Build response IContent
      const result: IContent = {
        speaker: 'ai',
        blocks,
      };

      // Add usage metadata if present
      if (message.usage) {
        result.metadata = {
          usage: {
            promptTokens: message.usage.input_tokens,
            completionTokens: message.usage.output_tokens,
            totalTokens:
              message.usage.input_tokens + message.usage.output_tokens,
          },
        };
      }

      yield result;
    }
  }

  private getRetryConfig(): { maxAttempts: number; initialDelayMs: number } {
    const ephemeralSettings =
      this.providerConfig?.getEphemeralSettings?.() || {};
    const maxAttempts =
      (ephemeralSettings['retries'] as number | undefined) ?? 6;
    const initialDelayMs =
      (ephemeralSettings['retrywait'] as number | undefined) ?? 4000;
    return { maxAttempts, initialDelayMs };
  }

  private shouldRetryAnthropicResponse(error: unknown): boolean {
    const status = getErrorStatus(error);
    if (status === 429 || (status && status >= 500 && status < 600)) {
      this.getLogger().debug(
        () => `Will retry Anthropic request due to status ${status}`,
      );
      return true;
    }

    if (isNetworkTransientError(error)) {
      this.getLogger().debug(
        () =>
          'Will retry Anthropic request due to transient network error signature.',
      );
      return true;
    }

    return false;
  }
}
