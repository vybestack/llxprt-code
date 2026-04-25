/**
 * @plan PLAN-20251023-STATELESS-HARDENING.P08
 * @requirement REQ-SP2-001
 * @project-plans/debuglogging/requirements.md
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ClientOptions } from '@anthropic-ai/sdk';
import { DebugLogger } from '../../debug/index.js';
import { type IModel } from '../IModel.js';
import type { ToolFormat } from '../../tools/IToolFormatter.js';
import { TOOL_PREFIX } from './schemaConverter.js';
import { type IProviderConfig } from '../types/IProviderConfig.js';
import {
  BaseProvider,
  type BaseProviderConfig,
  type NormalizedGenerateChatOptions,
} from '../BaseProvider.js';
import { type OAuthManager } from '../../auth/precedence.js';
import type { IContent } from '../../services/history/IContent.js';
import type { ProviderTelemetryContext } from '../types/providerRuntime.js';
import { getSettingsService } from '../../settings/settingsServiceInstance.js';
import type { DumpMode } from '../utils/dumpContext.js';
import {
  type AnthropicRateLimitInfo,
  calculateWaitTime,
} from './AnthropicRateLimitHandler.js';
import { processAnthropicStream } from './AnthropicStreamProcessor.js';
import { parseAnthropicResponse } from './AnthropicResponseParser.js';
import {
  OAUTH_MODELS,
  DEFAULT_MODELS,
  getMaxTokensForModel as getMaxTokensForModelFn,
  getContextWindowForModel as getContextWindowForModelFn,
  getLatestClaude4Model as getLatestClaude4ModelFn,
} from './AnthropicModelData.js';
import { prepareAnthropicRequest } from './AnthropicRequestPreparation.js';
import {
  buildAnthropicCustomHeaders,
  createAnthropicApiCall,
  executeAnthropicApiCall,
} from './AnthropicApiExecution.js';

export class AnthropicProvider extends BaseProvider {
  // @plan PLAN-20251023-STATELESS-HARDENING.P08
  // All properties are stateless - no runtime/client caches or constructor-captured config
  // @requirement REQ-SP4-002: Eliminate provider-level caching and memoization
  // @requirement REQ-SP4-003: Auth tokens resolved per call via NormalizedGenerateChatOptions

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

    if (isOAuthToken) {
      clientConfig.authToken = authToken;
      clientConfig.defaultHeaders = {
        'anthropic-beta': 'oauth-2025-04-20, interleaved-thinking-2025-05-14',
      };
      if (baseURL && baseURL.trim() !== '') {
        clientConfig.baseURL = baseURL;
      }
    } else {
      clientConfig.apiKey = authToken || '';
      if (baseURL && baseURL.trim() !== '') {
        clientConfig.baseURL = baseURL;
      }
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

    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy check: empty string authToken should also trigger fallback
    if (!authToken) {
      authToken = await this.getAuthTokenForPrompt();
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
      return OAUTH_MODELS.map((m) => ({ ...m, provider: this.name }));
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
          provider: this.name,
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
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Anthropic provider response payloads.
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
    return DEFAULT_MODELS.map((m) => ({ ...m, provider: this.name }));
  }

  /**
   * Helper method to get the latest Claude 4 model ID for a given tier.
   * This can be used when you want to ensure you're using the latest model.
   * @param tier - The model tier: 'opus', 'sonnet', or 'haiku'
   * @returns The latest model ID for that tier
   */
  getLatestClaude4Model(tier: 'opus' | 'sonnet' | 'haiku' = 'sonnet'): string {
    return getLatestClaude4ModelFn(tier);
  }

  private getMaxTokensForModel(modelId: string): number {
    return getMaxTokensForModelFn(modelId);
  }

  private getContextWindowForModel(modelId: string): number {
    return getContextWindowForModelFn(modelId);
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

  override getToolFormat(): ToolFormat {
    const format = this.detectToolFormat();
    const logger = new DebugLogger('llxprt:provider:anthropic');
    logger.debug(() => `getToolFormat() called, returning: ${format}`, {
      provider: this.name,
      model: this.getModel(),
      format,
    });
    return format;
  }

  getRateLimitInfo(): AnthropicRateLimitInfo | undefined {
    return this.lastRateLimitInfo;
  }

  /**
   * Get current model parameters from SettingsService per call
   * @returns Current parameters or undefined if not set
   * @plan PLAN-20251023-STATELESS-HARDENING.P08
   * @plan PLAN-20260126-SETTINGS-SEPARATION.P09
   * @requirement REQ-SP4-003
   * Gets model parameters from SettingsService per call (stateless)
   * Now uses pre-separated modelParams from invocation context
   */
  override getModelParams(): Record<string, unknown> | undefined {
    return undefined;
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
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Anthropic provider response payloads.
      const providerSettings = currentSettings?.providers?.[this.name];
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Anthropic provider response payloads.
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

  private unprefixToolName(name: string, isOAuth: boolean): string {
    // Only unprefix for OAuth requests
    if (!isOAuth) {
      return name;
    }

    // Remove the prefix if it's present
    if (name.startsWith(TOOL_PREFIX)) {
      return name.substring(TOOL_PREFIX.length);
    }

    // Return as-is if no prefix
    return name;
  }

  /**
   * Find the JSON schema for a tool by name from the tools array.
   * Used for schema-aware parameter coercion (issue #1146).
   */
  private findToolSchema(
    tools:
      | Array<{
          functionDeclarations: Array<{
            name: string;
            parametersJsonSchema?: unknown;
          }>;
        }>
      | undefined,
    toolName: string,
    isOAuth: boolean,
  ): unknown {
    if (!tools) return undefined;

    // For OAuth, tool names in the tools array are prefixed (e.g., llxprt_read_file)
    // but toolName from the response is unprefixed (e.g., read_file)
    // So we need to unprefix the stored name before comparing
    for (const group of tools) {
      for (const decl of group.functionDeclarations) {
        const declName = isOAuth
          ? this.unprefixToolName(decl.name, true)
          : decl.name;
        if (declName === toolName) {
          return decl.parametersJsonSchema;
        }
      }
    }

    return undefined;
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
    const isOAuth = authToken.startsWith('sk-ant-oat');

    // Prepare full request context
    const requestContext = await prepareAnthropicRequest({
      content: options.contents,
      tools: options.tools,
      options,
      isOAuth,
      providerName: this.name,
      config: options.config ?? options.runtime?.config ?? this.globalConfig,
      getMaxTokensForModel: (m) => this.getMaxTokensForModel(m),
      unprefixToolName: (name, oauth) => this.unprefixToolName(name, oauth),
      providerConfig: this.providerConfig,
      logger: this.getLogger(),
      toolsLogger: this.getToolsLogger(),
      cacheLogger: this.getCacheLogger(),
    });

    // Build custom headers
    const customHeaders = buildAnthropicCustomHeaders({
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: getCustomHeaders returns Record<string, string> | undefined, empty object should fall through
      baseHeaders: this.getCustomHeaders() || {},
      isOAuth,
      wantCaching: requestContext.wantCaching,
      ttl: requestContext.ttl,
      cacheLogger: requestContext.cacheLogger,
    });

    // Proactive rate limit throttling — ephemeral settings:
    //   rate-limit-throttle: 'on' | 'off' (default 'on')
    //   rate-limit-throttle-threshold: number (default 5, percentage remaining)
    //   rate-limit-max-wait: number (default 60000, milliseconds)
    const rateLimitLogger = this.getRateLimitLogger();
    const waitDecision = calculateWaitTime(this.lastRateLimitInfo ?? {}, {
      throttleEnabled:
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Anthropic provider response payloads.
        (requestContext.configEphemerals['rate-limit-throttle'] as string) ??
        'on',
      thresholdPercentage:
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Anthropic provider response payloads.
        (requestContext.configEphemerals[
          'rate-limit-throttle-threshold'
        ] as number) ?? 5,
      maxWaitMs:
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Anthropic provider response payloads.
        (requestContext.configEphemerals['rate-limit-max-wait'] as number) ??
        60000,
    });
    if (waitDecision.shouldWait) {
      rateLimitLogger.debug(() => waitDecision.reason);
      await this.sleep(waitDecision.waitMs);
    }

    // Create reusable API call closure (used for both initial call and stream retries)
    const apiCallWithResponse = createAnthropicApiCall(
      initialClient,
      requestContext.requestBody,
      customHeaders,
    );

    // Execute API call with dump context handling
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Anthropic provider response payloads.
    const dumpMode = options.invocation?.ephemerals?.dumpcontext as
      | DumpMode
      | undefined;
    const baseURL =
      /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: multi-line || chain with terminator, baseURL is optional string */
      options.resolved.baseURL ||
      this.getBaseURL() ||
      'https://api.anthropic.com';
    /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

    const { response, rateLimitInfo } = await executeAnthropicApiCall({
      apiCallFn: apiCallWithResponse,
      dumpMode,
      baseURL,
      requestBody: requestContext.requestBody,
      streamingEnabled: requestContext.streamingEnabled,
      rateLimitLogger,
    });

    // Update rate limit state (already extracted and logged by executeAnthropicApiCall)
    if (rateLimitInfo) {
      this.lastRateLimitInfo = rateLimitInfo;
    }

    // Yield streaming or non-streaming results
    if (requestContext.streamingEnabled) {
      yield* processAnthropicStream(
        response as AsyncIterable<Anthropic.MessageStreamEvent>,
        {
          isOAuth,
          tools: options.tools,
          unprefixToolName: (name, oauth) => this.unprefixToolName(name, oauth),
          findToolSchema: (t, name, oauth) =>
            this.findToolSchema(t, name, oauth),
          maxAttempts: requestContext.maxAttempts,
          initialDelayMs: requestContext.initialDelayMs,
          apiCallWithResponse,
          logger: this.getStreamingLogger(),
          cacheLogger: requestContext.cacheLogger,
          rateLimitLogger,
        },
      );
    } else {
      yield parseAnthropicResponse(response as Anthropic.Message, {
        isOAuth,
        tools: options.tools,
        unprefixToolName: (name, oauth) => this.unprefixToolName(name, oauth),
        findToolSchema: (t, name, oauth) => this.findToolSchema(t, name, oauth),
        cacheLogger: requestContext.cacheLogger,
      });
    }
  }

  /**
   * Mockable sleep for rate-limit throttling.
   * Tests spy on this method to avoid real delays.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
