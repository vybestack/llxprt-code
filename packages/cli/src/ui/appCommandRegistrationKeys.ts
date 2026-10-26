/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The props whose identity change requires the credential/command registration
 * to be rebuilt. Kept beside the component so the list reads as one declaration
 * instead of a literal inside `capture()`.
 */
export const COMMAND_REGISTRATION_KEYS = [
  'agent',
  'approval',
  'chatCommands',
  'commandRegistry',
  'emojiFilter',
  'fileCommands',
  'keyCommands',
  'oauthControl',
  'settings',
  'providerAliasRefresh',
  'renderRuntime',
  'detectProviderQuota',
  'fetch',
  'getActiveModelName',
  'getActiveProviderAliasConfig',
  'getActiveProviderName',
  'getActiveToolFormatState',
  'getEphemeralSetting',
  'getEphemeralSettings',
  'listSavedProfiles',
  'providerStatus',
  'saveLoadBalancerProfile',
  'setActiveModel',
  'setActiveToolFormatOverride',
  'setEphemeralSetting',
  'updateActiveProviderApiKey',
  'workspaceCommands',
] as const;

/** True when any prop the credential registration captures has changed. */
export function commandRegistrationInputsChanged<Props extends object>(
  previous: Props | undefined,
  next: Props,
  keys: ReadonlyArray<keyof Props>,
): boolean {
  return keys.some((key) => previous?.[key] !== next[key]);
}
