import type { Settings } from './settingsSchema.js';

export function migrateLegacyInteractiveShellSetting(settings: Settings): void {
  const tools = settings.tools;
  if (!tools || typeof tools !== 'object') {
    return;
  }

  const toolSettings = tools as Record<string, unknown>;
  let legacyValue: boolean | undefined;

  const legacyUsePty = toolSettings['usePty'];
  if (typeof legacyUsePty === 'boolean') {
    legacyValue = legacyUsePty;
    delete toolSettings['usePty'];
  }

  const legacyShell = toolSettings['shell'];
  if (typeof legacyShell === 'object' && legacyShell !== null) {
    const shellSettings = legacyShell as Record<string, unknown>;
    const shellFlag = shellSettings['enableInteractiveShell'];
    if (typeof shellFlag === 'boolean') {
      legacyValue = shellFlag;
      delete shellSettings['enableInteractiveShell'];
      if (Object.keys(shellSettings).length === 0) {
        delete toolSettings['shell'];
      }
    }
  }

  if (
    legacyValue !== undefined &&
    typeof settings.shouldUseNodePtyShell !== 'boolean'
  ) {
    settings.shouldUseNodePtyShell = legacyValue;
  }
}

export function migrateHooksConfig(settings: Settings): void {
  const hooks = settings.hooks as Record<string, unknown> | undefined;
  if (!hooks) return;

  const needsMigration =
    'enabled' in hooks || 'disabled' in hooks || 'notifications' in hooks;

  if (!needsMigration) return;

  const rawHooksConfig = (settings as Record<string, unknown>)['hooksConfig'];
  const hooksConfig =
    typeof rawHooksConfig === 'object' && rawHooksConfig !== null
      ? (rawHooksConfig as Record<string, unknown>)
      : {};
  const newHooks: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(hooks)) {
    if (key === 'enabled' || key === 'disabled' || key === 'notifications') {
      if (!(key in hooksConfig)) {
        hooksConfig[key] = value;
      }
    } else {
      newHooks[key] = value;
    }
  }

  (settings as Record<string, unknown>)['hooksConfig'] = hooksConfig;
  (settings as Record<string, unknown>)['hooks'] = newHooks;
}
