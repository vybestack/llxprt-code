/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BaseurlCommandOperations } from './baseurlCommand.js';
import type { KeyCommandOperations } from './keyCommand.js';
import type { KeyfileCommandOperations } from './keyfileCommand.js';
import type { LogoutCommandOperations } from './logoutCommand.js';
import type { QuotaCommandOperations } from './quotaCommand.js';
import type { McpAuthCommandOperations } from './mcpAuth.js';

export function bindBaseurlCommandOperations(
  activeProviderName: () => string,
  writeBaseUrl: (baseUrl: string | null) => Promise<void>,
): BaseurlCommandOperations {
  return {
    activeProviderName,
    updateBaseUrl: async (baseUrl) => {
      const provider = activeProviderName();
      await writeBaseUrl(baseUrl || null);
      return baseUrl
        ? `Base URL set to '${baseUrl}' for provider '${provider}'`
        : `Base URL cleared for provider '${provider}'`;
    },
  };
}

export function bindLogoutCommandOperations(
  listProviderNames: () => readonly string[],
  isAuthenticated: (provider: string) => boolean | Promise<boolean>,
  logout: (provider: string) => Promise<void>,
  supportedLabel: 'Supported' | 'Supported providers',
): LogoutCommandOperations {
  return {
    logout: async (provider) => {
      const knownProviders = listProviderNames();
      if (!knownProviders.includes(provider)) {
        return {
          kind: 'unknown-provider',
          message: `Unknown provider: ${provider}. ${supportedLabel}: ${knownProviders.join(', ')}`,
        };
      }
      const wasAuthenticated = await isAuthenticated(provider);
      await logout(provider);
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
  activeProviderName: KeyfileCommandOperations['activeProviderName'],
  updateActiveProviderApiKey: KeyfileCommandOperations['updateActiveProviderApiKey'],
  setEphemeralSetting: KeyfileCommandOperations['setEphemeralSetting'],
  rememberProviderKeyfile: KeyfileCommandOperations['rememberProviderKeyfile'],
  forgetProviderKeyfile: KeyfileCommandOperations['forgetProviderKeyfile'],
): KeyfileCommandOperations {
  return {
    activeProviderName,
    updateActiveProviderApiKey,
    setEphemeralSetting,
    rememberProviderKeyfile,
    forgetProviderKeyfile,
    schedulePaymentModeCheck,
  };
}

export function bindKeyCommandOperations(
  providerKeys: KeyCommandOperations['providerKeys'],
  listKeyCompletionNames: KeyCommandOperations['listKeyCompletionNames'],
  invalidateKeyCompletion: KeyCommandOperations['invalidateKeyCompletion'],
  isInteractive: KeyCommandOperations['isInteractive'],
  activeProviderName: KeyCommandOperations['activeProviderName'],
  updateActiveProviderApiKey: KeyCommandOperations['updateActiveProviderApiKey'],
  setEphemeralSetting: KeyCommandOperations['setEphemeralSetting'],
): KeyCommandOperations {
  return {
    providerKeys,
    listKeyCompletionNames,
    invalidateKeyCompletion,
    isInteractive,
    activeProviderName,
    updateActiveProviderApiKey,
    setEphemeralSetting,
    schedulePaymentModeCheck,
  };
}

/**
 * Binds /quota to one session: its OAuth control, its network fetch, its
 * configured endpoint and the same quota report /stats shows.
 */
export function bindQuotaCommandOperations(
  oauthControl: QuotaCommandOperations['oauthControl'],
  requestFetch: QuotaCommandOperations['fetch'],
  baseUrlSetting: QuotaCommandOperations['baseUrlSetting'],
  fetchQuotaLines: QuotaCommandOperations['fetchQuotaLines'],
): QuotaCommandOperations {
  return { oauthControl, fetch: requestFetch, baseUrlSetting, fetchQuotaLines };
}

export function bindMcpAuthCommandOperations(
  configuredServers: McpAuthCommandOperations['configuredServers'],
  authenticationRequiredServers: McpAuthCommandOperations['authenticationRequiredServers'],
  authenticate: McpAuthCommandOperations['authenticate'],
  isConfigured: McpAuthCommandOperations['isConfigured'],
): McpAuthCommandOperations {
  return {
    configuredServers,
    authenticationRequiredServers,
    authenticate,
    isConfigured,
  };
}
