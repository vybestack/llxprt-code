/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  getEphemeralSetting,
  getCliProviderManager,
  getCliRuntimeContext,
  getCliRuntimeServices,
} from './runtimeAccessors.js';
import { oauthRuntimeBridge } from '../auth/index.js';
import type { OAuthRuntimeAccessors } from '../auth/index.js';

/**
 * Build the concrete {@link OAuthRuntimeAccessors} backed by the real CLI
 * runtime accessors.
 *
 * This is the CLI-side counterpart of the providers-owned
 * `runtime-accessor-bridge`.  The providers package defines a narrow
 * interface; the CLI supplies this implementation at startup via
 * `oauthRuntimeBridge.setAccessors(buildOAuthRuntimeAccessors())`.
 *
 * Behaviour preservation notes:
 *  - `getRuntimeContext` preserves the old `getCliRuntimeContext()` behaviour:
 *    it may throw when the runtime is not initialised.  Callers in the auth
 *    cluster wrap it in their own try/catch.
 *  - `getCurrentProfileName` replicates the exact logic that
 *    `token-profile-resolver.ts` used inline: prefer
 *    `settingsService.getCurrentProfileName()` when available, fall back to
 *    `settingsService.get('currentProfile')`, and return null on any error
 *    (matching the old catch path).
 */
export function buildOAuthRuntimeAccessors(): OAuthRuntimeAccessors {
  return {
    getEphemeralSetting: (key: string) => getEphemeralSetting(key),

    getProviderManager: () => {
      try {
        return getCliProviderManager() as {
          getProviderByName(name: string): unknown;
        };
      } catch {
        return undefined;
      }
    },

    getRuntimeContext: () => {
      // Preserve the old behaviour: getCliRuntimeContext() may throw.
      // Callers (e.g. auth-status-service) wrap this in their own try/catch.
      const ctx = getCliRuntimeContext();
      return { runtimeId: ctx.runtimeId };
    },

    getCurrentProfileName: () => {
      try {
        const { settingsService } = getCliRuntimeServices();
        return typeof settingsService.getCurrentProfileName === 'function'
          ? settingsService.getCurrentProfileName()
          : ((settingsService.get('currentProfile') as string | null) ?? null);
      } catch {
        return null;
      }
    },
  };
}

/**
 * Register the CLI-backed OAuth runtime accessors on the providers-owned
 * bridge singleton.
 *
 * Call this during CLI startup (before any OAuth flow runs) so that the
 * moved auth cluster in `@vybestack/llxprt-code-providers` can read runtime
 * state without importing from the CLI package directly.
 */
export function registerOAuthRuntimeAccessors(): void {
  oauthRuntimeBridge.setAccessors(buildOAuthRuntimeAccessors());
}
