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
 * @plan PLAN-20250120-DEBUGLOGGING.P15
 * @requirement REQ-INT-001.1
 */

import OpenAI from 'openai';
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import { IContent } from '../../services/history/IContent.js';
import { IProviderConfig } from '../types/IProviderConfig.js';
import { ToolFormat } from '../../tools/IToolFormatter.js';
import { BaseProvider } from '../BaseProvider.js';
import { DebugLogger } from '../../debug/index.js';
import { getSettingsService } from '../../settings/settingsServiceInstance.js';
import { OAuthManager } from '../../auth/precedence.js';
import { ToolFormatter } from '../../tools/ToolFormatter.js';
import {
  ToolCallBlock,
  TextBlock,
  ToolResponseBlock,
} from '../../services/history/IContent.js';
import { processToolParameters } from '../../tools/doubleEscapeUtils.js';
import { IModel } from '../IModel.js';
import { IProvider } from '../IProvider.js';
import { getCoreSystemPromptAsync } from '../../core/prompts.js';
import {
  retryWithBackoff,
  isNetworkTransientError,
} from '../../utils/retry.js';

export class OpenAIProvider extends BaseProvider implements IProvider {
  override readonly name: string = 'openai';
  private logger: DebugLogger;
  private toolFormatter: ToolFormatter;

  private _cachedClient?: OpenAI;
  private _cachedClientKey?: string;
  private modelParams?: Record<string, unknown>;

  constructor(
    apiKey: string | undefined,
    baseURL?: string,
    config?: IProviderConfig,
    oauthManager?: OAuthManager,
  ) {
    // Normalize empty string to undefined for proper precedence handling
    const normalizedApiKey =
      apiKey && apiKey.trim() !== '' ? apiKey : undefined;

    // Detect if this is a Qwen endpoint
    // CRITICAL FIX: For now, only use base URL check in constructor since `this.name` isn't available yet
    // The name-based check will be handled in the supportsOAuth() method after construction
    const isQwenEndpoint = !!(
      baseURL &&
      (baseURL.includes('dashscope.aliyuncs.com') ||
        baseURL.includes('api.qwen.com') ||
        baseURL.includes('qwen'))
    );

    // Initialize base provider with auth configuration
    super(
      {
        name: 'openai',
        apiKey: normalizedApiKey,
        baseURL,
        envKeyNames: ['OPENAI_API_KEY'], // Support environment variable fallback
        isOAuthEnabled: isQwenEndpoint && !!oauthManager,
        oauthProvider: isQwenEndpoint ? 'qwen' : undefined,
        oauthManager,
      },
      config,
    );

    this.toolFormatter = new ToolFormatter();
    // new DebugLogger('llxprt:core:toolformatter'), // TODO: Fix ToolFormatter constructor

    // Setup debug logger
    this.logger = new DebugLogger('llxprt:provider:openai');

    this.loadModelParamsFromSettings().catch((error) => {
      this.logger.debug(
        () =>
          `Failed to initialize model params from SettingsService: ${error}`,
      );
    });
  }

  private getSocketSettings():
    | {
        timeout: number;
        keepAlive: boolean;
        noDelay: boolean;
      }
    | undefined {
    const settings = this.providerConfig?.getEphemeralSettings?.() || {};

    const timeoutSetting = settings['socket-timeout'];
    const keepAliveSetting = settings['socket-keepalive'];
    const noDelaySetting = settings['socket-nodelay'];

    const hasExplicitValue = (setting: unknown): boolean =>
      setting !== undefined && setting !== null;

    if (
      !hasExplicitValue(timeoutSetting) &&
      !hasExplicitValue(keepAliveSetting) &&
      !hasExplicitValue(noDelaySetting)
    ) {
      return undefined;
    }

    const timeout =
      typeof timeoutSetting === 'number' && Number.isFinite(timeoutSetting)
        ? timeoutSetting
        : Number(timeoutSetting) > 0
          ? Number(timeoutSetting)
          : 60000;

    const keepAlive =
      keepAliveSetting === undefined || keepAliveSetting === null
        ? true
        : keepAliveSetting !== false;

    const noDelay =
      noDelaySetting === undefined || noDelaySetting === null
        ? true
        : noDelaySetting !== false;

    return {
      timeout,
      keepAlive,
      noDelay,
    };
  }

  private createSocketAwareFetch(config: {
    timeout: number;
    keepAlive: boolean;
    noDelay: boolean;
  }): typeof fetch {
    const { timeout, keepAlive, noDelay } = config;
    const maxRetries = 2;
    const retryDelay = 1000;
    const partialResponseThreshold = 2;

    const buildHeaders = (init?: RequestInit): Record<string, string> => {
      const baseHeaders: Record<string, string> = {
        Accept: 'text/event-stream',
        Connection: keepAlive ? 'keep-alive' : 'close',
        'Cache-Control': 'no-cache',
      };

      if (!init?.headers) {
        return baseHeaders;
      }

      const appendHeader = (key: string, value: string) => {
        baseHeaders[key] = value;
      };

      const headers = init.headers;
      if (headers instanceof Headers) {
        headers.forEach((value, key) => {
          appendHeader(key, value);
        });
      } else if (Array.isArray(headers)) {
        headers.forEach(([key, value]) => {
          if (typeof value === 'string') {
            appendHeader(key, value);
          }
        });
      } else if (typeof headers === 'object') {
        Object.entries(headers).forEach(([key, value]) => {
          if (typeof value === 'string') {
            appendHeader(key, value);
          } else if (Array.isArray(value)) {
            appendHeader(key, (value as string[]).join(', '));
          } else if (value !== undefined && value !== null) {
            appendHeader(key, String(value));
          }
        });
      }

      return baseHeaders;
    };

    const collectResponseHeaders = (rawHeaders: http.IncomingHttpHeaders) => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(rawHeaders)) {
        if (!key) continue;
        if (Array.isArray(value)) {
          headers.append(key, value.join(', '));
        } else if (value !== undefined) {
          headers.append(key, value);
        }
      }
      return headers;
    };

    const writeRequestBody = (req: http.ClientRequest, body: unknown): void => {
      if (!body) {
        req.end();
        return;
      }

      if (typeof body === 'string' || body instanceof Buffer) {
        req.write(body);
        req.end();
        return;
      }

      if (body instanceof ArrayBuffer) {
        req.write(Buffer.from(body));
        req.end();
        return;
      }

      if (ArrayBuffer.isView(body)) {
        req.write(Buffer.from(body.buffer, body.byteOffset, body.byteLength));
        req.end();
        return;
      }

      try {
        req.write(body as Parameters<typeof req.write>[0]);
      } catch {
        req.write(String(body));
      }
      req.end();
    };

    const delay = (ms: number) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      });

    const makeRequest = async (
      url: string,
      init?: RequestInit,
      attempt = 0,
    ): Promise<Response> =>
      new Promise((resolve, reject) => {
        let parsedUrl: URL;
        try {
          parsedUrl = new URL(url);
        } catch (error) {
          reject(
            new Error(
              `Invalid URL provided to socket-aware fetch: ${url} (${String(error)})`,
            ),
          );
          return;
        }

        const isHttps = parsedUrl.protocol === 'https:';
        const httpModule = isHttps ? https : http;

        const options: http.RequestOptions = {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port ? Number(parsedUrl.port) : isHttps ? 443 : 80,
          path: `${parsedUrl.pathname}${parsedUrl.search}`,
          method: init?.method?.toUpperCase() || 'GET',
          headers: buildHeaders(init),
        };

        const req = httpModule.request(options, (res) => {
          const chunks: Buffer[] = [];
          let chunkCount = 0;

          res.on('data', (chunk) => {
            chunkCount += 1;
            if (typeof chunk === 'string') {
              chunks.push(Buffer.from(chunk));
            } else {
              chunks.push(chunk);
            }
          });

          res.on('end', () => {
            const bodyBuffer = Buffer.concat(chunks);
            resolve(
              new Response(bodyBuffer, {
                status: res.statusCode ?? 0,
                statusText: res.statusMessage ?? '',
                headers: collectResponseHeaders(res.headers),
              }),
            );
          });

          res.on('error', async (error) => {
            if (
              chunkCount >= partialResponseThreshold &&
              attempt < maxRetries
            ) {
              await delay(retryDelay);
              try {
                const retryResponse = await makeRequest(url, init, attempt + 1);
                resolve(retryResponse);
                return;
              } catch (retryError) {
                reject(retryError);
                return;
              }
            }

            reject(new Error(`Response stream error: ${String(error)}`));
          });
        });

        req.on('socket', (socket) => {
          if (socket instanceof net.Socket) {
            socket.setTimeout(timeout);
            socket.setKeepAlive(keepAlive, 1000);
            socket.setNoDelay(noDelay);
          }
        });

        req.setTimeout(timeout, () => {
          req.destroy(new Error(`Request timed out after ${timeout}ms`));
        });

        if (init?.signal) {
          const abortHandler = () => {
            const abortError = new Error('Request aborted');
            (abortError as Error & { name: string }).name = 'AbortError';
            req.destroy(abortError);
          };

          if (init.signal.aborted) {
            abortHandler();
            return;
          }

          init.signal.addEventListener('abort', abortHandler);
          req.on('close', () => {
            init.signal?.removeEventListener('abort', abortHandler);
          });
        }

        req.on('error', async (error) => {
          if (attempt < maxRetries) {
            await delay(retryDelay);
            try {
              const retryResponse = await makeRequest(url, init, attempt + 1);
              resolve(retryResponse);
              return;
            } catch (retryError) {
              reject(retryError);
              return;
            }
          }

          reject(new Error(`Request failed: ${String(error)}`));
        });

        writeRequestBody(req, init?.body ?? null);
      });

    return async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;

      if (typeof url !== 'string') {
        return fetch(input, init);
      }

      return makeRequest(url, init);
    };
  }

  private async loadModelParamsFromSettings(): Promise<void> {
    const params = await this.getModelParamsFromSettings();
    this.modelParams = params;
  }

  private async resolveModelParams(): Promise<
    Record<string, unknown> | undefined
  > {
    if (this.modelParams) {
      return this.modelParams;
    }
    const params = await this.getModelParamsFromSettings();
    if (params) {
      this.modelParams = params;
    }
    return params;
  }

  /**
   * Get or create OpenAI client instance
   * Will use the API key from resolved auth
   * @returns OpenAI client instance
   */
  private async getClient(): Promise<OpenAI> {
    const resolvedKey = await this.getAuthToken();
    // Use the unified getBaseURL() method from BaseProvider
    const baseURL = this.getBaseURL();
    const socketSettings = this.getSocketSettings();
    const socketKey = socketSettings
      ? JSON.stringify(socketSettings)
      : 'default';
    const clientKey = `${baseURL}-${resolvedKey}-${socketKey}`;

    // Clear cache if we have no valid auth (e.g., after logout)
    if (!resolvedKey && this._cachedClient) {
      this._cachedClient = undefined;
      this._cachedClientKey = undefined;
    }

    // Return cached client if available and auth hasn't changed
    if (this._cachedClient && this._cachedClientKey === clientKey) {
      return this._cachedClient;
    }

    const baseOptions: ConstructorParameters<typeof OpenAI>[0] & {
      fetch?: typeof fetch;
    } = {
      apiKey: resolvedKey || '',
      baseURL,
      // CRITICAL: Disable OpenAI SDK's built-in retries so our retry logic can handle them
      // This allows us to track throttle wait times properly
      maxRetries: 0,
    };

    if (socketSettings) {
      baseOptions.timeout = socketSettings.timeout;
      baseOptions.fetch = this.createSocketAwareFetch(socketSettings);
    }

    // Create new client with current auth and optional socket configuration
    // Cast to unknown then to the expected type to bypass TypeScript's structural checking
    this._cachedClient = new OpenAI(
      baseOptions as unknown as ConstructorParameters<typeof OpenAI>[0],
    );
    this._cachedClientKey = clientKey;

    return this._cachedClient;
  }

  /**
   * Check if OAuth is supported for this provider
   * Qwen endpoints support OAuth, standard OpenAI does not
   */
  protected supportsOAuth(): boolean {
    // CRITICAL FIX: Check provider name first for cases where base URL is changed by profiles
    // This handles the cerebrasqwen3 profile case where base-url is changed to cerebras.ai
    // but the provider name is still 'qwen' due to Object.defineProperty override
    if (this.name === 'qwen') {
      return true;
    }

    // Fallback to base URL check for direct instantiation
    const baseURL = this.getBaseURL();
    if (
      baseURL &&
      (baseURL.includes('dashscope.aliyuncs.com') ||
        baseURL.includes('api.qwen.com') ||
        baseURL.includes('qwen'))
    ) {
      return true;
    }

    // Standard OpenAI endpoints don't support OAuth
    return false;
  }

  override async getModels(): Promise<IModel[]> {
    try {
      // Always try to fetch models, regardless of auth status
      // Local endpoints often work without authentication
      const client = await this.getClient();
      const response = await client.models.list();
      const models: IModel[] = [];

      for await (const model of response) {
        // Filter out non-chat models (embeddings, audio, image, vision, DALL·E, etc.)
        if (
          !/embedding|whisper|audio|tts|image|vision|dall[- ]?e|moderation/i.test(
            model.id,
          )
        ) {
          models.push({
            id: model.id,
            name: model.id,
            provider: 'openai',
            supportedToolFormats: ['openai'],
          });
        }
      }

      return models;
    } catch (error) {
      this.logger.debug(() => `Error fetching models from OpenAI: ${error}`);
      // Return a hardcoded list as fallback
      return this.getFallbackModels();
    }
  }

  private getFallbackModels(): IModel[] {
    return [];
  }

  override getDefaultModel(): string {
    // Return hardcoded default - do NOT call getModel() to avoid circular dependency
    // Check if this is a Qwen provider instance based on baseURL
    const baseURL = this.getBaseURL();
    if (
      baseURL &&
      (baseURL.includes('qwen') || baseURL.includes('dashscope'))
    ) {
      return process.env.LLXPRT_DEFAULT_MODEL || 'qwen3-coder-plus';
    }
    return process.env.LLXPRT_DEFAULT_MODEL || 'gpt-5';
  }

  /**
   * Set the model to use for this provider
   * This updates the model in ephemeral settings so it's immediately available
   */
  override setModel(modelId: string): void {
    const settingsService = getSettingsService();
    settingsService.set('model', modelId);
    this.logger.debug(() => `Model set to: ${modelId}`);
  }

  /**
   * Get the currently selected model
   */
  override getCurrentModel(): string {
    return this.getModel();
  }

  /**
   * Clear the cached OpenAI client
   * Should be called when authentication state changes (e.g., after logout)
   */
  // eslint-disable-next-line @typescript-eslint/explicit-member-accessibility
  public clearClientCache(): void {
    this._cachedClient = undefined;
    this._cachedClientKey = undefined;
  }

  /**
   * Override isAuthenticated for qwen provider to check OAuth directly
   */
  override async isAuthenticated(): Promise<boolean> {
    const config = this.providerConfig as IProviderConfig & {
      forceQwenOAuth?: boolean;
    };
    if (this.name === 'qwen' && config?.forceQwenOAuth) {
      // For qwen with forceQwenOAuth, check OAuth directly
      if (this.baseProviderConfig.oauthManager) {
        try {
          const oauthProviderName =
            this.baseProviderConfig.oauthProvider || 'qwen';
          const token =
            await this.baseProviderConfig.oauthManager.getToken(
              oauthProviderName,
            );
          return token !== null;
        } catch {
          return false;
        }
      }
      return false;
    }

    // For non-qwen providers, use the normal check
    return super.isAuthenticated();
  }

  /**
   * Override getAuthToken for qwen provider to skip SettingsService auth checks
   * This ensures qwen always uses OAuth even when other profiles set auth-key/auth-keyfile
   */
  protected override async getAuthToken(): Promise<string> {
    // If this is the qwen provider and we have forceQwenOAuth, skip SettingsService checks
    const config = this.providerConfig as IProviderConfig & {
      forceQwenOAuth?: boolean;
    };
    if (this.name === 'qwen' && config?.forceQwenOAuth) {
      // Check cache first (short-lived cache to avoid repeated OAuth calls)
      if (
        this.cachedAuthToken &&
        this.authCacheTimestamp &&
        Date.now() - this.authCacheTimestamp < this.AUTH_CACHE_DURATION
      ) {
        return this.cachedAuthToken;
      }

      // Clear stale cache
      this.cachedAuthToken = undefined;
      this.authCacheTimestamp = undefined;

      // For qwen, skip directly to OAuth without checking SettingsService
      // Use 'qwen' as the provider name even if baseProviderConfig.oauthProvider is not set
      const oauthProviderName = this.baseProviderConfig.oauthProvider || 'qwen';
      if (this.baseProviderConfig.oauthManager) {
        try {
          const token =
            await this.baseProviderConfig.oauthManager.getToken(
              oauthProviderName,
            );
          if (token) {
            // Cache the token briefly
            this.cachedAuthToken = token;
            this.authCacheTimestamp = Date.now();
            return token;
          }
        } catch (error) {
          if (process.env.DEBUG) {
            console.warn(`[qwen] OAuth authentication failed:`, error);
          }
        }
      }

      // No OAuth available, return empty string
      return '';
    }

    // For non-qwen providers, use the normal auth precedence chain
    return super.getAuthToken();
  }

  /**
   * Clear all provider state (for provider switching)
   * Clears both OpenAI client cache and auth token cache
   */
  override clearState(): void {
    // Clear OpenAI client cache
    this.clearClientCache();
    // Clear auth token cache from BaseProvider
    this.clearAuthCache();
  }

  override getServerTools(): string[] {
    // TODO: Implement server tools for OpenAI provider
    return [];
  }

  override async invokeServerTool(
    toolName: string,
    _params: unknown,
    _config?: unknown,
    _signal?: AbortSignal,
  ): Promise<unknown> {
    // TODO: Implement server tool invocation for OpenAI provider
    throw new Error(
      `Server tool '${toolName}' not supported by OpenAI provider`,
    );
  }

  /**
   * Normalize tool IDs from various formats to OpenAI format
   * Handles IDs from OpenAI (call_xxx), Anthropic (toolu_xxx), and history (hist_tool_xxx)
   */
  private normalizeToOpenAIToolId(id: string): string {
    // If already in OpenAI format, return as-is
    if (id.startsWith('call_')) {
      return id;
    }

    // For history format, extract the UUID and add OpenAI prefix
    if (id.startsWith('hist_tool_')) {
      const uuid = id.substring('hist_tool_'.length);
      return 'call_' + uuid;
    }

    // For Anthropic format, extract the UUID and add OpenAI prefix
    if (id.startsWith('toolu_')) {
      const uuid = id.substring('toolu_'.length);
      return 'call_' + uuid;
    }

    // Unknown format - assume it's a raw UUID
    return 'call_' + id;
  }

  /**
   * Normalize tool IDs from OpenAI format to history format
   */
  private normalizeToHistoryToolId(id: string): string {
    // If already in history format, return as-is
    if (id.startsWith('hist_tool_')) {
      return id;
    }

    // For OpenAI format, extract the UUID and add history prefix
    if (id.startsWith('call_')) {
      const uuid = id.substring('call_'.length);
      return 'hist_tool_' + uuid;
    }

    // For Anthropic format, extract the UUID and add history prefix
    if (id.startsWith('toolu_')) {
      const uuid = id.substring('toolu_'.length);
      return 'hist_tool_' + uuid;
    }

    // Unknown format - assume it's a raw UUID
    return 'hist_tool_' + id;
  }

  /**
   * Generate chat completion with IContent interface
   * Internally converts to OpenAI API format, but only yields IContent
   * @param contents Array of content blocks (text and tool_call)
   * @param tools Array of available tools
   */
  override async *generateChatCompletion(
    contents: IContent[],
    tools?: Array<{
      functionDeclarations: Array<{
        name: string;
        description?: string;
        parametersJsonSchema?: unknown;
      }>;
    }>,
  ): AsyncIterableIterator<IContent> {
    // Debug log what we receive
    if (this.logger.enabled) {
      this.logger.debug(
        () => `[OpenAIProvider] generateChatCompletion received tools:`,
        {
          hasTools: !!tools,
          toolsLength: tools?.length,
          toolsType: typeof tools,
          isArray: Array.isArray(tools),
          firstToolName: tools?.[0]?.functionDeclarations?.[0]?.name,
          toolsStructure: tools ? 'available' : 'undefined',
        },
      );
    }

    // Pass tools directly in Gemini format - they'll be converted in generateChatCompletionImpl
    const generator = this.generateChatCompletionImpl(
      contents,
      tools,
      undefined,
      undefined,
      undefined,
    );

    for await (const item of generator) {
      yield item;
    }
  }

  /**
   * Convert IContent array to OpenAI ChatCompletionMessageParam array
   */
  private convertToOpenAIMessages(
    contents: IContent[],
  ): OpenAI.Chat.ChatCompletionMessageParam[] {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    for (const content of contents) {
      if (content.speaker === 'human') {
        // Convert human messages to user messages
        const textBlocks = content.blocks.filter(
          (b) => b.type === 'text',
        ) as TextBlock[];
        const text = textBlocks.map((b) => b.text).join('\n');
        if (text) {
          messages.push({
            role: 'user',
            content: text,
          });
        }
      } else if (content.speaker === 'ai') {
        // Convert AI messages
        const textBlocks = content.blocks.filter(
          (b) => b.type === 'text',
        ) as TextBlock[];
        const toolCalls = content.blocks.filter(
          (b) => b.type === 'tool_call',
        ) as ToolCallBlock[];

        if (toolCalls.length > 0) {
          // Assistant message with tool calls
          const text = textBlocks.map((b) => b.text).join('\n');
          messages.push({
            role: 'assistant',
            content: text || null,
            tool_calls: toolCalls.map((tc) => ({
              id: this.normalizeToOpenAIToolId(tc.id),
              type: 'function' as const,
              function: {
                name: tc.name,
                arguments:
                  typeof tc.parameters === 'string'
                    ? tc.parameters
                    : JSON.stringify(tc.parameters),
              },
            })),
          });
        } else if (textBlocks.length > 0) {
          // Plain assistant message
          const text = textBlocks.map((b) => b.text).join('\n');
          messages.push({
            role: 'assistant',
            content: text,
          });
        }
      } else if (content.speaker === 'tool') {
        // Convert tool responses
        const toolResponses = content.blocks.filter(
          (b) => b.type === 'tool_response',
        ) as ToolResponseBlock[];
        for (const tr of toolResponses) {
          messages.push({
            role: 'tool',
            content:
              typeof tr.result === 'string'
                ? tr.result
                : JSON.stringify(tr.result),
            tool_call_id: this.normalizeToOpenAIToolId(tr.callId),
          });
        }
      }
    }

    return messages;
  }

  /**
   * Internal implementation for chat completion
   */
  private async *generateChatCompletionImpl(
    contents: IContent[],
    tools?: Array<{
      functionDeclarations: Array<{
        name: string;
        description?: string;
        parametersJsonSchema?: unknown;
      }>;
    }>,
    maxTokens?: number,
    abortSignal?: AbortSignal,
    modelName?: string,
  ): AsyncGenerator<IContent, void, unknown> {
    // Always look up model from SettingsService
    const model = modelName || this.getModel() || this.getDefaultModel();

    // Convert IContent to OpenAI messages format
    const messages = this.convertToOpenAIMessages(contents);

    // Detect the tool format to use (once at the start of the method)
    const detectedFormat = this.detectToolFormat();

    // Log the detected format for debugging
    this.logger.debug(
      () =>
        `[OpenAIProvider] Using tool format '${detectedFormat}' for model '${model}'`,
      {
        model,
        detectedFormat,
        provider: this.name,
      },
    );

    // Convert Gemini format tools to the detected format
    let formattedTools = this.toolFormatter.convertGeminiToFormat(
      tools,
      detectedFormat,
    ) as
      | Array<{
          type: 'function';
          function: {
            name: string;
            description: string;
            parameters: Record<string, unknown>;
          };
        }>
      | undefined;

    // CRITICAL FIX: Ensure we never pass an empty tools array
    // The OpenAI API errors when tools=[] but a tool call is attempted
    if (Array.isArray(formattedTools) && formattedTools.length === 0) {
      this.logger.warn(
        () =>
          `[OpenAIProvider] CRITICAL: Formatted tools is empty array! Setting to undefined to prevent API errors.`,
        {
          model,
          inputTools: tools,
          inputToolsLength: tools?.length,
          inputFirstGroup: tools?.[0],
          stackTrace: new Error().stack,
        },
      );
      formattedTools = undefined;
    }

    // Debug log the conversion result - enhanced logging for intermittent issues
    if (this.logger.enabled && formattedTools) {
      this.logger.debug(() => `[OpenAIProvider] Tool conversion summary:`, {
        detectedFormat,
        inputHadTools: !!tools,
        inputToolsLength: tools?.length,
        inputFirstGroup: tools?.[0],
        inputFunctionDeclarationsLength:
          tools?.[0]?.functionDeclarations?.length,
        outputHasTools: !!formattedTools,
        outputToolsLength: formattedTools?.length,
        outputToolNames: formattedTools?.map((t) => t.function.name),
      });
    }

    // Get streaming setting from ephemeral settings (default: enabled)
    const streamingSetting =
      this.providerConfig?.getEphemeralSettings?.()?.['streaming'];
    const streamingEnabled = streamingSetting !== 'disabled';

    // Get the system prompt
    const flattenedToolNames =
      tools?.flatMap((group) =>
        group.functionDeclarations
          .map((decl) => decl.name)
          .filter((name): name is string => !!name),
      ) ?? [];
    const toolNamesArg =
      tools === undefined ? undefined : Array.from(new Set(flattenedToolNames));

    const userMemory = this.globalConfig?.getUserMemory
      ? this.globalConfig.getUserMemory()
      : '';
    const systemPrompt = await getCoreSystemPromptAsync(
      userMemory,
      model,
      toolNamesArg,
    );

    // Add system prompt as the first message in the array
    const messagesWithSystem: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];

    // Build request - only include tools if they exist and are not empty
    // IMPORTANT: Create a deep copy of tools to prevent mutation issues
    const requestBody: OpenAI.Chat.ChatCompletionCreateParams = {
      model,
      messages: messagesWithSystem,
      ...(formattedTools && formattedTools.length > 0
        ? {
            // Deep clone the tools array to prevent any mutation issues
            tools: JSON.parse(JSON.stringify(formattedTools)),
            // Add tool_choice for Qwen/Cerebras to ensure proper tool calling
            tool_choice: 'auto',
          }
        : {}),
      max_tokens: maxTokens,
      stream: streamingEnabled,
    };

    const modelParams = await this.resolveModelParams();
    if (modelParams) {
      Object.assign(requestBody, modelParams);
    }

    // Debug log request summary for Cerebras/Qwen
    if (
      this.logger.enabled &&
      (model.toLowerCase().includes('qwen') ||
        this.getBaseURL()?.includes('cerebras'))
    ) {
      this.logger.debug(
        () => `Request to ${this.getBaseURL()} for model ${model}:`,
        {
          baseURL: this.getBaseURL(),
          model,
          streamingEnabled,
          hasTools: 'tools' in requestBody,
          toolCount: formattedTools?.length || 0,
          messageCount: messages.length,
          toolsInRequest:
            'tools' in requestBody ? requestBody.tools?.length : 'not included',
        },
      );
    }

    // Get OpenAI client
    const client = await this.getClient();

    // Get retry settings from ephemeral settings
    const ephemeralSettings =
      this.providerConfig?.getEphemeralSettings?.() || {};
    const maxRetries =
      (ephemeralSettings['retries'] as number | undefined) ?? 6; // Default for OpenAI
    const initialDelayMs =
      (ephemeralSettings['retrywait'] as number | undefined) ?? 4000; // Default for OpenAI

    // Get stream options from ephemeral settings (default: include usage for token tracking)
    const streamOptions = (ephemeralSettings['stream-options'] as
      | { include_usage?: boolean }
      | undefined) || { include_usage: true };

    // Add stream options to request if streaming is enabled
    if (streamingEnabled && streamOptions) {
      Object.assign(requestBody, { stream_options: streamOptions });
    }

    // Log the exact tools being sent for debugging
    if (this.logger.enabled && 'tools' in requestBody) {
      this.logger.debug(
        () => `[OpenAIProvider] Exact tools being sent to API:`,
        {
          toolCount: requestBody.tools?.length,
          toolNames: requestBody.tools?.map((t) =>
            'function' in t ? t.function?.name : undefined,
          ),
          firstTool: requestBody.tools?.[0],
        },
      );
    }

    // Wrap the API call with retry logic using centralized retry utility
    let response;

    // Debug log throttle tracker status
    this.logger.debug(() => `Retry configuration:`, {
      hasThrottleTracker: !!this.throttleTracker,
      throttleTrackerType: typeof this.throttleTracker,
      maxRetries,
      initialDelayMs,
    });

    const customHeaders = this.getCustomHeaders();

    try {
      response = await retryWithBackoff(
        () =>
          client.chat.completions.create(requestBody, {
            ...(abortSignal ? { signal: abortSignal } : {}),
            ...(customHeaders ? { headers: customHeaders } : {}),
          }),
        {
          maxAttempts: maxRetries,
          initialDelayMs,
          shouldRetry: this.shouldRetryResponse.bind(this),
          trackThrottleWaitTime: this.throttleTracker,
        },
      );
    } catch (error) {
      // Special handling for Cerebras/Qwen "Tool not present" errors
      const errorMessage = String(error);
      if (
        errorMessage.includes('Tool is not present in the tools list') &&
        (model.toLowerCase().includes('qwen') ||
          this.getBaseURL()?.includes('cerebras'))
      ) {
        this.logger.error(
          'Cerebras/Qwen API error: Tool not found despite being in request. This is a known API issue.',
          {
            error,
            model,
            toolsProvided: formattedTools?.length || 0,
            toolNames: formattedTools?.map((t) => t.function.name),
            streamingEnabled,
          },
        );
        // Re-throw but with better context
        const enhancedError = new Error(
          `Cerebras/Qwen API bug: Tool not found in list. We sent ${formattedTools?.length || 0} tools. Known API issue.`,
        );
        (enhancedError as Error & { originalError?: unknown }).originalError =
          error;
        throw enhancedError;
      }
      // Re-throw other errors as-is
      throw error;
    }

    // Check if response is streaming or not
    if (streamingEnabled) {
      // Process streaming response
      let _accumulatedText = '';
      const accumulatedToolCalls: Array<{
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      }> = [];

      // Buffer for accumulating text chunks for providers that need it
      let textBuffer = '';
      // Use the same detected format from earlier for consistency
      // Buffer text for Qwen format providers to avoid stanza formatting
      const shouldBufferText = detectedFormat === 'qwen';

      // Track token usage from streaming chunks
      let streamingUsage: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      } | null = null;

      try {
        // Handle streaming response
        for await (const chunk of response as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>) {
          if (abortSignal?.aborted) {
            break;
          }

          // Extract usage information if present (typically in final chunk)
          if (chunk.usage) {
            streamingUsage = chunk.usage;
          }

          const choice = chunk.choices?.[0];
          if (!choice) continue;

          // Check for finish_reason to detect proper stream ending
          if (choice.finish_reason) {
            this.logger.debug(
              () =>
                `[Streaming] Stream finished with reason: ${choice.finish_reason}`,
              {
                model,
                finishReason: choice.finish_reason,
                hasAccumulatedText: _accumulatedText.length > 0,
                hasAccumulatedTools: accumulatedToolCalls.length > 0,
                hasBufferedText: textBuffer.length > 0,
              },
            );

            // If finish_reason is 'length', the response was cut off
            if (choice.finish_reason === 'length') {
              this.logger.debug(
                () =>
                  `Response truncated due to length limit for model ${model}`,
              );
            }

            // Flush any buffered text when stream finishes
            if (textBuffer.length > 0) {
              yield {
                speaker: 'ai',
                blocks: [
                  {
                    type: 'text',
                    text: textBuffer,
                  } as TextBlock,
                ],
              } as IContent;
              textBuffer = '';
            }
          }

          // Handle text content - buffer for Qwen format, emit immediately for others
          const deltaContent = choice.delta?.content;
          if (deltaContent) {
            _accumulatedText += deltaContent;

            // Debug log for providers that need buffering
            if (shouldBufferText) {
              this.logger.debug(
                () => `[Streaming] Chunk content for ${detectedFormat} format:`,
                {
                  deltaContent,
                  length: deltaContent.length,
                  hasNewline: deltaContent.includes('\n'),
                  escaped: JSON.stringify(deltaContent),
                  bufferSize: textBuffer.length,
                },
              );

              // Buffer text to avoid stanza formatting
              textBuffer += deltaContent;

              // Emit buffered text when we have a complete sentence or paragraph
              // Look for natural break points
              if (
                textBuffer.endsWith('. ') ||
                textBuffer.endsWith('! ') ||
                textBuffer.endsWith('? ') ||
                textBuffer.length > 100
              ) {
                yield {
                  speaker: 'ai',
                  blocks: [
                    {
                      type: 'text',
                      text: textBuffer,
                    } as TextBlock,
                  ],
                } as IContent;
                textBuffer = '';
              }
            } else {
              // For other providers, emit text immediately as before
              yield {
                speaker: 'ai',
                blocks: [
                  {
                    type: 'text',
                    text: deltaContent,
                  } as TextBlock,
                ],
              } as IContent;
            }
          }

          // Handle tool calls
          const deltaToolCalls = choice.delta?.tool_calls;
          if (deltaToolCalls && deltaToolCalls.length > 0) {
            for (const deltaToolCall of deltaToolCalls) {
              if (deltaToolCall.index === undefined) continue;

              // Initialize or update accumulated tool call
              if (!accumulatedToolCalls[deltaToolCall.index]) {
                accumulatedToolCalls[deltaToolCall.index] = {
                  id: deltaToolCall.id || '',
                  type: 'function',
                  function: {
                    name: deltaToolCall.function?.name || '',
                    arguments: '',
                  },
                };
              }

              const tc = accumulatedToolCalls[deltaToolCall.index];
              if (tc) {
                if (deltaToolCall.id) tc.id = deltaToolCall.id;
                if (deltaToolCall.function?.name)
                  tc.function.name = deltaToolCall.function.name;
                if (deltaToolCall.function?.arguments) {
                  tc.function.arguments += deltaToolCall.function.arguments;
                }
              }
            }
          }
        }
      } catch (error) {
        if (abortSignal?.aborted) {
          throw error;
        } else {
          // Special handling for Cerebras/Qwen "Tool not present" errors
          const errorMessage = String(error);
          if (
            errorMessage.includes('Tool is not present in the tools list') &&
            (model.toLowerCase().includes('qwen') ||
              this.getBaseURL()?.includes('cerebras'))
          ) {
            this.logger.error(
              'Cerebras/Qwen API error: Tool not found despite being in request. This is a known API issue.',
              {
                error,
                model,
                toolsProvided: formattedTools?.length || 0,
                toolNames: formattedTools?.map((t) => t.function.name),
              },
            );
            // Re-throw but with better context
            const enhancedError = new Error(
              `Cerebras/Qwen API bug: Tool not found in list during streaming. We sent ${formattedTools?.length || 0} tools. Known API issue.`,
            );
            (
              enhancedError as Error & { originalError?: unknown }
            ).originalError = error;
            throw enhancedError;
          }
          this.logger.error('Error processing streaming response:', error);
          throw error;
        }
      }

      // Flush any remaining buffered text
      if (textBuffer.length > 0) {
        yield {
          speaker: 'ai',
          blocks: [
            {
              type: 'text',
              text: textBuffer,
            } as TextBlock,
          ],
        } as IContent;
        textBuffer = '';
      }

      // Emit accumulated tool calls as IContent if any
      if (accumulatedToolCalls.length > 0) {
        const blocks: ToolCallBlock[] = [];
        // Use the same detected format from earlier for consistency

        for (const tc of accumulatedToolCalls) {
          if (!tc) continue;

          // Process tool parameters with double-escape handling
          const processedParameters = processToolParameters(
            tc.function.arguments || '',
            tc.function.name || '',
            detectedFormat,
          );

          blocks.push({
            type: 'tool_call',
            id: this.normalizeToHistoryToolId(tc.id),
            name: tc.function.name || '',
            parameters: processedParameters,
          });
        }

        if (blocks.length > 0) {
          const toolCallsContent: IContent = {
            speaker: 'ai',
            blocks,
          };

          // Add usage metadata if we captured it from streaming
          if (streamingUsage) {
            toolCallsContent.metadata = {
              usage: {
                promptTokens: streamingUsage.prompt_tokens || 0,
                completionTokens: streamingUsage.completion_tokens || 0,
                totalTokens:
                  streamingUsage.total_tokens ||
                  (streamingUsage.prompt_tokens || 0) +
                    (streamingUsage.completion_tokens || 0),
              },
            };
          }

          yield toolCallsContent;
        }
      }

      // If we have usage information but no tool calls, emit a metadata-only response
      if (streamingUsage && accumulatedToolCalls.length === 0) {
        yield {
          speaker: 'ai',
          blocks: [],
          metadata: {
            usage: {
              promptTokens: streamingUsage.prompt_tokens || 0,
              completionTokens: streamingUsage.completion_tokens || 0,
              totalTokens:
                streamingUsage.total_tokens ||
                (streamingUsage.prompt_tokens || 0) +
                  (streamingUsage.completion_tokens || 0),
            },
          },
        } as IContent;
      }
    } else {
      // Handle non-streaming response
      const completion = response as OpenAI.Chat.Completions.ChatCompletion;
      const choice = completion.choices?.[0];

      if (!choice) {
        throw new Error('No choices in completion response');
      }

      // Log finish reason for debugging Qwen issues
      if (choice.finish_reason) {
        this.logger.debug(
          () =>
            `[Non-streaming] Response finish_reason: ${choice.finish_reason}`,
          {
            model,
            finishReason: choice.finish_reason,
            hasContent: !!choice.message?.content,
            hasToolCalls: !!(
              choice.message?.tool_calls && choice.message.tool_calls.length > 0
            ),
            contentLength: choice.message?.content?.length || 0,
            toolCallCount: choice.message?.tool_calls?.length || 0,
            detectedFormat,
          },
        );

        // Warn if the response was truncated
        if (choice.finish_reason === 'length') {
          this.logger.warn(
            () =>
              `Response truncated due to max_tokens limit for model ${model}. Consider increasing max_tokens.`,
          );
        }
      }

      const blocks: Array<TextBlock | ToolCallBlock> = [];

      // Handle text content
      if (choice.message?.content) {
        blocks.push({
          type: 'text',
          text: choice.message.content,
        } as TextBlock);
      }

      // Handle tool calls
      if (choice.message?.tool_calls && choice.message.tool_calls.length > 0) {
        // Use the same detected format from earlier for consistency

        for (const toolCall of choice.message.tool_calls) {
          if (toolCall.type === 'function') {
            // Process tool parameters with double-escape handling
            const processedParameters = processToolParameters(
              toolCall.function.arguments || '',
              toolCall.function.name || '',
              detectedFormat,
            );

            blocks.push({
              type: 'tool_call',
              id: this.normalizeToHistoryToolId(toolCall.id),
              name: toolCall.function.name || '',
              parameters: processedParameters,
            } as ToolCallBlock);
          }
        }
      }

      // Emit the complete response as a single IContent
      if (blocks.length > 0) {
        const responseContent: IContent = {
          speaker: 'ai',
          blocks,
        };

        // Add usage metadata from non-streaming response
        if (completion.usage) {
          responseContent.metadata = {
            usage: {
              promptTokens: completion.usage.prompt_tokens || 0,
              completionTokens: completion.usage.completion_tokens || 0,
              totalTokens:
                completion.usage.total_tokens ||
                (completion.usage.prompt_tokens || 0) +
                  (completion.usage.completion_tokens || 0),
            },
          };
        }

        yield responseContent;
      } else if (completion.usage) {
        // Emit metadata-only response if no content blocks but have usage info
        yield {
          speaker: 'ai',
          blocks: [],
          metadata: {
            usage: {
              promptTokens: completion.usage.prompt_tokens || 0,
              completionTokens: completion.usage.completion_tokens || 0,
              totalTokens:
                completion.usage.total_tokens ||
                (completion.usage.prompt_tokens || 0) +
                  (completion.usage.completion_tokens || 0),
            },
          },
        } as IContent;
      }
    }
  }

  /**
   * Update model parameters and persist them in the SettingsService.
   */
  override setModelParams(params: Record<string, unknown> | undefined): void {
    if (params === undefined) {
      this.modelParams = undefined;
      this.setModelParamsInSettings(undefined).catch((error) => {
        this.logger.debug(
          () => `Failed to clear model params in SettingsService: ${error}`,
        );
      });
      return;
    }

    const updated = { ...(this.modelParams ?? {}) };

    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) {
        delete updated[key];
      } else {
        updated[key] = value;
      }
    }

    this.modelParams = Object.keys(updated).length > 0 ? updated : undefined;

    this.setModelParamsInSettings(this.modelParams).catch((error) => {
      this.logger.debug(
        () => `Failed to persist model params to SettingsService: ${error}`,
      );
    });
  }

  override getModelParams(): Record<string, unknown> | undefined {
    return this.modelParams;
  }

  /**
   * Get the tool format for this provider
   * @returns The tool format to use
   */
  override getToolFormat(): string {
    const format = this.detectToolFormat();
    this.logger.debug(() => `getToolFormat() called, returning: ${format}`, {
      provider: this.name,
      model: this.getModel(),
      format,
    });
    return format;
  }

  /**
   * Set tool format override for this provider
   * @param format The format to use, or null to clear override
   */
  override setToolFormatOverride(format: string | null): void {
    const settingsService = getSettingsService();
    if (format === null) {
      settingsService.setProviderSetting(this.name, 'toolFormat', 'auto');
      this.logger.debug(() => `Tool format override cleared for ${this.name}`);
    } else {
      settingsService.setProviderSetting(this.name, 'toolFormat', format);
      this.logger.debug(
        () => `Tool format override set to '${format}' for ${this.name}`,
      );
    }

    // Clear cached client to ensure new format takes effect
    this._cachedClient = undefined;
    this._cachedClientKey = undefined;
  }

  /**
   * Detects the tool call format based on the model being used
   * @returns The detected tool format ('openai' or 'qwen')
   */
  private detectToolFormat(): ToolFormat {
    try {
      // Check for toolFormat override in provider settings
      const settingsService = getSettingsService();
      const currentSettings = settingsService['settings'];
      const providerSettings = currentSettings?.providers?.[this.name];
      const toolFormatOverride = providerSettings?.toolFormat as
        | ToolFormat
        | 'auto'
        | undefined;

      // If explicitly set to a specific format (not 'auto'), use it
      if (toolFormatOverride && toolFormatOverride !== 'auto') {
        this.logger.debug(
          () =>
            `Using tool format override '${toolFormatOverride}' for ${this.name}`,
        );
        return toolFormatOverride;
      }
    } catch (error) {
      this.logger.debug(
        () => `Failed to detect tool format from SettingsService: ${error}`,
      );
    }

    // Auto-detect based on model name if set to 'auto' or not set
    const modelName = (this.getModel() || this.getDefaultModel()).toLowerCase();

    // Check for GLM models (glm-4.5, glm-4-6, etc.) which require Qwen handling
    if (modelName.includes('glm-')) {
      this.logger.debug(
        () => `Auto-detected 'qwen' format for GLM model: ${modelName}`,
      );
      return 'qwen';
    }

    // Check for MiniMax models (minimax, mini-max, etc.) which require Qwen handling
    if (modelName.includes('minimax') || modelName.includes('mini-max')) {
      this.logger.debug(
        () => `Auto-detected 'qwen' format for MiniMax model: ${modelName}`,
      );
      return 'qwen';
    }

    // Check for qwen models
    if (modelName.includes('qwen')) {
      this.logger.debug(
        () => `Auto-detected 'qwen' format for Qwen model: ${modelName}`,
      );
      return 'qwen';
    }

    // Default to 'openai' format
    this.logger.debug(
      () => `Using default 'openai' format for model: ${modelName}`,
    );
    return 'openai';
  }

  /**
   * Parse tool response from API (placeholder for future response parsing)
   * @param response The raw API response
   * @returns Parsed tool response
   */
  parseToolResponse(response: unknown): unknown {
    // TODO: Implement response parsing based on detected format
    // For now, return the response as-is
    return response;
  }

  /**
   * Determines whether a response should be retried based on error codes
   * @param error The error object from the API response
   * @returns true if the request should be retried, false otherwise
   */
  shouldRetryResponse(error: unknown): boolean {
    // Don't retry if we're streaming chunks - just continue processing
    if (
      error &&
      typeof error === 'object' &&
      'status' in error &&
      (error as { status?: number }).status === 200
    ) {
      return false;
    }

    // Check OpenAI SDK v5 error structure
    let status: number | undefined;

    // OpenAI SDK v5 error structure
    if (error && typeof error === 'object' && 'status' in error) {
      status = (error as { status?: number }).status;
    }

    // Also check error.response?.status for axios-style errors
    if (!status && error && typeof error === 'object' && 'response' in error) {
      const response = (error as { response?: { status?: number } }).response;
      if (response && typeof response === 'object' && 'status' in response) {
        status = response.status;
      }
    }

    // Also check error message for 429
    if (!status && error instanceof Error) {
      if (error.message.includes('429')) {
        status = 429;
      }
    }

    // Log what we're seeing
    this.logger.debug(() => `shouldRetryResponse checking error:`, {
      hasError: !!error,
      errorType: error?.constructor?.name,
      status,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorKeys: error && typeof error === 'object' ? Object.keys(error) : [],
    });

    // Retry on 429 rate limit errors or 5xx server errors
    if (status === 429 || (status && status >= 500 && status < 600)) {
      this.logger.debug(() => `Will retry request due to status ${status}`);
      return true;
    }

    if (isNetworkTransientError(error)) {
      this.logger.debug(
        () =>
          'Will retry request due to transient network error signature (connection-level failure).',
      );
      return true;
    }

    return false;
  }
}
