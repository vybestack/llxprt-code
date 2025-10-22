import type { Profile, AuthType } from '@vybestack/llxprt-code-core';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import * as fs from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  clearActiveModelParam,
  getActiveModelParams,
  getCliRuntimeServices,
  setActiveModel,
  setActiveModelParam,
  setEphemeralSetting,
  switchActiveProvider,
  updateActiveProviderApiKey,
  updateActiveProviderBaseUrl,
} from './runtimeSettings.js';

export interface ProviderSelectionResult {
  providerName: string;
  warnings: string[];
  didFallback: boolean;
  requestedProvider: string | null;
}

export interface ProfileApplicationOptions {
  profileName?: string;
}

export interface ProfileApplicationResult {
  providerName: string;
  modelName: string;
  infoMessages: string[];
  warnings: string[];
  providerChanged: boolean;
  authType?: AuthType;
  didFallback: boolean;
  requestedProvider: string | null;
  baseUrl?: string;
}

const logger = new DebugLogger('llxprt:runtime:profile');

/**
 * @plan PLAN-20251020-STATELESSPROVIDER3.P09
 * @requirement REQ-SP3-002
 * @pseudocode profile-application.md lines 1-22
 */
export function selectAvailableProvider(
  requestedProvider: string | null | undefined,
  availableProviders: readonly string[],
): ProviderSelectionResult {
  const trimmedRequested =
    typeof requestedProvider === 'string'
      ? requestedProvider.trim()
      : (requestedProvider ?? '');
  const warnings: string[] = [];

  if (trimmedRequested && availableProviders.includes(trimmedRequested)) {
    return {
      providerName: trimmedRequested,
      warnings,
      didFallback: false,
      requestedProvider: trimmedRequested,
    };
  }

  if (availableProviders.length === 0) {
    throw new Error(
      'No registered providers are available to apply the requested profile.',
    );
  }

  const fallbackProvider = availableProviders[0];
  if (trimmedRequested) {
    warnings.push(
      `Provider '${trimmedRequested}' unavailable, using '${fallbackProvider}'`,
    );
  }

  return {
    providerName: fallbackProvider,
    warnings,
    didFallback: Boolean(trimmedRequested),
    requestedProvider: trimmedRequested || null,
  };
}

/**
 * @plan PLAN-20251020-STATELESSPROVIDER3.P09
 * @requirement REQ-SP3-002
 * @pseudocode profile-application.md lines 1-22
 */
export async function applyProfileWithGuards(
  profile: Profile,
  _options: ProfileApplicationOptions = {},
): Promise<ProfileApplicationResult> {
  const { config, providerManager, settingsService } = getCliRuntimeServices();
  const availableProviders = providerManager.listProviders();
  logger.debug(() => {
    const requested =
      typeof profile.provider === 'string'
        ? profile.provider
        : profile.provider === null
          ? 'null'
          : 'unset';
    return `[profile] applying profile provider='${requested}' available=[${availableProviders.join(
      ', ',
    )}]`;
  });

  const selection = selectAvailableProvider(
    profile.provider,
    availableProviders,
  );

  const warnings = [...selection.warnings];
  const requestedProvider =
    typeof profile.provider === 'string' ? profile.provider : null;

  const targetProviderName = selection.providerName;
  if (warnings.length > 0) {
    logger.debug(
      () => `[profile] provider selection warnings: ${warnings.join('; ')}`,
    );
  }
  logger.debug(
    () =>
      `[profile] target provider '${targetProviderName}' (requested='${requestedProvider ?? 'none'}')`,
  );
  const providerRecord = providerManager.getProviderByName(targetProviderName);
  if (!providerRecord) {
    warnings.push(
      `Provider '${targetProviderName}' not registered; skipping provider-specific updates.`,
    );
  }

  const previousEphemerals = config.getEphemeralSettings();
  const previousEphemeralEntries = new Map(
    Object.entries(previousEphemerals ?? {}),
  );
  const previousEphemeralKeys = Array.from(previousEphemeralEntries.keys());

  const mutatedEphemeralKeys = new Set<string>([
    ...previousEphemeralKeys.filter((key) => key !== 'activeProvider'),
    ...Object.keys(profile.ephemeralSettings ?? {}),
    'auth-key',
    'auth-keyfile',
    'base-url',
  ]);

  const providerSwitch = await switchActiveProvider(targetProviderName);
  const infoMessages = [...providerSwitch.infoMessages];
  const requestedModel =
    typeof profile.model === 'string' ? profile.model.trim() : '';
  const fallbackModel =
    providerRecord?.getDefaultModel?.() ??
    config.getModel() ??
    providerManager.getActiveProvider()?.getDefaultModel?.() ??
    '';
  if (!requestedModel && !fallbackModel) {
    throw new Error(
      `Profile '${profile.provider}' does not specify a model and no default is available.`,
    );
  }
  const modelResult = await setActiveModel(requestedModel || fallbackModel);

  for (const key of mutatedEphemeralKeys) {
    setEphemeralSetting(key, undefined);
  }

  const appliedEphemeralEntries = Object.entries(
    profile.ephemeralSettings ?? {},
  );

  let appliedBaseUrl: string | undefined;

  for (const [key, value] of appliedEphemeralEntries) {
    logger.debug(() => {
      const displayValue =
        key === 'auth-key' && typeof value === 'string'
          ? `***redacted*** (len=${value.length})`
          : JSON.stringify(value);
      return `[profile] applying ephemeral '${key}' => ${displayValue}`;
    });
    if (key === 'auth-key') {
      const { message } = await updateActiveProviderApiKey(
        typeof value === 'string' ? value : null,
      );
      if (message) {
        infoMessages.push(message);
      }
      continue;
    }

    if (key === 'base-url') {
      const { message, baseUrl } = await updateActiveProviderBaseUrl(
        typeof value === 'string' ? value : null,
      );
      if (message) {
        infoMessages.push(message);
      }
      appliedBaseUrl =
        baseUrl ?? (typeof value === 'string' ? value : undefined);
      continue;
    }

    if (key === 'auth-keyfile') {
      if (typeof value === 'string' && value.trim() !== '') {
        const resolvedPath = value.replace(/^~(?=$|\/)/, homedir());
        try {
          const filePath = path.resolve(resolvedPath);
          const fileContents = await fs.readFile(filePath, 'utf-8');
          const apiKeyFromFile = fileContents.trim();
          logger.debug(
            () =>
              `[profile] loaded keyfile '${filePath}' length=${apiKeyFromFile.length}`,
          );
          if (apiKeyFromFile) {
            const { message } =
              await updateActiveProviderApiKey(apiKeyFromFile);
            if (message) {
              infoMessages.push(message);
            }
            setEphemeralSetting(key, filePath);
            const maybeExtended = settingsService as {
              setProviderKeyfile?: (
                provider: string,
                keyfilePath: string,
              ) => void;
            };
            maybeExtended.setProviderKeyfile?.(targetProviderName, filePath);
            continue;
          }
          warnings.push(
            `Keyfile '${value}' was empty; falling back to existing credentials.`,
          );
        } catch (error) {
          warnings.push(
            `Failed to load keyfile '${value}': ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
      setEphemeralSetting(key, value);
      continue;
    }

    setEphemeralSetting(key, value);
  }

  const profileEphemeralKeys = new Set(
    appliedEphemeralEntries.map(([key]) => key),
  );

  for (const [key, value] of previousEphemeralEntries.entries()) {
    if (key === 'activeProvider') {
      continue;
    }
    if (!profileEphemeralKeys.has(key)) {
      setEphemeralSetting(key, value);
    }
  }

  const profileParams = profile.modelParams ?? {};
  const existingParams = getActiveModelParams();

  for (const [key, value] of Object.entries(profileParams)) {
    setActiveModelParam(key, value);
  }

  for (const key of Object.keys(existingParams)) {
    if (!(key in profileParams)) {
      clearActiveModelParam(key);
    }
  }

  const provider = providerManager.getActiveProvider();

  if (!provider) {
    throw new Error(
      `[oauth-manager] Active provider "${targetProviderName}" is not registered.`,
    );
  }

  const authType: AuthType | undefined =
    providerSwitch.authType ??
    config.getContentGeneratorConfig()?.authType ??
    undefined;

  const resolvedBaseUrl =
    appliedBaseUrl ??
    (config.getEphemeralSetting('base-url') as string | undefined);

  return {
    providerName: provider.name,
    modelName: modelResult.nextModel,
    infoMessages,
    warnings,
    providerChanged: providerSwitch.changed,
    authType,
    didFallback: selection.didFallback,
    requestedProvider,
    baseUrl: resolvedBaseUrl,
  };
}
