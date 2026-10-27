/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  Config,
  ProviderSwitcher,
  RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { RuntimeKind } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import type { ProviderMessage } from '@vybestack/llxprt-code-providers';
import { getOpenAIProviderInfo } from '@vybestack/llxprt-code-providers';
import {
  computeUnallowedParameters,
  loadProviderAliasEntries,
  refreshAliasProviders,
} from '@vybestack/llxprt-code-providers/composition.js';
import { extractModelParams } from '@vybestack/llxprt-code-providers/model-parameter-data.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { SessionClientAcquisitionOwner } from '../session/session-client-acquisition-owner.js';
import type { SessionConversationBinding } from '../session/session-conversation-binding.js';
import type { SessionClientOwner } from '../session/session-client-owner.js';
import type {
  Agent,
  AgentProviderSwitchOptions,
  AgentProviderSwitchResult,
  ProviderStatus,
} from './agent.js';
import { buildProviderInfos, type OwnershipRecord } from './agentBootstrap.js';
import { AgentExecutionCoordinator } from './agentExecutionCoordinator.js';
import type { AgentAuth, OAuthPromptHandler } from './config-types.js';
import { AuthControl } from './control/authControl.js';
import {
  authStatusForWinner,
  computeAuthWinner,
  type AgentAuthState,
  type AgentProviderState,
  type AuthWinner,
} from './control/authState.js';
import { createProviderInspection } from './control/provider-inspection.js';
import { ProfilesControl } from './control/profilesControl.js';
import { assembleSettingsControl } from './control/settings-control.js';
import { assembleToolFormatControl } from './control/tool-format-control.js';
import type { WorkspaceControl } from './control/workspaceControl.js';
import type { ActiveRun } from './directProviderAdmission.js';
import { AgentBusyError } from './loop/agentBusyError.js';
import { assembleModelParameterControl } from './model-parameters.js';
import { assembleProfileApplication } from './profileApplicationAssembly.js';
import {
  buildProfileProviderStatus,
  snapshotModelParams,
} from './profilePersistenceAssembly.js';
import { captureProfileModelParams } from './profileSnapshot.js';
import {
  applyFacadeAuthBaseUrl,
  selectOwnerModel,
  updateActiveProviderApiKey,
} from './providerMutations.js';
import {
  applyModelWithPublication,
  publishProviderSwitch,
} from './modelPublication.js';
import {
  applyFacadeProviderSwitch,
  type FacadeSwitchOperations,
} from './providerSwitchOptionsAdapter.js';
import { assembleProviderSwitch } from './providerSwitchAssembly.js';
import { initializeProviderState } from './session-control-assembly.js';

type OpenAIProviderInfo = ReturnType<typeof getOpenAIProviderInfo>;

export interface AgentOpenAIProviderInfo {
  readonly providerIdentity: object | null;
  readonly currentModel: string | null;
  readonly isResponsesAPI: boolean;
  readonly remoteTokenInfo: OpenAIProviderInfo['remoteTokenInfo'];
  getCachedConversation(
    conversationId: string,
    parentId: string,
  ): ProviderMessage[] | null;
}

export const NO_ACTIVE_PROVIDER_ERROR_MESSAGE =
  'No active provider is configured.';

export interface SessionProviderStatus {
  providerName: string | null;
  modelName: string | null;
  displayLabel: string;
  isPaidMode?: boolean;
  baseURL?: string;
}

export interface SessionProviderReads {
  readonly inspection: ReturnType<typeof createProviderInspection>;
  refreshAliases(): Promise<void>;
  readOpenAIInfo(): AgentOpenAIProviderInfo;
  readActiveProviderName(): string | null;
  getActiveProviderName(): string;
  getActiveModelName(): string;
  getActiveModelParams(): Record<string, unknown>;
  listProviders(): string[];
  listAvailableModels(
    provider?: string,
  ): ReturnType<RuntimeProviderManager['getAvailableModels']>;
  getActiveProviderMetrics(): ReturnType<
    RuntimeProviderManager['getProviderMetrics']
  >;
  getSessionTokenUsage(): ReturnType<
    RuntimeProviderManager['getSessionTokenUsage']
  >;
  getUnallowedParametersForActiveModel(): string[];
  providerStatus(): SessionProviderStatus;
}

export const UNCONFIGURED_AGENT_MESSAGE =
  'No provider is configured. Run /setup to choose a hosted provider, configure a local model, set up a custom compatible endpoint, or select an existing profile before using the agent.';

function requireProviderOwner<T>(owner: T | undefined): void {
  if (owner === undefined)
    throw new Error('Provider reads require an explicit session owner');
}

function readOpenAIInfoFor(
  settingsOwner: SessionSettingsOwner,
  providers: RuntimeProviderManager,
  readConfiguredModel: () => string,
  readProviderSettings: (provider: string) => Record<string, unknown>,
  identityCache: {
    provider: OpenAIProviderInfo['provider'];
    identity: object | null;
  },
): AgentOpenAIProviderInfo {
  const info = getOpenAIProviderInfo(
    {
      settingsService: {
        get: (key: string) => settingsOwner.readNamedParameter(key),
        getProviderSettings: readProviderSettings,
      },
      config: {
        getProvider: () => settingsOwner.readSelectedProvider(),
        getModel: readConfiguredModel,
      },
    },
    {
      hasActiveProvider: () => providers.hasActiveProvider(),
      getActiveProviderName: () => providers.getActiveProviderName(),
      getActiveProvider: () => providers.getActiveProvider(),
    },
  );
  if (info.provider !== identityCache.provider) {
    identityCache.provider = info.provider;
    identityCache.identity = info.provider === null ? null : Object.freeze({});
  }
  const cache = info.conversationCache;
  return {
    providerIdentity: identityCache.identity,
    currentModel: info.currentModel,
    isResponsesAPI: info.isResponsesAPI,
    remoteTokenInfo: info.remoteTokenInfo,
    getCachedConversation: (conversationId, parentId) =>
      cache?.get(conversationId, parentId) ?? null,
  };
}

function providerStatusFor(
  providers: RuntimeProviderManager,
  providerName: string | null,
  modelName: string | null,
): SessionProviderStatus {
  const provider =
    providerName === null
      ? providers.getActiveProvider()
      : providers.getProviderByName(providerName);
  const resolvedName = providerName ?? provider?.name ?? null;
  const emptyLabel = resolvedName ?? modelName ?? 'unknown';
  const displayLabel =
    resolvedName && modelName ? `${resolvedName}:${modelName}` : emptyLabel;
  return {
    providerName: resolvedName,
    modelName,
    displayLabel,
    isPaidMode: provider?.isPaidMode?.(),
    baseURL:
      provider &&
      'getBaseURL' in provider &&
      typeof provider.getBaseURL === 'function'
        ? provider.getBaseURL()
        : undefined,
  };
}

export function createSessionProviderReads(
  settingsOwner: SessionSettingsOwner,
  providers: RuntimeProviderManager,
  readConfiguredModel: () => string,
  readProviderSettings: (provider: string) => Record<string, unknown>,
): SessionProviderReads {
  requireProviderOwner(settingsOwner);
  requireProviderOwner(providers);
  requireProviderOwner(readConfiguredModel);
  requireProviderOwner(readProviderSettings);
  const openAIIdentity: {
    provider: OpenAIProviderInfo['provider'];
    identity: object | null;
  } = { provider: null, identity: null };
  const readActiveProviderName = (): string | null =>
    settingsOwner.readSelectedProvider() ??
    providers.getActiveProviderName() ??
    null;
  const getActiveModelName = (): string => {
    const selected = settingsOwner.readSelectedModel();
    if (selected !== undefined && selected.trim() !== '') return selected;
    const configured = readConfiguredModel();
    if (configured.trim() !== '') return configured;
    return providers.getActiveProvider()?.getDefaultModel?.() ?? '';
  };
  return {
    get inspection() {
      return createProviderInspection(
        () => settingsOwner.readSelectedEndpoint(),
        providers,
      );
    },
    refreshAliases: async (): Promise<void> => {
      refreshAliasProviders(providers);
    },
    readOpenAIInfo: () =>
      readOpenAIInfoFor(
        settingsOwner,
        providers,
        readConfiguredModel,
        readProviderSettings,
        openAIIdentity,
      ),
    readActiveProviderName,
    getActiveProviderName: (): string => {
      const name = readActiveProviderName();
      if (name === null) throw new Error(NO_ACTIVE_PROVIDER_ERROR_MESSAGE);
      return name;
    },
    getActiveModelName,
    getActiveModelParams: (): Record<string, unknown> => {
      const provider = readActiveProviderName();
      return provider === null
        ? {}
        : extractModelParams(readProviderSettings(provider));
    },
    listProviders: () => providers.listProviders(),
    listAvailableModels: (provider) => providers.getAvailableModels(provider),
    getActiveProviderMetrics: () => providers.getProviderMetrics(),
    getSessionTokenUsage: () => providers.getSessionTokenUsage(),
    getUnallowedParametersForActiveModel: (): string[] => {
      const providerName = readActiveProviderName();
      const modelName = getActiveModelName();
      if (!providerName || !modelName) return [];
      const alias = loadProviderAliasEntries().find(
        (entry) => entry.alias === providerName,
      )?.config;
      return alias?.modelDefaults
        ? [...computeUnallowedParameters(modelName, alias.modelDefaults)]
        : [];
    },
    providerStatus: () =>
      providerStatusFor(
        providers,
        readActiveProviderName(),
        getActiveModelName() || null,
      ),
  };
}

export interface ProviderControlSettings {
  readonly settingsOwner: SessionSettingsOwner;
  readonly settingsService: SettingsService;
}

export interface SessionProviderContext {
  readonly config: Config;
  readonly authState: AgentAuthState;
  readonly ownership: OwnershipRecord;
  readonly runtimeState: AgentRuntimeState;
  readonly initialAuth: AgentAuth | undefined;
  readonly onOAuthPrompt: OAuthPromptHandler | undefined;
  readonly coordinator: AgentExecutionCoordinator;
  readonly workspace: WorkspaceControl;
  readonly readRuntimeKind: () => RuntimeKind;
  readonly selectModel: (model: string) => Promise<void>;
}

export type SessionProviderAssemblyValues = Omit<
  SessionProviderContext,
  'coordinator' | 'selectModel'
>;

export type SessionProviderOperations = Pick<
  SessionClientAcquisitionOwner,
  | 'rebuildExecution'
  | 'refreshAuth'
  | 'isCurrentExecution'
  | 'prepareProfileExecution'
> &
  Pick<SessionConversationBinding, 'restoreChatVisibility'> &
  Pick<SessionClientOwner, 'subscribeBucketConsent' | 'respondToBucketConsent'>;

export function createSessionProviderControl(
  settings: ProviderControlSettings,
  providers: RuntimeProviderManager,
  oauth: OAuthManager,
  session: SessionProviderOperations,
  values: SessionProviderAssemblyValues,
): SessionProviderControl {
  return new SessionProviderControl(settings, providers, oauth, session, {
    ...values,
    coordinator: new AgentExecutionCoordinator(),
    selectModel: selectOwnerModel(
      settings.settingsOwner,
      settings.settingsService,
      providers,
    ),
  });
}

export class SessionProviderControl {
  readonly coordinator: AgentExecutionCoordinator;
  readonly execution: Agent['execution'];
  readonly switchProvider: ProviderSwitcher;
  readonly providerReads: SessionProviderReads;
  readonly modelParameters: Agent['modelParameters'];
  readonly settings: Agent['settings'];
  readonly toolFormat: Agent['toolFormat'];
  readonly hasActiveProvider: Agent['hasActiveProvider'];
  readonly getProviderContextLimit: Agent['getProviderContextLimit'];
  readonly listAvailableModels: Agent['listAvailableModels'];
  readonly listProviders: Agent['listProviders'];
  readonly getProvider: Agent['getProvider'];
  readonly getProviderStatus: Agent['getProviderStatus'];
  readonly getModel: Agent['getModel'];
  readonly getModelParams: Agent['getModelParams'];
  readonly setProvider: Agent['setProvider'];
  readonly setModel: Agent['setModel'];
  readonly profiles: ProfilesControl;
  readonly auth: AuthControl;

  readonly #settings: ProviderControlSettings;
  readonly #providers: RuntimeProviderManager;
  readonly #oauth: OAuthManager;
  readonly #session: SessionProviderOperations;
  readonly #context: SessionProviderContext;
  readonly #providerState: AgentProviderState;
  readonly #readConfiguredModel: () => string;
  readonly #readProviderSettings: (provider: string) => Record<string, unknown>;

  constructor(
    settings: ProviderControlSettings,
    providers: RuntimeProviderManager,
    oauth: OAuthManager,
    session: SessionProviderOperations,
    context: SessionProviderContext,
  ) {
    this.#settings = settings;
    this.#providers = providers;
    this.#oauth = oauth;
    this.#session = session;
    this.#context = context;
    this.coordinator = context.coordinator;
    this.execution = context.coordinator;
    this.#providerState = initializeProviderState(
      context.runtimeState,
      context.initialAuth,
      context.authState,
    );
    this.#readConfiguredModel = () => this.#providerState.model;
    this.#readProviderSettings = (provider) =>
      settings.settingsService.getProviderSettings(provider);
    this.switchProvider = this.#constructProviderSwitch();
    this.providerReads = createSessionProviderReads(
      settings.settingsOwner,
      providers,
      this.#readConfiguredModel,
      this.#readProviderSettings,
    );
    this.modelParameters = this.#constructModelParameters();
    this.settings = this.#constructSettings();
    this.toolFormat = this.#constructToolFormat();
    this.hasActiveProvider = () => providers.hasActiveProvider();
    this.getProviderContextLimit = () =>
      providers.getActiveProvider()?.getContextLimit?.();
    this.listProviders = () => {
      const names = providers.listProviders();
      return buildProviderInfos(names, new Set(names));
    };
    this.getProvider = () => this.#providerState.provider;
    this.getModel = () => this.providerReads.getActiveModelName();
    this.getModelParams = () =>
      snapshotModelParams(this.#providerState.modelParams);
    this.getProviderStatus = () => this.#providerStatus();
    this.listAvailableModels = (provider) =>
      providers.getAvailableModels(
        provider ?? this.getProviderStatus().provider,
      );
    this.setProvider = (provider, model, options) =>
      this.#setProvider(provider, model, options);
    this.setModel = (model) => this.#setModel(model);
    this.profiles = this.#constructProfiles();
    this.auth = this.#buildAuthControl();
  }

  get activeRun(): ActiveRun | undefined {
    return this.coordinator.current();
  }

  assertProfileIdle(): void {
    this.coordinator.assertNoCommit();
    if (this.profiles.isApplying()) throw new AgentBusyError();
  }

  isProviderReady(): boolean {
    if (this.#context.ownership.disposed) throw new Error('Agent is closed');
    return this.#providers.hasActiveProvider();
  }

  #rebuild(): void {
    this.#session.rebuildExecution();
  }

  #constructModelParameters(): Agent['modelParameters'] {
    const { settingsService } = this.#settings;
    const providers = this.#providers;
    return assembleModelParameterControl(
      (provider, key, value) =>
        settingsService.setProviderSetting(provider, key, value),
      () => providers.getActiveProviderName(),
      () => this.#providerState.modelParams,
      () => this.coordinator.assertNoCommit(),
    );
  }

  #constructSettings(): Agent['settings'] {
    const owner = this.#settings.settingsOwner;
    return assembleSettingsControl(
      (key) => owner.readNamedParameter(key),
      () => owner.captureNamedParameters(),
      (key, value) => owner.writeUserParameter(key, value),
      (key) => owner.readSessionOverride(key),
      (key, value) => owner.writeSessionOverride(key, value),
      (key) => owner.clearSessionOverride(key),
      () => this.coordinator.assertSettingsAdmission(),
      () => this.assertProfileIdle(),
      (listener) => owner.subscribeModelChanges(listener),
    );
  }

  #constructToolFormat(): Agent['toolFormat'] {
    const owner = this.#settings.settingsOwner;
    const providers = this.#providers;
    return assembleToolFormatControl(
      () => owner.readToolFormat(),
      (format) => owner.writeToolFormat(format),
      () => {
        const provider = providers.getActiveProvider();
        return provider === undefined
          ? undefined
          : {
              name: provider.name,
              toolFormat: provider.getToolFormat?.() ?? null,
            };
      },
      () => this.coordinator.assertSettingsAdmission(),
      () => this.assertProfileIdle(),
    );
  }

  #constructProfiles(): ProfilesControl {
    const { settingsOwner, settingsService } = this.#settings;
    const { config, authState, workspace } = this.#context;
    const readString = (key: string): string | undefined => {
      const value = settingsOwner.readNamedParameter(key);
      return typeof value === 'string' && value.length > 0 ? value : undefined;
    };
    return new ProfilesControl(
      () => this.#providerState,
      assembleProfileApplication(
        settingsService,
        this.#providers,
        this.#oauth,
        (name, options) =>
          this.switchProvider(name, {
            ...options,
            clientReplacement: 'deferred',
          }),
        settingsOwner,
        workspace.profileDefinitions,
        async (result, signal) => {
          const modelParams = captureProfileModelParams(
            settingsService.getProviderSettings(result.providerName),
          );
          const replacement = await this.#prepareReplacement(
            result.providerChanged,
            signal,
          );
          return {
            publish: () => {
              replacement.publish();
              this.#providerState.provider = result.providerName;
              this.#providerState.model = result.modelName;
              this.#providerState.modelParams = modelParams;
              this.#providerState.baseUrl = result.baseUrl;
              this.#providerState.keyName = readString('auth-key-name');
              this.#providerState.isLoadBalancer =
                result.providerName === 'load-balancer';
              authState.keyFile = readString('auth-keyfile');
              authState.rawKeyPresent = readString('auth-key') !== undefined;
              authState.inlineKeyPresent = false;
              authState.baseUrl = result.baseUrl;
            },
            retire: () => replacement.retire(),
            discard: () => replacement.discard(),
          };
        },
        () => this.coordinator.assertIdle(),
      ),
      () => ({ ...settingsOwner.captureUserParameters() }),
      config.getTargetDir(),
    );
  }

  #constructProviderSwitch(): ProviderSwitcher {
    const { config, readRuntimeKind } = this.#context;
    const { settingsOwner, settingsService } = this.#settings;
    const providers = this.#providers;
    const oauth = this.#oauth;
    const session = this.#session;
    return assembleProviderSwitch(
      config,
      settingsService,
      providers,
      oauth,
      readRuntimeKind,
      () => session.refreshAuth(),
      settingsOwner,
    );
  }

  #prepareReplacement(changed: boolean, signal: AbortSignal) {
    const active = this.activeRun;
    const run =
      active !== undefined && this.#session.isCurrentExecution(active.loop)
        ? active
        : undefined;
    return this.#session.prepareProfileExecution(changed, signal, (retire) => {
      if (run !== undefined && this.activeRun === run) {
        run.retirements = [...run.retirements, retire];
        return Promise.resolve();
      }
      return retire();
    });
  }

  #buildAuthControl(): AuthControl {
    const { settingsOwner, settingsService } = this.#settings;
    const { authState, onOAuthPrompt } = this.#context;
    const oauth = this.#oauth;
    return new AuthControl(
      authState,
      () => this.#providerState.provider,
      (provider) => authStatusForWinner(this.#computeWinner(provider)),
      onOAuthPrompt,
      (baseUrl) =>
        applyFacadeAuthBaseUrl(
          baseUrl,
          this.#providerState,
          (key, value) => settingsOwner.writeUserParameter(key, value),
          settingsService,
          this.#providerState.provider,
        ),
      () => this.#providerState.keyName,
      (name) => {
        this.#providerState.keyName = name;
      },
      async (apiKey) => {
        this.coordinator.assertSettingsAdmission();
        return updateActiveProviderApiKey(
          apiKey,
          {
            setEphemeralSetting: (key, value) =>
              settingsOwner.writeUserParameter(key, value),
          },
          settingsService,
          this.#providers.getActiveProvider(),
        );
      },
      (provider) => oauth.isOAuthEnabled(provider),
      (provider) => oauth.isAuthenticated(provider),
      async (provider) => (await oauth.peekStoredToken(provider))?.expiry,
      (provider) => oauth.getHigherPriorityAuth(provider),
      (provider) => oauth.getAuthStatusWithBuckets(provider),
      this.#session.subscribeBucketConsent,
      this.#session.respondToBucketConsent,
    );
  }

  #computeWinner(provider: string): AuthWinner {
    return computeAuthWinner(
      this.#context.authState,
      this.#providerState.keyName,
      provider,
    );
  }

  #providerStatus(): ProviderStatus {
    return buildProfileProviderStatus(
      this.#providerState,
      this.#computeWinner(this.#providerState.provider),
      this.#context.authState.keyFile,
    );
  }

  /**
   * Switches the active provider (and optional model) mid-session, preserving
   * conversation context, then rebuilds the loop so the next run binds to the
   * current client. Returns the underlying switch result so the interactive UI
   * can replace direct `runtime.switchActiveProvider(name, opts)` calls.
   * @plan:PLAN-20260617-COREAPI.P16
   * @plan:PLAN-20270104-ISSUE2374.P04
   * @requirement:REQ-004
   * @requirement:REQ-005
   * @pseudocode switch-rebind.md steps 30-42
   */
  async #setProvider(
    provider: string,
    model?: string,
    options?: AgentProviderSwitchOptions,
  ): Promise<AgentProviderSwitchResult> {
    this.assertProfileIdle();
    if (this.activeRun !== undefined) throw new AgentBusyError();
    // A requested model runs the switch deferred inside one publication
    // window, so the target provider's default is never announced ahead of the
    // model the caller asked for; the model in force is announced on commit.
    return this.coordinator.withIdleBoundary(() =>
      publishProviderSwitch(
        this.#settings.settingsOwner,
        this.#providerState.model,
        model,
        () => this.#settings.settingsService.getCurrentProfileName(),
        (publication) =>
          applyFacadeProviderSwitch(
            provider,
            model,
            options,
            this.#providerState,
            this.switchProvider,
            this.#facadeSwitchOperations(),
            publication,
          ),
      ),
    );
  }

  /**
   * Changes the active model (provider unchanged), preserving context.
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-004
   * @requirement:REQ-005
   * @pseudocode switch-rebind.md steps 50-60
   */
  async #setModel(model: string): Promise<void> {
    this.assertProfileIdle();
    if (this.activeRun !== undefined) throw new AgentBusyError();
    if (!this.isProviderReady()) {
      throw new Error(UNCONFIGURED_AGENT_MESSAGE);
    }
    // The transition writes the selection before it can fail, so the window is
    // opened against the model actually applied; a retry of the same target
    // then still publishes.
    await this.coordinator.withIdleBoundary(() =>
      applyModelWithPublication(
        this.#settings.settingsOwner,
        this.#providerState,
        model,
        {
          setOwnerModel: (next) => this.#context.selectModel(next),
          refreshAuth: () => this.#session.refreshAuth(),
          restoreChatVisibility: () => this.#session.restoreChatVisibility(),
          rebuild: () => this.#rebuild(),
        },
      ),
    );
  }

  #facadeSwitchOperations(): FacadeSwitchOperations {
    return {
      selectModel: this.#context.selectModel,
      refreshAuth: () => this.#session.refreshAuth(),
      restoreVisibility: () => this.#session.restoreChatVisibility(),
      rebuild: () => this.#rebuild(),
      readAppliedModel: () => this.getModel(),
    };
  }
}
