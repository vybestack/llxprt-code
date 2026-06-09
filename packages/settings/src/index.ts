/**
 * @plan PLAN-20260608-ISSUE1588.P05
 * @requirement REQ-SET-001
 *
 * Settings package public API barrel with real P05 implementations.
 */

export { SettingsService } from './settings/SettingsService.js';

export {
  resolveAlias,
  getSettingSpec,
  normalizeSetting,
  separateSettings,
  validateSetting,
  parseSetting,
  getProfilePersistableKeys,
  getSettingHelp,
  getCompletionOptions,
  getAllSettingKeys,
  getValidationHelp,
  getAutocompleteSuggestions,
  getProtectedSettingKeys,
  getProviderConfigKeys,
  getDirectSettingSpecs,
  SETTINGS_REGISTRY,
} from './settings/settingsRegistry.js';
export type {
  ValidationResult,
  SettingSpec,
  SeparatedSettings,
  DirectSettingSpec,
} from './settings/settingsRegistry.js';

export {
  getSettingsService,
  registerSettingsService,
  resetSettingsService,
} from './settings/settingsServiceInstance.js';

export { ProfileManager } from './profiles/ProfileManager.js';
export type {
  Profile,
  StandardProfile,
  LoadBalancerProfile,
  ModelParams,
  EphemeralSettings,
  AuthConfig,
} from './profiles/types.js';
export {
  AuthConfigSchema,
  isLoadBalancerProfile,
  isStandardProfile,
  hasAuthConfig,
  isOAuthProfile,
} from './profiles/types.js';

export { Storage } from './storage/Storage.js';
export {
  LLXPRT_DIR,
  PROVIDER_ACCOUNTS_FILENAME,
  OAUTH_FILE,
} from './storage/Storage.js';
