export const PLAN_MARKER = '@plan:PLAN-20260126-SETTINGS-SEPARATION.P03';

export {
  type SettingCategory,
  type SettingSpec,
  type ValidationResult,
  type SeparatedSettings,
  SETTINGS_REGISTRY,
  separateSettings,
  getSettingSpec,
  resolveAlias,
  validateSetting,
  normalizeSetting,
  parseSetting,
  getProfilePersistableKeys,
  getSettingHelp,
  getCompletionOptions,
  getAllSettingKeys,
  getValidationHelp,
  getAutocompleteSuggestions,
} from './settingsRegistry.js';
