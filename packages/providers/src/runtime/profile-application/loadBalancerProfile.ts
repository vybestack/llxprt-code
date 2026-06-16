/**
 * @plan:PLAN-20260603-ISSUE1584.P12
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-15
 */
import {
  LoadBalancingProvider,
  type LoadBalancingProviderConfig,
  type ResolvedSubProfile,
} from '../../LoadBalancingProvider.js';
import {
  ProfileManager,
  isLoadBalancerProfile,
  type LoadBalancerProfile,
  type Profile,
} from '@vybestack/llxprt-code-settings';
import * as fs from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { getCliRuntimeServices } from '../runtimeSettings.js';
import { createProviderKeyStorage } from '../runtimeSettings.js';
import {
  getProfileEphemeralSettings,
  getProfileModel,
  getProfileModelParams,
  getProfileProvider,
  getStringValue,
} from './profileAccessors.js';

interface ModelMetadataProvider {
  getModels: () => Promise<Array<{ id: string; contextWindow?: number }>>;
}

interface LoadBalancerProviderManager {
  getProviderByName: (
    providerName: string,
  ) => ModelMetadataProvider | undefined;
}

interface LoadBalancerResolutionDeps {
  lbName: string;
  profileManagerInstance: {
    loadProfile: (profileName: string) => Promise<Profile>;
  };
  providerManager?: LoadBalancerProviderManager;
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
  if (authToken !== undefined) {
    return authToken;
  }

  const authKeyName = getStringValue(
    subProfileEphemeralSettings,
    'auth-key-name',
  );
  if (authKeyName !== undefined) {
    try {
      const resolvedKey = await createProviderKeyStorage().getKey(authKeyName);
      if (resolvedKey && resolvedKey.trim() !== '') {
        deps.lbLogger.debug(
          () =>
            `Resolved auth-key-name '${authKeyName}' for sub-profile ${profileName}`,
        );
        return resolvedKey.trim();
      }
      deps.lbLogger.warn(
        () =>
          `Key '${authKeyName}' not found in secure storage for sub-profile ${profileName}; falling back.`,
      );
    } catch (error) {
      deps.lbLogger.warn(
        () =>
          `Failed to resolve auth-key-name '${authKeyName}' for sub-profile ${profileName}: ${error}`,
      );
    }
  }

  if (authKeyfile === undefined) {
    return undefined;
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

async function resolveSubProfileContextWindow(
  providerName: string,
  modelId: string,
  deps: LoadBalancerResolutionDeps,
): Promise<number | undefined> {
  const provider = deps.providerManager?.getProviderByName(providerName);
  if (provider === undefined) {
    return undefined;
  }

  try {
    const models = await provider.getModels();
    const model = models.find((candidate) => candidate.id === modelId);
    return model?.contextWindow;
  } catch (error) {
    deps.lbLogger.warn(
      () =>
        `Failed to resolve context window for sub-profile model ${providerName}/${modelId}: ${error}`,
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
  const providerName = getProfileProvider(subProfile) ?? '';
  const model = getProfileModel(subProfile) ?? '';
  const contextWindow = await resolveSubProfileContextWindow(
    providerName,
    model,
    deps,
  );

  return {
    name: profileName,
    providerName,
    model,
    baseURL: getStringValue(subProfileEphemeralSettings, 'base-url'),
    authToken,
    authKeyfile,
    contextWindow,
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
    subProfiles: resolvedSubProfiles,
    contextLimit: profileInput.contextLimit,
    lbProfileEphemeralSettings: getProfileEphemeralSettings(profileInput),
    lbProfileModelParams: getProfileModelParams(profileInput),
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
    {
      lbName,
      profileManagerInstance,
      providerManager: runtimeServices.providerManager,
      lbLogger,
    },
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
    new LoadBalancingProvider(
      lbConfig,
      runtimeServices.providerManager as never,
    ),
  );
  lbLogger.debug(() => `Registered LoadBalancingProvider as "load-balancer"`);
}
