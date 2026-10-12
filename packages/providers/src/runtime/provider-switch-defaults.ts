/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ProviderAliasConfig } from '../composition/providerAliases.js';
import { computeModelDefaults } from './providerMutations.js';
import {
  REASONING_OBJECT_VALUED_EPHEMERAL_KEYS,
  USER_OWNED_SWITCH_PRESERVED_KEYS,
} from './modelDefaultOwnership.js';

export interface EphemeralDefaultWrites {
  getEphemeralSetting(key: string): unknown;
  setEphemeralSetting(key: string, value: unknown): void;
  recordProviderDefaultOwnedEntries(
    entries: Iterable<readonly [string, unknown]>,
  ): void;
  recordModelDefaultOwnedKeys(keys: Iterable<string>): void;
}

export interface SwitchDefaultSelection {
  readonly name: string;
  readonly alias: ProviderAliasConfig | undefined;
  readonly model: string;
  readonly baseUrl: string | undefined;
  readonly providerBaseUrl: string | undefined;
  readonly explicitBaseUrl: string | undefined;
  readonly hadCustomBaseUrl: boolean;
}

export function normalizeSwitchSetting(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' || trimmed.toLowerCase() === 'none'
    ? undefined
    : trimmed;
}

export function selectSwitchDefaults(
  name: string,
  currentProvider: string | null,
  alias: ProviderAliasConfig | undefined,
  defaultModel: string | undefined,
  providerBaseUrl: string | undefined,
  storedSettings: Readonly<Record<string, unknown>>,
  explicitModel: unknown,
  explicitBaseUrlSetting: unknown,
): SwitchDefaultSelection {
  const storedModel = normalizeSwitchSetting(storedSettings.model);
  const storedBaseUrl = normalizeSwitchSetting(storedSettings['base-url']);
  const preferredModel =
    normalizeSwitchSetting(alias?.defaultModel) ??
    normalizeSwitchSetting(defaultModel);
  const retainedModel =
    currentProvider === name && storedModel !== preferredModel
      ? storedModel
      : undefined;
  const selectedModel = normalizeSwitchSetting(explicitModel) ?? retainedModel;
  const model = (selectedModel ?? preferredModel ?? '').trim();
  const explicitBaseUrl =
    normalizeSwitchSetting(explicitBaseUrlSetting) ??
    (currentProvider === name ? storedBaseUrl : undefined);
  return Object.freeze({
    name,
    alias,
    model,
    providerBaseUrl,
    explicitBaseUrl,
    baseUrl: explicitBaseUrl ?? providerBaseUrl,
    hadCustomBaseUrl: Boolean(storedBaseUrl),
  });
}

export function clearSwitchEphemerals(
  existing: Readonly<Record<string, unknown>>,
  preserve: readonly string[],
  userOwned: (key: string) => boolean,
  write: (key: string, value: unknown) => void,
): void {
  const keys = Object.keys(existing).flatMap((key) => {
    const value = existing[key];
    return key === 'reasoning' && typeof value === 'object' && value !== null
      ? Object.keys(value).map((child) => `reasoning.${child}`)
      : [key];
  });
  for (const key of keys) {
    const userOwnsDefault =
      USER_OWNED_SWITCH_PRESERVED_KEYS.includes(key) && userOwned(key);
    const sessionIdentity =
      key === 'activeProvider' || key === 'currentProfile';
    if (sessionIdentity || preserve.includes(key) || userOwnsDefault) continue;
    write(key, undefined);
  }
}

function applyAliasValue(
  name: string,
  rawKey: string,
  value: unknown,
  defaults: EphemeralDefaultWrites,
  warn: (message: () => string) => void,
): boolean {
  const key = rawKey.trim();
  if (!key) return false;
  if (
    [
      'activeprovider',
      'base-url',
      'model',
      'auth-key',
      'auth-keyfile',
      'api-key',
    ].includes(key.toLowerCase())
  ) {
    warn(
      () =>
        `[cli-runtime] Skipping protected alias ephemeral setting '${key}' for provider '${name}'.`,
    );
    return false;
  }
  if (defaults.getEphemeralSetting(key) !== undefined) return false;
  if (typeof value === 'number' && !Number.isFinite(value)) {
    warn(
      () =>
        `[cli-runtime] Skipping non-finite alias ephemeral setting '${key}' for provider '${name}'.`,
    );
    return false;
  }
  const scalar =
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean';
  const reasoningMap =
    REASONING_OBJECT_VALUED_EPHEMERAL_KEYS.includes(key) &&
    typeof value === 'object' &&
    value !== null;
  if (scalar || reasoningMap) {
    defaults.setEphemeralSetting(key, value);
    return true;
  }
  warn(
    () =>
      `[cli-runtime] Skipping non-scalar alias ephemeral setting '${key}' for provider '${name}'.`,
  );
  return false;
}

export function applySwitchDefaults(
  selection: SwitchDefaultSelection,
  skipModelDefaults: boolean,
  preAliasKeys: ReadonlySet<string>,
  defaults: EphemeralDefaultWrites,
  warn: (message: () => string) => void,
): void {
  const entries = Object.entries(selection.alias?.ephemeralSettings ?? {})
    .filter(([key, value]) =>
      applyAliasValue(selection.name, key, value, defaults, warn),
    )
    .map(([key, value]): readonly [string, unknown] => [key.trim(), value]);
  defaults.recordProviderDefaultOwnedEntries(entries);
  if (
    skipModelDefaults ||
    !selection.model ||
    !selection.alias?.modelDefaults
  ) {
    defaults.recordModelDefaultOwnedKeys([]);
    return;
  }
  const modelDefaults = computeModelDefaults(
    selection.model,
    selection.alias.modelDefaults,
  );
  const applied = Object.entries(modelDefaults).filter(
    ([key]) => !preAliasKeys.has(key),
  );
  for (const [key, value] of applied) defaults.setEphemeralSetting(key, value);
  defaults.recordModelDefaultOwnedKeys(applied.map(([key]) => key));
}

export function switchDefaultMessages(
  selection: SwitchDefaultSelection,
): string[] {
  const messages: string[] = [];
  if (selection.hadCustomBaseUrl) {
    if (
      !selection.baseUrl ||
      selection.baseUrl === selection.providerBaseUrl ||
      !selection.explicitBaseUrl
    )
      messages.push(
        `Cleared custom base URL for provider '${selection.name}'; default endpoint restored.`,
      );
    else if (selection.baseUrl !== selection.providerBaseUrl)
      messages.push(
        `Preserved custom base URL '${selection.baseUrl}' for provider '${selection.name}'.`,
      );
  } else if (
    selection.providerBaseUrl &&
    selection.baseUrl === selection.providerBaseUrl
  )
    messages.push(
      `Base URL set to '${selection.providerBaseUrl}' for provider '${selection.name}'.`,
    );
  if (selection.model)
    messages.push(
      `Active model is '${selection.model}' for provider '${selection.name}'.`,
    );
  if (selection.name !== 'gemini')
    messages.push('Use /key to set API key if needed.');
  return messages;
}
