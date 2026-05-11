/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
import {
  EDITOR_DISPLAY_NAMES,
  editorSettingsManager,
  type EditorDisplay,
} from '../editors/editorSettingsManager.js';
import { RadioButtonSelect } from './shared/RadioButtonSelect.js';
import type { LoadedSettings } from '../../config/settings.js';
import { SettingScope } from '../../config/settings.js';
import type { EditorType } from '@vybestack/llxprt-code-core';
import { isEditorAvailable, debugLogger } from '@vybestack/llxprt-code-core';
import { useKeypress } from '../hooks/useKeypress.js';

interface EditorDialogProps {
  onSelect: (editorType: EditorType | undefined, scope: SettingScope) => void;
  settings: LoadedSettings;
  onExit: () => void;
}

const SCOPE_ITEMS = [
  {
    label: 'User Settings',
    value: SettingScope.User,
    key: SettingScope.User,
  },
  {
    label: 'Workspace Settings',
    value: SettingScope.Workspace,
    key: SettingScope.Workspace,
  },
];

function getEditorIndex(
  editorItems: EditorDisplay[],
  currentPreference: string | undefined,
): number {
  if (!currentPreference) return 0;
  const index = editorItems.findIndex(
    (item: EditorDisplay) => item.type === currentPreference,
  );
  if (index === -1) {
    debugLogger.error(`Editor is not supported: ${currentPreference}`);
    return 0;
  }
  return index;
}

function getOtherScopeMessage(
  settings: LoadedSettings,
  selectedScope: SettingScope,
): string {
  const otherScope =
    selectedScope === SettingScope.User
      ? SettingScope.Workspace
      : SettingScope.User;
  if (
    settings.forScope(otherScope).settings.ui?.preferredEditor !== undefined
  ) {
    return settings.forScope(selectedScope).settings.ui?.preferredEditor !==
      undefined
      ? `(Also modified in ${otherScope})`
      : `(Modified in ${otherScope})`;
  }
  return '';
}

function getMergedEditorName(settings: LoadedSettings): string {
  if (
    settings.merged.ui.preferredEditor &&
    isEditorAvailable(settings.merged.ui.preferredEditor)
  ) {
    return EDITOR_DISPLAY_NAMES[
      settings.merged.ui.preferredEditor as EditorType
    ];
  }
  return 'None';
}

interface EditorLeftPanelProps {
  focusedSection: 'editor' | 'scope';
  selectedScope: SettingScope;
  otherScopeModifiedMessage: string;
  editorItems: EditorDisplay[];
  editorIndex: number;
  onEditorSelect: (editorType: EditorType | 'not_set') => void;
  onScopeSelect: (scope: SettingScope) => void;
}

const EditorLeftPanel: React.FC<EditorLeftPanelProps> = ({
  focusedSection,
  selectedScope,
  otherScopeModifiedMessage,
  editorItems,
  editorIndex,
  onEditorSelect,
  onScopeSelect,
}) => (
  <Box flexDirection="column" width="45%" paddingRight={2}>
    <Text bold={focusedSection === 'editor'} color={Colors.Foreground}>
      {focusedSection === 'editor' ? '> ' : '  '}Select Editor{' '}
      <Text color={Colors.Gray}>{otherScopeModifiedMessage}</Text>
    </Text>
    <RadioButtonSelect
      items={editorItems.map((item) => ({
        label: item.name,
        value: item.type,
        disabled: item.disabled,
        key: item.type,
      }))}
      initialIndex={editorIndex}
      onSelect={onEditorSelect}
      isFocused={focusedSection === 'editor'}
      key={selectedScope}
    />
    <Box marginTop={1} flexDirection="column">
      <Text bold={focusedSection === 'scope'} color={Colors.Foreground}>
        {focusedSection === 'scope' ? '> ' : '  '}Apply To
      </Text>
      <RadioButtonSelect
        items={SCOPE_ITEMS}
        initialIndex={0}
        onSelect={onScopeSelect}
        isFocused={focusedSection === 'scope'}
      />
    </Box>
    <Box marginTop={1}>
      <Text color={Colors.Gray}>
        (Use Enter to select, Tab to change focus, Esc to close)
      </Text>
    </Box>
  </Box>
);

interface EditorRightPanelProps {
  mergedEditorName: string;
}

const EditorRightPanel: React.FC<EditorRightPanelProps> = ({
  mergedEditorName,
}) => (
  <Box flexDirection="column" width="55%" paddingLeft={2}>
    <Text bold color={Colors.Foreground}>
      Editor Preference
    </Text>
    <Box flexDirection="column" gap={1} marginTop={1}>
      <Text color={Colors.Gray}>
        These editors are currently supported. Please note that some editors
        cannot be used in sandbox mode.
      </Text>
      <Text color={Colors.Gray}>
        Your preferred editor is:{' '}
        <Text
          color={
            mergedEditorName === 'None' ? Colors.AccentRed : Colors.AccentCyan
          }
          bold
        >
          {mergedEditorName}
        </Text>
        .
      </Text>
    </Box>
  </Box>
);

export function EditorSettingsDialog({
  onSelect,
  settings,
  onExit,
}: EditorDialogProps): React.JSX.Element {
  const [selectedScope, setSelectedScope] = useState<SettingScope>(
    SettingScope.User,
  );
  const [focusedSection, setFocusedSection] = useState<'editor' | 'scope'>(
    'editor',
  );
  useKeypress(
    (key) => {
      if (key.name === 'tab') {
        setFocusedSection((prev) => (prev === 'editor' ? 'scope' : 'editor'));
      }
      if (key.name === 'escape') {
        onExit();
      }
    },
    { isActive: true },
  );

  const editorItems: EditorDisplay[] =
    editorSettingsManager.getAvailableEditorDisplays();

  const currentPreference =
    settings.forScope(selectedScope).settings.ui?.preferredEditor;
  const editorIndex = getEditorIndex(editorItems, currentPreference);

  const handleEditorSelect = useCallback(
    (editorType: EditorType | 'not_set') => {
      if (editorType === 'not_set') {
        onSelect(undefined, selectedScope);
        return;
      }
      onSelect(editorType, selectedScope);
    },
    [onSelect, selectedScope],
  );

  const handleScopeSelect = useCallback((scope: SettingScope) => {
    setSelectedScope(scope);
    setFocusedSection('editor');
  }, []);

  const otherScopeModifiedMessage = getOtherScopeMessage(
    settings,
    selectedScope,
  );
  const mergedEditorName = getMergedEditorName(settings);

  return (
    <Box
      borderStyle="round"
      borderColor={Colors.Gray}
      flexDirection="row"
      padding={1}
      width="100%"
    >
      <EditorLeftPanel
        focusedSection={focusedSection}
        selectedScope={selectedScope}
        otherScopeModifiedMessage={otherScopeModifiedMessage}
        editorItems={editorItems}
        editorIndex={editorIndex}
        onEditorSelect={handleEditorSelect}
        onScopeSelect={handleScopeSelect}
      />
      <EditorRightPanel mergedEditorName={mergedEditorName} />
    </Box>
  );
}
