/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type IModel } from '@vybestack/llxprt-code-providers/IModel.js';
import { type IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { IProviderConfig } from '@vybestack/llxprt-code-providers/types/IProviderConfig.js';
import {
  BaseProvider,
  type BaseProviderConfig,
  type NormalizedGenerateChatOptions,
} from '@vybestack/llxprt-code-providers/BaseProvider.js';
import { declaredMediaTransportCapabilities } from '@vybestack/llxprt-code-providers/providerMediaTransportCapabilities.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { readInvocationPolicyRecord } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import type {
  GenerateContentParameters,
  GenerateContentResponse,
} from './geminiWireTypes.js';
import type {
  GeminiApiClientOptions,
  GoogleCredentialEnvironment,
} from './geminiWireTypes.js';
import { join } from 'node:path';
import { createGeminiApiClient } from './geminiApiClientFactory.js';

/** The factory shape {@link GeminiProvider} depends on. */
export type CreateGeminiApiClient = typeof createGeminiApiClient;
import {
  getNonEmptySetting,
  getVertexAIAuthConfig,
  hasVertexAICredentials,
  type GeminiAuthMode,
  type VertexAIAuthConfig,
} from './geminiAuth.js';
import { resolveModelList } from './geminiModels.js';
import {
  buildGenerationSetup,
  type GeminiGenerationSetup,
} from './geminiGenerationSetup.js';
import {
  consumeGeminiStream,
  executeNonOAuthGeneration,
  nonOAuthNonStreamingGenerate as executeNonOAuthNonStreamingGenerate,
  nonOAuthStreamingGenerate as executeNonOAuthStreamingGenerate,
  type GeminiGenerationResult,
  type NonOAuthContentGenerator,
} from './geminiGenerationExecution.js';
import { requireAssembledSystemInstruction } from '@vybestack/llxprt-code-providers/utils/systemPromptPlacement.js';
import { buildGeminiDumpContentsStream } from './geminiDumpConversion.js';
import type { HistoryDumpSource } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { OutputLimitConfig } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import {
  finishMediaRequest,
  type MediaRequestOutcome,
  captureRequestMediaInput,
} from '@vybestack/llxprt-code-providers/utils/request-media-resolution.js';
import { inMemoryRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { reportRequestSize } from '@vybestack/llxprt-code-providers/logging/requestSizeReport.js';
import { acquireRequestScopedBody } from '@vybestack/llxprt-code-providers/utils/requestScopedBody.js';
import { openTransportRowsMedia, transportContents } from './transportRows.js';

/**
 * Represents the default Gemini provider.
 * This provider is implicitly active when no other provider is explicitly set.
 *
 * NOTE: This provider acts as a configuration layer for the native Gemini
 * integration. Concrete request preparation, response parsing, streaming,
 * and server-tool invocation are delegated to cohesive submodules in this
 * package to keep the provider class thin and within lint budgets.
 */
function hasHeaderName(headers: Record<string, string>, name: string): boolean {
  const target = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === target);
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value;
}

/**
 * Captures the environment facts the Google credential source depends on, the
 * same variables the Google auth library reads for its own discovery.
 */
export function buildGoogleCredentialEnvironment(
  credentialsFile: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): GoogleCredentialEnvironment {
  const configRoot =
    platform === 'win32'
      ? nonEmpty(env['APPDATA'])
      : nonEmpty(env['HOME']) && join(env['HOME'] as string, '.config');
  const wellKnownFile = configRoot
    ? join(configRoot, 'gcloud', 'application_default_credentials.json')
    : undefined;
  const entries: Array<
    [keyof GoogleCredentialEnvironment, string | undefined]
  > = [
    ['credentialsFile', credentialsFile],
    ['wellKnownFile', wellKnownFile],
    [
      'metadataHost',
      nonEmpty(env['GCE_METADATA_IP']) ?? nonEmpty(env['GCE_METADATA_HOST']),
    ],
    ['metadataDetection', nonEmpty(env['METADATA_SERVER_DETECTION'])],
    ['quotaProject', nonEmpty(env['GOOGLE_CLOUD_QUOTA_PROJECT'])],
  ];
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined));
}

export class GeminiProvider extends BaseProvider {
  /**
   * How this provider obtains its API client.
   *
   * Injected rather than imported at the call sites so tests can supply a fake
   * without `vi.mock`. Module mocks are registered process-wide and bun hoists
   * them ahead of every test in the run, so a mock declared in one suite leaks
   * into every suite loaded alongside it. That made the wire tests fail as a
   * batch while passing per file.
   */
  private readonly createClient: CreateGeminiApiClient;

  constructor(
    apiKey?: string,
    baseURL?: string,
    config?: IProviderConfig,
    createClient: CreateGeminiApiClient = createGeminiApiClient,
  ) {
    const baseConfig: BaseProviderConfig = {
      name: 'gemini',
      apiKey,
      baseURL,
      envKeyNames: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
      mediaTransportCapabilities: declaredMediaTransportCapabilities('gemini'),
    };

    super(baseConfig, config);
    this.createClient = createClient;
  }

  private captureGoogleAuthPolicy(): Readonly<Record<string, unknown>> {
    return {
      ...this.providerConfig?.googleAuthDefaults,
      ...Object.fromEntries(
        Object.entries(this.captureOwnerPolicy()).filter(
          ([, value]) => value !== undefined,
        ),
      ),
    };
  }

  private getLogger(): DebugLogger {
    return new DebugLogger('llxprt:gemini:provider');
  }

  private getStreamingPreference(
    options: NormalizedGenerateChatOptions,
  ): boolean {
    return options.invocation.ephemerals['streaming'] !== 'disabled';
  }

  clearClientCache(_runtimeKey?: string): void {
    this.getLogger().debug(
      () => 'Cache clear called on stateless provider - no operation',
    );
  }

  /**
   * Builds the Gemini wire body for /dumpcontext. This lives on the provider
   * (not in the base request-conversion dispatcher) so the CLI can obtain the
   * dump from the runtime provider instance without the base package ever
   * importing plugin-owned code (#2763).
   */
  readonly contextDumpVersion = 2;

  async buildContextDumpBody(
    history: HistoryDumpSource,
    model?: string,
    config?: OutputLimitConfig,
  ): Promise<Record<string, unknown>> {
    const contents = buildGeminiDumpContentsStream(history, model, config);
    return model ? { model, contents } : { contents };
  }

  protected override supportsOAuth(): boolean {
    return false;
  }

  /** The transport reads `requestRows` itself (issue #854 WP09). */
  protected override ownsRequestRowsTransport(): boolean {
    return true;
  }

  private async determineBestAuth(): Promise<{
    authMode: GeminiAuthMode;
    token: string;
  }> {
    // Gemini has no OAuth path, so the owner-bound non-OAuth read is the
    // whole standard chain (keyfile, key name, environment).
    const standardAuth = await this.getAuthToken();

    if (standardAuth !== '') {
      return { authMode: 'gemini-api-key', token: standardAuth };
    }

    if (hasVertexAICredentials(this.captureGoogleAuthPolicy())) {
      return { authMode: 'vertex-ai', token: 'USE_VERTEX_AI' };
    }

    throw new Error(
      process.env.LLXPRT_CREDENTIAL_SOCKET
        ? 'No Gemini authentication configured inside the sandbox. Ambient Google credentials (GEMINI_API_KEY, GOOGLE_API_KEY, ADC, gcloud) are intentionally not available inside a container sandbox. Gemini itself still works via named keys: save one on the host with `/key save <name> <key>`, then use `/key load <name>` here, or start with `--key-name <name>` or a profile `auth-key-name`. The key is fetched through the credential proxy.'
        : 'No Gemini authentication configured. Set GEMINI_API_KEY environment variable, use --keyfile, or configure Vertex AI credentials.',
    );
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

  async getModels(): Promise<IModel[]> {
    const defaultModels = resolveModelList(
      this.name,
      'none',
      () => Promise.resolve(''),
      () => this.getBaseURL(),
      this.requestFetch,
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
      this.requestFetch,
    );
  }

  async getAuthMode(): Promise<GeminiAuthMode> {
    const { authMode } = await this.determineBestAuth();
    return authMode;
  }

  override getCurrentModel(): string {
    try {
      const providerSettings = readInvocationPolicyRecord(
        this.captureOwnerPolicy()[this.name],
      );
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
    return 'gemini-3.7-flash';
  }

  override getModelParams(): Record<string, unknown> | undefined {
    try {
      const providerSettings = readInvocationPolicyRecord(
        this.captureOwnerPolicy()[this.name],
      );

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
    const settingsService = this.captureGoogleAuthPolicy();
    return (
      !!process.env.GEMINI_API_KEY ||
      !!getNonEmptySetting(settingsService, 'GOOGLE_API_KEY') ||
      hasVertexAICredentials(settingsService)
    );
  }

  override clearState(): void {
    this.clearAuthCache();
  }

  override clearAuth(): void {
    super.clearAuth?.();
  }

  override clearAuthCache(): void {
    super.clearAuthCache();
    this.clearClientCache();
  }

  private hasDirectVertexCredentials(
    settingsService: Readonly<Record<string, unknown>> | undefined,
  ): boolean {
    return Boolean(
      getNonEmptySetting(settingsService, 'GOOGLE_APPLICATION_CREDENTIALS'),
    );
  }

  private hasCompleteVertexProjectConfig(
    vertexConfig: VertexAIAuthConfig,
  ): boolean {
    return Boolean(vertexConfig.project) && Boolean(vertexConfig.location);
  }

  private buildVertexAIOptions(
    isVertex: boolean,
    vertexConfig: VertexAIAuthConfig,
  ): Pick<GeminiApiClientOptions, 'project' | 'location'> {
    if (!isVertex) {
      return {};
    }
    return {
      ...(vertexConfig.project && { project: vertexConfig.project }),
      ...(vertexConfig.location && { location: vertexConfig.location }),
    };
  }

  private buildGoogleGenAIOptions(
    authToken: string,
    authMode: GeminiAuthMode,
    httpOptions: ReturnType<typeof this.createHttpOptions>,
    baseURL?: string,
    onRequestBytes?: (bytes: number) => void,
  ): Omit<GeminiApiClientOptions, 'fetch'> {
    const isVertex = authMode === 'vertex-ai';
    const settingsService = this.captureGoogleAuthPolicy();
    const vertexConfig = getVertexAIAuthConfig(settingsService);
    if (
      isVertex &&
      !this.hasDirectVertexCredentials(settingsService) &&
      !this.hasCompleteVertexProjectConfig(vertexConfig)
    ) {
      throw new Error(
        'Vertex AI mode is active but project/location are not configured. Set GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION via environment variables or settings service, or provide GOOGLE_APPLICATION_CREDENTIALS.',
      );
    }
    return {
      apiKey: authToken,
      vertexai: isVertex,
      ...(isVertex
        ? {
            credentialEnvironment: buildGoogleCredentialEnvironment(
              getNonEmptySetting(
                settingsService,
                'GOOGLE_APPLICATION_CREDENTIALS',
              ),
            ),
          }
        : {}),
      ...this.buildVertexAIOptions(isVertex, vertexConfig),
      httpOptions:
        baseURL &&
        (!isVertex ||
          new URL(baseURL).origin !==
            'https://generativelanguage.googleapis.com')
          ? { ...httpOptions, baseUrl: baseURL }
          : httpOptions,
      ...(onRequestBytes === undefined ? {} : { onRequestBytes }),
    };
  }

  protected override async *generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    // Issue #3136: the agent layer owns system-prompt assembly. Fail fast
    // before any request preparation so a missing instruction is never
    // silently transported as an empty prompt.
    requireAssembledSystemInstruction(options.systemInstruction);

    const requestRows = options.requestRows ?? {
      ...inMemoryRequestSelection(options.contents),
      callerOwned: true,
    };
    const effectiveOptions = { ...options, contents: [], requestRows };
    const mediaInput = captureRequestMediaInput(
      options.metadata?.['logicalRequestId'],
      options.invocation.runtimeId,
      this.requestMediaBudgetBytes,
      this.requestMediaResolver,
    );
    const mediaRequest = await openTransportRowsMedia(
      effectiveOptions,
      mediaInput,
    );
    let outcome: MediaRequestOutcome = { status: 'succeeded' };
    try {
      const streamingEnabled = this.getStreamingPreference(effectiveOptions);
      const setup = await buildGenerationSetup(
        effectiveOptions,
        () => this.determineBestAuth(),
        () => this.createHttpOptions(),
        () => this.getBaseURL(),
        this.getLogger(),
      );
      setup.requestContents = () =>
        transportContents(effectiveOptions, mediaInput, mediaRequest);
      // The SDK `Content[]` is the one body this request needs; it is
      // released once the call settles on any outcome (issue #854 WP09).
      const sdkBody = acquireRequestScopedBody('gemini', {
        contents: setup.contentsWithSignatures,
      });
      mediaRequest.registerCleanup(() => {
        void sdkBody.release();
      });
      const result = await this.executeGeneration(
        effectiveOptions,
        setup,
        streamingEnabled,
      );

      if (result.chunks !== undefined) {
        yield* this.yieldMappedChunks(result.chunks);
        return;
      }
      yield* consumeGeminiStream(
        result.stream,
        setup.mapResponseToChunks,
        setup.reasoningConfig.includeInResponse,
        result.emitted,
      );
    } catch (error) {
      outcome = { status: 'failed', error };
    } finally {
      await finishMediaRequest(mediaRequest, outcome);
    }
  }

  /** #3159: the SDK sends the Gemini API key as x-goog-api-key; record the
   * header NAME in dump metadata (value redacted at write time). A
   * caller-supplied header always wins over the synthesized one.
   */
  private withApiKeyHeader(
    headers: Record<string, string>,
    authMode: GeminiAuthMode,
    authToken: string,
  ): Record<string, string> {
    // Header names are case-insensitive; a caller-supplied variant spelling
    // must win over the synthesized entry (#3159).
    if (
      authMode !== 'gemini-api-key' ||
      hasHeaderName(headers, 'x-goog-api-key')
    ) {
      return headers;
    }
    return { ...headers, 'x-goog-api-key': authToken };
  }

  private async executeGeneration(
    options: NormalizedGenerateChatOptions,
    setup: GeminiGenerationSetup,
    streamingEnabled: boolean,
  ): Promise<GeminiGenerationResult> {
    const dumpHeaders = this.withApiKeyHeader(
      setup.httpOptions.headers,
      setup.authMode,
      setup.authToken,
    );
    return executeNonOAuthGeneration(
      options,
      setup.contentsWithSignatures,
      setup.requestConfig,
      setup.currentModel,
      setup.toolNamesForPrompt,
      streamingEnabled,
      setup.shouldDumpSuccess,
      setup.shouldDumpError,
      setup.mapResponseToChunks,
      setup.reasoningConfig.includeInResponse,
      () => this.createNonOAuthGenerator(setup, options.metadata),
      setup.baseURL,
      dumpHeaders,
    );
  }

  private async createNonOAuthGenerator(
    setup: GeminiGenerationSetup,
    metadata: Record<string, unknown> | undefined,
  ): Promise<{
    generateContent: (
      params: GenerateContentParameters,
    ) => Promise<GenerateContentResponse>;
    generateContentStream: (
      params: GenerateContentParameters,
    ) => Promise<AsyncIterable<GenerateContentResponse>>;
  }> {
    const client = await this.createClient({
      ...this.buildGoogleGenAIOptions(
        setup.authToken,
        setup.authMode,
        setup.httpOptions,
        setup.baseURL,
        (bytes) => reportRequestSize(metadata, bytes),
      ),
      requestContents: setup.requestContents,
      requestMetadata: metadata,
      fetch: setup.fetch,
    });
    return client.models;
  }

  protected nonOAuthNonStreamingGenerate(
    contentGenerator: NonOAuthContentGenerator,
    apiRequest: GenerateContentParameters,
    shouldDumpSuccess: boolean,
    shouldDumpError: boolean,
    baseURL: string | undefined,
    mapResponseToChunks: GeminiGenerationSetup['mapResponseToChunks'],
    reasoningIncludeInResponse: boolean,
    headers?: Record<string, string>,
  ): Promise<GeminiGenerationResult> {
    return executeNonOAuthNonStreamingGenerate(
      contentGenerator,
      apiRequest,
      shouldDumpSuccess,
      shouldDumpError,
      baseURL,
      mapResponseToChunks,
      reasoningIncludeInResponse,
      headers,
    );
  }

  protected nonOAuthStreamingGenerate(
    contentGenerator: NonOAuthContentGenerator,
    apiRequest: GenerateContentParameters,
    shouldDumpSuccess: boolean,
    shouldDumpError: boolean,
    baseURL: string | undefined,
    headers?: Record<string, string>,
  ): Promise<GeminiGenerationResult> {
    return executeNonOAuthStreamingGenerate(
      contentGenerator,
      apiRequest,
      shouldDumpSuccess,
      shouldDumpError,
      baseURL,
      () => [],
      false,
      headers,
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
