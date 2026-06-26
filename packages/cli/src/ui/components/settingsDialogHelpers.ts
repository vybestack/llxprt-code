/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  LoadedSettings,
  SettingScope,
  Settings,
  ToolEnabledState,
} from '../../config/settings.js';
import type { SettingDefinition as _SettingDefinition } from '../../config/settingsSchema.js';
import type { getSettingDefinition } from '../../utils/settingsUtils.js';
import { Colors } from '../colors.js';
import type { PendingValue, SettingItem } from './settingsDialogTypes.js';
import { debugLogger } from '@vybestack/llxprt-code-core';

type SettingValueType = _SettingDefinition['type'];

/**
 * True when the pending `value` matches a non-boolean setting `type` that is
 * persisted via setPendingSettingValueAny (number/string/enum scalars and
 * arrays). Boolean settings are handled by a dedicated branch.
 */
export function isTypedScalarOrArraySetting(
  type: SettingValueType | undefined,
  value: PendingValue,
): boolean {
  if (type === 'number') {
    return typeof value === 'number';
  }
  if (type === 'string' || type === 'enum') {
    return typeof value === 'string';
  }
  if (type === 'array') {
    return Array.isArray(value);
  }
  return false;
}

/**
 * Resolve the value to persist immediately when resetting a non-restart
 * setting to its default: booleans fall back to false, number/string pass
 * through, anything else yields undefined (no immediate save).
 */
export function resolveImmediateSaveValue(
  type: string | undefined,
  defaultValue: unknown,
): boolean | number | string | undefined {
  if (type === 'boolean') {
    return typeof defaultValue === 'boolean' ? defaultValue : false;
  }
  if (typeof defaultValue === 'number' || typeof defaultValue === 'string') {
    return defaultValue;
  }
  return undefined;
}

export function settingValueColor(
  isActive: boolean,
  shouldBeGreyedOut: boolean,
): string {
  if (isActive) {
    return Colors.AccentGreen;
  }
  if (shouldBeGreyedOut) {
    return Colors.Gray;
  }
  return Colors.Foreground;
}

/**
 * Get current state of a tool based on excludeTools settings
 */
export function getToolCurrentState(
  toolName: string,
  settings: LoadedSettings,
  pendingExcludeTools?: string[],
): ToolEnabledState {
  try {
    const excludeTools =
      pendingExcludeTools ?? settings.merged.excludeTools ?? [];
    // Tool is enabled if not in excludeTools
    return excludeTools.includes(toolName) ? 'disabled' : 'enabled';
  } catch (error) {
    debugLogger.error('Error getting tool state:', error);
    return 'enabled'; // Default to enabled on error
  }
}

/**
 * Update tool exclusion in excludeTools list
 */
export function updateToolExclusion(
  toolName: string,
  state: ToolEnabledState,
  settings: LoadedSettings,
  scope: SettingScope,
): void {
  try {
    const currentExcludeTools = settings.merged.excludeTools ?? [];
    let newExcludeTools = [...currentExcludeTools];

    if (state === 'enabled') {
      // Enable tool: remove from excludeTools
      newExcludeTools = newExcludeTools.filter((name) => name !== toolName);
    } else if (!newExcludeTools.includes(toolName)) {
      // Disable tool: add to excludeTools
      newExcludeTools.push(toolName);
    }

    // Save changes directly using setValue since saveSingleSetting skips coreToolSettings
    settings.setValue(
      scope,
      'excludeTools' as keyof Settings,
      newExcludeTools as Settings['excludeTools'],
    );
  } catch (error) {
    debugLogger.error('Error updating tool exclusion:', error);
  }
}

export function getPendingExcludeTools(
  settings: LoadedSettings,
  globalPendingChanges: Map<string, PendingValue>,
): string[] {
  const currentExcludeTools = settings.merged.excludeTools ?? [];
  if (globalPendingChanges.has('excludeTools')) {
    return globalPendingChanges.get('excludeTools') as string[];
  }
  return currentExcludeTools;
}

export function buildNewExcludeToolsList(
  key: string,
  newState: ToolEnabledState,
  pendingExcludeTools: string[],
): string[] {
  const newExcludeTools = [...pendingExcludeTools];
  if (newState === 'enabled') {
    return newExcludeTools.filter((name) => name !== key);
  }
  if (!newExcludeTools.includes(key)) {
    newExcludeTools.push(key);
  }
  return newExcludeTools;
}

type ParseEditResult = { ok: true; value: string | number } | { ok: false };

function isValidNumericEdit(
  value: number,
  definition: ReturnType<typeof getSettingDefinition>,
): boolean {
  if (definition === undefined) {
    return true;
  }
  if (typeof definition.minimum === 'number' && value < definition.minimum) {
    return false;
  }
  if (typeof definition.maximum === 'number' && value > definition.maximum) {
    return false;
  }
  if (
    typeof definition.multipleOf === 'number' &&
    definition.multipleOf > 0 &&
    !Number.isInteger(value / definition.multipleOf)
  ) {
    return false;
  }
  return true;
}

export function parseEditValue(
  editBuffer: string,
  definition: ReturnType<typeof getSettingDefinition>,
): ParseEditResult {
  if (definition?.type !== 'number') {
    return { ok: true, value: editBuffer };
  }

  const trimmed = editBuffer.trim();
  if (trimmed === '') {
    return { ok: false };
  }

  const parsed = Number(trimmed);
  if (Number.isNaN(parsed) || !isValidNumericEdit(parsed, definition)) {
    return { ok: false };
  }

  return { ok: true, value: parsed };
}

/**
 * True when `value` is a primitive whose runtime typeof matches the declared
 * scalar setting `type` (boolean/number/string).
 */
export function matchesScalarSettingType(
  type: SettingItem['type'],
  value: unknown,
): boolean {
  if (type === 'boolean') {
    return typeof value === 'boolean';
  }
  if (type === 'number') {
    return typeof value === 'number';
  }
  if (type === 'string') {
    return typeof value === 'string';
  }
  return false;
}
