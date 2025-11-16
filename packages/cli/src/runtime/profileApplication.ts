import type {
  Profile,
  AuthType,
  ModelParams,
} from '@vybestack/llxprt-code-core';
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
 * Sanitizes profile input and applies pre-switch authentication wiring.
 *
 * This function performs STEP 2 of profile application:
 * - Propagates authentication and base URL parameters from modelParams to ephemeralSettings
 * - Removes sensitive keys from modelParams after propagation
 * - Loads and applies authentication keys from keyfiles to SettingsService BEFORE provider switch
 * - Ensures auth is available so switchActiveProvider() won't trigger OAuth
 *
 * @param profile - The profile to sanitize (will be mutated)
 * @param targetProviderName - The name of the target provider for auth application
 * @param warnings - Array to collect warning messages (will be mutated)
 * @param settingsService - The settings service instance
 * @returns Promise<boolean> - true if auth key was applied from keyfile, false otherwise
 */
async function sanitizeProfileAndApplyAuth(
  profile: Profile,
  targetProviderName: string,
  warnings: string[],
  settingsService: ReturnType<typeof getCliRuntimeServices>['settingsService'],
): Promise<boolean> {
  const propagateModelParamToEphemeral = (
    aliases: string[],
    targetKey: 'auth-key' | 'auth-keyfile' | 'base-url',
  ): void => {
    if (
      profile.ephemeralSettings[targetKey] === undefined ||
      profile.ephemeralSettings[targetKey] === null
    ) {
      for (const alias of aliases) {
        const candidate = profile.modelParams?.[alias as keyof ModelParams];
        if (typeof candidate === 'string' && candidate.trim() !== '') {
          profile.ephemeralSettings[targetKey] = candidate;
          break;
        }
      }
    }
    for (const alias of aliases) {
      if (profile.modelParams && alias in profile.modelParams) {
        delete profile.modelParams[alias as keyof ModelParams];
      }
    }
  };

  propagateModelParamToEphemeral(['auth-key', 'authKey'], 'auth-key');
  propagateModelParamToEphemeral(
    ['auth-keyfile', 'authKeyfile'],
    'auth-keyfile',
  );
  propagateModelParamToEphemeral(
    ['base-url', 'baseUrl', 'baseURL'],
    'base-url',
  );
  if (profile.modelParams) {
    const extraSensitiveKeys = [
      'apiKey',
      'api-key',
      'apiKeyfile',
      'api-keyfile',
    ];
    for (const key of extraSensitiveKeys) {
      if (key in profile.modelParams) {
        delete profile.modelParams[key as keyof ModelParams];
      }
    }
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

      if (authKey && authKey.length > 0) {
        settingsService.setProviderSetting(
          targetProviderName,
          'apiKey',
          authKey,
        );
        authKeyApplied = true;
        logger.debug(
          () =>
            `[profile] set apiKey from keyfile for provider '${targetProviderName}'`,
        );
      } else {
        warnings.push(
          `Auth keyfile '${authKeyfile}' is empty or contains only whitespace`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(`Failed to load auth keyfile '${authKeyfile}': ${message}`);
      logger.warn(
        () => `[profile] failed to load keyfile '${authKeyfile}': ${message}`,
      );
    }
  }

  const authKey = profile.ephemeralSettings?.['auth-key'];
  if (!authKeyApplied && authKey && typeof authKey === 'string') {
    const trimmedKey = authKey.trim();
    if (trimmedKey.length > 0) {
      settingsService.setProviderSetting(
        targetProviderName,
        'apiKey',
        trimmedKey,
      );
      authKeyApplied = true;
      logger.debug(
        () =>
          `[profile] set apiKey from auth-key for provider '${targetProviderName}'`,
      );
    }
  }

  return authKeyApplied;
}

/**
 * Applies non-auth ephemeral settings from a profile.
 *
 * This function applies all ephemeral settings except those already handled
 * by earlier steps (auth-key, auth-keyfile, base-url, GOOGLE_CLOUD_PROJECT,
 * GOOGLE_CLOUD_LOCATION).
 *
 * @param profile - The sanitized profile containing ephemeral settings
 * @param logger - Logger instance for debug output
 */
function applyNonAuthEphemerals(profile: Profile, logger: DebugLogger): void {
  const appliedKeys = new Set([
    'auth-key',
    'auth-keyfile',
    'base-url',
    'GOOGLE_CLOUD_PROJECT',
    'GOOGLE_CLOUD_LOCATION',
  ]);
  const otherEphemerals = Object.entries(
    profile.ephemeralSettings ?? {},
  ).filter(([key]) => !appliedKeys.has(key));

  for (const [key, value] of otherEphemerals) {
    logger.debug(
      () => `[profile] applying ephemeral '${key}' => ${JSON.stringify(value)}`,
    );
    setEphemeralSetting(key, value);
  }
}

/**
 * Applies model and model parameters from a profile.
 *
 * This function handles model selection (with fallback), sets the active model,
 * and applies model parameters by clearing existing parameters that are not
 * in the profile and setting new ones from the profile.
 *
 * @param sanitizedProfile - The sanitized profile containing model and modelParams
 * @param providerRecord - The provider record for getting default model
 * @param warnings - Array to accumulate warnings
 * @param infoMessages - Array to accumulate info messages
 * @param logger - Logger instance for debug output
 * @param config - Configuration service for getting ephemeral settings
 * @param providerManager - Provider manager for getting active provider
 * @returns Object containing final model name and updated arrays
 */
async function applyModelAndParams(
  sanitizedProfile: Profile,
  providerRecord: ReturnType<
    ReturnType<
      typeof getCliRuntimeServices
    >['providerManager']['getProviderByName']
  > | null,
  warnings: string[],
  infoMessages: string[],
  logger: DebugLogger,
  config: ReturnType<typeof getCliRuntimeServices>['config'],
  providerManager: ReturnType<typeof getCliRuntimeServices>['providerManager'],
): Promise<{
  finalModel: string;
  infoMessages: string[];
  warnings: string[];
}> {
  const requestedModel =
    typeof sanitizedProfile.model === 'string'
      ? sanitizedProfile.model.trim()
      : '';
  const fallbackModel =
    providerRecord?.getDefaultModel?.() ??
    config.getModel() ??
    providerManager.getActiveProvider()?.getDefaultModel?.() ??
    '';
  if (!requestedModel && !fallbackModel) {
    throw new Error(
      `Profile '${sanitizedProfile.provider}' does not specify a model and no default is available.`,
    );
  }

  const modelResult = await setActiveModel(requestedModel || fallbackModel);
  const appliedModelName = modelResult.nextModel ?? '';
  logger.debug(
    () =>
      `[profile] model requested='${requestedModel || '(none)'}' fallback='${fallbackModel || '(none)'}' => applied='${appliedModelName}'`,
  );

  const oldParams = getActiveModelParams();
  const newParams = sanitizedProfile.modelParams ?? {};
  const newParamsKeys = Object.keys(newParams);

  const oldParamsToRemove = Object.keys(oldParams).filter(
    (k) => !newParamsKeys.includes(k),
  );
  for (const key of oldParamsToRemove) {
    clearActiveModelParam(key);
    logger.debug(() => `[profile] cleared old modelParam '${key}'`);
  }

  for (const key of newParamsKeys) {
    const value = newParams[key];
    setActiveModelParam(key, value);
    logger.debug(
      () => `[profile] set modelParam '${key}' => ${JSON.stringify(value)}`,
    );
  }

  return { finalModel: appliedModelName, infoMessages, warnings };
}

/**
 * @plan PLAN-20251020-STATELESSPROVIDER3.P09
 * @requirement REQ-SP3-002
 * @pseudocode profile-application.md lines 1-22
 */
export async function applyProfileWithGuards(
  profileInput: Profile,
  _options: ProfileApplicationOptions = {},
): Promise<ProfileApplicationResult> {
  const { config, providerManager, settingsService } = getCliRuntimeServices();
  const availableProviders = providerManager.listProviders();
  logger.debug(() => {
    const requested =
      typeof profileInput.provider === 'string'
        ? profileInput.provider
        : profileInput.provider === null
          ? 'null'
          : 'unset';
    return `[profile] applying profile provider='${requested}' available=[${availableProviders.join(
      ', ',
    )}]`;
  });

  const selection = selectAvailableProvider(
    profileInput.provider,
    availableProviders,
  );

  const warnings = [...selection.warnings];
  if (isCliStatelessProviderModeEnabled() && !isCliRuntimeStatelessReady()) {
    warnings.push(
      `[REQ-SP4-005] Stateless provider runtime context is not initialised. Run setCliRuntimeContext() or ensure runtime infrastructure boots before applying profiles.`,
    );
  }
  const requestedProvider =
    typeof profileInput.provider === 'string' ? profileInput.provider : null;

  const sanitizedProfile: Profile = {
    ...profileInput,
    modelParams: { ...(profileInput.modelParams ?? {}) },
    ephemeralSettings: { ...(profileInput.ephemeralSettings ?? {}) },
  };

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

  // STEP 2: Sanitize profile and apply pre-switch auth
  await sanitizeProfileAndApplyAuth(
    sanitizedProfile,
    targetProviderName,
    warnings,
    settingsService,
  );
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
    ...Object.keys(sanitizedProfile.ephemeralSettings ?? {}),
    'auth-key',
    'auth-keyfile',
    'base-url',
  ]);

  for (const key of mutatedEphemeralKeys) {
    setEphemeralSetting(key, undefined);
  }

  // Apply GCP environment settings if present in profile
  const gcpProjectValue =
    sanitizedProfile.ephemeralSettings?.['GOOGLE_CLOUD_PROJECT'];
  if (typeof gcpProjectValue === 'string' && gcpProjectValue.trim() !== '') {
    setEphemeralSetting('GOOGLE_CLOUD_PROJECT', gcpProjectValue);
    process.env.GOOGLE_CLOUD_PROJECT = gcpProjectValue;
  }

  const gcpLocationValue =
    sanitizedProfile.ephemeralSettings?.['GOOGLE_CLOUD_LOCATION'];
  if (typeof gcpLocationValue === 'string' && gcpLocationValue.trim() !== '') {
    setEphemeralSetting('GOOGLE_CLOUD_LOCATION', gcpLocationValue);
    process.env.GOOGLE_CLOUD_LOCATION = gcpLocationValue;
  }

  // STEP 3: NOW switch provider - auth is already in SettingsService
  // When switchActiveProvider calls getModels(), AuthResolver will find
  // the auth-key in SettingsService (set in Step 2)
  // CRITICAL: Preserve the auth and base-url ephemerals we just set
  const providerSwitch = await switchActiveProvider(targetProviderName, {
    autoOAuth: false,
    preserveEphemerals: [
      'auth-key',
      'auth-keyfile',
      'base-url',
      'GOOGLE_CLOUD_PROJECT',
      'GOOGLE_CLOUD_LOCATION',
    ],
  });
  const infoMessages = providerSwitch.infoMessages.filter(
    (message) =>
      !/^(Model set to|Active model is) '.+?' for provider/.test(message),
  );

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
  applyNonAuthEphemerals(sanitizedProfile, logger);

  // STEP 6: Apply model and modelParams
  const modelAndParamsResult = await applyModelAndParams(
    sanitizedProfile,
    providerRecord,
    warnings,
    infoMessages,
    logger,
    config,
    providerManager,
  );
  const appliedModelName = modelAndParamsResult.finalModel;

  const provider = providerManager.getActiveProvider();
  if (!provider) {
    throw new Error(
      `[oauth-manager] Active provider "${targetProviderName}" is not registered.`,
    );
  }

  if (appliedModelName) {
    infoMessages.push(
      `Model set to '${appliedModelName}' for provider '${provider.name}'.`,
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
    modelName: appliedModelName,
    infoMessages,
    warnings,
    providerChanged: providerSwitch.changed,
    authType,
    didFallback: selection.didFallback,
    requestedProvider,
    baseUrl: resolvedBaseUrl,
  };
}
