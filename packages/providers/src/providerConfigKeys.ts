import { SETTINGS_REGISTRY } from '@vybestack/llxprt-code-settings/settings/settingsRegistry.js';

/**
 * Set of all provider-config canonical keys derived from the central settings
 * registry. Used to filter provider-config settings out of the global
 * ephemerals snapshot so they only appear in provider-scoped sections.
 * Legacy spellings are no longer listed: they are migrated at load (#2533 C1).
 *
 * @plan PLAN-20260126-SETTINGS-SEPARATION.P09
 */
export const PROVIDER_CONFIG_KEYS: ReadonlySet<string> = new Set(
  SETTINGS_REGISTRY.filter((s) => s.category === 'provider-config').map(
    (s) => s.key,
  ),
);
