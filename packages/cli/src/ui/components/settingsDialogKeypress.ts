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
  getSettingDefinition,
  requiresRestart,
  setPendingSettingValue,
  setPendingSettingValueAny,
} from '../../utils/settingsUtils.js';
import type { Key } from '../hooks/useKeypress.js';
import { Command, keyMatchers } from '../keyMatchers.js';
import { cpLen, cpSlice, stripUnsafeCharacters } from '../utils/textUtils.js';
import {
  cycleEnumSetting,
  enterSubSettings,
  resetToDefaultImmediate,
} from './settingsDialogActions.js';
import { matchesScalarSettingType } from './settingsDialogHelpers.js';
import type { PendingValue, SettingItem } from './settingsDialogTypes.js';
import type { Config } from '@vybestack/llxprt-code-core';
import type React from 'react';

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
  if (isPrintableSearchChar(ch, key)) {
    ctx.setSearchQuery((prev) => prev + ch);
    return true;
  }

  return true; // consume all keys while searching
}

function isPrintableSearchChar(ch: string, key: Key): boolean {
  if (ch.length !== 1 || key.ctrl || key.meta) {
    return false;
  }
  const isNavigation =
    keyMatchers[Command.DIALOG_NAVIGATION_UP](key) ||
    keyMatchers[Command.DIALOG_NAVIGATION_DOWN](key);
  return !isNavigation;
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
  if (type === 'number') {
    pasted = key.sequence.replace(/[^0-9\-+.]/g, '');
  }
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
  } else if (matchesScalarSettingType(currentSetting.type, defaultValue)) {
    ctx.setGlobalPendingChanges((prev) => {
      const next = new Map(prev);
      next.set(currentSetting.value, defaultValue as PendingValue);
      return next;
    });
  }
}

export interface KeypressCtx {
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

export function handleSettingsKeypress(key: Key, ctx: KeypressCtx): void {
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
  const isSearchTrigger =
    key.sequence === '/' && !key.ctrl && !key.meta && !ctx.editingKey;
  if (ctx.focusSection === 'settings' && isSearchTrigger) {
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
