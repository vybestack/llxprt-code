/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @issue #2533 Phase C1
 *
 * Every settings key has exactly ONE canonical spelling. Legacy spellings
 * (old aliases, camelCase, kebab-case variants) are NOT resolved at read
 * time anymore; they are rewritten ONCE to the canonical key at load via
 * {@link migrateLegacySettingKeys}. The registry performs exact-key lookups
 * only.
 */

/**
 * Legacy setting-key spellings → canonical registry key. Keys that were
 * accepted by the old alias resolution (ALIAS_NORMALIZATION_RULES, spec
 * aliases, and the tools_allowed spelling accepted by subagent ephemeral
 * population) map to their one canonical key here.
 */
export const LEGACY_SETTING_KEY_MIGRATIONS: ReadonlyMap<string, string> =
  new Map<string, string>([
    // model params
    ['max-tokens', 'max_tokens'],
    ['maxTokens', 'max_tokens'],
    ['max-output-tokens', 'max_output_tokens'],
    ['max-output', 'maxOutputTokens'],
    ['response-format', 'response_format'],
    ['responseFormat', 'response_format'],
    ['tool-choice', 'tool_choice'],
    ['toolChoice', 'tool_choice'],
    // provider config
    ['apiKey', 'auth-key'],
    ['api-key', 'auth-key'],
    ['apiKeyfile', 'auth-keyfile'],
    ['api-keyfile', 'auth-keyfile'],
    ['baseUrl', 'base-url'],
    ['baseurl', 'base-url'],
    ['base_url', 'base-url'],
    ['BaseUrl', 'base-url'],
    ['BaseURL', 'base-url'],
    ['tool-format', 'toolFormat'],
    ['tool-format-override', 'toolFormatOverride'],
    // headers
    ['User-Agent', 'user-agent'],
    // tool governance (canonical keys are dotted)
    ['disabled-tools', 'tools.disabled'],
    ['tools_allowed', 'tools.allowed'],
    // stream watchdogs (settings.json historically stored camelCase)
    ['streamIdleTimeoutMs', 'stream-idle-timeout-ms'],
    ['streamFirstResponseTimeoutMs', 'stream-first-response-timeout-ms'],
  ]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reports whether `raw` already carries a value for the canonical dotted
 * `key` ('tools.disabled'), either as a nested leaf (settings.json shape:
 * `tools: { disabled: [...] }`) or as a flat dotted key (ephemeral-settings
 * map shape: `'tools.disabled'`).
 */
function hasCanonicalValue(raw: Record<string, unknown>, key: string): boolean {
  if (key in raw) {
    return true;
  }
  const dotIndex = key.indexOf('.');
  if (dotIndex <= 0) {
    return false;
  }
  const container = raw[key.slice(0, dotIndex)];
  const leaf = key.slice(dotIndex + 1);
  return isPlainObject(container) && leaf in container;
}

/**
 * Writes `value` at the canonical dotted `key`, matching the shape already
 * used by the surrounding map: nested under the existing container when one
 * is present, otherwise as a flat dotted key.
 */
function writeCanonicalValue(
  raw: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  const dotIndex = key.indexOf('.');
  if (dotIndex <= 0) {
    raw[key] = value;
    return;
  }
  const containerKey = key.slice(0, dotIndex);
  const leaf = key.slice(dotIndex + 1);
  const container = raw[containerKey];
  if (isPlainObject(container)) {
    // Copy before mutating so a nested container owned by the caller (e.g. a
    // loaded settings scope) is not modified in place.
    raw[containerKey] = { ...container, [leaf]: value };
    return;
  }
  raw[key] = value;
}

/**
 * Rewrites legacy setting-key spellings to their canonical key once, and
 * deletes the legacy key.
 *
 * Collision policy: the CANONICAL value wins. A legacy value is applied only
 * when no canonical value is present (nested leaf or flat dotted key); the
 * legacy key is deleted either way. This keeps a file that carries both a
 * stale legacy value and an up-to-date canonical value deterministic.
 *
 * Idempotent: a map that is already canonical is returned unchanged (a
 * second run is a no-op).
 */
export function migrateLegacySettingKeys(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...raw };
  let changed = false;

  for (const [legacyKey, canonicalKey] of LEGACY_SETTING_KEY_MIGRATIONS) {
    if (!(legacyKey in result)) {
      continue;
    }
    const legacyValue = result[legacyKey];
    delete result[legacyKey];
    if (!hasCanonicalValue(result, canonicalKey)) {
      writeCanonicalValue(result, canonicalKey, legacyValue);
    }
    changed = true;
  }

  return changed ? result : raw;
}
