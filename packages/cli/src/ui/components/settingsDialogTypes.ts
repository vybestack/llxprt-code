/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LoadedSettings, SettingScope } from '../../config/settings.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';

export interface SettingsDialogProps {
  settings: LoadedSettings;
  onSelect: (settingName: string | undefined, scope: SettingScope) => void;
  onRestartRequest?: () => void;
  availableTerminalHeight?: number;
  config?: CliUiRuntime;
}

export type PendingValue = boolean | number | string | string[];

// --- Setting item type ---

export interface SettingItem {
  label: string;
  description?: string;
  value: string;
  type: string | undefined;
  toggle: () => void;
}
