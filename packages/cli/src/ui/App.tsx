/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { SettingScope } from '../config/settings.js';
import {
  createCredentialRegistration,
  createModelRegistration,
  createProfileRegistration,
  createQuotaRegistration,
} from './hooks/credentialCommandRegistration.js';
import type { CredentialCommandRegistration } from './hooks/credentialCommandRegistration.js';
import {
  createMcpOwnerCommand,
  createAuthOwnerCommand,
  createBaseurlRegistration,
  createLogoutRegistration,
  createKeyfileRegistration,
  createKeyRegistration,
  createToolkeyCommands,
} from './hooks/credentialRegistrars.js';

import { Component, useReducer } from 'react';
import type {
  IContent,
  RecordingIntegration,
  SessionRecordingService,
  LockHandle,
  MessageBus,
} from '@vybestack/llxprt-code-core';
import type { SlashCommandRuntime, UiRuntime } from './cliUiRuntime.js';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { LoadedSettings } from '../config/settings.js';
import type { OperationLifecycleRegistry } from './hooks/agentStream/operationLifecycle.js';
import type { MemoryTelemetryController } from './hooks/memoryTrend/memoryTelemetry.js';
import { KeypressProvider } from './contexts/KeypressContext.js';
import { MouseProvider } from './contexts/MouseContext.js';
import { SessionStatsProvider } from './contexts/SessionContext.js';
import { VimModeProvider } from './contexts/VimModeContext.js';
import { TodoProvider } from './contexts/TodoProvider.js';
import {
  RuntimeContextProvider,
  createRuntimeApi,
  type RuntimeContextProviderProps,
} from './contexts/RuntimeContext.js';
import { OverflowProvider } from './contexts/OverflowContext.js';
import {
  ProviderAliasRefreshProvider,
  type ProviderAliasRefresh,
} from './contexts/ProviderAliasRefreshContext.js';
import {
  OAuthControlProvider,
  type OAuthControl,
} from './contexts/OAuthControlContext.js';
import { AppDispatchProvider } from './contexts/AppDispatchContext.js';
import { ScrollProvider } from './contexts/ScrollProvider.js';
import { ShellCommandDisplayProvider } from './contexts/ShellCommandDisplayContext.js';
import { inkRenderOptions } from './inkRenderOptions.js';
import { isMouseEventsEnabled } from './mouseEventsEnabled.js';
import { appReducer, initialAppState } from './reducers/appReducer.js';
import { AppContainer } from './AppContainer.js';
import { projectRuntimeAgent } from './contexts/runtimeProfileAgent.js';

interface AppProps {
  uiRuntime: UiRuntime;
  slashCommandRuntime: SlashCommandRuntime;
  /**
   * The single interactive Agent created at the CLI composition root.
   */
  agent: Agent;
  runtimeOwner: { create: () => RuntimeContextProviderProps['owner'] };
  providerAliasRefresh: ProviderAliasRefresh;
  oauthControl: OAuthControl;
  settings: LoadedSettings;
  startupWarnings?: string[];
  resumedHistory?: IContent[];
  version: string;
  terminalBackgroundColor?: string;
  runtimeMessageBus?: MessageBus;
  /** @plan:PLAN-20260211-SESSIONRECORDING.P26 */
  recordingIntegration?: RecordingIntegration;
  recordingOwner?: 'agent' | 'raw';
  /** @plan:PLAN-20260214-SESSIONBROWSER.P23 */
  initialRecordingService?: SessionRecordingService;
  /** @plan:PLAN-20260214-SESSIONBROWSER.P23 */
  initialLockHandle?: LockHandle | null;
  suppressStartupWelcome?: boolean;
  /** P12: optional perf operation lifecycle registry (perf enabled only). */
  operationLifecycle?: OperationLifecycleRegistry;
  /** P12: optional memory telemetry controller (perf+memory enabled only). */
  memoryController?: MemoryTelemetryController;
}

/**
 * AppWrapper is the main entry point for the CLI UI.
 * It sets up the provider stack that wraps the AppContainer.
 *
 * Provider stack (outermost to innermost):
 * - KeypressProvider: Terminal keypress handling with Kitty/Vim support
 * - SessionStatsProvider: Session statistics tracking
 * - VimModeProvider: Vim mode state management
 * - TodoProvider: Todo list management
 * - RuntimeContextProvider: Runtime API access
 * - OverflowProvider: Overflow detection for UI
 * - AppDispatchProvider: App state dispatch
 * - AppContainer: Main UI container with UIState/UIActions contexts
 */
export class AppWrapper extends Component<AppProps> {
  #captured: AppProps | undefined;
  #ownerFactory: AppProps['runtimeOwner'] | undefined;
  #runtimeOwner: RuntimeContextProviderProps['owner'] | undefined;
  #runtimeAgent: ReturnType<typeof projectRuntimeAgent> | undefined;
  #registration: CredentialCommandRegistration | undefined;
  readonly #toolkeys = createToolkeyCommands();

  private capture() {
    const props = this.props;
    if (this.#captured?.agent !== props.agent)
      this.#runtimeAgent = projectRuntimeAgent(props.agent);
    if (this.#ownerFactory !== props.runtimeOwner) {
      this.#runtimeOwner = props.runtimeOwner.create();
      this.#ownerFactory = props.runtimeOwner;
    }
    if (this.#runtimeAgent === undefined || this.#runtimeOwner === undefined)
      throw new Error('Application runtime was not captured');
    const keys = [
      'agent',
      'slashCommandRuntime',
      'oauthControl',
      'settings',
      'providerAliasRefresh',
      'runtimeOwner',
    ] satisfies Array<keyof AppProps>;
    if (keys.some((key) => this.#captured?.[key] !== props[key])) {
      const api = createRuntimeApi(
        this.#runtimeAgent,
        this.#runtimeOwner,
        props.agent.sessionClient.fetch,
      );
      this.#registration = this.register(api);
      this.#captured = props;
    }
    if (this.#registration === undefined)
      throw new Error('Application commands were not registered');
    return {
      runtimeAgent: this.#runtimeAgent,
      runtimeOwner: this.#runtimeOwner,
      registerCredentials: this.#registration,
    };
  }

  private models(api: ReturnType<typeof createRuntimeApi>) {
    const { agent: a } = this.props;
    const b = <O, A extends unknown[], R>(
      owner: O,
      op: (this: O, ...args: A) => R,
    ): ((...args: A) => R) => op.bind(owner);
    return createModelRegistration(
      b(api, api.setActiveModel),
      b(api, api.getActiveToolFormatState),
      b(api, api.setActiveToolFormatOverride),
      b(api, api.getActiveProviderName),
      b(api, api.providerStatus),
      b(api, api.getActiveModelName),
      b(api, api.getActiveProviderAliasConfig),
      (name, options) => a.setProvider(name, undefined, options),
      this.props.providerAliasRefresh,
    );
  }
  private profiles(api: ReturnType<typeof createRuntimeApi>) {
    const { agent: a, oauthControl: oauth, settings } = this.props;
    const b = <O, A extends unknown[], R>(
      owner: O,
      op: (this: O, ...args: A) => R,
    ): ((...args: A) => R) => op.bind(owner);
    return createProfileRegistration(
      b(
        a.workspace.profileDefinitions,
        a.workspace.profileDefinitions.listProfiles,
      ),
      () => a.getProvider(),
      b(oauth, oauth.listBuckets),
      () => settings.merged.enableFuzzyFiltering ?? true,
      b(a, a.saveProfileSnapshot),
      b(api, api.listSavedProfiles),
      b(api, api.getEphemeralSettings),
      b(api, api.saveLoadBalancerProfile),
      b(a.profiles, a.profiles.load),
      async () => {
        await a.mcp.refresh();
      },
      b(a, a.getProvider),
      b(a, a.getModel),
      b(a, a.deleteProfileByName),
      async (name) => {
        a.setDefaultProfileName(name);
        settings.setValue(
          SettingScope.User,
          'defaultProfile',
          name ?? undefined,
        );
      },
    );
  }
  private quota(api: ReturnType<typeof createRuntimeApi>) {
    const oauth = this.props.oauthControl;
    const b = <O, A extends unknown[], R>(
      owner: O,
      op: (this: O, ...args: A) => R,
    ): ((...args: A) => R) => op.bind(owner);
    return createQuotaRegistration(
      b(api, api.getEphemeralSetting),
      b(api, api.getActiveProviderName),
      b(api, api.detectProviderQuota),
      api.fetch,
      b(oauth, oauth.isAvailable),
      b(oauth, oauth.getAllAnthropicUsageInfo),
      b(oauth, oauth.getAllCodexUsageInfo),
      b(oauth, oauth.getAllCodexRateLimitResetCredits),
      b(oauth, oauth.hasCodexToken),
      b(oauth, oauth.listBuckets),
      b(oauth, oauth.readCodexBucketToken),
    );
  }
  private mcp() {
    const { agent: a, settings } = this.props;
    const b = <O, A extends unknown[], R>(
      owner: O,
      op: (this: O, ...args: A) => R,
    ): ((...args: A) => R) => op.bind(owner);
    return (
      addItem: Parameters<CredentialCommandRegistration>[0],
      reload: () => void,
    ) =>
      createMcpOwnerCommand(
        b(a.mcp, a.mcp.listServers),
        b(a.mcp, a.mcp.listBlockedServers),
        b(a.mcp, a.mcp.discoveryState),
        b(a.mcp, a.mcp.details),
        b(a.mcp, a.mcp.authenticate),
        b(a.mcp, a.mcp.reload),
        b(a.mcp, a.mcp.refresh),
        true,
        settings,
        addItem,
        reload,
      );
  }
  private register(
    api: ReturnType<typeof createRuntimeApi>,
  ): CredentialCommandRegistration {
    const {
      agent: a,
      slashCommandRuntime: c,
      oauthControl: oauth,
      settings,
    } = this.props;
    const b = <O, A extends unknown[], R>(
      owner: O,
      op: (this: O, ...args: A) => R,
    ): ((...args: A) => R) => op.bind(owner);
    return createCredentialRegistration(
      this.models(api),
      this.profiles(api),
      createBaseurlRegistration(
        b(a, a.getProvider),
        b(a.auth, a.auth.setBaseUrl),
      ),
      createLogoutRegistration(
        b(a, a.listProviders),
        b(a.auth, a.auth.status),
        b(a.auth, a.auth.logout),
      ),
      createKeyfileRegistration(
        b(api, api.providerStatus),
        b(api, api.updateActiveProviderApiKey),
        b(api, api.setEphemeralSetting),
        b(settings, settings.setProviderKeyfile),
        b(settings, settings.removeProviderKeyfile),
      ),
      createKeyRegistration(
        b(c, c.getProviderKeys),
        b(c, c.listKeyCompletionNames),
        b(c, c.invalidateKeyCompletion),
        b(c, c.isInteractive),
        b(api, api.providerStatus),
        b(api, api.updateActiveProviderApiKey),
        b(c, c.setEphemeralSetting),
      ),
      createAuthOwnerCommand(oauth, settings),
      this.quota(api),
      this.mcp(),
      this.#toolkeys,
      b(a.session, a.session.recordRecordingEvent),
    );
  }

  override render() {
    const props = this.props;
    const { runtimeAgent, runtimeOwner, registerCredentials } = this.capture();
    const renderOptions = inkRenderOptions(props.uiRuntime.app, props.settings);
    const mouseEventsEnabled = isMouseEventsEnabled(
      renderOptions,
      props.settings,
    );

    return (
      <KeypressProvider>
        <MouseProvider mouseEventsEnabled={mouseEventsEnabled}>
          <ScrollProvider>
            <SessionStatsProvider metrics={props.agent.metrics}>
              <VimModeProvider settings={props.settings}>
                <ShellCommandDisplayProvider
                  alwaysDisplayFullShellCommand={
                    props.settings.merged.ui.alwaysDisplayFullShellCommand ??
                    true
                  }
                >
                  <TodoProvider
                    sessionId={props.uiRuntime.session.getSessionId()}
                  >
                    <RuntimeContextProvider
                      requestFetch={props.agent.sessionClient.fetch}
                      agent={runtimeAgent}
                      owner={runtimeOwner}
                    >
                      <OAuthControlProvider control={props.oauthControl}>
                        <ProviderAliasRefreshProvider
                          refresh={props.providerAliasRefresh}
                        >
                          <OverflowProvider>
                            <AppWithState
                              {...props}
                              registerCredentials={registerCredentials}
                            />
                          </OverflowProvider>
                        </ProviderAliasRefreshProvider>
                      </OAuthControlProvider>
                    </RuntimeContextProvider>
                  </TodoProvider>
                </ShellCommandDisplayProvider>
              </VimModeProvider>
            </SessionStatsProvider>
          </ScrollProvider>
        </MouseProvider>
      </KeypressProvider>
    );
  }
}

/**
 * AppWithState manages the app reducer state and wraps AppContainer.
 */
const AppWithState = (
  props: AppProps & { registerCredentials: CredentialCommandRegistration },
) => {
  const [appState, appDispatch] = useReducer(appReducer, initialAppState);

  return (
    <AppDispatchProvider value={appDispatch}>
      <AppContainer {...props} appState={appState} appDispatch={appDispatch} />
    </AppDispatchProvider>
  );
};

// Re-export for backwards compatibility
export { AppContainer } from './AppContainer.js';
