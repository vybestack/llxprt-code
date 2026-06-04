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
import { type IModel } from '../IModel.js';
import { type IProviderConfig } from '../types/IProviderConfig.js';
import { RESPONSES_API_MODELS } from '../openai/RESPONSES_API_MODELS.js';
import { CODEX_MODELS } from './CODEX_MODELS.js';
import { BaseProvider, type BaseProviderConfig } from '../BaseProvider.js';
import type { ToolFormat } from '../../tools/IToolFormatter.js';
import { CodexOAuthTokenSchema } from '../../auth/types.js';
import type { OAuthManager } from '../../auth/precedence.js';
import { getErrorStatus, isNetworkTransientError } from '../../utils/retry.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import type { ResponsesInputItem } from './OpenAIResponsesTypes.js';

export abstract class OpenAIResponsesProviderBase extends BaseProvider {
  protected logger: DebugLogger;
  protected _isCodexMode: boolean;
  // @plan:PLAN-20251023-STATELESS-HARDENING.P08
  // @requirement:REQ-SP4-002/REQ-SP4-003
  // Removed static cache scope and conversation cache dependencies to achieve stateless operation

  constructor(
    apiKey: string | undefined,
    baseURL?: string,
    config?: IProviderConfig,
    oauthManager?: OAuthManager,
  ) {
    // Detect Codex mode from baseURL at construction time
    const isCodex = baseURL?.includes('chatgpt.com/backend-api/codex') ?? false;

    const baseConfig: BaseProviderConfig = {
      name: 'openai-responses',
      apiKey,
      baseURL: baseURL ?? 'https://api.openai.com/v1',
      envKeyNames: ['OPENAI_API_KEY'],
      isOAuthEnabled: isCodex && !!oauthManager,
      oauthProvider: isCodex ? 'codex' : undefined,
      oauthManager: isCodex ? oauthManager : undefined,
      // Must set supportsOAuth here because supportsOAuth() is called in super()
      // before _isCodexMode is set
      supportsOAuth: isCodex,
    };

    super(baseConfig, config);

    this._isCodexMode = isCodex;
    this.logger = new DebugLogger('llxprt:providers:openai-responses');
    this.logger.debug(
      () =>
        `Constructor - baseURL: ${baseURL ?? 'https://api.openai.com/v1'}, hasApiKey: ${!!apiKey}, codexMode: ${isCodex}`,
    );
  }

  /**
   * OAuth is supported in Codex mode
   * Check baseURL directly to avoid timing issues with instance properties
   * @plan PLAN-20251213-ISSUE160.P03
   */
  protected supportsOAuth(): boolean {
    // Check baseURL directly - don't rely on _isCodexMode which may not be set yet
    const baseURL = this.getBaseURL();
    return this.isCodexMode(baseURL);
  }

  /**
   * Detect if provider is in Codex mode based on baseURL
   * @plan PLAN-20251213-ISSUE160.P03
   */
  protected isCodexMode(baseURL: string | undefined): boolean {
    return baseURL?.includes('chatgpt.com/backend-api/codex') ?? false;
  }

  /**
   * @plan PLAN-20251215-issue813
   * @requirement REQ-RETRY-001: OpenAIResponsesProvider must use retryWithBackoff for all fetch calls
   *
   * Determines if an error should trigger a retry.
   * - 429 (rate limit) errors are retried
   * - 5xx server errors are retried
   * - 400 (bad request) errors are NOT retried
   * - Network transient errors are retried
   */
  protected shouldRetryOnError(error: Error | unknown): boolean {
    // Check for status using helper (handles error shapes from fetch)
    const status = getErrorStatus(error);
    if (status !== undefined) {
      if (status === 400) return false;
      return status === 429 || (status >= 500 && status < 600);
    }

    return isNetworkTransientError(error);
  }

  /**
   * Get account_id from Codex OAuth token
   * @plan PLAN-20251213-ISSUE160.P03
   */
  protected async getCodexAccountId(): Promise<string> {
    // Get OAuth manager from base config
    const oauthManager = this.baseProviderConfig.oauthManager;
    if (!oauthManager) {
      throw new Error(
        'Codex mode requires OAuth authentication with account_id - no OAuth manager available',
      );
    }

    // Get the full token from the OAuth manager
    // getOAuthToken returns the full token object (with account_id preserved via passthrough)
    const token = await oauthManager.getOAuthToken?.('codex');
    if (!token) {
      throw new Error(
        'Codex mode requires OAuth authentication - no token available. Run /auth codex enable',
      );
    }

    // Validate with Zod schema to get account_id
    const validatedToken = CodexOAuthTokenSchema.parse(token);
    return validatedToken.account_id;
  }

  override getToolFormat(): ToolFormat {
    // Always use OpenAI format for responses API
    return 'openai';
  }

  override async getModels(): Promise<IModel[]> {
    const baseURL = this.getBaseURL() ?? 'https://api.openai.com/v1';
    const isCodex = this.isCodexMode(baseURL);
    this.logger.debug(
      () =>
        `getModels() called: baseURL=${baseURL}, isCodexMode=${isCodex}, providerName=${this.name}`,
    );

    if (isCodex) return this.getCodexModels(baseURL);

    const apiKey = await this.getAuthToken();
    if (!apiKey) return this.buildFallbackModels();

    try {
      const response = await fetch(`${baseURL}/models`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!response.ok) return this.buildFallbackModels();
      const data = (await response.json()) as { data: Array<{ id: string }> };
      const models = this.filterChatModels(data.data);
      return models.length > 0 ? models : this.buildFallbackModels();
    } catch (error) {
      this.logger.debug(() => `Error fetching models from OpenAI: ${error}`);
      return this.buildFallbackModels();
    }
  }

  private buildFallbackModels(): IModel[] {
    return RESPONSES_API_MODELS.map((modelId) => ({
      id: modelId,
      name: modelId,
      provider: this.name,
      supportedToolFormats: ['openai'],
    }));
  }

  private filterChatModels(models: Array<{ id: string }>): IModel[] {
    return models
      .filter((model) => !this.isNonChatModel(model.id))
      .map((model) => ({
        id: model.id,
        name: model.id,
        provider: this.name,
        supportedToolFormats: ['openai'],
      }));
  }

  private isNonChatModel(modelId: string): boolean {
    return /embedding|whisper|audio|tts|image|vision|dall[- ]?e|moderation/i.test(
      modelId,
    );
  }

  /**
   * Get Codex models
   *
   * Note: The Codex /models endpoint is protected by Cloudflare bot detection
   * which blocks automated requests (even with proper auth headers).
   * The /responses endpoint works fine, but /models returns a Cloudflare challenge.
   * Therefore, we use a hardcoded list based on codex-rs/core/tests/suite/list_models.rs
   *
   * @plan PLAN-20251214-ISSUE160.P06
   */
  private async getCodexModels(_baseURL: string): Promise<IModel[]> {
    this.logger.debug(
      () =>
        'Codex mode: returning hardcoded models (API blocked by Cloudflare)',
    );
    return CODEX_MODELS;
  }

  override getCurrentModel(): string {
    return this.getModel();
  }

  override getDefaultModel(): string {
    // @plan PLAN-20251213-ISSUE160.P04
    // Return gpt-5.3-codex as default when in Codex mode (issue #1308)
    const baseURL = this.getBaseURL();
    if (this.isCodexMode(baseURL)) {
      return 'gpt-5.3-codex';
    }
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
   * Generate a unique synthetic call ID to avoid collisions.
   * @issue #966
   */
  protected generateSyntheticCallId(): string {
    const randomSuffix = Math.random().toString(36).substring(2, 10);
    return `call_synthetic_${randomSuffix}`;
  }

  /**
   * Inject a synthetic tool call/result pair that makes GPT think it already read AGENTS.md.
   *
   * The CODEX_SYSTEM_PROMPT instructs GPT to read AGENTS.md for project instructions.
   * However, the user may have configured LLXPRT.md instead (or both), and sometimes
   * AGENTS.md is deliberately reserved for a different agent (like Codex itself).
   *
   * This method:
   * 1. Always claims to have read "AGENTS.md" in the synthetic function call
   * 2. Returns the actual userMemory content (from LLXPRT.md, AGENTS.md, or both)
   * 3. Prevents GPT from wasting a tool call trying to read AGENTS.md
   *
   * @issue #966
   */
  protected injectSyntheticConfigFileRead(
    requestInput: ResponsesInputItem[],
    options: NormalizedGenerateChatOptions,
    userMemory: string | undefined,
  ): void {
    const syntheticCallId = this.generateSyntheticCallId();

    // Note: We intentionally don't use configRef/filePaths here anymore.
    // The goal is to NOT reveal which files were actually loaded.
    // We just need to know if userMemory has content.

    let output: string;

    // Always pretend we read AGENTS.md - this is what CODEX_SYSTEM_PROMPT tells GPT to do
    const targetFile = 'AGENTS.md';

    if (userMemory && userMemory.trim().length > 0) {
      // Return the ACTUAL userMemory content so GPT sees what was loaded,
      // while making it think this came from reading AGENTS.md.
      // Do NOT reveal actual source files - the goal is to convince GPT it read AGENTS.md.
      output = JSON.stringify({
        content: userMemory,
      });
    } else {
      output = JSON.stringify({
        error: 'File not found: AGENTS.md',
      });
    }

    requestInput.unshift(
      {
        type: 'function_call',
        call_id: syntheticCallId,
        name: 'read_file',
        arguments: JSON.stringify({ absolute_path: targetFile }),
      },
      {
        type: 'function_call_output',
        call_id: syntheticCallId,
        output,
      },
    );
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
        this.resolveSettingsService().getProviderSettings(this.name);

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
}
