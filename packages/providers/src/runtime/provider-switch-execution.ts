/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { coreEvents } from '@vybestack/llxprt-code-core/utils/events.js';
import type { ProviderAliasConfig } from '../composition/providerAliases.js';
import type { ProviderSwitchResult } from './providerSwitch.js';
import {
  applySwitchDefaults,
  clearSwitchEphemerals,
  selectSwitchDefaults,
  switchDefaultMessages,
  type EphemeralDefaultWrites,
  type SwitchDefaultSelection,
} from './provider-switch-defaults.js';
import {
  authenticateSwitchOAuth,
  restoreSwitchOAuthDefaults,
  type SwitchOAuthOperations,
  type SwitchOAuthPolicy,
} from './provider-switch-oauth.js';

export interface SwitchEphemeralOperations extends EphemeralDefaultWrites {
  getEphemeralSettings(): Record<string, unknown>;
  isEphemeralUserOwned(key: string): boolean;
}

export interface SwitchProviderSettingWrites {
  setProviderSetting(provider: string, key: string, value: unknown): void;
  getCurrentProfileName(): string | null;
}

export interface SwitchActivationOperations {
  resetFailover(): void;
  activate(name: string): Promise<string | undefined>;
  setModel(model: string): void;
  getModel(): string;
  initialize(): Promise<void>;
}

export interface SwitchRequest {
  readonly name: string;
  readonly currentProvider: string | null;
  readonly skipModelDefaults: boolean;
  readonly preserveEphemerals: readonly string[];
  readonly publication: 'immediate' | 'deferred' | undefined;
  readonly clientReplacement: 'immediate' | 'deferred' | undefined;
  readonly alias: ProviderAliasConfig | undefined;
  readonly providerBaseUrl: string | undefined;
  readonly previousEphemerals: Readonly<Record<string, unknown>>;
  readonly previousSettings: Readonly<Record<string, unknown>>;
  readonly targetSettings: Readonly<Record<string, unknown>>;
}

function applySelection(
  selection: SwitchDefaultSelection,
  settings: SwitchProviderSettingWrites,
  writeEphemeral: (key: string, value: unknown) => void,
  setModel: (model: string) => void,
): void {
  settings.setProviderSetting(selection.name, 'base-url', selection.baseUrl);
  writeEphemeral('base-url', selection.baseUrl);
  if (selection.alias?.['sandbox-base-url'])
    settings.setProviderSetting(
      selection.name,
      'sandbox-base-url',
      selection.alias['sandbox-base-url'],
    );
  if (selection.alias?.['requires-auth'] !== undefined)
    settings.setProviderSetting(
      selection.name,
      'requires-auth',
      selection.alias['requires-auth'],
    );
  settings.setProviderSetting(
    selection.name,
    'model',
    selection.model || undefined,
  );
  setModel(selection.model);
}

function publishSwitch(
  request: SwitchRequest,
  selection: SwitchDefaultSelection,
  profileName: string | null,
  fallbackModel: string,
): void {
  if (request.publication === 'deferred') return;
  const model = selection.model || fallbackModel || request.name;
  coreEvents.emitModelProfileChanged({
    model,
    providerName: request.name,
    profileName,
    displayLabel: profileName ?? model,
  });
}

function restoreOAuthDefaults(
  request: SwitchRequest,
  oauth: SwitchOAuthOperations | null,
  write: (key: string, value: unknown) => void,
): readonly string[] {
  return request.name === 'claudecode'
    ? restoreSwitchOAuthDefaults(
        request.previousEphemerals,
        oauth?.isEnabled() ?? false,
        write,
      )
    : [];
}

export async function executeProviderSwitch(
  request: SwitchRequest,
  ephemerals: SwitchEphemeralOperations,
  settings: SwitchProviderSettingWrites,
  activation: SwitchActivationOperations,
  oauth: SwitchOAuthOperations | null,
  oauthPolicy: SwitchOAuthPolicy,
  hasNonOAuthAuthentication: () => Promise<boolean>,
  warn: (message: () => string) => void,
): Promise<ProviderSwitchResult> {
  clearSwitchEphemerals(
    request.previousEphemerals,
    request.preserveEphemerals,
    ephemerals.isEphemeralUserOwned,
    ephemerals.setEphemeralSetting,
  );
  const preAliasKeys = survivingSwitchParameterKeys(ephemerals);
  activation.resetFailover();
  if (request.currentProvider !== null) {
    for (const key of Object.keys(request.previousSettings))
      settings.setProviderSetting(request.currentProvider, key, undefined);
  }
  const defaultModel = await activation.activate(request.name);
  ephemerals.setEphemeralSetting('activeProvider', request.name);
  const selection = selectSwitchDefaults(
    request.name,
    request.currentProvider,
    request.alias,
    defaultModel,
    request.providerBaseUrl,
    request.targetSettings,
    undefined,
    request.preserveEphemerals.includes('base-url')
      ? request.previousEphemerals['base-url']
      : undefined,
  );
  for (const key of Object.keys(request.targetSettings))
    settings.setProviderSetting(request.name, key, undefined);
  applySelection(
    selection,
    settings,
    ephemerals.setEphemeralSetting,
    activation.setModel,
  );
  const authMessages =
    oauth === null
      ? []
      : await authenticateSwitchOAuth(
          oauthPolicy,
          oauth,
          hasNonOAuthAuthentication,
        );
  const restored = restoreOAuthDefaults(
    request,
    oauth,
    ephemerals.setEphemeralSetting,
  );
  for (const key of restored) preAliasKeys.add(key);
  applySwitchDefaults(
    selection,
    request.skipModelDefaults,
    preAliasKeys,
    ephemerals,
    warn,
  );
  if (request.clientReplacement !== 'deferred') await activation.initialize();
  publishSwitch(
    request,
    selection,
    settings.getCurrentProfileName(),
    activation.getModel(),
  );
  return {
    changed: true,
    previousProvider: request.currentProvider,
    nextProvider: request.name,
    defaultModel: selection.model || undefined,
    infoMessages: [...authMessages, ...switchDefaultMessages(selection)],
  };
}

function survivingSwitchParameterKeys(
  ephemerals: SwitchEphemeralOperations,
): Set<string> {
  const surviving = ephemerals.getEphemeralSettings();
  const preAliasKeys = new Set(
    Object.keys(surviving).flatMap((key) => {
      const value = surviving[key];
      return key === 'reasoning' && typeof value === 'object' && value !== null
        ? Object.keys(value).map((child) => `reasoning.${child}`)
        : [key];
    }),
  );
  return preAliasKeys;
}
