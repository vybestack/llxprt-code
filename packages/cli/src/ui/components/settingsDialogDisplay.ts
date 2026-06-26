/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  LoadedSettings,
  SettingScope,
  Settings,
} from '../../config/settings.js';
import {
  getDefaultValue,
  getDisplayValue,
  getNestedValue,
  getSettingDefinition,
} from '../../utils/settingsUtils.js';
import { cpLen, cpSlice } from '../utils/textUtils.js';
import { getToolCurrentState } from './settingsDialogHelpers.js';
import type { PendingValue, SettingItem } from './settingsDialogTypes.js';
import chalk from 'chalk';

// --- display value computation ---

function computeEditDisplayValue(
  editBuffer: string,
  editCursorPos: number,
  cursorVisible: boolean,
): string {
  if (cursorVisible && editCursorPos < cpLen(editBuffer)) {
    const beforeCursor = cpSlice(editBuffer, 0, editCursorPos);
    const atCursor = cpSlice(editBuffer, editCursorPos, editCursorPos + 1);
    const afterCursor = cpSlice(editBuffer, editCursorPos + 1);
    return beforeCursor + chalk.inverse(atCursor) + afterCursor;
  }
  if (cursorVisible && editCursorPos >= cpLen(editBuffer)) {
    return editBuffer + chalk.inverse(' ');
  }
  return editBuffer;
}

function computeNumberOrStringDisplayValue(
  itemValue: string,
  pendingSettings: Settings,
  modifiedSettings: Set<string>,
): string {
  const path = itemValue.split('.');
  const currentValue = getNestedValue(pendingSettings, path);
  const defaultValue = getDefaultValue(itemValue);

  let displayValue: string;
  if (currentValue !== undefined && currentValue !== null) {
    displayValue = String(currentValue);
  } else {
    displayValue = defaultValue !== undefined ? String(defaultValue) : '';
  }

  const isModified = modifiedSettings.has(itemValue);
  const effectiveCurrentValue = currentValue ?? defaultValue;
  const isDifferentFromDefault = effectiveCurrentValue !== defaultValue;

  if (isDifferentFromDefault || isModified) {
    displayValue += '*';
  }
  return displayValue;
}

function computeEnumDisplayValue(
  itemValue: string,
  pendingSettings: Settings,
  mergedSettings: Settings,
  globalPendingChanges: Map<string, PendingValue>,
  modifiedSettings: Set<string>,
): string {
  const path = itemValue.split('.');
  let currentValue = getNestedValue(pendingSettings, path);

  if (globalPendingChanges.has(itemValue)) {
    currentValue = globalPendingChanges.get(itemValue);
  }

  const mergedValue = getNestedValue(mergedSettings, path);
  if (currentValue === undefined) {
    currentValue = mergedValue;
  }

  if (currentValue === undefined) {
    currentValue = getDefaultValue(itemValue);
  }

  let displayValue = String(currentValue);

  const isModified = modifiedSettings.has(itemValue);
  const defaultValue = getDefaultValue(itemValue);
  const isDifferentFromDefault = currentValue !== defaultValue;

  if (isDifferentFromDefault || isModified) {
    displayValue += '*';
  }
  return displayValue;
}

function computeCoreToolDisplayValue(
  itemValue: string,
  pendingSettings: Settings,
  settings: LoadedSettings,
): string {
  const toolName = itemValue.replace('coreToolSettings.', '');
  let excludeTools = pendingSettings.excludeTools ?? [];
  if (excludeTools.length === 0) {
    excludeTools = settings.merged.excludeTools ?? [];
  }
  const currentState = getToolCurrentState(toolName, settings, excludeTools);
  const isEnabled = currentState === 'enabled';
  let displayValue = isEnabled ? 'Enabled' : 'Disabled';
  if (!isEnabled) {
    displayValue += '*';
  }
  return displayValue;
}

// --- computeDisplayValue fix: use selectedScope correctly ---

export function computeDisplayValueForItem(
  item: SettingItem,
  selectedScope: SettingScope,
  ctx: {
    editingKey: string | null;
    editBuffer: string;
    editCursorPos: number;
    cursorVisible: boolean;
    pendingSettings: Settings;
    settings: LoadedSettings;
    modifiedSettings: Set<string>;
    globalPendingChanges: Map<string, PendingValue>;
    subSettingsMode: { isActive: boolean; parentKey: string };
  },
): string {
  if (ctx.editingKey === item.value) {
    return computeEditDisplayValue(
      ctx.editBuffer,
      ctx.editCursorPos,
      ctx.cursorVisible,
    );
  }
  if (item.type === 'number' || item.type === 'string') {
    return computeNumberOrStringDisplayValue(
      item.value,
      ctx.pendingSettings,
      ctx.modifiedSettings,
    );
  }
  if (getSettingDefinition(item.value)?.type === 'enum') {
    return computeEnumDisplayValue(
      item.value,
      ctx.pendingSettings,
      ctx.settings.merged,
      ctx.globalPendingChanges,
      ctx.modifiedSettings,
    );
  }
  if (
    ctx.subSettingsMode.isActive &&
    ctx.subSettingsMode.parentKey === 'coreToolSettings'
  ) {
    return computeCoreToolDisplayValue(
      item.value,
      ctx.pendingSettings,
      ctx.settings,
    );
  }
  if (!ctx.subSettingsMode.isActive && item.value === 'coreToolSettings') {
    return 'Enter';
  }
  const scopeSettings = ctx.settings.forScope(selectedScope).settings;
  const mergedSettings = ctx.settings.merged;
  return getDisplayValue(
    item.value,
    scopeSettings,
    mergedSettings,
    ctx.modifiedSettings,
    ctx.pendingSettings,
  );
}
