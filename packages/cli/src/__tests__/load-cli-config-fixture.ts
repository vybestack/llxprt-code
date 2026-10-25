/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type {
  AgentActivationOperation,
  AgentProfileApplication,
  AgentProfilePreflight,
} from '@vybestack/llxprt-code-agents';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import type { ProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition.js';
import type {
  Config,
  LlxprtExtension,
  ProviderSwitcher,
  SessionSettingsOwner,
} from '@vybestack/llxprt-code-core';
import type { CliArgs } from '../config/cliArgParser.js';
import { ignoreReady, loadCliConfig } from '../config/config.js';
import { resolveProxy } from '../config/configBuilder.js';
import type { ExtensionEnablementManager } from '../config/extensions/extensionEnablement.js';
import {
  parseBootstrapArgs,
  prepareRuntimeForProfile,
} from '../config/profileBootstrap.js';
import type { Settings } from '../config/settings.js';

export interface LoadCliConfigFixtureInput {
  settings: Settings;
  extensions: LlxprtExtension[];
  extensionEnablementManager: ExtensionEnablementManager;
  sessionId: string;
  argv: CliArgs;
  cwd?: string;
  /** When absent the fixture prepares the preflight itself and finishes it. */
  preflight?: AgentProfilePreflight;
  settingsService?: SettingsService;
  settingsOwner?: SessionSettingsOwner;
  authority?: CredentialAuthority;
  contributions?: ProviderContributionRegistry;
  onActivationBootstrapReady?: (operation: AgentActivationOperation) => void;
  onProfileApplicationReady?: (application: AgentProfileApplication) => void;
  onProviderSwitchReady?: (switchProvider: ProviderSwitcher) => void;
  onPreflightReady?: (operation: AgentProfilePreflight) => void;
}

/**
 * The single test-side entry to `loadCliConfig`. Callers that supply no
 * preflight get one prepared here, and the post-configuration activation is
 * finished here when `loadCliConfig` returns or throws.
 */
export async function loadCliConfigWithPreflight(
  input: LoadCliConfigFixtureInput,
): Promise<Config> {
  const cwd = input.cwd ?? process.cwd();
  const prepared = input.preflight ?? (await prepareFixturePreflight(input));
  try {
    return await loadCliConfig(
      {
        settings: input.settings,
        extensions: input.extensions,
        extensionEnablementManager: input.extensionEnablementManager,
        sessionId: input.sessionId,
        argv: input.argv,
        cwd,
        preflight: prepared,
        settingsOwner: input.settingsOwner,
      },
      {
        activationBootstrap: input.onActivationBootstrapReady,
        profileApplication:
          input.onProfileApplicationReady ?? ignoreReady.profileApplication,
        providerSwitch:
          input.onProviderSwitchReady ?? ignoreReady.providerSwitch,
        preflight: input.onPreflightReady ?? ignoreReady.preflight,
      },
    );
  } finally {
    if (input.preflight === undefined) await prepared.finishPostConfiguration();
  }
}

// Prepared the way the CLI entry prepares a foreground preflight, so
// `loadCliConfig` resolves the declarative configuration (and the trust check
// inside it) exactly once.
async function prepareFixturePreflight(
  input: LoadCliConfigFixtureInput,
): Promise<AgentProfilePreflight> {
  const parsed = parseBootstrapArgs();
  return prepareRuntimeForProfile(
    {
      ...parsed,
      runtimeMetadata: {
        ...parsed.runtimeMetadata,
        proxy: resolveProxy(input.argv.proxy),
      },
    },
    input.authority,
    input.settingsService,
    undefined,
    input.contributions,
  );
}
