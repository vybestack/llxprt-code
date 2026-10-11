import { resolveRequestedModel } from './profile-model-selection.js';
import type { ModelSelectionOperations } from './providerMutations.js';
import {
  selectAvailableProvider,
  type ProviderSelectionResult,
} from './profile-application/providerSelection.js';
export {
  selectAvailableProvider,
  type ProviderSelectionResult,
} from './profile-application/providerSelection.js';
import { switchProviderForProfile } from './profile-application/switchProfileProvider.js';
import type {
  Config,
  RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import { isLoadBalancerProfile } from '@vybestack/llxprt-code-settings/profiles/types.js';
import { isInternalSettingKey } from '@vybestack/llxprt-code-settings/settings/settingsRegistry.js';
import type {
  Profile,
  ModelParams,
  ProfileManager,
  SettingsService,
} from '@vybestack/llxprt-code-settings';
import * as fs from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  clearActiveModelParam,
  getActiveModelParams,
  setActiveModelParam,
} from './providerModelParameters.js';
import {
  setActiveModel,
  updateActiveProviderApiKey,
  updateActiveProviderBaseUrl,
} from './providerMutations.js';
import type { ProviderSwitcher } from './providerSwitch.js';
import { createProviderKeyStorage } from '../auth/index.js';
import {
  getProfileEphemeralSettings,
  getProfileModelParams,
  getStringValue,
  isPositiveContextLimit,
} from './profile-application/profileAccessors.js';
import { maybeRegisterLoadBalancerProfile } from './profile-application/loadBalancerProfile.js';
import {
  collectProfileValueWarnings,
  formatProfileValueWarnings,
} from './profile-application/profileValueWarnings.js';

export interface ProfileApplicationOptions {
  profileName?: string;
  profileManager?: Pick<ProfileManager, 'loadProfile'>;
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

function logger(): DebugLogger {
  return new DebugLogger('llxprt:runtime:profile');
}

type ProfileEphemeralWriter = (key: string, value: unknown) => void;

interface AuthWiringDeps {
  setEphemeral: ProfileEphemeralWriter;
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

interface NamedAuthResolution {
  authKey: string | undefined;
  authKeyNameApplied: boolean;
  trimmedKeyName: string;
}

/**
 * Resolves a named key from secure storage without mutating any application
 * state. Used as a fail-fast preflight: callers run this BEFORE clearing prior
 * profile state so an unresolved name rejects before any mutation (issue
 * #2916). The resolved name is returned so the caller can install the
 * `auth-key-name` reference only after the prior state is cleared.
 */
async function resolveNamedAuthKey(
  authKeyName: unknown,
): Promise<NamedAuthResolution> {
  if (typeof authKeyName !== 'string' || authKeyName.trim() === '') {
    return {
      authKey: undefined,
      authKeyNameApplied: false,
      trimmedKeyName: '',
    };
  }
  const trimmedKeyName = authKeyName.trim();
  let resolvedAuthKey: string | null;
  try {
    resolvedAuthKey = await createProviderKeyStorage().getKey(trimmedKeyName);
  } catch (error) {
    // A retrieval fault is not a missing key: the key may well be stored and
    // the keychain merely locked or unreadable. Suggesting '/key save' here
    // would invite the user to overwrite a good key and leave the real fault
    // unaddressed, so the remedy hint belongs only on the not-found path.
    throw new Error(
      `Failed to resolve auth-key-name '${trimmedKeyName}': ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
  if (resolvedAuthKey && resolvedAuthKey.trim() !== '') {
    logger().debug(
      () =>
        `[profile] resolved auth-key-name '${trimmedKeyName}' before switch`,
    );
    return {
      authKey: resolvedAuthKey.trim(),
      authKeyNameApplied: true,
      trimmedKeyName,
    };
  }
  throw new Error(
    `Named key '${trimmedKeyName}' not found. Use '/key save ${trimmedKeyName} <key>' to store it.`,
  );
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
    logger().debug(
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
  deps.setEphemeral('auth-key', authKey);
  deps.setProviderApiKey(authKey);
}

function applyAuthKeyfilePath(filePath: string, deps: AuthWiringDeps): void {
  deps.setEphemeral('auth-keyfile', filePath);
  deps.setProviderApiKeyfile(filePath);
}

async function wireAuthBeforeSwitch(
  sanitizedProfile: Profile,
  deps: AuthWiringDeps,
  previousKeys: readonly string[],
): Promise<AuthWiringResult> {
  const namedAuth = await resolveNamedAuthKey(
    getProfileEphemeralSettings(sanitizedProfile)['auth-key-name'],
  );
  const setEphemeralSetting = deps.setEphemeral;
  clearProfileEphemerals(previousKeys, sanitizedProfile, setEphemeralSetting);
  const { targetProviderName, warnings, settingsService, setProviderBaseUrl } =
    deps;
  const ephemeralSettings = getProfileEphemeralSettings(sanitizedProfile);
  let authKeyApplied = namedAuth.authKey !== undefined;
  const authKeyNameApplied = namedAuth.authKeyNameApplied;
  let resolvedAuthKeyfilePath: string | null = null;

  if (namedAuth.authKey !== undefined) {
    applyResolvedAuthKey(namedAuth.authKey, deps);
  }
  if (namedAuth.authKeyNameApplied) {
    setEphemeralSetting('auth-key-name', namedAuth.trimmedKeyName);
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
    logger().debug(
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
    logger().debug(
      () =>
        `[profile] applied auth to SettingsService before switch (direct key)`,
    );
  }

  const baseUrl = getStringValue(ephemeralSettings, 'base-url');
  if (baseUrl !== undefined) {
    setEphemeralSetting('base-url', baseUrl);
    setProviderBaseUrl(baseUrl);
    logger().debug(
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

const PRE_APPLIED_EPHEMERAL_KEYS: readonly string[] = Object.freeze([
  'auth-key',
  'auth-key-name',
  'auth-keyfile',
  'base-url',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_CLOUD_LOCATION',
]);

function applyNonAuthEphemerals(
  sanitizedProfile: Profile,
  setEphemeralSetting: ProfileEphemeralWriter,
): void {
  const otherEphemerals = Object.entries(
    getProfileEphemeralSettings(sanitizedProfile),
  ).filter(
    ([key]) =>
      !PRE_APPLIED_EPHEMERAL_KEYS.includes(key) && !isInternalSettingKey(key),
  );

  for (const [key, value] of otherEphemerals) {
    logger().debug(
      () => `[profile] applying ephemeral '${key}' => ${JSON.stringify(value)}`,
    );
    // null means "explicitly unset" – the profile wants to clear this key
    setEphemeralSetting(key, value === null ? undefined : value);
  }

  if (
    isLoadBalancerProfile(sanitizedProfile) &&
    isPositiveContextLimit(sanitizedProfile.contextLimit)
  ) {
    logger().debug(
      () =>
        `[profile] applying load balancer contextLimit => ${sanitizedProfile.contextLimit}`,
    );
    setEphemeralSetting('context-limit', sanitizedProfile.contextLimit);
  }
}

interface ModelAndParamsDeps {
  modelSelection: ModelSelectionOperations;
  sanitizedProfile: Profile;
  actualProfile: Profile;
  providerRecord: { getDefaultModel?: () => string } | null | undefined;
  settingsService: SettingsService;
  providerManager: Pick<RuntimeProviderManager, 'getActiveProvider'>;
  targetProviderName: string;
}

interface ModelAndParamsResult {
  appliedModelName: string;
  provider: { name: string };
}

function applyProfileModelParams(
  sanitizedProfile: Profile,
  settingsService: SettingsService,
  providerName: string | undefined,
): void {
  const profileParams = getProfileModelParams(sanitizedProfile);
  const existingParams = getActiveModelParams(settingsService, providerName);
  for (const [key, value] of Object.entries(profileParams)) {
    setActiveModelParam(key, value, settingsService, providerName);
  }
  for (const key of Object.keys(existingParams)) {
    if (!(key in profileParams)) {
      clearActiveModelParam(key, settingsService, providerName);
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
    providerManager,
    targetProviderName,
    settingsService,
  } = deps;

  const modelToSet = resolveRequestedModel(
    sanitizedProfile,
    actualProfile,
    providerRecord,
    deps.modelSelection,
    providerManager,
  );
  const modelResult = await setActiveModel(
    modelToSet,
    deps.modelSelection,
    settingsService,
    providerManager.getActiveProvider(),
  );
  applyProfileModelParams(
    sanitizedProfile,
    deps.settingsService,
    providerManager.getActiveProvider()?.name,
  );

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
    setProviderApiKey: (apiKey) => setProviderSetting('auth-key', apiKey),
    setProviderApiKeyfile: (filePath) =>
      setProviderSetting('auth-keyfile', filePath),
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
  for (const key of [
    'auth-key',
    'apiKey',
    'api-key',
    'auth-keyfile',
    'apiKeyfile',
    'api-keyfile',
  ]) {
    if (key in sanitizedModelParams) {
      delete sanitizedModelParams[key as keyof ModelParams];
    }
  }
}

function clearProfileEphemerals(
  previousKeys: readonly string[],
  sanitizedProfile: Profile,
  setEphemeralSetting: ProfileEphemeralWriter,
): void {
  const previousEphemeralKeys = previousKeys;
  const sanitizedEphemeralSettings =
    getProfileEphemeralSettings(sanitizedProfile);
  const mutatedEphemeralKeys = new Set<string>([
    ...previousEphemeralKeys.filter(
      (key) =>
        !['activeProvider', 'currentProfile', 'defaultProfile'].includes(key),
    ),
    ...Object.keys(sanitizedEphemeralSettings),
    'auth-key',
    'auth-key-name',
    'auth-keyfile',
    'base-url',
  ]);
  for (const key of mutatedEphemeralKeys) {
    setEphemeralSetting(key, undefined);
  }
}

function buildProfileApplicationContext(
  profileInput: Profile,
  providerManager: RuntimeProviderManager,
  settingsService: SettingsService,
  setEphemeral: ProfileEphemeralWriter,
  profileName: string | undefined,
): ProfileApplicationContext {
  const actualProfile = profileInput;
  const availableProviders = providerManager.listProviders();
  const requestedProvider = isLoadBalancerProfile(actualProfile)
    ? 'load-balancer'
    : actualProfile.provider;
  logger().debug(
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
  // Advisory only: report values whose type the registry already knows to be
  // wrong, so a malformed profile is attributed to the profile rather than to
  // the provider that rejects it (issue #2896). Unknown keys never warn and
  // nothing is dropped or refused.
  warnings.push(
    ...formatProfileValueWarnings(
      profileName ?? actualProfile.provider,
      collectProfileValueWarnings(
        getProfileModelParams(actualProfile),
        getProfileEphemeralSettings(actualProfile),
      ),
    ),
  );
  return {
    actualProfile,
    sanitizedProfile,
    requestedProvider,
    selection,
    warnings,
    targetProviderName,
    providerRecord,
    authDeps: {
      setEphemeral,
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
    logger().debug(
      () => `[profile] provider selection warnings: ${warnings.join('; ')}`,
    );
  }
  logger().debug(
    () =>
      `[profile] target provider '${targetProviderName}' (requested='${requestedProvider}')`,
  );
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
  config: Config,
  settingsService: SettingsService,
  profileEphemeralSettings: Record<string, unknown>,
  authKeyApplied: boolean,
  resolvedAuthKeyfilePath: string | null,
  authKeyNameApplied: boolean,
  infoMessages: string[],
  setEphemeralSetting: ProfileEphemeralWriter,
  activeProvider: ReturnType<RuntimeProviderManager['getActiveProvider']>,
): Promise<void> {
  const rawKey = settingsService.get('auth-key');
  const currentAuthKey = typeof rawKey === 'string' ? rawKey : undefined;
  const rawKeyName = settingsService.get('auth-key-name');
  const currentAuthKeyName =
    authKeyNameApplied && typeof rawKeyName === 'string'
      ? rawKeyName
      : undefined;
  if (currentAuthKey) {
    logger().debug(() => {
      const displayValue = `***redacted*** (len=${currentAuthKey.length})`;
      return `[profile] updating provider with auth-key => ${displayValue}`;
    });
    const { message } = await updateActiveProviderApiKey(
      currentAuthKey,
      { setEphemeralSetting },
      settingsService,
      activeProvider,
    );
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
    const { message } = await updateActiveProviderApiKey(
      null,
      { setEphemeralSetting },
      settingsService,
      activeProvider,
    );
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
  setEphemeralSetting: ProfileEphemeralWriter,
  profileEphemeralSettings: Record<string, unknown>,
  infoMessages: string[],
  settingsService: SettingsService,
  providerName: string,
): Promise<string | undefined> {
  const rawUrl = settingsService.get('base-url');
  const currentBaseUrl = typeof rawUrl === 'string' ? rawUrl : undefined;
  if (currentBaseUrl) {
    logger().debug(
      () => `[profile] updating provider with base-url => ${currentBaseUrl}`,
    );
    const { message, baseUrl } = await updateActiveProviderBaseUrl(
      currentBaseUrl,
      { setEphemeralSetting },
      settingsService,
      providerName,
    );
    if (message) infoMessages.push(message);
    return baseUrl ?? currentBaseUrl;
  }
  if (
    !hasExplicitProfileDirective(profileEphemeralSettings, ['base-url']) ||
    hasExplicitClearDirective(profileEphemeralSettings, ['base-url'])
  ) {
    const { message } = await updateActiveProviderBaseUrl(
      null,
      { setEphemeralSetting },
      settingsService,
      providerName,
    );
    if (message) infoMessages.push(message);
  }
  return undefined;
}

async function applyProviderAuthUpdates(
  config: Config,
  sanitizedProfile: Profile,
  authResult: AuthWiringResult,
  infoMessages: string[],
  settingsService: SettingsService,
  providerName: string,
  setEphemeral: ProfileEphemeralWriter,
  activeProvider: ReturnType<RuntimeProviderManager['getActiveProvider']>,
): Promise<ProviderAuthUpdateResult> {
  const profileEphemeralSettings =
    getProfileEphemeralSettings(sanitizedProfile);
  await applyAuthProviderUpdate(
    config,
    settingsService,
    profileEphemeralSettings,
    authResult.authKeyApplied,
    authResult.resolvedAuthKeyfilePath,
    authResult.authKeyNameApplied,
    infoMessages,
    setEphemeral,
    activeProvider,
  );
  return {
    appliedBaseUrl: await applyBaseUrlProviderUpdate(
      setEphemeral,
      profileEphemeralSettings,
      infoMessages,
      settingsService,
      providerName,
    ),
  };
}

export interface ProfileParameterOperations {
  readonly readEndpoint: () => unknown;
  readonly applyParameter: (key: string, value: unknown) => void;
}

function normalizeProfileEndpoint(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export async function applyProfileCascade(
  profileInput: Profile,
  options: ProfileApplicationOptions,
  config: Config,
  settingsService: SettingsService,
  providerManager: RuntimeProviderManager,
  profileManager: Pick<ProfileManager, 'loadProfile'>,
  switchProvider: ProviderSwitcher,
  modelSelection: ModelSelectionOperations,
  parameters: ProfileParameterOperations,
): Promise<ProfileApplicationResult> {
  const setEphemeral: ProfileEphemeralWriter = parameters.applyParameter;
  const copiedProfile = structuredClone(profileInput);
  await maybeRegisterLoadBalancerProfile(
    copiedProfile,
    options,
    providerManager,
    options.profileManager ?? profileManager,
    new DebugLogger('llxprt:loadbalancer'),
  );
  const context = buildProfileApplicationContext(
    copiedProfile,
    providerManager,
    settingsService,
    setEphemeral,
    options.profileName,
  );
  const { sanitizedProfile, targetProviderName, authDeps } = context;

  const authResult = await wireAuthBeforeSwitch(
    sanitizedProfile,
    authDeps,
    Object.keys(settingsService.getAllGlobalSettings()),
  );
  const providerSwitch = await switchProviderForProfile(
    targetProviderName,
    switchProvider,
  );
  const infoMessages = providerSwitch.infoMessages;
  const { appliedBaseUrl } = await applyProviderAuthUpdates(
    config,
    sanitizedProfile,
    authResult,
    infoMessages,
    settingsService,
    targetProviderName,
    setEphemeral,
    providerManager.getActiveProvider(),
  );

  // STEP 5: Apply model and modelParams
  const { appliedModelName, provider } = await applyModelAndParams({
    modelSelection,
    settingsService,
    sanitizedProfile,
    actualProfile: context.actualProfile,
    providerRecord: context.providerRecord,
    providerManager,
    targetProviderName,
  });

  // STEP 6: Apply non-auth ephemerals after model defaults so profile values win
  applyNonAuthEphemerals(sanitizedProfile, setEphemeral);

  if (appliedModelName) {
    infoMessages.push(
      `Model set to '${appliedModelName}' for provider '${provider.name}'.`,
    );
  }

  const resolvedBaseUrl =
    appliedBaseUrl ?? normalizeProfileEndpoint(parameters.readEndpoint());

  return {
    providerName: provider.name,
    modelName: appliedModelName,
    infoMessages,
    warnings: context.warnings,
    providerChanged: providerSwitch.changed,
    didFallback: context.selection.didFallback,
    requestedProvider: context.requestedProvider,
    baseUrl: resolvedBaseUrl,
  };
}
