/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  CredentialAuthority,
  OAuthManager,
} from '@vybestack/llxprt-code-providers/auth.js';
import { cliSkillOperations } from './config/configBuilder.js';
import { createGitHubBrokerClient } from './config/githubBrokerClient.js';
import type { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  type SessionSettingsOwner,
  type RuntimePolicyOwner,
  type Config,
  type MessageBus,
  PLACEHOLDER_MODEL,
} from '@vybestack/llxprt-code-core';
import {
  MCPOAuthTokenStorage,
  KeychainTokenStorage,
} from '@vybestack/llxprt-code-mcp';
import { defaultBrowserLauncher } from '@vybestack/llxprt-code-mcp/host/hostServices.js';
import {
  McpRuntimeOwner,
  fromConfig,
  type Agent,
  type ProviderActivationIntent,
} from '@vybestack/llxprt-code-agents';
import { createSessionMetrics } from '@vybestack/llxprt-code-telemetry';
import type { LoadedSettings } from './config/settings.js';
import type { BootstrapProfileArgs } from './config/profileBootstrap.js';
import {
  createNonInteractiveRun,
  createHeadlessTurn,
  createHeadlessInput,
  createHeadlessCommandRun,
  createHeadlessCommandLoader,
  resolveHeadlessSlash,
  createHeadlessFeedback,
  createHeadlessErrorReporter,
} from './nonInteractiveBindings.js';
import {
  getActiveProviderNameForApiError,
  getErrorFallbackModel,
} from './utils/apiErrorFormatting.js';
import {
  resolveContentPrefixIdentity,
  createCliModelIdentityRuntime,
} from './ui/utils/modelIdentity.js';
import {
  isProviderConfigured,
  reportUnconfiguredProviderError,
} from './unconfiguredProviderGuard.js';

export interface NonInteractiveAcquisitionInputs {
  readonly credentialAuthority?: CredentialAuthority;
  readonly oauthManager?: OAuthManager;
  readonly providerFileLifecycle?: ProviderFileLifecycle;
  runtimeSettings?: {
    readonly owner: SessionSettingsOwner;
    readonly store: SettingsService;
  };
  config: Config;
  settings: LoadedSettings;
  runtimeMessageBus?: MessageBus;
  policyOwner?: RuntimePolicyOwner;
  providerManager?: Agent['providerManager'];
}
function requireRuntimeSettings(
  settings: NonInteractiveAcquisitionInputs['runtimeSettings'],
): NonNullable<NonInteractiveAcquisitionInputs['runtimeSettings']> {
  if (settings === undefined)
    throw new Error(
      'Noninteractive settings commands require the explicit session owner and store',
    );
  return settings;
}
type ConfigWithBootstrapArgs = Config & {
  readonly _bootstrapArgs?: BootstrapProfileArgs;
  readonly _profileModelParams?: Record<string, unknown>;
  readonly _cliModelParams?: Record<string, unknown>;
};

function readBootstrapArgs(
  config: ConfigWithBootstrapArgs,
): BootstrapProfileArgs | undefined {
  return config._bootstrapArgs;
}

function buildActivationCliOverrides(
  bootstrapArgs: BootstrapProfileArgs | undefined,
): ProviderActivationIntent['cliOverrides'] | undefined {
  if (bootstrapArgs === undefined) {
    return undefined;
  }
  const overrides = {
    ...(bootstrapArgs.keyOverride !== null
      ? { key: bootstrapArgs.keyOverride }
      : {}),
    ...(bootstrapArgs.keyfileOverride !== null
      ? { keyfile: bootstrapArgs.keyfileOverride }
      : {}),
    ...(bootstrapArgs.keyNameOverride !== null
      ? { keyName: bootstrapArgs.keyNameOverride }
      : {}),
    ...(bootstrapArgs.baseurlOverride !== null
      ? { baseUrl: bootstrapArgs.baseurlOverride }
      : {}),
    ...(bootstrapArgs.setOverrides !== null
      ? { set: bootstrapArgs.setOverrides }
      : {}),
  };
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

function collectActivationModelParams(
  profileParams: Record<string, unknown> | undefined,
  cliParams: Record<string, unknown> | undefined,
): ProviderActivationIntent['modelParams'] | undefined {
  const mergedModelParams: Record<string, unknown> = {};

  // Profile model params apply regardless of provider source. A CLI provider
  // override suppresses the profile's provider/model selection, not its model
  // params (see profileResolution.ts contract).
  if (profileParams) {
    Object.assign(mergedModelParams, profileParams);
  }
  if (cliParams) {
    Object.assign(mergedModelParams, cliParams);
  }

  return Object.keys(mergedModelParams).length > 0
    ? mergedModelParams
    : undefined;
}

function buildNonInteractiveActivationIntent(
  useExternalAuth: boolean,
  bootstrapArgs: BootstrapProfileArgs | undefined,
  modelParams: ProviderActivationIntent['modelParams'],
  configModel: string,
  selectedProvider: string | undefined,
  readDefaultProvider: () => string | undefined,
): ProviderActivationIntent {
  const cliOverrides = buildActivationCliOverrides(bootstrapArgs);
  const resolvedModel =
    bootstrapArgs?.modelOverride ??
    (configModel !== PLACEHOLDER_MODEL ? configModel : undefined);
  const configProvider =
    selectedProvider ?? bootstrapArgs?.providerOverride ?? undefined;
  const activeProvider =
    configProvider === undefined ? readDefaultProvider() : undefined;
  return {
    ...(configProvider !== undefined ? { provider: configProvider } : {}),
    ...(activeProvider !== undefined
      ? { defaultProvider: activeProvider }
      : {}),
    authMode: useExternalAuth ? 'none' : 'auto',
    ...(typeof resolvedModel === 'string' && resolvedModel.trim().length > 0
      ? { model: resolvedModel.trim() }
      : {}),
    ...(modelParams !== undefined ? { modelParams } : {}),
    ...(cliOverrides !== undefined ? { cliOverrides } : {}),
  };
}

export function acquireNonInteractiveRun(
  inputs: NonInteractiveAcquisitionInputs,
) {
  const host = new LocalNonInteractiveHost(inputs);
  return host.run.bind(host);
}
class LocalNonInteractiveHost {
  constructor(private readonly inputs: NonInteractiveAcquisitionInputs) {}
  private async acquireAgent(): Promise<Agent> {
    const config: ConfigWithBootstrapArgs = this.inputs.config;
    const broker = createGitHubBrokerClient(this.inputs.credentialAuthority);
    return fromConfig({
      credentialAuthority: this.inputs.credentialAuthority,
      githubBrokerClient: broker,
      disposeGitHubBroker: async () => broker.dispose(),
      oauthManager: this.inputs.oauthManager,
      providerFileLifecycle: this.inputs.providerFileLifecycle,
      settingsService: requireRuntimeSettings(this.inputs.runtimeSettings)
        .store,
      settingsOwner: requireRuntimeSettings(this.inputs.runtimeSettings).owner,
      providerManager: this.inputs.providerManager,
      config,
      mcpRuntime: await McpRuntimeOwner.create(
        {
          tokenStorage: new MCPOAuthTokenStorage(
            new KeychainTokenStorage('llxprt-cli-mcp-oauth'),
          ),
          openBrowser: defaultBrowserLauncher,
        },
        config,
        this.inputs.runtimeMessageBus,
        undefined,
        undefined,
        undefined,
        this.inputs.policyOwner,
        'runtime',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        cliSkillOperations(config),
      ),
      mcpOwnership: 'agent',
      messageBus: this.inputs.runtimeMessageBus,
      sessionId: config.getSessionId(),
      sessionIdentityOwnership: 'config',
      activation: buildNonInteractiveActivationIntent(
        this.inputs.settings.merged.useExternalAuth === true,
        readBootstrapArgs(config),
        collectActivationModelParams(
          config._profileModelParams,
          config._cliModelParams,
        ),
        config.getModel(),
        config.getProvider(),
        () => config.getProvider(),
      ),
    });
  }
  private async acquireTurn() {
    const config = this.inputs.config;
    const acquired = await this.acquireAgent();
    return createHeadlessTurn(
      createHeadlessInput(
        () => config.getFileFilteringOptions(),
        () => config.getEnableRecursiveFileSearch(),
        (...args) => acquired.workspace.shouldIgnoreFile(...args),
        (...args) => acquired.workspace.shouldGitIgnoreFile(...args),
        (...args) => acquired.workspace.shouldLlxprtIgnoreFile(...args),
        (...args) => acquired.workspace.filterFiles(...args),
        (...args) => acquired.workspace.filterFilesWithReport(...args),
        (...args) => acquired.workspace.getGlobExcludes(...args),
        (...args) => acquired.workspace.getReadManyFilesExcludes(...args),
        () => acquired.workspace.getDirectories(),
        (path) => acquired.workspace.containsPath(path),
        (name) => acquired.tools.get(name),
        (server, uri) => acquired.mcp.readResource(server, uri),
        (identifier) => acquired.mcp.findResource(identifier),
      ),
      (query, options) => acquired.stream(query, options),
      () => config.getMaxSessionTurns(),
      () => config.getQuiet(),
      () => config.getSessionId(),
      () =>
        acquired.getEphemeralSetting('reasoning.includeInResponse') !== false,
      () =>
        resolveContentPrefixIdentity(
          createCliModelIdentityRuntime({
            getProvider: () => acquired.getProvider(),
            getModel: () => acquired.getModel(),
            getCurrentSequenceModel: () => acquired.getCurrentSequenceModel(),
            getActiveProfileName: () => acquired.getActiveProfileName(),
          }),
        ),
      () => acquired.metrics.getMetrics(),
      () => acquired.dispose(),
    );
  }
  async run(
    input: string,
    promptId: string,
    deferTelemetry = false,
  ): Promise<void> {
    const config = this.inputs.config;
    const run = createNonInteractiveRun(
      () => isProviderConfigured(this.inputs.providerManager),
      () => reportUnconfiguredProviderError(config),
      () => config.getOutputFormat(),
      () => config.getDebugMode(),
      () => config.getSessionId(),
      () => config.getModel(),
      createHeadlessFeedback(() => config.getDebugMode()),
      () =>
        requireRuntimeSettings(
          this.inputs.runtimeSettings,
        ).owner.readNamedParameter('emojifilter'),
      resolveHeadlessSlash(
        this.inputs.runtimeSettings !== undefined,
        createHeadlessCommandRun(
          createHeadlessCommandLoader(
            () => config.userCommandsDir,
            () => config.projectCommandsDir,
            () => config.getProjectRoot(),
            () => config.getExtensions(),
            () => config.getFolderTrust(),
            () =>
              this.inputs.policyOwner?.trust.isTrustedFolder.bind(
                this.inputs.policyOwner.trust,
              ),
            () => config.getShellReplacement(),
            () => config.getExcludeTools(),
            () => config.getCoreTools(),
            () => config.getApprovalMode(),
            () => config.getShellExecutionConfig(),
            () => config.getTargetDir(),
            () => config.getShouldUseNodePtyShell(),
          ),
          () => config.getSessionId(),
          () => createSessionMetrics(),
        ),
      ),
      () => this.acquireTurn(),
      createHeadlessErrorReporter(
        () => getActiveProviderNameForApiError(config),
        (provider) => getErrorFallbackModel(config, provider),
      ),
      () =>
        requireRuntimeSettings(
          this.inputs.runtimeSettings,
        ).owner.telemetry.flush(),
    );
    return run(input, promptId, deferTelemetry);
  }
}
