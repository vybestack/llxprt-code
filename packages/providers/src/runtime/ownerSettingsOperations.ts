/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
type NamedSettingsCommands = Pick<
  SessionSettingsOwner,
  | 'captureNamedParameters'
  | 'readNamedParameter'
  | 'writeUserParameter'
  | 'readSessionOverride'
  | 'writeSessionOverride'
  | 'clearSessionOverride'
>;
import { MissingProviderRuntimeError } from './messages.js';

function requireOwner(owner?: NamedSettingsCommands): NamedSettingsCommands {
  if (!owner)
    throw new MissingProviderRuntimeError({
      providerKey: 'provider-runtime',
      missingFields: ['session settings commands'],
      stage: 'ownerSettingsOperations',
    });
  return owner;
}

export function setEphemeralSetting(
  key: string,
  value: unknown,
  owner?: NamedSettingsCommands,
): void {
  const config = requireOwner(owner);
  config.writeUserParameter(key, value);
}

export function clearEphemeralSetting(
  key: string,
  owner?: NamedSettingsCommands,
): void {
  const config = requireOwner(owner);
  config.writeUserParameter(key, undefined);
}

export function setSessionSetting(
  key: string,
  value: unknown,
  owner?: NamedSettingsCommands,
): void {
  const config = requireOwner(owner);
  config.writeSessionOverride(key, value);
}

export function clearSessionSetting(
  key: string,
  owner?: NamedSettingsCommands,
): void {
  const config = requireOwner(owner);
  config.clearSessionOverride(key);
}
