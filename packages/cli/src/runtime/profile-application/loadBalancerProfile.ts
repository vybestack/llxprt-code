import {
  LoadBalancingProvider,
  type LoadBalancerProfile,
  type LoadBalancingProviderConfig,
  type LoadBalancerSubProfile,
  type Profile,
  ProfileManager,
  type ResolvedSubProfile,
  isLoadBalancerProfile,
} from '@vybestack/llxprt-code-core';
import * as fs from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { getCliRuntimeServices } from '../runtimeSettings.js';
import {
  getProfileEphemeralSettings,
  getProfileModel,
  getProfileModelParams,
  getProfileProvider,
  getStringValue,
} from './profileAccessors.js';

interface LoadBalancerResolutionDeps {
  lbName: string;
  profileManagerInstance: {
    loadProfile: (profileName: string) => Promise<Profile>;
  };
  lbLogger: {
    debug: (messageFactory: () => string) => void;
    warn: (messageFactory: () => string) => void;
  };
}

async function loadReferencedSubProfile(
  profileName: string,
  deps: LoadBalancerResolutionDeps,
): Promise<Profile> {
  try {
    return await deps.profileManagerInstance.loadProfile(profileName);
  } catch {
    throw new Error(
      `Load balancer profile "${deps.lbName}" references profile "${profileName}" which does not exist`,
    );
  }
}

function ensureSubProfileIsNotLoadBalancer(
  subProfile: Profile,
  profileName: string,
  lbName: string,
): void {
  if (isLoadBalancerProfile(subProfile)) {
    throw new Error(
      `Load balancer profile "${lbName}" cannot reference another loadbalancer profile "${profileName}"`,
    );
  }
}

async function resolveSubProfileAuthToken(
  profileName: string,
  subProfileEphemeralSettings: Record<string, unknown>,
  authKeyfile: string | undefined,
  deps: LoadBalancerResolutionDeps,
): Promise<string | undefined> {
  const authToken = getStringValue(subProfileEphemeralSettings, 'auth-key');
  if (authToken !== undefined || authKeyfile === undefined) {
    return authToken;
  }
  try {
    const keyfilePath = authKeyfile.startsWith('~')
      ? path.join(homedir(), authKeyfile.slice(1))
      : authKeyfile;
    const keyfileToken = (await fs.readFile(keyfilePath, 'utf-8')).trim();
    deps.lbLogger.debug(
      () => `Resolved authToken from keyfile for sub-profile ${profileName}`,
    );
    return keyfileToken;
  } catch (error) {
    deps.lbLogger.warn(
      () =>
        `Failed to read auth-keyfile for sub-profile ${profileName}: ${error}`,
    );
    return undefined;
  }
}

async function resolveLoadBalancerSubProfile(
  profileName: string,
  deps: LoadBalancerResolutionDeps,
): Promise<ResolvedSubProfile> {
  const subProfile = await loadReferencedSubProfile(profileName, deps);
  ensureSubProfileIsNotLoadBalancer(subProfile, profileName, deps.lbName);
  const subProfileEphemeralSettings = getProfileEphemeralSettings(subProfile);
  const authKeyfile = getStringValue(
    subProfileEphemeralSettings,
    'auth-keyfile',
  );
  const authToken = await resolveSubProfileAuthToken(
    profileName,
    subProfileEphemeralSettings,
    authKeyfile,
    deps,
  );
  return {
    name: profileName,
    providerName: getProfileProvider(subProfile) ?? '',
    model: getProfileModel(subProfile) ?? '',
    baseURL: getStringValue(subProfileEphemeralSettings, 'base-url'),
    authToken,
    authKeyfile,
    ephemeralSettings: subProfileEphemeralSettings,
    modelParams: getProfileModelParams(subProfile),
  };
}

function createLoadBalancerConfig(
  profileInput: LoadBalancerProfile,
  lbName: string,
  resolvedSubProfiles: ResolvedSubProfile[],
): LoadBalancingProviderConfig {
  return {
    profileName: lbName,
    strategy: profileInput.policy === 'failover' ? 'failover' : 'round-robin',
    subProfiles: resolvedSubProfiles.map(
      (sp): LoadBalancerSubProfile => ({
        name: sp.name,
        providerName: sp.providerName,
        modelId: sp.model,
        baseURL: sp.baseURL,
        authToken: sp.authToken,
      }),
    ),
    lbProfileEphemeralSettings: getProfileEphemeralSettings(profileInput),
  };
}

async function resolveLoadBalancerSubProfiles(
  profileInput: LoadBalancerProfile,
  deps: LoadBalancerResolutionDeps,
): Promise<ResolvedSubProfile[]> {
  const resolvedSubProfiles: ResolvedSubProfile[] = [];
  for (const profileName of profileInput.profiles) {
    deps.lbLogger.debug(() => `Loading sub-profile: ${profileName}`);
    const resolved = await resolveLoadBalancerSubProfile(profileName, deps);
    resolvedSubProfiles.push(resolved);
    deps.lbLogger.debug(
      () =>
        `Resolved sub-profile ${profileName}: provider=${resolved.providerName}, model=${resolved.model}`,
    );
  }
  return resolvedSubProfiles;
}

export async function maybeRegisterLoadBalancerProfile(
  profileInput: Profile,
  options: { profileName?: string },
  runtimeServices: ReturnType<typeof getCliRuntimeServices>,
  lbLogger: LoadBalancerResolutionDeps['lbLogger'],
): Promise<void> {
  if (!isLoadBalancerProfile(profileInput)) {
    return;
  }
  const lbName = options.profileName ?? 'load-balancer';
  lbLogger.debug(
    () =>
      `Detected type: loadbalancer profile with ${profileInput.profiles.length} profile references`,
  );
  const profileManagerInstance =
    'profileManager' in runtimeServices && runtimeServices.profileManager
      ? runtimeServices.profileManager
      : new ProfileManager();
  const resolvedSubProfiles = await resolveLoadBalancerSubProfiles(
    profileInput,
    { lbName, profileManagerInstance, lbLogger },
  );
  const lbConfig = createLoadBalancerConfig(
    profileInput,
    lbName,
    resolvedSubProfiles,
  );
  lbLogger.debug(
    () =>
      `Created LoadBalancingProvider config with ${lbConfig.subProfiles.length} sub-profiles`,
  );
  runtimeServices.providerManager.registerProvider(
    new LoadBalancingProvider(lbConfig, runtimeServices.providerManager),
  );
  lbLogger.debug(() => `Registered LoadBalancingProvider as "load-balancer"`);
}
