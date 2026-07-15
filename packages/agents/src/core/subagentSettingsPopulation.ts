/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  isInternalSettingKey,
  type Profile,
} from '@vybestack/llxprt-code-settings';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { debugLogger } from '@vybestack/llxprt-code-core/utils/debugLogger.js';
import type { ReadonlySettingsSnapshot } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import { canonicalizeToolName, INVALID_TOOL_NAME } from './toolGovernance.js';
import {
  expandTilde,
  getNumberSetting,
  getStringArraySetting,
  getStringSetting,
} from './subagentSettingsAccess.js';

const AUTH_EPHEMERAL_KEYS = [
  'auth-key',
  'auth-keyfile',
  'auth-key-name',
] as const;
const PROVIDER_EPHEMERAL_KEYS = [
  'base-url',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_CLOUD_LOCATION',
] as const;
const MODEL_EPHEMERAL_KEYS = ['context-limit'] as const;
const COMPRESSION_EPHEMERAL_KEYS = [
  'compression-threshold',
  'compression-preserve-threshold',
] as const;
const TOOL_GOVERNANCE_EPHEMERAL_KEYS = [
  'tool-format',
  'tools.allowed',
  'tools_allowed',
  'tools.disabled',
  'disabled-tools',
] as const;
const MISC_EPHEMERAL_KEYS = ['user-agent'] as const;

/**
 * Ephemeral keys that are applied through dedicated, provider-scoped or
 * transformed paths. Keep the category constants above next to their matching
 * populate* function so new specialized keys do not accidentally fall through to
 * populateGeneralEphemerals and clobber transformed handling.
 */
const SPECIALLY_HANDLED_EPHEMERAL_KEYS: ReadonlySet<string> = new Set([
  ...AUTH_EPHEMERAL_KEYS,
  ...PROVIDER_EPHEMERAL_KEYS,
  ...MODEL_EPHEMERAL_KEYS,
  ...COMPRESSION_EPHEMERAL_KEYS,
  ...TOOL_GOVERNANCE_EPHEMERAL_KEYS,
  ...MISC_EPHEMERAL_KEYS,
]);

const isValidCanonicalToolName = (tool: string): boolean =>
  tool !== INVALID_TOOL_NAME;

export const normalizeDefaultToolSet = (
  tools: readonly string[],
): Set<string> => new Set(normalizeToolArray([...tools]) ?? []);

function normalizeToolArray(tools: string[] | undefined): string[] | undefined {
  if (!Array.isArray(tools)) {
    return undefined;
  }
  const normalized = tools
    .map((tool) => canonicalizeToolName(tool))
    .filter(isValidCanonicalToolName);
  // Treat an empty or fully-invalid list as absent so callers can preserve
  // existing SettingsService defaults instead of writing a misleading empty key.
  return normalized.length > 0 ? normalized : undefined;
}

function mergeDefaultDisabledTools(
  disabled: string[] | undefined,
  allowed: string[] | undefined,
  defaultDisabledTools: ReadonlySet<string>,
): string[] | undefined {
  const disabledSource = normalizeToolArray(disabled) ?? [];
  const allowedSet = new Set(allowed ?? []);

  const merged: string[] = [];
  const seen = new Set<string>();
  const addCanonicalTool = (canonical: string, respectAllowed: boolean) => {
    if (
      !isValidCanonicalToolName(canonical) ||
      seen.has(canonical) ||
      (respectAllowed && allowedSet.has(canonical))
    ) {
      return;
    }
    seen.add(canonical);
    merged.push(canonical);
  };

  // Explicit profile-disabled tools are authoritative, even if the same profile
  // also lists them as allowed; only inherited defaults yield to allowlists.
  for (const canonicalTool of disabledSource) {
    addCanonicalTool(canonicalTool, false);
  }

  for (const canonicalTool of defaultDisabledTools) {
    addCanonicalTool(canonicalTool, true);
  }

  return merged.length > 0 ? merged : undefined;
}

function resolveToolGovernance(
  profile: Profile,
  defaultDisabledTools: ReadonlySet<string>,
): { allowed: string[] | undefined; disabled: string[] | undefined } {
  const allowed = normalizeToolArray(
    getStringArraySetting(profile.ephemeralSettings, [
      'tools.allowed',
      'tools_allowed',
    ]),
  );
  const disabled = mergeDefaultDisabledTools(
    getStringArraySetting(profile.ephemeralSettings, [
      'tools.disabled',
      'disabled-tools',
    ]),
    allowed,
    defaultDisabledTools,
  );

  return { allowed, disabled };
}

export function createSettingsSnapshot(
  profile: Profile,
  defaultDisabledTools: ReadonlySet<string>,
): ReadonlySettingsSnapshot {
  const { allowed, disabled } = resolveToolGovernance(
    profile,
    defaultDisabledTools,
  );

  return {
    compressionThreshold: getNumberSetting(profile.ephemeralSettings, [
      'compression-threshold',
    ]),
    contextLimit: getNumberSetting(profile.ephemeralSettings, [
      'context-limit',
    ]),
    preserveThreshold: getNumberSetting(profile.ephemeralSettings, [
      'compression-preserve-threshold',
    ]),
    toolFormatOverride: getStringSetting(profile.ephemeralSettings, [
      'tool-format',
    ]),
    tools: {
      allowed,
      disabled,
    },
  };
}

function populateProviderSettings(
  service: SettingsService,
  provider: string,
  profile: Profile,
): void {
  const modelParams = profile.modelParams;
  const temperature = modelParams.temperature;
  if (typeof temperature === 'number' && Number.isFinite(temperature)) {
    service.set(`providers.${provider}.temperature`, temperature);
  }

  const maxTokens = modelParams.max_tokens;
  if (typeof maxTokens === 'number' && Number.isFinite(maxTokens)) {
    service.set(`providers.${provider}.maxTokens`, maxTokens);
  }

  const baseUrl = getStringSetting(profile.ephemeralSettings, ['base-url']);
  if (baseUrl) {
    service.set(`providers.${provider}.base-url`, baseUrl);
  }
  // Subagent runtimes use a fresh SettingsService; writing an explicit
  // undefined provider base URL would mask provider defaults.
}

function isMissingAuthValue(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function tryLoadApiKeyFromKeyfile(
  provider: string,
  expandedKeyfile: string,
  service: SettingsService,
): void {
  const resolvedPath = path.resolve(expandedKeyfile);
  try {
    // This stays synchronous because subagent settings population runs inside a
    // synchronous runtime-initialization path; main provider activation uses the
    // same warning/fallback keyfile semantics before this isolated settings copy
    // is built.
    const content = fs.readFileSync(resolvedPath, 'utf8').trim();
    if (content !== '') {
      service.set('auth-key', content);
      service.set(`providers.${provider}.auth-key`, content);
    } else {
      debugLogger.warn(
        `SubagentOrchestrator: auth key file '${resolvedPath}' is empty`,
      );
    }
  } catch (error) {
    debugLogger.warn(
      `SubagentOrchestrator: unable to read auth key file '${resolvedPath}': ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function populateAuthSettings(
  service: SettingsService,
  provider: string,
  profile: Profile,
): void {
  const authKey = getStringSetting(profile.ephemeralSettings, ['auth-key']);
  const hasProfileAuthKey = !isMissingAuthValue(authKey);
  if (hasProfileAuthKey) {
    service.set('auth-key', authKey);
    service.set(`providers.${provider}.auth-key`, authKey);
  }
  const authKeyName = getStringSetting(profile.ephemeralSettings, [
    'auth-key-name',
  ]);
  if (authKeyName) {
    service.set('auth-key-name', authKeyName);
    service.set(`providers.${provider}.auth-key-name`, authKeyName);
  }

  const authKeyfile = getStringSetting(profile.ephemeralSettings, [
    'auth-keyfile',
  ]);
  if (authKeyfile) {
    const expandedKeyfile = expandTilde(authKeyfile);
    service.set('auth-keyfile', expandedKeyfile);
    service.set(`providers.${provider}.auth-keyfile`, expandedKeyfile);
    // Keep the keyfile reference available even when the local file cannot be
    // read; downstream auth resolution follows the same warning/fallback model
    // used by profile activation instead of failing subagent startup here.
    if (!hasProfileAuthKey) {
      tryLoadApiKeyFromKeyfile(provider, expandedKeyfile, service);
    }
  }
}

function populateCompressionSettings(
  service: SettingsService,
  profile: Profile,
): void {
  const contextLimit = getNumberSetting(profile.ephemeralSettings, [
    'context-limit',
  ]);
  if (contextLimit !== undefined) {
    service.set('context-limit', contextLimit);
  }

  const compressionThreshold = getNumberSetting(profile.ephemeralSettings, [
    'compression-threshold',
  ]);
  if (compressionThreshold !== undefined) {
    service.set('compression-threshold', compressionThreshold);
  }

  const preserveThreshold = getNumberSetting(profile.ephemeralSettings, [
    'compression-preserve-threshold',
  ]);
  if (preserveThreshold !== undefined) {
    service.set('compression-preserve-threshold', preserveThreshold);
  }
}

function populateToolAndMiscSettings(
  service: SettingsService,
  profile: Profile,
  defaultDisabledTools: ReadonlySet<string>,
): void {
  const toolFormat = getStringSetting(profile.ephemeralSettings, [
    'tool-format',
  ]);
  if (toolFormat) {
    service.set('tool-format-override', toolFormat);
  }

  const { allowed, disabled } = resolveToolGovernance(
    profile,
    defaultDisabledTools,
  );
  if (allowed) {
    service.set('tools.allowed', allowed);
  }

  if (disabled) {
    service.set('tools.disabled', disabled);
  }

  const userAgent = getStringSetting(profile.ephemeralSettings, ['user-agent']);
  if (userAgent) {
    service.set('user-agent', userAgent);
  }
}

function populateGcpSettings(service: SettingsService, profile: Profile): void {
  const gcpProject = getStringSetting(profile.ephemeralSettings, [
    'GOOGLE_CLOUD_PROJECT',
  ]);
  if (gcpProject) {
    service.set('GOOGLE_CLOUD_PROJECT', gcpProject);
  }

  const gcpLocation = getStringSetting(profile.ephemeralSettings, [
    'GOOGLE_CLOUD_LOCATION',
  ]);
  if (gcpLocation) {
    service.set('GOOGLE_CLOUD_LOCATION', gcpLocation);
  }
}

function cloneEphemeralValue(key: string, value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  try {
    return structuredClone(value);
  } catch (error) {
    debugLogger.warn(
      `SubagentOrchestrator: skipping non-cloneable ephemeral setting '${key}': ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return undefined;
  }
}

function populateGeneralEphemerals(
  service: SettingsService,
  profile: Profile,
): void {
  const ephemerals = profile.ephemeralSettings as
    | Record<string, unknown>
    | null
    | undefined;
  if (ephemerals === null || ephemerals === undefined) {
    return;
  }
  for (const [key, value] of Object.entries(ephemerals)) {
    if (
      !SPECIALLY_HANDLED_EPHEMERAL_KEYS.has(key) &&
      !isInternalSettingKey(key) &&
      value !== null &&
      value !== undefined
    ) {
      const clonedValue = cloneEphemeralValue(key, value);
      if (clonedValue !== undefined) {
        service.set(key, clonedValue);
      }
    }
  }
}

export function populatePreActivationSettings(
  service: SettingsService,
  profile: Profile,
  profileName: string,
): void {
  const provider = profile.provider;
  service.setCurrentProfileName(profileName);
  service.set('activeProvider', provider);
  service.set(`providers.${provider}.model`, profile.model);
  populateProviderSettings(service, provider, profile);
  populateAuthSettings(service, provider, profile);
}

export function populatePostActivationSettings(
  service: SettingsService,
  profile: Profile,
  profileName: string,
  defaultDisabledTools: ReadonlySet<string>,
): void {
  service.setCurrentProfileName(profileName);
  populateGeneralEphemerals(service, profile);
  populateGcpSettings(service, profile);
  populateCompressionSettings(service, profile);
  populateToolAndMiscSettings(service, profile, defaultDisabledTools);
}
