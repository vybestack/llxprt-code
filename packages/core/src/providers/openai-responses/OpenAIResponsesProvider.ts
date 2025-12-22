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
import { SyntheticToolResponseHandler } from '../openai/syntheticToolResponses.js';

// @plan:PLAN-20251023-STATELESS-HARDENING.P08
// @requirement:REQ-SP4-002/REQ-SP4-003
// Removed ConversationCache and peekActiveProviderRuntime dependencies to enforce stateless operation
import { DebugLogger } from '../../debug/index.js';
import { type IModel } from '../IModel.js';
import {
  type IContent,
  type TextBlock,
  type ToolCallBlock,
  type ToolResponseBlock,
} from '../../services/history/IContent.js';
import {
  limitOutputTokens,
  type ToolOutputSettingsProvider,
} from '../../utils/toolOutputLimiter.js';
import { normalizeToOpenAIToolId } from '../utils/toolIdNormalization.js';
import { type IProviderConfig } from '../types/IProviderConfig.js';
import { RESPONSES_API_MODELS } from '../openai/RESPONSES_API_MODELS.js';
import { CODEX_MODELS } from './CODEX_MODELS.js';
import {
  buildCodexSteeringPrompt,
  CODEX_SYSTEM_PROMPT,
} from './CODEX_PROMPT.js';
import {
  parseResponsesStream,
  parseErrorResponse,
} from '../openai/parseResponsesStream.js';
import {
  BaseProvider,
  type BaseProviderConfig,
  type NormalizedGenerateChatOptions,
} from '../BaseProvider.js';
import type { ToolFormat } from '../../tools/IToolFormatter.js';
import { convertToolsToOpenAIResponses } from './schemaConverter.js';
import { getCoreSystemPromptAsync } from '../../core/prompts.js';
import { resolveUserMemory } from '../utils/userMemory.js';
import { resolveRuntimeAuthToken } from '../utils/authToken.js';
import { filterOpenAIRequestParams } from '../openai/openaiRequestParams.js';
import { CodexOAuthTokenSchema } from '../../auth/types.js';
import type { OAuthManager } from '../../auth/precedence.js';
import {
  retryWithBackoff,
  getErrorStatus,
  isNetworkTransientError,
} from '../../utils/retry.js';

export class OpenAIResponsesProvider extends BaseProvider {
  private logger: DebugLogger;
  private _isCodexMode: boolean;
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
      baseURL: baseURL || 'https://api.openai.com/v1',
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
        `Constructor - baseURL: ${baseURL || 'https://api.openai.com/v1'}, hasApiKey: ${!!apiKey}, codexMode: ${isCodex}`,
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
  private isCodexMode(baseURL: string | undefined): boolean {
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
  private shouldRetryOnError(error: Error | unknown): boolean {
    // Check for status using helper (handles error shapes from fetch)
    const status = getErrorStatus(error);
    if (status !== undefined) {
      if (status === 400) return false;
      return status === 429 || (status >= 500 && status < 600);
    }

    // Check for network transient errors
    if (isNetworkTransientError(error)) {
      return true;
    }

    return false;
  }

  /**
   * Get account_id from Codex OAuth token
   * @plan PLAN-20251213-ISSUE160.P03
   */
  private async getCodexAccountId(): Promise<string> {
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
    const baseURL = this.getBaseURL() || 'https://api.openai.com/v1';
    const isCodex = this.isCodexMode(baseURL);

    // @plan PLAN-20251214-ISSUE160.P05
    // Debug logging for model listing
    this.logger.debug(
      () =>
        `getModels() called: baseURL=${baseURL}, isCodexMode=${isCodex}, providerName=${this.name}`,
    );

    // @plan PLAN-20251214-ISSUE160.P06
    // Fetch models from Codex API when in Codex mode
    if (isCodex) {
      return this.getCodexModels(baseURL);
    }

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
      // @plan PLAN-20251215-issue813: Wrap with retryWithBackoff for 429/5xx handling
      // Fetch models from the API
      const response = await retryWithBackoff(
        () =>
          fetch(`${baseURL}/models`, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${apiKey}`,
            },
          }),
        {
          shouldRetryOnError: this.shouldRetryOnError.bind(this),
        },
      );

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
    // Return gpt-5.2 as default when in Codex mode
    const baseURL = this.getBaseURL();
    if (this.isCodexMode(baseURL)) {
      return 'gpt-5.2';
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

    // Ensure OpenAI/Codex history is API-compliant:
    // every assistant tool_call must have a corresponding tool_response.
    // Cancelled tools can leave orphaned tool_call blocks which cause the next
    // request to 400 ("No tool call found for function call output...").
    const patchedContent =
      SyntheticToolResponseHandler.patchMessageHistory(content);

    // Use getAuthTokenForPrompt() to trigger OAuth if needed
    const apiKey =
      (await this.getAuthTokenForPrompt()) ??
      (await resolveRuntimeAuthToken(options.resolved.authToken)) ??
      '';
    if (!apiKey) {
      throw new Error(
        this._isCodexMode
          ? 'Codex authentication required. Run /auth codex enable to authenticate.'
          : 'OpenAI API key is required',
      );
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

    // Responses API input types: messages, function_call, function_call_output
    type ResponsesInputItem =
      | { role: 'user' | 'assistant' | 'system'; content?: string }
      | {
          type: 'function_call';
          call_id: string;
          name: string;
          arguments: string;
        }
      | { type: 'function_call_output'; call_id: string; output: string };

    const input: ResponsesInputItem[] = [];

    if (systemPrompt) {
      input.push({
        role: 'system',
        content: systemPrompt,
      });
    }

    for (const c of patchedContent) {
      if (c.speaker === 'human') {
        const textBlocks = c.blocks.filter(
          (b): b is TextBlock => b.type === 'text',
        );
        const text = textBlocks.map((b) => b.text).join('\n');
        if (text) {
          input.push({ role: 'user', content: text });
        }
      } else if (c.speaker === 'ai') {
        const textBlocks = c.blocks.filter(
          (b) => b.type === 'text',
        ) as TextBlock[];
        const toolCallBlocks = c.blocks.filter(
          (b) => b.type === 'tool_call',
        ) as ToolCallBlock[];

        const contentText = textBlocks.map((b) => b.text).join('');

        // Add assistant text content if present
        if (contentText) {
          input.push({
            role: 'assistant',
            content: contentText,
          });
        }

        // Add function_call items for each tool call (Responses API format)
        // Normalize tool IDs to OpenAI format (call_XXX) - fixes issue #825
        for (const toolCall of toolCallBlocks) {
          input.push({
            type: 'function_call',
            call_id: normalizeToOpenAIToolId(toolCall.id),
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.parameters),
          });
        }
      } else if (c.speaker === 'tool') {
        // Convert tool responses to function_call_output format (Responses API)
        const toolResponseBlocks = c.blocks.filter(
          (b) => b.type === 'tool_response',
        ) as ToolResponseBlock[];

        // Normalize tool IDs to OpenAI format (call_XXX) - fixes issue #825
        for (const toolResponseBlock of toolResponseBlocks) {
          const rawResult =
            typeof toolResponseBlock.result === 'string'
              ? toolResponseBlock.result
              : JSON.stringify(toolResponseBlock.result);

          const outputLimiterConfig =
            options.config ??
            options.runtime?.config ??
            this.globalConfig ??
            ({
              getEphemeralSettings: () => ({}),
            } satisfies ToolOutputSettingsProvider);

          const limited = limitOutputTokens(
            rawResult,
            outputLimiterConfig,
            toolResponseBlock.toolName ?? 'tool_response',
          );

          const candidate = limited.content || limited.message || '';

          const outputCallId = normalizeToOpenAIToolId(
            toolResponseBlock.callId,
          );

          // Defensive guard: Codex /responses requires every function_call_output
          // to reference a function_call call_id that exists in the request history.
          // If history is corrupted (e.g. cancellation injects a mismatched callId),
          // drop the orphaned output rather than sending an invalid request.
          const hasMatchingCall = patchedContent.some(
            (msg) =>
              msg.speaker === 'ai' &&
              msg.blocks.some(
                (b) =>
                  b.type === 'tool_call' &&
                  normalizeToOpenAIToolId((b as ToolCallBlock).id) ===
                    outputCallId,
              ),
          );

          if (!hasMatchingCall) {
            this.logger.debug(
              () =>
                `Dropping orphan function_call_output with call_id=${outputCallId} (no matching tool_call in history)`,
            );
            continue;
          }

          input.push({
            type: 'function_call_output',
            call_id: outputCallId,
            output: candidate,
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
    const mergedParams: Record<string, unknown> = {
      ...(filteredSettingsParams ?? {}),
      ...(filteredEphemeralParams ?? {}),
    };

    // Translate max_tokens/max_completion_tokens to max_output_tokens for Responses API
    // The Responses API uses max_output_tokens, not max_tokens (GPT-5 models)
    const requestOverrides: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(mergedParams)) {
      if (key === 'max_tokens' || key === 'max_completion_tokens') {
        // Responses API uses max_output_tokens
        requestOverrides['max_output_tokens'] = value;
        this.logger.debug(
          () =>
            `Translated ${key}=${value} to max_output_tokens for Responses API`,
        );
      } else {
        requestOverrides[key] = value;
      }
    }
    this.logger.debug(
      () =>
        `Request overrides: ${JSON.stringify(Object.keys(requestOverrides))}`,
    );

    // @plan:PLAN-20251023-STATELESS-HARDENING.P08
    // @requirement:REQ-SP4-002/REQ-SP4-003
    // Prefer resolved options, then runtime config, then defaults instead of stored provider state
    const baseURLCandidate =
      options.resolved.baseURL ??
      this.getBaseURL() ??
      'https://api.openai.com/v1';
    const baseURL = baseURLCandidate.replace(/\/+$/u, '');

    // @plan PLAN-20251213-ISSUE160.P03
    // Detect Codex mode and handle accordingly
    const isCodex = this.isCodexMode(baseURL);

    // Build request input - filter out system messages for Codex (uses instructions field instead)
    let requestInput = input;
    if (isCodex) {
      // In Codex mode, system prompt goes in instructions field, not input array
      // Only filter items that have a 'role' property (function_call/function_call_output don't)
      requestInput = requestInput.filter(
        (msg) => !('role' in msg) || msg.role !== 'system',
      );

      const steeringPrompt = buildCodexSteeringPrompt(systemPrompt);
      if (steeringPrompt) {
        requestInput.unshift({ role: 'user', content: steeringPrompt });
      }
    }

    const request: {
      model: string;
      input: typeof requestInput;
      instructions?: string;
      tools?: typeof responsesTools;
      stream: boolean;
      [key: string]: unknown;
    } = {
      model: resolvedModel,
      input: requestInput,
      stream: true,
      ...(requestOverrides || {}),
    };

    if (responsesTools && responsesTools.length > 0) {
      request.tools = responsesTools;
    }

    // @plan PLAN-20251214-ISSUE160.P05
    // Add Codex-specific request parameters
    if (isCodex) {
      // Codex API requires the official system prompt in instructions field
      request.instructions = CODEX_SYSTEM_PROMPT;
      request.store = false;
      // Codex API (ChatGPT backend) doesn't support max_output_tokens parameter
      // Remove it to prevent 400 errors
      if ('max_output_tokens' in request) {
        delete request.max_output_tokens;
        this.logger.debug(
          () =>
            'Codex mode: removed unsupported max_output_tokens from request',
        );
      }
      this.logger.debug(
        () => 'Codex mode: setting instructions and store=false',
      );
    }

    const responsesURL = `${baseURL}/responses`;
    const requestBody = JSON.stringify(request);

    // @plan PLAN-20251214-ISSUE160.P05
    // Codex API requires Content-Type without charset suffix
    const contentType = isCodex
      ? 'application/json'
      : 'application/json; charset=utf-8';

    const bodyBlob = new Blob([requestBody], {
      type: contentType,
    });

    // @plan:PLAN-20251023-STATELESS-HARDENING.P08
    // @requirement:REQ-SP4-002/REQ-SP4-003
    // Source custom headers from normalized provider configuration each call
    const customHeaders = this.getCustomHeaders();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': contentType,
      ...(customHeaders ?? {}),
    };

    // @plan PLAN-20251214-ISSUE160.P05
    // Add Codex-specific headers when in Codex mode
    if (isCodex) {
      const accountId = await this.getCodexAccountId();
      headers['ChatGPT-Account-ID'] = accountId;
      headers['originator'] = 'codex_cli_rs';
      this.logger.debug(
        () =>
          `Codex mode: adding headers for account ${accountId.substring(0, 8)}...`,
      );
    }

    // @plan PLAN-20251215-issue868: Retry responses streaming end-to-end
    // Retry must encompass both the initial fetch and the subsequent stream
    // consumption, because transient network failures can occur mid-stream.
    const maxStreamingAttempts = 2;
    let streamingAttempt = 0;

    while (streamingAttempt < maxStreamingAttempts) {
      streamingAttempt++;

      const response = await retryWithBackoff(
        () =>
          fetch(responsesURL, {
            method: 'POST',
            headers,
            body: bodyBlob,
          }),
        {
          shouldRetryOnError: this.shouldRetryOnError.bind(this),
        },
      );

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.debug(
          () => `API error ${response.status}: ${errorBody.substring(0, 500)}`,
        );
        throw parseErrorResponse(response.status, errorBody, this.name);
      }

      if (!response.body) {
        this.logger.debug(() => 'Response body missing, returning early');
        return;
      }

      try {
        for await (const message of parseResponsesStream(response.body)) {
          yield message;
        }
        return;
      } catch (error) {
        const canRetryStream = this.shouldRetryOnError(error);
        this.logger.debug(
          () =>
            `Responses stream error on attempt ${streamingAttempt}/${maxStreamingAttempts}: ${String(error)}`,
        );

        if (!canRetryStream || streamingAttempt >= maxStreamingAttempts) {
          throw error;
        }

        // Retry by restarting the request from the beginning.
        // NOTE: This can re-yield partial content from a previous attempt.
        continue;
      }
    }
  }
}
