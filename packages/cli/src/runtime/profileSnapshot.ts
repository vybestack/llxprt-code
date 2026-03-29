/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type Profile,
  type ModelParams,
  type LoadBalancerProfile,
  ProfileManager,
  DebugLogger,
  getProfilePersistableKeys,
  resolveAlias,
  isLoadBalancerProfile,
} from '@vybestack/llxprt-code-core';
import {
  getCliRuntimeServices,
  getCliOAuthManager,
  getActiveModelName,
  getActiveModelParams,
  _internal as runtimeAccessorsInternal,
} from './runtimeAccessors.js';
import { applyProfileWithGuards } from './profileApplication.js';

const logger = new DebugLogger('llxprt:runtime:settings');
const {
  resolveActiveProviderName,
  getProviderSettingsSnapshot,
  extractModelParams,
} = runtimeAccessorsInternal;

export const PROFILE_EPHEMERAL_KEYS: readonly string[] =
  getProfilePersistableKeys();

const SENSITIVE_MODEL_PARAM_KEYS = new Set([
  'auth-key',
  'authKey',
  'auth-keyfile',
  'authKeyfile',
  'apiKey',
  'api-key',
  'apiKeyfile',
  'api-keyfile',
  'base-url',
]);

function stripSensitiveModelParams<T extends Record<string, unknown>>(
  params: T,
): T {
  for (const key of SENSITIVE_MODEL_PARAM_KEYS) {
    if (key in params) {
      delete params[key as keyof T];
    }
  }
  return params;
}

function getNestedValue(
  obj: Record<string, unknown>,
  keyPath: string,
): unknown {
  if (keyPath in obj) {
    return obj[keyPath];
  }

  const parts = keyPath.split('.');
  if (parts.length === 1) {
    return undefined;
  }

  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function buildRuntimeProfileSnapshot(): Profile {
  const { config, settingsService, providerManager } = getCliRuntimeServices();
  const providerName =
    resolveActiveProviderName(settingsService, config) ??
    providerManager.getActiveProviderName() ??
    config.getProvider() ??
    'openai';
  const providerSettings = getProviderSettingsSnapshot(
    settingsService,
    providerName,
  );
  const currentModel =
    (providerSettings.model as string | undefined) ??
    config.getModel() ??
    providerManager.getProviderByName(providerName)?.getDefaultModel?.() ??
    'unknown';

  const ephemeralSettings = config.getEphemeralSettings();
  const snapshot: Record<string, unknown> = {};
  const ephemeralRecord = ephemeralSettings;
  const hasAuthKeyfile =
    ephemeralRecord['auth-keyfile'] !== undefined &&
    ephemeralRecord['auth-keyfile'] !== null;
  const hasAuthKeyName =
    ephemeralRecord['auth-key-name'] !== undefined &&
    ephemeralRecord['auth-key-name'] !== null;

  for (const key of PROFILE_EPHEMERAL_KEYS) {
    if (key === 'auth-key' && (hasAuthKeyfile || hasAuthKeyName)) {
      continue;
    }
    if (key === 'auth-keyfile' && hasAuthKeyName) {
      continue;
    }

    let value = getNestedValue(ephemeralRecord, key);
    if (value === undefined) {
      for (const [aliasKey, aliasValue] of Object.entries(ephemeralRecord)) {
        if (aliasValue !== undefined && resolveAlias(aliasKey) === key) {
          value = aliasValue;
          break;
        }
      }
    }
    if (value !== undefined) {
      snapshot[key] = value;
    }
  }

  if (snapshot['GOOGLE_CLOUD_PROJECT'] === undefined) {
    const project = process.env.GOOGLE_CLOUD_PROJECT;
    if (typeof project === 'string' && project.trim().length > 0) {
      snapshot['GOOGLE_CLOUD_PROJECT'] = project;
    }
  }

  if (snapshot['GOOGLE_CLOUD_LOCATION'] === undefined) {
    const location = process.env.GOOGLE_CLOUD_LOCATION;
    if (typeof location === 'string' && location.trim().length > 0) {
      snapshot['GOOGLE_CLOUD_LOCATION'] = location;
    }
  }

  const modelParams = stripSensitiveModelParams(
    extractModelParams(providerSettings) as ModelParams,
  );

  return {
    version: 1,
    provider: providerName,
    model: currentModel,
    modelParams,
    ephemeralSettings: snapshot as Profile['ephemeralSettings'],
  };
}

export interface ProfileLoadOptions {
  profileName?: string;
}

export interface ProfileLoadResult {
  profileName?: string;
  providerName: string;
  modelName: string;
  infoMessages: string[];
  warnings: string[];
  providerChanged: boolean;
  baseUrl?: string;
  didFallback: boolean;
  requestedProvider: string | null;
}

export interface RuntimeDiagnosticsSnapshot {
  providerName: string | null;
  modelName: string | null;
  profileName: string | null;
  modelParams: Record<string, unknown>;
  ephemeralSettings: Record<string, unknown>;
}

type CliRuntimeConfig = ReturnType<typeof getCliRuntimeServices>['config'];
type CliSettingsService = ReturnType<
  typeof getCliRuntimeServices
>['settingsService'];
type CliOAuthManager = NonNullable<ReturnType<typeof getCliOAuthManager>>;

type ProfileAuthConfig = {
  type?: string;
  buckets?: string[];
};

function getProfileAuthConfig(profile: Profile): ProfileAuthConfig | undefined {
  return (profile as { auth?: ProfileAuthConfig }).auth;
}

function hasBucketSetChanged(
  existingBuckets: string[],
  nextBuckets: string[],
): boolean {
  return (
    existingBuckets.length !== nextBuckets.length ||
    !existingBuckets.every((bucket, index) => bucket === nextBuckets[index])
  );
}

function getFailoverBuckets(config: CliRuntimeConfig): string[] {
  const handler = config.getBucketFailoverHandler?.();
  return handler?.getBuckets?.() ?? [];
}

function getOAuthBuckets(authConfig: ProfileAuthConfig | undefined): string[] {
  return authConfig?.type === 'oauth' && Array.isArray(authConfig.buckets)
    ? authConfig.buckets
    : [];
}

function hasMultiBucketOAuth(
  authConfig: ProfileAuthConfig | undefined,
): boolean {
  return getOAuthBuckets(authConfig).length > 1;
}

function setCurrentProfileName(
  settingsService: CliSettingsService,
  profileName?: string,
): void {
  if (typeof settingsService.setCurrentProfileName === 'function') {
    settingsService.setCurrentProfileName(profileName ?? null);
    return;
  }
  settingsService.set('currentProfile', profileName ?? null);
}

function scheduleProactiveRenewals(
  oauthManager: CliOAuthManager,
  profile: Profile,
): void {
  void oauthManager
    .configureProactiveRenewalsForProfile(profile)
    .catch((error) => {
      logger.debug(
        () =>
          `[cli-runtime] Failed to configure proactive OAuth renewals: ${
            error instanceof Error ? error.message : String(error)
          }`,
      );
    });
}

function clearProfileFailoverOnBucketChanges(
  oauthManager: CliOAuthManager,
  config: CliRuntimeConfig,
  profile: Profile,
): void {
  const authConfig = getProfileAuthConfig(profile);
  const newBuckets = getOAuthBuckets(authConfig);
  const existingBuckets = getFailoverBuckets(config);
  const bucketsChanged = hasBucketSetChanged(existingBuckets, newBuckets);

  if (
    !bucketsChanged ||
    (existingBuckets.length === 0 && newBuckets.length === 0)
  ) {
    return;
  }

  logger.debug(
    () =>
      `[issue1467] Profile buckets changed for ${profile.provider}: ` +
      `[${existingBuckets.join(', ')}] → [${newBuckets.join(', ')}]. ` +
      'Clearing session bucket and failover handler.',
  );
  oauthManager.clearSessionBucket(profile.provider);
  config.setBucketFailoverHandler?.(undefined);
}

function wireStandardProfileFailover(
  oauthManager: CliOAuthManager,
  profile: Profile,
): void {
  const authConfig = getProfileAuthConfig(profile);
  if (!hasMultiBucketOAuth(authConfig)) {
    return;
  }

  const bucketCount = getOAuthBuckets(authConfig).length;
  void oauthManager.getOAuthToken(profile.provider).catch((error) => {
    logger.debug(
      () =>
        `[issue1151] Failed to proactively wire failover handler: ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
  });
  logger.debug(
    () =>
      `[issue1151] Proactively wired failover handler for ${profile.provider} with ${bucketCount} buckets`,
  );
}

async function loadSubProfileOrNull(
  profileName: string,
  manager: ProfileManager,
): Promise<Profile | null> {
  try {
    return await manager.loadProfile(profileName);
  } catch (error) {
    logger.debug(
      () =>
        `[issue1250] Failed to load sub-profile '${profileName}': ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
    return null;
  }
}

function wireLoadBalancerSubProfile(
  oauthManager: CliOAuthManager,
  subProfileName: string,
  subProfile: Profile,
  existingBuckets: string[],
): boolean {
  const subProfileAuth = getProfileAuthConfig(subProfile);
  if (!hasMultiBucketOAuth(subProfileAuth)) {
    return false;
  }

  const subNewBuckets = getOAuthBuckets(subProfileAuth);
  const subBucketCount = subNewBuckets.length;
  const subBucketsChanged = hasBucketSetChanged(existingBuckets, subNewBuckets);

  if (subBucketsChanged) {
    logger.debug(
      () =>
        `[issue1467] Sub-profile '${subProfileName}' buckets changed for ${subProfile.provider}: ` +
        `[${existingBuckets.join(', ')}] → [${subNewBuckets.join(', ')}]. ` +
        'Clearing session bucket.',
    );
    oauthManager.clearSessionBucket(subProfile.provider);
  }

  void oauthManager.getOAuthToken(subProfile.provider).catch((error) => {
    logger.debug(
      () =>
        `[issue1250] Failed to proactively wire failover handler for sub-profile '${subProfileName}': ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
  });
  logger.debug(
    () =>
      `[issue1250] Proactively wired failover handler for sub-profile '${subProfileName}' (${subProfile.provider}) with ${subBucketCount} buckets`,
  );

  return subBucketsChanged;
}

async function wireLoadBalancerFailover(
  oauthManager: CliOAuthManager,
  config: CliRuntimeConfig,
  profile: LoadBalancerProfile,
): Promise<void> {
  const subProfileNames = profile.profiles || [];
  logger.debug(
    () =>
      `[issue1250] LoadBalancer profile detected with ${subProfileNames.length} sub-profile(s)`,
  );

  const existingBuckets = getFailoverBuckets(config);
  const manager = new ProfileManager();
  let shouldClearHandler = false;

  for (const subProfileName of subProfileNames) {
    const subProfile = await loadSubProfileOrNull(subProfileName, manager);
    if (subProfile == null) {
      continue;
    }
    shouldClearHandler =
      wireLoadBalancerSubProfile(
        oauthManager,
        subProfileName,
        subProfile,
        existingBuckets,
      ) || shouldClearHandler;
  }

  if (!shouldClearHandler) {
    return;
  }

  logger.debug(
    () =>
      '[issue1467] Clearing failover handler after LB sub-profile bucket changes',
  );
  config.setBucketFailoverHandler?.(undefined);
}

function buildProfileLoadResult(
  profileName: string | undefined,
  applicationResult: Awaited<ReturnType<typeof applyProfileWithGuards>>,
): ProfileLoadResult {
  return {
    profileName,
    providerName: applicationResult.providerName,
    modelName: applicationResult.modelName,
    infoMessages: applicationResult.infoMessages,
    warnings: applicationResult.warnings,
    providerChanged: applicationResult.providerChanged,
    baseUrl: applicationResult.baseUrl,
    didFallback: applicationResult.didFallback,
    requestedProvider: applicationResult.requestedProvider,
  };
}

export async function applyProfileSnapshot(
  profile: Profile,
  options: ProfileLoadOptions = {},
): Promise<ProfileLoadResult> {
  const { settingsService, config } = getCliRuntimeServices();
  const applicationResult = await applyProfileWithGuards(profile, options);

  setCurrentProfileName(settingsService, options.profileName);

  const oauthManager = getCliOAuthManager();
  if (oauthManager != null) {
    scheduleProactiveRenewals(oauthManager, profile);
    clearProfileFailoverOnBucketChanges(oauthManager, config, profile);
    wireStandardProfileFailover(oauthManager, profile);
    if (isLoadBalancerProfile(profile)) {
      await wireLoadBalancerFailover(oauthManager, config, profile);
    }
  }

  return buildProfileLoadResult(options.profileName, applicationResult);
}

export async function saveProfileSnapshot(
  profileName: string,
  additionalConfig?: Partial<Profile>,
): Promise<Profile> {
  const manager = new ProfileManager();
  const snapshot = buildRuntimeProfileSnapshot();

  let finalProfile: Profile = snapshot;
  if (additionalConfig != null) {
    finalProfile = { ...snapshot, ...additionalConfig } as Profile;
  }

  await manager.saveProfile(profileName, finalProfile);
  return finalProfile;
}

/**
 * @deprecated This function saves old-style load balancer profiles (type='loadbalancer').
 * The old architecture did round-robin at profile-load time (selecting a profile once).
 * Use the new subProfiles architecture instead which does per-request load balancing.
 * This function is kept for backward compatibility only.
 */
export async function saveLoadBalancerProfile(
  profileName: string,
  profile: LoadBalancerProfile,
): Promise<void> {
  const manager = new ProfileManager();
  await manager.saveLoadBalancerProfile(profileName, profile);
}

export async function loadProfileByName(
  profileName: string,
): Promise<ProfileLoadResult> {
  const manager = new ProfileManager();
  const profile = await manager.loadProfile(profileName);
  return applyProfileSnapshot(profile, { profileName });
}

export async function deleteProfileByName(profileName: string): Promise<void> {
  const manager = new ProfileManager();
  await manager.deleteProfile(profileName);
  const { settingsService } = getCliRuntimeServices();
  const currentProfile =
    typeof settingsService.getCurrentProfileName === 'function'
      ? settingsService.getCurrentProfileName()
      : (settingsService.get('currentProfile') as string | null);
  if (currentProfile === profileName) {
    if (typeof settingsService.setCurrentProfileName === 'function') {
      settingsService.setCurrentProfileName(null);
    } else {
      settingsService.set('currentProfile', null);
    }
  }
}

export async function listSavedProfiles(): Promise<string[]> {
  const manager = new ProfileManager();
  return manager.listProfiles();
}

export async function getProfileByName(profileName: string): Promise<Profile> {
  const manager = new ProfileManager();
  return manager.loadProfile(profileName);
}

export function getActiveProfileName(): string | null {
  const { settingsService } = getCliRuntimeServices();
  if (typeof settingsService.getCurrentProfileName === 'function') {
    return settingsService.getCurrentProfileName();
  }
  return (settingsService.get('currentProfile') as string | null) ?? null;
}

export function setDefaultProfileName(profileName: string | null): void {
  const { settingsService } = getCliRuntimeServices();
  settingsService.set('defaultProfile', profileName ?? undefined);
}

export function getRuntimeDiagnosticsSnapshot(): RuntimeDiagnosticsSnapshot {
  const { config, settingsService, providerManager } = getCliRuntimeServices();

  const providerName =
    resolveActiveProviderName(settingsService, config) ??
    providerManager.getActiveProviderName() ??
    null;
  const modelValue = getActiveModelName();
  const modelName =
    modelValue && modelValue.trim() !== ''
      ? modelValue
      : (config.getModel() ?? null);

  const profileName = getActiveProfileName();

  const modelParams = getActiveModelParams();
  const ephemeralSettings = config.getEphemeralSettings();

  return {
    providerName,
    modelName,
    profileName,
    modelParams,
    ephemeralSettings,
  };
}
