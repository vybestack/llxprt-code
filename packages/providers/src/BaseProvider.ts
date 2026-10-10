/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RequestMediaResolutionService } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import {
  readInvocationPolicyRecord,
  readInvocationPolicyValue,
} from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { composeProviderOwner, type ProviderOwner } from './providerOwner.js';
import { copyProviderRequestOptions } from './requestAdmission.js';
/**
 * Base provider class with authentication precedence logic
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import {
  conservativeMediaTransportCapabilities,
  copyMediaTransportCapabilities,
  type ProviderMediaTransportCapabilities,
} from './providerMediaTransportCapabilities.js';
import {
  type IProvider,
  type GenerateChatOptions,
  type ProviderToolset,
} from './IProvider.js';
import { type IModel } from './IModel.js';
import { type IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { firstTruthyString } from './utils/falsyFallback.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
// @plan:PLAN-20260608-ISSUE1586.P15 — auth types from auth package
import {
  type AuthPrecedenceConfig,
  CredentialResolutionError,
  type OAuthManager,
  type IProviderKeyStorage,
} from '@vybestack/llxprt-code-auth';
import { AuthPrecedenceResolver } from '@vybestack/llxprt-code-auth/precedence.js';
import { createProviderKeyStorage } from './auth/proxy/credential-store-factory.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { type IProviderConfig } from './types/IProviderConfig.js';
import {
  captureInvocationEphemerals,
  type RuntimeInvocationContext,
} from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  assertProviderRequestData,
  isRuntimeInvocationContext,
  normalizeProviderGenerateChatOptions,
} from './BaseProviderNormalization.js';
import { getProviderCustomHeaders } from './customHeaders.js';
import type {
  ProviderTelemetryContext,
  ResolvedAuthToken,
  UserMemoryInput,
} from './types/providerRuntime.js';
import { resolveRuntimeAuthToken } from './utils/authToken.js';
import { debugLogger } from '@vybestack/llxprt-code-core/utils/debugLogger.js';

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
  // Override for supportsOAuth when method can't be used in constructor
  supportsOAuth?: boolean;

  // Named API key storage used to resolve `auth-key-name` references.
  // Optional DI seam: when omitted, BaseProvider falls back to the sanctioned
  // createProviderKeyStorage() factory, which routes through the credential
  // proxy inside a sandbox and direct storage on the host.
  providerKeyStorage?: IProviderKeyStorage;
  mediaTransportCapabilities?: ProviderMediaTransportCapabilities;
}

export interface NormalizedGenerateChatOptions extends GenerateChatOptions {
  userMemory?: UserMemoryInput; // @plan PLAN-20251023-STATELESS-HARDENING.P08: User memory from runtime context
  invocation: RuntimeInvocationContext;
  tools?: ProviderToolset;
  metadata: Record<string, unknown>;
  resolved: {
    model: string;
    baseURL?: string;
    authToken: ResolvedAuthToken;
    authFailure?: CredentialResolutionError;
    telemetry?: ProviderTelemetryContext; // @plan PLAN-20251023-STATELESS-HARDENING.P08: Telemetry service
    temperature?: number;
    maxTokens?: number;
    streaming?: boolean;
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
  protected requestMediaResolver?: RequestMediaResolutionService;
  protected requestMediaBudgetBytes?: number;
  protected requestAuthentication?: ProviderOwner['readAuthentication'];
  private owner: ProviderOwner;
  private readonly mediaTransportCapabilities: ProviderMediaTransportCapabilities;
  private readonly activeCallContext =
    new AsyncLocalStorage<NormalizedGenerateChatOptions>();

  // Callback for tracking throttle wait times (set by LoggingProviderWrapper)
  protected throttleTracker?: (waitTimeMs: number) => void;

  constructor(
    config: BaseProviderConfig,
    providerConfig?: IProviderConfig,
    globalConfig?: Config,
    settingsService?: SettingsService,
  ) {
    this.name = config.name;
    this.baseProviderConfig = config;
    this.providerConfig = providerConfig;
    this.mediaTransportCapabilities = copyMediaTransportCapabilities(
      config.mediaTransportCapabilities ??
        conservativeMediaTransportCapabilities(),
    );

    const fallbackSettingsService = settingsService ?? new SettingsService();

    const precedenceConfig: AuthPrecedenceConfig = {
      apiKey: config.apiKey,
      envKeyNames: config.envKeyNames ?? [],
      isOAuthEnabled: config.isOAuthEnabled ?? false,
      // Use supportsOAuth from config if provided (for cases where method can't be used in constructor)
      supportsOAuth: config.supportsOAuth ?? this.supportsOAuth(),
      oauthProvider: config.oauthProvider,
      providerId: this.name,
    };

    // @plan:PLAN-20260608-ISSUE1586.P15 — options-object constructor (unified with C-CB-06/C-CB-09)
    // SettingsService satisfies ISettingsService by structural typing.
    // providerKeyStorage is injected so the resolver can resolve named keys
    // (`auth-key-name`) on its own. The sanctioned factory is used as the
    // fallback so named-key resolution routes through the credential proxy
    // inside a sandbox (when LLXPRT_CREDENTIAL_SOCKET is set) and falls back
    // to direct storage on the host. Callers may still inject their own
    // storage via config.providerKeyStorage.
    this.authResolver = new AuthPrecedenceResolver(precedenceConfig, {
      oauthManager: config.oauthManager,
      settingsService: fallbackSettingsService,
      providerKeyStorage:
        config.providerKeyStorage ?? createProviderKeyStorage(),
    });
    this.owner = composeProviderOwner(
      this.name,
      fallbackSettingsService,
      () => this.authResolver,
    );
  }
  bindOwnerAuthentication(settings: SettingsService): this {
    const owner = composeProviderOwner(
      this.name,
      settings,
      () => this.authResolver,
    );
    const readAuthentication = owner.captureAuthentication();
    return new Proxy(this, {
      get(target, property, receiver): unknown {
        if (property === 'owner') return owner;
        if (property === 'requestAuthentication') return readAuthentication;
        return Reflect.get(target, property, receiver);
      },
    });
  }

  getMediaTransportCapabilities(): ProviderMediaTransportCapabilities {
    return copyMediaTransportCapabilities(this.mediaTransportCapabilities);
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
    this.owner = composeProviderOwner(
      this.name,
      settingsService,
      () => this.authResolver,
    );
  }

  /**
   * @plan PLAN-20251018-STATELESSPROVIDER2.P06
   * @plan:PLAN-20251023-STATELESS-HARDENING.P05
   * @requirement REQ-SP2-001
   * @requirement:REQ-SP4-001
   * @pseudocode base-provider-call-contract.md lines 1-3
   */

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
    return this.computeBaseURL(this.owner.capturePolicy());
  }

  /**
   * Resolve the effective base URL from EXPLICIT per-call options rather than
   * ambient runtime state (issue #2817).
   *
   * `getBaseURL()` only sees `resolved.baseURL` while `activeCallContext` is
   * set, which happens exclusively inside `generateChatCompletion`. Prompt-
   * envelope projection runs before that context exists, so it must resolve
   * the endpoint from the caller's own options to prepare the request the
   * subsequent send will actually transmit.
   */
  protected resolveEffectiveBaseURL(
    options?: NormalizedGenerateChatOptions,
  ): string | undefined {
    if (options === undefined) {
      return this.getBaseURL();
    }
    return options.resolved.baseURL;
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
    return this.computeModel(this.owner.capturePolicy());
  }

  private computeBaseURL(
    policy: Readonly<Record<string, unknown>>,
  ): string | undefined {
    const normalizeBaseUrl = (value: unknown): string | undefined => {
      if (typeof value !== 'string') {
        return undefined;
      }
      const trimmed = value.trim();
      if (!trimmed || trimmed.toLowerCase() === 'none') {
        return undefined;
      }
      return trimmed;
    };

    const rawActiveProvider = policy['activeProvider'] as string | undefined;
    const activeProvider =
      typeof rawActiveProvider === 'string' && rawActiveProvider.trim()
        ? rawActiveProvider.trim()
        : undefined;

    if (!activeProvider || activeProvider === this.name) {
      const ephemeralBaseUrl = normalizeBaseUrl(policy['base-url']);
      if (ephemeralBaseUrl) {
        return ephemeralBaseUrl;
      }
    }

    const providerSettings =
      (policy[this.name] as ProviderSettings | undefined) ??
      ({} as ProviderSettings);
    const providerBaseUrl = normalizeBaseUrl(providerSettings['base-url']);
    if (providerBaseUrl) {
      return providerBaseUrl;
    }

    const configBaseUrl = normalizeBaseUrl(this.providerConfig?.baseUrl);
    if (configBaseUrl) {
      return configBaseUrl;
    }

    const defaultBaseUrl = normalizeBaseUrl(this.baseProviderConfig.baseURL);
    if (defaultBaseUrl) {
      return defaultBaseUrl;
    }

    return undefined;
  }

  private computeModel(policy: Readonly<Record<string, unknown>>): string {
    const ephemeralModel = policy['model'] as string | undefined;
    if (ephemeralModel) {
      return ephemeralModel;
    }

    const providerSettings =
      (policy[this.name] as ProviderSettings | undefined) ??
      ({} as ProviderSettings);
    const providerModel = providerSettings.model;
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
      const runtimeToken = await this.resolveOptionalAuthentication(
        activeOptions.resolved.authToken,
      );
      return runtimeToken ?? '';
    }

    // IMPORTANT: includeOAuth: false for config-time checks
    // OAuth should ONLY trigger during actual prompt sends
    const token =
      (await this.owner
        .readAuthentication({ includeOAuth: false })
        .then((result) => result.token)) ?? '';

    return token;
  }

  /**
   * Get auth token for prompt send - CAN trigger OAuth if needed
   * Use this method ONLY when actually sending a prompt to the API
   */
  private async resolveOptionalAuthentication(
    input: ResolvedAuthToken,
  ): Promise<string | undefined> {
    try {
      return await resolveRuntimeAuthToken(input);
    } catch (error) {
      if (
        error instanceof CredentialResolutionError &&
        (error.kind === 'no-credential-configured' ||
          (error.kind === 'credential-source-failed' &&
            error.remediation?.startsWith('Run /auth ') === true))
      )
        return '';
      throw error;
    }
  }

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

    // OAuth is only eligible for the effective base URL of this call. Providers
    // whose OAuth is host-specific (e.g. Anthropic) override isOAuthEligible so
    // a third-party gateway base URL never triggers an OAuth handshake against
    // the wrong endpoint.
    const effectiveBaseURL =
      activeOptions?.resolved.baseURL ??
      this.computeBaseURL(this.owner.capturePolicy());
    const token =
      (await this.owner
        .readAuthentication({
          includeOAuth: this.isOAuthEligible(effectiveBaseURL),
        })
        .then((result) => result.token)) ?? '';

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
        const oauthProvider = firstTruthyString(
          this.baseProviderConfig.oauthProvider,
          this.name,
        );
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
   * Determines whether OAuth is eligible given the resolved base URL for this
   * call. Providers whose OAuth is tied to a specific host (e.g. Anthropic)
   * override this to disable OAuth when a third-party gateway base URL is set.
   * Default: always eligible (preserves behaviour for all other providers).
   */
  protected isOAuthEligible(_baseURL?: string): boolean {
    return true;
  }

  /**
   * Classify whether a given auth token is an OAuth token.
   * Default implementation always returns false; providers that support
   * token-prefix-based OAuth detection (e.g., Anthropic) should override.
   *
   * @param _authToken - The resolved auth token string
   * @returns true if the token should be treated as an OAuth token
   */
  protected classifyOAuthToken(_authToken: string): boolean {
    return false;
  }

  /**
   * @plan PLAN-20251018-STATELESSPROVIDER2.P06
   * @requirement REQ-SP2-001
   * @pseudocode base-provider-call-contract.md lines 1-3
   * Checks if authentication is available without triggering OAuth
   */
  async hasNonOAuthAuthentication(): Promise<boolean> {
    return this.owner.readNonOAuthAuthentication();
  }

  /**
   * @plan PLAN-20251018-STATELESSPROVIDER2.P06
   * @requirement REQ-SP2-001
   * @pseudocode base-provider-call-contract.md lines 1-3
   * Checks if OAuth is the only available authentication method
   */
  async isOAuthOnlyAvailable(): Promise<boolean> {
    return this.owner.readOAuthOnly();
  }

  /**
   * @plan PLAN-20251018-STATELESSPROVIDER2.P06
   * @requirement REQ-SP2-001
   * @pseudocode base-provider-call-contract.md lines 1-3
   * Gets the current authentication method name for debugging
   */
  async getAuthMethodName(): Promise<string | null> {
    return this.owner.readAuthMethodName();
  }

  /**
   * Clears authentication (used when removing keys/keyfiles)
   */
  clearAuth?(): void {
    this.owner.clearAuthentication();
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
   * Clears the authentication token cache.
   * This ensures that after logout, fresh tokens are fetched on the next
   * authentication attempt without requiring a provider switch.
   *
   * @plan PLAN-20251023-STATELESS-HARDENING
   * @requirement Issue #975 - OAuth logout cache invalidation
   */
  clearAuthCache(): void {
    // The base resolver holds no credential cache; subclasses override to
    // drop their own cached clients.
  }

  /**
   * Checks if the provider is authenticated using any available method
   */
  async isAuthenticated(): Promise<boolean> {
    try {
      // Check non-OAuth authentication first (API keys, environment variables, etc.)
      const nonOAuthToken =
        (await this.owner
          .readAuthentication({ includeOAuth: false })
          .then((result) => result.token)) ?? '';

      if (nonOAuthToken !== '') {
        return true;
      }

      // If no non-OAuth auth found, check if OAuth token exists without triggering flow
      if (
        this.baseProviderConfig.isOAuthEnabled === true &&
        this.baseProviderConfig.oauthManager !== undefined &&
        this.baseProviderConfig.oauthProvider !== undefined
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

    let preparedIteratorPromise: Promise<void> | null = null;
    let normalizedOptions: NormalizedGenerateChatOptions | undefined;
    let underlyingIterator: AsyncIterableIterator<IContent> | undefined;

    const prepareIterator = async (): Promise<void> => {
      preparedIteratorPromise ??= (async () => {
        normalizedOptions = await normalizedPromise;
        underlyingIterator =
          this.invokeWithNormalizedOptions(normalizedOptions);
      })();
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
   * Normalize caller-supplied chat options for prompt-envelope projection
   * (issue #2817).
   *
   * The agent send seam builds the same un-normalized `GenerateChatOptions`
   * it passes to `generateChatCompletion`, which normalizes internally. A
   * projection must therefore normalize identically, otherwise it would read
   * `resolved.model` / `invocation` fields that only exist post-normalization.
   *
   * Unlike the transport path this does NOT swap the ambient runtime context
   * or clear the resolved auth token, because projection is a pure read.
   */
  protected async normalizeOptionsForProjection(
    options: GenerateChatOptions,
  ): Promise<NormalizedGenerateChatOptions> {
    return this.normalizeGenerateChatOptions(options, options.tools, false);
  }

  /**
   * Resolve the credential a projection must use, applying the SAME precedence
   * transport applies: an explicitly resolved runtime token first, then the
   * ambient prompt credential (issue #2817).
   *
   * `normalizeOptionsForProjection` keeps normalization a pure read, so
   * `resolved.authToken` is empty unless the caller already resolved one.
   * Projection paths that must build a real client therefore resolve the
   * credential here rather than failing on the empty value, which would reject
   * a request transport can send.
   */
  protected async resolveProjectionAuthToken(
    options: NormalizedGenerateChatOptions,
  ): Promise<string> {
    const runtimeToken = await resolveRuntimeAuthToken(
      options.resolved.authToken,
    );
    if (runtimeToken !== undefined && runtimeToken !== '') {
      return runtimeToken;
    }
    return this.activeCallContext.run(options, () =>
      this.getAuthTokenForPrompt(),
    );
  }

  /**
   * @plan PLAN-20251018-STATELESSPROVIDER2.P06
   * @requirement REQ-SP2-001
   * @pseudocode base-provider-call-contract.md lines 3-5
   *
   * Issue #2616 PR A: the module-level runtime-context swap around each
   * provider call is deleted. The call-scoped context is carried by
   * NormalizedGenerateChatOptions and by the instance-owned
   * activeCallContext AsyncLocalStorage; outside readers receive their
   * collaborators explicitly.
   */
  private invokeWithNormalizedOptions(
    normalized: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    return async function* (
      this: BaseProvider,
    ): AsyncIterableIterator<IContent> {
      try {
        const iterator = this.generateChatCompletionWithOptions(normalized);
        for await (const chunk of iterator) {
          yield chunk;
        }
      } finally {
        normalized.resolved.authToken = '';
        delete normalized.resolved.authFailure;
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
    resolveAuthentication: boolean = true,
  ): Promise<NormalizedGenerateChatOptions> {
    const providedOptions: GenerateChatOptions = Array.isArray(
      contentsOrOptions,
    )
      ? { contents: contentsOrOptions, tools: maybeTools }
      : copyProviderRequestOptions(contentsOrOptions);
    const owner = this.owner;
    const capturedPolicy = captureInvocationEphemerals({
      ...this.providerConfig?.readConnectionPolicy?.(),
      ...owner.capturePolicy(),
    });
    const providerSettingsSnapshot = {
      ...readInvocationPolicyRecord(capturedPolicy[this.name]),
    };
    const providerSettings = {
      temperature:
        typeof providerSettingsSnapshot.temperature === 'number'
          ? providerSettingsSnapshot.temperature
          : undefined,
      maxTokens:
        typeof providerSettingsSnapshot.maxTokens === 'number'
          ? providerSettingsSnapshot.maxTokens
          : undefined,
      streaming:
        typeof providerSettingsSnapshot.streaming === 'boolean'
          ? providerSettingsSnapshot.streaming
          : undefined,
    };
    const selectedPolicy = isRuntimeInvocationContext(
      providedOptions.invocation,
    )
      ? providedOptions.invocation.ephemerals
      : capturedPolicy;
    const resolvedBaseURL = this.computeBaseURL(selectedPolicy);
    const resolvedModel = this.computeModel(selectedPolicy);
    const configuredHeaders = getProviderCustomHeaders(this.providerConfig);
    const ephemeralsSnapshot = selectedPolicy;
    const providerDefaults = captureInvocationEphemerals(
      this.captureProviderDefaults(),
    );
    const { token: resolvedAuth, failure: authFailure } =
      await this.admitAuthentication(
        owner,
        {
          ...providedOptions,
          metadata: {
            ...providedOptions.metadata,
            profileId:
              providedOptions.metadata?.profileId ??
              readInvocationPolicyValue(ephemeralsSnapshot, 'currentProfile'),
          },
        },
        resolvedBaseURL,
        resolveAuthentication,
      );

    return normalizeProviderGenerateChatOptions(this, providedOptions, {
      providerName: this.name,
      maybeTools,
      authToken: resolvedAuth,
      ...(authFailure === undefined ? {} : { authFailure }),
      resolvedModel,
      resolvedBaseURL,
      providerSettings,
      ephemeralsSnapshot,
      providerDefaults,
      configuredHeaders: configuredHeaders ?? {},
    });
  }

  private async admitAuthentication(
    owner: ProviderOwner,
    providedOptions: GenerateChatOptions,
    resolvedBaseURL: string | undefined,
    resolveAuthentication: boolean,
  ): Promise<{
    token: ResolvedAuthToken;
    failure?: CredentialResolutionError;
  }> {
    if (!resolveAuthentication)
      return { token: providedOptions.resolved?.authToken ?? '' };
    const runtimeId = providedOptions.invocation?.runtimeId;
    const { authIntent } = providedOptions.metadata ?? {};
    const profileId = providedOptions.metadata?.profileId;
    const authInput: Parameters<ProviderOwner['readAuthentication']>[0] = {
      includeOAuth: this.isOAuthEligible(
        providedOptions.resolved?.baseURL ?? resolvedBaseURL,
      ),
      runtimeId,
      ...(typeof profileId === 'string' ? { profileId } : {}),
      ...(authIntent === 'oauth' || authIntent === 'apikey'
        ? { authIntent }
        : {}),
    };
    const readAuthentication =
      this.requestAuthentication ?? owner.captureAuthentication();
    return {
      token: {
        provide: async () => {
          const live = await readAuthentication(authInput);
          if (live.token === null) throw live.failure;
          return live.token;
        },
      },
    };
  }

  protected captureOwnerPolicy(): Readonly<Record<string, unknown>> {
    const active = this.activeCallContext.getStore();
    return active?.invocation.ephemerals ?? this.owner.capturePolicy();
  }

  protected captureOwnerDefaults(): Readonly<Record<string, unknown>> {
    return (
      this.activeCallContext.getStore()?.invocation.providerDefaults ??
      captureInvocationEphemerals(this.captureProviderDefaults())
    );
  }

  private captureProviderDefaults(): Record<string, unknown> {
    const config = this.providerConfig;
    return {
      defaultModel: config?.defaultModel ?? this.getDefaultModel(),
      baseUrl: config?.baseUrl ?? this.baseProviderConfig.baseURL,
      temperature: config?.temperature,
      maxTokens: config?.maxTokens,
      streaming: config?.streaming,
      timeout: config?.timeout,
      openaiResponsesEnabled: config?.openaiResponsesEnabled,
      providerSpecific: config?.providerSpecific,
      ephemerals: config?.readConnectionPolicy?.(),
      enableTextToolCallParsing: config?.enableTextToolCallParsing,
      textToolCallModels: config?.textToolCallModels,
      providerToolFormatOverrides: config?.providerToolFormatOverrides,
      organizationId: config?.organizationId,
      projectId: config?.projectId,
    };
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P05
   * @requirement:REQ-SP4-001
   * @pseudocode base-provider-fallback-removal.md lines 11-14
   */
  protected assertRuntimeContext(input: {
    providerKey: string;
    metadata?: Record<string, unknown>;
    resolved?: NormalizedGenerateChatOptions['resolved'];
    stage: string;
  }): {
    metadata: Record<string, unknown>;
  } {
    return assertProviderRequestData(input);
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
    if (config === null || config === undefined || typeof config !== 'object') {
      return;
    }

    if ('getModel' in config && typeof config.getModel === 'function') {
      return;
    }

    this.providerConfig = config as IProviderConfig;
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
    try {
      const settings = await this.owner.readProviderData();
      const value = settings[key];
      const shouldUseFallback = isFalsyLikeValue(value);
      return shouldUseFallback ? fallback : (value as T);
    } catch (error) {
      if (process.env.DEBUG) {
        debugLogger.error(
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
    try {
      await this.owner.writeProviderData({
        [key]: value,
      });
    } catch (error) {
      if (process.env.DEBUG) {
        debugLogger.error(
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
    return this.getProviderSetting('auth-key');
  }

  /**
   * Set API key in SettingsService if available
   */
  protected async setApiKeyInSettings(apiKey: string): Promise<void> {
    await this.setProviderSetting('auth-key', apiKey);
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
    return this.getProviderSetting('base-url');
  }

  /**
   * Set base URL in SettingsService if available
   */
  protected async setBaseUrlInSettings(baseUrl?: string): Promise<void> {
    await this.setProviderSetting('base-url', baseUrl);
  }

  /**
   * Get model parameters from SettingsService
   */
  protected async getModelParamsFromSettings(): Promise<
    Record<string, unknown> | undefined
  > {
    try {
      const settings = await this.owner.readProviderData();

      // Extract model parameters from settings, excluding standard fields
      const {
        enabled: _enabled,
        'auth-key': _authKey,
        'auth-keyfile': _authKeyfile,
        'base-url': _baseUrl,
        model: _model,
        max_tokens,
        temperature,
        // Defensive: strip legacy sensitive aliases that should never reach
        // the model params pass-through, even if present in imported/malformed
        // provider settings data.
        apiKey: _legacyApiKey,
        apiKeyfile: _legacyApiKeyfile,
        'api-key': _legacyApiKeyDash,
        'api-keyfile': _legacyApiKeyfileDash,
        ...additionalSettings
      } = settings;

      // Include registered model parameters when present
      const params: Record<string, unknown> = {};
      if (temperature !== undefined) params.temperature = temperature;
      if (max_tokens !== undefined) params.max_tokens = max_tokens;

      return Object.keys(params).length > 0 ||
        Object.keys(additionalSettings).length > 0
        ? { ...params, ...additionalSettings }
        : undefined;
    } catch (error) {
      if (process.env.DEBUG) {
        debugLogger.error(
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
    if (params === undefined) {
      await this.owner.writeProviderData({
        temperature: undefined,
        max_tokens: undefined,
      });
      return;
    }

    await this.owner.writeProviderData(params);
  }

  /**
   * Get custom headers from provider configuration and ephemeral settings.
   *
   * This merges:
   * - Provider config `customHeaders`
   * - Ephemeral `custom-headers`
   * - Ephemeral `user-agent` (mapped into a `User-Agent` header)
   * - Invocation `customHeaders` (from separated settings)
   */
  protected getCustomHeaders(
    options?: NormalizedGenerateChatOptions,
  ): Record<string, string> | undefined {
    const admitted = options ?? this.activeCallContext.getStore();
    if (admitted) {
      return { ...admitted.invocation.customHeaders };
    }
    return getProviderCustomHeaders(this.providerConfig);
  }
}

// Import ProviderSettings type to avoid circular dependency
/**
 * Helper function to check if a value is falsy-like.
 * Used for determining when to use fallback values for provider settings.
 */
function isFalsyLikeValue(value: unknown): boolean {
  // Check undefined/null first
  if (value === undefined || value === null) return true;
  // Check false, empty string, or 0
  if (value === false || value === '' || value === 0) return true;
  // Check NaN for numbers
  return typeof value === 'number' && Number.isNaN(value);
}

export interface ProviderSettings {
  enabled: boolean;
  'auth-key'?: string;
  'auth-keyfile'?: string;
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  [key: string]: unknown;
}
