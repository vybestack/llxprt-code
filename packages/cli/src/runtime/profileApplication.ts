import {
  type Profile,
  type ModelParams,
  DebugLogger,
  isLoadBalancerProfile,
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
  createProviderKeyStorage,
} from './runtimeSettings.js';
import {
  getProfileEphemeralSettings,
  getProfileModel,
  getProfileModelParams,
  getProfileProvider,
  getStringValue,
} from './profile-application/profileAccessors.js';
import { maybeRegisterLoadBalancerProfile } from './profile-application/loadBalancerProfile.js';

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
    typeof requestedProvider === 'string' ? requestedProvider.trim() : '';

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

interface AuthWiringDeps {
  targetProviderName: string;
  warnings: string[];
  settingsService: {
    setProviderSetting: (
      providerName: string,
      key: string,
      value: unknown,
    ) => void;
    setProviderKeyfile?: (provider: string, keyfilePath: string) => void;
  };
  setProviderApiKey: (apiKey: string | undefined) => void;
  setProviderApiKeyfile: (filePath: string | undefined) => void;
  setProviderBaseUrl: (baseUrl: string | undefined) => void;
}

interface AuthWiringResult {
  authKeyApplied: boolean;
  resolvedAuthKeyfilePath: string | null;
  authKeyNameApplied: boolean;
}

async function resolveNamedAuthKey(
  authKeyName: unknown,
  warnings: string[],
): Promise<{ authKey: string | undefined; authKeyNameApplied: boolean }> {
  if (typeof authKeyName !== 'string' || authKeyName.trim() === '') {
    return { authKey: undefined, authKeyNameApplied: false };
  }
  const trimmedKeyName = authKeyName.trim();
  setEphemeralSetting('auth-key-name', trimmedKeyName);
  try {
    const resolvedAuthKey =
      await createProviderKeyStorage().getKey(trimmedKeyName);
    if (resolvedAuthKey && resolvedAuthKey.trim() !== '') {
      logger.debug(
        () =>
          `[profile] resolved auth-key-name '${trimmedKeyName}' before switch`,
      );
      return { authKey: resolvedAuthKey.trim(), authKeyNameApplied: true };
    }
    warnings.push(
      `Key '${trimmedKeyName}' not found in secure storage; falling back to existing credentials.`,
    );
  } catch (error) {
    warnings.push(
      `Failed to resolve auth-key-name '${trimmedKeyName}': ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return { authKey: undefined, authKeyNameApplied: false };
}

async function loadAuthKeyfile(
  authKeyfile: unknown,
  warnings: string[],
): Promise<{ authKey: string | undefined; filePath: string | null }> {
  if (typeof authKeyfile !== 'string' || authKeyfile.trim() === '') {
    return { authKey: undefined, filePath: null };
  }
  const resolvedPath = authKeyfile.replace(/^~(?=$|\/)/, homedir());
  const filePath = path.resolve(resolvedPath);
  try {
    const authKey = (await fs.readFile(filePath, 'utf-8')).trim();
    logger.debug(
      () => `[profile] loaded keyfile '${filePath}' length=${authKey.length}`,
    );
    if (authKey !== '') {
      return { authKey, filePath };
    }
    warnings.push(
      `Keyfile '${authKeyfile}' was empty; falling back to existing credentials.`,
    );
  } catch (error) {
    warnings.push(
      `Failed to load keyfile '${authKeyfile}': ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { authKey: undefined, filePath: authKeyfile };
  }
  return { authKey: undefined, filePath };
}

function applyResolvedAuthKey(authKey: string, deps: AuthWiringDeps): void {
  setEphemeralSetting('auth-key', authKey);
  deps.setProviderApiKey(authKey);
}

function applyAuthKeyfilePath(filePath: string, deps: AuthWiringDeps): void {
  setEphemeralSetting('auth-keyfile', filePath);
  deps.setProviderApiKeyfile(filePath);
}

async function wireAuthBeforeSwitch(
  sanitizedProfile: Profile,
  deps: AuthWiringDeps,
): Promise<AuthWiringResult> {
  const { targetProviderName, warnings, settingsService, setProviderBaseUrl } =
    deps;
  const ephemeralSettings = getProfileEphemeralSettings(sanitizedProfile);
  const namedAuth = await resolveNamedAuthKey(
    ephemeralSettings['auth-key-name'],
    warnings,
  );
  let authKeyApplied = namedAuth.authKey !== undefined;
  const authKeyNameApplied = namedAuth.authKeyNameApplied;
  let resolvedAuthKeyfilePath: string | null = null;

  if (namedAuth.authKey !== undefined) {
    applyResolvedAuthKey(namedAuth.authKey, deps);
  }

  const keyfileAuth = await loadAuthKeyfile(
    ephemeralSettings['auth-keyfile'],
    warnings,
  );
  if (keyfileAuth.filePath !== null) {
    applyAuthKeyfilePath(keyfileAuth.filePath, deps);
  }
  if (keyfileAuth.authKey !== undefined) {
    applyResolvedAuthKey(keyfileAuth.authKey, deps);
    resolvedAuthKeyfilePath = keyfileAuth.filePath;
    authKeyApplied = true;
    logger.debug(
      () => `[profile] applied auth to SettingsService before switch (keyfile)`,
    );
    settingsService.setProviderKeyfile?.(
      targetProviderName,
      keyfileAuth.filePath ?? '',
    );
  }

  const directAuthKey = getStringValue(ephemeralSettings, 'auth-key');
  if (!authKeyApplied && directAuthKey !== undefined) {
    applyResolvedAuthKey(directAuthKey, deps);
    logger.debug(
      () =>
        `[profile] applied auth to SettingsService before switch (direct key)`,
    );
  }

  const baseUrl = getStringValue(ephemeralSettings, 'base-url');
  if (baseUrl !== undefined) {
    setEphemeralSetting('base-url', baseUrl);
    setProviderBaseUrl(baseUrl);
    logger.debug(
      () => `[profile] applied base-url to SettingsService before switch`,
    );
  }

  const gcpProject = getStringValue(ephemeralSettings, 'GOOGLE_CLOUD_PROJECT');
  if (gcpProject) {
    setEphemeralSetting('GOOGLE_CLOUD_PROJECT', gcpProject);
    process.env.GOOGLE_CLOUD_PROJECT = gcpProject;
  }

  const gcpLocation = getStringValue(
    ephemeralSettings,
    'GOOGLE_CLOUD_LOCATION',
  );
  if (gcpLocation) {
    setEphemeralSetting('GOOGLE_CLOUD_LOCATION', gcpLocation);
    process.env.GOOGLE_CLOUD_LOCATION = gcpLocation;
  }

  return { authKeyApplied, resolvedAuthKeyfilePath, authKeyNameApplied };
}

const PRE_APPLIED_EPHEMERAL_KEYS = new Set([
  'auth-key',
  'auth-key-name',
  'auth-keyfile',
  'base-url',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_CLOUD_LOCATION',
]);

function applyNonAuthEphemerals(sanitizedProfile: Profile): void {
  const otherEphemerals = Object.entries(
    getProfileEphemeralSettings(sanitizedProfile),
  ).filter(([key]) => !PRE_APPLIED_EPHEMERAL_KEYS.has(key));

  for (const [key, value] of otherEphemerals) {
    logger.debug(
      () => `[profile] applying ephemeral '${key}' => ${JSON.stringify(value)}`,
    );
    // null means "explicitly unset" – the profile wants to clear this key
    setEphemeralSetting(key, value === null ? undefined : value);
  }
}

interface ModelAndParamsDeps {
  sanitizedProfile: Profile;
  actualProfile: Profile;
  providerRecord: { getDefaultModel?: () => string } | null | undefined;
  config: { getModel: () => string | undefined };
  providerManager: {
    getActiveProvider: () =>
      | {
          name: string;
          getDefaultModel?: () => string;
        }
      | null
      | undefined;
  };
  targetProviderName: string;
}

interface ModelAndParamsResult {
  appliedModelName: string;
  provider: { name: string };
}

function resolveRequestedModel(
  sanitizedProfile: Profile,
  actualProfile: Profile,
  providerRecord: ModelAndParamsDeps['providerRecord'],
  config: ModelAndParamsDeps['config'],
  providerManager: ModelAndParamsDeps['providerManager'],
): string {
  if (isLoadBalancerProfile(actualProfile)) {
    return 'load-balancer';
  }
  const requestedModel = getProfileModel(sanitizedProfile)?.trim() ?? '';
  const fallbackModel =
    providerRecord?.getDefaultModel?.() ??
    config.getModel() ??
    providerManager.getActiveProvider()?.getDefaultModel?.() ??
    '';
  if (requestedModel === '' && fallbackModel === '') {
    throw new Error(
      `Provider '${getProfileProvider(sanitizedProfile) ?? 'unknown'}' profile does not specify a model and no default is available.`,
    );
  }
  return requestedModel || fallbackModel;
}

function applyProfileModelParams(sanitizedProfile: Profile): void {
  const profileParams = getProfileModelParams(sanitizedProfile);
  const existingParams = getActiveModelParams();
  for (const [key, value] of Object.entries(profileParams)) {
    setActiveModelParam(key, value);
  }
  for (const key of Object.keys(existingParams)) {
    if (!(key in profileParams)) {
      clearActiveModelParam(key);
    }
  }
}

async function applyModelAndParams(
  deps: ModelAndParamsDeps,
): Promise<ModelAndParamsResult> {
  const {
    sanitizedProfile,
    actualProfile,
    providerRecord,
    config,
    providerManager,
    targetProviderName,
  } = deps;

  const modelToSet = resolveRequestedModel(
    sanitizedProfile,
    actualProfile,
    providerRecord,
    config,
    providerManager,
  );
  const modelResult = await setActiveModel(modelToSet);
  applyProfileModelParams(sanitizedProfile);

  const provider = providerManager.getActiveProvider();

  if (!provider) {
    throw new Error(
      `[oauth-manager] Active provider "${targetProviderName}" is not registered.`,
    );
  }

  return { appliedModelName: modelResult.nextModel, provider };
}

function propagateModelParamToEphemeral(
  sanitizedProfile: Profile,
  aliases: string[],
  targetKey: 'auth-key' | 'auth-keyfile' | 'base-url',
): void {
  const sanitizedEphemeralSettings =
    getProfileEphemeralSettings(sanitizedProfile);
  const sanitizedModelParams = getProfileModelParams(sanitizedProfile);
  if (sanitizedEphemeralSettings[targetKey] == null) {
    const candidate = aliases
      .map((alias) => sanitizedModelParams[alias as keyof ModelParams])
      .find((value) => typeof value === 'string' && value.trim() !== '');
    if (typeof candidate === 'string') {
      sanitizedEphemeralSettings[targetKey] = candidate;
    }
  }
  for (const alias of aliases) {
    if (alias in sanitizedModelParams) {
      delete sanitizedModelParams[alias as keyof ModelParams];
    }
  }
}

interface ProfileApplicationContext {
  actualProfile: Profile;
  sanitizedProfile: Profile;
  requestedProvider: string;
  selection: ProviderSelectionResult;
  warnings: string[];
  targetProviderName: string;
  providerRecord: ModelAndParamsDeps['providerRecord'];
  authDeps: AuthWiringDeps;
}

function createSanitizedProfile(actualProfile: Profile): Profile {
  return {
    ...actualProfile,
    modelParams: { ...getProfileModelParams(actualProfile) },
    ephemeralSettings: { ...getProfileEphemeralSettings(actualProfile) },
  };
}

function createProviderSetters(
  settingsService: AuthWiringDeps['settingsService'],
  targetProviderName: string,
): Pick<
  AuthWiringDeps,
  'setProviderApiKey' | 'setProviderApiKeyfile' | 'setProviderBaseUrl'
> {
  const setProviderSetting = (key: string, value: string | undefined): void => {
    if (value === undefined || value.trim() === '') return;
    settingsService.setProviderSetting(targetProviderName, key, value);
  };
  return {
    setProviderApiKey: (apiKey) => setProviderSetting('apiKey', apiKey),
    setProviderApiKeyfile: (filePath) =>
      setProviderSetting('apiKeyfile', filePath),
    setProviderBaseUrl: (baseUrl) => setProviderSetting('base-url', baseUrl),
  };
}

function sanitizeSensitiveModelParams(sanitizedProfile: Profile): void {
  propagateModelParamToEphemeral(
    sanitizedProfile,
    ['auth-key', 'authKey'],
    'auth-key',
  );
  propagateModelParamToEphemeral(
    sanitizedProfile,
    ['auth-keyfile', 'authKeyfile'],
    'auth-keyfile',
  );
  propagateModelParamToEphemeral(sanitizedProfile, ['base-url'], 'base-url');
  const sanitizedModelParams = getProfileModelParams(sanitizedProfile);
  for (const key of ['apiKey', 'api-key', 'apiKeyfile', 'api-keyfile']) {
    if (key in sanitizedModelParams) {
      delete sanitizedModelParams[key as keyof ModelParams];
    }
  }
}

function clearProfileEphemerals(
  config: { getEphemeralSettings: () => Record<string, unknown> },
  sanitizedProfile: Profile,
): void {
  const previousEphemeralKeys = Object.keys(config.getEphemeralSettings());
  const sanitizedEphemeralSettings =
    getProfileEphemeralSettings(sanitizedProfile);
  const mutatedEphemeralKeys = new Set<string>([
    ...previousEphemeralKeys.filter((key) => key !== 'activeProvider'),
    ...Object.keys(sanitizedEphemeralSettings),
    'auth-key',
    'auth-keyfile',
    'base-url',
  ]);
  for (const key of mutatedEphemeralKeys) {
    setEphemeralSetting(key, undefined);
  }
}

function buildProfileApplicationContext(
  profileInput: Profile,
  runtimeServices: ReturnType<typeof getCliRuntimeServices>,
): ProfileApplicationContext {
  const { providerManager, settingsService } = runtimeServices;
  const actualProfile = profileInput;
  const availableProviders = providerManager.listProviders();
  const requestedProvider = isLoadBalancerProfile(actualProfile)
    ? 'load-balancer'
    : actualProfile.provider;
  logger.debug(
    () =>
      `[profile] applying profile provider='${requestedProvider}' available=[${availableProviders.join(
        ', ',
      )}]`,
  );
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
  const targetProviderName = selection.providerName;
  logProfileSelectionWarnings(warnings, targetProviderName, requestedProvider);
  const providerRecord = providerManager.getProviderByName(targetProviderName);
  if (!providerRecord) {
    warnings.push(
      `Provider '${targetProviderName}' not registered; skipping provider-specific updates.`,
    );
  }
  const sanitizedProfile = createSanitizedProfile(actualProfile);
  sanitizeSensitiveModelParams(sanitizedProfile);
  return {
    actualProfile,
    sanitizedProfile,
    requestedProvider,
    selection,
    warnings,
    targetProviderName,
    providerRecord,
    authDeps: {
      targetProviderName,
      warnings,
      settingsService,
      ...createProviderSetters(settingsService, targetProviderName),
    },
  };
}

function logProfileSelectionWarnings(
  warnings: string[],
  targetProviderName: string,
  requestedProvider: string,
): void {
  if (warnings.length > 0) {
    logger.debug(
      () => `[profile] provider selection warnings: ${warnings.join('; ')}`,
    );
  }
  logger.debug(
    () =>
      `[profile] target provider '${targetProviderName}' (requested='${requestedProvider}')`,
  );
}

const PRESERVED_PROFILE_EPHEMERALS = [
  'auth-key',
  'auth-key-name',
  'auth-keyfile',
  'base-url',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_CLOUD_LOCATION',
  'reasoning.enabled',
  'reasoning.budgetTokens',
  'reasoning.stripFromContext',
  'reasoning.includeInContext',
  'task-default-timeout-seconds',
  'task-max-timeout-seconds',
  'shell-default-timeout-seconds',
  'shell-max-timeout-seconds',
];

async function switchProviderForProfile(targetProviderName: string): Promise<{
  changed: boolean;
  infoMessages: string[];
}> {
  const providerSwitch = await switchActiveProvider(targetProviderName, {
    autoOAuth: false,
    skipModelDefaults: true,
    preserveEphemerals: PRESERVED_PROFILE_EPHEMERALS,
  });
  return {
    changed: providerSwitch.changed,
    infoMessages: providerSwitch.infoMessages.filter(
      (message) =>
        !/^(Model set to|Active model is) '.+?' for provider/.test(message),
    ),
  };
}

interface ProviderAuthUpdateResult {
  appliedBaseUrl: string | undefined;
}

function hasExplicitProfileDirective(
  profileEphemeralSettings: Record<string, unknown>,
  keys: string[],
): boolean {
  return keys.some((key) =>
    Object.prototype.hasOwnProperty.call(profileEphemeralSettings, key),
  );
}

function isExplicitClearValue(value: unknown): boolean {
  return value === null || (typeof value === 'string' && value.trim() === '');
}

function hasExplicitClearDirective(
  profileEphemeralSettings: Record<string, unknown>,
  keys: string[],
): boolean {
  return keys.some(
    (key) =>
      Object.prototype.hasOwnProperty.call(profileEphemeralSettings, key) &&
      isExplicitClearValue(profileEphemeralSettings[key]),
  );
}

async function applyAuthProviderUpdate(
  config: { getEphemeralSetting: (key: string) => unknown },
  profileEphemeralSettings: Record<string, unknown>,
  authKeyApplied: boolean,
  resolvedAuthKeyfilePath: string | null,
  authKeyNameApplied: boolean,
  infoMessages: string[],
): Promise<void> {
  const currentAuthKey = config.getEphemeralSetting('auth-key') as
    | string
    | undefined;
  const currentAuthKeyName = authKeyNameApplied
    ? (config.getEphemeralSetting('auth-key-name') as string | undefined)
    : undefined;
  if (currentAuthKey) {
    logger.debug(() => {
      const displayValue = `***redacted*** (len=${currentAuthKey.length})`;
      return `[profile] updating provider with auth-key => ${displayValue}`;
    });
    const { message } = await updateActiveProviderApiKey(currentAuthKey);
    if (message) infoMessages.push(message);
    if (authKeyApplied && resolvedAuthKeyfilePath) {
      setEphemeralSetting('auth-key', undefined);
      setEphemeralSetting('auth-keyfile', resolvedAuthKeyfilePath);
    }
  } else if (
    !hasExplicitProfileDirective(profileEphemeralSettings, [
      'auth-key',
      'auth-keyfile',
      'auth-key-name',
    ]) ||
    hasExplicitClearDirective(profileEphemeralSettings, [
      'auth-key',
      'auth-keyfile',
      'auth-key-name',
    ])
  ) {
    const { message } = await updateActiveProviderApiKey(null);
    if (message) infoMessages.push(message);
  }
  if (authKeyNameApplied) {
    setEphemeralSetting('auth-key', undefined);
    if (currentAuthKeyName) {
      setEphemeralSetting('auth-key-name', currentAuthKeyName);
    }
  }
}

async function applyBaseUrlProviderUpdate(
  config: { getEphemeralSetting: (key: string) => unknown },
  profileEphemeralSettings: Record<string, unknown>,
  infoMessages: string[],
): Promise<string | undefined> {
  const currentBaseUrl = config.getEphemeralSetting('base-url') as
    | string
    | undefined;
  if (currentBaseUrl) {
    logger.debug(
      () => `[profile] updating provider with base-url => ${currentBaseUrl}`,
    );
    const { message, baseUrl } =
      await updateActiveProviderBaseUrl(currentBaseUrl);
    if (message) infoMessages.push(message);
    return baseUrl ?? currentBaseUrl;
  }
  if (
    !hasExplicitProfileDirective(profileEphemeralSettings, ['base-url']) ||
    hasExplicitClearDirective(profileEphemeralSettings, ['base-url'])
  ) {
    const { message } = await updateActiveProviderBaseUrl(null);
    if (message) infoMessages.push(message);
  }
  return undefined;
}

async function applyProviderAuthUpdates(
  config: { getEphemeralSetting: (key: string) => unknown },
  sanitizedProfile: Profile,
  authResult: AuthWiringResult,
  infoMessages: string[],
): Promise<ProviderAuthUpdateResult> {
  const profileEphemeralSettings =
    getProfileEphemeralSettings(sanitizedProfile);
  await applyAuthProviderUpdate(
    config,
    profileEphemeralSettings,
    authResult.authKeyApplied,
    authResult.resolvedAuthKeyfilePath,
    authResult.authKeyNameApplied,
    infoMessages,
  );
  return {
    appliedBaseUrl: await applyBaseUrlProviderUpdate(
      config,
      profileEphemeralSettings,
      infoMessages,
    ),
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
  const { config, providerManager } = runtimeServices;
  await maybeRegisterLoadBalancerProfile(
    profileInput,
    _options,
    runtimeServices,
    lbLogger,
  );
  const context = buildProfileApplicationContext(profileInput, runtimeServices);
  const {
    actualProfile,
    sanitizedProfile,
    requestedProvider,
    selection,
    warnings,
    targetProviderName,
    providerRecord,
    authDeps,
  } = context;

  clearProfileEphemerals(config, sanitizedProfile);
  const authResult = await wireAuthBeforeSwitch(sanitizedProfile, authDeps);
  const providerSwitch = await switchProviderForProfile(targetProviderName);
  const infoMessages = providerSwitch.infoMessages;
  const { appliedBaseUrl } = await applyProviderAuthUpdates(
    config,
    sanitizedProfile,
    authResult,
    infoMessages,
  );

  // STEP 5: Apply non-auth ephemerals
  applyNonAuthEphemerals(sanitizedProfile);

  // STEP 6: Apply model and modelParams
  const { appliedModelName, provider } = await applyModelAndParams({
    sanitizedProfile,
    actualProfile,
    providerRecord,
    config,
    providerManager,
    targetProviderName,
  });

  if (appliedModelName) {
    infoMessages.push(
      `Model set to '${appliedModelName}' for provider '${provider.name}'.`,
    );
  }

  const resolvedBaseUrl =
    appliedBaseUrl ??
    (config.getEphemeralSetting('base-url') as string | undefined);

  return {
    providerName: provider.name,
    modelName: appliedModelName,
    infoMessages,
    warnings,
    providerChanged: providerSwitch.changed,
    didFallback: selection.didFallback,
    requestedProvider,
    baseUrl: resolvedBaseUrl,
  };
}
