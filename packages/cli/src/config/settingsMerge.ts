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

export const V2_NAMESPACE_MAPPINGS = {
  accessibility: 'ui',
  checkpointing: 'ui',
  fileFiltering: 'ui',
} as const satisfies Partial<Record<keyof Settings, keyof Settings>>;

const V2_WRITE_PATH_MAPPINGS = {
  'chatCompression.contextPercentageThreshold': 'model.compressionThreshold',
} as const satisfies Record<string, string>;

export type V2NamespacedSettingKey = keyof typeof V2_NAMESPACE_MAPPINGS;

export function getV2NamespacedSettingPath(key: string): string {
  if (Object.prototype.hasOwnProperty.call(V2_WRITE_PATH_MAPPINGS, key)) {
    return V2_WRITE_PATH_MAPPINGS[key as keyof typeof V2_WRITE_PATH_MAPPINGS];
  }

  const [topLevel, ...nestedParts] = key.split('.');
  if (!Object.prototype.hasOwnProperty.call(V2_NAMESPACE_MAPPINGS, topLevel)) {
    return key;
  }
  const namespace = V2_NAMESPACE_MAPPINGS[topLevel as V2NamespacedSettingKey];
  return [namespace, topLevel, ...nestedParts].join('.');
}

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

function getObjectSettingValue(
  settings: SettingsLayer,
  key: keyof Settings,
): object | undefined {
  const value: unknown = settings[key];
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value
    : undefined;
}

function extractV2NestedKeys(
  settings: SettingsLayer,
  namespace: keyof Settings,
): Record<string, unknown> {
  const namespacedSettings = getObjectSettingValue(settings, namespace) as
    | Record<string, unknown>
    | undefined;
  const nested: Record<string, unknown> = {};
  for (const [key, mappedNamespace] of Object.entries(V2_NAMESPACE_MAPPINGS)) {
    if (mappedNamespace !== namespace) {
      continue;
    }
    const value = namespacedSettings?.[key];
    if (value !== undefined) {
      nested[key] = value;
    }
  }
  return nested;
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
    ...extractV2NestedKeys(systemDefaults, 'ui'),
    ...(systemDefaults.ui ?? {}),
    ...extractLegacyUiKeys(user),
    ...extractV2NestedKeys(user, 'ui'),
    ...(user.ui ?? {}),
    ...extractLegacyUiKeys(workspace),
    ...extractV2NestedKeys(workspace, 'ui'),
    ...(workspace.ui ?? {}),
    ...extractLegacyUiKeys(system),
    ...extractV2NestedKeys(system, 'ui'),
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

function getModelSettings(settings: SettingsLayer):
  | {
      name?: unknown;
      compressionThreshold?: unknown;
    }
  | undefined {
  const model: unknown = settings.model;
  return typeof model === 'object' && model !== null && !Array.isArray(model)
    ? (model as { name?: unknown; compressionThreshold?: unknown })
    : undefined;
}

function getModelName(settings: SettingsLayer): string | undefined {
  const model = settings.model;
  if (typeof model === 'string') {
    return model;
  }
  const name = getModelSettings(settings)?.name;
  return typeof name === 'string' ? name : undefined;
}

function getModelCompressionThreshold(
  settings: SettingsLayer,
): number | undefined {
  const threshold = getModelSettings(settings)?.compressionThreshold;
  return typeof threshold === 'number' ? threshold : undefined;
}

function getModelCompressionSettings(
  settings: SettingsLayer,
): { contextPercentageThreshold: number } | undefined {
  const threshold = getModelCompressionThreshold(settings);
  return threshold === undefined
    ? undefined
    : { contextPercentageThreshold: threshold };
}

function getChatCompressionSettings(
  settings: SettingsLayer,
): Record<string, unknown> {
  const chatCompression: unknown = settings.chatCompression;
  return {
    ...(typeof chatCompression === 'object' &&
    chatCompression !== null &&
    !Array.isArray(chatCompression)
      ? chatCompression
      : {}),
    ...(getModelCompressionSettings(settings) ?? {}),
  };
}

function getPrioritizedModel(layers: MergeLayers): string | undefined {
  return [
    getModelName(layers.workspace),
    getModelName(layers.user),
    getModelName(layers.system),
    getModelName(layers.systemDefaults),
    getModelName(layers.schemaDefaults),
  ].find((model) => model !== undefined);
}

function getPrioritizedModelCompressionThreshold(
  layers: MergeLayers,
): number | undefined {
  return [
    getModelCompressionThreshold(layers.workspace),
    getModelCompressionThreshold(layers.user),
    getModelCompressionThreshold(layers.system),
    getModelCompressionThreshold(layers.systemDefaults),
    getModelCompressionThreshold(layers.schemaDefaults),
  ].find((threshold) => threshold !== undefined);
}

function getPrioritizedModelConfig(
  layers: MergeLayers,
): MergedSettings['modelConfig'] | undefined {
  const name = getPrioritizedModel(layers);
  const compressionThreshold = getPrioritizedModelCompressionThreshold(layers);
  if (name === undefined && compressionThreshold === undefined) {
    return undefined;
  }
  return {
    ...(name === undefined ? {} : { name }),
    ...(compressionThreshold === undefined ? {} : { compressionThreshold }),
  };
}

function getV2NestedObjectSection<K extends V2NamespacedSettingKey>(
  settings: SettingsLayer,
  key: K,
): object | undefined {
  const namespace = V2_NAMESPACE_MAPPINGS[key];
  const namespacedSettings = getObjectSettingValue(settings, namespace) as
    | Record<string, unknown>
    | undefined;
  const value = namespacedSettings?.[key];
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value
    : undefined;
}

function mergeV2CompatibleObjectSection<K extends V2NamespacedSettingKey>(
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
    ...(getV2NestedObjectSection(systemDefaults, key) ?? {}),
    ...((user[key] as object | undefined) ?? {}),
    ...(getV2NestedObjectSection(user, key) ?? {}),
    ...((workspace[key] as object | undefined) ?? {}),
    ...(getV2NestedObjectSection(workspace, key) ?? {}),
    ...((system[key] as object | undefined) ?? {}),
    ...(getV2NestedObjectSection(system, key) ?? {}),
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
    model: getPrioritizedModel(layers),
    modelConfig: getPrioritizedModelConfig(layers),
  } as Partial<MergedSettings>;
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
  merged.chatCompression = {
    ...getChatCompressionSettings(systemDefaults),
    ...getChatCompressionSettings(user),
    ...getChatCompressionSettings(workspace),
    ...getChatCompressionSettings(system),
  };

  merged.model = getPrioritizedModel(layers);
  merged.modelConfig = getPrioritizedModelConfig(layers);
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
  for (const key of Object.keys(
    V2_NAMESPACE_MAPPINGS,
  ) as V2NamespacedSettingKey[]) {
    merged[key] = mergeV2CompatibleObjectSection(
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
