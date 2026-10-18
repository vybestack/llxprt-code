/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  BuiltinCommandLoader as SelectedBuiltinCommandLoader,
  type BuiltinCommandOwners,
} from '../services/BuiltinCommandLoader.js';
import type { CliUiRuntime } from '../ui/cliUiRuntime.js';

export class BuiltinCommandLoader extends SelectedBuiltinCommandLoader {
  constructor(owners: BuiltinCommandOwners, config: CliUiRuntime | null) {
    const manager =
      config && 'extensionEnablementManager' in config
        ? config.extensionEnablementManager
        : undefined;
    super(
      owners,
      () => config?.getEnableHooksUI() === true,
      () => config?.isSkillsSupportEnabled() === true,
      () => config?.isAdminSkillsEnabled() !== false,
      manager ? (name, path) => manager.isEnabled(name, path) : null,
    );
  }
}
