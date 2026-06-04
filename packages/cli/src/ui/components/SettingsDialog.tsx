/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable complexity, sonarjs/cognitive-complexity, max-lines, eslint-comments/disable-enable-pair -- Phase 5: legacy UI boundary retained while larger decomposition continues. */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Box, Text } from 'ink';
import { AsyncFzf } from 'fzf';
import { Colors } from '../colors.js';
import {
  SettingScope,
  type LoadedSettings,
  type Settings,
  type ToolEnabledState,
} from '../../config/settings.js';
import {
  getScopeItems,
  getScopeMessageForSetting,
} from '../../utils/dialogScopeUtils.js';
import { RadioButtonSelect } from './shared/RadioButtonSelect.js';
import {
  getDialogSettingKeys,
  getSettingValue,
  setPendingSettingValue,
  getDisplayValue,
  hasRestartRequiredSettings,
  saveModifiedSettings,
  getSettingDefinition,
  isDefaultValue,
  requiresRestart,
  getRestartRequiredFromModified,
  getDefaultValue,
  setPendingSettingValueAny,
  getNestedValue,
} from '../../utils/settingsUtils.js';
import { saveSingleSetting } from '../../utils/singleSettingSaver.js';
import { useVimMode } from '../contexts/VimModeContext.js';
import { useKeypress, type Key } from '../hooks/useKeypress.js';
import chalk from 'chalk';
import {
  cpSlice,
  cpLen,
  stripUnsafeCharacters,
  getCachedStringWidth,
} from '../utils/textUtils.js';
import type { Config } from '@vybestack/llxprt-code-core';
import type { SettingDefinition as _SettingDefinition } from '../../config/settingsSchema.js';
import { generateDynamicToolSettings } from '../../utils/dynamicSettings.js';
import { keyMatchers, Command } from '../keyMatchers.js';
import { debugLogger } from '@vybestack/llxprt-code-core';

interface FzfResult {
  item: string;
  start: number;
  end: number;
  score: number;
  positions?: number[];
}

interface SettingsDialogProps {
  settings: LoadedSettings;
  onSelect: (settingName: string | undefined, scope: SettingScope) => void;
  onRestartRequest?: () => void;
  availableTerminalHeight?: number;
  config?: Config;
}

interface TextInputProps {
  focus: boolean;
  value: string;
  placeholder?: string;
}

/**
 * Simple text input component for search.
 */
function TextInput({ focus, value, placeholder }: TextInputProps) {
  const showPlaceholder = value === '' && placeholder !== undefined;

  if (showPlaceholder) {
    return <Text color={Colors.Gray}>{placeholder}</Text>;
  }

  const text = value;
  const cursorPos = text.length;
  const beforeCursor = text.slice(0, cursorPos);
  const atCursor = text[cursorPos] ?? ' ';
  const afterCursor = text.slice(cursorPos + 1);

  return (
    <>
      <Text color={Colors.Foreground}>{beforeCursor}</Text>
      {focus && (
        <Text backgroundColor={Colors.AccentCyan} color={Colors.Background}>
          {atCursor}
        </Text>
      )}
      {!focus && <Text color={Colors.Foreground}>{atCursor}</Text>}
      <Text color={Colors.Foreground}>{afterCursor}</Text>
    </>
  );
}

const maxItemsToShow = 8;

type PendingValue = boolean | number | string | string[];

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

// --- Setting item type ---

interface SettingItem {
  label: string;
  description?: string;
  value: string;
  type: string | undefined;
  toggle: () => void;
}

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

function getPendingExcludeTools(
  settings: LoadedSettings,
  globalPendingChanges: Map<string, PendingValue>,
): string[] {
  const currentExcludeTools = settings.merged.excludeTools ?? [];
  if (globalPendingChanges.has('excludeTools')) {
    return globalPendingChanges.get('excludeTools') as string[];
  }
  return currentExcludeTools;
}

function buildNewExcludeToolsList(
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

function buildSubSettingItem(
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

function buildNormalSettingItem(
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

function commitEdit(
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
  const type = definition?.type;
  const clearEditState = () => {
    setEditingKey(null);
    setEditBuffer('');
    setEditCursorPos(0);
  };

  if (editBuffer.trim() === '' && type === 'number') {
    clearEditState();
    return;
  }

  let parsed: string | number;
  if (type === 'number') {
    const numParsed = Number(editBuffer.trim());
    if (Number.isNaN(numParsed)) {
      clearEditState();
      return;
    }
    parsed = numParsed;
  } else {
    parsed = editBuffer;
  }

  setPendingSettings((prev) => setPendingSettingValueAny(key, parsed, prev));

  if (!requiresRestart(key)) {
    commitEditImmediate(
      key,
      parsed,
      settings,
      selectedScope,
      setModifiedSettings,
      setRestartRequiredSettings,
      setGlobalPendingChanges,
    );
  } else {
    commitEditRestartRequired(
      key,
      parsed,
      setShowRestartPrompt,
      setModifiedSettings,
      setRestartRequiredSettings,
      setGlobalPendingChanges,
    );
  }

  clearEditState();
}

// --- useSettingsState hook ---

function useSettingsState(
  settings: LoadedSettings,
  selectedScope: SettingScope,
  modifiedSettings: Set<string>,
  _restartRequiredSettings: Set<string>,
  globalPendingChanges: Map<string, PendingValue>,
  stateSetters: {
    setModifiedSettings: React.Dispatch<React.SetStateAction<Set<string>>>;
    setRestartRequiredSettings: React.Dispatch<
      React.SetStateAction<Set<string>>
    >;
    setShowRestartPrompt: React.Dispatch<React.SetStateAction<boolean>>;
  },
) {
  const [pendingSettings, setPendingSettings] = useState<Settings>(() =>
    structuredClone(settings.forScope(selectedScope).settings),
  );

  useEffect(() => {
    const scopeSettings = settings.forScope(selectedScope).settings;
    let updated = structuredClone(scopeSettings);

    for (const [key, value] of Object.entries(settings.merged)) {
      const def = getSettingDefinition(key);
      if (def?.type === 'enum') {
        (updated as Record<string, unknown>)[key] = value;
      }
    }

    const newModified = new Set(modifiedSettings);
    const newRestartRequired = new Set(_restartRequiredSettings);

    for (const [key, value] of globalPendingChanges.entries()) {
      const def = getSettingDefinition(key);
      if (def?.type === 'boolean' && typeof value === 'boolean') {
        updated = setPendingSettingValue(key, value, updated);
      } else if (
        // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
        (def?.type === 'number' && typeof value === 'number') ||
        (def?.type === 'string' && typeof value === 'string') ||
        (def?.type === 'enum' && typeof value === 'string')
      ) {
        updated = setPendingSettingValueAny(key, value, updated);
      } else if (def?.type === 'array' && Array.isArray(value)) {
        updated = setPendingSettingValueAny(key, value, updated);
      }
      newModified.add(key);
      if (requiresRestart(key)) newRestartRequired.add(key);
    }

    setPendingSettings(updated);
    stateSetters.setModifiedSettings(newModified);
    stateSetters.setRestartRequiredSettings(newRestartRequired);
    stateSetters.setShowRestartPrompt(newRestartRequired.size > 0);
    // Note: _restartRequiredSettings and modifiedSettings are intentionally excluded
    // from dependencies because they are outputs of this effect, not inputs.
    // Including them would create an infinite loop (issue #607).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedScope, settings, globalPendingChanges]);

  return { pendingSettings, setPendingSettings };
}

function useSettingsStateFull(
  settings: LoadedSettings,
  selectedScope: SettingScope,
) {
  const [modifiedSettings, setModifiedSettings] = useState<Set<string>>(
    new Set(),
  );
  const [globalPendingChanges, setGlobalPendingChanges] = useState<
    Map<string, PendingValue>
  >(new Map());
  const [subSettingsMode, setSubSettingsMode] = useState<{
    isActive: boolean;
    parentKey: string;
    parentLabel: string;
  }>({
    isActive: false,
    parentKey: '',
    parentLabel: '',
  });
  const [parentState, setParentState] = useState<{
    activeIndex: number;
    scrollOffset: number;
  }>({
    activeIndex: 0,
    scrollOffset: 0,
  });
  const [_restartRequiredSettings, setRestartRequiredSettings] = useState<
    Set<string>
  >(new Set());
  const [showRestartPrompt, setShowRestartPrompt] = useState(false);

  const { pendingSettings, setPendingSettings } = useSettingsState(
    settings,
    selectedScope,
    modifiedSettings,
    _restartRequiredSettings,
    globalPendingChanges,
    {
      setModifiedSettings,
      setRestartRequiredSettings,
      setShowRestartPrompt,
    },
  );

  return {
    pendingSettings,
    setPendingSettings,
    modifiedSettings,
    setModifiedSettings,
    globalPendingChanges,
    setGlobalPendingChanges,
    subSettingsMode,
    setSubSettingsMode,
    parentState,
    setParentState,
    _restartRequiredSettings,
    setRestartRequiredSettings,
    showRestartPrompt,
    setShowRestartPrompt,
  };
}

// --- useSearchState hook ---

type SearchState = ReturnType<typeof useSearchState>;

function useSearchState(
  setActiveSettingIndex: React.Dispatch<React.SetStateAction<number>>,
  setScrollOffset: React.Dispatch<React.SetStateAction<number>>,
) {
  const [isSearching, setIsSearching] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredKeys, setFilteredKeys] = useState<string[]>(() =>
    getDialogSettingKeys(),
  );
  const { fzfInstance, searchMap } = useMemo(() => {
    const keys = getDialogSettingKeys();
    const map = new Map<string, string>();
    const searchItems: string[] = [];

    keys.forEach((key) => {
      const def = getSettingDefinition(key);
      if (def?.label) {
        searchItems.push(def.label);
        map.set(def.label.toLowerCase(), key);
      }
    });

    const fzf = new AsyncFzf(searchItems, {
      fuzzy: 'v2',
      casing: 'case-insensitive',
    });
    return { fzfInstance: fzf, searchMap: map };
  }, []);

  useEffect(() => {
    let active = true;
    if (searchQuery.trim() === '') {
      setFilteredKeys(getDialogSettingKeys());
      return undefined;
    }

    const doSearch = async () => {
      const results = await fzfInstance.find(searchQuery);

      if (!active) return undefined;

      const matchedKeys = new Set<string>();
      results.forEach((res: FzfResult) => {
        const key = searchMap.get(res.item.toLowerCase());
        if (key) matchedKeys.add(key);
      });
      setFilteredKeys(Array.from(matchedKeys));
      setActiveSettingIndex(0);
      setScrollOffset(0);
      return undefined;
    };

    void doSearch();

    return () => {
      active = false;
    };
  }, [
    searchQuery,
    fzfInstance,
    searchMap,
    setActiveSettingIndex,
    setScrollOffset,
  ]);

  return {
    isSearching,
    setIsSearching,
    searchQuery,
    setSearchQuery,
    filteredKeys,
  };
}

// --- useEditState hook ---

function useEditState() {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editBuffer, setEditBuffer] = useState<string>('');
  const [editCursorPos, setEditCursorPos] = useState<number>(0);
  const [cursorVisible, setCursorVisible] = useState<boolean>(true);

  useEffect(() => {
    if (!editingKey) {
      setCursorVisible(true);
      return undefined;
    }
    const id = setInterval(() => setCursorVisible((v) => !v), 500);
    return () => clearInterval(id);
  }, [editingKey]);

  const startEditing = (key: string, initial?: string) => {
    setEditingKey(key);
    const initialValue = initial ?? '';
    setEditBuffer(initialValue);
    setEditCursorPos(cpLen(initialValue));
  };

  return {
    editingKey,
    setEditingKey,
    editBuffer,
    setEditBuffer,
    editCursorPos,
    setEditCursorPos,
    cursorVisible,
    startEditing,
  };
}

// --- useLayoutCalculations hook ---

function useLayoutCalculations(
  availableTerminalHeight: number | undefined,
  showRestartPrompt: boolean,
  itemsLength: number,
) {
  const DIALOG_PADDING = 5;
  const SETTINGS_TITLE_HEIGHT = 2;
  const SCROLL_ARROWS_HEIGHT = 2;
  const SPACING_HEIGHT = 1;
  const SCOPE_SELECTION_HEIGHT = 4;
  const BOTTOM_HELP_TEXT_HEIGHT = 1;
  const RESTART_PROMPT_HEIGHT = showRestartPrompt ? 1 : 0;

  let currentAvailableTerminalHeight =
    availableTerminalHeight ?? Number.MAX_SAFE_INTEGER;
  currentAvailableTerminalHeight -= 2;

  let totalFixedHeight =
    DIALOG_PADDING +
    SETTINGS_TITLE_HEIGHT +
    SCROLL_ARROWS_HEIGHT +
    SPACING_HEIGHT +
    BOTTOM_HELP_TEXT_HEIGHT +
    RESTART_PROMPT_HEIGHT;

  let availableHeightForSettings = Math.max(
    1,
    currentAvailableTerminalHeight - totalFixedHeight,
  );
  let maxVisibleItems = Math.max(1, Math.floor(availableHeightForSettings / 3));
  let showScopeSelection = true;

  if (availableTerminalHeight !== undefined && availableTerminalHeight < 25) {
    const totalWithScope = totalFixedHeight + SCOPE_SELECTION_HEIGHT;
    const availableWithScope = Math.max(
      1,
      currentAvailableTerminalHeight - totalWithScope,
    );
    const maxItemsWithScope = Math.max(1, Math.floor(availableWithScope / 3));

    if (maxVisibleItems > maxItemsWithScope + 1) {
      showScopeSelection = false;
    } else {
      totalFixedHeight += SCOPE_SELECTION_HEIGHT;
      availableHeightForSettings = Math.max(
        1,
        currentAvailableTerminalHeight - totalFixedHeight,
      );
      maxVisibleItems = Math.max(1, Math.floor(availableHeightForSettings / 3));
    }
  } else {
    totalFixedHeight += SCOPE_SELECTION_HEIGHT;
    availableHeightForSettings = Math.max(
      1,
      currentAvailableTerminalHeight - totalFixedHeight,
    );
    maxVisibleItems = Math.max(1, Math.floor(availableHeightForSettings / 2));
  }

  const effectiveMaxItemsToShow =
    availableTerminalHeight !== undefined
      ? Math.min(maxVisibleItems, itemsLength)
      : maxItemsToShow;

  return { effectiveMaxItemsToShow, showScopeSelection };
}

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

// --- SettingItemRow component ---

interface SettingItemRowProps {
  item: SettingItem;
  idx: number;
  scrollOffset: number;
  focusSection: 'settings' | 'scope';
  activeSettingIndex: number;
  maxLabelOrDescriptionWidth: number;
  displayValue: string;
  selectedScope: SettingScope;
  settings: LoadedSettings;
}

function SettingItemRow({
  item,
  idx,
  scrollOffset,
  focusSection,
  activeSettingIndex,
  maxLabelOrDescriptionWidth,
  displayValue,
  selectedScope,
  settings,
}: SettingItemRowProps) {
  const isActive =
    focusSection === 'settings' && activeSettingIndex === idx + scrollOffset;

  const scopeSettings = settings.forScope(selectedScope).settings;
  const shouldBeGreyedOut = isDefaultValue(item.value, scopeSettings);

  const scopeMessage = getScopeMessageForSetting(
    item.value,
    selectedScope,
    settings,
  );

  return (
    <React.Fragment key={item.value}>
      <Box marginX={1} flexDirection="row" alignItems="flex-start">
        <Box minWidth={2} flexShrink={0}>
          <Text color={isActive ? Colors.AccentGreen : Colors.Gray}>
            {isActive ? '●' : ''}
          </Text>
        </Box>
        <Box
          flexDirection="row"
          flexGrow={1}
          minWidth={0}
          alignItems="flex-start"
        >
          <Box
            flexDirection="column"
            width={maxLabelOrDescriptionWidth}
            minWidth={0}
          >
            <Text color={isActive ? Colors.AccentGreen : Colors.Foreground}>
              {item.label}
              {scopeMessage && <Text color={Colors.Gray}> {scopeMessage}</Text>}
            </Text>
            <Text color={Colors.Gray} wrap="truncate">
              {item.description ?? ''}
            </Text>
          </Box>
          <Box minWidth={3} />
          <Box flexShrink={0}>
            <Text
              color={
                isActive
                  ? Colors.AccentGreen
                  : // eslint-disable-next-line sonarjs/no-nested-conditional -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
                    shouldBeGreyedOut
                    ? Colors.Gray
                    : Colors.Foreground
              }
            >
              {displayValue}
            </Text>
          </Box>
        </Box>
      </Box>
      <Box height={1} />
    </React.Fragment>
  );
}

// --- Keypress handler sub-handlers ---

function handleSearchKeypress(
  key: Key,
  ctx: {
    setIsSearching: React.Dispatch<React.SetStateAction<boolean>>;
    setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  },
): boolean {
  if (keyMatchers[Command.ESCAPE](key)) {
    ctx.setIsSearching(false);
    ctx.setSearchQuery('');
    return true;
  }
  if (keyMatchers[Command.RETURN](key)) {
    ctx.setIsSearching(false);
    return true;
  }
  if (key.name === 'backspace') {
    ctx.setSearchQuery((prev) => prev.slice(0, -1));
    return true;
  }

  const ch = stripUnsafeCharacters(key.sequence);
  if (
    // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    ch.length === 1 &&
    !key.ctrl &&
    !key.meta &&
    !keyMatchers[Command.DIALOG_NAVIGATION_UP](key) &&
    !keyMatchers[Command.DIALOG_NAVIGATION_DOWN](key)
  ) {
    ctx.setSearchQuery((prev) => prev + ch);
    return true;
  }

  return true; // consume all keys while searching
}

function handleEditPaste(
  key: Key,
  type: string | undefined,
  ctx: {
    editCursorPos: number;
    setEditBuffer: React.Dispatch<React.SetStateAction<string>>;
    setEditCursorPos: React.Dispatch<React.SetStateAction<number>>;
  },
): boolean {
  if (key.name !== 'paste' || !key.sequence) return false;
  let pasted = key.sequence;
  // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
  if (type === 'number') {
    pasted = key.sequence.replace(/[^0-9\-+.]/g, '');
  }
  // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
  if (pasted) {
    ctx.setEditBuffer((b) => {
      const before = cpSlice(b, 0, ctx.editCursorPos);
      const after = cpSlice(b, ctx.editCursorPos);
      return before + pasted + after;
    });
    ctx.setEditCursorPos((pos) => pos + cpLen(pasted));
  }
  return true;
}

function handleEditDelete(
  name: string,
  ctx: {
    editBuffer: string;
    editCursorPos: number;
    setEditBuffer: React.Dispatch<React.SetStateAction<string>>;
    setEditCursorPos: React.Dispatch<React.SetStateAction<number>>;
  },
): boolean {
  if (name !== 'backspace' && name !== 'delete') return false;
  // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
  if (name === 'backspace' && ctx.editCursorPos > 0) {
    ctx.setEditBuffer((b) => {
      const before = cpSlice(b, 0, ctx.editCursorPos - 1);
      const after = cpSlice(b, ctx.editCursorPos);
      return before + after;
    });
    ctx.setEditCursorPos((pos) => pos - 1);
  } else if (name === 'delete' && ctx.editCursorPos < cpLen(ctx.editBuffer)) {
    ctx.setEditBuffer((b) => {
      const before = cpSlice(b, 0, ctx.editCursorPos);
      const after = cpSlice(b, ctx.editCursorPos + 1);
      return before + after;
    });
  }
  return true;
}

function handleEditCharInput(
  key: Key,
  type: string | undefined,
  ctx: {
    editCursorPos: number;
    editBuffer: string;
    setEditBuffer: React.Dispatch<React.SetStateAction<string>>;
    setEditCursorPos: React.Dispatch<React.SetStateAction<number>>;
  },
): boolean {
  let ch = key.sequence;
  let isValidChar = false;
  if (type === 'number') {
    isValidChar = /[0-9\-+.]/.test(ch);
  } else {
    ch = stripUnsafeCharacters(ch);
    isValidChar = ch.length === 1;
  }

  if (isValidChar) {
    ctx.setEditBuffer((currentBuffer) => {
      const beforeCursor = cpSlice(currentBuffer, 0, ctx.editCursorPos);
      const afterCursor = cpSlice(currentBuffer, ctx.editCursorPos);
      return beforeCursor + ch + afterCursor;
    });
    ctx.setEditCursorPos((pos) => pos + 1);
    return true;
  }
  return false;
}

function handleEditCursorMovement(
  key: Key,
  ctx: {
    editBuffer: string;
    editCursorPos: number;
    setEditCursorPos: React.Dispatch<React.SetStateAction<number>>;
  },
): boolean {
  const { name } = key;
  if (name === 'left') {
    ctx.setEditCursorPos((pos) => Math.max(0, pos - 1));
    return true;
  }
  if (name === 'right') {
    ctx.setEditCursorPos((pos) => Math.min(cpLen(ctx.editBuffer), pos + 1));
    return true;
  }
  if (keyMatchers[Command.HOME](key)) {
    ctx.setEditCursorPos(0);
    return true;
  }
  if (keyMatchers[Command.END](key)) {
    ctx.setEditCursorPos(cpLen(ctx.editBuffer));
    return true;
  }
  return false;
}

function handleEditKeypress(
  key: Key,
  ctx: {
    editingKey: string;
    editBuffer: string;
    editCursorPos: number;
    setEditBuffer: React.Dispatch<React.SetStateAction<string>>;
    setEditCursorPos: React.Dispatch<React.SetStateAction<number>>;
    doCommitEdit: () => void;
  },
): boolean {
  const { name } = key;
  const definition = getSettingDefinition(ctx.editingKey);
  const type = definition?.type;

  if (handleEditPaste(key, type, ctx)) return true;
  if (handleEditDelete(name, ctx)) return true;
  if (keyMatchers[Command.ESCAPE](key) || keyMatchers[Command.RETURN](key)) {
    ctx.doCommitEdit();
    return true;
  }
  if (handleEditCursorMovement(key, ctx)) return true;
  if (handleEditCharInput(key, type, ctx)) return true;
  return true; // block other keys while editing
}

function handleNavigationKeypress(
  key: Key,
  ctx: {
    editingKey: string | null;
    activeSettingIndex: number;
    scrollOffset: number;
    itemsLength: number;
    effectiveMaxItemsToShow: number;
    doCommitEdit: () => void;
    setActiveSettingIndex: React.Dispatch<React.SetStateAction<number>>;
    setScrollOffset: React.Dispatch<React.SetStateAction<number>>;
  },
): boolean {
  if (keyMatchers[Command.DIALOG_NAVIGATION_UP](key)) {
    if (ctx.editingKey) ctx.doCommitEdit();
    const newIndex =
      ctx.activeSettingIndex > 0
        ? ctx.activeSettingIndex - 1
        : ctx.itemsLength - 1;
    ctx.setActiveSettingIndex(newIndex);
    if (newIndex === ctx.itemsLength - 1) {
      ctx.setScrollOffset(
        Math.max(0, ctx.itemsLength - ctx.effectiveMaxItemsToShow),
      );
    } else if (newIndex < ctx.scrollOffset) {
      ctx.setScrollOffset(newIndex);
    }
    return true;
  }
  if (keyMatchers[Command.DIALOG_NAVIGATION_DOWN](key)) {
    if (ctx.editingKey) ctx.doCommitEdit();
    const newIndex =
      ctx.activeSettingIndex < ctx.itemsLength - 1
        ? ctx.activeSettingIndex + 1
        : 0;
    ctx.setActiveSettingIndex(newIndex);
    if (newIndex === 0) {
      ctx.setScrollOffset(0);
    } else if (newIndex >= ctx.scrollOffset + ctx.effectiveMaxItemsToShow) {
      ctx.setScrollOffset(newIndex - ctx.effectiveMaxItemsToShow + 1);
    }
    return true;
  }
  return false;
}

function enterSubSettings(
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
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing (empty string parentKey should fall back to empty string label)
    parentLabel: currentDefinition?.label || currentSettingKey,
  });
  ctx.setActiveSettingIndex(0);
  ctx.setScrollOffset(0);
  return true;
}

function handleReturnKeypress(
  items: SettingItem[],
  activeSettingIndex: number,
  ctx: {
    editingKey: string | null;
    activeSettingIndex: number;
    scrollOffset: number;
    config?: Config;
    pendingSettings: Settings;
    settings: LoadedSettings;
    selectedScope: SettingScope;
    globalPendingChanges: Map<string, PendingValue>;
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
    setPendingSettings: React.Dispatch<React.SetStateAction<Settings>>;
    setModifiedSettings: React.Dispatch<React.SetStateAction<Set<string>>>;
    setRestartRequiredSettings: React.Dispatch<
      React.SetStateAction<Set<string>>
    >;
    setShowRestartPrompt: React.Dispatch<React.SetStateAction<boolean>>;
    setGlobalPendingChanges: React.Dispatch<
      React.SetStateAction<Map<string, PendingValue>>
    >;
    startEditing: (key: string, initial?: string) => void;
  },
): boolean {
  const currentItem = items[activeSettingIndex];
  const currentSettingKey = currentItem.value;
  const currentDefinition = getSettingDefinition(currentSettingKey);

  const hasSubSettingsDef =
    currentDefinition?.subSettings !== undefined &&
    Object.keys(currentDefinition.subSettings).length > 0;
  const isCoreToolSettings =
    currentSettingKey === 'coreToolSettings' && ctx.config !== undefined;
  const hasSubSettings = hasSubSettingsDef || isCoreToolSettings;

  if (hasSubSettings) {
    return enterSubSettings(currentSettingKey, currentDefinition, ctx);
  }

  if (currentItem.type === 'boolean') {
    currentItem.toggle();
    return true;
  }

  if (currentDefinition?.type === 'enum' && currentDefinition.options) {
    cycleEnumSetting(currentSettingKey, currentDefinition, ctx);
    return true;
  }

  if (currentItem.type === 'number' || currentItem.type === 'string') {
    ctx.startEditing(currentItem.value);
    return true;
  }

  currentItem.toggle();
  return true;
}

function cycleEnumSetting(
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

  // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
  if (
    currentValue === undefined &&
    ctx.globalPendingChanges.has(currentSettingKey)
  ) {
    currentValue = ctx.globalPendingChanges.get(currentSettingKey);
  }
  // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
  if (currentValue === undefined) {
    currentValue = getNestedValue(ctx.settings.merged, path);
  }
  // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
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

function handleResetToDefaultKeypress(
  items: SettingItem[],
  activeSettingIndex: number,
  ctx: {
    settings: LoadedSettings;
    selectedScope: SettingScope;
    pendingSettings: Settings;
    setPendingSettings: React.Dispatch<React.SetStateAction<Settings>>;
    setModifiedSettings: React.Dispatch<React.SetStateAction<Set<string>>>;
    setRestartRequiredSettings: React.Dispatch<
      React.SetStateAction<Set<string>>
    >;
    setGlobalPendingChanges: React.Dispatch<
      React.SetStateAction<Map<string, PendingValue>>
    >;
  },
): void {
  const currentSetting = items[activeSettingIndex];
  const defaultValue = getDefaultValue(currentSetting.value);
  const defType = currentSetting.type;

  if (defType === 'boolean') {
    const booleanDefaultValue =
      typeof defaultValue === 'boolean' ? defaultValue : false;
    ctx.setPendingSettings((prev) =>
      setPendingSettingValue(currentSetting.value, booleanDefaultValue, prev),
    );
  } else if (defType === 'number' || defType === 'string') {
    // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    if (typeof defaultValue === 'number' || typeof defaultValue === 'string') {
      ctx.setPendingSettings((prev) =>
        setPendingSettingValueAny(currentSetting.value, defaultValue, prev),
      );
    }
  } else if (defType === 'enum') {
    ctx.setPendingSettings((prev) =>
      setPendingSettingValueAny(currentSetting.value, defaultValue, prev),
    );
  }

  ctx.setModifiedSettings((prev) => {
    const updated = new Set(prev);
    updated.delete(currentSetting.value);
    return updated;
  });
  ctx.setRestartRequiredSettings((prev) => {
    const updated = new Set(prev);
    updated.delete(currentSetting.value);
    return updated;
  });

  if (!requiresRestart(currentSetting.value)) {
    resetToDefaultImmediate(currentSetting, defaultValue, ctx);
  } else if (
    // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    (currentSetting.type === 'boolean' && typeof defaultValue === 'boolean') ||
    (currentSetting.type === 'number' && typeof defaultValue === 'number') ||
    (currentSetting.type === 'string' && typeof defaultValue === 'string')
  ) {
    ctx.setGlobalPendingChanges((prev) => {
      const next = new Map(prev);
      next.set(currentSetting.value, defaultValue as PendingValue);
      return next;
    });
  }
}

function resetToDefaultImmediate(
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
  const toSaveValue =
    // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    currentSetting.type === 'boolean'
      ? // eslint-disable-next-line sonarjs/no-nested-conditional -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
        typeof defaultValue === 'boolean'
        ? defaultValue
        : false
      : // eslint-disable-next-line sonarjs/no-nested-conditional -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
        typeof defaultValue === 'number' || typeof defaultValue === 'string'
        ? defaultValue
        : undefined;
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
    // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    if (!prev.has(currentSetting.value)) return prev;
    const next = new Map(prev);
    next.delete(currentSetting.value);
    return next;
  });
}

// --- computeDisplayValue fix: use selectedScope correctly ---

function computeDisplayValueForItem(
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

// --- Main component ---

export function SettingsDialog(props: SettingsDialogProps): React.JSX.Element {
  const {
    settings,
    onSelect,
    onRestartRequest,
    availableTerminalHeight,
    config,
  } = props;
  const { vimEnabled } = useVimMode();
  const [focusSection, setFocusSection] = useState<'settings' | 'scope'>(
    'settings',
  );
  const [selectedScope, setSelectedScope] = useState<SettingScope>(
    SettingScope.User,
  );
  const settingsState = useSettingsStateFull(settings, selectedScope);
  const [activeSettingIndex, setActiveSettingIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const search = useSearchState(setActiveSettingIndex, setScrollOffset);
  const edit = useEditState();

  const itemsCtx = useSettingsItemsAndActions(
    settings,
    selectedScope,
    settingsState,
    search,
    edit,
    vimEnabled,
    config,
    setSelectedScope,
    setFocusSection,
  );
  const dialogState = useSettingsDialogRuntime({
    availableTerminalHeight,
    focusSection,
    search,
    edit,
    settingsState,
    itemsCtx,
    activeSettingIndex,
    scrollOffset,
    selectedScope,
    settings,
    config,
    onRestartRequest,
    onSelect,
    setFocusSection,
    setActiveSettingIndex,
    setScrollOffset,
  });

  return (
    <SettingsDialogLayout
      focusSection={focusSection}
      editingKey={edit.editingKey}
      isSearching={search.isSearching}
      searchQuery={search.searchQuery}
      subSettingsMode={settingsState.subSettingsMode}
      visibleItems={dialogState.visibleItems}
      scrollOffset={scrollOffset}
      activeSettingIndex={activeSettingIndex}
      maxLabelOrDescriptionWidth={dialogState.maxLabelOrDescriptionWidth}
      showScopeSelection={dialogState.layout.showScopeSelection}
      showRestartPrompt={settingsState.showRestartPrompt}
      selectedScope={selectedScope}
      settings={settings}
      scopeItems={itemsCtx.scopeItems}
      editBuffer={edit.editBuffer}
      editCursorPos={edit.editCursorPos}
      cursorVisible={edit.cursorVisible}
      pendingSettings={settingsState.pendingSettings}
      modifiedSettings={settingsState.modifiedSettings}
      globalPendingChanges={settingsState.globalPendingChanges}
      handleScopeSelect={itemsCtx.handleScopeSelect}
      handleScopeHighlight={itemsCtx.handleScopeHighlight}
    />
  );
}

// --- Keypress context type ---

interface SettingsDialogRuntimeArgs {
  availableTerminalHeight?: number;
  focusSection: 'settings' | 'scope';
  search: SearchState;
  edit: ReturnType<typeof useEditState>;
  settingsState: ReturnType<typeof useSettingsStateFull>;
  itemsCtx: ReturnType<typeof useSettingsItemsAndActions>;
  activeSettingIndex: number;
  scrollOffset: number;
  selectedScope: SettingScope;
  settings: LoadedSettings;
  config?: Config;
  onRestartRequest?: () => void;
  onSelect: (settingName: string | undefined, scope: SettingScope) => void;
  setFocusSection: React.Dispatch<React.SetStateAction<'settings' | 'scope'>>;
  setActiveSettingIndex: React.Dispatch<React.SetStateAction<number>>;
  setScrollOffset: React.Dispatch<React.SetStateAction<number>>;
}

interface SettingsDialogRuntimeState {
  layout: ReturnType<typeof useLayoutCalculations>;
  visibleItems: SettingItem[];
  maxLabelOrDescriptionWidth: number;
}

function useSettingsDialogRuntime(
  args: SettingsDialogRuntimeArgs,
): SettingsDialogRuntimeState {
  const layout = useLayoutCalculations(
    args.availableTerminalHeight,
    args.settingsState.showRestartPrompt,
    args.itemsCtx.items.length,
  );
  useSettingsFocusGuard(
    layout.showScopeSelection,
    args.focusSection,
    args.setFocusSection,
  );
  const saveRestart = useSaveRestartRequiredSettings(
    args.settingsState.modifiedSettings,
    args.settingsState.pendingSettings,
    args.settings,
    args.selectedScope,
    args.settingsState.setGlobalPendingChanges,
  );
  useSettingsDialogKeypress(args, layout, saveRestart);
  return {
    layout,
    visibleItems: args.itemsCtx.items.slice(
      args.scrollOffset,
      args.scrollOffset + layout.effectiveMaxItemsToShow,
    ),
    maxLabelOrDescriptionWidth: useMaxLabelWidth(
      args.selectedScope,
      args.settings,
    ),
  };
}

function useSettingsFocusGuard(
  showScopeSelection: boolean,
  focusSection: 'settings' | 'scope',
  setFocusSection: React.Dispatch<React.SetStateAction<'settings' | 'scope'>>,
): void {
  React.useEffect(() => {
    if (!showScopeSelection && focusSection === 'scope') {
      setFocusSection('settings');
    }
  }, [showScopeSelection, focusSection, setFocusSection]);
}

function useSettingsDialogKeypress(
  args: SettingsDialogRuntimeArgs,
  layout: ReturnType<typeof useLayoutCalculations>,
  saveRestart: () => void,
): void {
  const keypressCtx = buildKeypressCtx({
    focusSection: args.focusSection,
    search: args.search,
    edit: args.edit,
    settingsState: args.settingsState,
    itemsCtx: args.itemsCtx,
    layout,
    activeSettingIndex: args.activeSettingIndex,
    scrollOffset: args.scrollOffset,
    selectedScope: args.selectedScope,
    settings: args.settings,
    config: args.config,
    onRestartRequest: args.onRestartRequest,
    onSelect: args.onSelect,
    saveRestart,
    setFocusSection: args.setFocusSection,
    setActiveSettingIndex: args.setActiveSettingIndex,
    setScrollOffset: args.setScrollOffset,
  });
  useKeypress((key: Key) => handleSettingsKeypress(key, keypressCtx), {
    isActive: true,
  });
}

interface KeypressCtx {
  focusSection: 'settings' | 'scope';
  isSearching: boolean;
  editingKey: string | null;
  showRestartPrompt: boolean;
  items: SettingItem[];
  activeSettingIndex: number;
  scrollOffset: number;
  effectiveMaxItemsToShow: number;
  config?: Config;
  pendingSettings: Settings;
  settings: LoadedSettings;
  selectedScope: SettingScope;
  globalPendingChanges: Map<string, PendingValue>;
  editBuffer: string;
  editCursorPos: number;
  subSettingsMode: {
    isActive: boolean;
    parentKey: string;
    parentLabel: string;
  };
  parentState: { activeIndex: number; scrollOffset: number };
  onRestartRequest?: () => void;
  setIsSearching: React.Dispatch<React.SetStateAction<boolean>>;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  setFocusSection: React.Dispatch<React.SetStateAction<'settings' | 'scope'>>;
  setEditBuffer: React.Dispatch<React.SetStateAction<string>>;
  setEditCursorPos: React.Dispatch<React.SetStateAction<number>>;
  setActiveSettingIndex: React.Dispatch<React.SetStateAction<number>>;
  setScrollOffset: React.Dispatch<React.SetStateAction<number>>;
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
  setPendingSettings: React.Dispatch<React.SetStateAction<Settings>>;
  setModifiedSettings: React.Dispatch<React.SetStateAction<Set<string>>>;
  setRestartRequiredSettings: React.Dispatch<React.SetStateAction<Set<string>>>;
  setShowRestartPrompt: React.Dispatch<React.SetStateAction<boolean>>;
  setGlobalPendingChanges: React.Dispatch<
    React.SetStateAction<Map<string, PendingValue>>
  >;
  doCommitEdit: () => void;
  startEditing: (key: string, initial?: string) => void;
  saveRestartRequiredSettings: () => void;
  showScopeSelection: boolean;
  onSelect: (settingName: string | undefined, scope: SettingScope) => void;
}

interface SettingsFocusCtx {
  editingKey: string | null;
  items: SettingItem[];
  activeSettingIndex: number;
  scrollOffset: number;
  effectiveMaxItemsToShow: number;
  config?: Config;
  pendingSettings: Settings;
  settings: LoadedSettings;
  selectedScope: SettingScope;
  globalPendingChanges: Map<string, PendingValue>;
  editBuffer: string;
  editCursorPos: number;
  setEditBuffer: React.Dispatch<React.SetStateAction<string>>;
  setEditCursorPos: React.Dispatch<React.SetStateAction<number>>;
  setActiveSettingIndex: React.Dispatch<React.SetStateAction<number>>;
  setScrollOffset: React.Dispatch<React.SetStateAction<number>>;
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
  setPendingSettings: React.Dispatch<React.SetStateAction<Settings>>;
  setModifiedSettings: React.Dispatch<React.SetStateAction<Set<string>>>;
  setRestartRequiredSettings: React.Dispatch<React.SetStateAction<Set<string>>>;
  setShowRestartPrompt: React.Dispatch<React.SetStateAction<boolean>>;
  setGlobalPendingChanges: React.Dispatch<
    React.SetStateAction<Map<string, PendingValue>>
  >;
  doCommitEdit: () => void;
  startEditing: (key: string, initial?: string) => void;
}

function buildKeypressCtx(deps: {
  focusSection: 'settings' | 'scope';
  search: SearchState;
  edit: ReturnType<typeof useEditState>;
  settingsState: ReturnType<typeof useSettingsStateFull>;
  itemsCtx: ReturnType<typeof useSettingsItemsAndActions>;
  layout: { effectiveMaxItemsToShow: number; showScopeSelection: boolean };
  activeSettingIndex: number;
  scrollOffset: number;
  selectedScope: SettingScope;
  settings: LoadedSettings;
  config?: Config;
  onRestartRequest?: () => void;
  onSelect: (settingName: string | undefined, scope: SettingScope) => void;
  saveRestart: () => void;
  setFocusSection: React.Dispatch<React.SetStateAction<'settings' | 'scope'>>;
  setActiveSettingIndex: React.Dispatch<React.SetStateAction<number>>;
  setScrollOffset: React.Dispatch<React.SetStateAction<number>>;
}): KeypressCtx {
  return {
    focusSection: deps.focusSection,
    isSearching: deps.search.isSearching,
    editingKey: deps.edit.editingKey,
    showRestartPrompt: deps.settingsState.showRestartPrompt,
    items: deps.itemsCtx.items,
    activeSettingIndex: deps.activeSettingIndex,
    scrollOffset: deps.scrollOffset,
    effectiveMaxItemsToShow: deps.layout.effectiveMaxItemsToShow,
    config: deps.config,
    pendingSettings: deps.settingsState.pendingSettings,
    settings: deps.settings,
    selectedScope: deps.selectedScope,
    globalPendingChanges: deps.settingsState.globalPendingChanges,
    editBuffer: deps.edit.editBuffer,
    editCursorPos: deps.edit.editCursorPos,
    subSettingsMode: deps.settingsState.subSettingsMode,
    parentState: deps.settingsState.parentState,
    onRestartRequest: deps.onRestartRequest,
    setIsSearching: deps.search.setIsSearching,
    setSearchQuery: deps.search.setSearchQuery,
    setFocusSection: deps.setFocusSection,
    setEditBuffer: deps.edit.setEditBuffer,
    setEditCursorPos: deps.edit.setEditCursorPos,
    setActiveSettingIndex: deps.setActiveSettingIndex,
    setScrollOffset: deps.setScrollOffset,
    setSubSettingsMode: deps.settingsState.setSubSettingsMode,
    setParentState: deps.settingsState.setParentState,
    setPendingSettings: deps.settingsState.setPendingSettings,
    setModifiedSettings: deps.settingsState.setModifiedSettings,
    setRestartRequiredSettings: deps.settingsState.setRestartRequiredSettings,
    setShowRestartPrompt: deps.settingsState.setShowRestartPrompt,
    setGlobalPendingChanges: deps.settingsState.setGlobalPendingChanges,
    doCommitEdit: deps.itemsCtx.doCommitEdit,
    startEditing: deps.edit.startEditing,
    saveRestartRequiredSettings: deps.saveRestart,
    showScopeSelection: deps.layout.showScopeSelection,
    onSelect: deps.onSelect,
  };
}

function handleSettingsKeypress(key: Key, ctx: KeypressCtx): void {
  const { name } = key;

  if (name === 'tab') {
    handleTabKeypress(
      ctx.focusSection,
      ctx.isSearching,
      ctx.showScopeSelection,
      {
        setIsSearching: ctx.setIsSearching,
        setFocusSection: ctx.setFocusSection,
      },
    );
    return;
  }

  if (ctx.isSearching) {
    handleSearchKeypress(key, {
      setIsSearching: ctx.setIsSearching,
      setSearchQuery: ctx.setSearchQuery,
    });
    return;
  }
  if (
    // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    ctx.focusSection === 'settings' &&
    !ctx.editingKey &&
    key.sequence === '/' &&
    !key.ctrl &&
    !key.meta
  ) {
    ctx.setIsSearching(true);
    return;
  }

  if (
    ctx.focusSection === 'settings' &&
    handleSettingsFocusKeypress(key, ctx)
  ) {
    return;
  }

  handleGlobalKeypress(key, ctx);
}

function handleSettingsFocusKeypress(key: Key, ctx: SettingsFocusCtx): boolean {
  if (ctx.editingKey) {
    return handleEditKeypress(key, {
      editingKey: ctx.editingKey,
      editBuffer: ctx.editBuffer,
      editCursorPos: ctx.editCursorPos,
      setEditBuffer: ctx.setEditBuffer,
      setEditCursorPos: ctx.setEditCursorPos,
      doCommitEdit: ctx.doCommitEdit,
    });
  }

  if (
    handleNavigationKeypress(key, {
      editingKey: ctx.editingKey,
      activeSettingIndex: ctx.activeSettingIndex,
      scrollOffset: ctx.scrollOffset,
      itemsLength: ctx.items.length,
      effectiveMaxItemsToShow: ctx.effectiveMaxItemsToShow,
      doCommitEdit: ctx.doCommitEdit,
      setActiveSettingIndex: ctx.setActiveSettingIndex,
      setScrollOffset: ctx.setScrollOffset,
    })
  ) {
    return true;
  }

  if (keyMatchers[Command.RETURN](key)) {
    handleReturnKeypress(ctx.items, ctx.activeSettingIndex, {
      editingKey: ctx.editingKey,
      activeSettingIndex: ctx.activeSettingIndex,
      scrollOffset: ctx.scrollOffset,
      config: ctx.config,
      pendingSettings: ctx.pendingSettings,
      settings: ctx.settings,
      selectedScope: ctx.selectedScope,
      globalPendingChanges: ctx.globalPendingChanges,
      setSubSettingsMode: ctx.setSubSettingsMode,
      setParentState: ctx.setParentState,
      setActiveSettingIndex: ctx.setActiveSettingIndex,
      setScrollOffset: ctx.setScrollOffset,
      setPendingSettings: ctx.setPendingSettings,
      setModifiedSettings: ctx.setModifiedSettings,
      setRestartRequiredSettings: ctx.setRestartRequiredSettings,
      setShowRestartPrompt: ctx.setShowRestartPrompt,
      setGlobalPendingChanges: ctx.setGlobalPendingChanges,
      startEditing: ctx.startEditing,
    });
    return true;
  }

  if (/^\d$/.test(key.sequence) && !ctx.editingKey) {
    const currentItem = ctx.items[ctx.activeSettingIndex];
    if (currentItem.type === 'number') {
      ctx.startEditing(currentItem.value, key.sequence);
    }
    return true;
  }

  if (
    keyMatchers[Command.CLEAR_INPUT](key) ||
    keyMatchers[Command.CLEAR_SCREEN](key)
  ) {
    handleResetToDefaultKeypress(ctx.items, ctx.activeSettingIndex, {
      settings: ctx.settings,
      selectedScope: ctx.selectedScope,
      pendingSettings: ctx.pendingSettings,
      setPendingSettings: ctx.setPendingSettings,
      setModifiedSettings: ctx.setModifiedSettings,
      setRestartRequiredSettings: ctx.setRestartRequiredSettings,
      setGlobalPendingChanges: ctx.setGlobalPendingChanges,
    });
    return true;
  }

  return false;
}

function handleGlobalKeypress(
  key: Key,
  ctx: {
    editingKey: string | null;
    showRestartPrompt: boolean;
    subSettingsMode: {
      isActive: boolean;
      parentKey: string;
      parentLabel: string;
    };
    parentState: { activeIndex: number; scrollOffset: number };
    onRestartRequest?: () => void;
    setActiveSettingIndex: React.Dispatch<React.SetStateAction<number>>;
    setScrollOffset: React.Dispatch<React.SetStateAction<number>>;
    setSubSettingsMode: React.Dispatch<
      React.SetStateAction<{
        isActive: boolean;
        parentKey: string;
        parentLabel: string;
      }>
    >;
    setRestartRequiredSettings: React.Dispatch<
      React.SetStateAction<Set<string>>
    >;
    setShowRestartPrompt: React.Dispatch<React.SetStateAction<boolean>>;
    doCommitEdit: () => void;
    saveRestartRequiredSettings: () => void;
    selectedScope: SettingScope;
    onSelect: (settingName: string | undefined, scope: SettingScope) => void;
  },
): void {
  const { name } = key;

  if (ctx.showRestartPrompt && name === 'r') {
    ctx.saveRestartRequiredSettings();
    ctx.setShowRestartPrompt(false);
    ctx.setRestartRequiredSettings(new Set());
    if (ctx.onRestartRequest) ctx.onRestartRequest();
    return;
  }

  if (keyMatchers[Command.ESCAPE](key)) {
    if (ctx.editingKey) {
      ctx.doCommitEdit();
    } else if (ctx.subSettingsMode.isActive) {
      ctx.setSubSettingsMode({
        isActive: false,
        parentKey: '',
        parentLabel: '',
      });
      ctx.setActiveSettingIndex(ctx.parentState.activeIndex);
      ctx.setScrollOffset(ctx.parentState.scrollOffset);
    } else {
      ctx.saveRestartRequiredSettings();
      ctx.onSelect(undefined, ctx.selectedScope);
    }
  }
}

function useSaveRestartRequiredSettings(
  modifiedSettings: Set<string>,
  pendingSettings: Settings,
  settings: LoadedSettings,
  selectedScope: SettingScope,
  setGlobalPendingChanges: React.Dispatch<
    React.SetStateAction<Map<string, PendingValue>>
  >,
): () => void {
  return useCallback(() => {
    const restartRequiredSettings =
      getRestartRequiredFromModified(modifiedSettings);
    const restartRequiredSet = new Set(restartRequiredSettings);

    if (restartRequiredSet.size > 0) {
      saveModifiedSettings(
        restartRequiredSet,
        pendingSettings,
        settings,
        selectedScope,
      );

      setGlobalPendingChanges((prev) => {
        if (prev.size === 0) return prev;
        const next = new Map(prev);
        for (const key of restartRequiredSet) {
          next.delete(key);
        }
        return next;
      });
    }
  }, [
    modifiedSettings,
    pendingSettings,
    settings,
    selectedScope,
    setGlobalPendingChanges,
  ]);
}

function useMaxLabelWidth(
  selectedScope: SettingScope,
  settings: LoadedSettings,
): number {
  return useMemo(() => {
    const allKeys = getDialogSettingKeys();
    let max = 0;
    for (const key of allKeys) {
      const def = getSettingDefinition(key);
      if (!def) continue;

      const scopeMessage = getScopeMessageForSetting(
        key,
        selectedScope,
        settings,
      );
      const label = def.label || key;
      const labelFull = label + (scopeMessage ? ` ${scopeMessage}` : '');
      const lWidth = getCachedStringWidth(labelFull);
      const dWidth = def.description
        ? getCachedStringWidth(def.description)
        : 0;

      max = Math.max(max, lWidth, dWidth);
    }
    return max;
  }, [selectedScope, settings]);
}

interface ItemsActionsCtx {
  settings: LoadedSettings;
  selectedScope: SettingScope;
  subSettingsMode: {
    isActive: boolean;
    parentKey: string;
    parentLabel: string;
  };
  isSearching: boolean;
  searchQuery: string;
  filteredKeys: string[];
  pendingSettings: Settings;
  globalPendingChanges: Map<string, PendingValue>;
  vimEnabled: boolean;
  editingKey: string | null;
  editBuffer: string;
  config?: Config;
  setEditingKey: React.Dispatch<React.SetStateAction<string | null>>;
  setEditBuffer: React.Dispatch<React.SetStateAction<string>>;
  setEditCursorPos: React.Dispatch<React.SetStateAction<number>>;
  setPendingSettings: React.Dispatch<React.SetStateAction<Settings>>;
  setModifiedSettings: React.Dispatch<React.SetStateAction<Set<string>>>;
  setRestartRequiredSettings: React.Dispatch<React.SetStateAction<Set<string>>>;
  setShowRestartPrompt: React.Dispatch<React.SetStateAction<boolean>>;
  setGlobalPendingChanges: React.Dispatch<
    React.SetStateAction<Map<string, PendingValue>>
  >;
  startEditing: (key: string, initial?: string) => void;
}

function useSettingsItemsAndActions(
  settings: LoadedSettings,
  selectedScope: SettingScope,
  settingsState: ReturnType<typeof useSettingsStateFull>,
  search: SearchState,
  edit: ReturnType<typeof useEditState>,
  vimEnabled: boolean,
  config: Config | undefined,
  setSelectedScope: React.Dispatch<React.SetStateAction<SettingScope>>,
  setFocusSection: React.Dispatch<React.SetStateAction<'settings' | 'scope'>>,
) {
  const ctx: ItemsActionsCtx = {
    settings,
    selectedScope,
    subSettingsMode: settingsState.subSettingsMode,
    isSearching: search.isSearching,
    searchQuery: search.searchQuery,
    filteredKeys: search.filteredKeys,
    pendingSettings: settingsState.pendingSettings,
    globalPendingChanges: settingsState.globalPendingChanges,
    vimEnabled,
    editingKey: edit.editingKey,
    editBuffer: edit.editBuffer,
    config,
    setEditingKey: edit.setEditingKey,
    setEditBuffer: edit.setEditBuffer,
    setEditCursorPos: edit.setEditCursorPos,
    setPendingSettings: settingsState.setPendingSettings,
    setModifiedSettings: settingsState.setModifiedSettings,
    setRestartRequiredSettings: settingsState.setRestartRequiredSettings,
    setShowRestartPrompt: settingsState.setShowRestartPrompt,
    setGlobalPendingChanges: settingsState.setGlobalPendingChanges,
    startEditing: edit.startEditing,
  };

  const dynamicToolSettings = useDynamicToolSettings(ctx);
  const doCommitEdit = useDoCommitEdit(ctx);
  const generateSubSettingsItems = useSubSettingsItems(
    ctx,
    dynamicToolSettings,
  );
  const generateNormalSettingsItems = useNormalSettingsItems(ctx);
  const items = useMemo(() => {
    if (ctx.subSettingsMode.isActive)
      return generateSubSettingsItems(ctx.subSettingsMode.parentKey);
    return generateNormalSettingsItems();
  }, [
    ctx.subSettingsMode,
    generateSubSettingsItems,
    generateNormalSettingsItems,
  ]);

  const scopeItems = getScopeItems().map((item) => ({
    ...item,
    key: item.value,
  }));
  const handleScopeHighlight = useCallback(
    (scope: SettingScope) => {
      setSelectedScope(scope);
    },
    [setSelectedScope],
  );
  const handleScopeSelect = useCallback(
    (scope: SettingScope) => {
      setSelectedScope(scope);
      setFocusSection('settings');
    },
    [setFocusSection, setSelectedScope],
  );

  return {
    items,
    doCommitEdit,
    scopeItems,
    handleScopeHighlight,
    handleScopeSelect,
  };
}

function useDynamicToolSettings(ctx: ItemsActionsCtx) {
  return useMemo(() => {
    if (
      ctx.subSettingsMode.isActive &&
      ctx.subSettingsMode.parentKey === 'coreToolSettings' &&
      ctx.config
    )
      return generateDynamicToolSettings(ctx.config);
    return {};
  }, [ctx.subSettingsMode.isActive, ctx.subSettingsMode.parentKey, ctx.config]);
}

function useDoCommitEdit(ctx: ItemsActionsCtx) {
  return useCallback(() => {
    if (ctx.editingKey === null) return;
    commitEdit(
      ctx.editingKey,
      ctx.editBuffer,
      ctx.setEditingKey,
      ctx.setEditBuffer,
      ctx.setEditCursorPos,
      ctx.setPendingSettings,
      ctx.settings,
      ctx.selectedScope,
      ctx.setModifiedSettings,
      ctx.setRestartRequiredSettings,
      ctx.setShowRestartPrompt,
      ctx.setGlobalPendingChanges,
    );
  }, [
    ctx.editingKey,
    ctx.editBuffer,
    ctx.setEditingKey,
    ctx.setEditBuffer,
    ctx.setEditCursorPos,
    ctx.setPendingSettings,
    ctx.settings,
    ctx.selectedScope,
    ctx.setModifiedSettings,
    ctx.setRestartRequiredSettings,
    ctx.setShowRestartPrompt,
    ctx.setGlobalPendingChanges,
  ]);
}

function useSubSettingsItems(
  ctx: ItemsActionsCtx,
  dynamicToolSettings: Record<string, _SettingDefinition>,
) {
  return useCallback(
    (parentKey: string): SettingItem[] => {
      const parentDefinition = getSettingDefinition(parentKey);
      let subSettings = parentDefinition?.subSettings ?? {};
      if (parentKey === 'coreToolSettings')
        subSettings = { ...subSettings, ...dynamicToolSettings };

      const subCtx = {
        settings: ctx.settings,
        selectedScope: ctx.selectedScope,
        pendingSettings: ctx.pendingSettings,
        globalPendingChanges: ctx.globalPendingChanges,
        setPendingSettings: ctx.setPendingSettings,
        setModifiedSettings: ctx.setModifiedSettings,
        setRestartRequiredSettings: ctx.setRestartRequiredSettings,
        setShowRestartPrompt: ctx.setShowRestartPrompt,
        setGlobalPendingChanges: ctx.setGlobalPendingChanges,
      };

      return Object.entries(subSettings).map(([key, def]) =>
        buildSubSettingItem(key, def, parentKey, subCtx),
      );
    },
    [dynamicToolSettings, ctx],
  );
}

function useNormalSettingsItems(ctx: ItemsActionsCtx) {
  return useCallback((): SettingItem[] => {
    const settingKeys =
      ctx.isSearching || ctx.searchQuery
        ? ctx.filteredKeys
        : getDialogSettingKeys();
    const normCtx = {
      settings: ctx.settings,
      selectedScope: ctx.selectedScope,
      pendingSettings: ctx.pendingSettings,
      vimEnabled: ctx.vimEnabled,
      setPendingSettings: ctx.setPendingSettings,
      setModifiedSettings: ctx.setModifiedSettings,
      setRestartRequiredSettings: ctx.setRestartRequiredSettings,
      setShowRestartPrompt: ctx.setShowRestartPrompt,
      setGlobalPendingChanges: ctx.setGlobalPendingChanges,
    };
    return settingKeys.map((key: string) =>
      buildNormalSettingItem(key, getSettingDefinition(key), normCtx),
    );
  }, [ctx]);
}

// --- Layout component ---

interface SettingsDialogLayoutProps {
  focusSection: 'settings' | 'scope';
  editingKey: string | null;
  isSearching: boolean;
  searchQuery: string;
  subSettingsMode: {
    isActive: boolean;
    parentKey: string;
    parentLabel: string;
  };
  visibleItems: SettingItem[];
  scrollOffset: number;
  activeSettingIndex: number;
  maxLabelOrDescriptionWidth: number;
  showScopeSelection: boolean;
  showRestartPrompt: boolean;
  selectedScope: SettingScope;
  settings: LoadedSettings;
  scopeItems: Array<{ key: string; value: SettingScope; label: string }>;
  editBuffer: string;
  editCursorPos: number;
  cursorVisible: boolean;
  pendingSettings: Settings;
  modifiedSettings: Set<string>;
  globalPendingChanges: Map<string, PendingValue>;
  handleScopeSelect: (scope: SettingScope) => void;
  handleScopeHighlight: (scope: SettingScope) => void;
}

function SettingsDialogLayout(
  props: SettingsDialogLayoutProps,
): React.JSX.Element {
  return (
    <Box
      borderStyle="round"
      borderColor={Colors.Gray}
      flexDirection="row"
      padding={1}
      width="100%"
      height="100%"
    >
      <Box flexDirection="column" flexGrow={1}>
        <SettingsDialogHeader {...props} />
        <SettingsListContent {...props} />
        <SettingsScopeSection {...props} />
        <SettingsDialogFooter {...props} />
      </Box>
    </Box>
  );
}

function SettingsDialogHeader({
  focusSection,
  editingKey,
  subSettingsMode,
  isSearching,
  searchQuery,
}: Pick<
  SettingsDialogLayoutProps,
  | 'focusSection'
  | 'editingKey'
  | 'subSettingsMode'
  | 'isSearching'
  | 'searchQuery'
>): React.JSX.Element {
  const borderColor =
    editingKey === null && focusSection === 'settings'
      ? Colors.AccentGreen
      : Colors.Gray;
  const title = subSettingsMode.isActive
    ? `${subSettingsMode.parentLabel} > Settings`
    : 'Settings';

  return (
    <>
      <Box marginX={1}>
        <Text
          bold={focusSection === 'settings' && editingKey === null}
          color={Colors.AccentBlue}
          wrap="truncate"
        >
          {focusSection === 'settings' ? '> ' : '  '}
          {title}{' '}
        </Text>
      </Box>
      <Box
        borderStyle="round"
        borderColor={borderColor}
        paddingX={1}
        height={3}
        marginTop={1}
      >
        <TextInput
          focus={
            focusSection === 'settings' && isSearching && editingKey === null
          }
          value={searchQuery}
          placeholder="Search to filter"
        />
      </Box>
      <Box height={1} />
    </>
  );
}

type SettingsListContentProps = Pick<
  SettingsDialogLayoutProps,
  | 'searchQuery'
  | 'visibleItems'
  | 'scrollOffset'
  | 'focusSection'
  | 'activeSettingIndex'
  | 'maxLabelOrDescriptionWidth'
  | 'selectedScope'
  | 'settings'
  | 'editingKey'
  | 'editBuffer'
  | 'editCursorPos'
  | 'cursorVisible'
  | 'pendingSettings'
  | 'modifiedSettings'
  | 'globalPendingChanges'
  | 'subSettingsMode'
>;

function SettingsListContent(
  props: SettingsListContentProps,
): React.JSX.Element {
  if (props.searchQuery !== '' && props.visibleItems.length === 0) {
    return (
      <Box marginX={1} height={1} flexDirection="column">
        <Text color={Colors.Gray}>No matches found.</Text>
      </Box>
    );
  }

  return (
    <>
      <Box marginX={1}>
        <Text color={Colors.Gray}>▲</Text>
      </Box>
      {props.visibleItems.map((item, idx) => (
        <SettingItemRow
          key={item.value}
          item={item}
          idx={idx}
          scrollOffset={props.scrollOffset}
          focusSection={props.focusSection}
          activeSettingIndex={props.activeSettingIndex}
          maxLabelOrDescriptionWidth={props.maxLabelOrDescriptionWidth}
          displayValue={computeDisplayValueForItem(
            item,
            props.selectedScope,
            props,
          )}
          selectedScope={props.selectedScope}
          settings={props.settings}
        />
      ))}
      <Box marginX={1}>
        <Text color={Colors.Gray}>▼</Text>
      </Box>
    </>
  );
}

function SettingsScopeSection({
  showScopeSelection,
  focusSection,
  scopeItems,
  selectedScope,
  handleScopeSelect,
  handleScopeHighlight,
}: Pick<
  SettingsDialogLayoutProps,
  | 'showScopeSelection'
  | 'focusSection'
  | 'scopeItems'
  | 'selectedScope'
  | 'handleScopeSelect'
  | 'handleScopeHighlight'
>): React.JSX.Element {
  return (
    <>
      <Box height={1} />
      {showScopeSelection && (
        <Box marginX={1} flexDirection="column">
          <Text
            bold={focusSection === 'scope'}
            wrap="truncate"
            color={Colors.Foreground}
          >
            {focusSection === 'scope' ? '> ' : '  '}Apply To
          </Text>
          <RadioButtonSelect
            items={scopeItems}
            initialIndex={scopeItems.findIndex(
              (item) => item.value === selectedScope,
            )}
            onSelect={handleScopeSelect}
            onHighlight={handleScopeHighlight}
            isFocused={focusSection === 'scope'}
            showNumbers={focusSection === 'scope'}
          />
        </Box>
      )}
    </>
  );
}

function SettingsDialogFooter({
  isSearching,
  showScopeSelection,
  showRestartPrompt,
}: Pick<
  SettingsDialogLayoutProps,
  'isSearching' | 'showScopeSelection' | 'showRestartPrompt'
>): React.JSX.Element {
  const focusHelp = showScopeSelection
    ? 'Use Enter to select, Tab to change focus'
    : 'Use Enter to select';
  const helpText = isSearching
    ? '(Type to search, Esc to clear, Enter to navigate)'
    : `(${focusHelp}, / to search, Esc to close)`;

  return (
    <>
      <Box height={1} />
      <Box marginX={1}>
        <Text color={Colors.Gray}>{helpText}</Text>
      </Box>
      {showRestartPrompt && (
        <Box marginX={1}>
          <Text color={Colors.AccentYellow}>
            To see changes, LLxprt Code must be restarted. Press r to exit and
            apply changes now.
          </Text>
        </Box>
      )}
    </>
  );
}

function handleTabKeypress(
  focusSection: 'settings' | 'scope',
  isSearching: boolean,
  showScopeSelection: boolean,
  ctx: {
    setIsSearching: React.Dispatch<React.SetStateAction<boolean>>;
    setFocusSection: React.Dispatch<React.SetStateAction<'settings' | 'scope'>>;
  },
): void {
  if (focusSection === 'settings' && isSearching) {
    ctx.setIsSearching(false);
  } else if (focusSection === 'settings' && !isSearching) {
    if (showScopeSelection) {
      ctx.setFocusSection('scope');
    } else {
      ctx.setIsSearching(true);
    }
  } else if (focusSection === 'scope') {
    ctx.setIsSearching(true);
    ctx.setFocusSection('settings');
  }
}
