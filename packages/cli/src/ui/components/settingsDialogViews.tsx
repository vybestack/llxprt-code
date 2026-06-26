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
import { getScopeMessageForSetting } from '../../utils/dialogScopeUtils.js';
import { isDefaultValue } from '../../utils/settingsUtils.js';
import { Colors } from '../colors.js';
import { computeDisplayValueForItem } from './settingsDialogDisplay.js';
import { settingValueColor } from './settingsDialogHelpers.js';
import type { PendingValue, SettingItem } from './settingsDialogTypes.js';
import { RadioButtonSelect } from './shared/RadioButtonSelect.js';
import { Box, Text } from 'ink';
import React from 'react';

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
            <Text color={settingValueColor(isActive, shouldBeGreyedOut)}>
              {displayValue}
            </Text>
          </Box>
        </Box>
      </Box>
      <Box height={1} />
    </React.Fragment>
  );
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

export function SettingsDialogLayout(
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
