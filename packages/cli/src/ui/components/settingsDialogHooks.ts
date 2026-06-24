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
import {
  getScopeItems,
  getScopeMessageForSetting,
} from '../../utils/dialogScopeUtils.js';
import { generateDynamicToolSettings } from '../../utils/dynamicSettings.js';
import {
  getDialogSettingKeys,
  getRestartRequiredFromModified,
  getSettingDefinition,
  requiresRestart,
  saveModifiedSettings,
  setPendingSettingValue,
  setPendingSettingValueAny,
} from '../../utils/settingsUtils.js';
import type { Key } from '../hooks/useKeypress.js';
import { useKeypress } from '../hooks/useKeypress.js';
import { cpLen, getCachedStringWidth } from '../utils/textUtils.js';
import {
  buildNormalSettingItem,
  buildSubSettingItem,
  commitEdit,
} from './settingsDialogActions.js';
import { isTypedScalarOrArraySetting } from './settingsDialogHelpers.js';
import type { KeypressCtx } from './settingsDialogKeypress.js';
import { handleSettingsKeypress } from './settingsDialogKeypress.js';
import type { PendingValue, SettingItem } from './settingsDialogTypes.js';
import type { Config } from '@vybestack/llxprt-code-core';
import { AsyncFzf } from 'fzf';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

interface FzfResult {
  item: string;
  start: number;
  end: number;
  score: number;
  positions?: number[];
}

const maxItemsToShow = 8;

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

  // These Sets and the setter bag are seeds/outputs of the effect below, not
  // inputs that should retrigger it. Reading them through refs keeps the effect
  // dependency list limited to true inputs and avoids the infinite re-render
  // loop tracked in issue #607.
  const modifiedSettingsRef = useRef(modifiedSettings);
  const restartRequiredSettingsRef = useRef(_restartRequiredSettings);
  const stateSettersRef = useRef(stateSetters);
  modifiedSettingsRef.current = modifiedSettings;
  restartRequiredSettingsRef.current = _restartRequiredSettings;
  stateSettersRef.current = stateSetters;

  useEffect(() => {
    const scopeSettings = settings.forScope(selectedScope).settings;
    let updated = structuredClone(scopeSettings);

    for (const [key, value] of Object.entries(settings.merged)) {
      const def = getSettingDefinition(key);
      if (def?.type === 'enum') {
        (updated as Record<string, unknown>)[key] = value;
      }
    }

    const newModified = new Set(modifiedSettingsRef.current);
    const newRestartRequired = new Set(restartRequiredSettingsRef.current);

    for (const [key, value] of globalPendingChanges.entries()) {
      const def = getSettingDefinition(key);
      if (def?.type === 'boolean' && typeof value === 'boolean') {
        updated = setPendingSettingValue(key, value, updated);
      } else if (isTypedScalarOrArraySetting(def?.type, value)) {
        updated = setPendingSettingValueAny(key, value, updated);
      }
      newModified.add(key);
      if (requiresRestart(key)) newRestartRequired.add(key);
    }

    const setters = stateSettersRef.current;
    setPendingSettings(updated);
    setters.setModifiedSettings(newModified);
    setters.setRestartRequiredSettings(newRestartRequired);
    setters.setShowRestartPrompt(newRestartRequired.size > 0);
  }, [selectedScope, settings, globalPendingChanges]);

  return { pendingSettings, setPendingSettings };
}

export function useSettingsStateFull(
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

export function useSearchState(
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

export function useEditState() {
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

export function useSettingsDialogRuntime(
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

export function useSettingsItemsAndActions(
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
