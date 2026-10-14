/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Agent } from '@vybestack/llxprt-code-agents';
import type { LoadedSettings } from '../../config/settings.js';
import type { OAuthControl } from '../contexts/OAuthControlContext.js';
import type { RuntimeApi } from '../contexts/RuntimeContext.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import type { BaseurlCommandOperations } from './baseurlCommand.js';
import type { KeyCommandOperations } from './keyCommand.js';
import type { KeyfileCommandOperations } from './keyfileCommand.js';
import type { LogoutCommandOperations } from './logoutCommand.js';
import type { QuotaCommandOperations } from './quotaCommand.js';
import type { McpAuthCommandOperations } from './mcpAuth.js';
import { fetchAllQuotaInfo } from './statsQuota.js';

const MISSING_CREDENTIAL_OWNER =
  'Key commands require an explicit credential owner';

/**
 * Binds /baseurl to one session. The Agent is nullable because the interactive
 * UI mounts before bootstrap hands it over; until then the session runtime API
 * performs the update.
 */
export function bindBaseurlCommandOperations(
  api: RuntimeApi,
  agent: Agent | null,
): BaseurlCommandOperations {
  if (agent === null) {
    return {
      activeProviderName: () => api.providerStatus().providerName ?? 'unknown',
      updateBaseUrl: async (baseUrl) =>
        (await api.updateActiveProviderBaseUrl(baseUrl)).message,
    };
  }
  return {
    activeProviderName: () => agent.getProvider(),
    updateBaseUrl: async (baseUrl) => {
      const provider = agent.getProvider();
      await agent.auth.setBaseUrl(baseUrl || null);
      return baseUrl
        ? `Base URL set to '${baseUrl}' for provider '${provider}'`
        : `Base URL cleared for provider '${provider}'`;
    },
  };
}

/**
 * Binds /logout to one session. An Agent validates against its own provider
 * list; before the Agent exists the OAuth control answers instead.
 */
export function bindLogoutCommandOperations(
  agent: Agent | null,
  oauthControl: OAuthControl,
): LogoutCommandOperations {
  if (agent === null) {
    return {
      logout: async (provider) => {
        const supportedProviders = oauthControl.getSupportedProviders();
        if (!supportedProviders.includes(provider)) {
          return {
            kind: 'unknown-provider',
            message: `Unknown provider: ${provider}. Supported providers: ${supportedProviders.join(', ')}`,
          };
        }
        const wasAuthenticated = await oauthControl.isAuthenticated(provider);
        await oauthControl.logout(provider);
        return { kind: 'logged-out', wasAuthenticated };
      },
    };
  }
  return {
    logout: async (provider) => {
      // auth.status() only returns 'authenticated'/'unauthenticated' (never
      // 'unknown'), so unsupported providers are rejected from the list.
      const knownProviders = agent.listProviders().map((p) => p.name);
      if (!knownProviders.includes(provider)) {
        return {
          kind: 'unknown-provider',
          message: `Unknown provider: ${provider}. Supported: ${knownProviders.join(', ')}`,
        };
      }
      const wasAuthenticated = agent.auth.status(provider) === 'authenticated';
      await agent.auth.logout(provider);
      return { kind: 'logged-out', wasAuthenticated };
    },
  };
}

/**
 * Nothing in the slash-command host consumes a paid-mode re-check today: the
 * session controller that owns that state is not mounted with the command
 * registry. The operation is explicit so a consumer can be bound here.
 */
function schedulePaymentModeCheck(): void {
  return undefined;
}

export function bindKeyfileCommandOperations(
  api: RuntimeApi,
  settings: Pick<
    LoadedSettings,
    'setProviderKeyfile' | 'removeProviderKeyfile'
  >,
): KeyfileCommandOperations {
  return {
    activeProviderName: () => api.providerStatus().providerName ?? null,
    updateActiveProviderApiKey: (key) => api.updateActiveProviderApiKey(key),
    setEphemeralSetting: (key, value) => api.setEphemeralSetting(key, value),
    rememberProviderKeyfile: (providerName, keyfilePath) =>
      settings.setProviderKeyfile(providerName, keyfilePath),
    forgetProviderKeyfile: (providerName) =>
      settings.removeProviderKeyfile(providerName),
    schedulePaymentModeCheck,
  };
}

export function bindKeyCommandOperations(
  api: RuntimeApi,
  config: CliUiRuntime | null,
): KeyCommandOperations {
  const owner = (): CliUiRuntime => {
    if (config === null) throw new Error(MISSING_CREDENTIAL_OWNER);
    return config;
  };
  return {
    providerKeys: () => owner().getProviderKeys(),
    listKeyCompletionNames: () => owner().listKeyCompletionNames(),
    invalidateKeyCompletion: () => owner().invalidateKeyCompletion(),
    isInteractive: () => (config === null ? true : config.isInteractive()),
    activeProviderName: () => api.providerStatus().providerName ?? null,
    updateActiveProviderApiKey: (key) => api.updateActiveProviderApiKey(key),
    setEphemeralSetting: (key, value) =>
      owner().setEphemeralSetting(key, value),
    schedulePaymentModeCheck,
  };
}

/**
 * Binds /quota to one session: its OAuth control, its network fetch, its
 * configured endpoint and the same quota report /stats shows.
 */
export function bindQuotaCommandOperations(
  api: RuntimeApi,
  oauthControl: OAuthControl,
): QuotaCommandOperations {
  return {
    oauthControl,
    fetch: api.fetch,
    baseUrlSetting: () => api.getEphemeralSetting('base-url'),
    fetchQuotaLines: () => fetchAllQuotaInfo(api, oauthControl),
  };
}

export function bindMcpAuthCommandOperations(
  agent: Agent | null,
  config: CliUiRuntime | null,
): McpAuthCommandOperations {
  return {
    isConfigured: () => config !== null,
    configuredServers: () =>
      (agent?.mcp.listServers() ?? []).map((server) => ({
        name: server.name,
        oauthEnabled: server.config.oauth?.enabled === true,
      })),
    authenticationRequiredServers: async () => {
      if (agent === null) {
        return [];
      }
      return (await agent.mcp.details()).servers
        .filter((server) => server.requiresAuth)
        .map((server) => server.name);
    },
    authenticate: async (serverName, displayListener) => {
      if (agent === null) {
        throw new Error('Agent is not available.');
      }
      await agent.mcp.authenticate(serverName, displayListener);
    },
  };
}
