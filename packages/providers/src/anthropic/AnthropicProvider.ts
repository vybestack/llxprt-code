/**
 * @plan PLAN-20251023-STATELESS-HARDENING.P08
 * @requirement REQ-SP2-001
 * @project-plans/debuglogging/requirements.md
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ClientOptions } from '@anthropic-ai/sdk';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { delay } from '@vybestack/llxprt-code-core/utils/delay.js';
import { type IModel } from '../IModel.js';
import type { ToolFormat } from '@vybestack/llxprt-code-tools/IToolFormatter.js';
import { TOOL_PREFIX } from './schemaConverter.js';
import { type IProviderConfig } from '../types/IProviderConfig.js';
import {
  BaseProvider,
  type BaseProviderConfig,
  type NormalizedGenerateChatOptions,
} from '../BaseProvider.js';
import type { GenerateChatOptions } from '../IProvider.js';
import {
  type SystemPromptPlacement,
  requireAssembledSystemInstruction,
} from '../utils/systemPromptPlacement.js';
// @plan:PLAN-20260608-ISSUE1586.P15 — auth types from auth package
import { type OAuthManager } from '@vybestack/llxprt-code-auth';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  ProviderTelemetryContext,
  RuntimeAuthTokenProvider,
} from '../types/providerRuntime.js';
import type { DumpMode } from '../utils/dumpContext.js';
import {
  type AnthropicRateLimitInfo,
  calculateWaitTime,
} from './AnthropicRateLimitHandler.js';
import { processAnthropicStream } from './AnthropicStreamProcessor.js';
import { parseAnthropicResponse } from './AnthropicResponseParser.js';
import {
  DEFAULT_MODELS,
  getMaxTokensForModel as getMaxTokensForModelFn,
  getContextWindowForModel as getContextWindowForModelFn,
  getLatestClaudeModel as getLatestClaudeModelFn,
} from './AnthropicModelData.js';
import { prepareAnthropicRequest } from './AnthropicRequestPreparation.js';
import {
  isAnthropicOAuthBaseURL,
  ANTHROPIC_DEFAULT_BASE_URL,
} from './AnthropicEndpointUtils.js';
import { firstTruthyString } from '../utils/falsyFallback.js';
import type { PromptEnvelopeProjection } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { projectAnthropicPromptEnvelope } from '../runtime/promptEnvelopeProjections.js';
import {
  buildAnthropicCustomHeaders,
  createAnthropicApiCall,
  executeAnthropicApiCall,
} from './AnthropicApiExecution.js';
import { collectUnsupportedMedia } from '../utils/mediaUtils.js';

export class AnthropicProvider extends BaseProvider {
  // @plan PLAN-20251023-STATELESS-HARDENING.P08
  // All properties are stateless - no runtime/client caches or constructor-captured config
  // @requirement REQ-SP4-002: Eliminate provider-level caching and memoization
  // @requirement REQ-SP4-003: Auth tokens resolved per call via NormalizedGenerateChatOptions

  // Rate limit state tracking - updated on each API response
  private lastRateLimitInfo?: AnthropicRateLimitInfo;
  private readonly preparedPromptEnvelopes = new WeakMap<
    object,
    {
      readonly requestContext: Awaited<
        ReturnType<typeof prepareAnthropicRequest>
      >;
      readonly isOAuth: boolean;
      readonly authToken: string;
    }
  >();

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
      // Binding is by identity, not host: when an OAuth manager is supplied
      // (the `claudecode` subscription alias), the Anthropic protocol
      // implementation resolves tokens under the `claudecode` identity.
      oauthProvider: oauthManager ? 'claudecode' : undefined,
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

  /**
   * OAuth is only eligible when the effective base URL is Anthropic's own API
   * host. A third-party gateway (e.g. https://api.z.ai/api/anthropic) must never
   * trigger an Anthropic OAuth handshake against api.anthropic.com.
   */
  protected override isOAuthEligible(baseURL?: string): boolean {
    return isAnthropicOAuthBaseURL(baseURL);
  }

  /**
   * Classify whether a given auth token is an Anthropic OAuth token.
   * Anthropic OAuth tokens start with the 'sk-ant-oat' prefix.
   */
  protected override classifyOAuthToken(authToken: string): boolean {
    return authToken.startsWith('sk-ant-oat');
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
    const isOAuthToken = this.classifyOAuthToken(authToken);
    const clientConfig: Record<string, unknown> = {
      dangerouslyAllowBrowser: true,
      maxRetries: 0,
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

  private async resolveClientAuthToken(
    options: NormalizedGenerateChatOptions,
    preparedAuthToken: string | undefined,
  ): Promise<string> {
    if (preparedAuthToken !== undefined) {
      return preparedAuthToken;
    }

    const runtimeAuthToken: unknown = options.resolved.authToken;
    if (
      typeof runtimeAuthToken === 'string' &&
      runtimeAuthToken.trim() !== ''
    ) {
      return runtimeAuthToken;
    }
    if (!isRuntimeAuthTokenProvider(runtimeAuthToken)) {
      return this.getAuthTokenForPrompt();
    }

    try {
      const freshToken = await runtimeAuthToken.provide();
      if (!freshToken) {
        throw new Error(
          `ProviderCacheError("Auth token unavailable for runtimeId=${options.runtime?.runtimeId} (REQ-SP4-003).")`,
        );
      }
      this.getAuthLogger().debug(() => 'Refreshed OAuth token for call');
      return freshToken;
    } catch (error) {
      throw new Error(
        `ProviderCacheError("Auth token unavailable for runtimeId=${options.runtime?.runtimeId} (REQ-SP4-003)."): ${error}`,
      );
    }
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
    preparedAuthToken?: string,
  ): Promise<{ client: Anthropic; authToken: string }> {
    const authLogger = this.getAuthLogger();
    const authToken = await this.resolveClientAuthToken(
      options,
      preparedAuthToken,
    );
    const baseURL = options.resolved.baseURL;
    if (authToken === '') {
      authLogger.debug(
        () => 'No authentication available for Anthropic API calls',
      );
      // Third-party hosts must never be misdirected to Anthropic OAuth; they
      // require an explicit credential regardless of bound identity.
      if (!isAnthropicOAuthBaseURL(baseURL)) {
        throw new Error(
          `No API key resolved for Anthropic-compatible endpoint "${baseURL}". Configure an explicit credential (auth-key, auth-keyfile, or auth-key-name) for this profile; OAuth against api.anthropic.com is not used for third-party base URLs.`,
        );
      }
      // On the canonical Anthropic host, distinguish by bound identity: only
      // the `claudecode` subscription identity surfaces OAuth recovery; the
      // API-key-only `anthropic` identity is directed to /key or /keyfile.
      if (this.baseProviderConfig.oauthProvider === 'claudecode') {
        throw new Error(
          'No authentication available for Anthropic API calls. Run /auth claudecode login to authenticate (or /auth claudecode logout to clear any expired session).',
        );
      }
      throw new Error(
        'No Anthropic API key resolved. Set an API key with /key or /keyfile (or ANTHROPIC_API_KEY) to use the Anthropic API.',
      );
    }

    authLogger.debug(() => 'Creating fresh client instance (stateless)');
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

      // Add "latest" aliases for Claude tiers (opus, sonnet). We pick the newest
      // version of each tier (e.g. Sonnet 5 outranks Sonnet 4) based on the
      // sorted order created above.
      const addLatestAlias = (tier: 'opus' | 'sonnet') => {
        // Match any major version of the tier (e.g. claude-sonnet-4-*,
        // claude-sonnet-5, claude-sonnet-5-YYYYMMDD) so the alias tracks the
        // newest release rather than a single hardcoded generation.
        const tierRegex = new RegExp(`^claude-${tier}-(\\d+)`);
        const tierModels = models
          .filter((m) => tierRegex.test(m.id))
          .sort((a, b) => b.id.localeCompare(a.id));
        if (tierModels.length > 0) {
          const latest = tierModels[0];
          const majorVersion = tierRegex.exec(latest.id)?.[1] ?? '4';
          models.push({
            ...latest,
            id: `claude-${tier}-${majorVersion}-latest`,
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
    // Tool-format detection must use the active per-call model, not the
    // provider default, so Anthropic-compatible GLM/Qwen profiles serialize
    // tools with the expected dialect.
    const model = this.getModel();
    this.getLogger().debug(() => `Resolved current model: ${model}`);
    return model;
  }

  override getDefaultModel(): string {
    // Return hardcoded default - do NOT call getModel() to avoid circular dependency
    return 'claude-opus-5';
  }

  /**
   * Issue #3136: declare where the assembled system prompt may go.
   *
   * Under OAuth (`claudecode`) Anthropic REJECTS any request whose `system`
   * field carries content other than the Claude Code string, so the prompt
   * must be placed at the top of the context instead. This is a declaration
   * consumed by the shared placement policy, not a placement decision made
   * here.
   */
  getSystemPromptPlacement(
    options: GenerateChatOptions,
  ): SystemPromptPlacement {
    const authToken = options.resolved?.authToken;
    if (typeof authToken === 'string') {
      return this.classifyOAuthToken(authToken)
        ? 'context-prefix'
        : 'system-field';
    }
    // A RuntimeAuthTokenProvider is this provider's OAuth refresh mechanism
    // (see resolveClientAuthToken), so it resolves to an sk-ant-oat token at
    // request time. Treating it as system-field would put our prompt in the
    // reserved OAuth `system` field and Anthropic would reject the request.
    return isRuntimeAuthTokenProvider(authToken)
      ? 'context-prefix'
      : 'system-field';
  }

  /**
   * Returns default model list when no authentication is available
   */
  private getDefaultModels(): IModel[] {
    return DEFAULT_MODELS.map((m) => ({ ...m, provider: this.name }));
  }

  /**
   * Helper method to get the latest Claude model ID for a given tier.
   * This can be used when you want to ensure you're using the latest model.
   * @param tier - The model tier: 'opus', 'sonnet', or 'haiku'
   * @returns The latest model ID for that tier
   */
  getLatestClaudeModel(tier: 'opus' | 'sonnet' | 'haiku' = 'sonnet'): string {
    return getLatestClaudeModelFn(tier);
  }

  /**
   * @deprecated Use {@link getLatestClaudeModel} instead. The old name was
   * tied to the "Claude 4" generation; the helper now tracks the newest
   * release of each tier (e.g. Sonnet 5). Kept as a thin alias for backward
   * compatibility and will be removed in a future release.
   */
  getLatestClaude4Model(tier: 'opus' | 'sonnet' | 'haiku' = 'sonnet'): string {
    return this.getLatestClaudeModel(tier);
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
      const settingsService = this.resolveSettingsService();

      // First check SettingsService for toolFormat override in provider settings.
      const providerSettings = settingsService.getProviderSettings(this.name);

      const toolFormatOverride = providerSettings.toolFormat as
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
    // Issue #3136: the agent layer owns system-prompt assembly. Fail fast
    // before any request preparation so a missing instruction is never
    // silently transported as an empty prompt.
    requireAssembledSystemInstruction(options.systemInstruction);

    const prepared =
      options.promptEnvelopeTransportToken === undefined
        ? undefined
        : this.preparedPromptEnvelopes.get(
            options.promptEnvelopeTransportToken,
          );
    if (
      options.promptEnvelopeTransportToken !== undefined &&
      prepared === undefined
    ) {
      throw new Error('Unknown Anthropic prompt-envelope transport token');
    }
    const { client: initialClient, authToken } = await this.buildProviderClient(
      options,
      options.resolved.telemetry,
      prepared?.authToken,
    );
    const isOAuth = prepared?.isOAuth ?? this.classifyOAuthToken(authToken);
    const requestContext =
      prepared?.requestContext ??
      (await this.prepareRequestContext(options, isOAuth));

    const customHeaders = this.buildCustomHeaders(requestContext, isOAuth);

    const rateLimitLogger = this.getRateLimitLogger();
    await this.applyRateLimitThrottling(
      requestContext,
      rateLimitLogger,
      options.invocation.signal,
    );

    const apiCallWithResponse = createAnthropicApiCall(
      initialClient,
      requestContext.requestBody,
      customHeaders,
      options.invocation.signal,
    );

    const { response, rateLimitInfo } = await this.executeApiCall(
      options,
      requestContext,
      apiCallWithResponse,
      rateLimitLogger,
    );

    if (rateLimitInfo) {
      this.lastRateLimitInfo = rateLimitInfo;
    }

    yield* this.yieldResponse(
      response,
      requestContext,
      options,
      isOAuth,
      rateLimitLogger,
    );
  }

  private async prepareRequestContext(
    options: NormalizedGenerateChatOptions,
    isOAuth: boolean,
  ) {
    return prepareAnthropicRequest({
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
  }

  /**
   * Project the finalized Anthropic Messages envelope (issue #2817).
   *
   * Runs the SAME `prepareAnthropicRequest` path transport uses, so the
   * estimate is derived from the exact `requestBody` that will be sent. Request
   * preparation still resolves prompt-bearing inputs such as memory and tools,
   * but no client is constructed and no credential is exchanged. The OAuth
   * flavor only selects tool-name prefixing and cache formatting, so it is
   * derived from the already-resolved token when one is present.
   */
  async projectPromptEnvelope(
    options: GenerateChatOptions,
  ): Promise<PromptEnvelopeProjection> {
    const normalized = await this.normalizeOptionsForProjection(options);
    const authToken = await this.resolveProjectionAuthToken(normalized);
    const isOAuth = this.classifyOAuthToken(authToken);
    const requestContext = await this.prepareRequestContext(
      normalized,
      isOAuth,
    );
    const transportToken = Object.freeze({});
    this.preparedPromptEnvelopes.set(transportToken, {
      requestContext,
      isOAuth,
      authToken,
    });
    return projectAnthropicPromptEnvelope(requestContext.requestBody, {
      transportToken,
      unsupportedMedia: collectUnsupportedMedia(
        normalized.contents,
        (category) => category === 'image' || category === 'pdf',
      ),
    });
  }

  private buildCustomHeaders(
    requestContext: Awaited<ReturnType<typeof prepareAnthropicRequest>>,
    isOAuth: boolean,
  ) {
    return buildAnthropicCustomHeaders({
      baseHeaders: this.getCustomHeaders() ?? {},
      isOAuth,
      wantCaching: requestContext.wantCaching,
      ttl: requestContext.ttl,
      cacheLogger: requestContext.cacheLogger,
    });
  }

  private async applyRateLimitThrottling(
    requestContext: Awaited<ReturnType<typeof prepareAnthropicRequest>>,
    rateLimitLogger: { debug: (fn: () => string) => void },
    signal?: AbortSignal,
  ): Promise<void> {
    const waitDecision = calculateWaitTime(this.lastRateLimitInfo ?? {}, {
      throttleEnabled:
        (requestContext.configEphemerals['rate-limit-throttle'] as
          | string
          | undefined) ?? 'on',
      thresholdPercentage:
        (requestContext.configEphemerals['rate-limit-throttle-threshold'] as
          | number
          | undefined) ?? 5,
      maxWaitMs:
        (requestContext.configEphemerals['rate-limit-max-wait'] as
          | number
          | undefined) ?? 60000,
    });
    if (waitDecision.shouldWait) {
      rateLimitLogger.debug(() => waitDecision.reason);
      await this.sleep(waitDecision.waitMs, signal);
    }
  }

  private async executeApiCall(
    options: NormalizedGenerateChatOptions,
    requestContext: Awaited<ReturnType<typeof prepareAnthropicRequest>>,
    apiCallWithResponse: () => Promise<{
      data: Anthropic.Message | AsyncIterable<Anthropic.MessageStreamEvent>;
      response: Response | undefined;
    }>,
    rateLimitLogger: { debug: (fn: () => string) => void },
  ) {
    const dumpMode = options.invocation.ephemerals.dumpcontext as
      | DumpMode
      | undefined;
    const baseURL = firstTruthyString(
      options.resolved.baseURL,
      this.getBaseURL(),
      ANTHROPIC_DEFAULT_BASE_URL,
    );

    return executeAnthropicApiCall({
      apiCallFn: apiCallWithResponse,
      dumpMode,
      baseURL,
      requestBody: requestContext.requestBody,
      streamingEnabled: requestContext.streamingEnabled,
      rateLimitLogger,
    });
  }

  private async *yieldResponse(
    response: Anthropic.Message | AsyncIterable<Anthropic.MessageStreamEvent>,
    requestContext: Awaited<ReturnType<typeof prepareAnthropicRequest>>,
    options: NormalizedGenerateChatOptions,
    isOAuth: boolean,
    rateLimitLogger: { debug: (fn: () => string) => void },
  ): AsyncGenerator<IContent> {
    if (requestContext.streamingEnabled) {
      yield* processAnthropicStream(
        response as AsyncIterable<Anthropic.MessageStreamEvent>,
        {
          isOAuth,
          tools: options.tools,
          unprefixToolName: (name, oauth) => this.unprefixToolName(name, oauth),
          findToolSchema: (t, name, oauth) =>
            this.findToolSchema(t, name, oauth),
          logger: this.getStreamingLogger(),
          cacheLogger: requestContext.cacheLogger,
          rateLimitLogger,
          includeThinkingInResponse: requestContext.includeThinkingInResponse,
        },
      );
    } else {
      yield parseAnthropicResponse(response as Anthropic.Message, {
        isOAuth,
        tools: options.tools,
        unprefixToolName: (name, oauth) => this.unprefixToolName(name, oauth),
        findToolSchema: (t, name, oauth) => this.findToolSchema(t, name, oauth),
        cacheLogger: requestContext.cacheLogger,
        includeThinkingInResponse: requestContext.includeThinkingInResponse,
      });
    }
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return delay(ms, signal);
  }
}

// Re-exported from AnthropicEndpointUtils for backwards compatibility.
// Issue #2410: extracted to a standalone module to avoid a circular import
// between AnthropicProvider and AnthropicRequestPreparation.
export { isAnthropicOAuthBaseURL } from './AnthropicEndpointUtils.js';

function isRuntimeAuthTokenProvider(
  value: unknown,
): value is RuntimeAuthTokenProvider {
  return (
    typeof value === 'object' &&
    value !== null &&
    'provide' in value &&
    typeof value.provide === 'function'
  );
}
