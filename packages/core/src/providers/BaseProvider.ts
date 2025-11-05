/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Base provider class with authentication precedence logic
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import {
  IProvider,
  GenerateChatOptions,
  ProviderToolset,
} from './IProvider.js';
import { IModel } from './IModel.js';
import { IContent } from '../services/history/IContent.js';
import { DebugLogger } from '../debug/index.js';
import {
  AuthPrecedenceResolver,
  AuthPrecedenceConfig,
  OAuthManager,
} from '../auth/precedence.js';
import type { Config } from '../config/config.js';
import { IProviderConfig } from './types/IProviderConfig.js';
import {
  peekActiveProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '../runtime/providerRuntimeContext.js';
import type { ProviderRuntimeContext } from '../runtime/providerRuntimeContext.js';
import {
  createRuntimeInvocationContext,
  type RuntimeInvocationContext,
} from '../runtime/RuntimeInvocationContext.js';
import { SettingsService } from '../settings/SettingsService.js';
import { getSettingsService } from '../settings/settingsServiceInstance.js';
import { MissingProviderRuntimeError } from './errors.js';
import type {
  ProviderTelemetryContext,
  ResolvedAuthToken,
  UserMemoryInput,
} from './types/providerRuntime.js';
import { resolveRuntimeAuthToken } from './utils/authToken.js';

export interface BaseProviderConfig {
  // Basic provider config
  name: string;
  apiKey?: string;
  baseURL?: string;

  // Environment variable names to check
  envKeyNames?: string[];

  // OAuth config
  isOAuthEnabled?: boolean;
  oauthProvider?: string;
  oauthManager?: OAuthManager;
}

export interface NormalizedGenerateChatOptions extends GenerateChatOptions {
  settings: SettingsService;
  config?: Config;
  userMemory?: UserMemoryInput; // @plan PLAN-20251023-STATELESS-HARDENING.P08: User memory from runtime context
  runtime?: ProviderRuntimeContext;
  invocation: RuntimeInvocationContext;
  tools?: ProviderToolset;
  metadata: Record<string, unknown>;
  resolved: {
    model: string;
    baseURL?: string;
    authToken: ResolvedAuthToken;
    telemetry?: ProviderTelemetryContext; // @plan PLAN-20251023-STATELESS-HARDENING.P08: Telemetry service
  };
}

/**
 * Abstract base provider class that implements authentication precedence logic
 * This class provides lazy OAuth triggering and proper authentication precedence
 */
export abstract class BaseProvider implements IProvider {
  readonly name: string;
  protected authResolver: AuthPrecedenceResolver;
  protected baseProviderConfig: BaseProviderConfig;
  protected providerConfig?: IProviderConfig;
  /**
   * @plan PLAN-20250218-STATELESSPROVIDER.P05
   * @requirement REQ-SP-001
   * @pseudocode provider-invocation.md lines 8-15
   */
  private defaultSettingsService: SettingsService;
  private defaultConfig?: Config;
  private readonly activeCallContext =
    new AsyncLocalStorage<NormalizedGenerateChatOptions>();

  // Callback for tracking throttle wait times (set by LoggingProviderWrapper)
  protected throttleTracker?: (waitTimeMs: number) => void;

  protected get globalConfig(): Config | undefined {
    return this.defaultConfig;
  }

  protected set globalConfig(config: Config | undefined) {
    this.defaultConfig = config;
  }

  constructor(
    config: BaseProviderConfig,
    providerConfig?: IProviderConfig,
    globalConfig?: Config,
    settingsService?: SettingsService,
  ) {
    this.name = config.name;
    this.baseProviderConfig = config;
    this.providerConfig = providerConfig;
    this.defaultConfig = globalConfig;

    let fallbackSettingsService: SettingsService;
    if (settingsService) {
      fallbackSettingsService = settingsService;
    } else {
      try {
        fallbackSettingsService = getSettingsService();
      } catch {
        fallbackSettingsService = new SettingsService();
      }
    }

    this.defaultSettingsService = fallbackSettingsService;

    const precedenceConfig: AuthPrecedenceConfig = {
      apiKey: config.apiKey,
      envKeyNames: config.envKeyNames || [],
      isOAuthEnabled: config.isOAuthEnabled ?? false,
      supportsOAuth: this.supportsOAuth(),
      oauthProvider: config.oauthProvider,
      providerId: this.name,
    };

    this.authResolver = new AuthPrecedenceResolver(
      precedenceConfig,
      config.oauthManager,
      fallbackSettingsService,
    );
  }

  /**
   * @plan PLAN-20251018-STATELESSPROVIDER2.P06
   * @plan:PLAN-20251018-STATELESSPROVIDER2.P06
   * @requirement REQ-SP2-001
   * @pseudocode base-provider-call-contract.md lines 1-2
   */
  setRuntimeSettingsService(
    settingsService: SettingsService | null | undefined,
  ): void {
    if (!settingsService) {
      return;
    }
    this.defaultSettingsService = settingsService;
    this.authResolver.setSettingsService(settingsService);
  }

  /**
   * @plan PLAN-20251018-STATELESSPROVIDER2.P06
   * @plan:PLAN-20251023-STATELESS-HARDENING.P05
   * @requirement REQ-SP2-001
   * @requirement:REQ-SP4-001
   * @pseudocode base-provider-call-contract.md lines 1-3
   */
  protected resolveSettingsService(): SettingsService {
    const activeOptions = this.activeCallContext.getStore();
    if (activeOptions?.settings) {
      return activeOptions.settings;
    }

    if (this.defaultSettingsService) {
      return this.defaultSettingsService;
    }

    throw new MissingProviderRuntimeError({
      providerKey: `BaseProvider.${this.name}`,
      missingFields: ['settings'],
      stage: 'resolveSettingsService',
      metadata: {
        requirement: 'REQ-SP4-001',
        hint: 'Provider runtime guard expects ProviderManager to set runtime settings.',
      },
    });
  }

  /**
   * Set throttle tracking callback (used by LoggingProviderWrapper)
   */
  setThrottleTracker(tracker: (waitTimeMs: number) => void): void {
    this.throttleTracker = tracker;
    // Debug logging to verify tracker is being set
    const logger = new DebugLogger('llxprt:provider:base');
    logger.debug(() => `Throttle tracker set for provider`);
  }

  /**
   * @plan PLAN-20251018-STATELESSPROVIDER2.P06
   * @requirement REQ-SP2-001
   * @pseudocode base-provider-call-contract.md lines 2-3
   * Gets the base URL with proper precedence:
   * 1. Ephemeral settings (highest priority - from /baseurl or profile)
   * 2. Provider-specific settings in SettingsService
   * 3. Provider config (from IProviderConfig)
   * 4. Base provider config (initial constructor value)
   * 5. undefined (use provider default)
   */
  protected getBaseURL(): string | undefined {
    const activeOptions = this.activeCallContext.getStore();
    if (activeOptions) {
      return activeOptions.resolved.baseURL;
    }
    const settingsService = this.resolveSettingsService();
    return this.computeBaseURL(settingsService);
  }

  /**
   * @plan PLAN-20251018-STATELESSPROVIDER2.P06
   * @requirement REQ-SP2-001
   * @pseudocode base-provider-call-contract.md lines 2-3
   * Gets the current model with proper precedence:
   * 1. Ephemeral settings (highest priority)
   * 2. Provider-specific settings in SettingsService
   * 3. Provider config
   * 4. Default model
   */
  protected getModel(): string {
    const activeOptions = this.activeCallContext.getStore();
    if (activeOptions) {
      return activeOptions.resolved.model;
    }
    const settingsService = this.resolveSettingsService();
    return this.computeModel(settingsService);
  }

  private computeBaseURL(settingsService: SettingsService): string | undefined {
    const ephemeralBaseUrl = settingsService.get('base-url') as
      | string
      | undefined;
    if (ephemeralBaseUrl && ephemeralBaseUrl !== 'none') {
      return ephemeralBaseUrl;
    }

    const providerSettings = settingsService.getProviderSettings(this.name);
    const providerBaseUrl = providerSettings?.baseUrl as string | undefined;
    if (providerBaseUrl && providerBaseUrl !== 'none') {
      return providerBaseUrl;
    }

    if (this.providerConfig?.baseUrl) {
      return this.providerConfig.baseUrl;
    }

    if (this.baseProviderConfig.baseURL) {
      return this.baseProviderConfig.baseURL;
    }

    return undefined;
  }

  private computeModel(settingsService: SettingsService): string {
    const ephemeralModel = settingsService.get('model') as string | undefined;
    if (ephemeralModel) {
      return ephemeralModel;
    }

    const providerSettings = settingsService.getProviderSettings(this.name);
    const providerModel = providerSettings?.model as string | undefined;
    if (providerModel) {
      return providerModel;
    }

    if (this.providerConfig?.defaultModel) {
      return this.providerConfig.defaultModel;
    }

    return this.getDefaultModel();
  }

  /**
   * @plan PLAN-20251018-STATELESSPROVIDER2.P06
   * @requirement REQ-SP2-001
   * @pseudocode base-provider-call-contract.md lines 1-3
   * Gets authentication token using the precedence chain
   * This method implements lazy OAuth triggering - only triggers OAuth when actually making API calls
   * Returns empty string if no auth is available (for local/self-hosted endpoints)
   */
  protected async getAuthToken(): Promise<string> {
    const activeOptions = this.activeCallContext.getStore();
    if (activeOptions) {
      const runtimeToken = await resolveRuntimeAuthToken(
        activeOptions.resolved.authToken,
      );
      if (runtimeToken) {
        return runtimeToken;
      }
    }

    const settingsService = this.resolveSettingsService();

    // IMPORTANT: includeOAuth: false for config-time checks
    // OAuth should ONLY trigger during actual prompt sends
    const token =
      (await this.authResolver.resolveAuthentication({
        settingsService,
        includeOAuth: false,
      })) ?? '';

    return token;
  }

  /**
   * Get auth token for prompt send - CAN trigger OAuth if needed
   * Use this method ONLY when actually sending a prompt to the API
   */
  protected async getAuthTokenForPrompt(): Promise<string> {
    const activeOptions = this.activeCallContext.getStore();
    if (activeOptions) {
      const runtimeToken = await resolveRuntimeAuthToken(
        activeOptions.resolved.authToken,
      );
      if (runtimeToken) {
        return runtimeToken;
      }
    }

    const settingsService = this.resolveSettingsService();

    // includeOAuth: true - OAuth is allowed during prompt send
    const token =
      (await this.authResolver.resolveAuthentication({
        settingsService,
        includeOAuth: true,
      })) ?? '';

    return token;
  }

  /**
   * Checks if OAuth is enabled for this provider
   */
  protected isOAuthEnabled(): boolean {
    // OAuth is enabled if we have a manager AND it's enabled for this provider
    if (this.baseProviderConfig.oauthManager) {
      // First check the manager's state (which reads from settings)
      const manager = this.baseProviderConfig.oauthManager as OAuthManager & {
        isOAuthEnabled?(provider: string): boolean;
      };
      if (
        manager.isOAuthEnabled &&
        typeof manager.isOAuthEnabled === 'function'
      ) {
        const oauthProvider =
          this.baseProviderConfig.oauthProvider || this.name;
        return manager.isOAuthEnabled(oauthProvider);
      }
      // Fall back to local config
      return this.baseProviderConfig.isOAuthEnabled === true;
    }
    return false;
  }

  /**
   * Abstract method to determine if this provider supports OAuth
   * Must be implemented by concrete providers
   */
  protected abstract supportsOAuth(): boolean;

  /**
   * @plan PLAN-20251018-STATELESSPROVIDER2.P06
   * @requirement REQ-SP2-001
   * @pseudocode base-provider-call-contract.md lines 1-3
   * Checks if authentication is available without triggering OAuth
   */
  async hasNonOAuthAuthentication(): Promise<boolean> {
    return this.authResolver.hasNonOAuthAuthentication({
      settingsService: this.resolveSettingsService(),
    });
  }

  /**
   * @plan PLAN-20251018-STATELESSPROVIDER2.P06
   * @requirement REQ-SP2-001
   * @pseudocode base-provider-call-contract.md lines 1-3
   * Checks if OAuth is the only available authentication method
   */
  async isOAuthOnlyAvailable(): Promise<boolean> {
    return this.authResolver.isOAuthOnlyAvailable({
      settingsService: this.resolveSettingsService(),
    });
  }

  /**
   * @plan PLAN-20251018-STATELESSPROVIDER2.P06
   * @requirement REQ-SP2-001
   * @pseudocode base-provider-call-contract.md lines 1-3
   * Gets the current authentication method name for debugging
   */
  async getAuthMethodName(): Promise<string | null> {
    return this.authResolver.getAuthMethodName({
      settingsService: this.resolveSettingsService(),
    });
  }

  /**
   * Clears authentication (used when removing keys/keyfiles)
   */
  clearAuth?(): void {
    const settingsService = this.resolveSettingsService();
    settingsService.set('auth-key', undefined);
    settingsService.set('auth-keyfile', undefined);
    this.clearAuthCache();
  }

  /**
   * Updates OAuth configuration
   */
  protected updateOAuthConfig(
    isEnabled: boolean,
    provider?: string,
    manager?: OAuthManager,
  ): void {
    this.baseProviderConfig.isOAuthEnabled = isEnabled;
    this.baseProviderConfig.oauthProvider = provider;
    this.baseProviderConfig.oauthManager = manager;

    this.authResolver.updateConfig({
      isOAuthEnabled: isEnabled,
      supportsOAuth: this.supportsOAuth(),
      oauthProvider: provider,
    });

    if (manager) {
      this.authResolver.updateOAuthManager(manager);
    }

    this.clearAuthCache();
  }

  /**
   * Clears the authentication token cache
   */
  clearAuthCache(): void {
    // Legacy no-op retained for compatibility with existing logout flows.
  }

  /**
   * Checks if the provider is authenticated using any available method
   */
  async isAuthenticated(): Promise<boolean> {
    try {
      // Check non-OAuth authentication first (API keys, environment variables, etc.)
      const nonOAuthToken =
        (await this.authResolver.resolveAuthentication({
          settingsService: this.resolveSettingsService(),
          includeOAuth: false,
        })) ?? '';

      if (nonOAuthToken !== '') {
        return true;
      }

      // If no non-OAuth auth found, check if OAuth token exists without triggering flow
      if (
        this.baseProviderConfig.isOAuthEnabled &&
        this.baseProviderConfig.oauthManager &&
        this.baseProviderConfig.oauthProvider
      ) {
        return await this.baseProviderConfig.oauthManager.isAuthenticated(
          this.baseProviderConfig.oauthProvider,
        );
      }

      return false;
    } catch {
      return false;
    }
  }

  abstract getModels(): Promise<IModel[]>;
  abstract getDefaultModel(): string;

  /**
   * @plan PLAN-20250218-STATELESSPROVIDER.P04
   * @requirement REQ-SP-001
   * @pseudocode base-provider.md lines 4-15
   */
  generateChatCompletion(
    options: GenerateChatOptions,
  ): AsyncIterableIterator<IContent>;
  generateChatCompletion(
    contents: IContent[],
    tools?: ProviderToolset,
  ): AsyncIterableIterator<IContent>;
  /**
   * @plan PLAN-20251018-STATELESSPROVIDER2.P06
   * @requirement REQ-SP2-001
   * @pseudocode base-provider-call-contract.md lines 1-5
   */
  generateChatCompletion(
    contentsOrOptions: IContent[] | GenerateChatOptions,
    maybeTools?: ProviderToolset,
  ): AsyncIterableIterator<IContent> {
    const normalizedPromise = this.normalizeGenerateChatOptions(
      contentsOrOptions,
      maybeTools,
    );
    const previousRuntimeContext = peekActiveProviderRuntimeContext();

    let preparedIteratorPromise: Promise<void> | null = null;
    let normalizedOptions: NormalizedGenerateChatOptions | undefined;
    let underlyingIterator: AsyncIterableIterator<IContent> | undefined;

    const prepareIterator = async (): Promise<void> => {
      if (!preparedIteratorPromise) {
        preparedIteratorPromise = (async () => {
          normalizedOptions = await normalizedPromise;
          underlyingIterator = this.invokeWithNormalizedOptions(
            normalizedOptions,
            previousRuntimeContext ?? null,
          );
        })();
      }
      await preparedIteratorPromise;
    };

    const withContext = <T>(operation: () => Promise<T>): Promise<T> => {
      if (!normalizedOptions) {
        throw new Error('Normalized options are not prepared');
      }
      return this.activeCallContext.run(normalizedOptions, operation);
    };

    const adapter: AsyncIterableIterator<IContent> = {
      next: async (...args) => {
        await prepareIterator();
        const iterator = underlyingIterator;
        if (!iterator) {
          throw new Error('Provider iterator not initialised');
        }
        return withContext(() => iterator.next(...args));
      },
      return: async (value?: unknown) => {
        await prepareIterator();
        const iterator = underlyingIterator;
        if (!iterator) {
          throw new Error('Provider iterator not initialised');
        }
        if (iterator.return) {
          return withContext(() => iterator.return!(value));
        }
        return { done: true, value: undefined } as IteratorResult<IContent>;
      },
      throw: async (error?: unknown) => {
        await prepareIterator();
        const iterator = underlyingIterator;
        if (!iterator) {
          throw new Error('Provider iterator not initialised');
        }
        if (iterator.throw) {
          return withContext(() => iterator.throw!(error));
        }
        throw error;
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };

    return adapter;
  }

  /**
   * @plan PLAN-20250218-STATELESSPROVIDER.P04
   * @requirement REQ-SP-001
   * @pseudocode base-provider.md lines 7-15
   */
  protected abstract generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent>;

  /**
   * @plan PLAN-20251018-STATELESSPROVIDER2.P06
   * @requirement REQ-SP2-001
   * @pseudocode base-provider-call-contract.md lines 3-5
   */
  private invokeWithNormalizedOptions(
    normalized: NormalizedGenerateChatOptions,
    previousContext: ProviderRuntimeContext | null,
  ): AsyncIterableIterator<IContent> {
    const needsContextSwap =
      !previousContext ||
      previousContext.settingsService !== normalized.settings ||
      (normalized.config && previousContext.config !== normalized.config);

    const mergedMetadata: Record<string, unknown> = normalized.runtime
      ? {
          ...(normalized.runtime.metadata ?? {}),
          ...normalized.metadata,
        }
      : {
          ...(previousContext?.metadata ?? {}),
          ...normalized.metadata,
        };

    if (!('source' in mergedMetadata)) {
      mergedMetadata.source = 'BaseProvider.generateChatCompletion';
    }

    const runtimeContext: ProviderRuntimeContext = normalized.runtime
      ? {
          ...normalized.runtime,
          settingsService: normalized.settings,
          config: normalized.config ?? normalized.runtime.config,
          metadata: mergedMetadata,
        }
      : {
          settingsService: normalized.settings,
          config: normalized.config ?? previousContext?.config,
          runtimeId:
            previousContext?.runtimeId ?? 'base-provider.normalized-call',
          metadata: mergedMetadata,
        };

    return async function* (
      this: BaseProvider,
    ): AsyncIterableIterator<IContent> {
      if (needsContextSwap) {
        setActiveProviderRuntimeContext(runtimeContext);
      }

      try {
        const iterator = this.generateChatCompletionWithOptions(normalized);
        for await (const chunk of iterator) {
          yield chunk;
        }
      } finally {
        if (needsContextSwap) {
          setActiveProviderRuntimeContext(previousContext ?? null);
        }
        normalized.resolved.authToken = '';
        this.authResolver.setSettingsService(this.defaultSettingsService);
      }
    }.call(this);
  }

  /**
   * @plan PLAN-20251018-STATELESSPROVIDER2.P06
   * @plan:PLAN-20251023-STATELESS-HARDENING.P05
   * @requirement REQ-SP2-001
   * @requirement:REQ-SP4-001
   * @pseudocode base-provider-call-contract.md lines 1-3
   */
  private async normalizeGenerateChatOptions(
    contentsOrOptions: IContent[] | GenerateChatOptions,
    maybeTools?: ProviderToolset,
  ): Promise<NormalizedGenerateChatOptions> {
    const providedOptions: GenerateChatOptions = Array.isArray(
      contentsOrOptions,
    )
      ? { contents: contentsOrOptions, tools: maybeTools }
      : contentsOrOptions;

    const settings =
      providedOptions.settings ?? this.defaultSettingsService ?? null;

    if (!settings) {
      throw new MissingProviderRuntimeError({
        providerKey: `BaseProvider.${this.name}`,
        missingFields: ['settings'],
        stage: 'normalizeGenerateChatOptions',
        metadata: {
          hint: 'ProviderManager must supply settings via GenerateChatOptions or setRuntimeSettingsService.',
          requirement: 'REQ-SP4-001',
        },
      });
    }

    const runtimeConfig = providedOptions.runtime?.config ?? null;
    const configCandidate =
      providedOptions.config ?? runtimeConfig ?? this.defaultConfig ?? null;

    const runtimeMetadata = providedOptions.runtime?.metadata ?? {};
    const metadataFromOptions = providedOptions.metadata ?? {};
    const metadata: Record<string, unknown> = {
      ...runtimeMetadata,
      ...metadataFromOptions,
    };

    const resolvedModel = this.computeModel(settings);
    const resolvedBaseURL = this.computeBaseURL(settings);
    // CRITICAL: includeOAuth: true for prompt sends - OAuth is allowed here
    const resolvedAuth =
      (await this.authResolver.resolveAuthentication({
        settingsService: settings,
        includeOAuth: true,
      })) ?? '';

    const resolved = {
      model: resolvedModel,
      baseURL: resolvedBaseURL,
      authToken: resolvedAuth,
      telemetry: providedOptions.resolved?.telemetry,
    };

    const guard = this.assertRuntimeContext({
      providerKey: `BaseProvider.${this.name}`,
      settings,
      config: configCandidate,
      runtime: providedOptions.runtime,
      metadata,
      resolved,
      stage: 'normalizeGenerateChatOptions',
    });
    const finalConfig = guard.runtime.config ?? configCandidate ?? undefined;
    const normalizedRuntime: ProviderRuntimeContext = {
      ...guard.runtime,
      metadata: guard.metadata,
      config: finalConfig,
    };

    const invocation =
      providedOptions.invocation ??
      createRuntimeInvocationContext({
        runtime: normalizedRuntime,
        settings,
        providerName: this.name,
        ephemeralsSnapshot: this.buildEphemeralsSnapshot(settings),
        telemetry: resolved.telemetry,
        metadata: guard.metadata,
        userMemory:
          typeof providedOptions.userMemory === 'string'
            ? providedOptions.userMemory
            : undefined,
        fallbackRuntimeId: `${this.name}:normalizeGenerateChatOptions`,
      });

    return {
      ...providedOptions,
      contents: providedOptions.contents,
      tools: providedOptions.tools ?? maybeTools,
      settings,
      config: finalConfig,
      runtime: normalizedRuntime,
      metadata: guard.metadata,
      resolved,
      invocation,
    };
  }

  private buildEphemeralsSnapshot(
    settings: SettingsService,
  ): Record<string, unknown> {
    const snapshot: Record<string, unknown> = {
      ...settings.getAllGlobalSettings(),
    };
    const providerEphemerals = settings.getProviderSettings(this.name);
    snapshot[this.name] = { ...providerEphemerals };
    return snapshot;
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P05
   * @requirement:REQ-SP4-001
   * @pseudocode base-provider-fallback-removal.md lines 11-14
   */
  protected assertRuntimeContext(input: {
    providerKey: string;
    settings?: SettingsService | null;
    config?: Config | null;
    runtime?: ProviderRuntimeContext;
    metadata?: Record<string, unknown>;
    resolved?: NormalizedGenerateChatOptions['resolved'];
    stage: string;
  }): {
    runtime: ProviderRuntimeContext;
    metadata: Record<string, unknown>;
  } {
    const missing: string[] = [];
    if (!input.settings) {
      missing.push('settings');
    }
    if (!input.config) {
      missing.push('config');
    }
    const resolvedMissing: string[] = [];
    if (!input.resolved) {
      resolvedMissing.push('resolved');
    } else {
      if (
        typeof input.resolved.model !== 'string' ||
        input.resolved.model.trim() === ''
      ) {
        resolvedMissing.push('resolved.model');
      }
      if (
        input.resolved.baseURL !== undefined &&
        input.resolved.baseURL !== null &&
        typeof input.resolved.baseURL !== 'string'
      ) {
        resolvedMissing.push('resolved.baseURL');
      }
      if (
        input.resolved.authToken === undefined ||
        input.resolved.authToken === null
      ) {
        resolvedMissing.push('resolved.authToken');
      }
    }

    const missingFields = [...missing, ...resolvedMissing];
    if (missingFields.length > 0) {
      throw new MissingProviderRuntimeError({
        providerKey: input.providerKey,
        missingFields,
        stage: input.stage,
        metadata: {
          ...(input.metadata ?? {}),
          requirement: 'REQ-SP4-001',
        },
      });
    }

    const metadata = {
      ...(input.runtime?.metadata ?? {}),
      ...(input.metadata ?? {}),
      requirement: 'REQ-SP4-001',
      stage: input.stage,
    };

    const runtimeMetadata = metadata as Record<string, unknown>;
    const currentRuntimeId =
      typeof runtimeMetadata.runtimeId === 'string'
        ? (runtimeMetadata.runtimeId as string)
        : undefined;

    const runtime: ProviderRuntimeContext = input.runtime
      ? {
          ...input.runtime,
          settingsService: input.settings!,
          config: input.runtime.config ?? input.config ?? undefined,
          metadata,
        }
      : {
          settingsService: input.settings!,
          config: input.config ?? undefined,
          runtimeId:
            currentRuntimeId && currentRuntimeId.trim()
              ? currentRuntimeId
              : `${input.providerKey}:${input.stage}`,
          metadata,
        };

    return { runtime, metadata };
  }

  // Optional methods with default implementations
  getCurrentModel?(): string {
    // Use the same logic as getModel() to check ephemeral settings
    return this.getModel();
  }
  getToolFormat?(): string {
    return 'default';
  }
  isPaidMode?(): boolean {
    return false;
  }
  clearState?(): void {
    this.clearAuthCache();
  }
  setConfig?(config: unknown): void {
    if (!config || typeof config !== 'object') {
      return;
    }

    const maybeConfig = config as {
      getUserMemory?: () => string;
      getModel?: () => string;
    };

    if (
      typeof maybeConfig.getUserMemory === 'function' &&
      typeof maybeConfig.getModel === 'function'
    ) {
      this.defaultConfig = config as Config;
      return;
    }

    this.providerConfig = config as IProviderConfig;
  }
  getServerTools(): string[] {
    return [];
  }
  async invokeServerTool(
    toolName: string,
    _params: unknown,
    _config?: unknown,
    _signal?: AbortSignal,
  ): Promise<unknown> {
    throw new Error(
      `Server tool '${toolName}' not supported by ${this.name} provider`,
    );
  }
  getModelParams?(): Record<string, unknown> | undefined {
    return undefined;
  }

  /**
   * Get setting value from SettingsService
   */
  protected async getProviderSetting<T>(
    key: keyof ProviderSettings,
    fallback?: T,
  ): Promise<T | undefined> {
    const settingsService = this.resolveSettingsService();

    try {
      const settings = await settingsService.getSettings(this.name);
      return (settings[key] as T) || fallback;
    } catch (error) {
      if (process.env.DEBUG) {
        console.error(
          `Failed to get ${key} from SettingsService for ${this.name}:`,
          error,
        );
      }
      return fallback;
    }
  }

  /**
   * Set setting value in SettingsService
   */
  protected async setProviderSetting<T>(
    key: keyof ProviderSettings,
    value: T,
  ): Promise<void> {
    const settingsService = this.resolveSettingsService();

    try {
      await settingsService.updateSettings(this.name, {
        [key]: value,
      });
      const updatedSettings = await settingsService.getSettings(this.name);
      if (updatedSettings[key] !== value) {
        settingsService.set(`providers.${this.name}.${String(key)}`, value);
      }
    } catch (error) {
      if (process.env.DEBUG) {
        console.error(
          `Failed to set ${key} in SettingsService for ${this.name}:`,
          error,
        );
      }
    }
  }

  /**
   * Get API key from SettingsService if available
   */
  protected async getApiKeyFromSettings(): Promise<string | undefined> {
    return this.getProviderSetting('apiKey');
  }

  /**
   * Set API key in SettingsService if available
   */
  protected async setApiKeyInSettings(apiKey: string): Promise<void> {
    await this.setProviderSetting('apiKey', apiKey);
  }

  /**
   * Get model from SettingsService if available
   */
  protected async getModelFromSettings(): Promise<string | undefined> {
    return this.getProviderSetting('model');
  }

  /**
   * Set model in SettingsService if available
   */
  protected async setModelInSettings(model: string): Promise<void> {
    await this.setProviderSetting('model', model);
  }

  /**
   * Get base URL from SettingsService if available
   */
  protected async getBaseUrlFromSettings(): Promise<string | undefined> {
    return this.getProviderSetting('baseUrl');
  }

  /**
   * Set base URL in SettingsService if available
   */
  protected async setBaseUrlInSettings(baseUrl?: string): Promise<void> {
    await this.setProviderSetting('baseUrl', baseUrl);
  }

  /**
   * Get model parameters from SettingsService
   */
  protected async getModelParamsFromSettings(): Promise<
    Record<string, unknown> | undefined
  > {
    const settingsService = this.resolveSettingsService();

    try {
      const settings = await settingsService.getSettings(this.name);

      // Extract model parameters from settings, excluding standard fields
      const {
        enabled: _enabled,
        apiKey: _apiKey,
        baseUrl: _baseUrl,
        model: _model,
        maxTokens,
        temperature,
        ...additionalSettings
      } = settings;

      // Include temperature and maxTokens as model params if they exist
      const params: Record<string, unknown> = {};
      if (temperature !== undefined) params.temperature = temperature;
      if (maxTokens !== undefined) params.max_tokens = maxTokens;

      return Object.keys(params).length > 0 ||
        Object.keys(additionalSettings).length > 0
        ? { ...params, ...additionalSettings }
        : undefined;
    } catch (error) {
      if (process.env.DEBUG) {
        console.error(
          `Failed to get model params from SettingsService for ${this.name}:`,
          error,
        );
      }
      return undefined;
    }
  }

  /**
   * Set model parameters in SettingsService
   */
  protected async setModelParamsInSettings(
    params: Record<string, unknown> | undefined,
  ): Promise<void> {
    const settingsService = this.resolveSettingsService();

    try {
      if (params === undefined) {
        // Clear model parameters by setting them to undefined
        await settingsService.updateSettings(this.name, {
          temperature: undefined,
          maxTokens: undefined,
        });
        return;
      }

      // Convert standard model params to settings format
      const updates: Record<string, unknown> = {};
      if ('temperature' in params) updates.temperature = params.temperature;
      if ('max_tokens' in params) updates.maxTokens = params.max_tokens;
      if ('maxTokens' in params) updates.maxTokens = params.maxTokens;

      // Store other parameters as custom fields
      for (const [key, value] of Object.entries(params)) {
        if (!['temperature', 'max_tokens', 'maxTokens'].includes(key)) {
          updates[key] = value;
        }
      }

      if (Object.keys(updates).length > 0) {
        await settingsService.updateSettings(this.name, updates);
      }
    } catch (error) {
      if (process.env.DEBUG) {
        console.error(
          `Failed to set model params in SettingsService for ${this.name}:`,
          error,
        );
      }
    }
  }

  /**
   * Get custom headers from provider configuration and ephemeral settings
   */
  protected getCustomHeaders(): Record<string, string> | undefined {
    const baseHeaders =
      this.providerConfig?.customHeaders &&
      typeof this.providerConfig.customHeaders === 'object'
        ? { ...this.providerConfig.customHeaders }
        : undefined;

    const ephemeralSettings = this.providerConfig?.getEphemeralSettings?.();
    const ephemeralValue =
      ephemeralSettings && typeof ephemeralSettings === 'object'
        ? (ephemeralSettings['custom-headers'] as
            | Record<string, string>
            | undefined)
        : undefined;

    const combined = {
      ...(baseHeaders ?? {}),
      ...(ephemeralValue ?? {}),
    };

    return Object.keys(combined).length > 0 ? combined : undefined;
  }
}

// Import ProviderSettings type to avoid circular dependency
interface ProviderSettings {
  enabled: boolean;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  [key: string]: unknown;
}
