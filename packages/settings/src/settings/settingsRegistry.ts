/**
 * @plan PLAN-20260608-ISSUE1588.P05
 *
 * Settings registry — migrated from core.
 * Explicit temporary duplicate; core copy remains until P09.
 * Settings-owned: does NOT import core compression types.
 */

export type {
  SettingCategory,
  ValidationResult,
  SettingSpec,
  SeparatedSettings,
} from './registry/registry-types.js';
export { COMPRESSION_STRATEGIES } from './registry/registry-types.js';

import type {
  ValidationResult,
  SettingSpec,
  SeparatedSettings,
} from './registry/registry-types.js';
import { REGISTRY_ENTRIES_PART_1 } from './registry/registry-entries-1.js';
import { REGISTRY_ENTRIES_PART_2 } from './registry/registry-entries-2.js';
import { REGISTRY_ENTRIES_PART_3 } from './registry/registry-entries-3.js';

const ALIAS_NORMALIZATION_RULES: Record<string, string> = {
  'max-tokens': 'max_tokens',
  maxTokens: 'max_tokens',
  'response-format': 'response_format',
  responseFormat: 'response_format',
  'tool-choice': 'tool_choice',
  toolChoice: 'tool_choice',
  'disabled-tools': 'tools.disabled',
};

const HEADER_PRESERVE_SET = new Set([
  'user-agent',
  'content-type',
  'authorization',
  'x-api-key',
]);

export const SETTINGS_REGISTRY: readonly SettingSpec[] = [
  ...REGISTRY_ENTRIES_PART_1,
  ...REGISTRY_ENTRIES_PART_2,
  ...REGISTRY_ENTRIES_PART_3,
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function resolveAlias(key: string): string {
  const normalizedAlias = ALIAS_NORMALIZATION_RULES[key];
  if (typeof normalizedAlias === 'string') {
    return normalizedAlias;
  }

  for (const spec of SETTINGS_REGISTRY) {
    if (spec.aliases?.includes(key) === true) {
      return spec.key;
    }
  }

  for (const spec of SETTINGS_REGISTRY) {
    if (spec.key === key) {
      return key;
    }
  }

  const lowerKey = key.toLowerCase();
  if (HEADER_PRESERVE_SET.has(lowerKey)) {
    return key;
  }

  return key.replace(/-/g, '_');
}

export function getSettingSpec(key: string): SettingSpec | undefined {
  // Direct canonical-key match first (fast path)
  const direct = SETTINGS_REGISTRY.find((s) => s.key === key);
  if (direct) {
    return direct;
  }
  // Resolve alias to canonical key and look up the spec
  const resolved = resolveAlias(key);
  if (resolved !== key) {
    return SETTINGS_REGISTRY.find((s) => s.key === resolved);
  }
  return undefined;
}

export function normalizeSetting(key: string, value: unknown): unknown {
  const resolvedKey = resolveAlias(key);
  const spec = SETTINGS_REGISTRY.find((s) => s.key === resolvedKey);

  if (spec?.normalize) {
    return spec.normalize(value);
  }

  // Reasoning spec already has normalize, but keep fallback for safety
  // until all reasoning normalization is verified through spec.normalize

  return value;
}

const INTERNAL_SETTINGS_KEYS = new Set([
  'activeProvider',
  'currentProfile',
  'tools',
]);

export function isInternalSettingKey(key: string): boolean {
  return INTERNAL_SETTINGS_KEYS.has(key);
}

export function getInternalSettingKeys(): string[] {
  return [...INTERNAL_SETTINGS_KEYS];
}

/** Extract custom headers from both global and provider-level settings. */
function extractCustomHeaders(
  mixed: Record<string, unknown>,
  providerOverrides: Record<string, unknown>,
): Record<string, string> {
  const customHeaders: Record<string, string> = {};

  if (isPlainObject(mixed['custom-headers'])) {
    const globalHeaders = mixed['custom-headers'];
    for (const [headerName, headerValue] of Object.entries(globalHeaders)) {
      if (typeof headerValue === 'string') {
        customHeaders[headerName] = headerValue;
      }
    }
  }

  if (isPlainObject(providerOverrides['custom-headers'])) {
    const providerHeaders = providerOverrides['custom-headers'];
    for (const [headerName, headerValue] of Object.entries(providerHeaders)) {
      if (typeof headerValue === 'string') {
        customHeaders[headerName] = headerValue;
      }
    }
  }

  return customHeaders;
}

/**
 * Flatten nested objects whose key is a known registry prefix (e.g. `text`,
 * `compression`, `compression.density`) into their registered dotted keys.
 *
 * Previously only `reasoning.*` was flattened, so a nested `text` object (or
 * any other prefix) leaked into modelParams as an unknown pass-through key and
 * was spread verbatim into provider request bodies — rejected by Anthropic as
 * "text: Extra inputs are not permitted". @issue #2182
 *
 * Semantics:
 *  - A registry prefix is any ancestor of a registered dotted key
 *    (`text.verbosity` -> prefix `text`).
 *  - Nested objects under a prefix are expanded into dotted keys; the original
 *    container is kept only when it has its own bare spec (e.g. `reasoning`),
 *    so a prefix-only container never falls through to modelParams.
 *  - Explicit flat keys always win over values extracted from a nested object.
 */
function flattenRegistryPrefixedObjects(
  source: Record<string, unknown>,
): Record<string, unknown> {
  const { prefixes, bareKeys } = getRegistryStructure();
  const result: Record<string, unknown> = { ...source };

  for (const [key, value] of Object.entries(source)) {
    if (!isPlainObject(value) || !prefixes.has(key)) {
      continue;
    }
    emitFlattenedEntries(result, key, value);
    if (!bareKeys.has(key)) {
      delete result[key];
    }
  }

  return result;
}

function emitFlattenedEntries(
  result: Record<string, unknown>,
  dottedKey: string,
  value: Record<string, unknown>,
): void {
  const { prefixes, bareKeys } = getRegistryStructure();
  for (const [subKey, subValue] of Object.entries(value)) {
    const childKey = `${dottedKey}.${subKey}`;
    if (isPlainObject(subValue) && prefixes.has(childKey)) {
      emitFlattenedEntries(result, childKey, subValue);
      if (!bareKeys.has(childKey)) {
        continue;
      }
    }
    if (!(childKey in result)) {
      result[childKey] = subValue;
    }
  }
}

let registryStructureCache: {
  prefixes: Set<string>;
  bareKeys: Set<string>;
} | null = null;

function getRegistryStructure(): {
  prefixes: Set<string>;
  bareKeys: Set<string>;
} {
  if (registryStructureCache !== null) {
    return registryStructureCache;
  }
  const prefixes = new Set<string>();
  const bareKeys = new Set<string>();
  for (const spec of SETTINGS_REGISTRY) {
    bareKeys.add(spec.key);
    let prefix = spec.key;
    let dotIndex = prefix.lastIndexOf('.');
    while (dotIndex > 0) {
      prefix = prefix.slice(0, dotIndex);
      prefixes.add(prefix);
      dotIndex = prefix.lastIndexOf('.');
    }
  }
  registryStructureCache = { prefixes, bareKeys };
  return registryStructureCache;
}

/**
 * Flatten provider overrides and reasoning sub-keys into a merged settings object.
 *
 * Base settings are flattened first, then provider overrides are flattened
 * separately and spread on top so provider-specific values always win —
 * including when an override arrives as a nested container (e.g. `text` →
 * `text.verbosity`) against a base-level flat key of the same name.
 */
function mergeProviderSettings(
  mixed: Record<string, unknown>,
  providerOverrides: Record<string, unknown>,
): Record<string, unknown> {
  const baseFlattened = flattenRegistryPrefixedObjects({ ...mixed });
  const overridesFlattened = flattenRegistryPrefixedObjects({
    ...providerOverrides,
  });
  return { ...baseFlattened, ...overridesFlattened };
}

/** Categorize a single setting entry into the appropriate bucket. */
function categorizeSettingEntry(
  rawKey: string,
  value: unknown,
  providerName: string | undefined,
  buckets: {
    cliSettings: Record<string, unknown>;
    modelBehavior: Record<string, unknown>;
    modelParams: Record<string, unknown>;
    customHeaders: Record<string, string>;
  },
): void {
  if (value === undefined || value === null) return;

  if (
    typeof value === 'object' &&
    !Array.isArray(value) &&
    rawKey === providerName
  ) {
    return;
  }

  if (rawKey === 'custom-headers') {
    return;
  }

  if (INTERNAL_SETTINGS_KEYS.has(rawKey)) {
    buckets.cliSettings[rawKey] = value;
    return;
  }

  const resolvedKey = resolveAlias(rawKey);
  const normalizedValue = normalizeSetting(resolvedKey, value);

  if (normalizedValue === undefined) return;

  const spec = getSettingSpec(resolvedKey);

  if (!spec) {
    // Unknown settings default to model-param (pass-through to API).
    buckets.modelParams[resolvedKey] = normalizedValue;
    return;
  }

  if (
    spec.category === 'model-param' &&
    spec.providers &&
    providerName &&
    !spec.providers.includes(providerName)
  ) {
    return;
  }

  switch (spec.category) {
    case 'provider-config':
      break;
    case 'cli-behavior':
      buckets.cliSettings[resolvedKey] = normalizedValue;
      break;
    case 'model-behavior':
      buckets.modelBehavior[resolvedKey] = normalizedValue;
      break;
    case 'model-param':
      buckets.modelParams[resolvedKey] = normalizedValue;
      break;
    case 'custom-header':
      if (typeof normalizedValue === 'string') {
        buckets.customHeaders[resolvedKey] = normalizedValue;
      }
      break;
    default:
      break;
  }
}

export function separateSettings(
  mixed: Record<string, unknown>,
  providerName?: string,
): SeparatedSettings {
  const cliSettings: Record<string, unknown> = {};
  const modelBehavior: Record<string, unknown> = {};
  const modelParams: Record<string, unknown> = {};

  let providerOverrides: Record<string, unknown> = {};
  if (providerName && isPlainObject(mixed[providerName])) {
    providerOverrides = mixed[providerName];
  }

  const customHeaders = extractCustomHeaders(mixed, providerOverrides);
  const mergedProviderSettings = mergeProviderSettings(
    mixed,
    providerOverrides,
  );

  const buckets = { cliSettings, modelBehavior, modelParams, customHeaders };

  for (const [rawKey, value] of Object.entries(mergedProviderSettings)) {
    categorizeSettingEntry(rawKey, value, providerName, buckets);
  }

  return { cliSettings, modelBehavior, modelParams, customHeaders };
}

export function validateSetting(key: string, value: unknown): ValidationResult {
  const resolved = resolveAlias(key);
  const spec = getSettingSpec(resolved);

  if (!spec) {
    // Unknown settings are allowed — they pass through as model-params
    return { success: true, value };
  }

  if (spec.validate) {
    return spec.validate(value);
  }

  // Auto-validate enum types if no custom validator
  if (spec.type === 'enum' && spec.enumValues) {
    const strValue = typeof value === 'string' ? value.toLowerCase() : value;
    if (typeof strValue !== 'string' || !spec.enumValues.includes(strValue)) {
      return {
        success: false,
        message: `${spec.key} must be one of: ${spec.enumValues.join(', ')}`,
      };
    }
    return { success: true, value: strValue };
  }

  // Auto-validate boolean types
  if (spec.type === 'boolean') {
    if (typeof value !== 'boolean') {
      return {
        success: false,
        message: `${spec.key} must be either 'true' or 'false'`,
      };
    }
    return { success: true, value };
  }

  // Auto-validate number types
  if (spec.type === 'number') {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return {
        success: false,
        message: `${spec.key} must be a number`,
      };
    }
    return { success: true, value };
  }

  return { success: true, value };
}

export function parseSetting(key: string, raw: string): unknown {
  const resolved = resolveAlias(key);
  const spec = getSettingSpec(resolved);

  // If spec has a custom parser, use it
  if (spec?.parse) {
    return spec.parse(raw);
  }

  // Only apply type coercion when spec explicitly indicates the type
  // This prevents converting enum/string values like "true" to boolean true
  if (spec?.type === 'number') {
    const num = Number(raw);
    if (!Number.isNaN(num)) {
      return num;
    }
  }

  if (spec?.type === 'boolean') {
    if (raw.toLowerCase() === 'true') {
      return true;
    }
    if (raw.toLowerCase() === 'false') {
      return false;
    }
  }

  // For unknown settings (no spec) or string/enum types, try JSON parse or return raw
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function getProfilePersistableKeys(): string[] {
  return SETTINGS_REGISTRY.filter((s) => s.persistToProfile).map((s) => s.key);
}

export function getSettingHelp(): Record<string, string> {
  const help: Record<string, string> = {};
  for (const spec of SETTINGS_REGISTRY) {
    help[spec.key] = spec.description;
  }
  return help;
}

export function getCompletionOptions(): ReadonlyArray<{
  key: string;
  options?: ReadonlyArray<{ value: string; description?: string }>;
}> {
  return SETTINGS_REGISTRY.filter(
    (s) => s.completionOptions ?? s.enumValues,
  ).map((s) => ({
    key: s.key,
    options: s.completionOptions ?? s.enumValues?.map((v) => ({ value: v })),
  }));
}

export function getAllSettingKeys(): string[] {
  return SETTINGS_REGISTRY.map((s) => s.key);
}

export function getValidationHelp(key: string): string | undefined {
  const resolved = resolveAlias(key);
  const spec = getSettingSpec(resolved);
  if (!spec) {
    return undefined;
  }

  let help = spec.description;

  if (spec.hint) {
    help += ` (${spec.hint})`;
  }

  if (spec.enumValues) {
    help += ` Valid values: ${spec.enumValues.join(', ')}`;
  }

  return help;
}

export function getAutocompleteSuggestions(
  key: string,
): ReadonlyArray<{ value: string; description?: string }> | undefined {
  const resolved = resolveAlias(key);
  const spec = getSettingSpec(resolved);
  if (!spec) {
    return undefined;
  }

  if (spec.completionOptions) {
    return spec.completionOptions;
  }

  if (spec.enumValues) {
    return spec.enumValues.map((v) => ({ value: v }));
  }

  return undefined;
}

function collectProviderConfigKeys(): string[] {
  const keys: string[] = [];
  for (const spec of SETTINGS_REGISTRY) {
    if (spec.category === 'provider-config') {
      keys.push(spec.key);
      if (spec.aliases) {
        keys.push(...spec.aliases);
      }
    }
  }
  return keys;
}

export function getProtectedSettingKeys(): string[] {
  const keys = collectProviderConfigKeys();
  keys.push('provider', 'currentProfile');
  return keys;
}

export function getProviderConfigKeys(): string[] {
  return collectProviderConfigKeys();
}

export interface DirectSettingSpec {
  value: string;
  hint: string;
  description?: string;
  options?: ReadonlyArray<{ value: string; description?: string }>;
}

function deriveHintFromSpec(spec: SettingSpec): string {
  if (spec.hint) {
    return spec.hint;
  }

  if (spec.type === 'boolean') {
    return 'true or false';
  }

  if (spec.type === 'number') {
    return 'number';
  }

  if (spec.type === 'enum' && spec.enumValues) {
    return spec.enumValues.join(', ');
  }

  if (spec.type === 'json') {
    return 'JSON object';
  }

  if (spec.type === 'string-array') {
    return 'comma-separated list';
  }

  return 'value';
}

export function getDirectSettingSpecs(): DirectSettingSpec[] {
  const specs: DirectSettingSpec[] = [];

  for (const spec of SETTINGS_REGISTRY) {
    if (
      spec.category === 'model-param' ||
      spec.category === 'custom-header' ||
      spec.category === 'provider-config'
    ) {
      continue;
    }

    const hint = deriveHintFromSpec(spec);
    const options =
      spec.completionOptions ??
      spec.enumValues?.map((v) => ({ value: v })) ??
      (spec.type === 'boolean'
        ? [{ value: 'true' }, { value: 'false' }]
        : undefined);

    specs.push({
      value: spec.key,
      hint,
      description: spec.description,
      options,
    });
  }

  return specs;
}
