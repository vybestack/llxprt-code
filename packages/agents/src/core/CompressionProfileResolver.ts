/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { SettingsService } from '@vybestack/llxprt-code-settings';
import { isLoadBalancerProfile } from '@vybestack/llxprt-code-settings';
import type {
  LoadBalancerProfile,
  StandardProfile,
} from '@vybestack/llxprt-code-settings';
import { getProviderKeyStorage } from '@vybestack/llxprt-code-core/storage/provider-key-storage.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { RuntimeGenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { CompressionProviderResult } from '@vybestack/llxprt-code-core/core/compression/types.js';
import { CompressionProfileNotFoundError } from '@vybestack/llxprt-code-core/core/compression/types.js';

import { CompressionLoadBalancingProvider } from './CompressionLoadBalancingProvider.js';
import type { CompressionLoadBalancerCandidate } from './CompressionLoadBalancingProvider.js';

/**
 * Callbacks and runtime state required to resolve a compression profile
 * into a concrete provider + runtime context. ChatSession supplies these.
 */
export interface CompressionProfileResolverContext {
  /** The base provider-runtime snapshot (runtimeId, metadata, config). */
  readonly providerRuntime: ProviderRuntimeContext;
  /**
   * Resolve an explicit provider by name for a compression sub-profile.
   * Throws CompressionProfileNotFoundError when unavailable.
   */
  resolveExplicitCompressionProvider(
    profileName: string,
    providerName: string,
  ): IProvider;
  /** Map of round-robin indexes, mutated in place when strategy is round-robin. */
  readonly roundRobinIndexes: Map<string, number>;
}

// ---------------------------------------------------------------------------
// Pure setting helpers
// ---------------------------------------------------------------------------

/**
 * Copy aliased ephemeral keys into both global and provider-scoped settings.
 */
export function copyProfileSettingAliases(
  profileSettings: SettingsService,
  provider: string,
  ephemerals: Record<string, unknown>,
  aliases: ReadonlyArray<{
    sourceKey: string;
    globalKey?: string;
    providerKey: string;
  }>,
): void {
  for (const alias of aliases) {
    const value = ephemerals[alias.sourceKey];
    if (value === undefined) {
      continue;
    }
    if (alias.globalKey) {
      profileSettings.set(alias.globalKey, value);
    }
    profileSettings.setProviderSetting(provider, alias.providerKey, value);
  }
}

/**
 * Apply auth-related ephemeral settings (auth-key, keyfile, key-name, base-url,
 * sandbox-base-url, api-version) to the profile settings.
 */
export function applyCompressionProfileAuthSettings(
  profileSettings: SettingsService,
  provider: string,
  ephemerals: Record<string, unknown>,
): void {
  copyProfileSettingAliases(profileSettings, provider, ephemerals, [
    { sourceKey: 'auth-key', globalKey: 'auth-key', providerKey: 'auth-key' },
    {
      sourceKey: 'auth-keyfile',
      globalKey: 'auth-keyfile',
      providerKey: 'auth-keyfile',
    },
    {
      sourceKey: 'auth-key-name',
      globalKey: 'auth-key-name',
      providerKey: 'auth-key-name',
    },
  ]);

  for (const key of ['base-url', 'sandbox-base-url', 'api-version']) {
    const value = ephemerals[key];
    if (value !== undefined) {
      profileSettings.setProviderSetting(provider, key, value);
    }
  }
}

/**
 * Apply model parameters (with camelCase aliases) to provider-scoped settings.
 */
export function applyCompressionProfileModelParams(
  profileSettings: SettingsService,
  provider: string,
  modelParams: StandardProfile['modelParams'],
): void {
  for (const [key, value] of Object.entries(modelParams)) {
    if (value !== undefined) {
      profileSettings.setProviderSetting(provider, key, value);
    }
  }
  const aliases: Record<string, unknown> = {
    temperature: modelParams.temperature,
    maxTokens: modelParams.max_tokens,
    topP: modelParams.top_p,
    topK: modelParams.top_k,
    presencePenalty: modelParams.presence_penalty,
    frequencyPenalty: modelParams.frequency_penalty,
  };
  for (const [key, value] of Object.entries(aliases)) {
    if (value !== undefined) {
      profileSettings.setProviderSetting(provider, key, value);
    }
  }
}

/**
 * Apply all profile settings (provider, model, ephemerals, auth, modelParams)
 * to a SettingsService instance.
 */
export function applyCompressionProfileSettings(
  profileSettings: SettingsService,
  profileName: string,
  profile: StandardProfile,
): void {
  const provider = profile.provider;
  const ephemerals = profile.ephemeralSettings as Record<string, unknown>;

  profileSettings.setCurrentProfileName(profileName);
  profileSettings.set('activeProvider', provider);
  profileSettings.set('model', profile.model);
  profileSettings.setProviderSetting(provider, 'enabled', true);
  profileSettings.setProviderSetting(provider, 'model', profile.model);

  for (const [key, value] of Object.entries(ephemerals)) {
    if (value !== undefined) {
      profileSettings.set(key, value);
      profileSettings.setProviderSetting(provider, key, value);
    }
  }

  applyCompressionProfileAuthSettings(profileSettings, provider, ephemerals);
  applyCompressionProfileModelParams(
    profileSettings,
    provider,
    profile.modelParams,
  );

  if (profile.auth) {
    profileSettings.set('auth.type', profile.auth.type);
    profileSettings.setProviderSetting(provider, 'auth', profile.auth);
    if (profile.auth.buckets) {
      profileSettings.set('auth.buckets', profile.auth.buckets);
    }
  }
}

/**
 * Inherit parent ephemerals into the sub-profile settings, only when the key
 * is not already set locally.
 */
export function applyCompressionProfileParentEphemerals(
  profileSettings: SettingsService,
  provider: string,
  parentEphemerals: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(parentEphemerals)) {
    if (value !== undefined && profileSettings.get(key) === undefined) {
      profileSettings.set(key, value);
    }
  }
  for (const key of ['custom-headers', 'api-version', 'sandbox-base-url']) {
    const value = parentEphemerals[key];
    if (value !== undefined) {
      profileSettings.setProviderSetting(provider, key, value);
    }
  }
}

/**
 * Expand a `~/`-prefixed path to an absolute home-rooted path.
 */
export function expandProfilePath(value: string): string {
  if (value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

/**
 * Return the first non-empty trimmed string value from the list, or undefined.
 */
export function getStringSettingFromValues(
  values: readonly unknown[],
): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return undefined;
}

/**
 * Build the ephemerals snapshot for a resolved profile (global + provider-scoped).
 */
export function buildCompressionProfileEphemeralsSnapshot(
  profileSettings: SettingsService,
  provider: string,
): Record<string, unknown> {
  return {
    ...profileSettings.getAllGlobalSettings(),
    [provider]: { ...profileSettings.getProviderSettings(provider) },
  };
}

/**
 * Resolve the auth token (direct key, key-name lookup, or keyfile read)
 * for a compression profile. Returns an empty object when no auth is configured.
 */
export async function resolveCompressionProfileAuthToken(
  profileSettings: SettingsService,
  provider: string,
): Promise<{ authToken: string } | Record<string, never>> {
  const providerSettings = profileSettings.getProviderSettings(provider);
  const directAuth = getStringSettingFromValues([
    providerSettings['auth-key'],
    profileSettings.get('auth-key'),
  ]);
  if (directAuth) {
    return { authToken: directAuth };
  }

  const keyName = getStringSettingFromValues([
    providerSettings['auth-key-name'],
    profileSettings.get('auth-key-name'),
  ]);
  if (keyName) {
    const token = await getProviderKeyStorage().getKey(keyName);
    if (token) {
      return { authToken: token };
    }
  }

  const keyFile = getStringSettingFromValues([
    providerSettings['auth-keyfile'],
    profileSettings.get('auth-keyfile'),
  ]);
  if (keyFile) {
    const token = (
      await fs.readFile(expandProfilePath(keyFile), 'utf8')
    ).trim();
    if (token) {
      return { authToken: token };
    }
  }

  return {};
}

/**
 * Build the resolved options (model, baseURL, authToken, temperature, maxTokens)
 * for a standard compression profile.
 */
export async function buildCompressionProfileResolvedOptions(
  profileSettings: SettingsService,
  profile: StandardProfile,
): Promise<RuntimeGenerateChatOptions['resolved']> {
  const providerSettings = profileSettings.getProviderSettings(
    profile.provider,
  );
  const baseURL =
    typeof providerSettings['base-url'] === 'string'
      ? providerSettings['base-url']
      : undefined;
  const temperature =
    typeof providerSettings.temperature === 'number'
      ? providerSettings.temperature
      : undefined;
  const maxTokens =
    typeof providerSettings.maxTokens === 'number'
      ? providerSettings.maxTokens
      : undefined;
  return {
    model: profile.model,
    ...(baseURL ? { baseURL } : {}),
    ...(await resolveCompressionProfileAuthToken(
      profileSettings,
      profile.provider,
    )),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
  };
}

// ---------------------------------------------------------------------------
// Orchestrating resolvers
// ---------------------------------------------------------------------------

/**
 * Resolve a single standard compression profile into a provider + runtime +
 * resolved options + invocation context.
 */
export async function resolveStandardCompressionProvider(
  ctx: CompressionProfileResolverContext,
  profileName: string,
  profile: StandardProfile,
  profileManager: NonNullable<ReturnType<Config['getProfileManager']>>,
  config: Config | undefined,
  parentEphemerals: Record<string, unknown> = {},
): Promise<CompressionProviderResult> {
  const provider = ctx.resolveExplicitCompressionProvider(
    profileName,
    profile.provider,
  );
  const profileSettings = new SettingsService();
  await profileManager.applyLoadedProfile(
    profileName,
    profile,
    profileSettings,
  );
  applyCompressionProfileParentEphemerals(
    profileSettings,
    profile.provider,
    parentEphemerals,
  );

  applyCompressionProfileSettings(profileSettings, profileName, profile);

  const runtimeId = `${ctx.providerRuntime.runtimeId}::compression-profile:${profileName}`;
  const metadata = {
    ...(ctx.providerRuntime.metadata ?? {}),
    source: 'ChatSession.resolveCompressionProvider',
    compressionProfile: profileName,
    compressionProvider: profile.provider,
    runtimeId,
    provider: profile.provider,
    model: profile.model,
  };
  const runtime: ProviderRuntimeContext = {
    settingsService: profileSettings,
    config,
    runtimeId,
    metadata,
  };
  const resolved = await buildCompressionProfileResolvedOptions(
    profileSettings,
    profile,
  );
  const invocation = createRuntimeInvocationContext({
    runtime,
    settings: profileSettings,
    providerName: profile.provider,
    ephemeralsSnapshot: buildCompressionProfileEphemeralsSnapshot(
      profileSettings,
      profile.provider,
    ),
    metadata,
    fallbackRuntimeId: runtimeId,
  });

  return {
    provider,
    runtime,
    config,
    resolved,
    invocation,
  };
}

/**
 * Build the ordered candidate list for a load-balanced compression profile
 * by resolving each sub-profile as a standard profile.
 */
export async function buildCompressionLoadBalancerCandidates(
  ctx: CompressionProfileResolverContext,
  profileName: string,
  profile: LoadBalancerProfile,
  config: Config | undefined,
  profileManager: NonNullable<ReturnType<Config['getProfileManager']>>,
): Promise<CompressionLoadBalancerCandidate[]> {
  const candidates: CompressionLoadBalancerCandidate[] = [];
  for (const subProfileName of profile.profiles) {
    const subProfile = await profileManager.loadProfile(subProfileName);
    if (isLoadBalancerProfile(subProfile)) {
      throw new CompressionProfileNotFoundError(
        profileName,
        `load-balanced compression profile references nested load-balanced profile '${subProfileName}'`,
      );
    }
    const candidate = await resolveStandardCompressionProvider(
      ctx,
      subProfileName,
      subProfile,
      profileManager,
      config,
      profile.ephemeralSettings as Record<string, unknown>,
    );
    if (!candidate.invocation) {
      throw new CompressionProfileNotFoundError(
        profileName,
        `failed to build invocation context for subprofile '${subProfileName}'`,
      );
    }
    candidates.push({
      profileName: subProfileName,
      provider: candidate.provider,
      runtime: candidate.runtime,
      config: candidate.config,
      resolved: candidate.resolved,
      invocation: candidate.invocation,
    });
  }
  return candidates;
}

/**
 * Resolve a load-balanced compression profile into a provider + runtime +
 * invocation context, advancing the round-robin index when applicable.
 */
export async function resolveLoadBalancedCompressionProvider(
  ctx: CompressionProfileResolverContext,
  profileName: string,
  profile: LoadBalancerProfile,
  config: Config | undefined,
  profileManager: NonNullable<ReturnType<Config['getProfileManager']>>,
): Promise<CompressionProviderResult> {
  const candidates = await buildCompressionLoadBalancerCandidates(
    ctx,
    profileName,
    profile,
    config,
    profileManager,
  );

  const strategy = profile.policy === 'failover' ? 'failover' : 'round-robin';
  const initialIndex = ctx.roundRobinIndexes.get(profileName) ?? 0;
  if (strategy === 'round-robin') {
    ctx.roundRobinIndexes.set(
      profileName,
      (initialIndex + 1) % candidates.length,
    );
  }
  const provider = new CompressionLoadBalancingProvider(
    strategy,
    candidates,
    initialIndex,
  );
  const runtimeId = `${ctx.providerRuntime.runtimeId}::compression-profile:${profileName}`;
  const settings = new SettingsService();
  settings.setCurrentProfileName(profileName);
  settings.set('activeProvider', 'load-balancer');
  settings.set('model', profile.model || provider.getDefaultModel());
  for (const [key, value] of Object.entries(profile.ephemeralSettings)) {
    if (value !== undefined) {
      settings.set(key, value);
    }
  }
  const metadata = {
    ...(ctx.providerRuntime.metadata ?? {}),
    source: 'ChatSession.resolveCompressionProvider',
    compressionProfile: profileName,
    compressionProvider: 'load-balancer',
    runtimeId,
    provider: 'load-balancer',
    model: settings.get('model'),
  };
  const runtime: ProviderRuntimeContext = {
    settingsService: settings,
    config,
    runtimeId,
    metadata,
  };
  const invocation = createRuntimeInvocationContext({
    runtime,
    settings,
    providerName: 'load-balancer',
    ephemeralsSnapshot: buildCompressionProfileEphemeralsSnapshot(
      settings,
      'load-balancer',
    ),
    metadata,
    fallbackRuntimeId: runtimeId,
  });
  return {
    provider,
    runtime,
    config,
    invocation,
  };
}

/**
 * Resolve a compression profile by name into a provider + runtime + config.
 * When no profile name is given, the supplied default provider/runtime is used.
 */
export async function resolveCompressionProvider(
  ctx: CompressionProfileResolverContext,
  profileName: string | undefined,
  defaultProvider: IProvider,
): Promise<CompressionProviderResult> {
  if (!profileName) {
    const runtime = ctx.providerRuntime;
    return {
      provider: defaultProvider,
      runtime,
      config: runtime.config,
    };
  }

  const config = ctx.providerRuntime.config;
  const profileManager = config?.getProfileManager();
  if (!profileManager) {
    throw new CompressionProfileNotFoundError(
      profileName,
      'profile manager is unavailable',
    );
  }

  let profile: Awaited<ReturnType<typeof profileManager.loadProfile>>;
  try {
    profile = await profileManager.loadProfile(profileName);
  } catch (error) {
    throw new CompressionProfileNotFoundError(
      profileName,
      error instanceof Error ? error.message : String(error),
    );
  }

  if (isLoadBalancerProfile(profile)) {
    return resolveLoadBalancedCompressionProvider(
      ctx,
      profileName,
      profile,
      config,
      profileManager,
    );
  }

  return resolveStandardCompressionProvider(
    ctx,
    profileName,
    profile,
    profileManager,
    config,
  );
}
