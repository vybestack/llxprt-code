/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type IModel } from '../IModel.js';
import { type IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  BaseProvider,
  type BaseProviderConfig,
  type NormalizedGenerateChatOptions,
} from '../BaseProvider.js';
import { type OAuthManager } from '@vybestack/llxprt-code-auth';
import type { createCodeAssistContentGenerator as _createCodeAssistContentGenerator } from '@vybestack/llxprt-code-core/code_assist/codeAssist.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import {
  type GenerateContentParameters,
  type GenerateContentResponse,
  type GoogleGenAI,
} from '@google/genai';
import {
  hasVertexAICredentials,
  isOAuthEnabled,
  setupVertexAIAuth,
  updateOAuthState,
  type GeminiAuthMode,
} from './geminiAuth.js';
import { throwIfAborted } from './geminiAbort.js';
import { resolveModelList } from './geminiModels.js';
import {
  invokeWebFetch,
  invokeWebSearch,
  type ServerToolContext,
} from './geminiServerTools.js';
import {
  buildGenerationSetup,
  type GeminiGenerationSetup,
} from './geminiGenerationSetup.js';
import {
  consumeGeminiStream,
  executeNonOAuthGeneration,
  executeOAuthGeneration,
  nonOAuthNonStreamingGenerate as executeNonOAuthNonStreamingGenerate,
  nonOAuthStreamingGenerate as executeNonOAuthStreamingGenerate,
  oauthNonStreamingGenerate as executeOAuthNonStreamingGenerate,
  oauthStreamingGenerate as executeOAuthStreamingGenerate,
  type GeminiGenerationResult,
  type NonOAuthContentGenerator,
  type OAuthContentGeneratorFactory,
} from './geminiGenerationExecution.js';

type CodeAssistGeneratorFactory = typeof _createCodeAssistContentGenerator;
type CodeAssistContentGenerator = Awaited<
  ReturnType<CodeAssistGeneratorFactory>
>;

/**
 * Represents the default Gemini provider.
 * This provider is implicitly active when no other provider is explicitly set.
 *
 * NOTE: This provider acts as a configuration layer for the native Gemini
 * integration. Concrete request preparation, response parsing, streaming,
 * and server-tool invocation are delegated to cohesive submodules in this
 * package to keep the provider class thin and within lint budgets.
 */
export class GeminiProvider extends BaseProvider {
  private readonly geminiOAuthManager?: OAuthManager;

  constructor(
    apiKey?: string,
    baseURL?: string,
    config?: Config,
    oauthManager?: OAuthManager,
  ) {
    const baseConfig: BaseProviderConfig = {
      name: 'gemini',
      apiKey,
      baseURL,
      envKeyNames: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
      isOAuthEnabled: !!oauthManager,
      oauthProvider: oauthManager ? 'gemini' : undefined,
      oauthManager,
    };

    super(baseConfig, config);
    this.geminiOAuthManager = oauthManager;
  }

  private getLogger(): DebugLogger {
    return new DebugLogger('llxprt:gemini:provider');
  }

  private getToolsLogger(): DebugLogger {
    return new DebugLogger('llxprt:gemini:tools');
  }

  private getStreamingPreference(
    _options: NormalizedGenerateChatOptions,
  ): boolean {
    const ephemeralSettings = this.providerConfig?.getEphemeralSettings?.();
    const streamingSetting = ephemeralSettings?.['streaming'];
    return streamingSetting !== 'disabled';
  }

  protected async createOAuthContentGenerator(
    httpOptions: Record<string, unknown>,
    config: Config,
    baseURL?: string,
  ): Promise<CodeAssistContentGenerator> {
    const { createCodeAssistContentGenerator } = await import(
      '@vybestack/llxprt-code-core/code_assist/codeAssist.js'
    );
    return createCodeAssistContentGenerator(httpOptions, config, baseURL);
  }

  clearClientCache(_runtimeKey?: string): void {
    this.getLogger().debug(
      () => 'Cache clear called on stateless provider - no operation',
    );
  }

  private updateOAuthState(): void {
    updateOAuthState(this.geminiOAuthManager, (enabled, provider, manager) =>
      this.updateOAuthConfig(enabled, provider, manager),
    );
  }

  private async determineBestAuth(): Promise<{
    authMode: GeminiAuthMode;
    token: string;
  }> {
    this.updateOAuthState();

    const standardAuth = await this.authResolver.resolveAuthentication({
      settingsService: this.resolveSettingsService(),
      includeOAuth: false,
    });

    if (standardAuth) {
      return { authMode: 'gemini-api-key', token: standardAuth };
    }

    if (hasVertexAICredentials()) {
      setupVertexAIAuth();
      return { authMode: 'vertex-ai', token: 'USE_VERTEX_AI' };
    }

    if (isOAuthEnabled(this.geminiOAuthManager, 'gemini')) {
      return { authMode: 'oauth', token: 'USE_LOGIN_WITH_GOOGLE' };
    }

    throw new Error(
      'No Gemini authentication configured. ' +
        'Set GEMINI_API_KEY environment variable, use --keyfile, or configure Vertex AI credentials.',
    );
  }

  protected supportsOAuth(): boolean {
    return isOAuthEnabled(this.geminiOAuthManager, 'gemini');
  }

  private createHttpOptions(): { headers: Record<string, string> } {
    const customHeaders = this.getCustomHeaders();
    return {
      headers: {
        'User-Agent': `LLxprt-Code/${process.env.CLI_VERSION ?? process.version} (${process.platform}; ${process.arch})`,
        ...(customHeaders ?? {}),
      },
    };
  }

  override setConfig(config: Config): void {
    super.setConfig?.(config);
    this.updateOAuthState();
  }

  async getModels(): Promise<IModel[]> {
    const defaultModels = resolveModelList(
      this.name,
      'oauth',
      () => Promise.resolve(''),
      () => this.getBaseURL(),
    );
    let authMode: GeminiAuthMode;
    try {
      const result = await this.determineBestAuth();
      authMode = result.authMode;
    } catch {
      return defaultModels;
    }
    return resolveModelList(
      this.name,
      authMode,
      () => this.getAuthToken(),
      () => this.getBaseURL(),
    );
  }

  async getAuthMode(): Promise<GeminiAuthMode> {
    const { authMode } = await this.determineBestAuth();
    return authMode;
  }

  override getCurrentModel(): string {
    try {
      const settingsService = this.resolveSettingsService();
      const providerSettings = settingsService.getProviderSettings(this.name);
      if (
        providerSettings.model !== undefined &&
        providerSettings.model !== null &&
        typeof providerSettings.model === 'string'
      ) {
        return providerSettings.model;
      }
    } catch (error) {
      this.getLogger().debug(
        () => `Failed to get model from SettingsService: ${error}`,
      );
    }
    return this.getDefaultModel();
  }

  override getDefaultModel(): string {
    return 'gemini-2.5-pro';
  }

  override getModelParams(): Record<string, unknown> | undefined {
    try {
      const settingsService = this.resolveSettingsService();
      const providerSettings = settingsService.getProviderSettings(this.name);

      const reservedKeys = new Set([
        'enabled',
        'auth-key',
        'apiKey',
        'api-key',
        'auth-keyfile',
        'apiKeyfile',
        'api-keyfile',
        'base-url',
        'model',
        'toolFormat',
        'tool-format',
        'toolFormatOverride',
        'tool-format-override',
        'defaultModel',
      ]);

      const params: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(providerSettings)) {
        if (reservedKeys.has(key) || value === undefined || value === null) {
          continue;
        }
        params[key] = value;
      }

      return Object.keys(params).length > 0 ? params : undefined;
    } catch (error) {
      this.getLogger().debug(
        () =>
          `Failed to get Gemini provider settings from SettingsService: ${error}`,
      );
      return undefined;
    }
  }

  override isPaidMode(): boolean {
    return !!process.env.GEMINI_API_KEY || hasVertexAICredentials();
  }

  override clearState(): void {
    this.clearAuthCache();
  }

  override clearAuth(): void {
    super.clearAuth?.();
    delete process.env.GEMINI_API_KEY;
  }

  override clearAuthCache(): void {
    super.clearAuthCache();
    this.clearClientCache();
  }

  override getServerTools(): string[] {
    return ['web_search', 'web_fetch'];
  }

  override async invokeServerTool(
    toolName: string,
    params: unknown,
    _config?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (toolName === 'web_search') {
      return invokeWebSearch(
        params,
        signal,
        this.getToolsLogger(),
        this.serverToolContext,
      );
    }
    if (toolName === 'web_fetch') {
      return invokeWebFetch(
        params,
        signal,
        this.getToolsLogger(),
        this.serverToolContext,
      );
    }
    throw new Error(`Unknown server tool: ${toolName}`);
  }

  private get serverToolContext(): ServerToolContext {
    return {
      resolveAuth: (signal) => this.resolveAuthWithAbortCheck(signal),
      createHttpOptions: () => this.createHttpOptions(),
      getBaseURL: () => this.getBaseURL(),
      createGenAIClient: (token, mode, opts, baseURL) =>
        this.createGenAIClient(token, mode, opts, baseURL),
      globalConfig: this.globalConfig,
      createOAuthContentGenerator: (async (httpOptions, config, baseURL) =>
        this.createOAuthContentGenerator(
          httpOptions,
          config,
          baseURL,
        )) as OAuthContentGeneratorFactory,
    };
  }

  private async resolveAuthWithAbortCheck(
    signal?: AbortSignal,
  ): Promise<{ authMode: GeminiAuthMode; token: string }> {
    throwIfAborted(signal);
    const result = await this.determineBestAuth();
    throwIfAborted(signal);
    return result;
  }

  private async createGenAIClient(
    authToken: string,
    authMode: GeminiAuthMode,
    httpOptions: ReturnType<typeof this.createHttpOptions>,
    baseURL?: string,
  ): Promise<GoogleGenAI> {
    const { GoogleGenAI } = await import('@google/genai');
    return new GoogleGenAI({
      apiKey: authToken,
      vertexai: authMode === 'vertex-ai',
      httpOptions: baseURL ? { ...httpOptions, baseUrl: baseURL } : httpOptions,
    });
  }

  protected override async *generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    const streamingEnabled = this.getStreamingPreference(options);
    const setup = await buildGenerationSetup(
      options,
      this.globalConfig,
      () => this.determineBestAuth(),
      () => this.createHttpOptions(),
      () => this.getBaseURL(),
    );
    const result = await this.executeGeneration(
      options,
      setup,
      streamingEnabled,
    );

    if (result.chunks !== undefined) {
      yield* this.yieldMappedChunks(result.chunks);
      return;
    }
    yield* result.preludeChunks ?? [];
    yield* consumeGeminiStream(
      result.stream,
      setup.mapResponseToChunks,
      setup.reasoningConfig.includeInResponse,
      result.emitted,
    );
  }

  private async executeGeneration(
    options: NormalizedGenerateChatOptions,
    setup: GeminiGenerationSetup,
    streamingEnabled: boolean,
  ): Promise<GeminiGenerationResult> {
    const oauthFactory = (async (
      httpOptions: Record<string, unknown>,
      config: Config,
      baseURL?: string,
    ) =>
      this.createOAuthContentGenerator(
        httpOptions,
        config,
        baseURL,
      )) as OAuthContentGeneratorFactory;

    if (setup.authMode === 'oauth') {
      return executeOAuthGeneration(
        options,
        this.globalConfig,
        setup.httpOptions,
        setup.contentsWithSignatures,
        setup.requestConfig,
        setup.currentModel,
        setup.toolNamesForPrompt,
        streamingEnabled,
        setup.shouldDumpSuccess,
        setup.shouldDumpError,
        setup.baseURL,
        setup.mapResponseToChunks,
        setup.reasoningConfig.includeInResponse,
        oauthFactory,
      );
    }
    return executeNonOAuthGeneration(
      options,
      this.globalConfig,
      setup.contentsWithSignatures,
      setup.requestConfig,
      setup.currentModel,
      setup.toolNamesForPrompt,
      streamingEnabled,
      setup.shouldDumpSuccess,
      setup.shouldDumpError,
      setup.mapResponseToChunks,
      setup.reasoningConfig.includeInResponse,
      () => this.createNonOAuthGenerator(setup),
      setup.baseURL,
    );
  }

  private async createNonOAuthGenerator(setup: GeminiGenerationSetup): Promise<{
    generateContent: (
      params: GenerateContentParameters,
    ) => Promise<GenerateContentResponse>;
    generateContentStream: (
      params: GenerateContentParameters,
    ) => Promise<AsyncIterable<GenerateContentResponse>>;
  }> {
    const { GoogleGenAI } = await import('@google/genai');
    const genAI = new GoogleGenAI({
      apiKey: setup.authToken,
      vertexai: setup.authMode === 'vertex-ai',
      httpOptions: setup.baseURL
        ? { ...setup.httpOptions, baseUrl: setup.baseURL }
        : setup.httpOptions,
    });
    return genAI.models;
  }

  protected nonOAuthNonStreamingGenerate(
    contentGenerator: NonOAuthContentGenerator,
    apiRequest: GenerateContentParameters,
    shouldDumpSuccess: boolean,
    shouldDumpError: boolean,
    baseURL: string | undefined,
    mapResponseToChunks: GeminiGenerationSetup['mapResponseToChunks'],
    reasoningIncludeInResponse: boolean,
  ): Promise<GeminiGenerationResult> {
    return executeNonOAuthNonStreamingGenerate(
      contentGenerator,
      apiRequest,
      shouldDumpSuccess,
      shouldDumpError,
      baseURL,
      mapResponseToChunks,
      reasoningIncludeInResponse,
    );
  }

  protected nonOAuthStreamingGenerate(
    contentGenerator: NonOAuthContentGenerator,
    apiRequest: GenerateContentParameters,
    shouldDumpSuccess: boolean,
    shouldDumpError: boolean,
    baseURL: string | undefined,
  ): Promise<GeminiGenerationResult> {
    return executeNonOAuthStreamingGenerate(
      contentGenerator,
      apiRequest,
      shouldDumpSuccess,
      shouldDumpError,
      baseURL,
      () => [],
      false,
    );
  }

  protected oauthStreamingGenerate(
    generator: Parameters<typeof executeOAuthStreamingGenerate>[0],
    oauthRequest: GenerateContentParameters,
    runtimeId: string,
    sessionId: string,
    streamingEnabled: boolean,
    shouldDumpSuccess: boolean,
    shouldDumpError: boolean,
    baseURL: string | undefined,
  ): Promise<GeminiGenerationResult> {
    return executeOAuthStreamingGenerate(
      generator,
      oauthRequest,
      runtimeId,
      sessionId,
      streamingEnabled,
      shouldDumpSuccess,
      shouldDumpError,
      baseURL,
    );
  }

  protected oauthNonStreamingGenerate(
    generator: Parameters<typeof executeOAuthNonStreamingGenerate>[0],
    oauthRequest: GenerateContentParameters,
    sessionId: string,
    shouldDumpSuccess: boolean,
    shouldDumpError: boolean,
    baseURL: string | undefined,
    mapResponseToChunks: GeminiGenerationSetup['mapResponseToChunks'],
    reasoningIncludeInResponse: boolean,
  ): Promise<GeminiGenerationResult> {
    return executeOAuthNonStreamingGenerate(
      generator,
      oauthRequest,
      sessionId,
      shouldDumpSuccess,
      shouldDumpError,
      baseURL,
      mapResponseToChunks,
      reasoningIncludeInResponse,
    );
  }

  private *yieldMappedChunks(chunks: IContent[]): IterableIterator<IContent> {
    if (chunks.length === 0) {
      yield { speaker: 'ai', blocks: [] } as IContent;
      return;
    }
    yield* chunks;
  }
}
