/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SettingScope } from '../../config/settings.js';
import { useVimMode } from '../contexts/VimModeContext.js';
import {
  useEditState,
  useSearchState,
  useSettingsDialogRuntime,
  useSettingsItemsAndActions,
  useSettingsStateFull,
} from './settingsDialogHooks.js';
import type { SettingsDialogProps } from './settingsDialogTypes.js';
import { SettingsDialogLayout } from './settingsDialogViews.js';
import type React from 'react';
import { useState } from 'react';

export {
  getToolCurrentState,
  updateToolExclusion,
} from './settingsDialogHelpers.js';

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
