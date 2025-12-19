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
import { type IModel } from '../IModel.js';
import type { ToolFormat } from '../../tools/IToolFormatter.js';
import {
  convertToolsToAnthropic,
  type AnthropicTool,
} from './schemaConverter.js';
import { type IProviderConfig } from '../types/IProviderConfig.js';
import {
  BaseProvider,
  type BaseProviderConfig,
  type NormalizedGenerateChatOptions,
} from '../BaseProvider.js';
import {
  flushRuntimeAuthScope,
  type OAuthManager,
} from '../../auth/precedence.js';
import {
  type IContent,
  type ContentBlock,
  type ToolCallBlock,
  type ToolResponseBlock,
  type TextBlock,
  type ThinkingBlock,
} from '../../services/history/IContent.js';
import {
  processToolParameters,
  logDoubleEscapingInChunk,
} from '../../tools/doubleEscapeUtils.js';
import { getCoreSystemPromptAsync } from '../../core/prompts.js';
import type { ProviderTelemetryContext } from '../types/providerRuntime.js';
import { resolveUserMemory } from '../utils/userMemory.js';
import { buildToolResponsePayload } from '../utils/toolResponsePayload.js';
import {
  retryWithBackoff,
  getErrorStatus,
  isNetworkTransientError,
} from '../../utils/retry.js';
import { getSettingsService } from '../../settings/settingsServiceInstance.js';
import {
  shouldDumpSDKContext,
  dumpSDKContext,
} from '../utils/dumpSDKContext.js';
import type { DumpMode } from '../utils/dumpContext.js';

/**
 * Rate limit information from Anthropic API response headers
 */
export interface AnthropicRateLimitInfo {
  requestsLimit?: number;
  requestsRemaining?: number;
  requestsReset?: Date;
  tokensLimit?: number;
  tokensRemaining?: number;
  tokensReset?: Date;
  inputTokensLimit?: number;
  inputTokensRemaining?: number;
}

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

  // Rate limit state tracking - updated on each API response
  private lastRateLimitInfo?: AnthropicRateLimitInfo;

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

  private getCacheLogger() {
    return new DebugLogger('llxprt:anthropic:cache');
  }

  private getRateLimitLogger() {
    return new DebugLogger('llxprt:anthropic:ratelimit');
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
          id: 'claude-opus-4-5-20251101',
          name: 'Claude Opus 4.5',
          provider: 'anthropic',
          supportedToolFormats: ['anthropic'],
          contextWindow: 500000,
          maxOutputTokens: 32000,
        },
        {
          id: 'claude-opus-4-5',
          name: 'Claude Opus 4.5',
          provider: 'anthropic',
          supportedToolFormats: ['anthropic'],
          contextWindow: 500000,
          maxOutputTokens: 32000,
        },
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
        id: 'claude-opus-4-5-20251101',
        name: 'Claude Opus 4.5',
        provider: 'anthropic',
        supportedToolFormats: ['anthropic'],
        contextWindow: 500000,
        maxOutputTokens: 32000,
      },
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
   * Sort object keys alphabetically for stable JSON serialization
   * This prevents cache invalidation due to key order changes
   */
  private sortObjectKeys<T extends Record<string, unknown>>(obj: T): T {
    const sorted = Object.keys(obj)
      .sort()
      .reduce(
        (acc, key) => {
          acc[key] = obj[key];
          return acc;
        },
        {} as Record<string, unknown>,
      );
    return sorted as T;
  }

  /**
   * Merge beta headers, ensuring no duplicates
   */
  private mergeBetaHeaders(
    existing: string | undefined,
    addition: string,
  ): string {
    if (!existing) return addition;
    const parts = new Set(
      existing
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
    parts.add(addition);
    return Array.from(parts).join(', ');
  }

  /**
   * @plan PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement REQ-SP4-002, REQ-SP4-003
   * @project-plans/20251023stateless4/analysis/pseudocode/provider-cache-elimination.md line 11
   */
  protected override async *generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    // Build client and authToken. Client is used for initial requests;
    // after bucket failover, a new client is built with fresh credentials.
    // @plan PLAN-20251213issue686 Fix: client must be rebuilt after bucket failover
    const { client: initialClient, authToken } = await this.buildProviderClient(
      options,
      options.resolved.telemetry,
    );
    const { contents: content, tools } = options;

    // Read reasoning settings from options.settings (SettingsService) - same pattern as OpenAI
    // This is the correct way to access ephemeral settings that are applied via profiles
    const reasoningEnabled = options.settings.get('reasoning.enabled') as
      | boolean
      | undefined;
    const reasoningBudgetTokens = options.settings.get(
      'reasoning.budgetTokens',
    ) as number | undefined;
    const stripFromContext = options.settings.get(
      'reasoning.stripFromContext',
    ) as 'all' | 'allButLast' | 'none' | undefined;
    const includeInContext = options.settings.get(
      'reasoning.includeInContext',
    ) as boolean | undefined;

    // Debug log reasoning settings source
    this.getLogger().debug(
      () =>
        `[AnthropicProvider] Reasoning settings from options.settings: enabled=${String(reasoningEnabled)}, budgetTokens=${String(reasoningBudgetTokens)}, stripFromContext=${String(stripFromContext)}, includeInContext=${String(includeInContext)}`,
    );

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
            | { type: 'thinking'; thinking: string; signature?: string }
            | { type: 'redacted_thinking'; data: string }
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
    const filteredContentRaw = content.slice(startIndex);

    // Pre-process content to merge consecutive AI messages where one has only thinking
    // and the next has tool calls. This handles the case where thinking and tool calls
    // are streamed and stored separately during Anthropic Extended Thinking.
    const filteredContent: IContent[] = [];
    for (let i = 0; i < filteredContentRaw.length; i++) {
      const current = filteredContentRaw[i];
      const next =
        i + 1 < filteredContentRaw.length ? filteredContentRaw[i + 1] : null;

      if (
        reasoningEnabled &&
        current.speaker === 'ai' &&
        next &&
        next.speaker === 'ai'
      ) {
        // Check if current has ONLY thinking blocks and next has tool_call blocks
        const currentThinking = current.blocks.filter(
          (b) =>
            b.type === 'thinking' &&
            (b as ThinkingBlock).sourceField === 'thinking',
        );
        const currentOther = current.blocks.filter(
          (b) =>
            b.type !== 'thinking' ||
            (b as ThinkingBlock).sourceField !== 'thinking',
        );
        const nextToolCalls = next.blocks.filter((b) => b.type === 'tool_call');

        if (
          currentThinking.length > 0 &&
          currentOther.length === 0 &&
          nextToolCalls.length > 0
        ) {
          // Merge: combine thinking from current with all blocks from next
          this.getLogger().debug(
            () =>
              `[AnthropicProvider] Merging orphaned thinking block with subsequent tool_use message`,
          );
          filteredContent.push({
            ...next,
            blocks: [...currentThinking, ...next.blocks],
          });
          i++; // Skip the next item since we merged it
          continue;
        }
      }

      filteredContent.push(current);
    }

    // CRITICAL FIX: Check if there are tool calls in history without thinking blocks.
    // Anthropic's API requires ALL assistant messages to start with thinking/redacted_thinking
    // when thinking is enabled. Since our history system doesn't preserve thinking alongside
    // tool calls, we must DISABLE thinking for multi-turn conversations with tool calls
    // to avoid the API error "messages.1.content.0.type: Expected `thinking` or `redacted_thinking`"
    //
    // This is a workaround until thinking block preservation is fixed at the geminiChat level.
    let effectiveReasoningEnabled = reasoningEnabled;
    if (reasoningEnabled) {
      for (const c of filteredContent) {
        if (c.speaker === 'ai') {
          const hasToolCalls = c.blocks.some((b) => b.type === 'tool_call');
          const hasThinking = c.blocks.some(
            (b) =>
              b.type === 'thinking' &&
              (b as ThinkingBlock).sourceField === 'thinking',
          );

          // If this AI message has tool calls but NO thinking, we must disable thinking
          // to avoid API error
          if (hasToolCalls && !hasThinking) {
            this.getLogger().warn(
              () =>
                `[AnthropicProvider] Disabling extended thinking for this request: ` +
                `history contains tool calls without associated thinking blocks. ` +
                `This is a known limitation - thinking blocks are not preserved alongside tool calls in history.`,
            );
            effectiveReasoningEnabled = false;
            break;
          }
        }
      }
    }

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

    const configForMessages =
      options.config ?? options.runtime?.config ?? this.globalConfig;

    // Apply stripping policy to assistant messages with thinking blocks
    // Uses stripFromContext and includeInContext from options.settings (already read above)
    // IMPORTANT: For Anthropic Extended Thinking, we can't fully strip thinking blocks
    // because the API requires assistant messages to start with thinking/redacted_thinking
    // when thinking is enabled. Instead, we track which messages should be "redacted"
    // and convert their thinking blocks to redacted_thinking format.
    const processedContent: IContent[] = filteredContent;

    // Track which content indices should have their thinking redacted (not fully stripped)
    const redactedThinkingIndices = new Set<number>();

    // Determine if we need to redact thinking blocks
    const shouldStripAll =
      includeInContext === false || stripFromContext === 'all';
    const shouldStripAllButLast =
      includeInContext !== false && stripFromContext === 'allButLast';

    if (shouldStripAll || shouldStripAllButLast) {
      // Find all assistant messages with thinking blocks
      const assistantIndices: number[] = [];
      filteredContent.forEach((c, idx) => {
        if (c.speaker === 'ai' && c.blocks.some((b) => b.type === 'thinking')) {
          assistantIndices.push(idx);
        }
      });

      if (assistantIndices.length > 0) {
        // Mark messages for redaction instead of stripping
        assistantIndices.forEach((idx) => {
          let shouldRedact = false;
          if (shouldStripAll) {
            shouldRedact = true;
          } else if (shouldStripAllButLast) {
            const isLast =
              idx === assistantIndices[assistantIndices.length - 1];
            shouldRedact = !isLast;
          }

          if (shouldRedact) {
            redactedThinkingIndices.add(idx);
          }
        });
      }
    }

    for (
      let contentIndex = 0;
      contentIndex < processedContent.length;
      contentIndex++
    ) {
      const c = processedContent[contentIndex];
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
          const payload = buildToolResponsePayload(
            toolResponseBlock,
            configForMessages,
          );
          let contentPayload = toolTextContent
            ? `${toolTextContent}\n${payload.result}`
            : payload.result;

          if (payload.limitMessage) {
            contentPayload = contentPayload
              ? `${contentPayload}\n${payload.limitMessage}`
              : payload.limitMessage;
          }

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

          if (payload.status === 'error') {
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
        const thinkingBlocks = c.blocks.filter(
          (b) => b.type === 'thinking',
        ) as ThinkingBlock[];

        if (toolCallBlocks.length > 0 || thinkingBlocks.length > 0) {
          // Build content array with text, thinking/redacted_thinking, and tool_use blocks
          const contentArray: Array<
            | { type: 'text'; text: string }
            | { type: 'tool_use'; id: string; name: string; input: unknown }
            | { type: 'thinking'; thinking: string; signature?: string }
            | { type: 'redacted_thinking'; data: string }
          > = [];

          // Check if this message's thinking should be redacted (stripped but preserved as placeholder)
          const shouldRedactThinking =
            redactedThinkingIndices.has(contentIndex);

          // Add thinking blocks first
          // Only include thinking blocks with sourceField 'thinking' (Anthropic format)
          // When redacting, convert to redacted_thinking to satisfy Anthropic's API requirement
          // that assistant messages must start with thinking when thinking is enabled
          //
          // IMPORTANT: When thinking is enabled but the history has no thinking block for this
          // assistant message (e.g., thinking was stored separately due to streaming), we need to
          // look back at previous content items to find an orphaned thinking block to associate
          // with this tool_use message. Anthropic requires ALL assistant messages to start with
          // thinking/redacted_thinking when thinking mode is enabled.
          let anthropicThinkingBlocks = thinkingBlocks.filter(
            (tb) => tb.sourceField === 'thinking',
          );

          // If no thinking blocks found but we have tool calls and thinking is enabled,
          // look back at the previous content item for orphaned thinking blocks
          if (
            anthropicThinkingBlocks.length === 0 &&
            effectiveReasoningEnabled &&
            toolCallBlocks.length > 0 &&
            contentIndex > 0
          ) {
            const prevContent = processedContent[contentIndex - 1];
            if (prevContent.speaker === 'ai') {
              const prevThinkingBlocks = prevContent.blocks.filter(
                (b) =>
                  b.type === 'thinking' &&
                  (b as ThinkingBlock).sourceField === 'thinking',
              ) as ThinkingBlock[];
              // Check if prev content was ONLY thinking (no other content)
              const prevNonThinkingBlocks = prevContent.blocks.filter(
                (b) =>
                  b.type !== 'thinking' ||
                  (b as ThinkingBlock).sourceField !== 'thinking',
              );
              if (
                prevThinkingBlocks.length > 0 &&
                prevNonThinkingBlocks.length === 0
              ) {
                this.getLogger().debug(
                  () =>
                    `[AnthropicProvider] Found orphaned thinking block in previous content item, merging with tool_use message`,
                );
                anthropicThinkingBlocks = prevThinkingBlocks;
              }
            }
          }

          if (anthropicThinkingBlocks.length > 0) {
            // Process existing thinking blocks
            for (const tb of anthropicThinkingBlocks) {
              if (shouldRedactThinking) {
                // Use redacted_thinking with the signature as data
                // This satisfies Anthropic's requirement while saving tokens
                contentArray.push({
                  type: 'redacted_thinking',
                  data: tb.signature || '',
                });
              } else {
                contentArray.push({
                  type: 'thinking',
                  thinking: tb.thought,
                  signature: tb.signature,
                });
              }
            }
          }

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

    // Convert Gemini format tools to Anthropic format using provider-specific converter
    let anthropicTools = convertToolsToAnthropic(tools);

    // Stabilize tool ordering and JSON schema keys to prevent cache invalidation
    if (anthropicTools && anthropicTools.length > 0) {
      anthropicTools = [...anthropicTools]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((tool) => {
          const schema = tool.input_schema;
          if (schema.properties) {
            return {
              ...tool,
              input_schema: {
                ...schema,
                properties: this.sortObjectKeys(schema.properties),
              },
            };
          }
          return tool;
        }) as AnthropicTool[];
    }

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
    // Check invocation ephemerals first, then fall back to provider config
    const invocationEphemerals = options.invocation?.ephemerals ?? {};
    const streamingSetting =
      (invocationEphemerals['streaming'] as string | undefined) ??
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
    // Use invocation ephemerals for provider-specific request overrides (top_k, temperature, etc.)
    // This maintains backward compatibility with the existing invocation context flow
    const configEphemeralSettings = options.invocation?.ephemerals ?? {};
    const requestOverrides =
      (configEphemeralSettings['anthropic'] as
        | Record<string, unknown>
        | undefined) ?? {};

    // Get caching setting from options.settings or provider settings
    const providerSettings =
      options.settings.getProviderSettings(this.name) ?? {};
    const cachingSetting =
      (options.settings.get('prompt-caching') as
        | 'off'
        | '5m'
        | '1h'
        | undefined) ??
      (providerSettings['prompt-caching'] as 'off' | '5m' | '1h' | undefined) ??
      '1h';
    const wantCaching = cachingSetting !== 'off';
    const ttl = cachingSetting === '1h' ? '1h' : '5m';
    const cacheLogger = this.getCacheLogger();

    if (wantCaching) {
      cacheLogger.debug(() => `Prompt caching enabled with TTL: ${ttl}`);
    }

    // For OAuth mode, inject core system prompt as the first human message
    if (isOAuth) {
      const corePrompt = await getCoreSystemPromptAsync(
        userMemory,
        currentModel,
        toolNamesForPrompt,
      );
      if (corePrompt) {
        if (wantCaching) {
          anthropicMessages.unshift({
            role: 'user',
            content: [
              {
                type: 'text',
                text: `<system>\n${corePrompt}\n</system>\n\nUser provided conversation begins here:`,
                cache_control: { type: 'ephemeral', ttl } as {
                  type: 'ephemeral';
                  ttl?: '5m' | '1h';
                },
              } as { type: 'text'; text: string; cache_control?: unknown },
            ],
          });
          cacheLogger.debug(
            () => 'Added cache_control to OAuth system message',
          );
        } else {
          anthropicMessages.unshift({
            role: 'user',
            content: `<system>\n${corePrompt}\n</system>\n\nUser provided conversation begins here:`,
          });
        }
      }
    }

    // Build system field with caching support
    const systemPrompt = !isOAuth
      ? await getCoreSystemPromptAsync(
          userMemory,
          currentModel,
          toolNamesForPrompt,
        )
      : undefined;

    let systemField: Record<string, unknown> = {};
    if (isOAuth) {
      systemField = {
        system: "You are Claude Code, Anthropic's official CLI for Claude.",
      };
    } else if (systemPrompt) {
      if (wantCaching) {
        // Use array format with cache_control breakpoint
        systemField = {
          system: [
            {
              type: 'text',
              text: systemPrompt,
              cache_control: { type: 'ephemeral', ttl },
            },
          ],
        };
        cacheLogger.debug(
          () => `Added cache_control to system prompt (${ttl})`,
        );
      } else {
        // Use string format (no caching)
        systemField = { system: systemPrompt };
      }
    }

    // Note: reasoningEnabled and reasoningBudgetTokens are now read from options.settings
    // at the start of this method (using options.settings.get() pattern like OpenAI)

    const requestBody = {
      model: currentModel,
      messages: anthropicMessages,
      max_tokens: this.getMaxTokensForModel(currentModel),
      stream: streamingEnabled,
      ...requestOverrides, // Use derived ephemeral overrides instead of memoized instance state
      ...systemField,
      ...(anthropicTools && anthropicTools.length > 0
        ? { tools: anthropicTools }
        : {}),
      ...(effectiveReasoningEnabled
        ? {
            thinking: {
              type: 'enabled' as const,
              budget_tokens:
                (reasoningBudgetTokens as number | undefined) ?? 10000,
            },
          }
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

    // Debug log thinking blocks in messages
    const messagesWithThinking = anthropicMessages.filter(
      (m) =>
        m.role === 'assistant' &&
        Array.isArray(m.content) &&
        m.content.some((b) => (b as { type?: string }).type === 'thinking'),
    );
    if (messagesWithThinking.length > 0) {
      this.getLogger().debug(
        () =>
          `[AnthropicProvider] Messages with thinking blocks: ${messagesWithThinking.length}`,
      );
    }

    // Make the API call with retry logic
    let customHeaders = this.getCustomHeaders() || {};

    // For OAuth, always include the oauth beta header in customHeaders
    // to ensure it's not overridden by cache headers
    if (isOAuth) {
      const existingBeta = customHeaders['anthropic-beta'] as
        | string
        | undefined;
      customHeaders = {
        ...customHeaders,
        'anthropic-beta': this.mergeBetaHeaders(
          existingBeta,
          'oauth-2025-04-20',
        ),
      };
    }

    // Add extended-cache-ttl beta header for 1h caching
    if (wantCaching && ttl === '1h') {
      const existingBeta = customHeaders['anthropic-beta'] as
        | string
        | undefined;
      customHeaders = {
        ...customHeaders,
        'anthropic-beta': this.mergeBetaHeaders(
          existingBeta,
          'extended-cache-ttl-2025-04-11',
        ),
      };
      cacheLogger.debug(
        () => 'Added extended-cache-ttl-2025-04-11 beta header for 1h caching',
      );
    }

    const { maxAttempts, initialDelayMs } = this.getRetryConfig(
      configEphemeralSettings,
    );

    // Proactively throttle if approaching rate limits
    await this.waitForRateLimitIfNeeded(configEphemeralSettings);

    // Get dump mode from ephemeral settings
    const dumpMode = options.invocation?.ephemerals?.dumpcontext as
      | DumpMode
      | undefined;
    const shouldDumpSuccess = shouldDumpSDKContext(dumpMode, false);
    const shouldDumpError = shouldDumpSDKContext(dumpMode, true);

    // Prepare SDK dump request data if dumping is enabled
    const baseURL =
      options.resolved.baseURL ||
      this.getBaseURL() ||
      'https://api.anthropic.com';

    // Use withResponse() to access headers in both streaming and non-streaming modes
    const rateLimitLogger = this.getRateLimitLogger();

    let responseHeaders: Headers | undefined;
    let response:
      | Anthropic.Message
      | AsyncIterable<Anthropic.MessageStreamEvent>;

    // Track failover client - only rebuilt after bucket failover succeeds
    // The initialClient is created at the start of generateChatCompletionWithOptions
    // @plan PLAN-20251213issue686 Fix: client must be rebuilt after bucket failover
    let failoverClient: Anthropic | null = null;

    // Bucket failover callback for 429 errors
    // @plan PLAN-20251213issue686 Bucket failover integration for AnthropicProvider
    const logger = this.getLogger();
    const onPersistent429Callback = async (): Promise<boolean | null> => {
      // Try to get the bucket failover handler from runtime context config
      const failoverHandler =
        options.runtime?.config?.getBucketFailoverHandler();

      if (failoverHandler && failoverHandler.isEnabled()) {
        logger.debug(() => 'Attempting bucket failover on persistent 429');
        const success = await failoverHandler.tryFailover();
        if (success) {
          // Clear runtime-scoped auth cache so subsequent auth resolution can pick up the new bucket.
          if (typeof options.runtime?.runtimeId === 'string') {
            flushRuntimeAuthScope(options.runtime.runtimeId);
          }

          // Force re-resolution of the auth token after bucket failover.
          // BaseProvider caches the resolved token in options.resolved.authToken for the duration
          // of a call; we must refresh it so the rebuilt client uses the new bucket credentials.
          options.resolved.authToken = '';
          const refreshedAuthToken = await this.getAuthTokenForPrompt();
          options.resolved.authToken = refreshedAuthToken;

          // Rebuild client with fresh credentials from new bucket
          const { client: newClient } = await this.buildProviderClient(
            options,
            options.resolved.telemetry,
          );
          failoverClient = newClient;
          logger.debug(
            () =>
              `Bucket failover successful, new bucket: ${failoverHandler.getCurrentBucket()}`,
          );
          return true; // Signal retry with new bucket
        }
        logger.debug(
          () => 'Bucket failover failed - no more buckets available',
        );
        return false; // No more buckets, stop retrying
      }

      // No bucket failover configured
      return null;
    };

    // Use failover client if bucket failover happened, otherwise use initial client
    const apiCallWithResponse = async () => {
      const currentClient = failoverClient ?? initialClient;

      const apiCall = () =>
        Object.keys(customHeaders).length > 0
          ? currentClient.messages.create(
              requestBody as Parameters<
                typeof currentClient.messages.create
              >[0],
              { headers: customHeaders },
            )
          : currentClient.messages.create(
              requestBody as Parameters<
                typeof currentClient.messages.create
              >[0],
            );

      const promise = apiCall();
      // The promise has a withResponse() method we can call
      if (promise && typeof promise === 'object' && 'withResponse' in promise) {
        return (
          promise as {
            withResponse: () => Promise<{
              data:
                | Anthropic.Message
                | AsyncIterable<Anthropic.MessageStreamEvent>;
              response: Response;
            }>;
          }
        ).withResponse();
      }
      // Fallback if withResponse is not available
      return { data: await promise, response: undefined };
    };

    try {
      const result = await retryWithBackoff(apiCallWithResponse, {
        maxAttempts,
        initialDelayMs,
        shouldRetryOnError: this.shouldRetryAnthropicResponse.bind(this),
        trackThrottleWaitTime: this.throttleTracker,
        onPersistent429: onPersistent429Callback,
      });

      response = result.data;

      // Dump successful request if enabled
      if (shouldDumpSuccess) {
        await dumpSDKContext(
          'anthropic',
          '/v1/messages',
          requestBody,
          streamingEnabled ? { streaming: true } : response,
          false,
          baseURL,
        );
      }

      if (result.response) {
        responseHeaders = result.response.headers;

        // Extract and process rate limit headers
        const rateLimitInfo = this.extractRateLimitHeaders(responseHeaders);
        this.lastRateLimitInfo = rateLimitInfo;

        rateLimitLogger.debug(() => {
          const parts: string[] = [];
          if (
            rateLimitInfo.requestsRemaining !== undefined &&
            rateLimitInfo.requestsLimit !== undefined
          ) {
            parts.push(
              `requests=${rateLimitInfo.requestsRemaining}/${rateLimitInfo.requestsLimit}`,
            );
          }
          if (
            rateLimitInfo.tokensRemaining !== undefined &&
            rateLimitInfo.tokensLimit !== undefined
          ) {
            parts.push(
              `tokens=${rateLimitInfo.tokensRemaining}/${rateLimitInfo.tokensLimit}`,
            );
          }
          if (
            rateLimitInfo.inputTokensRemaining !== undefined &&
            rateLimitInfo.inputTokensLimit !== undefined
          ) {
            parts.push(
              `input_tokens=${rateLimitInfo.inputTokensRemaining}/${rateLimitInfo.inputTokensLimit}`,
            );
          }
          return parts.length > 0
            ? `Rate limits: ${parts.join(', ')}`
            : 'Rate limits: no data';
        });

        // Check and warn if approaching limits
        this.checkRateLimits(rateLimitInfo);
      }
    } catch (error) {
      // Dump error if enabled
      if (shouldDumpError) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        await dumpSDKContext(
          'anthropic',
          '/v1/messages',
          requestBody,
          { error: errorMessage },
          true,
          baseURL,
        );
      }

      // Re-throw the error
      throw error;
    }

    if (streamingEnabled) {
      // Handle streaming response - response is already a Stream when streaming is enabled
      const stream =
        response as unknown as AsyncIterable<Anthropic.MessageStreamEvent>;
      let currentToolCall:
        | { id: string; name: string; input: string }
        | undefined;
      let currentThinkingBlock:
        | { thinking: string; signature?: string }
        | undefined;

      this.getStreamingLogger().debug(() => 'Processing streaming response');

      try {
        for await (const chunk of stream) {
          if (chunk.type === 'message_start') {
            // Extract cache metrics from message_start event
            const usage = (
              chunk as unknown as {
                message?: {
                  usage?: {
                    input_tokens?: number;
                    output_tokens?: number;
                    cache_read_input_tokens?: number;
                    cache_creation_input_tokens?: number;
                  };
                };
              }
            ).message?.usage;
            if (usage) {
              const cacheRead = usage.cache_read_input_tokens ?? 0;
              const cacheCreation = usage.cache_creation_input_tokens ?? 0;

              cacheLogger.debug(
                () =>
                  `[AnthropicProvider streaming] Emitting usage metadata: cacheRead=${cacheRead}, cacheCreation=${cacheCreation}, raw values: cache_read_input_tokens=${usage.cache_read_input_tokens}, cache_creation_input_tokens=${usage.cache_creation_input_tokens}`,
              );

              if (cacheRead > 0 || cacheCreation > 0) {
                cacheLogger.debug(() => {
                  const hitRate =
                    cacheRead + (usage.input_tokens ?? 0) > 0
                      ? (cacheRead / (cacheRead + (usage.input_tokens ?? 0))) *
                        100
                      : 0;
                  return `Cache metrics: read=${cacheRead}, creation=${cacheCreation}, hit_rate=${hitRate.toFixed(1)}%`;
                });
              }

              yield {
                speaker: 'ai',
                blocks: [],
                metadata: {
                  usage: {
                    promptTokens: usage.input_tokens ?? 0,
                    completionTokens: usage.output_tokens ?? 0,
                    totalTokens:
                      (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
                    cache_read_input_tokens: cacheRead,
                    cache_creation_input_tokens: cacheCreation,
                  },
                },
              } as IContent;
            }
          } else if (chunk.type === 'content_block_start') {
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
            } else if (chunk.content_block.type === 'thinking') {
              this.getStreamingLogger().debug(() => 'Starting thinking block');
              currentThinkingBlock = {
                thinking: '',
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
                'anthropic',
              );
            } else if (
              chunk.delta.type === 'thinking_delta' &&
              currentThinkingBlock
            ) {
              const thinkingDelta = chunk.delta as {
                type: 'thinking_delta';
                thinking: string;
              };
              currentThinkingBlock.thinking += thinkingDelta.thinking;
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
                'anthropic',
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
            } else if (currentThinkingBlock) {
              const activeThinkingBlock = currentThinkingBlock;
              this.getStreamingLogger().debug(
                () =>
                  `Completed thinking block: ${activeThinkingBlock.thinking.length} chars`,
              );

              // Extract signature from content_block if present
              const contentBlock = (
                chunk as unknown as {
                  content_block?: {
                    type: string;
                    thinking?: string;
                    signature?: string;
                  };
                }
              ).content_block;
              if (contentBlock?.signature) {
                activeThinkingBlock.signature = contentBlock.signature;
              }

              yield {
                speaker: 'ai',
                blocks: [
                  {
                    type: 'thinking',
                    thought: activeThinkingBlock.thinking,
                    sourceField: 'thinking',
                    signature: activeThinkingBlock.signature,
                  } as ThinkingBlock,
                ],
              } as IContent;
              currentThinkingBlock = undefined;
            }
          } else if (chunk.type === 'message_delta' && chunk.usage) {
            // Emit usage metadata including cache fields
            const usage = chunk.usage as {
              input_tokens: number;
              output_tokens: number;
              cache_read_input_tokens?: number;
              cache_creation_input_tokens?: number;
            };

            const cacheRead = usage.cache_read_input_tokens ?? 0;
            const cacheCreation = usage.cache_creation_input_tokens ?? 0;

            this.getStreamingLogger().debug(
              () =>
                `Received usage metadata from message_delta: promptTokens=${usage.input_tokens || 0}, completionTokens=${usage.output_tokens || 0}, cacheRead=${cacheRead}, cacheCreation=${cacheCreation}`,
            );

            yield {
              speaker: 'ai',
              blocks: [],
              metadata: {
                usage: {
                  promptTokens: usage.input_tokens || 0,
                  completionTokens: usage.output_tokens || 0,
                  totalTokens:
                    (usage.input_tokens || 0) + (usage.output_tokens || 0),
                  cache_read_input_tokens: cacheRead,
                  cache_creation_input_tokens: cacheCreation,
                },
              },
            } as IContent;
          }
        }
      } catch (error) {
        // Streaming errors should be propagated for retry logic
        this.getStreamingLogger().debug(
          () => `Streaming iteration error: ${error}`,
        );
        throw error;
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
            'anthropic',
          );

          blocks.push({
            type: 'tool_call',
            id: this.normalizeToHistoryToolId(contentBlock.id),
            name: contentBlock.name,
            parameters: processedParameters,
          } as ToolCallBlock);
        } else if (contentBlock.type === 'thinking') {
          const thinkingContentBlock = contentBlock as {
            type: 'thinking';
            thinking: string;
            signature?: string;
          };
          blocks.push({
            type: 'thinking',
            thought: thinkingContentBlock.thinking,
            sourceField: 'thinking',
            signature: thinkingContentBlock.signature,
          } as ThinkingBlock);
        }
      }

      // Build response IContent
      const result: IContent = {
        speaker: 'ai',
        blocks,
      };

      // Add usage metadata if present
      if (message.usage) {
        const usage = message.usage as {
          input_tokens: number;
          output_tokens: number;
          cache_read_input_tokens?: number;
          cache_creation_input_tokens?: number;
        };

        const cacheRead = usage.cache_read_input_tokens ?? 0;
        const cacheCreation = usage.cache_creation_input_tokens ?? 0;

        cacheLogger.debug(
          () =>
            `[AnthropicProvider non-streaming] Setting usage metadata: cacheRead=${cacheRead}, cacheCreation=${cacheCreation}, raw values: cache_read_input_tokens=${usage.cache_read_input_tokens}, cache_creation_input_tokens=${usage.cache_creation_input_tokens}`,
        );

        if (cacheRead > 0 || cacheCreation > 0) {
          cacheLogger.debug(() => {
            const hitRate =
              cacheRead + usage.input_tokens > 0
                ? (cacheRead / (cacheRead + usage.input_tokens)) * 100
                : 0;
            return `Cache metrics: read=${cacheRead}, creation=${cacheCreation}, hit_rate=${hitRate.toFixed(1)}%`;
          });
        }

        result.metadata = {
          usage: {
            promptTokens: usage.input_tokens,
            completionTokens: usage.output_tokens,
            totalTokens: usage.input_tokens + usage.output_tokens,
            cache_read_input_tokens: cacheRead,
            cache_creation_input_tokens: cacheCreation,
          },
        };
      }

      yield result;
    }
  }

  private getRetryConfig(ephemeralSettings: Record<string, unknown> = {}): {
    maxAttempts: number;
    initialDelayMs: number;
  } {
    const maxAttempts =
      (ephemeralSettings['retries'] as number | undefined) ?? 6;
    const initialDelayMs =
      (ephemeralSettings['retrywait'] as number | undefined) ?? 4000;
    return { maxAttempts, initialDelayMs };
  }

  private shouldRetryAnthropicResponse(error: unknown): boolean {
    // Check for Anthropic-specific error types (overloaded_error)
    if (error && typeof error === 'object') {
      const errorObj = error as {
        error?: { type?: string; message?: string };
        type?: string;
      };
      const errorType = errorObj.error?.type || errorObj.type;

      if (errorType === 'overloaded_error') {
        this.getLogger().debug(
          () => 'Will retry Anthropic request due to overloaded_error',
        );
        return true;
      }
    }

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

  /**
   * Extract rate limit information from response headers
   */
  private extractRateLimitHeaders(headers: Headers): AnthropicRateLimitInfo {
    const rateLimitLogger = this.getRateLimitLogger();
    const info: AnthropicRateLimitInfo = {};

    // Extract requests rate limit info
    const requestsLimit = headers.get('anthropic-ratelimit-requests-limit');
    const requestsRemaining = headers.get(
      'anthropic-ratelimit-requests-remaining',
    );
    const requestsReset = headers.get('anthropic-ratelimit-requests-reset');

    if (requestsLimit) {
      info.requestsLimit = parseInt(requestsLimit, 10);
    }
    if (requestsRemaining) {
      info.requestsRemaining = parseInt(requestsRemaining, 10);
    }
    if (requestsReset) {
      try {
        const date = new Date(requestsReset);
        // Only set if the date is valid
        if (!isNaN(date.getTime())) {
          info.requestsReset = date;
        }
      } catch (_error) {
        rateLimitLogger.debug(
          () => `Failed to parse requests reset date: ${requestsReset}`,
        );
      }
    }

    // Extract tokens rate limit info
    const tokensLimit = headers.get('anthropic-ratelimit-tokens-limit');
    const tokensRemaining = headers.get('anthropic-ratelimit-tokens-remaining');
    const tokensReset = headers.get('anthropic-ratelimit-tokens-reset');

    if (tokensLimit) {
      info.tokensLimit = parseInt(tokensLimit, 10);
    }
    if (tokensRemaining) {
      info.tokensRemaining = parseInt(tokensRemaining, 10);
    }
    if (tokensReset) {
      try {
        const date = new Date(tokensReset);
        // Only set if the date is valid
        if (!isNaN(date.getTime())) {
          info.tokensReset = date;
        }
      } catch (_error) {
        rateLimitLogger.debug(
          () => `Failed to parse tokens reset date: ${tokensReset}`,
        );
      }
    }

    // Extract input tokens rate limit info
    const inputTokensLimit = headers.get(
      'anthropic-ratelimit-input-tokens-limit',
    );
    const inputTokensRemaining = headers.get(
      'anthropic-ratelimit-input-tokens-remaining',
    );

    if (inputTokensLimit) {
      info.inputTokensLimit = parseInt(inputTokensLimit, 10);
    }
    if (inputTokensRemaining) {
      info.inputTokensRemaining = parseInt(inputTokensRemaining, 10);
    }

    return info;
  }

  /**
   * Check rate limits and log warnings if approaching limits
   */
  private checkRateLimits(info: AnthropicRateLimitInfo): void {
    const rateLimitLogger = this.getRateLimitLogger();

    // Check requests rate limit (warn at 10% remaining)
    if (
      info.requestsLimit !== undefined &&
      info.requestsRemaining !== undefined
    ) {
      const percentage = (info.requestsRemaining / info.requestsLimit) * 100;
      if (percentage < 10) {
        const resetTime = info.requestsReset
          ? ` (resets at ${info.requestsReset.toISOString()})`
          : '';
        rateLimitLogger.debug(
          () =>
            `WARNING: Approaching requests rate limit - ${info.requestsRemaining}/${info.requestsLimit} remaining (${percentage.toFixed(1)}%)${resetTime}`,
        );
      }
    }

    // Check tokens rate limit (warn at 10% remaining)
    if (info.tokensLimit !== undefined && info.tokensRemaining !== undefined) {
      const percentage = (info.tokensRemaining / info.tokensLimit) * 100;
      if (percentage < 10) {
        const resetTime = info.tokensReset
          ? ` (resets at ${info.tokensReset.toISOString()})`
          : '';
        rateLimitLogger.debug(
          () =>
            `WARNING: Approaching tokens rate limit - ${info.tokensRemaining}/${info.tokensLimit} remaining (${percentage.toFixed(1)}%)${resetTime}`,
        );
      }
    }

    // Check input tokens rate limit (warn at 10% remaining)
    if (
      info.inputTokensLimit !== undefined &&
      info.inputTokensRemaining !== undefined
    ) {
      const percentage =
        (info.inputTokensRemaining / info.inputTokensLimit) * 100;
      if (percentage < 10) {
        rateLimitLogger.debug(
          () =>
            `WARNING: Approaching input tokens rate limit - ${info.inputTokensRemaining}/${info.inputTokensLimit} remaining (${percentage.toFixed(1)}%)`,
        );
      }
    }
  }

  /**
   * Get current rate limit information
   * Returns the last known rate limit state from the most recent API call
   */
  getRateLimitInfo(): AnthropicRateLimitInfo | undefined {
    return this.lastRateLimitInfo;
  }

  /**
   * Wait for rate limit reset if needed based on current rate limit state
   * This proactively throttles requests before they're made to prevent hitting rate limits
   * @private
   */
  private async waitForRateLimitIfNeeded(
    ephemeralSettings: Record<string, unknown>,
  ): Promise<void> {
    const rateLimitLogger = this.getRateLimitLogger();
    const info = this.lastRateLimitInfo;

    // No rate limit data yet - skip throttling
    if (!info) {
      return;
    }

    // Check if throttling is enabled (default: on)
    const throttleEnabled =
      (ephemeralSettings['rate-limit-throttle'] as string | undefined) ?? 'on';
    if (throttleEnabled === 'off') {
      return;
    }

    // Get threshold percentage (default: 5%)
    const thresholdPercentage =
      (ephemeralSettings['rate-limit-throttle-threshold'] as
        | number
        | undefined) ?? 5;

    // Get max wait time (default: 60 seconds)
    const maxWaitMs =
      (ephemeralSettings['rate-limit-max-wait'] as number | undefined) ?? 60000;

    const now = Date.now();

    // Check requests remaining
    if (
      info.requestsRemaining !== undefined &&
      info.requestsLimit !== undefined &&
      info.requestsReset
    ) {
      const percentage = (info.requestsRemaining / info.requestsLimit) * 100;

      if (percentage < thresholdPercentage) {
        const resetTime = info.requestsReset.getTime();
        const waitMs = resetTime - now;

        // Only wait if reset time is in the future
        if (waitMs > 0) {
          const actualWaitMs = Math.min(waitMs, maxWaitMs);

          rateLimitLogger.debug(
            () =>
              `Rate limit throttle: requests at ${percentage.toFixed(1)}% (${info.requestsRemaining}/${info.requestsLimit}), waiting ${actualWaitMs}ms until reset`,
          );

          if (waitMs > maxWaitMs) {
            rateLimitLogger.debug(
              () =>
                `Rate limit reset in ${waitMs}ms exceeds max wait of ${maxWaitMs}ms, capping wait time`,
            );
          }

          await this.sleep(actualWaitMs);
          return;
        }
      }
    }

    // Check tokens remaining
    if (
      info.tokensRemaining !== undefined &&
      info.tokensLimit !== undefined &&
      info.tokensReset
    ) {
      const percentage = (info.tokensRemaining / info.tokensLimit) * 100;

      if (percentage < thresholdPercentage) {
        const resetTime = info.tokensReset.getTime();
        const waitMs = resetTime - now;

        // Only wait if reset time is in the future
        if (waitMs > 0) {
          const actualWaitMs = Math.min(waitMs, maxWaitMs);

          rateLimitLogger.debug(
            () =>
              `Rate limit throttle: tokens at ${percentage.toFixed(1)}% (${info.tokensRemaining}/${info.tokensLimit}), waiting ${actualWaitMs}ms until reset`,
          );

          if (waitMs > maxWaitMs) {
            rateLimitLogger.debug(
              () =>
                `Rate limit reset in ${waitMs}ms exceeds max wait of ${maxWaitMs}ms, capping wait time`,
            );
          }

          await this.sleep(actualWaitMs);
          return;
        }
      }
    }

    // Check input tokens remaining
    if (
      info.inputTokensRemaining !== undefined &&
      info.inputTokensLimit !== undefined
    ) {
      const percentage =
        (info.inputTokensRemaining / info.inputTokensLimit) * 100;

      if (percentage < thresholdPercentage) {
        // For input tokens, we don't have a reset time, so we can only log a warning
        rateLimitLogger.debug(
          () =>
            `Rate limit warning: input tokens at ${percentage.toFixed(1)}% (${info.inputTokensRemaining}/${info.inputTokensLimit}), no reset time available`,
        );
      }
    }
  }

  /**
   * Sleep for the specified number of milliseconds
   * @private
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
