import type { WorkspaceControl } from './control/workspaceControl.js';
import type { ProviderMessage } from '@vybestack/llxprt-code-providers';
import { getOpenAIProviderInfo } from '@vybestack/llxprt-code-providers';
import { refreshAliasProviders } from '@vybestack/llxprt-code-providers/composition.js';
import { createProviderInspection } from './control/provider-inspection.js';
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

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import {
  computeUnallowedParameters,
  loadProviderAliasEntries,
} from '@vybestack/llxprt-code-providers/composition.js';
import { extractModelParams } from '@vybestack/llxprt-code-providers/model-parameter-data.js';

export const NO_ACTIVE_PROVIDER_ERROR_MESSAGE =
  'No active provider is configured.';

export interface SessionProviderStatus {
  providerName: string | null;
  modelName: string | null;
  displayLabel: string;
  isPaidMode?: boolean;
  baseURL?: string;
}

import type { Config, ProviderSwitcher } from '@vybestack/llxprt-code-core';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { RuntimeKind } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { SessionClientOwner } from '../session/session-client-owner.js';
import type {
  Agent,
  AgentProviderSwitchOptions,
  AgentProviderSwitchResult,
  ProviderStatus,
} from './agent.js';
import { type OwnershipRecord } from './agentBootstrap.js';
import { AgentExecutionCoordinator } from './agentExecutionCoordinator.js';
import type { AgentAuth } from './config-types.js';
import { AuthControl, isOAuthPromptHandler } from './control/authControl.js';
import {
  authStatusForWinner,
  computeAuthWinner,
  type AgentAuthState,
  type AgentProviderState,
  type AuthWinner,
} from './control/authState.js';
import { ProfilesControl } from './control/profilesControl.js';
import { assembleSettingsControl } from './control/settings-control.js';
import { assembleToolFormatControl } from './control/tool-format-control.js';
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
  updateActiveProviderApiKey,
} from './providerMutations.js';
import { applyFacadeProviderSwitch } from './providerSwitchOptionsAdapter.js';
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

const UNCONFIGURED_AGENT_MESSAGE =
  'No provider is configured. Run /setup to choose a hosted provider, configure a local model, set up a custom compatible endpoint, or select an existing profile before using the agent.';

function requireProviderOwner<T>(owner: T | undefined): void {
  if (owner === undefined)
    throw new Error('Provider reads require an explicit session owner');
}

export abstract class SessionProviderOwner {
  protected workspace!: WorkspaceControl;
  protected switchProvider!: ProviderSwitcher;
  protected createProviderReads(): SessionProviderReads {
    const readInspection = () => this.inspection;
    return {
      get inspection() {
        return readInspection();
      },
      refreshAliases: this.refreshAliases.bind(this),
      readOpenAIInfo: this.readOpenAIInfo.bind(this),
      readActiveProviderName: this.readActiveProviderName.bind(this),
      getActiveProviderName: this.readProviderName.bind(this),
      getActiveModelName: this.getActiveModelName.bind(this),
      getActiveModelParams: this.getActiveModelParams.bind(this),
      listProviders: this.readProviderNames.bind(this),
      listAvailableModels: this.readAvailableModels.bind(this),
      getActiveProviderMetrics: this.getActiveProviderMetrics.bind(this),
      getSessionTokenUsage: this.getSessionTokenUsage.bind(this),
      getUnallowedParametersForActiveModel:
        this.getUnallowedParametersForActiveModel.bind(this),
      providerStatus: this.providerStatus.bind(this),
    };
  }
  protected providerReads!: SessionProviderReads;
  protected readConfiguredModel: () => string = () => this.providerState.model;
  protected readProviderSettings: (
    provider: string,
  ) => Record<string, unknown> = (provider) =>
    this.facadeSettingsService.getProviderSettings(provider);
  protected initializeProviderReads(): void {
    requireProviderOwner(this.facadeSettingsOwner);
    requireProviderOwner(this.facadeProviderManager);
    requireProviderOwner(this.readConfiguredModel);
    requireProviderOwner(this.readProviderSettings);
    this.providerReads = this.createProviderReads();
  }
  protected abstract rebuild(): void;

  protected facadeSettingsOwner!: SessionSettingsOwner;

  protected facadeSessionOwner!: SessionClientOwner;

  protected facadeAuthState!: AgentAuthState;

  protected config!: Config;

  protected facadeProviderManager!: RuntimeProviderManager;

  protected facadeOAuth!: OAuthManager;

  protected facadeSettingsService!: SettingsService;

  protected facadeRuntimeState!: AgentRuntimeState;

  protected facadeOwnership!: OwnershipRecord;

  protected onOAuthPrompt!: unknown | undefined;

  protected initialAuth!: AgentAuth | undefined;

  protected selectOwnerModel!: (model: string) => Promise<void>;

  protected readonly coordinator = new AgentExecutionCoordinator();

  readonly execution: Agent['execution'] = this.coordinator;

  protected get activeRun(): ActiveRun | undefined {
    return this.coordinator.current();
  }

  /** @plan:PLAN-20260622-COREAPIGAP.P08 @requirement:REQ-003 */

  /** @pseudocode createAgent.md steps 150-160 */

  /**
   * Per-agent mutable provider/model/param state. Initialized from the
   * (readonly) AgentRuntimeState; updated by setProvider/setModel/setModelParam
   * and profiles.apply. Read by getProvider/getModel/getModelParams/
   * getProviderStatus so they reflect per-agent switches (the global runtime
   * accessors return 'fake' under the LLXPRT_FAKE_RESPONSES seam).
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-004
   */

  /**
   * Per-agent mutable auth state (parallel to providerState). Carries every
   * auth-related field the public auth/keys controls mutate and that
   * computeAuthStatus/getProviderStatus read, EXCEPT the keyName reference
   * (which lives on providerState.keyName as the single source of truth). The
   * secret value lives ONLY in authState.keyStore and is NEVER surfaced.
   * @plan:PLAN-20260617-COREAPI.P18
   * @requirement:REQ-008
   */

  /** Mutable editor-callbacks holder shared with ToolControl + forwarding object. */

  /** Mutable display-callbacks holder shared with ToolControl + stable forwarding object. */

  readonly modelParameters = assembleModelParameterControl(
    (provider, key, value) =>
      this.facadeSettingsService.setProviderSetting(provider, key, value),
    () => this.facadeProviderManager.getActiveProviderName(),
    () => this.providerState.modelParams,
    () => this.coordinator.assertNoCommit(),
  );

  readonly settings: Agent['settings'] = assembleSettingsControl(
    (key) => this.facadeSettingsOwner.readNamedParameter(key),
    () => this.facadeSettingsOwner.captureNamedParameters(),
    (key, value) => this.facadeSettingsOwner.writeUserParameter(key, value),
    (key) => this.facadeSettingsOwner.readSessionOverride(key),
    (key, value) => this.facadeSettingsOwner.writeSessionOverride(key, value),
    (key) => this.facadeSettingsOwner.clearSessionOverride(key),
    () => this.coordinator.assertSettingsAdmission(),
    () => this.assertProfileIdle(),
    (listener) => this.facadeSettingsOwner.subscribeModelChanges(listener),
  );

  readonly toolFormat: Agent['toolFormat'] = assembleToolFormatControl(
    () => this.facadeSettingsOwner.readToolFormat(),
    (format) => this.facadeSettingsOwner.writeToolFormat(format),
    () => {
      const provider = this.facadeProviderManager.getActiveProvider();
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

  readonly hasActiveProvider: Agent['hasActiveProvider'] = () =>
    this.facadeProviderManager.hasActiveProvider();

  readonly getProviderContextLimit: Agent['getProviderContextLimit'] = () =>
    this.facadeProviderManager.getActiveProvider()?.getContextLimit?.();

  protected providerState!: AgentProviderState;

  protected profiles!: ProfilesControl;

  protected constructProfiles(): ProfilesControl {
    const readString = (key: string): string | undefined => {
      const value = this.facadeSettingsOwner.readNamedParameter(key);
      return typeof value === 'string' && value.length > 0 ? value : undefined;
    };
    return new ProfilesControl(
      () => this.providerState,
      assembleProfileApplication(
        this.facadeSettingsService,
        this.facadeProviderManager,
        this.facadeOAuth,
        (name, options) =>
          this.switchProvider(name, {
            ...options,
            clientReplacement: 'deferred',
          }),
        this.facadeSettingsOwner,
        this.workspace.profileDefinitions,
        async (result, signal) => {
          const modelParams = captureProfileModelParams(
            this.facadeSettingsService.getProviderSettings(result.providerName),
          );
          const replacement = await this.prepareReplacement(
            result.providerChanged,
            signal,
          );
          return {
            publish: () => {
              replacement.publish();
              this.providerState.provider = result.providerName;
              this.providerState.model = result.modelName;
              this.providerState.modelParams = modelParams;
              this.providerState.baseUrl = result.baseUrl;
              this.providerState.keyName = readString('auth-key-name');
              this.providerState.isLoadBalancer =
                result.providerName === 'load-balancer';
              this.facadeAuthState.keyFile = readString('auth-keyfile');
              this.facadeAuthState.rawKeyPresent =
                readString('auth-key') !== undefined;
              this.facadeAuthState.inlineKeyPresent = false;
              this.facadeAuthState.baseUrl = result.baseUrl;
            },
            retire: () => replacement.retire(),
            discard: () => replacement.discard(),
          };
        },
        () => this.coordinator.assertIdle(),
      ),
      () => ({ ...this.facadeSettingsOwner.captureUserParameters() }),
      this.config.getTargetDir(),
    );
  }

  protected constructProviderSwitch(
    readRuntimeKind: () => RuntimeKind,
  ): ProviderSwitcher {
    return async (name, options) => {
      const { assembleProviderSwitch } = await import(
        './providerSwitchAssembly.js'
      );
      return assembleProviderSwitch(
        this.config,
        this.facadeSettingsService,
        this.facadeProviderManager,
        this.facadeOAuth,
        readRuntimeKind,
        () => this.facadeSessionOwner.refreshAuth(),
        this.facadeSettingsOwner,
      )(name, options);
    };
  }

  protected readonly prepareReplacement = (
    changed: boolean,
    signal: AbortSignal,
  ) => {
    const active = this.activeRun;
    const run =
      active !== undefined &&
      this.facadeSessionOwner.isCurrentExecution(active.loop)
        ? active
        : undefined;
    return this.facadeSessionOwner.prepareProfileExecution(
      changed,
      signal,
      (retire) => {
        if (run !== undefined && this.activeRun === run) {
          run.retirements = [...run.retirements, retire];
          return Promise.resolve();
        }
        return retire();
      },
    );
  };

  /**
   * Seeds the per-agent auth state from the threaded initial auth config.
   * inlineKeyPresent from auth.apiKey, keyFile from auth.apiKeyFile, baseUrl
   * from auth.baseUrl, oauthEnabled add(provider) if auth.oauth, keyName seed
   * onto providerState.keyName from auth.keyName. The secret value is NEVER
   * stored on authState or providerState.
   * @plan:PLAN-20260617-COREAPI.P18
   * @requirement:REQ-008
   */

  /**
   * Builds the AuthControl wired with the per-agent auth-state deps bundle.
   * @plan:PLAN-20260617-COREAPI.P18
   * @requirement:REQ-008
   */
  protected buildAuthControl(): AuthControl {
    const settingsService = this.facadeSettingsService;
    const onOAuthPromptHandler = isOAuthPromptHandler(this.onOAuthPrompt)
      ? this.onOAuthPrompt
      : undefined;
    return new AuthControl(
      this.facadeAuthState,
      () => this.providerState.provider,
      (provider) => authStatusForWinner(this.computeWinner(provider)),
      onOAuthPromptHandler,
      (baseUrl) =>
        applyFacadeAuthBaseUrl(
          baseUrl,
          this.providerState,
          (key, value) =>
            this.facadeSettingsOwner.writeUserParameter(key, value),
          this.facadeSettingsService,
          this.providerState.provider,
        ),
      () => this.providerState.keyName,
      (name) => {
        this.providerState.keyName = name;
      },
      async (apiKey) => {
        this.coordinator.assertSettingsAdmission();
        return updateActiveProviderApiKey(
          apiKey,
          {
            setEphemeralSetting: (key, value) =>
              this.facadeSettingsOwner.writeUserParameter(key, value),
          },
          settingsService,
          this.facadeProviderManager.getActiveProvider(),
        );
      },
      (provider) => this.facadeOAuth.isOAuthEnabled(provider),
      (provider) => this.facadeOAuth.isAuthenticated(provider),
      async (provider) =>
        (await this.facadeOAuth.peekStoredToken(provider))?.expiry,
      (provider) => this.facadeOAuth.getHigherPriorityAuth(provider),
      (provider) => this.facadeOAuth.getAuthStatusWithBuckets(provider),
      this.facadeSessionOwner.subscribeBucketConsent,
      this.facadeSessionOwner.respondToBucketConsent,
    );
  }

  /**
   * Returns the configured provider per-agent (NOT the global runtime accessor,
   * which returns 'fake' under the LLXPRT_FAKE_RESPONSES seam).
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-004
   */
  readonly getProvider = (): string => this.providerState.provider;

  /**
   * Switches the active provider (and optional model) mid-session, preserving
   * conversation context. Wraps switchActiveProvider (rebuilds the content
   * generator internally) and, when a model is supplied, setActiveModel +
   * config.initializeContentGeneratorConfig (model-only rebuild). Then
   * rebuildLoop() so the next AgenticLoop.run binds to the CURRENT client.
   *
   * Returns the underlying switch result (changed / previousProvider /
   * nextProvider / defaultModel / infoMessages) so the interactive UI (Part B)
   * can replace direct `runtime.switchActiveProvider(name, opts)` calls. The
   * richer return is non-breaking for existing callers that await the promise
   * without reading the value.
   * @plan:PLAN-20260617-COREAPI.P16
   * @plan:PLAN-20270104-ISSUE2374.P04
   * @requirement:REQ-004
   * @requirement:REQ-005
   * @pseudocode switch-rebind.md steps 30-42
   */
  async setProvider(
    provider: string,
    model?: string,
    options?: AgentProviderSwitchOptions,
  ): Promise<AgentProviderSwitchResult> {
    this.assertProfileIdle();
    if (this.activeRun !== undefined) throw new AgentBusyError();
    return this.applyProviderSwitch(provider, model, options);
  }

  /**
   * Returns the per-agent provider status. Surfaces keyName ONLY when the
   * winner is 'keyName', and keyFile ONLY when the winner is 'keyfile' (REQ-008
   * precedence). baseUrl is surfaced when set (existing behavior).
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-004
   * @requirement:REQ-008
   */
  readonly getProviderStatus = (): ProviderStatus =>
    buildProfileProviderStatus(
      this.providerState,
      this.computeWinner(this.providerState.provider),
      this.facadeAuthState.keyFile,
    );

  /**
   * Returns the configured model per-agent (NOT the global runtime accessor).
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-004
   */
  readonly getModel = (): string => this.providerReads.getActiveModelName();

  /**
   * Changes the active model (provider unchanged), preserving context.
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-004
   * @requirement:REQ-005
   * @pseudocode switch-rebind.md steps 50-60
   */
  async setModel(model: string): Promise<void> {
    this.assertProfileIdle();
    if (this.activeRun !== undefined) throw new AgentBusyError();
    if (!this.isProviderReady()) {
      throw new Error(UNCONFIGURED_AGENT_MESSAGE);
    }
    await this.selectOwnerModel(model);
    await this.facadeSessionOwner.refreshAuth();
    await this.restoreChatVisibility();
    this.rebuild();
    this.providerState.model = model;
  }

  /**
   * Returns a readonly shallow snapshot of the per-agent model params.
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-004
   * @pseudocode switch-rebind.md steps 110-112
   */
  readonly getModelParams = (): Readonly<Record<string, unknown>> =>
    snapshotModelParams(this.providerState.modelParams);

  /**
   * Per-agent HistoryService accessor (per-access; never cached). Falls back to
   * the eagerly-stored initialHistoryService when the client's chat has not been
   * initialized (startChat runs lazily on the first turn), so the REQ-005
   * identity probe returns a non-null instance BEFORE the first turn. Because
   * transferHistoryToNewClient reuses the SAME stored instance across a
   * switch, the before/after identity matches.
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-005
   */

  // ─── P16 switch/context-preservation helpers ─────────────────────────────

  /**
   * Core provider(+optional model) switch used by both setProvider and
   * profiles.apply. switchActiveProvider rebuilds the content generator
   * internally (try/catch for the fake seam where the named provider is not
   * registered). When a model is supplied, setActiveModel + the explicit
   * model-only rebuild. Then rebuildLoop(). Updates the per-agent state holder.
   *
   * Returns the underlying ProviderSwitchResult so setProvider can surface
   * changed/previousProvider/nextProvider/defaultModel/infoMessages to the
   * interactive UI. Under the fake-seam suppressed branch (provider not
   * registered), synthesizes a `{changed:false}` result.
   * @plan:PLAN-20260617-COREAPI.P16
   * @plan:PLAN-20270104-ISSUE2374.P04
   * @requirement:REQ-004
   * @requirement:REQ-005
   * @pseudocode switch-rebind.md steps 30-42
   */
  protected applyProviderSwitch(
    provider: string,
    model?: string,
    options?: AgentProviderSwitchOptions,
  ): Promise<AgentProviderSwitchResult> {
    return applyFacadeProviderSwitch(
      provider,
      model,
      options,
      this.providerState,
      this.switchProvider,
      this.selectOwnerModel,
      () => this.facadeSessionOwner.refreshAuth(),
      this.restoreChatVisibility,
      () => this.rebuild(),
    );
  }

  /**
   * After a client-rebinding mutation, the new client's chat is not yet
   * initialized. The prior conversation is carried onto the new client by
   * transferHistoryToNewClient (as history content) and surfaced by the new
   * client's getHistory() before its chat exists. Seeding startChat() with that
   * carried-over history makes the chat visible WITHOUT dropping prior context,
   * preserving the conversation across the rebind for REQ-005.
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-005
   */
  protected readonly restoreChatVisibility = (): Promise<void> =>
    this.facadeSessionOwner.restoreChatVisibility();

  /**
   * Applies a profile's modelParams onto the live agent via the lazy runtime
   * mutators and updates the per-agent map (used by profiles.apply).
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-009
   * @pseudocode switch-rebind.md steps 90-94
   */
  protected assertProfileIdle(): void {
    this.coordinator.assertNoCommit();
    if (this.profiles.isApplying()) throw new AgentBusyError();
  }

  protected isProviderReady(): boolean {
    if (this.facadeOwnership.disposed) throw new Error('Agent is closed');
    return this.facadeProviderManager.hasActiveProvider();
  }

  /** Computes the auth status for an explicit provider. @plan:PLAN-20260617-COREAPI.P18 @requirement:REQ-008 */

  /** Computes the REQ-008 precedence winner. @plan:PLAN-20260617-COREAPI.P18 @requirement:REQ-008 */
  protected computeWinner(provider: string): AuthWinner {
    return computeAuthWinner(
      this.facadeAuthState,
      this.providerState.keyName,
      provider,
    );
  }
  get inspection(): ReturnType<typeof createProviderInspection> {
    return createProviderInspection(
      () => this.facadeSettingsOwner.readSelectedEndpoint(),
      this.facadeProviderManager,
    );
  }
  readonly refreshAliases = async (): Promise<void> => {
    refreshAliasProviders(this.facadeProviderManager);
  };

  private previousOpenAIProvider: OpenAIProviderInfo['provider'] = null;
  private openAIIdentity: object | null = null;

  readOpenAIInfo(): AgentOpenAIProviderInfo {
    const info = getOpenAIProviderInfo(
      {
        settingsService: {
          get: (key: string) =>
            this.facadeSettingsOwner.readNamedParameter(key),
          getProviderSettings: this.readProviderSettings,
        },
        config: {
          getProvider: () => this.facadeSettingsOwner.readSelectedProvider(),
          getModel: this.readConfiguredModel,
        },
      },
      {
        hasActiveProvider: () => this.facadeProviderManager.hasActiveProvider(),
        getActiveProviderName: () =>
          this.facadeProviderManager.getActiveProviderName(),
        getActiveProvider: () => this.facadeProviderManager.getActiveProvider(),
      },
    );
    if (info.provider !== this.previousOpenAIProvider) {
      this.previousOpenAIProvider = info.provider;
      this.openAIIdentity = info.provider === null ? null : Object.freeze({});
    }
    const cache = info.conversationCache;
    return {
      providerIdentity: this.openAIIdentity,
      currentModel: info.currentModel,
      isResponsesAPI: info.isResponsesAPI,
      remoteTokenInfo: info.remoteTokenInfo,
      getCachedConversation: (conversationId, parentId) =>
        cache?.get(conversationId, parentId) ?? null,
    };
  }

  readActiveProviderName(): string | null {
    return (
      this.facadeSettingsOwner.readSelectedProvider() ??
      this.facadeProviderManager.getActiveProviderName() ??
      null
    );
  }

  protected readProviderName(): string {
    const name = this.readActiveProviderName();
    if (name === null) throw new Error(NO_ACTIVE_PROVIDER_ERROR_MESSAGE);
    return name;
  }

  getActiveModelName(): string {
    const selected = this.facadeSettingsOwner.readSelectedModel();
    if (selected !== undefined && selected.trim() !== '') return selected;
    const configured = this.readConfiguredModel();
    if (configured.trim() !== '') return configured;
    return (
      this.facadeProviderManager.getActiveProvider()?.getDefaultModel?.() ?? ''
    );
  }

  getActiveModelParams(): Record<string, unknown> {
    const provider = this.readActiveProviderName();
    return provider === null
      ? {}
      : extractModelParams(this.readProviderSettings(provider));
  }

  readProviderNames(): string[] {
    return this.facadeProviderManager.listProviders();
  }

  readAvailableModels(
    provider?: string,
  ): ReturnType<RuntimeProviderManager['getAvailableModels']> {
    return this.facadeProviderManager.getAvailableModels(provider);
  }

  getActiveProviderMetrics(): ReturnType<
    RuntimeProviderManager['getProviderMetrics']
  > {
    return this.facadeProviderManager.getProviderMetrics();
  }

  getSessionTokenUsage(): ReturnType<
    RuntimeProviderManager['getSessionTokenUsage']
  > {
    return this.facadeProviderManager.getSessionTokenUsage();
  }

  getUnallowedParametersForActiveModel(): string[] {
    const providerName = this.readActiveProviderName();
    const modelName = this.getActiveModelName();
    if (!providerName || !modelName) return [];
    const alias = loadProviderAliasEntries().find(
      (entry) => entry.alias === providerName,
    )?.config;
    return alias?.modelDefaults
      ? [...computeUnallowedParameters(modelName, alias.modelDefaults)]
      : [];
  }

  providerStatus(): SessionProviderStatus {
    const providerName = this.readActiveProviderName();
    const modelName = this.getActiveModelName() || null;
    const provider =
      providerName === null
        ? this.facadeProviderManager.getActiveProvider()
        : this.facadeProviderManager.getProviderByName(providerName);
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
}
