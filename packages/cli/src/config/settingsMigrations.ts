import type { Settings } from './settingsSchema.js';
import { SettingScope, type LoadedSettings } from './settings.js';

function migrateInvertedRootSetting(
  rawSettings: Record<string, unknown>,
  loadedSettings: LoadedSettings,
  scope: SettingScope,
  oldKey: string,
  newKey: keyof Settings,
  removeDeprecated: boolean,
): boolean {
  if (typeof rawSettings[oldKey] !== 'boolean') {
    return false;
  }
  let modified = false;
  const hasNewValue = typeof rawSettings[newKey] === 'boolean';
  if (!hasNewValue) {
    loadedSettings.setValue(scope, newKey, !rawSettings[oldKey]);
    modified = true;
  }
  if (removeDeprecated) {
    loadedSettings.setValue(scope, oldKey as keyof Settings, undefined);
    modified = true;
  }
  return modified;
}

function migrateNestedInvertedSetting(
  loadedSettings: LoadedSettings,
  scope: SettingScope,
  sectionKey: keyof Settings,
  oldKey: string,
  newKey: string,
  removeDeprecated: boolean,
): boolean {
  const rawSettings = loadedSettings.forScope(scope).settings as Record<
    string,
    unknown
  >;
  const section = rawSettings[sectionKey as string] as
    | Record<string, unknown>
    | undefined;
  if (section == null || typeof section[oldKey] !== 'boolean') {
    return false;
  }
  const hasNewValue = typeof section[newKey] === 'boolean';
  if (hasNewValue && !removeDeprecated) {
    return false;
  }
  const newSection: Record<string, unknown> = { ...section };
  if (!hasNewValue) {
    newSection[newKey] = !section[oldKey];
  }
  if (removeDeprecated) {
    delete newSection[oldKey];
  }
  loadedSettings.setValue(scope, sectionKey, newSection);
  return true;
}

function migrateUiAccessibility(
  loadedSettings: LoadedSettings,
  scope: SettingScope,
  removeDeprecated: boolean,
): boolean {
  const rawSettings = loadedSettings.forScope(scope).settings as Record<
    string,
    unknown
  >;
  const uiSettings = rawSettings['ui'] as Record<string, unknown> | undefined;
  const uiAccessibility = uiSettings?.['accessibility'] as
    | Record<string, unknown>
    | undefined;
  const hasUiDeprecated =
    uiSettings != null &&
    typeof uiSettings['disableLoadingPhrases'] === 'boolean';
  const hasNestedDeprecated =
    uiAccessibility != null &&
    typeof uiAccessibility['disableLoadingPhrases'] === 'boolean';
  if (uiSettings == null || (!hasUiDeprecated && !hasNestedDeprecated)) {
    return false;
  }
  const hasNewValue =
    typeof uiAccessibility?.['enableLoadingPhrases'] === 'boolean';
  if (hasNewValue && !removeDeprecated) {
    return false;
  }
  const newUiAccessibility: Record<string, unknown> = {
    ...(uiAccessibility ?? {}),
  };
  if (!hasNewValue) {
    const nestedVal =
      uiAccessibility != null
        ? uiAccessibility['disableLoadingPhrases']
        : undefined;
    const uiVal = uiSettings['disableLoadingPhrases'];
    const deprecatedValue: boolean = hasNestedDeprecated
      ? nestedVal === true
      : uiVal === true;
    newUiAccessibility['enableLoadingPhrases'] = !deprecatedValue;
  }
  if (removeDeprecated) {
    delete newUiAccessibility['disableLoadingPhrases'];
  }
  const newUiSettings: Record<string, unknown> = {
    ...uiSettings,
    accessibility: newUiAccessibility,
  };
  if (removeDeprecated) {
    delete newUiSettings['disableLoadingPhrases'];
  }
  loadedSettings.setValue(scope, 'ui', newUiSettings);
  return true;
}

function migrateScopeDeprecatedSettings(
  loadedSettings: LoadedSettings,
  scope: SettingScope,
  removeDeprecated: boolean,
): boolean {
  const rawSettings = loadedSettings.forScope(scope).settings as Record<
    string,
    unknown
  >;
  const rootMigrations = [
    migrateInvertedRootSetting(
      rawSettings,
      loadedSettings,
      scope,
      'disableAutoUpdate',
      'enableAutoUpdate',
      removeDeprecated,
    ),
    migrateInvertedRootSetting(
      rawSettings,
      loadedSettings,
      scope,
      'disableUpdateNag',
      'enableAutoUpdateNotification',
      removeDeprecated,
    ),
  ];
  return [
    ...rootMigrations,
    migrateNestedInvertedSetting(
      loadedSettings,
      scope,
      'accessibility',
      'disableLoadingPhrases',
      'enableLoadingPhrases',
      removeDeprecated,
    ),
    migrateNestedInvertedSetting(
      loadedSettings,
      scope,
      'fileFiltering',
      'disableFuzzySearch',
      'enableFuzzySearch',
      removeDeprecated,
    ),
    migrateUiAccessibility(loadedSettings, scope, removeDeprecated),
  ].some(Boolean);
}

export function migrateDeprecatedSettings(
  loadedSettings: LoadedSettings,
  removeDeprecated = false,
): boolean {
  let anyModified = false;
  for (const scope of [
    SettingScope.User,
    SettingScope.Workspace,
    SettingScope.System,
    SettingScope.SystemDefaults,
  ]) {
    anyModified =
      migrateScopeDeprecatedSettings(loadedSettings, scope, removeDeprecated) ||
      anyModified;
  }
  return anyModified;
}
