import { LoadedSettings, SettingScope, Settings } from '../config/settings.js';

/**
 * Recursively sets a value in a nested object using a key path array.
 * This is a direct copy of the private function from settingsUtils to avoid import issues.
 */
function setNestedValue(
  obj: Record<string, unknown>,
  path: string[],
  value: unknown,
): Record<string, unknown> {
  const [first, ...rest] = path;
  if (!first) {
    return obj;
  }

  if (rest.length === 0) {
    obj[first] = value;
    return obj;
  }

  if (!obj[first] || typeof obj[first] !== 'object') {
    obj[first] = {};
  }

  setNestedValue(obj[first] as Record<string, unknown>, rest, value);
  return obj;
}

/**
 * Saves a single setting to the appropriate scope
 * This utility correctly handles nested settings by updating only the specific key
 * within the existing object structure.
 */
export function saveSingleSetting(
  settingKey: string,
  value: unknown,
  loadedSettings: LoadedSettings,
  scope: SettingScope,
): void {
  // Skip saving coreToolSettings as it's UI-only
  if (
    settingKey === 'coreToolSettings' ||
    settingKey.startsWith('coreToolSettings.')
  ) {
    return;
  }

  const pathParts = settingKey.split('.');

  if (pathParts.length === 1) {
    // It's a top-level setting, the original logic is fine.
    const topLevelKey = pathParts[0] as keyof Settings;
    loadedSettings.setValue(
      scope,
      topLevelKey,
      value as Settings[keyof Settings],
    );
    return;
  }

  // It's a nested setting like 'fileFiltering.respectGitIgnore'
  // We need to get the current full object for the parent key, update the nested value within it,
  // and then save the entire parent object back.
  const parentKey = pathParts[0] as keyof Settings;
  const currentParentObject =
    loadedSettings.forScope(scope).settings[parentKey];

  // Create a deep copy of the parent object to modify
  const newParentObject = JSON.parse(JSON.stringify(currentParentObject || {}));

  // Use the copied setNestedValue helper to update the specific nested key
  setNestedValue(newParentObject, pathParts.slice(1), value);

  // Save the updated parent object back to the settings file
  loadedSettings.setValue(
    scope,
    parentKey,
    newParentObject as Settings[keyof Settings],
  );
}
