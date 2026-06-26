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
import type { SettingDefinition as _SettingDefinition } from '../../config/settingsSchema.js';
import { firstNonEmptyString } from '../../utils/coalesce.js';
import {
  getDefaultValue,
  getNestedValue,
  getSettingDefinition,
  getSettingValue,
  hasRestartRequiredSettings,
  requiresRestart,
  saveModifiedSettings,
  setPendingSettingValue,
  setPendingSettingValueAny,
} from '../../utils/settingsUtils.js';
import { saveSingleSetting } from '../../utils/singleSettingSaver.js';
import {
  buildNewExcludeToolsList,
  getPendingExcludeTools,
  getToolCurrentState,
  parseEditValue,
  resolveImmediateSaveValue,
  updateToolExclusion,
} from './settingsDialogHelpers.js';
import type { PendingValue, SettingItem } from './settingsDialogTypes.js';
import { debugLogger } from '@vybestack/llxprt-code-core';
import type React from 'react';

// --- Helpers that close over component state (passed explicitly) ---

function removeKeyFromTracking(
  key: string,
  setModifiedSettings: React.Dispatch<React.SetStateAction<Set<string>>>,
  setRestartRequiredSettings: React.Dispatch<React.SetStateAction<Set<string>>>,
  setGlobalPendingChanges: React.Dispatch<
    React.SetStateAction<Map<string, PendingValue>>
  >,
): void {
  setModifiedSettings((prev) => {
    const updated = new Set(prev);
    updated.delete(key);
    return updated;
  });
  setRestartRequiredSettings((prev) => {
    const updated = new Set(prev);
    updated.delete(key);
    return updated;
  });
  setGlobalPendingChanges((prev) => {
    if (!prev.has(key)) return prev;
    const next = new Map(prev);
    next.delete(key);
    return next;
  });
}

function trackAsModifiedAndRestart(
  key: string,
  setShowRestartPrompt: React.Dispatch<React.SetStateAction<boolean>>,
  setModifiedSettings: React.Dispatch<React.SetStateAction<Set<string>>>,
  setRestartRequiredSettings: React.Dispatch<React.SetStateAction<Set<string>>>,
): void {
  setModifiedSettings((prev) => {
    const updated = new Set(prev).add(key);
    const needsRestart = hasRestartRequiredSettings(updated);
    if (needsRestart) {
      setShowRestartPrompt(true);
      setRestartRequiredSettings((prevRestart) =>
        new Set(prevRestart).add(key),
      );
    }
    return updated;
  });
}

function toggleCoreToolSetting(
  fullKey: string,
  key: string,
  settings: LoadedSettings,
  selectedScope: SettingScope,
  globalPendingChanges: Map<string, PendingValue>,
  setModifiedSettings: React.Dispatch<React.SetStateAction<Set<string>>>,
  setRestartRequiredSettings: React.Dispatch<React.SetStateAction<Set<string>>>,
  setShowRestartPrompt: React.Dispatch<React.SetStateAction<boolean>>,
  setGlobalPendingChanges: React.Dispatch<
    React.SetStateAction<Map<string, PendingValue>>
  >,
): void {
  const pendingExcludeTools = getPendingExcludeTools(
    settings,
    globalPendingChanges,
  );
  const currentState = getToolCurrentState(key, settings, pendingExcludeTools);
  const newState = currentState === 'enabled' ? 'disabled' : 'enabled';

  if (requiresRestart(fullKey)) {
    setModifiedSettings((prev) => {
      const updated = new Set(prev).add(fullKey);
      updated.add('excludeTools');
      return updated;
    });
    setRestartRequiredSettings((prev) => {
      const updated = new Set(prev).add(fullKey);
      updated.add('excludeTools');
      return updated;
    });
    setShowRestartPrompt(true);

    const excludeTools = getPendingExcludeTools(settings, globalPendingChanges);
    const newExcludeTools = buildNewExcludeToolsList(
      key,
      newState,
      excludeTools,
    );
    setGlobalPendingChanges((prev) => {
      const next = new Map(prev);
      next.set('excludeTools', newExcludeTools);
      return next;
    });
  } else {
    updateToolExclusion(key, newState, settings, selectedScope);
    removeKeyFromTracking(
      fullKey,
      setModifiedSettings,
      setRestartRequiredSettings,
      setGlobalPendingChanges,
    );
  }
}

function toggleSubSettingBoolean(
  fullKey: string,
  pendingSettings: Settings,
  settings: LoadedSettings,
  selectedScope: SettingScope,
  setPendingSettings: React.Dispatch<React.SetStateAction<Settings>>,
  setModifiedSettings: React.Dispatch<React.SetStateAction<Set<string>>>,
  setRestartRequiredSettings: React.Dispatch<React.SetStateAction<Set<string>>>,
  setShowRestartPrompt: React.Dispatch<React.SetStateAction<boolean>>,
  setGlobalPendingChanges: React.Dispatch<
    React.SetStateAction<Map<string, PendingValue>>
  >,
): void {
  const currentValue = getSettingValue(
    fullKey,
    pendingSettings,
    settings.merged,
  );
  const newValue = !currentValue;
  setPendingSettings((prev) => setPendingSettingValue(fullKey, newValue, prev));
  if (!requiresRestart(fullKey)) {
    saveSingleSetting(fullKey, newValue, settings, selectedScope);
  } else {
    toggleRestartRequiredBoolean(
      fullKey,
      newValue,
      setShowRestartPrompt,
      setModifiedSettings,
      setRestartRequiredSettings,
      setGlobalPendingChanges,
    );
  }
}

function toggleImmediateBoolean(
  key: string,
  newValue: boolean,
  settings: LoadedSettings,
  selectedScope: SettingScope,
  vimEnabled: boolean,
  pendingSettings: Settings,
  setPendingSettings: React.Dispatch<React.SetStateAction<Settings>>,
  setModifiedSettings: React.Dispatch<React.SetStateAction<Set<string>>>,
  setRestartRequiredSettings: React.Dispatch<React.SetStateAction<Set<string>>>,
  setGlobalPendingChanges: React.Dispatch<
    React.SetStateAction<Map<string, PendingValue>>
  >,
): void {
  debugLogger.log(
    `[DEBUG SettingsDialog] Saving ${key} immediately with value:`,
    newValue,
  );
  saveSingleSetting(key, newValue, settings, selectedScope);

  if (key === 'vimMode' && newValue !== vimEnabled) {
    debugLogger.log(
      '[DEBUG SettingsDialog] Vim mode context will sync from settings.',
    );
  }

  removeKeyFromTracking(
    key,
    setModifiedSettings,
    setRestartRequiredSettings,
    setGlobalPendingChanges,
  );
  setPendingSettings(
    structuredClone(settings.forScope(selectedScope).settings),
  );
}

function toggleRestartRequiredBoolean(
  key: string,
  newValue: boolean,
  setShowRestartPrompt: React.Dispatch<React.SetStateAction<boolean>>,
  setModifiedSettings: React.Dispatch<React.SetStateAction<Set<string>>>,
  setRestartRequiredSettings: React.Dispatch<React.SetStateAction<Set<string>>>,
  setGlobalPendingChanges: React.Dispatch<
    React.SetStateAction<Map<string, PendingValue>>
  >,
): void {
  trackAsModifiedAndRestart(
    key,
    setShowRestartPrompt,
    setModifiedSettings,
    setRestartRequiredSettings,
  );
  setGlobalPendingChanges((prev) => {
    const next = new Map(prev);
    next.set(key, newValue as PendingValue);
    return next;
  });
}

export function buildSubSettingItem(
  key: string,
  def: _SettingDefinition,
  parentKey: string,
  ctx: {
    settings: LoadedSettings;
    selectedScope: SettingScope;
    pendingSettings: Settings;
    globalPendingChanges: Map<string, PendingValue>;
    setPendingSettings: React.Dispatch<React.SetStateAction<Settings>>;
    setModifiedSettings: React.Dispatch<React.SetStateAction<Set<string>>>;
    setRestartRequiredSettings: React.Dispatch<
      React.SetStateAction<Set<string>>
    >;
    setShowRestartPrompt: React.Dispatch<React.SetStateAction<boolean>>;
    setGlobalPendingChanges: React.Dispatch<
      React.SetStateAction<Map<string, PendingValue>>
    >;
  },
): SettingItem {
  const fullKey = `${parentKey}.${key}`;
  const typedDef = def;
  return {
    label: typedDef.label || key,
    description: typedDef.description,
    value: fullKey,
    type: typedDef.type,
    toggle: () => {
      if (parentKey === 'coreToolSettings') {
        toggleCoreToolSetting(
          fullKey,
          key,
          ctx.settings,
          ctx.selectedScope,
          ctx.globalPendingChanges,
          ctx.setModifiedSettings,
          ctx.setRestartRequiredSettings,
          ctx.setShowRestartPrompt,
          ctx.setGlobalPendingChanges,
        );
        return;
      }
      toggleSubSettingBoolean(
        fullKey,
        ctx.pendingSettings,
        ctx.settings,
        ctx.selectedScope,
        ctx.setPendingSettings,
        ctx.setModifiedSettings,
        ctx.setRestartRequiredSettings,
        ctx.setShowRestartPrompt,
        ctx.setGlobalPendingChanges,
      );
    },
  };
}

export function buildNormalSettingItem(
  key: string,
  definition: _SettingDefinition | undefined,
  ctx: {
    settings: LoadedSettings;
    selectedScope: SettingScope;
    pendingSettings: Settings;
    vimEnabled: boolean;
    setPendingSettings: React.Dispatch<React.SetStateAction<Settings>>;
    setModifiedSettings: React.Dispatch<React.SetStateAction<Set<string>>>;
    setRestartRequiredSettings: React.Dispatch<
      React.SetStateAction<Set<string>>
    >;
    setShowRestartPrompt: React.Dispatch<React.SetStateAction<boolean>>;
    setGlobalPendingChanges: React.Dispatch<
      React.SetStateAction<Map<string, PendingValue>>
    >;
  },
): SettingItem {
  return {
    description: definition?.description,
    label: definition?.label ?? key,
    value: key,
    type: definition?.type,
    toggle: () => {
      if (definition?.type !== 'boolean') return;
      const currentValue = getSettingValue(key, ctx.pendingSettings, {});
      const newValue = !currentValue;
      ctx.setPendingSettings((prev) =>
        setPendingSettingValue(key, newValue, prev),
      );
      if (!requiresRestart(key)) {
        toggleImmediateBoolean(
          key,
          newValue,
          ctx.settings,
          ctx.selectedScope,
          ctx.vimEnabled,
          ctx.pendingSettings,
          ctx.setPendingSettings,
          ctx.setModifiedSettings,
          ctx.setRestartRequiredSettings,
          ctx.setGlobalPendingChanges,
        );
      } else {
        toggleRestartRequiredBoolean(
          key,
          newValue,
          ctx.setShowRestartPrompt,
          ctx.setModifiedSettings,
          ctx.setRestartRequiredSettings,
          ctx.setGlobalPendingChanges,
        );
      }
    },
  };
}

// --- commitEdit helpers ---

function commitEditImmediate(
  key: string,
  parsed: string | number,
  settings: LoadedSettings,
  selectedScope: SettingScope,
  setModifiedSettings: React.Dispatch<React.SetStateAction<Set<string>>>,
  setRestartRequiredSettings: React.Dispatch<React.SetStateAction<Set<string>>>,
  setGlobalPendingChanges: React.Dispatch<
    React.SetStateAction<Map<string, PendingValue>>
  >,
): void {
  debugLogger.log(
    `[DEBUG SettingsDialog] Saving ${key} immediately with value:`,
    parsed,
  );
  saveSingleSetting(key, parsed, settings, selectedScope);
  removeKeyFromTracking(
    key,
    setModifiedSettings,
    setRestartRequiredSettings,
    setGlobalPendingChanges,
  );
}

function commitEditRestartRequired(
  key: string,
  parsed: string | number,
  setShowRestartPrompt: React.Dispatch<React.SetStateAction<boolean>>,
  setModifiedSettings: React.Dispatch<React.SetStateAction<Set<string>>>,
  setRestartRequiredSettings: React.Dispatch<React.SetStateAction<Set<string>>>,
  setGlobalPendingChanges: React.Dispatch<
    React.SetStateAction<Map<string, PendingValue>>
  >,
): void {
  trackAsModifiedAndRestart(
    key,
    setShowRestartPrompt,
    setModifiedSettings,
    setRestartRequiredSettings,
  );
  setGlobalPendingChanges((prev) => {
    const next = new Map(prev);
    next.set(key, parsed as PendingValue);
    return next;
  });
}

export function commitEdit(
  key: string,
  editBuffer: string,
  setEditingKey: React.Dispatch<React.SetStateAction<string | null>>,
  setEditBuffer: React.Dispatch<React.SetStateAction<string>>,
  setEditCursorPos: React.Dispatch<React.SetStateAction<number>>,
  setPendingSettings: React.Dispatch<React.SetStateAction<Settings>>,
  settings: LoadedSettings,
  selectedScope: SettingScope,
  setModifiedSettings: React.Dispatch<React.SetStateAction<Set<string>>>,
  setRestartRequiredSettings: React.Dispatch<React.SetStateAction<Set<string>>>,
  setShowRestartPrompt: React.Dispatch<React.SetStateAction<boolean>>,
  setGlobalPendingChanges: React.Dispatch<
    React.SetStateAction<Map<string, PendingValue>>
  >,
): void {
  const definition = getSettingDefinition(key);
  const clearEditState = () => {
    setEditingKey(null);
    setEditBuffer('');
    setEditCursorPos(0);
  };
  const parsed = parseEditValue(editBuffer, definition);
  if (!parsed.ok) {
    clearEditState();
    return;
  }

  setPendingSettings((prev) =>
    setPendingSettingValueAny(key, parsed.value, prev),
  );

  if (!requiresRestart(key)) {
    commitEditImmediate(
      key,
      parsed.value,
      settings,
      selectedScope,
      setModifiedSettings,
      setRestartRequiredSettings,
      setGlobalPendingChanges,
    );
  } else {
    commitEditRestartRequired(
      key,
      parsed.value,
      setShowRestartPrompt,
      setModifiedSettings,
      setRestartRequiredSettings,
      setGlobalPendingChanges,
    );
  }

  clearEditState();
}

export function enterSubSettings(
  currentSettingKey: string,
  currentDefinition: _SettingDefinition | undefined,
  ctx: {
    activeSettingIndex: number;
    scrollOffset: number;
    setSubSettingsMode: React.Dispatch<
      React.SetStateAction<{
        isActive: boolean;
        parentKey: string;
        parentLabel: string;
      }>
    >;
    setParentState: React.Dispatch<
      React.SetStateAction<{ activeIndex: number; scrollOffset: number }>
    >;
    setActiveSettingIndex: React.Dispatch<React.SetStateAction<number>>;
    setScrollOffset: React.Dispatch<React.SetStateAction<number>>;
  },
): boolean {
  ctx.setParentState({
    activeIndex: ctx.activeSettingIndex,
    scrollOffset: ctx.scrollOffset,
  });
  ctx.setSubSettingsMode({
    isActive: true,
    parentKey: currentSettingKey,
    parentLabel: firstNonEmptyString(
      currentDefinition?.label,
      currentSettingKey,
    ),
  });
  ctx.setActiveSettingIndex(0);
  ctx.setScrollOffset(0);
  return true;
}

export function cycleEnumSetting(
  currentSettingKey: string,
  currentDefinition: _SettingDefinition,
  ctx: {
    pendingSettings: Settings;
    settings: LoadedSettings;
    selectedScope: SettingScope;
    globalPendingChanges: Map<string, PendingValue>;
    setPendingSettings: React.Dispatch<React.SetStateAction<Settings>>;
    setModifiedSettings: React.Dispatch<React.SetStateAction<Set<string>>>;
    setRestartRequiredSettings: React.Dispatch<
      React.SetStateAction<Set<string>>
    >;
    setShowRestartPrompt: React.Dispatch<React.SetStateAction<boolean>>;
    setGlobalPendingChanges: React.Dispatch<
      React.SetStateAction<Map<string, PendingValue>>
    >;
  },
): void {
  const options = currentDefinition.options!;
  const path = currentSettingKey.split('.');
  let currentValue = getNestedValue(ctx.pendingSettings, path);

  if (
    currentValue === undefined &&
    ctx.globalPendingChanges.has(currentSettingKey)
  ) {
    currentValue = ctx.globalPendingChanges.get(currentSettingKey);
  }
  if (currentValue === undefined) {
    currentValue = getNestedValue(ctx.settings.merged, path);
  }
  if (currentValue === undefined) {
    currentValue = getDefaultValue(currentSettingKey);
  }

  const currentIndex = options.findIndex((opt) => opt.value === currentValue);
  const nextIndex =
    currentIndex === -1 ? 0 : (currentIndex + 1) % options.length;
  const newValue = options[nextIndex].value;

  ctx.setPendingSettings((prev) =>
    setPendingSettingValueAny(currentSettingKey, newValue, prev),
  );

  if (!requiresRestart(currentSettingKey)) {
    saveSingleSetting(
      currentSettingKey,
      newValue,
      ctx.settings,
      ctx.selectedScope,
    );
    removeKeyFromTracking(
      currentSettingKey,
      ctx.setModifiedSettings,
      ctx.setRestartRequiredSettings,
      ctx.setGlobalPendingChanges,
    );
  } else {
    trackAsModifiedAndRestart(
      currentSettingKey,
      ctx.setShowRestartPrompt,
      ctx.setModifiedSettings,
      ctx.setRestartRequiredSettings,
    );
    ctx.setGlobalPendingChanges((prev) => {
      const next = new Map(prev);
      next.set(currentSettingKey, newValue as PendingValue);
      return next;
    });
  }
}

export function resetToDefaultImmediate(
  currentSetting: SettingItem,
  defaultValue: unknown,
  ctx: {
    settings: LoadedSettings;
    selectedScope: SettingScope;
    setGlobalPendingChanges: React.Dispatch<
      React.SetStateAction<Map<string, PendingValue>>
    >;
  },
): void {
  const immediateSettings = new Set([currentSetting.value]);
  const toSaveValue = resolveImmediateSaveValue(
    currentSetting.type,
    defaultValue,
  );
  const immediateSettingsObject =
    toSaveValue !== undefined
      ? setPendingSettingValueAny(
          currentSetting.value,
          toSaveValue,
          {} as Settings,
        )
      : ({} as Settings);

  saveModifiedSettings(
    immediateSettings,
    immediateSettingsObject,
    ctx.settings,
    ctx.selectedScope,
  );

  ctx.setGlobalPendingChanges((prev) => {
    if (!prev.has(currentSetting.value)) return prev;
    const next = new Map(prev);
    next.delete(currentSetting.value);
    return next;
  });
}
