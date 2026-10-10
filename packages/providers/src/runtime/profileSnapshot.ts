/**
 * @plan:PLAN-20260603-ISSUE1584.P12
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-15
 */

import { type ModelProfileInfoPayload } from '@vybestack/llxprt-code-core';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import { coreEvents } from '@vybestack/llxprt-code-core/utils/events.js';
import type { ProfileManager } from '@vybestack/llxprt-code-settings';
import { isLoadBalancerProfile } from '@vybestack/llxprt-code-settings/profiles/types.js';
import {
  getProfilePersistableKeys,
  isInternalSettingKey,
} from '@vybestack/llxprt-code-settings/settings/settingsRegistry.js';
import type {
  Profile,
  ModelParams,
  LoadBalancerProfile,
  SettingsService,
} from '@vybestack/llxprt-code-settings';
import { extractModelParams } from './providerModelParameters.js';
import type { OAuthManager } from '../auth/oauth-manager.js';
import type { ProfileOAuthWork } from '../auth/types.js';
import type { ProfileApplicationResult } from './profileApplication.js';
import type { LoadBalancingProviderConfig } from '../loadBalancing/loadBalancerTypes.js';
import {
  getProfileEphemeralSettings,
  getProfileModel,
  getProfileModelParams,
  getProfileProvider,
} from './profile-application/profileAccessors.js';

type LoadBalancerProfileDetail = {
  name: string;
  provider?: string;
  model?: string;
  contextLimit?: number;
  reasoningEnabled?: boolean;
  temperature?: unknown;
  maxTokens?: unknown;
  modelParams?: Record<string, unknown>;
  loadError?: boolean;
};

type LoadBalancerProfileWithDetails = LoadBalancerProfile & {
  loadBalancerProfileDetails?: LoadBalancerProfileDetail[];
};

function logger(): DebugLogger {
  return new DebugLogger('llxprt:runtime:settings');
}

export interface ProfileSnapshotData {
  readonly providerName: string;
  readonly modelName: string;
  readonly providerSettings: Record<string, unknown>;
  readonly ephemeralSettings: Record<string, unknown>;
  readonly loadBalancerConfig?: Readonly<LoadBalancingProviderConfig>;
}

export const PROFILE_EPHEMERAL_KEYS: readonly string[] =
  getProfilePersistableKeys();

const SENSITIVE_MODEL_PARAM_KEYS: readonly string[] = Object.freeze([
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

function getProfileEphemeralValue(
  ephemeralRecord: Record<string, unknown>,
  key: string,
): unknown {
  return getNestedValue(ephemeralRecord, key);
}

/**
 * Determine whether a profile ephemeral key should be skipped during snapshot
 * collection. Internal settings are always skipped, and lower-precedence auth
 * keys are skipped when a higher-precedence auth source is present.
 */
function isSkippableProfileKey(
  key: string,
  authState: { hasAuthKeyfile: boolean; hasAuthKeyName: boolean },
): boolean {
  if (isInternalSettingKey(key)) {
    return true;
  }
  if (
    key === 'auth-key' &&
    (authState.hasAuthKeyfile || authState.hasAuthKeyName)
  ) {
    return true;
  }
  if (key === 'auth-keyfile' && authState.hasAuthKeyName) {
    return true;
  }
  return false;
}

/**
 * Serializes the ACTIVE LoadBalancingProvider back into a genuine
 * type:'loadbalancer' profile. Saving while a load balancer is active used to
 * snapshot the virtual provider name ('load-balancer') into a STANDARD
 * profile — a corrupt file that could never be re-applied because
 * 'load-balancer' is not a registered provider at load time (issue #2479).
 */
function buildLoadBalancerProfileSnapshot(
  lbConfig: Readonly<LoadBalancingProviderConfig> | undefined,
): LoadBalancerProfile {
  const memberNames = lbConfig?.subProfiles.map((sub) => sub.name) ?? [];

  if (!lbConfig || memberNames.length === 0) {
    throw new Error(
      'Cannot save profile: a load balancer is active but its configuration ' +
        'could not be read. Saving would produce a corrupt profile.',
    );
  }

  // Exhaustive over LoadBalancingProviderConfig['strategy']: adding a new
  // strategy without a profile-policy mapping fails compilation here rather
  // than silently saving as roundrobin.
  const policyByStrategy: Record<
    LoadBalancingProviderConfig['strategy'],
    LoadBalancerProfile['policy']
  > = {
    failover: 'failover',
    'round-robin': 'roundrobin',
  };
  const policy = policyByStrategy[lbConfig.strategy];

  return {
    version: 1,
    type: 'loadbalancer',
    policy,
    profiles: memberNames,
    ...(typeof lbConfig.contextLimit === 'number' && lbConfig.contextLimit > 0
      ? { contextLimit: lbConfig.contextLimit }
      : {}),
    provider: '',
    model: '',
    modelParams: (lbConfig.lbProfileModelParams ??
      {}) as LoadBalancerProfile['modelParams'],
    ephemeralSettings: (lbConfig.lbProfileEphemeralSettings ??
      {}) as LoadBalancerProfile['ephemeralSettings'],
  };
}

export function buildRuntimeProfileSnapshot(
  input: ProfileSnapshotData,
): Profile {
  const { providerName, modelName, providerSettings, ephemeralSettings } =
    input;
  if (providerName === 'load-balancer') {
    return structuredClone(
      buildLoadBalancerProfileSnapshot(input.loadBalancerConfig),
    );
  }
  const snapshot: Record<string, unknown> = {};
  const ephemeralRecord = ephemeralSettings;
  const hasAuthKeyfile =
    ephemeralRecord['auth-keyfile'] !== undefined &&
    ephemeralRecord['auth-keyfile'] !== null;
  const hasAuthKeyName =
    ephemeralRecord['auth-key-name'] !== undefined &&
    ephemeralRecord['auth-key-name'] !== null;

  for (const key of PROFILE_EPHEMERAL_KEYS) {
    if (isSkippableProfileKey(key, { hasAuthKeyfile, hasAuthKeyName })) {
      continue;
    }

    const value = getProfileEphemeralValue(ephemeralRecord, key);
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
    model: modelName,
    modelParams: structuredClone(modelParams),
    ephemeralSettings: structuredClone(
      snapshot,
    ) as Profile['ephemeralSettings'],
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
  settingsService: SettingsService,
  profileName?: string,
): void {
  if (typeof settingsService.setCurrentProfileName === 'function') {
    settingsService.setCurrentProfileName(profileName ?? null);
    return;
  }
  settingsService.set('currentProfile', profileName ?? null);
}

function clearProfileFailoverOnBucketChanges(
  oauthManager: OAuthManager,
  profile: Profile,
): void {
  const authConfig = getProfileAuthConfig(profile);
  const newBuckets = getOAuthBuckets(authConfig);
  const existingBuckets = oauthManager.readFailoverBuckets(profile.provider);
  const bucketsChanged = hasBucketSetChanged(existingBuckets, newBuckets);

  if (
    !bucketsChanged ||
    (existingBuckets.length === 0 && newBuckets.length === 0)
  ) {
    return;
  }

  logger().debug(
    () =>
      `[issue1467] Profile buckets changed for ${profile.provider}: ` +
      `[${existingBuckets.join(', ')}] → [${newBuckets.join(', ')}]. ` +
      'Clearing session bucket and failover handler.',
  );
  oauthManager.clearSessionBucket(profile.provider);
  oauthManager.clearRetryHandlers();
}

async function wireStandardProfileFailover(
  work: ProfileOAuthWork,
  profile: Profile,
  profileName: string | undefined,
  signal: AbortSignal,
): Promise<void> {
  const authConfig = getProfileAuthConfig(profile);
  if (!hasMultiBucketOAuth(authConfig)) {
    return;
  }

  const bucketCount = getOAuthBuckets(authConfig).length;
  await work.getToken({
    providerName: profile.provider,
    profileName,
    buckets: getOAuthBuckets(authConfig),
    signal,
  });
  logger().debug(
    () =>
      `[issue1151] Proactively wired failover handler for ${profile.provider} with ${bucketCount} buckets`,
  );
}

async function loadSubProfileOrNull(
  profileName: string,
  manager: Pick<ProfileManager, 'loadProfile'>,
): Promise<Profile | null> {
  try {
    return await manager.loadProfile(profileName);
  } catch (error) {
    logger().debug(
      () =>
        `[issue1250] Failed to load sub-profile '${profileName}': ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
    return null;
  }
}

async function wireLoadBalancerSubProfile(
  oauthManager: OAuthManager,
  work: ProfileOAuthWork,
  subProfileName: string,
  subProfile: Profile,
  existingBuckets: string[],
  signal: AbortSignal,
): Promise<boolean> {
  const subProfileAuth = getProfileAuthConfig(subProfile);
  if (!hasMultiBucketOAuth(subProfileAuth)) {
    return false;
  }

  const subNewBuckets = getOAuthBuckets(subProfileAuth);
  const subBucketCount = subNewBuckets.length;
  const subBucketsChanged = hasBucketSetChanged(existingBuckets, subNewBuckets);

  if (subBucketsChanged) {
    logger().debug(
      () =>
        `[issue1467] Sub-profile '${subProfileName}' buckets changed for ${subProfile.provider}: ` +
        `[${existingBuckets.join(', ')}] → [${subNewBuckets.join(', ')}]. ` +
        'Clearing session bucket.',
    );
    oauthManager.clearSessionBucket(subProfile.provider);
  }

  await work.getToken({
    providerName: subProfile.provider,
    profileName: subProfileName,
    buckets: subNewBuckets,
    signal,
  });
  logger().debug(
    () =>
      `[issue1250] Proactively wired failover handler for sub-profile '${subProfileName}' (${subProfile.provider}) with ${subBucketCount} buckets`,
  );

  return subBucketsChanged;
}

async function prepareLoadBalancerFailover(
  oauthManager: OAuthManager,
  work: ProfileOAuthWork,
  profile: LoadBalancerProfile,
  manager: Pick<ProfileManager, 'loadProfile'>,
  signal: AbortSignal,
): Promise<() => Promise<void>> {
  const subProfileNames: string[] = Array.isArray(profile.profiles)
    ? profile.profiles
    : [];
  logger().debug(
    () =>
      `[issue1250] LoadBalancer profile detected with ${subProfileNames.length} sub-profile(s)`,
  );

  const existingBuckets = oauthManager.readFailoverBuckets(profile.provider);
  const subProfiles: Array<{ name: string; profile: Profile }> = [];
  for (const name of subProfileNames) {
    const subProfile = await loadSubProfileOrNull(name, manager);
    if (subProfile) subProfiles.push({ name, profile: subProfile });
  }
  return async () => {
    const results = await Promise.allSettled(
      subProfiles.map((subProfile) =>
        wireLoadBalancerSubProfile(
          oauthManager,
          work,
          subProfile.name,
          subProfile.profile,
          existingBuckets,
          signal,
        ),
      ),
    );
    const shouldClearHandler = results.some(
      (result) => result.status === 'fulfilled' && result.value,
    );
    if (shouldClearHandler && !signal.aborted)
      oauthManager.clearRetryHandlers();
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length > 0)
      throw new AggregateError(failures, 'Profile OAuth warmup failed');
  };
}

function buildProfileLoadResult(
  profileName: string | undefined,
  applicationResult: ProfileApplicationResult,
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

export interface ModelProfileInfoInput {
  model: string;
  providerName?: string;
  profileName?: string | null;
  /**
   * Explicit human-readable display name. When supplied and non-empty, takes
   * precedence over profileName and model for the computed displayLabel.
   */
  displayName?: string;
}

export function buildModelProfileInfoPayload(
  input: ModelProfileInfoInput,
): ModelProfileInfoPayload {
  const profileName = input.profileName ?? null;
  const hasProfile = typeof profileName === 'string' && profileName !== '';
  const trimmedDisplayName = input.displayName?.trim();
  const hasDisplayName =
    typeof trimmedDisplayName === 'string' && trimmedDisplayName !== '';
  const profileLabel = hasProfile ? profileName : undefined;
  const displayLabel = hasDisplayName
    ? trimmedDisplayName
    : (profileLabel ?? input.model);
  return {
    model: input.model,
    providerName: input.providerName,
    profileName,
    ...(hasDisplayName ? { displayName: trimmedDisplayName } : {}),
    displayLabel,
  };
}

export async function finishProfileApplication(
  profile: Profile,
  options: ProfileLoadOptions,
  applicationResult: ProfileApplicationResult,
  settingsService: SettingsService,
  oauthManager: OAuthManager | null,
  profileManager: Pick<ProfileManager, 'loadProfile'>,
  signal: AbortSignal = new AbortController().signal,
): Promise<{
  result: ProfileLoadResult;
  commit: () => Promise<void>;
  publish: () => void;
  cancelAndJoin: () => Promise<void>;
}> {
  const work = oauthManager?.createProfileOAuthWork(signal);
  const commitRenewals = work
    ? await work.prepareRenewals(profile, (name) =>
        profileManager.loadProfile(name),
      )
    : () => {};
  const commitLoadBalancerFailover =
    oauthManager !== null && work && isLoadBalancerProfile(profile)
      ? await prepareLoadBalancerFailover(
          oauthManager,
          work,
          profile,
          profileManager,
          signal,
        )
      : () => {};
  setCurrentProfileName(settingsService, options.profileName);
  const result = buildProfileLoadResult(options.profileName, applicationResult);
  return {
    result,
    cancelAndJoin: () => work?.cancelAndJoin() ?? Promise.resolve(),
    commit: async () => {
      commitRenewals();
      if (oauthManager !== null && work) {
        clearProfileFailoverOnBucketChanges(oauthManager, profile);
        const results = await Promise.allSettled([
          wireStandardProfileFailover(
            work,
            profile,
            options.profileName,
            signal,
          ),
          commitLoadBalancerFailover(),
        ]);
        const failures = results.flatMap((result) =>
          result.status === 'rejected' ? [result.reason] : [],
        );
        if (failures.length > 0)
          throw new AggregateError(failures, 'Profile OAuth commit failed');
      }
    },
    publish: () =>
      coreEvents.emitModelProfileChanged(
        buildModelProfileInfoPayload({
          model: result.modelName,
          providerName: result.providerName,
          profileName: result.profileName,
        }),
      ),
  };
}

export async function saveProfileSnapshot(
  profileName: string,
  snapshot: Profile,
  additionalConfig: Partial<Profile> | undefined,
  manager: Pick<ProfileManager, 'saveProfile'>,
): Promise<Profile> {
  let finalProfile: Profile = snapshot;
  if (additionalConfig) {
    finalProfile = { ...snapshot, ...additionalConfig } as Profile;
  }

  // Defense in depth for issue #2479: never persist the virtual
  // 'load-balancer' provider name as a standard profile. Such a file can
  // never be re-applied ('load-balancer' is not a registered provider at
  // load time) and previously produced dead sessions via silent fallback.
  if (
    !isLoadBalancerProfile(finalProfile) &&
    finalProfile.provider === 'load-balancer'
  ) {
    throw new Error(
      `Cannot save profile '${profileName}': the active provider is a ` +
        'load balancer but the snapshot is not a valid loadbalancer profile. ' +
        'Saving would produce a corrupt profile.',
    );
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
  manager: Pick<ProfileManager, 'saveProfile'>,
): Promise<void> {
  await manager.saveProfile(profileName, profile);
}

export async function deleteProfileByName(
  profileName: string,
  settingsService: Pick<
    SettingsService,
    'getCurrentProfileName' | 'setCurrentProfileName'
  >,
  manager: Pick<ProfileManager, 'deleteProfile'>,
): Promise<void> {
  await manager.deleteProfile(profileName);
  if (settingsService.getCurrentProfileName() === profileName) {
    settingsService.setCurrentProfileName(null);
  }
}
async function resolveLoadBalancerProfileDetail(
  memberName: string,
  manager: Pick<ProfileManager, 'loadProfile'>,
): Promise<LoadBalancerProfileDetail> {
  try {
    const memberProfile = await manager.loadProfile(memberName);
    if (isLoadBalancerProfile(memberProfile)) {
      return { name: memberName, loadError: true };
    }

    const ephemerals = getProfileEphemeralSettings(memberProfile);
    const modelParams = getProfileModelParams(memberProfile);
    return {
      name: memberName,
      provider: getProfileProvider(memberProfile),
      model: getProfileModel(memberProfile),
      contextLimit:
        typeof ephemerals['context-limit'] === 'number'
          ? ephemerals['context-limit']
          : undefined,
      reasoningEnabled:
        typeof ephemerals['reasoning.enabled'] === 'boolean'
          ? ephemerals['reasoning.enabled']
          : undefined,
      temperature: modelParams.temperature,
      maxTokens: modelParams.max_tokens,
      ...(Object.keys(modelParams).length > 0 && { modelParams }),
    };
  } catch {
    return { name: memberName, loadError: true };
  }
}

async function addLoadBalancerProfileDetails(
  profile: LoadBalancerProfile,
  manager: Pick<ProfileManager, 'loadProfile'>,
): Promise<LoadBalancerProfileWithDetails> {
  const details = await Promise.all(
    profile.profiles.map((memberName) =>
      resolveLoadBalancerProfileDetail(memberName, manager),
    ),
  );

  return {
    ...profile,
    loadBalancerProfileDetails: details,
  };
}

export async function listSavedProfiles(
  manager: Pick<ProfileManager, 'listProfiles'>,
): Promise<string[]> {
  return manager.listProfiles();
}

export async function getProfileByName(
  profileName: string,
  manager: Pick<ProfileManager, 'loadProfile'>,
): Promise<Profile> {
  const profile = await manager.loadProfile(profileName);
  if (!isLoadBalancerProfile(profile)) {
    return profile;
  }

  return addLoadBalancerProfileDetails(profile, manager);
}
