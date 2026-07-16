/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import dns from 'node:dns';
import { type Config, setGitStatsService } from '@vybestack/llxprt-code-core';
import { DebugLogger, debugLogger } from '@vybestack/llxprt-code-telemetry';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { loadProfileByName } from '@vybestack/llxprt-code-providers/runtime.js';
import {
  preflightAgentActivation,
  type ProviderActivationIntent,
  type ActivationPreflightToken,
} from '@vybestack/llxprt-code-agents';
import { GitStatsServiceImpl } from './providers/logging/git-stats-service-impl.js';
import { validateDnsResolutionOrder } from './cliBootstrap.js';
import type { LoadedSettings } from './config/settings.js';
import type { ParsedCliArgs } from './cliBootstrap.js';

export type CliProviderManager = NonNullable<
  ReturnType<Config['getProviderManager']>
>;

/**
 * Compute the merged model params (profile + CLI) that should be applied
 * before the first request for the configured provider.
 */
export function collectProviderModelParams(
  config: Config,
  argv: ParsedCliArgs,
): Record<string, unknown> {
  const configWithParams = config as Config & {
    _profileModelParams?: Record<string, unknown>;
    _cliModelParams?: Record<string, unknown>;
  };
  const mergedModelParams: Record<string, unknown> = {};

  if (!argv.provider && configWithParams._profileModelParams) {
    Object.assign(mergedModelParams, configWithParams._profileModelParams);
  }
  if (configWithParams._cliModelParams) {
    Object.assign(mergedModelParams, configWithParams._cliModelParams);
  }
  return mergedModelParams;
}

interface BootstrapOverrideShape {
  keyOverride?: string | null;
  keyfileOverride?: string | null;
  keyNameOverride?: string | null;
  setOverrides?: string[] | null;
  baseurlOverride?: string | null;
}

/**
 * Build the declarative CLI credential/model-override bundle for the
 * activation intent. Mirrors the previous two-argument
 * `applyCliArgumentOverrides(argv, bootstrapArgs)` call by merging the
 * bootstrap-parsed overrides (preferred by the providers runtime) with the
 * yargs-parsed argv (fallback). Each field is omitted when neither source
 * supplies a value so the executor's conditional-spread adapters produce an
 * empty shape.
 */
function buildActivationCliOverrides(
  config: Config,
  argv: ParsedCliArgs,
): NonNullable<ProviderActivationIntent['cliOverrides']> {
  const configWithBootstrapArgs = config as Config & {
    _bootstrapArgs?: BootstrapOverrideShape;
  };
  const bootstrap = configWithBootstrapArgs._bootstrapArgs;

  const overrides: {
    key?: string;
    keyfile?: string;
    keyName?: string;
    baseUrl?: string;
    set?: string[];
  } = {};

  const key = bootstrap?.keyOverride ?? argv.key;
  if (key !== undefined) {
    overrides.key = key;
  }

  const keyfile = bootstrap?.keyfileOverride ?? argv.keyfile;
  if (keyfile !== undefined) {
    overrides.keyfile = keyfile;
  }

  const keyName = bootstrap?.keyNameOverride ?? undefined;
  if (keyName !== undefined) {
    overrides.keyName = keyName;
  }

  const baseUrl = bootstrap?.baseurlOverride ?? argv.baseurl;
  if (baseUrl !== undefined) {
    overrides.baseUrl = baseUrl;
  }

  const set = bootstrap?.setOverrides ?? argv.set;
  if (set !== undefined) {
    overrides.set = [...set];
  }

  return overrides;
}

/**
 * Activate the provider that the resolved config points at (or the default
 * provider when none was explicitly requested). Returns true if the initial
 * authentication attempt failed.
 *
 * WHY THIS RUNS PRE-AGENT (#2374 round-3 Fix 3, #2378): the interactive CLI
 * bootstrap needs the auth outcome BEFORE the Agent is constructed — the
 * sandbox-hop decision (maybeHopIntoSandbox) and the fatal-exit path
 * (FATAL_AUTHENTICATION_ERROR) depend on whether auth succeeded. Constructing
 * the Agent first and then checking auth would defer the fatal-exit past agent
 * construction, changing the observable process lifecycle.
 *
 * The CLI builds a DECLARATIVE {@link ProviderActivationIntent} and calls the
 * public {@link preflightAgentActivation} agent-bootstrap entrypoint (#2378).
 * The CLI does NOT import or execute the runtime activation primitive
 * (`executeProviderActivation`) directly; preflight owns that internally and
 * returns the typed declarative result. The SAME Config is later adopted by
 * `createForegroundAgent` → `fromConfig`, whose executor fast-path adopts this
 * preflight state without re-running a second activation sequence.
 */
export interface ConfiguredProviderActivationResult {
  readonly authFailed: boolean;
  readonly token?: ActivationPreflightToken;
  readonly intent?: ProviderActivationIntent;
}

export async function activateConfiguredProvider(
  config: Config,
  providerManager: CliProviderManager,
  argv: ParsedCliArgs,
): Promise<ConfiguredProviderActivationResult> {
  const configProvider = config.getProvider();
  const cliModelOverride = (config as Config & { _cliModelOverride?: string })
    ._cliModelOverride;
  const intent: ProviderActivationIntent = {
    ...(configProvider !== undefined && configProvider !== ''
      ? { provider: configProvider }
      : (() => {
          const activeName = providerManager.getActiveProviderName();
          return activeName !== undefined
            ? { defaultProvider: activeName }
            : {};
        })()),
    ...(typeof cliModelOverride === 'string' &&
    cliModelOverride.trim().length > 0
      ? { model: cliModelOverride.trim() }
      : {}),
    modelParams: collectProviderModelParams(config, argv),
    cliOverrides: buildActivationCliOverrides(config, argv),
    authMode: 'auto',
  };
  let result;
  try {
    result = await preflightAgentActivation(config, intent);
  } catch (error) {
    const bootstrapLogger = new DebugLogger('llxprt:bootstrap');
    bootstrapLogger.error(
      () =>
        `[bootstrap] activateConfiguredProvider preflight threw: ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
    return { authFailed: true };
  }
  return {
    authFailed: result.authFailed,
    ...(result.token !== undefined ? { token: result.token, intent } : {}),
  };
}

/**
 * Reapply a bootstrap profile (from --profile-load or LLXPRT_BOOTSTRAP_PROFILE)
 * after provider-manager initialization, unless a provider was given on the CLI
 * or a profile was already loaded during config construction.
 */
export async function reapplyBootstrapProfile(
  argv: ParsedCliArgs,
  runtimeSettingsService: SettingsService,
): Promise<void> {
  const envProfile = process.env.LLXPRT_BOOTSTRAP_PROFILE;
  const bootstrapProfileName =
    argv.profileLoad?.trim() ??
    (typeof envProfile === 'string' ? envProfile.trim() : '');
  const currentProfileName = runtimeSettingsService.getCurrentProfileName();
  if (
    argv.provider ||
    bootstrapProfileName === '' ||
    currentProfileName !== null
  ) {
    return;
  }
  try {
    await loadProfileByName(bootstrapProfileName);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    debugLogger.warn(
      `[bootstrap] Failed to reapply profile '${bootstrapProfileName}' after provider manager initialization: ${message}`,
    );
  }
}

/**
 * Ensure the Gemini server-tools provider has the active Config attached even
 * when it is not the active provider.
 */
export function configureServerToolsProvider(
  providerManager: CliProviderManager,
  config: Config,
): void {
  const serverToolsProvider = providerManager.getServerToolsProvider();
  if (
    serverToolsProvider &&
    serverToolsProvider.name === 'gemini' &&
    'setConfig' in serverToolsProvider &&
    typeof serverToolsProvider.setConfig === 'function'
  ) {
    serverToolsProvider.setConfig(config);
  }
}

/**
 * Retrieve the provider manager created by loadCliConfig, re-apply the bootstrap
 * profile, initialize the git stats service when conversation logging is on,
 * configure the server-tools provider, and set the DNS resolution order.
 */
export async function configureProvidersAndServices(
  config: Config,
  settings: LoadedSettings,
  argv: ParsedCliArgs,
  runtimeSettingsService: SettingsService,
): Promise<CliProviderManager> {
  const providerManager = config.getProviderManager();
  if (!providerManager) {
    throw new Error(
      '[cli] Provider manager should have been initialized by loadCliConfig',
    );
  }

  await reapplyBootstrapProfile(argv, runtimeSettingsService);

  if (config.getConversationLoggingEnabled()) {
    const gitStatsService = new GitStatsServiceImpl(config);
    setGitStatsService(gitStatsService);
  }

  configureServerToolsProvider(providerManager, config);

  dns.setDefaultResultOrder(
    validateDnsResolutionOrder(settings.merged.dnsResolutionOrder),
  );

  return providerManager;
}

/** Connect the IDE companion client when IDE mode is enabled. */
export async function connectIdeClientIfEnabled(config: Config): Promise<void> {
  if (!config.getIdeMode()) {
    return;
  }
  const ideClient = config.getIdeClient();
  if (ideClient) {
    await ideClient.connect();
  }
}

/**
 * In ACP/Zed mode authentication happens through the protocol; just ensure the
 * configured provider is set as active when one is available. Best-effort:
 * never throws or produces an unhandled rejection, but logs failures so they
 * are observable.
 */
export function ensureAcpProviderActivated(config: Config): void {
  const providerManagerForAcp = config.getProviderManager();
  const configProvider = config.getProvider();
  if (!configProvider || !providerManagerForAcp) {
    return;
  }
  if (providerManagerForAcp.hasActiveProvider()) {
    return;
  }
  try {
    const activation = providerManagerForAcp.setActiveProvider(configProvider);
    if (activation instanceof Promise) {
      activation.catch((error) => {
        debugLogger.warn(
          () =>
            `[bootstrap] ensureAcpProviderActivated: async provider activation failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
        );
      });
    }
  } catch (error) {
    debugLogger.warn(
      () =>
        `[bootstrap] ensureAcpProviderActivated: provider activation failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
  }
}
