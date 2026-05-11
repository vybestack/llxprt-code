import {
  type MergedSettings,
  type SettingDefinition,
  type Settings,
  SETTINGS_SCHEMA,
} from './settingsSchema.js';

const LEGACY_UI_KEYS = [
  'usageStatisticsEnabled',
  'contextFileName',
  'memoryImportFormat',
  'ideMode',
  'hideWindowTitle',
  'showStatusInTitle',
  'hideTips',
  'hideBanner',
  'hideFooter',
  'hideCWD',
  'hideSandboxStatus',
  'hideModelInfo',
  'hideContextSummary',
  'showMemoryUsage',
  'showLineNumbers',
  'showCitations',
  'hasSeenIdeIntegrationNudge',
] as const;

type SettingsLayer = Partial<Settings>;
type MergeLayers = {
  schemaDefaults: SettingsLayer;
  systemDefaults: SettingsLayer;
  user: SettingsLayer;
  workspace: SettingsLayer;
  system: SettingsLayer;
};

function extractDefaults(
  schema: Record<string, SettingDefinition>,
  target: Record<string, unknown>,
): void {
  for (const [key, schemaEntry] of Object.entries(schema)) {
    if (
      'default' in schemaEntry &&
      schemaEntry.default !== undefined &&
      key !== 'coreToolSettings'
    ) {
      target[key] = schemaEntry.default;
    }
    if (
      schemaEntry.type === 'object' &&
      'properties' in schemaEntry &&
      schemaEntry.properties
    ) {
      target[key] ??= {};
      extractDefaults(
        schemaEntry.properties as Record<string, SettingDefinition>,
        target[key] as Record<string, unknown>,
      );
    }
  }
}

function getSchemaDefaults(): Partial<Settings> {
  const defaults: Partial<Settings> = {};
  extractDefaults(SETTINGS_SCHEMA, defaults as Record<string, unknown>);
  return defaults;
}

function extractLegacyUiKeys(settings: SettingsLayer): Record<string, unknown> {
  const legacy: Record<string, unknown> = {};
  for (const key of LEGACY_UI_KEYS) {
    if (
      key in settings &&
      settings[key as keyof Settings] !== undefined &&
      !(settings.ui && key in settings.ui)
    ) {
      legacy[key] = settings[key as keyof Settings];
    }
  }
  return legacy;
}

function getPrioritizedTheme({
  schemaDefaults,
  systemDefaults,
  user,
  workspace,
  system,
}: MergeLayers): MergedSettings['ui']['theme'] {
  const themeSources = [
    workspace.ui?.theme,
    user.ui?.theme,
    system.ui?.theme,
    systemDefaults.ui?.theme,
    schemaDefaults.ui?.theme,
  ];
  return themeSources.find((theme) => theme !== undefined);
}

function mergeUiSettings(layers: MergeLayers): MergedSettings['ui'] {
  const { schemaDefaults, systemDefaults, user, workspace, system } = layers;
  const ui = {
    ...(schemaDefaults.ui ?? {}),
    ...extractLegacyUiKeys(systemDefaults),
    ...(systemDefaults.ui ?? {}),
    ...extractLegacyUiKeys(user),
    ...(user.ui ?? {}),
    ...extractLegacyUiKeys(workspace),
    ...(workspace.ui ?? {}),
    ...extractLegacyUiKeys(system),
    ...(system.ui ?? {}),
    customThemes: {
      ...(systemDefaults.ui?.customThemes ?? {}),
      ...(user.ui?.customThemes ?? {}),
      ...(workspace.ui?.customThemes ?? {}),
      ...(system.ui?.customThemes ?? {}),
    },
  };
  ui.theme = getPrioritizedTheme(layers);
  return ui;
}

function mergeExtensionArray(
  sources: Array<Settings['extensions'] | undefined>,
  key: 'disabled' | 'workspacesWithMigrationNudge',
): string[] {
  return [...new Set(sources.flatMap((source) => source?.[key] ?? []))];
}

function mergeExtensions({
  systemDefaults,
  user,
  workspace,
  system,
}: MergeLayers): MergedSettings['extensions'] {
  const extensionSources = [
    systemDefaults.extensions,
    user.extensions,
    workspace.extensions,
    system.extensions,
  ];
  return {
    ...(systemDefaults.extensions ?? {}),
    ...(user.extensions ?? {}),
    ...(workspace.extensions ?? {}),
    ...(system.extensions ?? {}),
    disabled: mergeExtensionArray(extensionSources, 'disabled'),
    workspacesWithMigrationNudge: mergeExtensionArray(
      extensionSources,
      'workspacesWithMigrationNudge',
    ),
  };
}

function mergeObjectSection<K extends keyof Settings>(
  key: K,
  schemaDefaults: SettingsLayer,
  systemDefaults: SettingsLayer,
  user: SettingsLayer,
  workspace: SettingsLayer,
  system: SettingsLayer,
): NonNullable<Settings[K]> {
  return {
    ...((schemaDefaults[key] as object | undefined) ?? {}),
    ...((systemDefaults[key] as object | undefined) ?? {}),
    ...((user[key] as object | undefined) ?? {}),
    ...((workspace[key] as object | undefined) ?? {}),
    ...((system[key] as object | undefined) ?? {}),
  } as NonNullable<Settings[K]>;
}

function mergeBaseSettings(layers: MergeLayers): Partial<MergedSettings> {
  const { schemaDefaults, systemDefaults, user, workspace, system } = layers;
  return {
    ...schemaDefaults,
    ...systemDefaults,
    ...user,
    ...workspace,
    ...system,
  };
}

function applyCoreMergedSections(
  merged: Partial<MergedSettings>,
  layers: MergeLayers,
): void {
  const { schemaDefaults, systemDefaults, user, workspace, system } = layers;
  merged.ui = mergeUiSettings(layers);
  merged.mcpServers = mergeObjectSection(
    'mcpServers',
    {},
    systemDefaults,
    user,
    workspace,
    system,
  );
  merged.includeDirectories = [
    ...(systemDefaults.includeDirectories ?? []),
    ...(user.includeDirectories ?? []),
    ...(workspace.includeDirectories ?? []),
    ...(system.includeDirectories ?? []),
  ];
  merged.chatCompression = mergeObjectSection(
    'chatCompression',
    {},
    systemDefaults,
    user,
    workspace,
    system,
  );
  merged.coreToolSettings = schemaDefaults.coreToolSettings ?? {};
}

function applySchemaBackedSections(
  merged: Partial<MergedSettings>,
  layers: MergeLayers,
): void {
  const { schemaDefaults, systemDefaults, user, workspace, system } = layers;
  for (const key of ['security', 'telemetry', 'mcp', 'tools'] as const) {
    merged[key] = mergeObjectSection(
      key,
      schemaDefaults,
      systemDefaults,
      user,
      workspace,
      system,
    );
  }
}

function applyExtensionAndHookSections(
  merged: Partial<MergedSettings>,
  layers: MergeLayers,
): void {
  const { schemaDefaults, systemDefaults, user, workspace, system } = layers;
  merged.extensions = mergeExtensions(layers);
  merged.hooksConfig = mergeObjectSection(
    'hooksConfig',
    schemaDefaults,
    systemDefaults,
    user,
    workspace,
    system,
  );
  merged.hooks = mergeObjectSection(
    'hooks',
    schemaDefaults,
    systemDefaults,
    user,
    workspace,
    system,
  );
}

export function mergeSettings(
  system: Settings,
  systemDefaults: Settings,
  user: Settings,
  workspace: Settings,
  isTrusted: boolean,
): MergedSettings {
  const layers: MergeLayers = {
    schemaDefaults: getSchemaDefaults(),
    systemDefaults,
    user,
    workspace: isTrusted ? workspace : ({} as Settings),
    system,
  };
  const merged = mergeBaseSettings(layers);
  applyCoreMergedSections(merged, layers);
  applySchemaBackedSections(merged, layers);
  applyExtensionAndHookSections(merged, layers);
  return merged as MergedSettings;
}
