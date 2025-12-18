import {
  type Profile,
  type AuthType,
  type ModelParams,
  DebugLogger,
  LoadBalancingProvider,
  type LoadBalancingProviderConfig,
  type LoadBalancerSubProfile,
  type ResolvedSubProfile,
  isLoadBalancerProfile,
  ProfileManager,
} from '@vybestack/llxprt-code-core';
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
const lbLogger = new DebugLogger('llxprt:loadbalancer');

/**
 * Get load balancer stats for a specific LB profile
 * @param _lbName The name of the load balancer profile
 * @returns Stats or undefined if not an LB profile
 * @deprecated Stats are now tracked by LoadBalancingProvider directly
 */
export function getLoadBalancerStats(_lbName: string) {
  // Stats are now tracked by LoadBalancingProvider directly
  // This function is kept for backward compatibility but returns undefined
  // Use the LoadBalancingProvider.getStats() method directly instead
  return undefined;
}

/**
 * Get the last selected profile from a load balancer
 * @param _lbName The name of the load balancer profile
 * @returns The last selected profile name or null
 * @deprecated Stats are now tracked by LoadBalancingProvider directly
 */
export function getLoadBalancerLastSelected(_lbName: string): string | null {
  // Stats are now tracked by LoadBalancingProvider directly
  // This function is kept for backward compatibility but returns null
  // Use the LoadBalancingProvider.getStats() method directly instead
  return null;
}

/**
 * Get stats for all load balancers
 * @returns Map of LB name to stats
 * @deprecated Stats are now tracked by LoadBalancingProvider directly
 */
export function getAllLoadBalancerStats() {
  // Stats are now tracked by LoadBalancingProvider directly
  // This function is kept for backward compatibility but returns empty Map
  // Use the LoadBalancingProvider.getStats() method directly instead
  return new Map();
}

function getStringValue(
  ephemerals: Profile['ephemeralSettings'],
  key: string,
): string | undefined {
  const value = (ephemerals as Record<string, unknown>)[key];
  if (typeof value === 'string' && value.trim() !== '') {
    return value;
  }
  return undefined;
}

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
  profileInput: Profile,
  _options: ProfileApplicationOptions = {},
): Promise<ProfileApplicationResult> {
  const runtimeServices = getCliRuntimeServices();
  const { config, providerManager, settingsService } = runtimeServices;

  let actualProfile: Profile = profileInput;

  // PHASE 2 (486c): Check for {type: "loadbalancer", profiles: [...]} format FIRST
  // This format uses ProfileManager to load sub-profiles by name
  if (isLoadBalancerProfile(profileInput)) {
    const lbName = _options.profileName ?? 'load-balancer';
    lbLogger.debug(
      () =>
        `Detected type: loadbalancer profile with ${profileInput.profiles.length} profile references`,
    );

    // Get ProfileManager from runtime services (allows for dependency injection in tests)
    const profileManagerInstance =
      'profileManager' in runtimeServices && runtimeServices.profileManager
        ? runtimeServices.profileManager
        : new ProfileManager();

    // Load each sub-profile and resolve its configuration
    const resolvedSubProfiles: ResolvedSubProfile[] = [];
    for (const profileName of profileInput.profiles) {
      lbLogger.debug(() => `Loading sub-profile: ${profileName}`);

      let subProfile: Profile;
      try {
        subProfile = await profileManagerInstance.loadProfile(profileName);
      } catch (_error) {
        throw new Error(
          `Load balancer profile "${lbName}" references profile "${profileName}" which does not exist`,
        );
      }

      // Check for circular reference (sub-profile cannot be a loadbalancer)
      if (isLoadBalancerProfile(subProfile)) {
        throw new Error(
          `Load balancer profile "${lbName}" cannot reference another loadbalancer profile "${profileName}"`,
        );
      }

      // Extract full config from loaded sub-profile
      // Resolve authToken from either auth-key or auth-keyfile
      let authToken = subProfile.ephemeralSettings?.['auth-key'] as
        | string
        | undefined;
      const authKeyfile = subProfile.ephemeralSettings?.['auth-keyfile'] as
        | string
        | undefined;

      // If auth-key not provided but auth-keyfile is, read the key from file
      if (!authToken && authKeyfile) {
        try {
          const keyfilePath = authKeyfile.startsWith('~')
            ? path.join(homedir(), authKeyfile.slice(1))
            : authKeyfile;
          authToken = (await fs.readFile(keyfilePath, 'utf-8')).trim();
          lbLogger.debug(
            () =>
              `Resolved authToken from keyfile for sub-profile ${profileName}`,
          );
        } catch (error) {
          lbLogger.warn(
            () =>
              `Failed to read auth-keyfile for sub-profile ${profileName}: ${error}`,
          );
        }
      }

      const resolved: ResolvedSubProfile = {
        name: profileName,
        providerName: subProfile.provider,
        model: subProfile.model,
        baseURL: subProfile.ephemeralSettings?.['base-url'] as
          | string
          | undefined,
        authToken,
        authKeyfile,
        ephemeralSettings: (subProfile.ephemeralSettings ?? {}) as Record<
          string,
          unknown
        >,
        modelParams: (subProfile.modelParams ?? {}) as Record<string, unknown>,
      };

      resolvedSubProfiles.push(resolved);
      lbLogger.debug(
        () =>
          `Resolved sub-profile ${profileName}: provider=${resolved.providerName}, model=${resolved.model}`,
      );
    }

    // Build LoadBalancingProviderConfig from resolved sub-profiles
    const lbConfig: LoadBalancingProviderConfig = {
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
      lbProfileEphemeralSettings: profileInput.ephemeralSettings as Record<
        string,
        unknown
      >,
    };

    lbLogger.debug(
      () =>
        `Created LoadBalancingProvider config with ${lbConfig.subProfiles.length} sub-profiles`,
    );

    // Create and register LoadBalancingProvider
    const lbProvider = new LoadBalancingProvider(lbConfig, providerManager);
    providerManager.registerProvider(lbProvider);

    lbLogger.debug(() => `Registered LoadBalancingProvider as "load-balancer"`);

    // Continue with normal profile application
    // The provider will be switched to "load-balancer" below
    actualProfile = profileInput;
  }

  const availableProviders = providerManager.listProviders();

  // Check if this is a load balancer profile with type: loadbalancer format (486c)
  const isLBProfileFormat = isLoadBalancerProfile(actualProfile);

  // If load balancer profile, use "load-balancer" as the provider
  const requestedProvider = isLBProfileFormat
    ? 'load-balancer'
    : actualProfile.provider;

  logger.debug(() => {
    const requested =
      typeof requestedProvider === 'string'
        ? requestedProvider
        : requestedProvider === null
          ? 'null'
          : 'unset';
    return `[profile] applying profile provider='${requested}' available=[${availableProviders.join(
      ', ',
    )}]`;
  });

  const selection = selectAvailableProvider(
    requestedProvider,
    availableProviders,
  );

  const warnings = [...selection.warnings];
  if (isCliStatelessProviderModeEnabled() && !isCliRuntimeStatelessReady()) {
    warnings.push(
      `[REQ-SP4-005] Stateless provider runtime context is not initialised. Run setCliRuntimeContext() or ensure runtime infrastructure boots before applying profiles.`,
    );
  }

  const sanitizedProfile: Profile = {
    ...actualProfile,
    modelParams: { ...(actualProfile.modelParams ?? {}) },
    ephemeralSettings: { ...(actualProfile.ephemeralSettings ?? {}) },
  };

  const setProviderApiKey = (apiKey: string | undefined): void => {
    if (!apiKey || apiKey.trim() === '') {
      return;
    }
    settingsService.setProviderSetting(targetProviderName, 'apiKey', apiKey);
  };

  const setProviderApiKeyfile = (filePath: string | undefined): void => {
    if (!filePath || filePath.trim() === '') {
      return;
    }
    settingsService.setProviderSetting(
      targetProviderName,
      'apiKeyfile',
      filePath,
    );
  };

  const setProviderBaseUrl = (baseUrl: string | undefined): void => {
    if (!baseUrl || baseUrl.trim() === '') {
      return;
    }
    settingsService.setProviderSetting(targetProviderName, 'baseUrl', baseUrl);
    settingsService.setProviderSetting(targetProviderName, 'baseURL', baseUrl);
  };

  const propagateModelParamToEphemeral = (
    aliases: string[],
    targetKey: 'auth-key' | 'auth-keyfile' | 'base-url',
  ): void => {
    if (
      sanitizedProfile.ephemeralSettings[targetKey] === undefined ||
      sanitizedProfile.ephemeralSettings[targetKey] === null
    ) {
      for (const alias of aliases) {
        const candidate =
          sanitizedProfile.modelParams?.[alias as keyof ModelParams];
        if (typeof candidate === 'string' && candidate.trim() !== '') {
          sanitizedProfile.ephemeralSettings[targetKey] = candidate;
          break;
        }
      }
    }
    for (const alias of aliases) {
      if (
        sanitizedProfile.modelParams &&
        alias in sanitizedProfile.modelParams
      ) {
        delete sanitizedProfile.modelParams[alias as keyof ModelParams];
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
  if (sanitizedProfile.modelParams) {
    const extraSensitiveKeys = [
      'apiKey',
      'api-key',
      'apiKeyfile',
      'api-keyfile',
    ];
    for (const key of extraSensitiveKeys) {
      if (key in sanitizedProfile.modelParams) {
        delete sanitizedProfile.modelParams[key as keyof ModelParams];
      }
    }
  }

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
    ...Object.keys(sanitizedProfile.ephemeralSettings ?? {}),
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
  let resolvedAuthKeyfilePath: string | null = null;
  const authKeyfile = sanitizedProfile.ephemeralSettings?.['auth-keyfile'];
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
        setProviderApiKey(authKey);
        setProviderApiKeyfile(filePath);
        resolvedAuthKeyfilePath = filePath;
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
        setProviderApiKeyfile(filePath);
      }
    } catch (error) {
      warnings.push(
        `Failed to load keyfile '${authKeyfile}': ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      // Still set the ephemeral to the original path even if it failed
      setEphemeralSetting('auth-keyfile', authKeyfile);
      setProviderApiKeyfile(authKeyfile);
    }
  }

  // Fall back to direct auth-key if keyfile didn't work or wasn't provided
  if (!authKeyApplied && sanitizedProfile.ephemeralSettings?.['auth-key']) {
    const authKey = sanitizedProfile.ephemeralSettings['auth-key'] as string;
    setEphemeralSetting('auth-key', authKey);
    setProviderApiKey(authKey);
    logger.debug(
      () =>
        `[profile] applied auth to SettingsService before switch (direct key)`,
    );
  }

  // Set base-url before switch too
  if (sanitizedProfile.ephemeralSettings?.['base-url']) {
    const baseUrl = sanitizedProfile.ephemeralSettings['base-url'] as string;
    setEphemeralSetting('base-url', baseUrl);
    setProviderBaseUrl(baseUrl);
    logger.debug(
      () => `[profile] applied base-url to SettingsService before switch`,
    );
  }

  const gcpProject = getStringValue(
    sanitizedProfile.ephemeralSettings,
    'GOOGLE_CLOUD_PROJECT',
  );
  if (gcpProject) {
    setEphemeralSetting('GOOGLE_CLOUD_PROJECT', gcpProject);
    process.env.GOOGLE_CLOUD_PROJECT = gcpProject;
  }

  const gcpLocation = getStringValue(
    sanitizedProfile.ephemeralSettings,
    'GOOGLE_CLOUD_LOCATION',
  );
  if (gcpLocation) {
    setEphemeralSetting('GOOGLE_CLOUD_LOCATION', gcpLocation);
    process.env.GOOGLE_CLOUD_LOCATION = gcpLocation;
  }

  // STEP 3: NOW switch provider - auth is already in SettingsService
  // When switchActiveProvider calls getModels(), AuthResolver will find
  // the auth-key in SettingsService (set in Step 2)
  // CRITICAL: Preserve the auth and base-url ephemerals we just set
  // Also preserve reasoning settings so they survive provider switches (fixes #890)
  const providerSwitch = await switchActiveProvider(targetProviderName, {
    autoOAuth: false,
    preserveEphemerals: [
      'auth-key',
      'auth-keyfile',
      'base-url',
      'GOOGLE_CLOUD_PROJECT',
      'GOOGLE_CLOUD_LOCATION',
      // Reasoning/thinking settings - fixes #890
      'reasoning.enabled',
      'reasoning.budgetTokens',
      'reasoning.stripFromContext',
      'reasoning.includeInContext',
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
    if (authKeyApplied && resolvedAuthKeyfilePath) {
      setEphemeralSetting('auth-key', undefined);
      setEphemeralSetting('auth-keyfile', resolvedAuthKeyfilePath);
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
  const appliedKeys = new Set([
    'auth-key',
    'auth-keyfile',
    'base-url',
    'GOOGLE_CLOUD_PROJECT',
    'GOOGLE_CLOUD_LOCATION',
  ]);
  const otherEphemerals = Object.entries(
    sanitizedProfile.ephemeralSettings ?? {},
  ).filter(([key]) => !appliedKeys.has(key));

  for (const [key, value] of otherEphemerals) {
    logger.debug(
      () => `[profile] applying ephemeral '${key}' => ${JSON.stringify(value)}`,
    );
    setEphemeralSetting(key, value);
  }

  // STEP 6: Apply model and modelParams
  // Skip model validation for load balancer profiles as they delegate to sub-profiles
  const isLB = isLoadBalancerProfile(actualProfile);
  const requestedModel =
    typeof sanitizedProfile.model === 'string'
      ? sanitizedProfile.model.trim()
      : '';
  const fallbackModel =
    providerRecord?.getDefaultModel?.() ??
    config.getModel() ??
    providerManager.getActiveProvider()?.getDefaultModel?.() ??
    '';

  // Load balancer profiles don't need a model - they delegate to sub-profiles
  if (!isLB && !requestedModel && !fallbackModel) {
    throw new Error(
      `Profile '${sanitizedProfile.provider}' does not specify a model and no default is available.`,
    );
  }

  // Issue #453: DO NOT restore old ephemeral settings that were not in the profile
  // Ephemeral settings should only contain what's explicitly set in the loaded profile
  // This prevents credentials and settings from leaking between profiles/providers

  // For load balancer profiles, use a placeholder model name
  const modelToSet = isLB ? 'load-balancer' : requestedModel || fallbackModel;
  const modelResult = await setActiveModel(modelToSet);

  const profileParams = sanitizedProfile.modelParams ?? {};
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

  const appliedModelName = modelResult.nextModel;
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
