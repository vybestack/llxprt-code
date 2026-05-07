/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable complexity, sonarjs/cognitive-complexity, max-lines -- Phase 5: legacy provider boundary retained while larger decomposition continues. */

// @plan:PLAN-20251023-STATELESS-HARDENING.P08 @requirement:REQ-SP4-002
// createHash import removed - no longer needed without client caching
import { randomUUID } from 'node:crypto';

import { DebugLogger } from '../../debug/index.js';
import { type IModel } from '../IModel.js';
import {
  type IContent,
  type ToolCallBlock,
  type ThinkingBlock,
  type MediaBlock,
} from '../../services/history/IContent.js';
import { Config } from '../../config/config.js';
import { getCoreSystemPromptAsync } from '../../core/prompts.js';
import { shouldIncludeSubagentDelegation } from '../../prompt-config/subagent-delegation.js';
import {
  Type,
  type Part,
  type FunctionCall,
  type Schema,
  type GenerateContentParameters,
  type GenerateContentResponse,
  type GoogleGenAI,
} from '@google/genai';
import {
  BaseProvider,
  type BaseProviderConfig,
  type NormalizedGenerateChatOptions,
} from '../BaseProvider.js';
import { type OAuthManager } from '../../auth/precedence.js';
import { resolveUserMemory } from '../utils/userMemory.js';
import { buildToolResponsePayload } from '../utils/toolResponsePayload.js';
import {
  ensureActiveLoopHasThoughtSignatures,
  stripThoughtsFromHistory,
} from './thoughtSignatures.js';
import {
  shouldDumpSDKContext,
  dumpSDKContext,
} from '../utils/dumpSDKContext.js';
import type { DumpMode } from '../utils/dumpContext.js';

import { isGemini3Model } from '../../config/models.js';

/** Set of values considered missing/falsy in legacy schema checks (non-nullish falsy + nullish). */
const MISSING_SCHEMA_VALUES = new Set<unknown>([false, 0, '', undefined, null]);

/**
 * Helper predicate: checks if a schema value is missing/falsy in the legacy sense.
 * Preserves old !schema semantics: reject all falsy runtime values
 * (undefined, null, false, 0, empty string), not only nullish.
 */
function isMissingGeminiSchema(value: unknown): boolean {
  return MISSING_SCHEMA_VALUES.has(value);
}

/**
 * Helper predicate: checks if a value is a valid object (non-null, typeof 'object').
 * Used for runtime type guards on metadata/config objects.
 */
function isValidRecord(value: unknown): value is Record<string, unknown> {
  return value !== undefined && value !== null && typeof value === 'object';
}

interface GeminiGenerationResult {
  stream: AsyncIterable<GenerateContentResponse> | null;
  emitted: boolean;
  chunks?: IContent[];
  preludeChunks?: IContent[];
}

interface GeminiGenerationSetup {
  authMode: GeminiAuthMode;
  authToken: string;
  currentModel: string;
  contentsWithSignatures: Array<{ role: string; parts: Part[] }>;
  requestConfig: Record<string, unknown>;
  baseURL: string | undefined;
  httpOptions: ReturnType<GeminiProvider['createHttpOptions']>;
  mapResponseToChunks: (
    response: GenerateContentResponse,
    includeThoughts?: boolean,
  ) => IContent[];
  reasoningConfig: {
    includeInResponse: boolean;
    stripFromContext: 'all' | 'allButLast' | 'none';
  };
  toolNamesForPrompt: string[] | undefined;
  shouldDumpSuccess: boolean;
  shouldDumpError: boolean;
}

/**
 * @plan:PLAN-20251023-STATELESS-HARDENING.P08
 * @requirement:REQ-SP4-002
 * @pseudocode lines 10-14
 *
 * Removed module-level client cache to ensure stateless behavior.
 * All runtime caches and cache-related types eliminated per REQ-SP4-002.
 */

/**
 * @plan PLAN-20250822-GEMINIFALLBACK.P12
 * @requirement REQ-003.1, REQ-003.2, REQ-003.3
 * @pseudocode lines 12-18, 21-26
 */

/**
 * Represents the default Gemini provider.
 * This provider is implicitly active when no other provider is explicitly set.
 *
 * NOTE: This provider acts as a configuration layer for the native Gemini integration.
 * It doesn't implement generateChatCompletion directly but instead configures the
 * system to use the native Gemini client with the appropriate authentication.
 */
type GeminiAuthMode = 'oauth' | 'gemini-api-key' | 'vertex-ai' | 'none';

interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

interface GeminiResponseWithUsage {
  usageMetadata?: GeminiUsageMetadata;
}

import type { createCodeAssistContentGenerator as _createCodeAssistContentGenerator } from '../../code_assist/codeAssist.js';

type CodeAssistGeneratorFactory = typeof _createCodeAssistContentGenerator;
type CodeAssistContentGenerator = Awaited<
  ReturnType<CodeAssistGeneratorFactory>
>;

type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

/**
 * Maps a reasoning effort level to the corresponding Gemini 3.x thinkingLevel string.
 * Returns undefined when no effort is specified, allowing the API to use its default.
 */
function mapReasoningEffortToThinkingLevel(
  effort: ReasoningEffort | undefined,
): string | undefined {
  if (effort === undefined) {
    return undefined;
  }
  switch (effort) {
    case 'minimal':
    case 'low':
      return 'LOW';
    case 'medium':
      return 'MEDIUM';
    case 'high':
    case 'xhigh':
      return 'HIGH';
    default:
      return undefined;
  }
}

export class GeminiProvider extends BaseProvider {
  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-002
   * @pseudocode lines 10-14
   *
   * Removed cached state variables to ensure stateless behavior.
   * Provider now resolves model, auth, and parameters per call.
   * No instance state: authMode, model overrides, modelExplicitlySet, currentModel removed.
   * @requirement:REQ-SP4-003: Auth/model/params come from NormalizedGenerateChatOptions
   */
  private readonly geminiOAuthManager?: OAuthManager;

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-002, REQ-SP4-003
   * @pseudocode lines 10-14
   *
   * Simplified constructor that only stores readonly OAuth manager.
   * All other state is now resolved per call from NormalizedGenerateChatOptions.
   * No loggers cached - created on demand like AnthropicProvider.
   */
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

  /**
   * @description Cleans a JSON Schema object to ensure it strictly conforms to the Gemini API's supported Schema definition.
   * This function acts as a whitelist, removing any properties not explicitly defined in the OpenAPI 3.03 Schema Object
   * as understood by the Gemini API. This is crucial for compatibility, as external SDKs might generate schemas
   * with unsupported keywords (e.g., `exclusiveMinimum`, `exclusiveMaximum`) which cause API errors.
   *
   * This approach aligns with how `gemini-cli` handles schema compatibility by relying on the `@google/genai` library's
   * internal cleaning mechanisms.
   *
   * @see https://ai.google.dev/api/caching#Schema
   * @param schema The JSON Schema object to clean.
   * @returns A new Schema object containing only supported properties.
   */
  private cleanGeminiSchema(schema: unknown): Schema {
    if (typeof schema !== 'object' || schema === null) {
      return schema as Schema;
    }

    const cleanedSchema: { [key: string]: unknown } = {};
    const typedSchema = schema as Record<string, unknown>;
    const supportedSchemaProperties: Array<keyof Schema> = [
      'type',
      'format',
      'title',
      'description',
      'nullable',
      'enum',
      'maxItems',
      'minItems',
      'properties',
      'required',
      'minProperties',
      'maxProperties',
      'minLength',
      'maxLength',
      'pattern',
      'example',
      'anyOf',
      'propertyOrdering',
      'default',
      'items',
      'minimum',
      'maximum',
    ];

    for (const key of supportedSchemaProperties) {
      if (Object.prototype.hasOwnProperty.call(schema, key)) {
        if (
          key === 'properties' &&
          typeof typedSchema[key] === 'object' &&
          typedSchema[key] !== null
        ) {
          // Recursively clean properties within 'properties'
          const cleanedProperties: { [key: string]: Schema } = {};
          const propertiesObject = typedSchema[key] as Record<string, unknown>;
          // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
          for (const propKey in propertiesObject) {
            cleanedProperties[propKey] = this.cleanGeminiSchema(
              propertiesObject[propKey],
            );
          }
          cleanedSchema[key] = cleanedProperties;
        } else if (key === 'items' && typeof typedSchema[key] === 'object') {
          // Recursively clean schema within 'items' for array types
          cleanedSchema[key] = this.cleanGeminiSchema(typedSchema[key]);
        } else if (key === 'anyOf' && Array.isArray(typedSchema[key])) {
          // Recursively clean schemas within 'anyOf'
          cleanedSchema[key] = (typedSchema[key] as unknown[]).map(
            (item: unknown) => this.cleanGeminiSchema(item),
          );
        } else {
          cleanedSchema[key] = (schema as { [key: string]: unknown })[key];
        }
      }
    }
    return cleanedSchema as Schema;
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-002
   * Create loggers on-demand to avoid instance state, like AnthropicProvider
   */
  private getLogger(): DebugLogger {
    return new DebugLogger('llxprt:gemini:provider');
  }

  private getToolsLogger(): DebugLogger {
    return new DebugLogger('llxprt:gemini:tools');
  }

  /**

  /**
   * @plan PLAN-20251018-STATELESSPROVIDER2.P12
   * @requirement REQ-SP2-001
   * @pseudocode anthropic-gemini-stateless.md lines 1-2
   */
  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-003
   * Determine streaming preference from config settings per call
   */
  private getStreamingPreference(
    _options: NormalizedGenerateChatOptions,
  ): boolean {
    // providerConfig is optional; getEphemeralSettings may not exist on all configs
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
      '../../code_assist/codeAssist.js'
    );
    return createCodeAssistContentGenerator(httpOptions, config, baseURL);
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-002
   * No operation - stateless provider has no cache to clear
   */
  clearClientCache(_runtimeKey?: string): void {
    this.getLogger().debug(
      () => 'Cache clear called on stateless provider - no operation',
    );
  }

  /**
   * Updates OAuth configuration based on current OAuth manager state
   */
  private updateOAuthState(): void {
    if (this.geminiOAuthManager) {
      const manager = this.geminiOAuthManager as OAuthManager & {
        isOAuthEnabled?(provider: string): boolean;
      };
      if (
        manager.isOAuthEnabled &&
        typeof manager.isOAuthEnabled === 'function'
      ) {
        const isEnabled = manager.isOAuthEnabled('gemini');
        // Update the OAuth configuration
        this.updateOAuthConfig(isEnabled, 'gemini', this.geminiOAuthManager);
      }
    }
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-002, REQ-SP4-003
   * Determines the best available authentication method per call without storing state.
   * Returns both authMode and token - caller must handle both values.
   */
  private async determineBestAuth(): Promise<{
    authMode: GeminiAuthMode;
    token: string;
  }> {
    this.updateOAuthState();

    // 1. CHECK STANDARD AUTH FIRST (via AuthResolver)
    //    This checks in order:
    //    - SettingsService auth-key
    //    - SettingsService auth-keyfile
    //    - Constructor apiKey
    //    - Environment variables (GEMINI_API_KEY, GOOGLE_API_KEY)
    const standardAuth = await this.authResolver.resolveAuthentication({
      settingsService: this.resolveSettingsService(),
      includeOAuth: false, // Just checking, not triggering OAuth
    });

    if (standardAuth) {
      return { authMode: 'gemini-api-key', token: standardAuth };
    }

    // 2. CHECK PROVIDER-SPECIFIC AUTH (Vertex AI)
    if (this.hasVertexAICredentials()) {
      this.setupVertexAIAuth();
      return { authMode: 'vertex-ai', token: 'USE_VERTEX_AI' };
    }

    // 3. CHECK IF OAUTH IS ENABLED (for compatibility with downstream code)
    //    Use the EXACT pattern from current GeminiProvider.ts lines 305-320:
    // geminiOAuthManager is optional; guard with null check
    const manager = this.geminiOAuthManager as
      | (OAuthManager & {
          isOAuthEnabled?(provider: string): boolean;
        })
      | undefined;
    const isOAuthEnabled =
      manager?.isOAuthEnabled &&
      typeof manager.isOAuthEnabled === 'function' &&
      manager.isOAuthEnabled('gemini');

    if (isOAuthEnabled === true) {
      return { authMode: 'oauth', token: 'USE_LOGIN_WITH_GOOGLE' };
    }

    // 4. NO AUTH AVAILABLE - throw error (don't return 'none')
    throw new Error(
      'No Gemini authentication configured. ' +
        'Set GEMINI_API_KEY environment variable, use --keyfile, or configure Vertex AI credentials.',
    );
  }

  /**
   * Implementation of BaseProvider abstract method
   * Determines if this provider supports OAuth authentication
   */
  protected supportsOAuth(): boolean {
    // Check if OAuth is actually enabled for Gemini in the OAuth manager
    // geminiOAuthManager is optional; guard with null check
    const manager = this.geminiOAuthManager as
      | (OAuthManager & {
          isOAuthEnabled?(provider: string): boolean;
        })
      | undefined;

    if (
      manager?.isOAuthEnabled &&
      typeof manager.isOAuthEnabled === 'function'
    ) {
      return manager.isOAuthEnabled('gemini');
    }

    // Default to false if OAuth manager is not available
    // This ensures we don't fall back to LOGIN_WITH_GOOGLE when OAuth is disabled
    return false;
  }

  /**
   * Checks if Vertex AI credentials are available
   */
  private hasVertexAICredentials(): boolean {
    const hasProjectAndLocation =
      !!process.env.GOOGLE_CLOUD_PROJECT && !!process.env.GOOGLE_CLOUD_LOCATION;
    // eslint-disable-next-line no-restricted-syntax -- Legacy existence check, to be refactored to use authResolver
    const hasGoogleApiKey = !!process.env.GOOGLE_API_KEY;
    const hasApplicationCredentials =
      // eslint-disable-next-line no-restricted-syntax -- Legacy existence check, to be refactored to use authResolver
      !!process.env.GOOGLE_APPLICATION_CREDENTIALS;
    return (
      hasProjectAndLocation || hasGoogleApiKey || hasApplicationCredentials
    );
  }

  /**
   * Sets up environment variables for Vertex AI authentication
   */
  private setupVertexAIAuth(): void {
    process.env.GOOGLE_GENAI_USE_VERTEXAI = 'true';
    // Other Vertex AI env vars are already set, no need to duplicate
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

  /**
   * Sets the config instance for reading OAuth credentials
   */
  override setConfig(config: Config): void {
    // Call base provider implementation
    super.setConfig?.(config);
    this.refreshCachedSettings();
    // Sync with config model if user hasn't explicitly set a model
    // This ensures consistency between config and provider state
    // @plan:PLAN-20251023-STATELESS-HARDENING.P08 @requirement:REQ-SP4-002
    // Removed model caching in stateless implementation
    // const configModel = config.getModel();
    // if (!this.modelExplicitlySet && configModel) {
    //   this.currentModel = configModel;
    // }

    // Update OAuth configuration based on OAuth manager state, not legacy auth selection
    // This ensures that if OAuth is disabled via /auth gemini disable, it stays disabled
    this.updateOAuthState();

    // Clear auth cache when config changes to allow re-determination
  }

  /** Default model list used for OAuth mode and as fallback. */
  private getDefaultModelList(): IModel[] {
    return [
      {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        provider: this.name,
        supportedToolFormats: [],
      },
      {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        provider: this.name,
        supportedToolFormats: [],
      },
      {
        id: 'gemini-2.5-flash-lite',
        name: 'Gemini 2.5 Flash Lite',
        provider: this.name,
        supportedToolFormats: [],
      },
      {
        id: 'gemini-3-pro-preview',
        name: 'Gemini 3 Pro Preview',
        provider: this.name,
        supportedToolFormats: [],
      },
      {
        id: 'gemini-3-flash-preview',
        name: 'Gemini 3 Flash Preview',
        provider: this.name,
        supportedToolFormats: [],
      },
    ];
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-002
   * Determine auth mode per call instead of using cached state
   */
  async getModels(): Promise<IModel[]> {
    const defaultModels = this.getDefaultModelList();

    let authMode: GeminiAuthMode;
    try {
      const result = await this.determineBestAuth();
      authMode = result.authMode;
    } catch {
      // No auth configured yet (pre-onboarding) - return full model list
      return defaultModels;
    }

    if (authMode === 'oauth') {
      return defaultModels;
    }

    if (authMode === 'gemini-api-key' || authMode === 'vertex-ai') {
      const fetched = await this.fetchModelsFromApi();
      if (fetched !== undefined) {
        return fetched;
      }
    }

    return defaultModels;
  }

  /**
   * Fetches models from the Gemini API using the current auth token.
   * Returns undefined if the fetch fails or no API key is available.
   */
  private async fetchModelsFromApi(): Promise<IModel[] | undefined> {
    // eslint-disable-next-line no-restricted-syntax -- Legacy fallback, to be refactored to use authResolver
    const apiKey = (await this.getAuthToken()) || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return undefined;
    }

    try {
      const baseURL = this.getBaseURL();
      const url = baseURL
        ? `${baseURL.replace(/\/$/, '')}/v1beta/models?key=${apiKey}`
        : `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      if (response.ok) {
        const data = (await response.json()) as {
          models?: Array<{ name: string; displayName?: string }>;
        };
        if (data.models && data.models.length > 0) {
          return data.models.map((model) => ({
            id: model.name.replace('models/', ''),
            name: model.displayName ?? model.name,
            provider: this.name,
            supportedToolFormats: [],
          }));
        }
      }
    } catch {
      // API request failed; fall through to default models.
    }
    return undefined;
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-002
   * Gets the current authentication mode per call without caching
   */
  async getAuthMode(): Promise<GeminiAuthMode> {
    const { authMode } = await this.determineBestAuth();
    return authMode;
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-002
   * No caching - this method is now a no-op. Settings read on demand.
   */
  private refreshCachedSettings(): void {
    // No operation - stateless provider doesn't cache settings
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-003
   * Gets the current model ID from SettingsService per call
   */
  override getCurrentModel(): string {
    // Try to get from SettingsService first (source of truth)
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
    // In stateless mode, always return default since model should come from options
    return this.getDefaultModel();
  }

  /**
   * Gets the default model for Gemini
   */
  override getDefaultModel(): string {
    return 'gemini-2.5-pro';
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-003
   * Gets model parameters from SettingsService per call
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
        'base-url',
        'model',
        'toolFormat',
        'tool-format',
        'toolFormatOverride',
        'tool-format-override',
        'defaultModel',
      ]);

      const params: Record<string, unknown> = {};
      // providerSettings is Record<string, unknown> returned from settings, may be empty but never null
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

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-002
   * Checks if using paid mode synchronously via env vars (stateless check)
   */
  override isPaidMode(): boolean {
    // Synchronous check based on environment variables only
    // Note: This doesn't check SettingsService to maintain synchronous behavior
    // eslint-disable-next-line no-restricted-syntax -- Legacy existence check, to be refactored to use authResolver
    return !!process.env.GEMINI_API_KEY || this.hasVertexAICredentials();
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-002
   * No state to clear in stateless implementation
   */
  override clearState(): void {
    // No operation - stateless provider has no state to clear
    this.clearAuthCache();
  }

  /**
   * Clear all authentication including environment variable
   */
  override clearAuth(): void {
    // Call base implementation to clear SettingsService
    super.clearAuth?.();
    // CRITICAL: Also clear the environment variable that setApiKey sets
    // eslint-disable-next-line no-restricted-syntax -- Legacy cleanup, required for setApiKey compatibility
    delete process.env.GEMINI_API_KEY;
  }

  /**
   * Forces re-determination of auth method
   */
  override clearAuthCache(): void {
    // Call the base implementation to clear the cached token
    super.clearAuthCache();
    this.clearClientCache();
    // Don't clear the auth mode itself, just allow re-determination next time
  }

  /**
   * Get the list of server tools supported by this provider
   */
  override getServerTools(): string[] {
    return ['web_search', 'web_fetch'];
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-002
   * Invoke a server tool using per-call auth resolution
   */
  override async invokeServerTool(
    toolName: string,
    params: unknown,
    _config?: unknown,
    _signal?: AbortSignal,
  ): Promise<unknown> {
    if (toolName === 'web_search') {
      return this.invokeWebSearch(params, _signal);
    } else if (toolName === 'web_fetch') {
      return this.invokeWebFetch(params, _signal);
    }
    throw new Error(`Unknown server tool: ${toolName}`);
  }

  /** Check abort signal, throw if aborted. */
  private throwIfAborted(signal?: AbortSignal): void {
    if (signal !== undefined && signal.aborted === true) {
      const error = new Error('Operation was aborted');
      error.name = 'AbortError';
      throw error;
    }
  }

  /** Resolve auth and check abort before proceeding. */
  private async resolveAuthWithAbortCheck(
    logger: DebugLogger,
    signal?: AbortSignal,
  ): Promise<{ authMode: GeminiAuthMode; token: string }> {
    this.throwIfAborted(signal);
    logger.debug(() => `invokeServerTool: about to call determineBestAuth()`);
    const result = await this.determineBestAuth();
    // Must re-check because signal could have been aborted during async call
    this.throwIfAborted(signal);
    logger.debug(
      () =>
        `invokeServerTool: determineBestAuth returned authMode=${result.authMode}`,
    );
    return result;
  }

  /** Build Gemini content for a simple text query (web_search/web_fetch). */
  private buildTextQueryContent(
    text: string,
  ): Array<{ role: string; parts: Part[] }> {
    return [{ role: 'user', parts: [{ text }] }];
  }

  /** Invoke web_search server tool. */
  private async invokeWebSearch(
    params: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const logger = this.getToolsLogger();
    logger.debug(
      () =>
        `invokeServerTool: web_search called with params: ${JSON.stringify(params)}`,
    );
    logger.debug(
      () =>
        `invokeServerTool: globalConfig is ${this.globalConfig ? 'set' : 'null/undefined'}`,
    );

    this.throwIfAborted(signal);
    const httpOptions = this.createHttpOptions();
    const { authMode, token: authToken } = await this.resolveAuthWithAbortCheck(
      logger,
      signal,
    );
    const query = (params as { query: string }).query;

    switch (authMode) {
      case 'gemini-api-key':
        return this.invokeWebSearchApiKey(authToken, httpOptions, query);
      case 'vertex-ai':
        return this.invokeWebSearchVertex(authToken, httpOptions, query);
      case 'oauth':
        return this.invokeWebSearchOAuth(httpOptions, query, logger);
      default:
        throw new Error(`Web search not supported in auth mode: ${authMode}`);
    }
  }

  /** Create a GoogleGenAI client for the given auth mode and options. */
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

  /** web_search via API key. */
  private async invokeWebSearchApiKey(
    authToken: string,
    httpOptions: ReturnType<typeof this.createHttpOptions>,
    query: string,
  ): Promise<unknown> {
    if (
      !authToken ||
      authToken === 'USE_LOGIN_WITH_GOOGLE' ||
      authToken === ''
    ) {
      throw new Error('No valid Gemini API key available for web search');
    }
    const genAI = await this.createGenAIClient(
      authToken,
      'gemini-api-key',
      httpOptions,
      this.getBaseURL() ?? undefined,
    );
    const request = {
      model: 'gemini-2.5-flash',
      contents: this.buildTextQueryContent(query),
      config: { tools: [{ googleSearch: {} }] },
    };
    return genAI.models.generateContent(request);
  }

  /** web_search via Vertex AI. */
  private async invokeWebSearchVertex(
    authToken: string,
    httpOptions: ReturnType<typeof this.createHttpOptions>,
    query: string,
  ): Promise<unknown> {
    const genAI = await this.createGenAIClient(
      authToken,
      'vertex-ai',
      httpOptions,
      this.getBaseURL() ?? undefined,
    );
    const request = {
      model: 'gemini-2.5-flash',
      contents: this.buildTextQueryContent(query),
      config: { tools: [{ googleSearch: {} }] },
    };
    return genAI.models.generateContent(request);
  }

  /** web_search via OAuth. */
  private async invokeWebSearchOAuth(
    httpOptions: ReturnType<typeof this.createHttpOptions>,
    query: string,
    logger: DebugLogger,
  ): Promise<unknown> {
    try {
      logger.debug(
        () => `invokeServerTool: OAuth case - creating content generator`,
      );
      const configForOAuth = await this.resolveOAuthConfig(logger);
      const oauthContentGenerator = await this.createOAuthContentGenerator(
        httpOptions,
        configForOAuth,
      );
      logger.debug(
        () => `invokeServerTool: OAuth content generator created successfully`,
      );
      const oauthRequest: GenerateContentParameters = {
        model: 'gemini-2.5-flash',
        contents: this.buildTextQueryContent(query),
        config: { tools: [{ googleSearch: {} }] },
      };
      logger.debug(
        () =>
          `invokeServerTool: making OAuth generateContent request with query: ${query}`,
      );
      const result = await oauthContentGenerator.generateContent(
        oauthRequest,
        'google-web-search-oauth',
      );
      logger.debug(
        () => `invokeServerTool: OAuth generateContent completed successfully`,
      );
      return result;
    } catch (error) {
      logger.debug(() => `invokeServerTool: ERROR in OAuth case: ${error}`);
      logger.debug(() => `invokeServerTool: Error details:`, error);
      throw error;
    }
  }

  /** Resolve OAuth config, creating a minimal one if globalConfig is not set. */
  private async resolveOAuthConfig(logger: DebugLogger): Promise<Config> {
    // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    if (!this.globalConfig) {
      logger.debug(
        () =>
          `invokeServerTool: globalConfig is null, creating minimal config for OAuth`,
      );
      return new Config({
        sessionId: randomUUID(),
        targetDir: process.cwd(),
        debugMode: false,
        cwd: process.cwd(),
        model: 'gemini-2.5-flash',
      });
    }
    return this.globalConfig;
  }

  /** Invoke web_fetch server tool. */
  private async invokeWebFetch(
    params: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    this.throwIfAborted(signal);
    const prompt = (params as { prompt: string }).prompt;
    const httpOptions = this.createHttpOptions();
    const { authMode, token: authToken } = await this.resolveAuthWithAbortCheck(
      this.getToolsLogger(),
      signal,
    );

    switch (authMode) {
      case 'gemini-api-key':
        return this.invokeWebFetchApiKey(authToken, httpOptions, prompt);
      case 'vertex-ai':
        return this.invokeWebFetchVertex(authToken, httpOptions, prompt);
      case 'oauth':
        return this.invokeWebFetchOAuth(httpOptions, prompt);
      default:
        throw new Error(`Web fetch not supported in auth mode: ${authMode}`);
    }
  }

  /** web_fetch via API key. */
  private async invokeWebFetchApiKey(
    authToken: string,
    httpOptions: ReturnType<typeof this.createHttpOptions>,
    prompt: string,
  ): Promise<unknown> {
    const genAI = await this.createGenAIClient(
      authToken,
      'gemini-api-key',
      httpOptions,
      this.getBaseURL() ?? undefined,
    );
    const request = {
      model: 'gemini-2.5-flash',
      contents: this.buildTextQueryContent(prompt),
      config: { tools: [{ urlContext: {} }] },
    };
    return genAI.models.generateContent(request);
  }

  /** web_fetch via Vertex AI. */
  private async invokeWebFetchVertex(
    authToken: string,
    httpOptions: ReturnType<typeof this.createHttpOptions>,
    prompt: string,
  ): Promise<unknown> {
    const genAI = await this.createGenAIClient(
      authToken,
      'vertex-ai',
      httpOptions,
      this.getBaseURL() ?? undefined,
    );
    const request = {
      model: 'gemini-2.5-flash',
      contents: this.buildTextQueryContent(prompt),
      config: { tools: [{ urlContext: {} }] },
    };
    return genAI.models.generateContent(request);
  }

  /** web_fetch via OAuth. */
  private async invokeWebFetchOAuth(
    httpOptions: ReturnType<typeof this.createHttpOptions>,
    prompt: string,
  ): Promise<unknown> {
    const oauthContentGenerator = await this.createOAuthContentGenerator(
      httpOptions,
      this.globalConfig!,
      undefined,
    );
    const oauthRequest: GenerateContentParameters = {
      model: 'gemini-2.5-flash',
      contents: this.buildTextQueryContent(prompt),
      config: { tools: [{ urlContext: {} }] },
    };
    return oauthContentGenerator.generateContent(
      oauthRequest,
      'google-web-fetch-oauth',
    );
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-002, REQ-SP4-003
   * Generate chat completion using per-call resolution of auth, model, and params
   * All state comes from NormalizedGenerateChatOptions, no instance caching
   */
  protected override async *generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    const streamingEnabled = this.getStreamingPreference(options);
    const setup = await this.buildGenerationSetup(options);
    const result =
      setup.authMode === 'oauth'
        ? await this.executeOAuthGeneration(
            options,
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
          )
        : await this.executeNonOAuthGeneration(
            setup.authToken,
            setup.authMode,
            setup.httpOptions,
            setup.baseURL,
            setup.contentsWithSignatures,
            setup.requestConfig,
            setup.currentModel,
            setup.toolNamesForPrompt,
            options,
            streamingEnabled,
            setup.shouldDumpSuccess,
            setup.shouldDumpError,
            setup.mapResponseToChunks,
            setup.reasoningConfig.includeInResponse,
          );

    if (result.chunks !== undefined) {
      yield* this.yieldMappedChunks(result.chunks);
      return;
    }
    yield* result.preludeChunks ?? [];
    yield* this.consumeStream(
      result.stream,
      setup.mapResponseToChunks,
      setup.reasoningConfig.includeInResponse,
      result.emitted,
    );
  }

  private async buildGenerationSetup(
    options: NormalizedGenerateChatOptions,
  ): Promise<GeminiGenerationSetup> {
    const { contents: content, tools } = options;
    const { authMode, token: authToken } = await this.determineBestAuth();
    const currentModel = options.resolved.model;
    const configForMessages =
      options.config ?? options.runtime?.config ?? this.globalConfig;
    const contents = this.convertHistoryToGeminiFormat(
      content,
      currentModel,
      configForMessages,
    );
    const reasoningConfig = this.extractReasoningConfig(options);
    const { shouldDumpSuccess, shouldDumpError } =
      this.extractDumpConfig(options);
    const contentsWithSignatures = this.prepareContentsWithSignatures(
      contents,
      reasoningConfig.stripFromContext,
    );
    const { geminiTools, toolNamesForPrompt } = this.buildGeminiTools(tools);
    return {
      authMode,
      authToken,
      currentModel,
      contentsWithSignatures,
      requestConfig: this.buildRequestConfig(
        options,
        geminiTools,
        reasoningConfig,
        currentModel,
      ),
      baseURL: options.resolved.baseURL ?? this.getBaseURL(),
      httpOptions: this.createHttpOptions(),
      mapResponseToChunks: this.createResponseMapper(),
      reasoningConfig,
      toolNamesForPrompt,
      shouldDumpSuccess,
      shouldDumpError,
    };
  }

  private *yieldMappedChunks(chunks: IContent[]): IterableIterator<IContent> {
    if (chunks.length === 0) {
      yield { speaker: 'ai', blocks: [] } as IContent;
      return;
    }
    yield* chunks;
  }

  /** Extract reasoning configuration from options. */
  private extractReasoningConfig(options: NormalizedGenerateChatOptions): {
    enabled: boolean;
    includeInResponse: boolean;
    stripFromContext: 'all' | 'allButLast' | 'none';
    effort: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | undefined;
    maxTokens: number | undefined;
  } {
    const earlyEphemerals = options.invocation.ephemerals;
    const reasoningObj = (earlyEphemerals as Record<string, unknown>)[
      'reasoning'
    ] as Record<string, unknown> | undefined;
    const enabled =
      options.invocation.getModelBehavior<boolean>('reasoning.enabled') ??
      ((earlyEphemerals as Record<string, unknown>)['reasoning.enabled'] ===
        true ||
        reasoningObj?.enabled === true);
    const includeInResponse =
      options.invocation.getCliSetting<boolean>(
        'reasoning.includeInResponse',
      ) ??
      ((earlyEphemerals as Record<string, unknown>)[
        'reasoning.includeInResponse'
      ] !== false &&
        reasoningObj?.includeInResponse !== false);
    const stripFromContext =
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- getCliSetting returns T | undefined, fallbacks provide defaults
      options.invocation.getCliSetting<'all' | 'allButLast' | 'none'>(
        'reasoning.stripFromContext',
      ) ??
      ((earlyEphemerals as Record<string, unknown>)[
        'reasoning.stripFromContext'
      ] as 'all' | 'allButLast' | 'none') ??
      (reasoningObj?.stripFromContext as 'all' | 'allButLast' | 'none') ??
      'all';
    const effort =
      options.invocation.getModelBehavior<
        'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
      >('reasoning.effort') ??
      ((earlyEphemerals as Record<string, unknown>)['reasoning.effort'] as
        | 'minimal'
        | 'low'
        | 'medium'
        | 'high'
        | 'xhigh'
        | undefined) ??
      (reasoningObj?.effort as
        | 'minimal'
        | 'low'
        | 'medium'
        | 'high'
        | 'xhigh'
        | undefined);
    const maxTokens =
      options.invocation.getModelBehavior<number>('reasoning.maxTokens') ??
      ((earlyEphemerals as Record<string, unknown>)['reasoning.maxTokens'] as
        | number
        | undefined) ??
      (reasoningObj?.maxTokens as number | undefined);
    return { enabled, includeInResponse, stripFromContext, effort, maxTokens };
  }

  /** Extract dump SDK context config from options. */
  private extractDumpConfig(options: NormalizedGenerateChatOptions): {
    shouldDumpSuccess: boolean;
    shouldDumpError: boolean;
  } {
    const dumpMode = options.invocation.ephemerals.dumpcontext as
      | DumpMode
      | undefined;
    return {
      shouldDumpSuccess: shouldDumpSDKContext(dumpMode, false),
      shouldDumpError: shouldDumpSDKContext(dumpMode, true),
    };
  }

  /** Strip thoughts and apply thought signatures. */
  private prepareContentsWithSignatures(
    contents: Array<{ role: string; parts: Part[] }>,
    stripFromContext: 'all' | 'allButLast' | 'none',
  ): Array<{ role: string; parts: Part[] }> {
    const stripped = stripThoughtsFromHistory(contents, stripFromContext);
    return ensureActiveLoopHasThoughtSignatures(stripped);
  }

  /** Build Gemini-compatible tool declarations and extract tool names. */
  private buildGeminiTools(tools: NormalizedGenerateChatOptions['tools']): {
    geminiTools:
      | Array<{
          functionDeclarations: Array<{
            name: string;
            description?: string;
            parameters: Schema;
          }>;
        }>
      | undefined;
    toolNamesForPrompt: string[] | undefined;
  } {
    if (tools === undefined) {
      return { geminiTools: undefined, toolNamesForPrompt: undefined };
    }
    const geminiTools = tools.map((toolGroup) => ({
      functionDeclarations: toolGroup.functionDeclarations.map((decl) => {
        const schema: unknown = decl.parametersJsonSchema;
        if (isMissingGeminiSchema(schema)) {
          throw new Error(
            `Tool "${decl.name}" is missing parametersJsonSchema — legacy schema fallback has been removed. ` +
              `Ensure all tool declarations provide parametersJsonSchema at construction time.`,
          );
        }
        let parameters = this.cleanGeminiSchema(schema);
        const parametersRecord = parameters as Record<string, unknown>;
        if (!('type' in parametersRecord)) {
          parameters = { type: Type.OBJECT, ...parameters };
        }
        return { name: decl.name, description: decl.description, parameters };
      }),
    }));
    const toolNamesForPrompt = Array.from(
      new Set(
        tools.flatMap((group) =>
          group.functionDeclarations
            .map((decl) => decl.name)
            .filter((name): name is string => Boolean(name)),
        ),
      ),
    );
    return { geminiTools, toolNamesForPrompt };
  }

  /** Build request config from options, tools, and reasoning settings. */
  private buildRequestConfig(
    options: NormalizedGenerateChatOptions,
    geminiTools:
      | Array<{
          functionDeclarations: Array<{
            name: string;
            description?: string;
            parameters: Schema;
          }>;
        }>
      | undefined,
    reasoningConfig: {
      enabled: boolean;
      effort: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | undefined;
      maxTokens: number | undefined;
    },
    currentModel: string,
  ): Record<string, unknown> {
    const directOverridesRaw = (
      options.metadata as { geminiDirectOverrides?: unknown }
    ).geminiDirectOverrides;
    const directOverrides = isValidRecord(directOverridesRaw)
      ? directOverridesRaw
      : undefined;
    const serverTools = this.resolveServerTools(directOverrides, options);
    const toolConfigOverride =
      directOverrides !== undefined && 'toolConfig' in directOverrides
        ? directOverrides.toolConfig
        : undefined;

    const modelParams = options.invocation.modelParams;
    const requestConfig: Record<string, unknown> = { ...modelParams };

    const rawMaxOutput = options.settings.get('maxOutputTokens');
    const genericMaxOutput =
      typeof rawMaxOutput === 'number' &&
      Number.isFinite(rawMaxOutput) &&
      rawMaxOutput > 0
        ? rawMaxOutput
        : undefined;
    if (
      genericMaxOutput !== undefined &&
      requestConfig['maxOutputTokens'] === undefined
    ) {
      requestConfig['maxOutputTokens'] = genericMaxOutput;
    }
    requestConfig.serverTools = serverTools;
    if (geminiTools !== undefined) {
      requestConfig.tools = geminiTools;
    }
    if (toolConfigOverride !== undefined) {
      requestConfig.toolConfig = toolConfigOverride;
    }
    this.applyThinkingConfig(requestConfig, reasoningConfig, currentModel);
    return requestConfig;
  }

  /** Resolve server tools from overrides or config. */
  private resolveServerTools(
    directOverrides: Record<string, unknown> | undefined,
    options: NormalizedGenerateChatOptions,
  ): string[] {
    let serverToolsOverride: unknown;
    if (directOverrides !== undefined && 'serverTools' in directOverrides) {
      serverToolsOverride = directOverrides.serverTools;
    } else {
      const configServerTools = options.config as
        | { serverTools?: unknown }
        | undefined;
      serverToolsOverride =
        configServerTools !== undefined &&
        'serverTools' in configServerTools &&
        configServerTools.serverTools !== undefined
          ? configServerTools.serverTools
          : undefined;
    }
    return Array.isArray(serverToolsOverride)
      ? serverToolsOverride
      : ['web_search', 'web_fetch'];
  }

  /** Apply thinking config to request config based on model version and reasoning settings. */
  private applyThinkingConfig(
    requestConfig: Record<string, unknown>,
    reasoningConfig: {
      enabled: boolean;
      effort: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | undefined;
      maxTokens: number | undefined;
    },
    currentModel: string,
  ): void {
    if (!reasoningConfig.enabled) {
      return;
    }
    // @plan PLAN-20251202-THINKING.P03b @requirement REQ-THINK-006
    if (isGemini3Model(currentModel)) {
      const thinkingLevel = mapReasoningEffortToThinkingLevel(
        reasoningConfig.effort,
      );
      const thinkingConfig: Record<string, unknown> = { includeThoughts: true };
      if (thinkingLevel !== undefined) {
        thinkingConfig.thinkingLevel = thinkingLevel;
      }
      requestConfig.thinkingConfig = thinkingConfig;
    } else {
      requestConfig.thinkingConfig = {
        includeThoughts: true,
        thinkingBudget: reasoningConfig.maxTokens ?? -1,
      };
    }
  }

  /** Build system instruction from options. */
  private async buildSystemInstruction(
    options: NormalizedGenerateChatOptions,
    toolNamesForPrompt: string[] | undefined,
    currentModel: string,
  ): Promise<string> {
    const userMemory = await resolveUserMemory(
      options.userMemory,
      () => options.invocation.userMemory,
    );
    const subagentConfig =
      options.config ?? options.runtime?.config ?? this.globalConfig;
    const mcpInstructions = subagentConfig
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Config methods may not exist on all IProviderConfig implementations
      ?.getMcpClientManager?.()
      ?.getMcpInstructions();
    const includeSubagentDelegation = await shouldIncludeSubagentDelegation(
      toolNamesForPrompt ?? [],
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Config methods may not exist on all IProviderConfig implementations
      () => subagentConfig?.getSubagentManager?.(),
    );
    return getCoreSystemPromptAsync({
      userMemory,
      mcpInstructions,
      model: currentModel,
      tools: toolNamesForPrompt,
      includeSubagentDelegation,
      interactionMode:
        typeof subagentConfig?.isInteractive === 'function' &&
        subagentConfig.isInteractive() === true
          ? 'interactive'
          : 'non-interactive',
    });
  }

  /** Convert IContent history to Gemini format. */
  private convertHistoryToGeminiFormat(
    content: NormalizedGenerateChatOptions['contents'],
    currentModel: string,
    configForMessages: unknown,
  ): Array<{ role: string; parts: Part[] }> {
    const contents: Array<{ role: string; parts: Part[] }> = [];
    for (const c of content) {
      if (c.speaker === 'human') {
        const parts = this.convertHumanBlocks(c.blocks);
        if (parts.length > 0) {
          contents.push({ role: 'user', parts });
        }
      } else if (c.speaker === 'ai') {
        const parts = this.convertAiBlocks(c.blocks);
        if (parts.length > 0) {
          contents.push({ role: 'model', parts });
        }
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Defensive check for speaker type exhaustiveness
      } else if (c.speaker === 'tool') {
        this.convertToolBlocks(c, currentModel, configForMessages, contents);
      }
    }
    return contents;
  }

  /** Convert human speaker blocks to Gemini Parts. */
  private convertHumanBlocks(
    blocks: NormalizedGenerateChatOptions['contents'][number]['blocks'],
  ): Part[] {
    const parts: Part[] = [];
    for (const block of blocks) {
      // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      if (block.type === 'text') {
        parts.push({ text: block.text });
      } else if (block.type === 'media') {
        parts.push(...this.convertMediaBlock(block));
      }
    }
    return parts;
  }

  /** Convert a media block to Gemini Part(s). */
  private convertMediaBlock(block: {
    type: 'media';
    encoding: string;
    mimeType: string;
    data: string;
  }): Part[] {
    if (block.encoding === 'url') {
      return [
        { fileData: { mimeType: block.mimeType, fileUri: block.data } } as Part,
      ];
    }
    let imageData = block.data;
    if (imageData.startsWith('data:')) {
      const base64Index = imageData.indexOf('base64,');
      if (base64Index !== -1) {
        imageData = imageData.substring(base64Index + 7);
      }
    }
    return [
      { inlineData: { mimeType: block.mimeType, data: imageData } } as Part,
    ];
  }

  /** Convert AI speaker blocks to Gemini Parts. */
  private convertAiBlocks(
    blocks: NormalizedGenerateChatOptions['contents'][number]['blocks'],
  ): Part[] {
    const parts: Part[] = [];
    for (const block of blocks) {
      // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      if (block.type === 'text') {
        parts.push({ text: block.text });
      } else if (block.type === 'tool_call') {
        const tc = block;
        parts.push({
          functionCall: { id: tc.id, name: tc.name, args: tc.parameters },
        } as Part);
      }
    }
    return parts;
  }

  /** Convert tool speaker content to Gemini format and push into contents. */
  private convertToolBlocks(
    c: NormalizedGenerateChatOptions['contents'][number],
    currentModel: string,
    configForMessages: unknown,
    contents: Array<{ role: string; parts: Part[] }>,
  ): void {
    const toolResponseBlock = c.blocks.find((b) => b.type === 'tool_response');
    if (!toolResponseBlock) {
      throw new Error('Tool content must have a tool_response block');
    }
    const mediaBlocks = c.blocks.filter(
      (b): b is MediaBlock => b.type === 'media',
    );
    const payload = buildToolResponsePayload(
      toolResponseBlock,
      configForMessages as Config | undefined,
    );
    const frPart: Part = {
      functionResponse: {
        id: toolResponseBlock.callId,
        name: toolResponseBlock.toolName,
        response: {
          status: payload.status,
          result: payload.result,
          error: payload.error,
          truncated: payload.truncated,
          originalLength: payload.originalLength,
          limitMessage: payload.limitMessage,
        },
      },
    };
    if (mediaBlocks.length > 0 && isGemini3Model(currentModel)) {
      frPart.functionResponse!.parts = mediaBlocks.map((mb) => ({
        inlineData: { mimeType: mb.mimeType, data: mb.data },
      }));
      contents.push({ role: 'user', parts: [frPart] });
    } else if (mediaBlocks.length > 0) {
      const parts: Part[] = [frPart];
      // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      for (const mb of mediaBlocks) {
        parts.push({
          inlineData: { mimeType: mb.mimeType, data: mb.data },
        } as Part);
      }
      contents.push({ role: 'user', parts });
    } else {
      contents.push({ role: 'user', parts: [frPart] });
    }
  }

  /** Create the response-to-chunks mapper function. */
  private createResponseMapper(): (
    response: GenerateContentResponse,
    includeThoughts?: boolean,
  ) => IContent[] {
    const thinkingLogger = new DebugLogger('llxprt:provider:gemini:thinking');
    return (
      response: GenerateContentResponse,
      includeThoughts = true,
    ): IContent[] => {
      const chunks: IContent[] = [];
      const parts = response.candidates?.[0]?.content?.parts ?? [];
      const { thoughtParts, nonThoughtTextParts, thoughtSignature } =
        this.extractThoughtInfo(parts, thinkingLogger);
      const text = nonThoughtTextParts
        .map((part: Part) => (part as { text: string }).text)
        .join('');
      const thoughtText = thoughtParts
        .map((part: Part) => (part as { text: string }).text)
        .join('');
      const functionCalls = parts
        .filter((part: Part) => 'functionCall' in part)
        .map(
          (part: Part) => (part as { functionCall: FunctionCall }).functionCall,
        );
      const usageMetadata = (response as GeminiResponseWithUsage).usageMetadata;

      if (thoughtText && includeThoughts) {
        const thinkingBlock: ThinkingBlock = {
          type: 'thinking',
          thought: thoughtText,
          sourceField: 'thought',
          isHidden: false,
        };
        if (thoughtSignature) {
          thinkingBlock.signature = thoughtSignature;
        }
        chunks.push({ speaker: 'ai', blocks: [thinkingBlock] });
      }
      this.pushTextAndToolCallChunks(
        chunks,
        text,
        functionCalls,
        usageMetadata,
      );
      this.pushFallbackChunks(chunks, text, functionCalls, usageMetadata);
      return chunks;
    };
  }

  /** Extract thought parts, non-thought parts, and signature from response parts. */
  private extractThoughtInfo(
    parts: Part[],
    thinkingLogger: DebugLogger,
  ): {
    thoughtParts: Part[];
    nonThoughtTextParts: Part[];
    thoughtSignature: string | undefined;
  } {
    thinkingLogger.log(
      () => '[GeminiProvider] Response parts received',
      parts.map((p: Part) => ({
        hasText: 'text' in p,
        thought: (p as Part & { thought?: boolean }).thought,
        hasThoughtSignature: !!(p as Part & { thoughtSignature?: string })
          .thoughtSignature,
        hasFunctionCall: 'functionCall' in p,
        textPreview:
          'text' in p
            ? (p as { text: string }).text.substring(0, 100)
            : undefined,
      })),
    );
    const thoughtParts = parts.filter(
      (part: Part) =>
        'text' in part &&
        (part as Part & { thought?: boolean }).thought === true,
    );
    const nonThoughtTextParts = parts.filter(
      (part: Part) =>
        'text' in part &&
        (part as Part & { thought?: boolean }).thought !== true,
    );
    const firstPartWithSig = parts.find(
      (part: Part) =>
        (part as Part & { thoughtSignature?: string }).thoughtSignature,
    );
    const thoughtSignature = firstPartWithSig
      ? (firstPartWithSig as Part & { thoughtSignature?: string })
          .thoughtSignature
      : undefined;
    thinkingLogger.log(() => '[GeminiProvider] Thought extraction results', {
      thoughtPartsCount: thoughtParts.length,
      nonThoughtTextPartsCount: nonThoughtTextParts.length,
      thoughtTextLength: thoughtParts
        .map((p: Part) => (p as { text: string }).text)
        .join('').length,
      includeThoughts: true,
      willYieldThinkingBlock: thoughtParts.length > 0,
    });
    return { thoughtParts, nonThoughtTextParts, thoughtSignature };
  }

  /** Build usage metadata object from Gemini response. */
  private buildUsageMetadata(usageMetadata?: GeminiUsageMetadata):
    | {
        usage: {
          promptTokens: number;
          completionTokens: number;
          totalTokens: number;
        };
      }
    | undefined {
    if (!usageMetadata) return undefined;
    return {
      usage: {
        promptTokens: usageMetadata.promptTokenCount ?? 0,
        completionTokens: usageMetadata.candidatesTokenCount ?? 0,
        totalTokens:
          usageMetadata.totalTokenCount ??
          (usageMetadata.promptTokenCount ?? 0) +
            (usageMetadata.candidatesTokenCount ?? 0),
      },
    };
  }

  /** Push text content and tool call chunks. */
  private pushTextAndToolCallChunks(
    chunks: IContent[],
    text: string,
    functionCalls: FunctionCall[],
    usageMetadata?: GeminiUsageMetadata,
  ): void {
    if (text) {
      const textContent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text }],
      };
      const usage = this.buildUsageMetadata(usageMetadata);
      if (usage) {
        textContent.metadata = usage;
      }
      chunks.push(textContent);
    }
    if (functionCalls.length > 0) {
      const blocks: ToolCallBlock[] = functionCalls.map(
        (call: FunctionCall) => ({
          type: 'tool_call' as const,
          id:
            call.id ??
            `call_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
          name: call.name ?? 'unknown_function',
          parameters: call.args ?? {},
        }),
      );
      const toolCallContent: IContent = { speaker: 'ai', blocks };
      const usage = this.buildUsageMetadata(usageMetadata);
      if (usage) {
        toolCallContent.metadata = usage;
      }
      chunks.push(toolCallContent);
    }
  }

  /** Push fallback chunks for edge cases (usage-only or empty). */
  private pushFallbackChunks(
    chunks: IContent[],
    text: string,
    functionCalls: FunctionCall[],
    usageMetadata?: GeminiUsageMetadata,
  ): void {
    if (usageMetadata && !text && functionCalls.length === 0) {
      const content: IContent = {
        speaker: 'ai',
        blocks: [],
        metadata: this.buildUsageMetadata(usageMetadata),
      } as IContent;
      chunks.push(content);
    }
    if (!usageMetadata && !text && functionCalls.length === 0) {
      chunks.push({ speaker: 'ai', blocks: [] } as IContent);
    }
  }

  private createOAuthConfig(): Config {
    return (this.globalConfig ?? {
      getProxy: () => undefined,
      isBrowserLaunchSuppressed: () => false,
      getNoBrowser: () => false,
      getUserMemory: () => '',
    }) as Config;
  }

  private async buildOAuthRequestContext(
    options: NormalizedGenerateChatOptions,
    toolNamesForPrompt: string[] | undefined,
    currentModel: string,
    contentsWithSignatures: Array<{ role: string; parts: Part[] }>,
    requestConfig: Record<string, unknown>,
  ): Promise<{
    oauthRequest: GenerateContentParameters & { systemInstruction: string };
    runtimeId: string;
    sessionId: string;
  }> {
    const systemInstruction = await this.buildSystemInstruction(
      options,
      toolNamesForPrompt,
      currentModel,
    );
    const runtimeId = options.runtime?.runtimeId ?? 'default';
    return {
      oauthRequest: {
        model: currentModel,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `<system>\n${systemInstruction}\n</system>\n\nUser provided conversation begins here:`,
              },
            ],
          },
          ...contentsWithSignatures,
        ],
        systemInstruction,
        config: { ...requestConfig },
      },
      runtimeId,
      sessionId: `oauth-session:${runtimeId}:${randomUUID()}`,
    };
  }

  /** Execute OAuth generation path. Returns stream + emitted, or yielded if non-streaming completed. */
  private async executeOAuthGeneration(
    options: NormalizedGenerateChatOptions,
    httpOptions: ReturnType<typeof this.createHttpOptions>,
    contentsWithSignatures: Array<{ role: string; parts: Part[] }>,
    requestConfig: Record<string, unknown>,
    currentModel: string,
    toolNamesForPrompt: string[] | undefined,
    streamingEnabled: boolean,
    shouldDumpSuccess: boolean,
    shouldDumpError: boolean,
    baseURL: string | undefined,
    mapResponseToChunks: (
      response: GenerateContentResponse,
      includeThoughts?: boolean,
    ) => IContent[],
    reasoningIncludeInResponse: boolean,
  ): Promise<GeminiGenerationResult> {
    const contentGenerator = await this.createOAuthContentGenerator(
      httpOptions,
      this.createOAuthConfig(),
      undefined,
    );
    const { oauthRequest, runtimeId, sessionId } =
      await this.buildOAuthRequestContext(
        options,
        toolNamesForPrompt,
        currentModel,
        contentsWithSignatures,
        requestConfig,
      );
    const generatorWithStream = contentGenerator as {
      generateContentStream: (
        params: GenerateContentParameters,
        sessionId?: string,
      ) =>
        | AsyncIterable<GenerateContentResponse>
        | Promise<AsyncIterable<GenerateContentResponse>>;
      generateContent?: (
        params: GenerateContentParameters,
        sessionId?: string,
      ) => Promise<GenerateContentResponse>;
    };

    if (!streamingEnabled && generatorWithStream.generateContent) {
      return this.oauthNonStreamingGenerate(
        generatorWithStream,
        oauthRequest,
        sessionId,
        shouldDumpSuccess,
        shouldDumpError,
        baseURL,
        mapResponseToChunks,
        reasoningIncludeInResponse,
      );
    }
    return this.oauthStreamingGenerate(
      generatorWithStream,
      oauthRequest,
      runtimeId,
      sessionId,
      streamingEnabled,
      shouldDumpSuccess,
      shouldDumpError,
      baseURL,
    );
  }

  /** Non-streaming OAuth generate with dump support. */
  private async oauthNonStreamingGenerate(
    generatorWithStream: {
      generateContentStream: (
        params: GenerateContentParameters,
        sessionId?: string,
      ) =>
        | AsyncIterable<GenerateContentResponse>
        | Promise<AsyncIterable<GenerateContentResponse>>;
      generateContent?: (
        params: GenerateContentParameters,
        sessionId?: string,
      ) => Promise<GenerateContentResponse>;
    },
    oauthRequest: GenerateContentParameters,
    sessionId: string,
    shouldDumpSuccess: boolean,
    shouldDumpError: boolean,
    baseURL: string | undefined,
    mapResponseToChunks: (
      response: GenerateContentResponse,
      includeThoughts?: boolean,
    ) => IContent[],
    reasoningIncludeInResponse: boolean,
  ): Promise<GeminiGenerationResult> {
    // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    try {
      const response = await generatorWithStream.generateContent!(
        oauthRequest,
        sessionId,
      );
      if (shouldDumpSuccess) {
        await dumpSDKContext(
          'gemini',
          '/v1/models/generateContent',
          oauthRequest,
          response,
          false,
          baseURL ?? 'https://generativelanguage.googleapis.com',
        );
      }
      return {
        stream: null,
        emitted: false,
        chunks: mapResponseToChunks(response, reasoningIncludeInResponse),
      };
    } catch (error) {
      // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      if (shouldDumpError) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        await dumpSDKContext(
          'gemini',
          '/v1/models/generateContent',
          oauthRequest,
          { error: errorMessage },
          true,
          baseURL ?? 'https://generativelanguage.googleapis.com',
        );
      }
      throw error;
    }
  }

  /** Streaming OAuth generate with dump support. */
  private async oauthStreamingGenerate(
    generatorWithStream: {
      generateContentStream: (
        params: GenerateContentParameters,
        sessionId?: string,
      ) =>
        | AsyncIterable<GenerateContentResponse>
        | Promise<AsyncIterable<GenerateContentResponse>>;
    },
    oauthRequest: GenerateContentParameters,
    runtimeId: string,
    sessionId: string,
    streamingEnabled: boolean,
    shouldDumpSuccess: boolean,
    shouldDumpError: boolean,
    baseURL: string | undefined,
  ): Promise<GeminiGenerationResult> {
    try {
      const oauthStream = await Promise.resolve(
        generatorWithStream.generateContentStream(oauthRequest, sessionId),
      );
      if (shouldDumpSuccess) {
        await dumpSDKContext(
          'gemini',
          '/v1/models/streamGenerateContent',
          oauthRequest,
          { streaming: true },
          false,
          baseURL ?? 'https://generativelanguage.googleapis.com',
        );
      }
      if (streamingEnabled) {
        return {
          stream: oauthStream,
          emitted: true,
          preludeChunks: [
            {
              speaker: 'ai',
              blocks: [],
              metadata: {
                session: sessionId,
                runtime: runtimeId,
                authMode: 'oauth',
              },
            } as IContent,
          ],
        };
      }
      return { stream: oauthStream, emitted: false };
    } catch (error) {
      if (shouldDumpError) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        await dumpSDKContext(
          'gemini',
          '/v1/models/streamGenerateContent',
          oauthRequest,
          { error: errorMessage },
          true,
          baseURL ?? 'https://generativelanguage.googleapis.com',
        );
      }
      throw error;
    }
  }

  /** Execute non-OAuth (API key / Vertex AI) generation path. */
  private async executeNonOAuthGeneration(
    authToken: string,
    authMode: GeminiAuthMode,
    httpOptions: ReturnType<typeof this.createHttpOptions>,
    baseURL: string | undefined,
    contentsWithSignatures: Array<{ role: string; parts: Part[] }>,
    requestConfig: Record<string, unknown>,
    currentModel: string,
    toolNamesForPrompt: string[] | undefined,
    options: NormalizedGenerateChatOptions,
    streamingEnabled: boolean,
    shouldDumpSuccess: boolean,
    shouldDumpError: boolean,
    mapResponseToChunks: (
      response: GenerateContentResponse,
      includeThoughts?: boolean,
    ) => IContent[],
    reasoningIncludeInResponse: boolean,
  ): Promise<GeminiGenerationResult> {
    // @plan:PLAN-20251023-STATELESS-HARDENING.P08 @requirement:REQ-SP4-002
    const { GoogleGenAI } = await import('@google/genai');
    const genAI = new GoogleGenAI({
      apiKey: authToken,
      vertexai: authMode === 'vertex-ai',
      httpOptions: baseURL ? { ...httpOptions, baseUrl: baseURL } : httpOptions,
    });
    const contentGenerator = genAI.models;
    const systemInstruction = await this.buildSystemInstruction(
      options,
      toolNamesForPrompt,
      currentModel,
    );
    const apiRequest = {
      model: currentModel,
      contents: contentsWithSignatures,
      systemInstruction,
      config: { ...requestConfig },
    };

    if (streamingEnabled) {
      return this.nonOAuthStreamingGenerate(
        contentGenerator,
        apiRequest,
        shouldDumpSuccess,
        shouldDumpError,
        baseURL,
      );
    }
    return this.nonOAuthNonStreamingGenerate(
      contentGenerator,
      apiRequest,
      shouldDumpSuccess,
      shouldDumpError,
      baseURL,
      mapResponseToChunks,
      reasoningIncludeInResponse,
    );
  }

  /** Non-streaming non-OAuth generate with dump support. */
  private async nonOAuthNonStreamingGenerate(
    contentGenerator: {
      generateContent: (
        params: GenerateContentParameters,
      ) => Promise<GenerateContentResponse>;
    },
    apiRequest: GenerateContentParameters,
    shouldDumpSuccess: boolean,
    shouldDumpError: boolean,
    baseURL: string | undefined,
    mapResponseToChunks: (
      response: GenerateContentResponse,
      includeThoughts?: boolean,
    ) => IContent[],
    reasoningIncludeInResponse: boolean,
  ): Promise<GeminiGenerationResult> {
    try {
      const response = await contentGenerator.generateContent(apiRequest);
      // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      if (shouldDumpSuccess) {
        await dumpSDKContext(
          'gemini',
          '/v1/models/generateContent',
          apiRequest,
          response,
          false,
          baseURL ?? 'https://generativelanguage.googleapis.com',
        );
      }
      return {
        stream: null,
        emitted: false,
        chunks: mapResponseToChunks(response, reasoningIncludeInResponse),
      };
    } catch (error) {
      // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      if (shouldDumpError) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        await dumpSDKContext(
          'gemini',
          '/v1/models/generateContent',
          apiRequest,
          { error: errorMessage },
          true,
          baseURL ?? 'https://generativelanguage.googleapis.com',
        );
      }
      throw error;
    }
  }

  private async nonOAuthStreamingGenerate(
    contentGenerator: {
      generateContentStream: (
        params: GenerateContentParameters,
      ) => Promise<AsyncIterable<GenerateContentResponse>>;
    },
    apiRequest: GenerateContentParameters,
    shouldDumpSuccess: boolean,
    shouldDumpError: boolean,
    baseURL: string | undefined,
  ): Promise<GeminiGenerationResult> {
    try {
      const stream = await contentGenerator.generateContentStream(apiRequest);
      if (shouldDumpSuccess) {
        await dumpSDKContext(
          'gemini',
          '/v1/models/streamGenerateContent',
          apiRequest,
          { streaming: true },
          false,
          baseURL ?? 'https://generativelanguage.googleapis.com',
        );
      }
      return { stream, emitted: false };
    } catch (error) {
      if (shouldDumpError) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        await dumpSDKContext(
          'gemini',
          '/v1/models/streamGenerateContent',
          apiRequest,
          { error: errorMessage },
          true,
          baseURL ?? 'https://generativelanguage.googleapis.com',
        );
      }
      throw error;
    }
  }

  /** Consume a stream and yield mapped chunks. */
  private async *consumeStream(
    stream: AsyncIterable<GenerateContentResponse> | null,
    mapResponseToChunks: (
      response: GenerateContentResponse,
      includeThoughts?: boolean,
    ) => IContent[],
    reasoningIncludeInResponse: boolean,
    emitted: boolean,
  ): AsyncIterableIterator<IContent> {
    let hasEmitted = emitted;
    const streamRuntime: unknown = stream;
    if (streamRuntime !== null) {
      const s = stream as AsyncIterable<GenerateContentResponse>;
      const iterator: AsyncIterator<GenerateContentResponse> =
        typeof s[Symbol.asyncIterator] === 'function'
          ? s[Symbol.asyncIterator]()
          : (s as unknown as AsyncIterator<GenerateContentResponse>);
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, sonarjs/too-many-break-or-continue-in-loop -- Intentional infinite loop with break conditions
      while (true) {
        const { value, done } = await iterator.next();
        if (done === true) {
          break;
        }
        const mapped = mapResponseToChunks(value, reasoningIncludeInResponse);
        if (mapped.length === 0) {
          continue;
        }
        hasEmitted = true;
        for (const chunk of mapped) {
          yield chunk;
        }
      }
    }
    if (!hasEmitted) {
      yield { speaker: 'ai', blocks: [] } as IContent;
    }
  }
}
