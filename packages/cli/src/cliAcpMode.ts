/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentProfileApplication } from '@vybestack/llxprt-code-agents';
import type {
  ProfileDefinitionReads,
  WorkspaceTrustControlPort,
  Config,
} from '@vybestack/llxprt-code-core';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import type { ProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  runZedIntegration,
  type ZedSessionProviderInputs,
} from '@vybestack/llxprt-code-zed-acp';
import { createOAuthSettingsAdapter } from './auth/oauth-settings-adapter.js';
import type { LoadedSettings } from './config/settings.js';
import type { ParsedCliArgs } from './cliBootstrap.js';
import type { BootstrapSelection } from './observation/jspWiring.js';
import { maybeHopIntoSandbox } from './cliSandbox.js';
import { ensureAcpProviderActivated } from './cliProviderInit.js';
import { runExitCleanup } from './utils/cleanup.js';

interface ZedIntegrationReads
  extends AgentProfileApplication,
    WorkspaceTrustControlPort {
  hasActiveProvider(): boolean;
  setActiveProvider(provider: string): void | Promise<void>;
  listProfiles(): ReturnType<ProfileDefinitionReads['listProfiles']>;
  captureSettingsSnapshot(): ReturnType<
    SettingsService['exportForStateSnapshot']
  >;
}

type AcpPreflight = ZedIntegrationReads & {
  forkSandboxPreflight: Parameters<
    typeof maybeHopIntoSandbox
  >[0]['prepareSandboxPreflight'];
};

interface AcpModeContext {
  config: Config;
  settings: LoadedSettings;
  argv: ParsedCliArgs;
  workspaceRoot: string;
  preflight: AcpPreflight;
  readStdinOnce: () => Promise<string>;
  bootstrapSelection: BootstrapSelection | null;
  cleanupStdio: () => void;
  providerContributions: ProviderContributionRegistry;
  authority: CredentialAuthority;
}

function createZedProviderInputs(
  providerContributions: ProviderContributionRegistry,
  credentialAuthority: CredentialAuthority,
): ZedSessionProviderInputs {
  const oauthSettings = createOAuthSettingsAdapter();
  return {
    credentialAuthority,
    providerContributions,
    ...(oauthSettings !== undefined ? { oauthSettings } : {}),
  };
}

/** ACP protocol stdio is inherited; host prompt input and auth are unused. */
export async function handleAcpMode(context: AcpModeContext): Promise<boolean> {
  const { config, preflight } = context;
  if (!config.getExperimentalZedIntegration()) return false;
  await maybeHopIntoSandbox({
    config,
    settings: context.settings,
    argv: context.argv,
    workspaceRoot: context.workspaceRoot,
    prepareSandboxPreflight: () => preflight.forkSandboxPreflight(),
    initialAuthFailed: false,
    readStdin: context.readStdinOnce,
    hasPipedInput: false,
    bootstrapSelection: context.bootstrapSelection,
  });
  context.cleanupStdio();
  ensureAcpProviderActivated(config, preflight);
  await runZedIntegration(config, preflight, {
    profileDefinitions: { listProfiles: () => preflight.listProfiles() },
    trustPort: preflight,
    onExitCleanup: runExitCleanup,
    providerInputs: createZedProviderInputs(
      context.providerContributions,
      context.authority,
    ),
    createSessionSettings: () => {
      const session = new SettingsService();
      session.restoreFromStateSnapshot(preflight.captureSettingsSnapshot());
      return session;
    },
  });
  return true;
}
