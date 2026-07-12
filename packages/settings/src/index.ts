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
  getInternalSettingKeys,
  isInternalSettingKey,
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
// Cohesive public profile-lock and write API. Internal lock handle/path/read/
// temp/delete helpers are NOT re-exported. Consumers that need canonical
// profile repair use repairCanonicalProfiles (settings-owned cohesive API).
// withProfilesLockSync is exported for the migration copy phase which must
// coordinate with ProfileManager writes.
export {
  withProfilesLockSync,
  writeProfileFile,
} from './profiles/profileStore.js';
export type {
  ProfileWriteMode,
  ProfileWriteResult,
} from './profiles/profileStore.js';
export {
  repairCanonicalProfiles,
  CORRUPT_PROVIDER,
} from './profiles/canonicalProfileRepair.js';
export type {
  CanonicalRepairOutcome,
  CanonicalRepairResult,
} from './profiles/canonicalProfileRepair.js';
export { parseProfile } from './settings/validation.js';
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
