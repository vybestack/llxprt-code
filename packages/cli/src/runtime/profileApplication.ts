import type { Profile, AuthType } from '@vybestack/llxprt-code-core';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import * as fs from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  clearActiveModelParam,
  getActiveModelParams,
  getCliRuntimeServices,
  isCliRuntimeStatelessReady,
  isCliStatelessProviderModeEnabled,
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
  if (isCliStatelessProviderModeEnabled() && !isCliRuntimeStatelessReady()) {
    warnings.push(
      `[REQ-SP4-005] Stateless provider runtime context is not initialised. Run setCliRuntimeContext() or ensure runtime infrastructure boots before applying profiles.`,
    );
  }
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

  // STEP 1: Clear ALL ephemerals first (except activeProvider)
  const mutatedEphemeralKeys = new Set<string>([
    ...previousEphemeralKeys.filter((key) => key !== 'activeProvider'),
    ...Object.keys(profile.ephemeralSettings ?? {}),
    'auth-key',
    'auth-keyfile',
    'base-url',
  ]);

  for (const key of mutatedEphemeralKeys) {
    setEphemeralSetting(key, undefined);
  }

  // STEP 2: Load and IMMEDIATELY apply auth to SettingsService BEFORE provider switch
  // This makes auth available in SettingsService so switchActiveProvider() won't trigger OAuth
  let authKeyApplied = false;
  const authKeyfile = profile.ephemeralSettings?.['auth-keyfile'];
  if (
    authKeyfile &&
    typeof authKeyfile === 'string' &&
    authKeyfile.trim() !== ''
  ) {
    const resolvedPath = authKeyfile.replace(/^~(?=$|\/)/, homedir());
    const filePath = path.resolve(resolvedPath);
    try {
      const fileContents = await fs.readFile(filePath, 'utf-8');
      const authKey = fileContents.trim();
      logger.debug(
        () => `[profile] loaded keyfile '${filePath}' length=${authKey.length}`,
      );

      if (authKey) {
        // CRITICAL: Set in SettingsService BEFORE provider switch
        setEphemeralSetting('auth-key', authKey);
        setEphemeralSetting('auth-keyfile', filePath);
        authKeyApplied = true;
        logger.debug(
          () =>
            `[profile] applied auth to SettingsService before switch (keyfile)`,
        );

        // Also set provider-specific keyfile
        const maybeExtended = settingsService as {
          setProviderKeyfile?: (provider: string, keyfilePath: string) => void;
        };
        maybeExtended.setProviderKeyfile?.(targetProviderName, filePath);
      } else {
        warnings.push(
          `Keyfile '${authKeyfile}' was empty; falling back to existing credentials.`,
        );
        // Still set the ephemeral even if empty
        setEphemeralSetting('auth-keyfile', filePath);
      }
    } catch (error) {
      warnings.push(
        `Failed to load keyfile '${authKeyfile}': ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      // Still set the ephemeral to the original path even if it failed
      setEphemeralSetting('auth-keyfile', authKeyfile);
    }
  }

  // Fall back to direct auth-key if keyfile didn't work or wasn't provided
  if (!authKeyApplied && profile.ephemeralSettings?.['auth-key']) {
    const authKey = profile.ephemeralSettings['auth-key'] as string;
    setEphemeralSetting('auth-key', authKey);
    logger.debug(
      () =>
        `[profile] applied auth to SettingsService before switch (direct key)`,
    );
  }

  // Set base-url before switch too
  if (profile.ephemeralSettings?.['base-url']) {
    const baseUrl = profile.ephemeralSettings['base-url'] as string;
    setEphemeralSetting('base-url', baseUrl);
    logger.debug(
      () => `[profile] applied base-url to SettingsService before switch`,
    );
  }

  // STEP 3: NOW switch provider - auth is already in SettingsService
  // When switchActiveProvider calls getModels(), AuthResolver will find
  // the auth-key in SettingsService (set in Step 2)
  // CRITICAL: Preserve the auth and base-url ephemerals we just set
  const providerSwitch = await switchActiveProvider(targetProviderName, {
    autoOAuth: false,
    preserveEphemerals: ['auth-key', 'auth-keyfile', 'base-url'],
  });
  const infoMessages = [...providerSwitch.infoMessages];

  // STEP 4: Apply auth settings to the provider using the helper functions
  // This updates the provider-specific state but the auth is already in SettingsService
  let appliedBaseUrl: string | undefined;

  const currentAuthKey = config.getEphemeralSetting('auth-key') as
    | string
    | undefined;
  if (currentAuthKey) {
    logger.debug(() => {
      const displayValue = `***redacted*** (len=${currentAuthKey.length})`;
      return `[profile] updating provider with auth-key => ${displayValue}`;
    });
    const { message } = await updateActiveProviderApiKey(currentAuthKey);
    if (message) {
      infoMessages.push(message);
    }
  }

  const currentBaseUrl = config.getEphemeralSetting('base-url') as
    | string
    | undefined;
  if (currentBaseUrl) {
    logger.debug(
      () => `[profile] updating provider with base-url => ${currentBaseUrl}`,
    );
    const { message, baseUrl } =
      await updateActiveProviderBaseUrl(currentBaseUrl);
    if (message) {
      infoMessages.push(message);
    }
    appliedBaseUrl = baseUrl ?? currentBaseUrl;
  }

  // STEP 5: Apply non-auth ephemerals
  const appliedKeys = new Set(['auth-key', 'auth-keyfile', 'base-url']);
  const otherEphemerals = Object.entries(
    profile.ephemeralSettings ?? {},
  ).filter(([key]) => !appliedKeys.has(key));

  for (const [key, value] of otherEphemerals) {
    logger.debug(
      () => `[profile] applying ephemeral '${key}' => ${JSON.stringify(value)}`,
    );
    setEphemeralSetting(key, value);
  }

  // STEP 6: Apply model and modelParams
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

  // Issue #453: Do NOT restore old ephemeral settings that were not in the profile
  // Ephemeral settings should only contain what's explicitly set in the loaded profile
  // This prevents credentials and settings from leaking between profiles/providers

  const modelResult = await setActiveModel(requestedModel || fallbackModel);

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
    modelName: modelResult?.nextModel ?? requestedModel ?? fallbackModel,
    infoMessages,
    warnings,
    providerChanged: providerSwitch.changed,
    authType,
    didFallback: selection.didFallback,
    requestedProvider,
    baseUrl: resolvedBaseUrl,
  };
}
