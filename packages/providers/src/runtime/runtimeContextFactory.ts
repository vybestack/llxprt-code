import type { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  RuntimeTokenizerFactory,
  RuntimeContentGeneratorFactory,
  ContentGenerator,
} from '@vybestack/llxprt-code-core';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';

import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';

/**
 * @plan:PLAN-20260603-ISSUE1584.P12
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-15
 */

import { createOwnerAuthCacheInvalidator } from '../auth/owner-cache-invalidation.js';
import { configureProviderRuntimeFactories } from '../composition/providerManagerInstance.js';
import { cleanupOwnedProviderFiles } from './ownedProviderFiles.js';

import { randomUUID } from 'node:crypto';
/**
 * @plan:PLAN-20250214-CREDPROXY.P33
 */

import { type RuntimeProviderManager } from '@vybestack/llxprt-code-core';
import {
  type Config,
  createProviderRuntimeContext,
} from '@vybestack/llxprt-code-core';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type {
  ProfileManager,
  SettingsService,
} from '@vybestack/llxprt-code-settings';
import { ProviderManager } from '../ProviderManager.js';
import { ProviderFileLifecycle } from '../providerFilePolicy.js';
import { OAuthManager } from '../auth/index.js';
import type { TokenStore } from '../auth/types.js';
import {
  createOwnedTokenStore,
  closeOwnedTokenStore,
} from '../auth/proxy/credential-store-factory.js';
import { validateRuntimeId } from './runtimeIdValidation.js';
import type { RuntimeKind } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createFileOAuthSettingsProvider } from '../auth/file-oauth-settings.js';
import { registerStandardOAuthProviders } from '../composition/oauth-provider-registration.js';

export type { AgentRuntimeFactoryBindings } from '@vybestack/llxprt-code-core';

export interface RuntimeActivationBindings {
  resetInfrastructure: (
    runtimeId?: string,
    config?: Config,
  ) => void | Promise<void>;
  setRuntimeContext: (
    settingsService: SettingsService,
    config: Config,
    options: {
      metadata?: Record<string, unknown>;
      providerFileLifecycle?: ProviderFileLifecycle;
      runtimeId: string;
      profileManager?: ProfileManager;
      setAsDefault?: boolean;
      runtimeKind?: RuntimeKind;
    },
  ) => void | Promise<void>;
  registerInfrastructure: (
    manager: RuntimeProviderManager,
    oauthManager: OAuthManager,
    options: {
      messageBus: MessageBus;
      providerFileLifecycle?: ProviderFileLifecycle;
      runtimeId: string;
      metadata?: Record<string, unknown>;
      registerAsGlobalSingleton?: boolean;
      runtimeKind?: RuntimeKind;
      config?: Config;
    },
  ) => void | Promise<void>;
  linkProviderManager: (
    config: Config,
    manager: RuntimeProviderManager,
  ) => void | Promise<void>;
  disposeRuntime?: (runtimeId: string, config?: Config) => void | Promise<void>;
}

interface RuntimeActivationState {
  cleanupRequired: boolean;
  currentRuntimeId: string;
  currentRuntimeKind: RuntimeKind;
  currentMetadata: Record<string, unknown>;
}

/**
 * @plan:PLAN-20251018-STATELESSPROVIDER2.P03
 * @requirement:REQ-SP2-002
 * @pseudocode multi-runtime-baseline.md lines 7-7
 * Runtime activation overrides that allow callers to adjust metadata and runtimeId per Step 6.
 */
export interface IsolatedRuntimeActivationOptions {
  metadata?: Record<string, unknown>;
  runtimeId?: string;
  runtimeKind?: RuntimeKind;
}

/**
 * @plan:PLAN-20251018-STATELESSPROVIDER2.P03
 * @requirement:REQ-SP2-002
 * @pseudocode multi-runtime-baseline.md lines 3-4
 * Options for constructing an isolated CLI runtime with dedicated SettingsService/Config instances.
 */
export interface IsolatedRuntimeContextOptions {
  readonly borrowedTelemetry?: RootTelemetry;
  readonly profileReads?: Pick<ProfileManager, 'loadProfile'>;
  readonly tokenizerFactory?: RuntimeTokenizerFactory;
  readonly contentGeneratorFactory?: RuntimeContentGeneratorFactory<ContentGenerator>;
  readonly settingsOwner?: SessionSettingsOwner;
  readonly settingsOwnerOwnership?: 'borrowed' | 'transferred';
  activationBindings: RuntimeActivationBindings;
  runtimeId?: string;
  runtimeKind?: RuntimeKind;
  metadata?: Record<string, unknown>;
  config: Config;
  oauthManager?: OAuthManager;
  readonly providerFileLifecycle?: ProviderFileLifecycle;
  tokenStore?: TokenStore;
  /**
   * Caller-provided shared MessageBus. When supplied, the runtime uses THIS
   * instance as its session bus (so the context-created OAuthManager binds to
   * it) instead of constructing a private one.
   * @plan:PLAN-20260617-COREAPI.P15
   * @requirement:REQ-001
   */
  messageBus?: MessageBus;
  /**
   * Caller-provided provider manager. When supplied, the runtime ADOPTS this
   * instance instead of constructing a private one, so a Config-adopting caller
   * (e.g. agents `fromConfig`) does not create a second manager.
   *
   * CRIT-1: typed as the STRUCTURAL core interface RuntimeProviderManager (not the
   * concrete providers ProviderManager class) so the agents caller can pass
   * The explicit borrowed provider manager owner.
   * (configBaseCore.ts:265) — with ZERO assertion. The default ProviderManager
   * instance constructed below structurally satisfies this interface.
   * @plan:PLAN-20260621-COREAPIREMED.P03
   * @requirement:REQ-005.2
   */
  providerManager?: RuntimeProviderManager;
  prepare?: (context: {
    config: Config;
    settingsService: SettingsService;
    providerManager: RuntimeProviderManager;
    oauthManager: OAuthManager;
    providerFileLifecycle: ProviderFileLifecycle;
    runtimeId: string;
    metadata: Record<string, unknown>;
  }) => void | Promise<void>;
  onCleanup?: (context: {
    config: Config;
    settingsService: SettingsService;
    providerManager: RuntimeProviderManager;
    runtimeId: string;
    metadata: Record<string, unknown>;
  }) => void | Promise<void>;
}

/**
 * @plan:PLAN-20251018-STATELESSPROVIDER2.P03
 * @requirement:REQ-SP2-002
 * @pseudocode multi-runtime-baseline.md lines 7-8
 * Handle returned by the factory that exposes activation and cleanup hooks per Steps 6-7.
 */
export interface IsolatedRuntimeContextHandle {
  readonly tokenizerFactory: RuntimeTokenizerFactory;
  readonly contentGeneratorFactory: RuntimeContentGeneratorFactory<ContentGenerator>;
  readonly settingsOwner: SessionSettingsOwner;
  readRuntimeKind: () => RuntimeKind;
  runtimeId: string;
  metadata: Record<string, unknown>;
  settingsService: SettingsService;
  config: Config;
  providerManager: RuntimeProviderManager;
  oauthManager: OAuthManager;
  readonly providerFileLifecycle: ProviderFileLifecycle;
  activate: (
    options?: IsolatedRuntimeActivationOptions,
  ) => Promise<void> | void;
  cleanup: () => Promise<void> | void;
}

/** Builds an OAuthManager using credentials supplied by its runtime owner. */
function resolveOAuthManager(
  sessionMessageBus: MessageBus,
  optionsOAuthManager: OAuthManager | undefined,
  tokenStore: TokenStore | undefined,
  config: Config,
  invalidateAuthCaches: (providerName: string) => void,
  activationState: RuntimeActivationState,
  settings: SettingsService,
  profileReads: IsolatedRuntimeContextOptions['profileReads'],
): OAuthManager {
  if (optionsOAuthManager) {
    registerStandardOAuthProviders(optionsOAuthManager);
    return optionsOAuthManager;
  }
  if (!tokenStore) {
    throw new Error('Isolated runtime requires an owner-created token store');
  }
  const oauthSettings = createFileOAuthSettingsProvider();
  const oauthManager = new OAuthManager(tokenStore, oauthSettings, {
    messageBus: sessionMessageBus,
    config,
    profileReads,
    invalidateAuthCaches,
    readSessionAuthPolicy: () => ({
      profileName: settings.getCurrentProfileName(),
      baseUrl:
        typeof settings.get('base-url') === 'string'
          ? String(settings.get('base-url'))
          : undefined,
      bucketPrompt: settings.get('auth-bucket-prompt'),
      bucketDelay: settings.get('auth-bucket-delay'),
      interactiveTimeoutMs: settings.get('auth.interactiveTimeoutMs'),
      noBrowser: settings.get('auth.noBrowser') === true,
      authOnly: settings.get('authOnly') === true,
    }),
    readAuthIdentity: () => ({
      runtimeId: activationState.currentRuntimeId,
      runtimeKind: activationState.currentRuntimeKind,
    }),
  });
  registerStandardOAuthProviders(oauthManager, tokenStore);
  return oauthManager;
}

/**
 * @plan:PLAN-20251018-STATELESSPROVIDER2.P03
 * @requirement:REQ-SP2-002
 * @pseudocode multi-runtime-baseline.md lines 7-7
 * Execute the activation flow in the reset → context → infrastructure → link order per Step 6.
 */
function buildActivateClosure(
  runtimeId: string,
  baseMetadata: Record<string, unknown>,
  state: RuntimeActivationState,
  resolvedSettingsService: SettingsService,
  config: Config,
  providerManager: RuntimeProviderManager,
  oauthManager: OAuthManager,
  options: IsolatedRuntimeContextOptions,
  sessionMessageBus: MessageBus,
  providerFileLifecycle: ProviderFileLifecycle,
): (activationOptions?: IsolatedRuntimeActivationOptions) => Promise<void> {
  return async (
    activationOptions?: IsolatedRuntimeActivationOptions,
  ): Promise<void> => {
    const bindings = options.activationBindings;

    state.currentRuntimeId = activationOptions?.runtimeId ?? runtimeId;
    validateRuntimeId(state.currentRuntimeId);
    state.currentMetadata = {
      ...baseMetadata,
      ...(activationOptions?.metadata ?? {}),
    };
    state.cleanupRequired = true;

    state.currentRuntimeKind =
      activationOptions?.runtimeKind ?? options.runtimeKind ?? 'agent';

    const scopedRuntime = createProviderRuntimeContext({
      sessionSettings: options.settingsOwner,
      settingsService: resolvedSettingsService,
      config,
      providerFileLifecycle,
      runtimeId: state.currentRuntimeId,
      runtimeKind: state.currentRuntimeKind,
      metadata: state.currentMetadata,
    });
    providerManager.setRetryOperationsFactory?.((providerName, profileId) =>
      oauthManager.composeRetryOperations(
        providerName,
        profileId ? { profileId } : undefined,
      ),
    );
    providerManager.setRuntimeContext(scopedRuntime);

    await Promise.resolve(
      bindings.resetInfrastructure(state.currentRuntimeId, config),
    );
    await Promise.resolve(
      bindings.setRuntimeContext(resolvedSettingsService, config, {
        runtimeId: state.currentRuntimeId,
        metadata: state.currentMetadata,
        setAsDefault: false,
        providerFileLifecycle,
        runtimeKind: state.currentRuntimeKind,
      }),
    );

    if (options.prepare) {
      await options.prepare({
        config,
        settingsService: resolvedSettingsService,
        providerManager,
        oauthManager,
        providerFileLifecycle,
        runtimeId: state.currentRuntimeId,
        metadata: state.currentMetadata,
      });
    }

    await Promise.resolve(
      bindings.registerInfrastructure(providerManager, oauthManager, {
        messageBus: sessionMessageBus,
        runtimeId: state.currentRuntimeId,
        metadata: state.currentMetadata,
        registerAsGlobalSingleton: false,
        providerFileLifecycle,
        runtimeKind: state.currentRuntimeKind,
        config,
      }),
    );
    await Promise.resolve(
      bindings.linkProviderManager(config, providerManager),
    );
  };
}

/**
 * @plan:PLAN-20251018-STATELESSPROVIDER2.P03
 * @requirement:REQ-SP2-002
 * @pseudocode multi-runtime-baseline.md lines 8-8
 * Clear activation state and invoke onCleanup hooks in the reverse order detailed in Step 7.
 */
function buildCleanupClosure(
  state: RuntimeActivationState,
  resolvedSettingsService: SettingsService,
  config: Config,
  providerManager: RuntimeProviderManager,
  options: IsolatedRuntimeContextOptions,
  ownedAuth: OwnedAuthResources,
  providerFileLifecycle: ProviderFileLifecycle,
): () => Promise<void> {
  const clientScope = config.getSessionId();
  let closing: Promise<void> | undefined;
  return (): Promise<void> => {
    closing ??= (async (): Promise<void> => {
      const failures: unknown[] = [];
      const settle = async (
        operation: () => void | Promise<void>,
      ): Promise<void> => {
        try {
          await operation();
        } catch (error) {
          failures.push(error);
        }
      };
      const bindings = options.activationBindings;
      if (state.cleanupRequired || options.onCleanup !== undefined) {
        await settle(() =>
          bindings.resetInfrastructure(state.currentRuntimeId, config),
        );
        await settle(() =>
          options.onCleanup?.({
            config,
            settingsService: resolvedSettingsService,
            providerManager,
            runtimeId: state.currentRuntimeId,
            metadata: state.currentMetadata,
          }),
        );
        await settle(() =>
          bindings.disposeRuntime?.(state.currentRuntimeId, config),
        );
      }
      for (const scope of state.currentRuntimeId === clientScope
        ? [clientScope]
        : [state.currentRuntimeId, clientScope]) {
        await settle(() =>
          cleanupOwnedProviderFiles(providerFileLifecycle, scope),
        );
      }
      state.cleanupRequired = false;
      if (options.providerManager === undefined)
        await settle(() => providerManager.dispose?.());
      // Renewals read and lock through the store, so the owned manager is
      // retired (timers cancelled, in-flight work joined) before the store closes.
      await settle(() => ownedAuth.oauthManager?.dispose());
      await settle(() => closeOwnedTokenStore(ownedAuth.tokenStore));
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1)
        throw new AggregateError(failures, 'Provider runtime cleanup failed');
    })();
    return closing;
  };
}

/** Auth resources created by this runtime; borrowed ones are never listed. */
interface OwnedAuthResources {
  readonly oauthManager: OAuthManager | undefined;
  readonly tokenStore: TokenStore | undefined;
}

function resolveOwnerOAuthManager(
  options: IsolatedRuntimeContextOptions,
  sessionMessageBus: MessageBus,
  config: Config,
  providerManager: RuntimeProviderManager,
  state: RuntimeActivationState,
  settings: SettingsService,
): { oauthManager: OAuthManager; ownedAuth: OwnedAuthResources } {
  const ownedTokenStore =
    options.oauthManager === undefined && options.tokenStore === undefined
      ? createOwnedTokenStore()
      : undefined;
  const oauthManager = resolveOAuthManager(
    sessionMessageBus,
    options.oauthManager,
    options.tokenStore ?? ownedTokenStore,
    config,
    createOwnerAuthCacheInvalidator((name) =>
      providerManager.getProviderByName(name),
    ),
    state,
    settings,
    options.profileReads,
  );
  return {
    oauthManager,
    ownedAuth: {
      oauthManager:
        options.oauthManager === undefined ? oauthManager : undefined,
      tokenStore: ownedTokenStore,
    },
  };
}

/**
 * @plan:PLAN-20251018-STATELESSPROVIDER2.P03
 * @requirement:REQ-SP2-002
 * @pseudocode multi-runtime-baseline.md lines 2-5
 * Construct an isolated runtime using shared immutable resources and scoped services.
 */
function createOwnerFileLifecycle(
  supplied: ProviderFileLifecycle | undefined,
): ProviderFileLifecycle {
  return (
    supplied ??
    new ProviderFileLifecycle({ maxFiles: 100, maxBytes: 512 * 1024 * 1024 })
  );
}

function closeSettingsWithRuntime(
  ownedOwner: SessionSettingsOwner | undefined,
  cleanup: () => Promise<void>,
): () => Promise<void> {
  return async () => {
    const runtime = await Promise.allSettled([Promise.resolve().then(cleanup)]);
    const settings = await Promise.allSettled([
      Promise.resolve().then(() => ownedOwner?.dispose()),
    ]);
    const failures = [...runtime, ...settings].flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(
        failures,
        'Runtime and session settings cleanup failed',
      );
  };
}

function adoptSessionSettings(
  owner: SessionSettingsOwner | undefined,
  settings: SettingsService,
): SessionSettingsOwner {
  const selected = owner ?? new SessionSettingsOwner(settings);
  selected.assertSettingsIdentity(settings);
  return selected;
}

function createActivationState(
  runtimeId: string,
  kind: RuntimeKind | undefined,
  metadata: Record<string, unknown>,
): RuntimeActivationState {
  return {
    cleanupRequired: false,
    currentRuntimeId: runtimeId,
    currentRuntimeKind: kind ?? 'agent',
    currentMetadata: metadata,
  };
}

function initialRuntimeMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> {
  return { source: 'cli-isolated-runtime-factory', ...metadata };
}

function initialProviderContext(
  options: IsolatedRuntimeContextOptions,
  settingsService: SettingsService,
  providerFileLifecycle: ProviderFileLifecycle,
  runtimeId: string,
  metadata: Record<string, unknown>,
) {
  return createProviderRuntimeContext({
    settingsService,
    config: options.config,
    sessionSettings: options.settingsOwner,
    providerFileLifecycle,
    runtimeId,
    runtimeKind: options.runtimeKind ?? 'agent',
    metadata,
  });
}

export function createIsolatedRuntimeContext(
  options: IsolatedRuntimeContextOptions,
  settingsService: SettingsService,
): IsolatedRuntimeContextHandle {
  validateRequiredOwnerOptions(options, settingsService);
  const runtimeId = isolatedRuntimeId(options.runtimeId);

  const baseMetadata = initialRuntimeMetadata(options.metadata);
  const settingsOwner = adoptSessionSettings(
    options.settingsOwner,
    settingsService,
  );
  settingsOwner.bindTelemetry(options.config, options.borrowedTelemetry);
  const ownerOptions = { ...options, settingsOwner };
  const providerFileLifecycle = createOwnerFileLifecycle(
    options.providerFileLifecycle,
  );
  // @plan:PLAN-20260617-COREAPI.P15
  // @requirement:REQ-001
  // Use the caller-provided bus when present so the context-created
  // OAuthManager binds to the SAME bus the caller shares with the loop.
  const [policyOwner, sessionMessageBus] = assembleProviderPolicy(
    options.config,
    options.messageBus,
  );

  const initialRuntimeContext = initialProviderContext(
    ownerOptions,
    settingsService,
    providerFileLifecycle,
    runtimeId,
    baseMetadata,
  );

  const activationState = createActivationState(
    runtimeId,
    options.runtimeKind,
    baseMetadata,
  );

  // @plan:PLAN-20260621-COREAPIREMED.P05 @requirement:REQ-005.2 @pseudocode lines 10-40
  // Adopt the caller-provided manager when supplied (mirrors the messageBus? adoption
  // at `options.messageBus ?? new MessageBus(...)`); otherwise construct a fresh one.
  const providerManager =
    options.providerManager ?? new ProviderManager(initialRuntimeContext);
  const selectedFactories = configureProviderRuntimeFactories(
    options.config,
    providerManager,
    options,
  );

  const { oauthManager, ownedAuth } = resolveOwnerOAuthManager(
    options,
    sessionMessageBus,
    options.config,
    providerManager,
    activationState,
    settingsService,
  );

  const { activate, cleanup } = assembleProviderLifetime(
    runtimeId,
    baseMetadata,
    activationState,
    settingsService,
    providerManager,
    oauthManager,
    ownerOptions,
    sessionMessageBus,
    providerFileLifecycle,
    ownedAuth,
  );

  return {
    runtimeId,
    ...selectedFactories,
    readRuntimeKind: () => activationState.currentRuntimeKind,
    metadata: baseMetadata,
    settingsService,
    config: options.config,
    providerManager,
    oauthManager,
    providerFileLifecycle,
    activate,
    settingsOwner,
    cleanup: closeRuntimeOwners(
      settingsOwner,
      cleanup,
      policyOwner,
      options.settingsOwner === undefined,
      options.settingsOwnerOwnership,
    ),
  };
}

function assembleProviderLifetime(
  runtimeId: string,
  baseMetadata: Record<string, unknown>,
  activationState: RuntimeActivationState,
  settingsService: SettingsService,
  providerManager: RuntimeProviderManager,
  oauthManager: OAuthManager,
  options: IsolatedRuntimeContextOptions,
  sessionMessageBus: MessageBus,
  providerFileLifecycle: ProviderFileLifecycle,
  ownedAuth: OwnedAuthResources,
) {
  const activate = buildActivateClosure(
    runtimeId,
    baseMetadata,
    activationState,
    settingsService,
    options.config,
    providerManager,
    oauthManager,
    options,
    sessionMessageBus,
    providerFileLifecycle,
  );

  const cleanup = buildCleanupClosure(
    activationState,
    settingsService,
    options.config,
    providerManager,
    options,
    ownedAuth,
    providerFileLifecycle,
  );

  const activateTelemetry = async (
    activationOptions?: IsolatedRuntimeActivationOptions,
  ): Promise<void> => {
    if (options.settingsOwner === undefined)
      throw new Error('Runtime activation requires selected session settings');
    await options.settingsOwner.startTelemetry(options.config);
    await activate(activationOptions);
  };
  return { activate: activateTelemetry, cleanup };
}

function hasRequiredOption<K extends string>(
  options: { readonly [P in K]?: unknown },
  key: K,
): boolean {
  const value: unknown = options[key];
  return value !== undefined && value !== null;
}

function validateRequiredOwnerOptions(
  options: IsolatedRuntimeContextOptions,
  settingsService: SettingsService,
): void {
  if (!hasRequiredOption(options, 'activationBindings')) {
    throw new Error('Isolated runtime requires explicit activation bindings');
  }
  if (!hasRequiredOption(options, 'config')) {
    throw new Error(
      'createIsolatedRuntimeContext requires a caller-supplied Config',
    );
  }
  const providedSettings: unknown = settingsService;
  if (providedSettings === undefined || providedSettings === null) {
    throw new Error('Isolated runtime requires explicit session settings');
  }
}

function closeRuntimeOwners(
  settingsOwner: SessionSettingsOwner,
  cleanup: () => Promise<void>,
  policyOwner: RuntimePolicyOwner | undefined,
  createdOwner: boolean,
  ownership: 'borrowed' | 'transferred' | undefined,
): () => Promise<void> {
  const ownedOwner =
    createdOwner || ownership === 'transferred' ? settingsOwner : undefined;
  return closePolicyWithRuntime(
    closeSettingsWithRuntime(ownedOwner, cleanup),
    policyOwner,
  );
}

function closePolicyWithRuntime(
  cleanup: () => Promise<void>,
  policy: RuntimePolicyOwner | undefined,
): () => Promise<void> {
  return async () => {
    try {
      await cleanup();
    } finally {
      await policy?.dispose();
    }
  };
}

function assembleProviderPolicy(
  config: Config,
  borrowedBus: MessageBus | undefined,
): readonly [RuntimePolicyOwner | undefined, MessageBus] {
  if (borrowedBus !== undefined) return [undefined, borrowedBus];
  const owner = new RuntimePolicyOwner(config);
  return [owner, owner.session.messageBus];
}

function isolatedRuntimeId(supplied: string | undefined): string {
  const runtimeId = supplied ?? `cli-isolated-${randomUUID()}`;
  validateRuntimeId(runtimeId);
  return runtimeId;
}
