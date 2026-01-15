/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
import {
  LoadedSettings,
  SettingScope,
  Settings,
  ToolEnabledState,
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
import { useKeypress } from '../hooks/useKeypress.js';
import chalk from 'chalk';
import { cpSlice, cpLen, stripUnsafeCharacters } from '../utils/textUtils.js';
import type { Config } from '@vybestack/llxprt-code-core';
import { SettingDefinition } from '../../config/settingsSchema.js';
import { generateDynamicToolSettings } from '../../utils/dynamicSettings.js';
import { keyMatchers, Command } from '../keyMatchers.js';

interface SettingsDialogProps {
  settings: LoadedSettings;
  onSelect: (settingName: string | undefined, scope: SettingScope) => void;
  onRestartRequest?: () => void;
  config?: Config;
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
      pendingExcludeTools ?? ((settings.merged.excludeTools as string[]) || []);
    // Tool is enabled if not in excludeTools
    return excludeTools.includes(toolName) ? 'disabled' : 'enabled';
  } catch (error) {
    console.error('Error getting tool state:', error);
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
    const currentExcludeTools =
      (settings.merged.excludeTools as string[]) || [];
    let newExcludeTools = [...currentExcludeTools];

    if (state === 'enabled') {
      // Enable tool: remove from excludeTools
      newExcludeTools = newExcludeTools.filter((name) => name !== toolName);
    } else {
      // Disable tool: add to excludeTools
      if (!newExcludeTools.includes(toolName)) {
        newExcludeTools.push(toolName);
      }
    }

    // Save changes directly using setValue since saveSingleSetting skips coreToolSettings
    settings.setValue(
      scope,
      'excludeTools' as keyof Settings,
      newExcludeTools as Settings['excludeTools'],
    );
  } catch (error) {
    console.error('Error updating tool exclusion:', error);
  }
}

export function SettingsDialog({
  settings,
  onSelect,
  onRestartRequest,
  config,
}: SettingsDialogProps): React.JSX.Element {
  // Get vim mode context to sync vim mode changes
  const { vimEnabled, toggleVimEnabled } = useVimMode();

  // Focus state: 'settings' or 'scope'
  const [focusSection, setFocusSection] = useState<'settings' | 'scope'>(
    'settings',
  );
  // Scope selector state (User by default)
  const [selectedScope, setSelectedScope] = useState<SettingScope>(
    SettingScope.User,
  );
  // Active indices
  const [activeSettingIndex, setActiveSettingIndex] = useState(0);
  // Scroll offset for settings
  const [scrollOffset, setScrollOffset] = useState(0);
  const [showRestartPrompt, setShowRestartPrompt] = useState(false);

  // Local pending settings state for the selected scope
  const [pendingSettings, setPendingSettings] = useState<Settings>(() =>
    // Deep clone to avoid mutation
    structuredClone(settings.forScope(selectedScope).settings),
  );

  // Track which settings have been modified by the user
  const [modifiedSettings, setModifiedSettings] = useState<Set<string>>(
    new Set(),
  );

  // Preserve pending changes across scope switches
  const [globalPendingChanges, setGlobalPendingChanges] = useState<
    Map<string, PendingValue>
  >(new Map());

  // Sub-settings mode state
  const [subSettingsMode, setSubSettingsMode] = useState<{
    isActive: boolean;
    parentKey: string;
    parentLabel: string;
  }>({
    isActive: false,
    parentKey: '',
    parentLabel: '',
  });

  // Save parent settings state for navigation back
  const [parentState, setParentState] = useState<{
    activeIndex: number;
    scrollOffset: number;
  }>({
    activeIndex: 0,
    scrollOffset: 0,
  });

  // Track restart-required settings across scope changes
  const [_restartRequiredSettings, setRestartRequiredSettings] = useState<
    Set<string>
  >(new Set());

  useEffect(() => {
    // Simplified logic: start with scope settings, overlay pending changes, ensure enum settings are loaded
    const scopeSettings = settings.forScope(selectedScope).settings;
    let updated = structuredClone(scopeSettings);

    // Ensure enum settings are always loaded from merged settings (handles loading issues)
    for (const [key, value] of Object.entries(settings.merged)) {
      const def = getSettingDefinition(key);
      if (def?.type === 'enum') {
        (updated as Record<string, unknown>)[key] = value;
      }
    }

    // Overlay globally pending (unsaved) changes
    const newModified = new Set(modifiedSettings);
    const newRestartRequired = new Set(_restartRequiredSettings);

    for (const [key, value] of globalPendingChanges.entries()) {
      const def = getSettingDefinition(key);
      if (def?.type === 'boolean' && typeof value === 'boolean') {
        updated = setPendingSettingValue(key, value, updated);
      } else if (
        (def?.type === 'number' && typeof value === 'number') ||
        (def?.type === 'string' && typeof value === 'string') ||
        (def?.type === 'enum' && typeof value === 'string')
      ) {
        updated = setPendingSettingValueAny(key, value, updated);
      } else if (def?.type === 'array' && Array.isArray(value)) {
        // Handle array type pending change (e.g. excludeTools)
        updated = setPendingSettingValueAny(key, value, updated);
      }
      newModified.add(key);
      if (requiresRestart(key)) newRestartRequired.add(key);
    }

    setPendingSettings(updated);
    setModifiedSettings(newModified);
    setRestartRequiredSettings(newRestartRequired);
    setShowRestartPrompt(newRestartRequired.size > 0);
    // Note: _restartRequiredSettings and modifiedSettings are intentionally excluded
    // from dependencies because they are outputs of this effect, not inputs.
    // Including them would create an infinite loop (issue #607).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedScope, settings, globalPendingChanges]);

  const dynamicToolSettings = useMemo(() => {
    if (
      subSettingsMode.isActive &&
      subSettingsMode.parentKey === 'coreToolSettings' &&
      config
    ) {
      return generateDynamicToolSettings(config);
    }
    return {};
  }, [subSettingsMode.isActive, subSettingsMode.parentKey, config]);

  const generateSettingsItems = () => {
    if (subSettingsMode.isActive) {
      return generateSubSettingsItems(subSettingsMode.parentKey);
    } else {
      return generateNormalSettingsItems();
    }
  };

  const generateSubSettingsItems = (parentKey: string) => {
    const parentDefinition = getSettingDefinition(parentKey);
    let subSettings = parentDefinition?.subSettings || {};

    // If this is the coreToolSettings, use the memoized dynamic settings
    if (parentKey === 'coreToolSettings') {
      subSettings = { ...subSettings, ...dynamicToolSettings };
    }

    return Object.entries(subSettings).map(([key, def]) => {
      const fullKey = `${parentKey}.${key}`;
      const typedDef = def as SettingDefinition;

      return {
        label: typedDef.label || key,
        value: fullKey,
        type: typedDef.type,
        toggle: () => {
          // For core tools, use excludeTools logic
          if (parentKey === 'coreToolSettings') {
            // Calculate new excludeTools list for pending state
            const currentExcludeTools =
              (settings.merged.excludeTools as string[]) || [];
            // We need to check if there's already a pending change for excludeTools
            let pendingExcludeTools = currentExcludeTools;
            if (globalPendingChanges.has('excludeTools')) {
              pendingExcludeTools = globalPendingChanges.get(
                'excludeTools',
              ) as string[];
            }

            const currentState = getToolCurrentState(
              key,
              settings,
              pendingExcludeTools,
            );
            // Toggle state: if enabled (not in exclude), disable it (add to exclude)
            // if disabled (in exclude), enable it (remove from exclude)
            const newState =
              currentState === 'enabled' ? 'disabled' : 'enabled';

            // Check if this tool setting requires restart
            if (requiresRestart(fullKey)) {
              // Mark as restart-required setting
              setModifiedSettings((prev) => {
                const updated = new Set(prev).add(fullKey);
                updated.add('excludeTools');
                return updated;
              });

              // Add to restart-required settings and show prompt
              setRestartRequiredSettings((prev) => {
                const updated = new Set(prev).add(fullKey);
                updated.add('excludeTools');
                return updated;
              });
              setShowRestartPrompt(true);

              // Calculate new excludeTools list for pending state
              const currentExcludeTools =
                (settings.merged.excludeTools as string[]) || [];
              // We need to check if there's already a pending change for excludeTools
              let pendingExcludeTools = currentExcludeTools;
              if (globalPendingChanges.has('excludeTools')) {
                pendingExcludeTools = globalPendingChanges.get(
                  'excludeTools',
                ) as string[];
              }

              let newExcludeTools = [...pendingExcludeTools];
              if (newState === 'enabled') {
                // Enable tool: remove from excludeTools
                newExcludeTools = newExcludeTools.filter(
                  (name) => name !== key,
                );
              } else {
                // Disable tool: add to excludeTools
                if (!newExcludeTools.includes(key)) {
                  newExcludeTools.push(key);
                }
              }

              // Update global pending changes for excludeTools
              setGlobalPendingChanges((prev) => {
                const next = new Map(prev);
                next.set('excludeTools', newExcludeTools);
                return next;
              });
            } else {
              // No restart required - save immediately
              updateToolExclusion(key, newState, settings, selectedScope);

              // Remove from modified sets since it's saved immediately
              setModifiedSettings((prev) => {
                const updated = new Set(prev);
                updated.delete(fullKey);
                return updated;
              });

              setRestartRequiredSettings((prev) => {
                const updated = new Set(prev);
                updated.delete(fullKey);
                return updated;
              });
            }
            return;
          }

          // Regular boolean setting logic
          const currentValue = getSettingValue(
            fullKey,
            pendingSettings,
            settings.merged,
          );
          const newValue = !currentValue;

          setPendingSettings((prev) =>
            setPendingSettingValue(fullKey, newValue, prev),
          );

          if (!requiresRestart(fullKey)) {
            saveSingleSetting(fullKey, newValue, settings, selectedScope);
          } else {
            setModifiedSettings((prev) => {
              const updated = new Set(prev).add(fullKey);
              return updated;
            });
          }
        },
      };
    });
  };

  const generateNormalSettingsItems = () => {
    const settingKeys = getDialogSettingKeys();

    return settingKeys.map((key: string) => {
      const definition = getSettingDefinition(key);

      return {
        label: definition?.label || key,
        value: key,
        type: definition?.type,
        toggle: () => {
          if (definition?.type !== 'boolean') {
            // For non-boolean items, toggle will be handled via edit mode.
            return;
          }
          const currentValue = getSettingValue(key, pendingSettings, {});
          const newValue = !currentValue;

          setPendingSettings((prev) =>
            setPendingSettingValue(key, newValue, prev),
          );

          if (!requiresRestart(key)) {
            console.log(
              `[DEBUG SettingsDialog] Saving ${key} immediately with value:`,
              newValue,
            );
            saveSingleSetting(key, newValue, settings, selectedScope);

            // Special handling for vim mode to sync with VimModeContext
            if (key === 'vimMode' && newValue !== vimEnabled) {
              // Call toggleVimEnabled to sync the VimModeContext local state
              toggleVimEnabled().catch((error) => {
                console.error('Failed to toggle vim mode:', error);
              });
            }

            // Remove from modifiedSettings since it's now saved
            setModifiedSettings((prev) => {
              const updated = new Set(prev);
              updated.delete(key);
              return updated;
            });

            // Also remove from restart-required settings if it was there
            setRestartRequiredSettings((prev) => {
              const updated = new Set(prev);
              updated.delete(key);
              return updated;
            });

            // Remove from global pending changes if present
            setGlobalPendingChanges((prev) => {
              if (!prev.has(key)) return prev;
              const next = new Map(prev);
              next.delete(key);
              return next;
            });

            // Refresh pending settings from the saved state
            setPendingSettings(
              structuredClone(settings.forScope(selectedScope).settings),
            );
          } else {
            // For restart-required settings, track as modified
            setModifiedSettings((prev) => {
              const updated = new Set(prev).add(key);
              const needsRestart = hasRestartRequiredSettings(updated);
              console.log(
                `[DEBUG SettingsDialog] Modified settings:`,
                Array.from(updated),
                'Needs restart:',
                needsRestart,
              );
              if (needsRestart) {
                setShowRestartPrompt(true);
                setRestartRequiredSettings((prevRestart) =>
                  new Set(prevRestart).add(key),
                );
              }
              return updated;
            });

            // Add/update pending change globally so it persists across scopes
            setGlobalPendingChanges((prev) => {
              const next = new Map(prev);
              next.set(key, newValue as PendingValue);
              return next;
            });
          }
        },
      };
    });
  };

  const items = generateSettingsItems();

  // Generic edit state
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editBuffer, setEditBuffer] = useState<string>('');
  const [editCursorPos, setEditCursorPos] = useState<number>(0); // Cursor position within edit buffer
  const [cursorVisible, setCursorVisible] = useState<boolean>(true);

  useEffect(() => {
    if (!editingKey) {
      setCursorVisible(true);
      return;
    }
    const id = setInterval(() => setCursorVisible((v) => !v), 500);
    return () => clearInterval(id);
  }, [editingKey]);

  const startEditing = (key: string, initial?: string) => {
    setEditingKey(key);
    const initialValue = initial ?? '';
    setEditBuffer(initialValue);
    setEditCursorPos(cpLen(initialValue)); // Position cursor at end of initial value
  };

  const commitEdit = (key: string) => {
    const definition = getSettingDefinition(key);
    const type = definition?.type;

    if (editBuffer.trim() === '' && type === 'number') {
      // Nothing entered for a number; cancel edit
      setEditingKey(null);
      setEditBuffer('');
      setEditCursorPos(0);
      return;
    }

    let parsed: string | number;
    if (type === 'number') {
      const numParsed = Number(editBuffer.trim());
      if (Number.isNaN(numParsed)) {
        // Invalid number; cancel edit
        setEditingKey(null);
        setEditBuffer('');
        setEditCursorPos(0);
        return;
      }
      parsed = numParsed;
    } else {
      // For strings, use the buffer as is.
      parsed = editBuffer;
    }

    // Update pending
    setPendingSettings((prev) => setPendingSettingValueAny(key, parsed, prev));

    if (!requiresRestart(key)) {
      console.log(
        `[DEBUG SettingsDialog] Saving ${key} immediately with value:`,
        parsed,
      );
      saveSingleSetting(key, parsed, settings, selectedScope);

      // Remove from modified sets if present
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

      // Remove from global pending since it's immediately saved
      setGlobalPendingChanges((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
    } else {
      // Mark as modified and needing restart
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

      // Record pending change globally for persistence across scopes
      setGlobalPendingChanges((prev) => {
        const next = new Map(prev);
        next.set(key, parsed as PendingValue);
        return next;
      });
    }

    setEditingKey(null);
    setEditBuffer('');
    setEditCursorPos(0);
  };

  // Scope selector items
  const scopeItems = getScopeItems().map((item) => ({
    ...item,
    key: item.value,
  }));

  const handleScopeHighlight = useCallback((scope: SettingScope) => {
    setSelectedScope(scope);
  }, []);

  const handleScopeSelect = useCallback((scope: SettingScope) => {
    setSelectedScope(scope);
    setFocusSection('settings');
  }, []);

  // Scroll logic for settings
  const visibleItems = items.slice(scrollOffset, scrollOffset + maxItemsToShow);
  // Always show arrows for consistent UI and to indicate circular navigation
  const showScrollUp = true;
  const showScrollDown = true;

  const saveRestartRequiredSettings = () => {
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

      // Remove saved keys from global pending changes
      setGlobalPendingChanges((prev) => {
        if (prev.size === 0) return prev;
        const next = new Map(prev);
        for (const key of restartRequiredSet) {
          next.delete(key);
        }
        return next;
      });
    }
  };

  useKeypress(
    (key) => {
      const { name } = key;
      if (name === 'tab') {
        setFocusSection((prev) => (prev === 'settings' ? 'scope' : 'settings'));
      }
      if (focusSection === 'settings') {
        // If editing, capture input and control keys
        if (editingKey) {
          const definition = getSettingDefinition(editingKey);
          const type = definition?.type;

          if (key.paste && key.sequence) {
            let pasted = key.sequence;
            if (type === 'number') {
              pasted = key.sequence.replace(/[^0-9\-+.]/g, '');
            }
            if (pasted) {
              setEditBuffer((b) => {
                const before = cpSlice(b, 0, editCursorPos);
                const after = cpSlice(b, editCursorPos);
                return before + pasted + after;
              });
              setEditCursorPos((pos) => pos + cpLen(pasted));
            }
            return;
          }
          if (name === 'backspace' || name === 'delete') {
            if (name === 'backspace' && editCursorPos > 0) {
              setEditBuffer((b) => {
                const before = cpSlice(b, 0, editCursorPos - 1);
                const after = cpSlice(b, editCursorPos);
                return before + after;
              });
              setEditCursorPos((pos) => pos - 1);
            } else if (name === 'delete' && editCursorPos < cpLen(editBuffer)) {
              setEditBuffer((b) => {
                const before = cpSlice(b, 0, editCursorPos);
                const after = cpSlice(b, editCursorPos + 1);
                return before + after;
              });
              // Cursor position stays the same for delete
            }
            return;
          }
          if (keyMatchers[Command.ESCAPE](key)) {
            commitEdit(editingKey);
            return;
          }
          if (keyMatchers[Command.RETURN](key)) {
            commitEdit(editingKey);
            return;
          }

          let ch = key.sequence;
          let isValidChar = false;
          if (type === 'number') {
            // Allow digits, minus, plus, and dot.
            isValidChar = /[0-9\-+.]/.test(ch);
          } else {
            ch = stripUnsafeCharacters(ch);
            // For strings, allow any single character that isn't a control
            // sequence.
            isValidChar = ch.length === 1;
          }

          if (isValidChar) {
            setEditBuffer((currentBuffer) => {
              const beforeCursor = cpSlice(currentBuffer, 0, editCursorPos);
              const afterCursor = cpSlice(currentBuffer, editCursorPos);
              return beforeCursor + ch + afterCursor;
            });
            setEditCursorPos((pos) => pos + 1);
            return;
          }

          // Arrow key navigation
          if (name === 'left') {
            setEditCursorPos((pos) => Math.max(0, pos - 1));
            return;
          }
          if (name === 'right') {
            setEditCursorPos((pos) => Math.min(cpLen(editBuffer), pos + 1));
            return;
          }
          // Home and End keys
          if (keyMatchers[Command.HOME](key)) {
            setEditCursorPos(0);
            return;
          }
          if (keyMatchers[Command.END](key)) {
            setEditCursorPos(cpLen(editBuffer));
            return;
          }
          // Block other keys while editing
          return;
        }
        if (keyMatchers[Command.DIALOG_NAVIGATION_UP](key)) {
          // If editing, commit first
          if (editingKey) {
            commitEdit(editingKey);
          }
          const newIndex =
            activeSettingIndex > 0 ? activeSettingIndex - 1 : items.length - 1;
          setActiveSettingIndex(newIndex);
          // Adjust scroll offset for wrap-around
          if (newIndex === items.length - 1) {
            setScrollOffset(Math.max(0, items.length - maxItemsToShow));
          } else if (newIndex < scrollOffset) {
            setScrollOffset(newIndex);
          }
        } else if (keyMatchers[Command.DIALOG_NAVIGATION_DOWN](key)) {
          // If editing, commit first
          if (editingKey) {
            commitEdit(editingKey);
          }
          const newIndex =
            activeSettingIndex < items.length - 1 ? activeSettingIndex + 1 : 0;
          setActiveSettingIndex(newIndex);
          // Adjust scroll offset for wrap-around
          if (newIndex === 0) {
            setScrollOffset(0);
          } else if (newIndex >= scrollOffset + maxItemsToShow) {
            setScrollOffset(newIndex - maxItemsToShow + 1);
          }
        } else if (keyMatchers[Command.RETURN](key) || name === 'space') {
          const currentItem = items[activeSettingIndex];
          const currentDefinition = getSettingDefinition(
            currentItem?.value || '',
          );

          // Check if this item has sub-settings (special case for coreToolSettings)
          let hasSubSettings = false;
          if (
            currentDefinition?.subSettings &&
            Object.keys(currentDefinition.subSettings).length > 0
          ) {
            hasSubSettings = true;
          } else if (currentItem?.value === 'coreToolSettings' && config) {
            // Special case: coreToolSettings always has sub-settings
            // Avoid unnecessary computation by directly setting to true
            hasSubSettings = true;
          }

          if (hasSubSettings) {
            // Save current state for navigation back
            setParentState({
              activeIndex: activeSettingIndex,
              scrollOffset,
            });

            // Switch to sub-settings mode
            setSubSettingsMode({
              isActive: true,
              parentKey: currentItem?.value || '',
              parentLabel: currentDefinition?.label || currentItem?.value || '',
            });

            // Reset sub-settings page state
            setActiveSettingIndex(0);
            setScrollOffset(0);
            return;
          }

          // For boolean type, use toggle() function (simple on/off)
          if (currentItem?.type === 'boolean') {
            currentItem?.toggle();
          }
          // For enum types, handle cycle through options
          else if (
            currentDefinition?.type === 'enum' &&
            currentDefinition.options
          ) {
            const options = currentDefinition.options;
            const path = (currentItem?.value || '').split('.');

            // Get current value from multiple places in order
            let currentValue = getNestedValue(pendingSettings, path);

            // If there's a global pending change for this key, use that first
            if (
              currentValue === undefined &&
              globalPendingChanges.has(currentItem?.value || '')
            ) {
              currentValue = globalPendingChanges.get(currentItem?.value || '');
            }

            // If still undefined, try to get from merged settings
            if (currentValue === undefined) {
              currentValue = getNestedValue(settings.merged, path);
            }

            // If still undefined, use the default value
            if (currentValue === undefined) {
              currentValue = getDefaultValue(currentItem?.value || '');
            }

            const currentIndex = options.findIndex(
              (opt) => opt.value === currentValue,
            );
            const nextIndex =
              currentIndex === -1 ? 0 : (currentIndex + 1) % options.length;
            const newValue = options[nextIndex].value;

            // Update pending settings
            setPendingSettings((prev) =>
              setPendingSettingValueAny(
                currentItem?.value || '',
                newValue,
                prev,
              ),
            );

            // Handle the setting change based on whether it requires restart
            if (!requiresRestart(currentItem?.value || '')) {
              // Save immediately for settings that don't require restart
              saveSingleSetting(
                currentItem?.value || '',
                newValue,
                settings,
                selectedScope,
              );

              // Remove from modifiedSets since it's now saved
              setModifiedSettings((prev) => {
                const updated = new Set(prev);
                updated.delete(currentItem?.value || '');
                return updated;
              });

              setRestartRequiredSettings((prev) => {
                const updated = new Set(prev);
                updated.delete(currentItem?.value || '');
                return updated;
              });

              // Remove from global pending changes if present
              setGlobalPendingChanges((prev) => {
                if (!prev.has(currentItem?.value || '')) return prev;
                const next = new Map(prev);
                next.delete(currentItem?.value || '');
                return next;
              });
            } else {
              // Mark as modified and needing restart
              setModifiedSettings((prev) => {
                const updated = new Set(prev).add(currentItem?.value || '');
                const needsRestart = hasRestartRequiredSettings(updated);
                if (needsRestart) {
                  setShowRestartPrompt(true);
                  setRestartRequiredSettings((prevRestart) =>
                    new Set(prevRestart).add(currentItem?.value || ''),
                  );
                }
                return updated;
              });

              // Store in globalPendingChanges
              setGlobalPendingChanges((prev) => {
                const next = new Map(prev);
                next.set(currentItem?.value || '', newValue as PendingValue);
                return next;
              });
            }
          }
          // For numbers and strings, use edit mode
          else if (
            currentItem?.type === 'number' ||
            currentItem?.type === 'string'
          ) {
            startEditing(currentItem.value);
          } else {
            currentItem?.toggle();
          }
        } else if (/^[0-9]$/.test(key.sequence || '') && !editingKey) {
          const currentItem = items[activeSettingIndex];
          if (currentItem?.type === 'number') {
            startEditing(currentItem.value, key.sequence);
          }
        } else if (
          keyMatchers[Command.CLEAR_INPUT](key) ||
          keyMatchers[Command.CLEAR_SCREEN](key)
        ) {
          // Ctrl+C or Ctrl+L: Clear current setting and reset to default
          const currentSetting = items[activeSettingIndex];
          if (currentSetting) {
            const defaultValue = getDefaultValue(currentSetting.value);
            const defType = currentSetting.type;
            if (defType === 'boolean') {
              const booleanDefaultValue =
                typeof defaultValue === 'boolean' ? defaultValue : false;
              setPendingSettings((prev) =>
                setPendingSettingValue(
                  currentSetting.value,
                  booleanDefaultValue,
                  prev,
                ),
              );
            } else if (defType === 'number' || defType === 'string') {
              if (
                typeof defaultValue === 'number' ||
                typeof defaultValue === 'string'
              ) {
                setPendingSettings((prev) =>
                  setPendingSettingValueAny(
                    currentSetting.value,
                    defaultValue,
                    prev,
                  ),
                );
              }
            } else if (defType === 'enum') {
              const enumDefaultValue = defaultValue;
              setPendingSettings((prev) =>
                setPendingSettingValueAny(
                  currentSetting.value,
                  enumDefaultValue,
                  prev,
                ),
              );
            }

            // Remove from modified settings since it's now at default
            setModifiedSettings((prev) => {
              const updated = new Set(prev);
              updated.delete(currentSetting.value);
              return updated;
            });

            // Remove from restart-required settings if it was there
            setRestartRequiredSettings((prev) => {
              const updated = new Set(prev);
              updated.delete(currentSetting.value);
              return updated;
            });

            // If this setting doesn't require restart, save it immediately
            if (!requiresRestart(currentSetting.value)) {
              const immediateSettings = new Set([currentSetting.value]);
              const toSaveValue =
                currentSetting.type === 'boolean'
                  ? typeof defaultValue === 'boolean'
                    ? defaultValue
                    : false
                  : typeof defaultValue === 'number' ||
                      typeof defaultValue === 'string'
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
                settings,
                selectedScope,
              );

              // Remove from global pending changes if present
              setGlobalPendingChanges((prev) => {
                if (!prev.has(currentSetting.value)) return prev;
                const next = new Map(prev);
                next.delete(currentSetting.value);
                return next;
              });
            } else {
              // Track default reset as a pending change if restart required
              if (
                (currentSetting.type === 'boolean' &&
                  typeof defaultValue === 'boolean') ||
                (currentSetting.type === 'number' &&
                  typeof defaultValue === 'number') ||
                (currentSetting.type === 'string' &&
                  typeof defaultValue === 'string')
              ) {
                setGlobalPendingChanges((prev) => {
                  const next = new Map(prev);
                  next.set(currentSetting.value, defaultValue as PendingValue);
                  return next;
                });
              }
            }
          }
        }
      }
      if (showRestartPrompt && name === 'r') {
        // Only save settings that require restart (non-restart settings were already saved immediately)
        saveRestartRequiredSettings();

        setShowRestartPrompt(false);
        setRestartRequiredSettings(new Set()); // Clear restart-required settings
        if (onRestartRequest) onRestartRequest();
      }
      if (keyMatchers[Command.ESCAPE](key)) {
        if (editingKey) {
          commitEdit(editingKey);
        } else if (subSettingsMode.isActive) {
          // Return to parent settings page
          setSubSettingsMode({
            isActive: false,
            parentKey: '',
            parentLabel: '',
          });

          // Restore parent settings page state
          setActiveSettingIndex(parentState.activeIndex);
          setScrollOffset(parentState.scrollOffset);
        } else {
          // Save any restart-required settings before closing
          saveRestartRequiredSettings();
          onSelect(undefined, selectedScope);
        }
      }
    },
    { isActive: true },
  );

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
        <Text bold color={Colors.AccentBlue}>
          {subSettingsMode.isActive
            ? `${subSettingsMode.parentLabel} > Settings`
            : 'Settings'}
        </Text>
        <Box height={1} />
        {showScrollUp && <Text color={Colors.Gray}>▲</Text>}
        {visibleItems.map((item, idx) => {
          const isActive =
            focusSection === 'settings' &&
            activeSettingIndex === idx + scrollOffset;

          const scopeSettings = settings.forScope(selectedScope).settings;
          const mergedSettings = settings.merged;

          let displayValue: string;
          if (editingKey === item.value) {
            // Show edit buffer with advanced cursor highlighting
            if (cursorVisible && editCursorPos < cpLen(editBuffer)) {
              // Cursor is in the middle or at start of text
              const beforeCursor = cpSlice(editBuffer, 0, editCursorPos);
              const atCursor = cpSlice(
                editBuffer,
                editCursorPos,
                editCursorPos + 1,
              );
              const afterCursor = cpSlice(editBuffer, editCursorPos + 1);
              displayValue =
                beforeCursor + chalk.inverse(atCursor) + afterCursor;
            } else if (cursorVisible && editCursorPos >= cpLen(editBuffer)) {
              // Cursor is at the end - show inverted space
              displayValue = editBuffer + chalk.inverse(' ');
            } else {
              // Cursor not visible
              displayValue = editBuffer;
            }
          } else if (item.type === 'number' || item.type === 'string') {
            // For numbers/strings, get the actual current value from pending settings
            const path = item.value.split('.');
            const currentValue = getNestedValue(pendingSettings, path);

            const defaultValue = getDefaultValue(item.value);

            if (currentValue !== undefined && currentValue !== null) {
              displayValue = String(currentValue);
            } else {
              displayValue =
                defaultValue !== undefined && defaultValue !== null
                  ? String(defaultValue)
                  : '';
            }

            // Add * if value differs from default OR if currently being modified
            const isModified = modifiedSettings.has(item.value);
            const effectiveCurrentValue =
              currentValue !== undefined && currentValue !== null
                ? currentValue
                : defaultValue;
            const isDifferentFromDefault =
              effectiveCurrentValue !== defaultValue;

            if (isDifferentFromDefault || isModified) {
              displayValue += '*';
            }
          } else if (getSettingDefinition(item.value)?.type === 'enum') {
            // Handle enum types - check multiple sources for the current value
            const path = item.value.split('.');
            let currentValue = getNestedValue(pendingSettings, path);

            // Check globalPendingChanges for the most recent value (priority #1)
            if (globalPendingChanges.has(item.value)) {
              currentValue = globalPendingChanges.get(item.value);
            }

            // Check combined value (use with || fallback to prioritize)
            const mergedValue = getNestedValue(settings.merged, path);
            if (currentValue === undefined) {
              currentValue = mergedValue;
            }

            // If still undefined, use the default value
            if (currentValue === undefined) {
              currentValue = getDefaultValue(item.value);
            }

            displayValue = String(currentValue);

            // Add * if value differs from default OR if it's been modified
            const isModified = modifiedSettings.has(item.value);
            const defaultValue = getDefaultValue(item.value);
            const isDifferentFromDefault = currentValue !== defaultValue;

            if (isDifferentFromDefault || isModified) {
              displayValue += '*';
            }
          } else if (
            subSettingsMode.isActive &&
            subSettingsMode.parentKey === 'coreToolSettings'
          ) {
            // For core tools, show actual enabled/disabled state based on excludeTools
            const toolName = item.value.replace('coreToolSettings.', '');

            // Check pending settings first for excludeTools
            let excludeTools = (pendingSettings.excludeTools as string[]) || [];
            // If not in pending, fall back to merged settings (handled by getToolCurrentState but we want pending awareness)
            if (!pendingSettings.excludeTools) {
              excludeTools = (settings.merged.excludeTools as string[]) || [];
            }

            const currentState = getToolCurrentState(
              toolName,
              settings,
              excludeTools,
            );
            const isEnabled = currentState === 'enabled';
            displayValue = isEnabled ? 'Enabled' : 'Disabled';

            // Check if this differs from default (default is enabled)
            const isModified = !isEnabled;
            if (isModified) {
              displayValue += '*';
            }
          } else if (
            !subSettingsMode.isActive &&
            item.value === 'coreToolSettings'
          ) {
            displayValue = 'Enter';
          } else {
            // For booleans and other types, use existing logic
            displayValue = getDisplayValue(
              item.value,
              scopeSettings,
              mergedSettings,
              modifiedSettings,
              pendingSettings,
            );
          }
          const shouldBeGreyedOut = isDefaultValue(item.value, scopeSettings);

          // Generate scope message for this setting
          const scopeMessage = getScopeMessageForSetting(
            item.value,
            selectedScope,
            settings,
          );

          return (
            <React.Fragment key={item.value}>
              <Box flexDirection="row" alignItems="center">
                <Box minWidth={2} flexShrink={0}>
                  <Text color={isActive ? Colors.AccentGreen : Colors.Gray}>
                    {isActive ? '●' : ''}
                  </Text>
                </Box>
                <Box minWidth={50}>
                  <Text
                    color={isActive ? Colors.AccentGreen : Colors.Foreground}
                  >
                    {item.label}
                    {scopeMessage && (
                      <Text color={Colors.Gray}> {scopeMessage}</Text>
                    )}
                  </Text>
                </Box>
                <Box minWidth={3} />
                <Text
                  color={
                    isActive
                      ? Colors.AccentGreen
                      : shouldBeGreyedOut
                        ? Colors.Gray
                        : Colors.Foreground
                  }
                >
                  {displayValue}
                </Text>
              </Box>
              <Box height={1} />
            </React.Fragment>
          );
        })}
        {showScrollDown && <Text color={Colors.Gray}>▼</Text>}

        <Box height={1} />

        <Box marginTop={1} flexDirection="column">
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

        <Box height={1} />
        <Text color={Colors.Gray}>
          (Use Enter to select, Tab to change focus, Esc to close)
        </Text>
        {showRestartPrompt && (
          <Text color={Colors.AccentYellow}>
            To see changes, LLxprt Code must be restarted. Press r to exit and
            apply changes now.
          </Text>
        )}
      </Box>
    </Box>
  );
}
