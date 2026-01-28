import { SETTINGS_REGISTRY } from '../settings/settingsRegistry.js';

/**
 * Set of all provider-config keys (canonical + aliases) derived from the
 * central settings registry. Used to filter provider-config settings out of
 * the global ephemerals snapshot so they only appear in provider-scoped sections.
 *
 * @plan PLAN-20260126-SETTINGS-SEPARATION.P09
 */
export const PROVIDER_CONFIG_KEYS: ReadonlySet<string> = new Set(
  SETTINGS_REGISTRY.filter((s) => s.category === 'provider-config').flatMap(
    (s) => [s.key, ...(s.aliases ?? [])],
  ),
);
