/**
 * @plan PLAN-20251023-STATELESS-HARDENING.P08
 * @requirement REQ-SP2-001
 * @project-plans/debuglogging/requirements.md
 */

import { readInvocationPolicyRecord } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import {
  instantiateClient,
  isAnthropicMessageStream,
  withSemanticMediaPurgeCacheEvidence,
  type AnthropicTransportPreparation,
  type PreparedAnthropicPromptEnvelope,
} from './AnthropicProviderInternals.js';
import type Anthropic from '@anthropic-ai/sdk';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { delay } from '@vybestack/llxprt-code-core/utils/delay.js';
import { type IModel } from '../IModel.js';
import type { ToolFormat } from '@vybestack/llxprt-code-tools/IToolFormatter.js';
import { unprefixAnthropicToolName } from './schemaConverter.js';
import { type IProviderConfig } from '../types/IProviderConfig.js';
import {
  BaseProvider,
  type BaseProviderConfig,
  type NormalizedGenerateChatOptions,
} from '../BaseProvider.js';
import type { GenerateChatOptions } from '../IProvider.js';
import { declaredMediaTransportCapabilities } from '../providerMediaTransportCapabilities.js';
import {
  type SystemPromptPlacement,
  requireAssembledSystemInstruction,
  resolveSystemPromptPlacement,
} from '../utils/systemPromptPlacement.js';
import { isRuntimeAuthTokenProvider } from '../utils/authToken.js';
// @plan:PLAN-20260608-ISSUE1586.P15 — auth types from auth package
import { type OAuthManager } from '@vybestack/llxprt-code-auth';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderTelemetryContext } from '../types/providerRuntime.js';
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
import {
  type AnthropicPlanParams,
  type AnthropicRequestFacts,
} from './AnthropicRequestPreparation.js';
import {
  isAnthropicOAuthBaseURL,
  ANTHROPIC_DEFAULT_BASE_URL,
} from './AnthropicEndpointUtils.js';
import { findAnthropicToolSchema } from './AnthropicToolSchema.js';
import { firstTruthyString } from '../utils/falsyFallback.js';
import type { PromptEnvelopeProjection } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { projectAnthropicPromptEnvelopeFromSource } from '../runtime/promptEnvelopeProjections.js';
import {
  closeStagedRowsAfterFailure,
  readsRequestRowsAtTransport,
} from '../BaseProviderNormalization.js';
import {
  buildAnthropicRequestHeaders,
  withCredentialHeader,
  executeAnthropicApiCall,
  type AnthropicApiCall,
} from './AnthropicApiExecution.js';
import { reportRequestSize } from '../logging/requestSizeReport.js';
import {
  requestBodyForDump,
  sendRequestFromSpool,
  type AnthropicSendRequest,
} from './AnthropicSendRequest.js';
import {
  prepareAnthropicRequestRows,
  registerAnthropicRequestCleanup,
  type PreparedAnthropicRequest,
} from './native-anthropic-request.js';
import {
  createAnthropicMissingCredentialError,
  resolveAnthropicCredential,
} from './AnthropicCredentialResolution.js';
import { getImageRecoveryState } from './AnthropicImageSanitizer.js';
import { executeImageDimensionRecovery } from './AnthropicImageRecovery.js';
import { findRequestCommitState } from '../retryRequestContext.js';
import { getRequestSignal } from '../utils/abortSignal.js';
import { providerRowsOf } from '../utils/providerRows.js';
import { resolveRowsMedia } from '../openai-responses/responses-row-media.js';
import type { ResolvedMediaRequest } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import type { ImageDimensionBudget } from '@vybestack/llxprt-code-tools/utils/imageDimensionBudget.js';
import {
  finishMediaRequest,
  type MediaRequestOutcome,
  resolveRequestMedia,
  captureRequestMediaInput,
} from '../utils/request-media-resolution.js';

export class AnthropicProvider extends BaseProvider {
  // @plan PLAN-20251023-STATELESS-HARDENING.P08
  // All properties are stateless - no runtime/client caches or constructor-captured config
  // @requirement REQ-SP4-002: Eliminate provider-level caching and memoization
  // @requirement REQ-SP4-003: Auth tokens resolved per call via NormalizedGenerateChatOptions

  // Rate limit state tracking - updated on each API response
  private lastRateLimitInfo?: AnthropicRateLimitInfo;
  private readonly preparedPromptEnvelopes = new WeakMap<
    object,
    PreparedAnthropicPromptEnvelope
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
      mediaTransportCapabilities:
        declaredMediaTransportCapabilities('anthropic'),
    };

    super(baseConfig, config);

    // @plan PLAN-20251023-STATELESS-HARDENING.P08
    // No logger instances stored as instance variables - create on demand
    // @requirement REQ-SP4-002: Eliminate constructor-captured config and user-memory
  }

  /** The transport reads `requestRows` itself (issue #854 WP07). */
  protected override ownsRequestRowsTransport(): boolean {
    return true;
  }

  /** A call without `requestRows` is sent from rows staged on disk. */
  protected override takesRowsRoute(): boolean {
    return true;
  }

  /**
   * A source-route send is normalized with its prompt inputs blanked because
   * the prepared body already carries them; the response path still needs the
   * tool declarations and the transport the assembled instruction, so they
   * come back from the one prepared envelope.
   */
  private restorePreparedSourceInputs(
    options: NormalizedGenerateChatOptions,
  ): NormalizedGenerateChatOptions {
    const token = options.promptEnvelopeTransportToken;
    if (token === undefined || !readsRequestRowsAtTransport(options)) {
      return options;
    }
    const inputs = this.preparedPromptEnvelopes.get(token)?.sourceInputs;
    if (inputs === undefined) {
      throw new Error('Unknown Anthropic prompt-envelope transport token');
    }
    return { ...options, ...inputs };
  }

  private captureMedia(options: NormalizedGenerateChatOptions) {
    return captureRequestMediaInput(
      options.metadata['logicalRequestId'],
      options.invocation.runtimeId,
      this.requestMediaBudgetBytes,
      this.requestMediaResolver,
    );
  }

  /**
   * A send with a prepared envelope uses that envelope's media request. Any
   * other send gets a fresh owner for the leases of the rows it resolves; its
   * rows are never read here, media is resolved one row at a time while the
   * body is written.
   */
  private async resolveTransportPreparation(
    options: NormalizedGenerateChatOptions,
  ): Promise<AnthropicTransportPreparation> {
    const token = options.promptEnvelopeTransportToken;
    const prepared =
      token === undefined ? undefined : this.preparedPromptEnvelopes.get(token);
    if (token !== undefined && prepared === undefined) {
      throw new Error('Unknown Anthropic prompt-envelope transport token');
    }
    if (prepared === undefined) {
      return {
        prepared,
        mediaRequest: await resolveRequestMedia(
          this.captureMedia(options),
          [],
          getRequestSignal(options),
        ),
        effectiveOptions: options,
      };
    }
    return {
      prepared,
      mediaRequest: prepared.mediaRequest,
      effectiveOptions: options,
    };
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

    return resolveAnthropicCredential({
      options,
      providerName: this.name,
      oauthProvider: this.baseProviderConfig.oauthProvider,
      oauthEligible: this.isOAuthEligible(options.resolved.baseURL),
      readToken: runtimeAuthToken.provide,
      readFallback: () => this.getAuthTokenForPrompt(),
    });
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
      throw createAnthropicMissingCredentialError(
        options,
        this.name,
        baseURL,
        this.baseProviderConfig.oauthProvider,
      );
    }

    authLogger.debug(() => 'Creating fresh client instance (stateless)');
    const client = instantiateClient(
      (token) => this.classifyOAuthToken(token),
      authToken,
      baseURL,
    );

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
      const client = instantiateClient(
        (token) => this.classifyOAuthToken(token),
        authToken,
        baseURL,
      );

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
   * Issue #3136/#3172: declare where the assembled system prompt may go.
   *
   * Under OAuth (`claudecode`) Anthropic REJECTS any request whose `system`
   * field carries content other than the Claude Code string, so the prompt
   * must be placed at the top of the context instead. Classification is driven
   * by the RESOLVED token string: a runtime auth-token provider is resolved
   * before placement is declared, so an unresolved provider object's shape
   * alone never implies OAuth. This declaration is consumed by the shared
   * placement policy, not a placement decision made in isolation here.
   */
  getSystemPromptPlacement(
    options: Pick<GenerateChatOptions, 'resolved'>,
  ): SystemPromptPlacement {
    const resolvedToken = options.resolved?.authToken;
    if (isRuntimeAuthTokenProvider(resolvedToken)) {
      throw new Error(
        'SystemPromptPlacementError: Anthropic placement requires a resolved auth-token string (issue #3172).',
      );
    }
    if (
      typeof resolvedToken === 'string' &&
      this.classifyOAuthToken(resolvedToken)
    ) {
      return 'context-prefix';
    }
    return 'system-field';
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
  private detectToolFormatForModel(modelName: string): ToolFormat {
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
  }

  detectToolFormat(): ToolFormat {
    // @plan PLAN-20251023-STATELESS-HARDENING.P08: Don't reference deprecated instance fields
    // Tools format should be derived from runtime context only
    try {
      const providerSettings = readInvocationPolicyRecord(
        this.captureOwnerPolicy()[this.name],
      );

      const toolFormatOverride = providerSettings.toolFormat as
        | ToolFormat
        | 'auto'
        | undefined;

      // If explicitly set to a specific format (not 'auto'), use it
      if (toolFormatOverride && toolFormatOverride !== 'auto') {
        return toolFormatOverride;
      }
    } catch (error) {
      this.getLogger().debug(
        () => `Failed to detect tool format from SettingsService: ${error}`,
      );
    }

    // Auto-detect based on model name if set to 'auto' or not set; also the
    // fallback when SettingsService is unavailable.
    return this.detectToolFormatForModel(this.getCurrentModel().toLowerCase());
  }

  private unprefixToolName(name: string, isOAuth: boolean): string {
    return unprefixAnthropicToolName(name, isOAuth);
  }

  private findToolSchema(
    tools: Parameters<typeof findAnthropicToolSchema>[0],
    toolName: string,
    isOAuth: boolean,
  ): unknown {
    return findAnthropicToolSchema(tools, toolName, isOAuth, (name, oauth) =>
      this.unprefixToolName(name, oauth),
    );
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
    const sendOptions = this.restorePreparedSourceInputs(options);
    requireAssembledSystemInstruction(sendOptions.systemInstruction);

    const preparation = await this.resolveTransportPreparation(sendOptions);
    let outcome: MediaRequestOutcome = { status: 'succeeded' };
    try {
      yield* this.generatePreparedChat(preparation);
    } catch (error) {
      outcome = { status: 'failed', error };
    } finally {
      await finishMediaRequest(preparation.mediaRequest, outcome);
    }
  }

  private async *generatePreparedChat(
    preparation: AnthropicTransportPreparation,
  ): AsyncIterableIterator<IContent> {
    const { prepared, mediaRequest, effectiveOptions } = preparation;
    const signal = effectiveOptions.invocation.signal;
    const { client: initialClient, authToken } = await this.buildProviderClient(
      effectiveOptions,
      effectiveOptions.resolved.telemetry,
      prepared?.authToken,
    );
    const isOAuth = prepared?.isOAuth ?? this.classifyOAuthToken(authToken);
    const request = await this.resolveSendRequest(
      preparation,
      isOAuth,
      authToken,
    );
    const customHeaders = buildAnthropicRequestHeaders({
      baseHeaders: this.getCustomHeaders() ?? {},
      isOAuth,
      wantCaching: request.facts.wantCaching,
      ttl: request.facts.ttl,
      cacheLogger: request.facts.cacheLogger,
      model: request.model,
      thinking: request.thinking,
    });
    const rateLimitLogger = this.getRateLimitLogger();
    await this.applyRateLimitThrottling(request.facts, rateLimitLogger, signal);

    const executed = await this.executeWithImageRecovery(
      effectiveOptions,
      request,
      request.call(initialClient, customHeaders, signal),
      initialClient,
      customHeaders,
      rateLimitLogger,
      isOAuth,
      authToken,
      mediaRequest,
    );
    const { response, rateLimitInfo } = executed;

    if (rateLimitInfo) this.lastRateLimitInfo = rateLimitInfo;
    yield* this.yieldResponse(
      response,
      request.facts,
      effectiveOptions,
      isOAuth,
      rateLimitLogger,
    );
  }

  /**
   * The request to send. A projected send posts the spool its projection
   * wrote, unless an earlier attempt of this request recovered from an image
   * dimension error: then, like any other send, it writes its body to a
   * request-scoped spool one row at a time, under the recovery's budget so
   * the poisoned original is not sent again. Either way the media request's
   * finish disposes the spool, the message table and the prompt files.
   */
  private async resolveSendRequest(
    preparation: AnthropicTransportPreparation,
    isOAuth: boolean,
    authToken: string,
  ): Promise<AnthropicSendRequest> {
    const { prepared, mediaRequest, effectiveOptions } = preparation;
    const recoveryBudget =
      getImageRecoveryState(effectiveOptions)?.recoveryBudget;
    const spooled =
      prepared !== undefined && recoveryBudget === undefined
        ? prepared.spooled
        : await this.spoolSendRequest(
            effectiveOptions,
            isOAuth,
            authToken,
            mediaRequest,
            recoveryBudget,
          );
    reportRequestSize(effectiveOptions.metadata, spooled.spool.byteLength);
    return sendRequestFromSpool(spooled);
  }

  private async spoolSendRequest(
    options: NormalizedGenerateChatOptions,
    isOAuth: boolean,
    authToken: string,
    mediaRequest: ResolvedMediaRequest,
    recoveryBudget: ImageDimensionBudget | undefined,
  ): Promise<PreparedAnthropicRequest> {
    const media = this.captureMedia(options);
    const signal = getRequestSignal(options);
    const requestRows = await providerRowsOf(options);
    const spooled = await prepareAnthropicRequestRows(
      this.planParams(options, isOAuth, authToken),
      requestRows,
      (rows) =>
        resolveRowsMedia(rows, media, mediaRequest, signal, requestRows.native),
      { recoveryBudget },
    );
    await registerAnthropicRequestCleanup(mediaRequest, spooled);
    return spooled;
  }

  /**
   * Issue #3216: run the API call, falling back once to image-dimension
   * recovery for poisoned history when the initial call fails. Returns the
   * executed response plus rate-limit info; rethrows when recovery does not
   * apply. Never loops.
   */
  private async executeWithImageRecovery(
    options: NormalizedGenerateChatOptions,
    request: AnthropicSendRequest,
    apiCallWithResponse: AnthropicApiCall,
    initialClient: Anthropic,
    customHeaders: Record<string, string>,
    rateLimitLogger: { debug: (fn: () => string) => void },
    isOAuth: boolean,
    authToken: string,
    mediaRequest: ResolvedMediaRequest,
  ): Promise<{
    response: Anthropic.Message | AsyncIterable<Anthropic.MessageStreamEvent>;
    rateLimitInfo: AnthropicRateLimitInfo | undefined;
  }> {
    try {
      const result = await this.executeApiCall(
        options,
        request,
        apiCallWithResponse,
        rateLimitLogger,
        customHeaders,
        isOAuth,
        authToken,
      );
      return { response: result.response, rateLimitInfo: result.rateLimitInfo };
    } catch (error) {
      const recovered = await executeImageDimensionRecovery(
        {
          execute: (...args) => this.executeApiCall(...args),
          errorsLogger: this.getErrorsLogger(),
          rebuild: (budget) =>
            this.spoolSendRequest(
              options,
              isOAuth,
              authToken,
              mediaRequest,
              budget,
            ),
        },
        error,
        request,
        options,
        initialClient,
        customHeaders,
        rateLimitLogger,
        isOAuth,
        authToken,
      );
      if (recovered === undefined) throw error;
      return recovered;
    }
  }

  private planParams(
    options: NormalizedGenerateChatOptions,
    isOAuth: boolean,
    authToken: string,
  ): AnthropicPlanParams {
    // Issue #3172: placement is declared from the RESOLVED-token fact and
    // resolved through the shared policy, never re-derived from isOAuth here.
    const placement = resolveSystemPromptPlacement(
      this.getSystemPromptPlacement({
        resolved: { ...options.resolved, authToken },
      }),
    );
    return {
      tools: options.tools,
      options,
      isOAuth,
      placement,
      providerName: this.name,
      config: undefined,
      getMaxTokensForModel: (m) => this.getMaxTokensForModel(m),
      unprefixToolName: (name, oauth) => this.unprefixToolName(name, oauth),
      providerConfig: this.providerConfig,
      logger: this.getLogger(),
      toolsLogger: this.getToolsLogger(),
      cacheLogger: this.getCacheLogger(),
    };
  }

  /**
   * Project the finalized Anthropic Messages envelope (issue #2817).
   *
   * Uses the transport's native preparation, so the estimate and later send
   * share a pinned row selection. Each reads the rows one at a time in its
   * required form; neither retains a request-sized messages array. Preparation
   * still resolves prompt inputs such as memory and tools, but no client is
   * constructed and no credential is
   * exchanged. The OAuth flavor only selects tool-name prefixing and cache
   * formatting, so it is derived from the already-resolved token when one is
   * present.
   */
  async projectPromptEnvelope(
    options: GenerateChatOptions,
  ): Promise<PromptEnvelopeProjection> {
    const normalized = await this.normalizeOptionsForProjection(options);
    try {
      return await this.projectNormalized(normalized);
    } catch (error) {
      return closeStagedRowsAfterFailure(normalized.stagedRows, error);
    }
  }

  private async projectNormalized(
    normalized: NormalizedGenerateChatOptions,
  ): Promise<PromptEnvelopeProjection> {
    const media = this.captureMedia(normalized);
    const signal = getRequestSignal(normalized);
    const mediaRequest = await resolveRequestMedia(media, [], signal);
    const { stagedRows } = normalized;
    // Rows staged from `contents` stay open until the projection is released.
    if (stagedRows !== undefined)
      mediaRequest.registerCleanup(() => stagedRows.close());
    try {
      const authToken = await this.resolveProjectionAuthToken(normalized);
      const isOAuth = this.classifyOAuthToken(authToken);
      const requestRows = await providerRowsOf(normalized);
      const spooled = await prepareAnthropicRequestRows(
        this.planParams(normalized, isOAuth, authToken),
        requestRows,
        (rows) =>
          resolveRowsMedia(
            rows,
            media,
            mediaRequest,
            signal,
            requestRows.native,
          ),
        { estimate: true },
      );
      await registerAnthropicRequestCleanup(mediaRequest, spooled);
      const { estimate } = spooled;
      if (estimate === undefined) {
        throw new Error('A projected request carries its estimate projection');
      }
      const transportToken = Object.freeze({});
      const projection = projectAnthropicPromptEnvelopeFromSource(
        estimate.projection,
        {
          model: String(spooled.envelope['model']),
          unsupportedMedia: estimate.unsupportedMedia,
          transportToken,
          releaseIfUnsent: mediaRequest.release,
        },
      );
      this.preparedPromptEnvelopes.set(transportToken, {
        spooled,
        isOAuth,
        authToken,
        mediaRequest,
        ...(readsRequestRowsAtTransport(normalized)
          ? {
              sourceInputs: {
                systemInstruction: normalized.systemInstruction,
                tools: normalized.tools,
              },
            }
          : {}),
      });
      return projection;
    } catch (error) {
      return finishMediaRequest(mediaRequest, { status: 'failed', error });
    }
  }

  private async applyRateLimitThrottling(
    requestContext: AnthropicRequestFacts,
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
    request: AnthropicSendRequest,
    apiCallWithResponse: AnthropicApiCall,
    rateLimitLogger: { debug: (fn: () => string) => void },
    headers: Record<string, string> | undefined,
    isOAuth: boolean,
    authToken: string,
  ) {
    const dumpHeaders: Record<string, string> | undefined =
      withCredentialHeader(headers, isOAuth, authToken);
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
      requestBody: requestBodyForDump(dumpMode, request),
      streamingEnabled: request.facts.streamingEnabled,
      headers: dumpHeaders,
      rateLimitLogger,
    });
  }

  private async *yieldResponse(
    response: Anthropic.Message | AsyncIterable<Anthropic.MessageStreamEvent>,
    requestContext: AnthropicRequestFacts,
    options: NormalizedGenerateChatOptions,
    isOAuth: boolean,
    rateLimitLogger: { debug: (fn: () => string) => void },
  ): AsyncGenerator<IContent> {
    if (requestContext.streamingEnabled) {
      if (!isAnthropicMessageStream(response)) {
        throw new Error('Anthropic streaming response was not an event stream');
      }
      const stream = processAnthropicStream(response, {
        isOAuth,
        tools: options.tools,
        unprefixToolName: (name, oauth) => this.unprefixToolName(name, oauth),
        findToolSchema: (t, name, oauth) => this.findToolSchema(t, name, oauth),
        logger: this.getStreamingLogger(),
        cacheLogger: requestContext.cacheLogger,
        rateLimitLogger,
        includeThinkingInResponse: requestContext.includeThinkingInResponse,
        commitState: findRequestCommitState(options),
      });
      for await (const content of stream) {
        yield withSemanticMediaPurgeCacheEvidence(content, requestContext);
      }
    } else {
      if (isAnthropicMessageStream(response)) {
        throw new Error('Anthropic non-streaming response was an event stream');
      }
      const content = parseAnthropicResponse(response, {
        isOAuth,
        tools: options.tools,
        unprefixToolName: (name, oauth) => this.unprefixToolName(name, oauth),
        findToolSchema: (t, name, oauth) => this.findToolSchema(t, name, oauth),
        cacheLogger: requestContext.cacheLogger,
        includeThinkingInResponse: requestContext.includeThinkingInResponse,
      });
      yield withSemanticMediaPurgeCacheEvidence(content, requestContext);
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
