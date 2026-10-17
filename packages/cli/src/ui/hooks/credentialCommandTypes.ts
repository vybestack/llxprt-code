/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { BuiltinCommandOwners } from '../../services/BuiltinCommandLoader.js';
export type CredentialCommands = Pick<
  BuiltinCommandOwners,
  | 'modelCommand'
  | 'toolFormatCommand'
  | 'providerCommand'
  | 'baseurlCommand'
  | 'logoutCommand'
  | 'keyfileCommand'
  | 'keyCommand'
  | 'toolkeyCommand'
  | 'toolkeyfileCommand'
  | 'authCommand'
  | 'quotaCommand'
  | 'mcpCommand'
  | 'profileCommand'
>;
