/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useCallback, useState, useMemo } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
import { themeManager, DEFAULT_THEME } from '../themes/theme-manager.js';
import { pickDefaultThemeName } from '../themes/theme.js';
import { getThemeTypeFromBackgroundColor } from '../themes/color-utils.js';
import { RadioButtonSelect } from './shared/RadioButtonSelect.js';
import type { RadioSelectItem } from './shared/RadioButtonSelect.js';
import type { RenderItemContext } from './shared/BaseSelectionList.js';
import { DiffRenderer } from './messages/DiffRenderer.js';
import { colorizeCode } from '../utils/CodeColorizer.js';
import type { LoadedSettings } from '../../config/settings.js';
import { SettingScope } from '../../config/settings.js';
import {
  getScopeItems,
  getScopeMessageForSetting,
} from '../../utils/dialogScopeUtils.js';
import { useKeypress } from '../hooks/useKeypress.js';
import { useUIState } from '../contexts/UIStateContext.js';
import { theme } from '../semantic-colors.js';

interface ThemeDialogProps {
  onSelect: (themeName: string | undefined, scope: SettingScope) => void;
  onHighlight: (themeName: string | undefined) => void;
  settings: LoadedSettings;
  availableTerminalHeight?: number;
  terminalWidth: number;
}

interface ThemeItem extends RadioSelectItem<string> {
  isCompatible: boolean;
  themeType: string;
}

interface ThemeLayoutValues {
  includePadding: boolean;
  showScopeSelection: boolean;
  currentFocusedSection: 'theme' | 'scope';
  colorizeCodeWidth: number;
  codeBlockHeight: number;
  diffHeight: number;
}

function computeThemeLayout(
  themeItemCount: number,
  availableTerminalHeight: number | undefined,
  terminalWidth: number,
  focusedSection: 'theme' | 'scope',
): ThemeLayoutValues {
  const PREVIEW_PANE_WIDTH_PCT = 0.55;
  const PREVIEW_PANE_WIDTH_MARGIN = 0.9;
  const TOTAL_H_PADDING = 4;
  const colorizeCodeWidth = Math.max(
    Math.floor(
      (terminalWidth - TOTAL_H_PADDING) *
        PREVIEW_PANE_WIDTH_PCT *
        PREVIEW_PANE_WIDTH_MARGIN,
    ),
    1,
  );
  const DIALOG_PADDING = 2;
  const selectThemeHeight = themeItemCount + 1;
  const SCOPE_HEIGHT = 4;
  const SPACE_BETWEEN = 1;
  const TAB_HEIGHT = 2;
  let availableHeight =
    (availableTerminalHeight ?? Number.MAX_SAFE_INTEGER) - 2 - TAB_HEIGHT;
  let lhsHeight =
    DIALOG_PADDING + selectThemeHeight + SCOPE_HEIGHT + SPACE_BETWEEN;
  let showScopeSelection = true;
  let includePadding = true;
  if (lhsHeight > availableHeight) {
    includePadding = false;
    lhsHeight -= DIALOG_PADDING;
  }
  if (lhsHeight > availableHeight) {
    lhsHeight -= SCOPE_HEIGHT;
    showScopeSelection = false;
  }
  const currentFocusedSection = !showScopeSelection
    ? ('theme' as const)
    : focusedSection;
  const FIXED_VERT = 8;
  availableHeight = Math.max(availableHeight, lhsHeight);
  const codeBlockAvail =
    availableHeight - FIXED_VERT - (includePadding ? 2 : 0) * 2;
  const paneHeight = Math.max(0, codeBlockAvail - 1);
  const codeBlockHeight = Math.ceil(paneHeight * 0.6);
  const diffHeight = Math.floor(paneHeight * 0.4);
  return {
    includePadding,
    showScopeSelection,
    currentFocusedSection,
    colorizeCodeWidth,
    codeBlockHeight,
    diffHeight,
  };
}

function ThemePreviewPane({
  includePadding,
  codeBlockHeight,
  colorizeCodeWidth,
  diffHeight,
  previewTheme,
}: {
  includePadding: boolean;
  codeBlockHeight: number;
  colorizeCodeWidth: number;
  diffHeight: number;
  previewTheme: ReturnType<typeof themeManager.getTheme>;
}): React.JSX.Element {
  return (
    <Box
      borderStyle="single"
      borderColor={Colors.Gray}
      paddingTop={includePadding ? 1 : 0}
      paddingBottom={includePadding ? 1 : 0}
      paddingLeft={1}
      paddingRight={1}
      flexDirection="column"
    >
      {colorizeCode(
        `# function
def fibonacci(n):
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a`,
        'python',
        codeBlockHeight,
        colorizeCodeWidth,
      )}
      <Box marginTop={1} />
      <DiffRenderer
        diffContent={`--- a/util.py
+++ b/util.py
@@ -1,2 +1,2 @@
- print("Hello, " + name)
+ print(f"Hello, {name}!")
`}
        availableTerminalHeight={diffHeight}
        terminalWidth={colorizeCodeWidth}
        theme={previewTheme}
      />
    </Box>
  );
}

function renderThemeItem(
  terminalThemeType: string | null,
  item: ThemeItem,
  { titleColor }: RenderItemContext,
): React.JSX.Element {
  if (terminalThemeType && item.themeType !== 'custom') {
    const compatLabel = item.isCompatible
      ? '(Matches terminal)'
      : '(Incompatible)';
    const compatColor = item.isCompatible
      ? theme.status.success
      : theme.status.warning;
    return (
      <Text color={titleColor} wrap="truncate">
        {item.themeNameDisplay}{' '}
        <Text color={theme.text.secondary}>{item.themeTypeDisplay}</Text>{' '}
        <Text color={compatColor}>{compatLabel}</Text>
      </Text>
    );
  }
  return (
    <Text color={titleColor} wrap="truncate">
      {item.themeNameDisplay}{' '}
      <Text color={theme.text.secondary}>{item.themeTypeDisplay}</Text>
    </Text>
  );
}

function useThemeItems(
  builtInThemes: ReturnType<typeof themeManager.getAvailableThemes>,
  customThemeNames: string[],
  terminalThemeType: string | null,
): ThemeItem[] {
  return useMemo(() => {
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    const items: ThemeItem[] = [
      ...builtInThemes.map((t) => ({
        label: t.name,
        value: t.name,
        themeNameDisplay: t.name,
        themeTypeDisplay: cap(t.type),
        key: t.name,
        isCompatible: !terminalThemeType || t.type === terminalThemeType,
        themeType: t.type,
      })),
      ...customThemeNames.map((name) => ({
        label: name,
        value: name,
        themeNameDisplay: name,
        themeTypeDisplay: 'Custom',
        key: name,
        isCompatible: true,
        themeType: 'custom',
      })),
    ];
    return items.sort((a, b) => {
      if (a.isCompatible !== b.isCompatible) return a.isCompatible ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
  }, [builtInThemes, customThemeNames, terminalThemeType]);
}

function ThemeSelectionColumn({
  themeItems,
  safeInitialThemeIndex,
  currentFocusedSection,
  otherScopeModifiedMessage,
  selectInputKey,
  handleThemeSelect,
  handleThemeHighlight,
  showScopeSelection,
  scopeItems,
  handleScopeSelect,
  handleScopeHighlight,
  renderItem,
}: {
  themeItems: ThemeItem[];
  safeInitialThemeIndex: number;
  currentFocusedSection: 'theme' | 'scope';
  otherScopeModifiedMessage: string;
  selectInputKey: number;
  handleThemeSelect: (name: string) => void;
  handleThemeHighlight: (name: string) => void;
  showScopeSelection: boolean;
  scopeItems: ReturnType<typeof getScopeItems>;
  handleScopeSelect: (scope: SettingScope) => void;
  handleScopeHighlight: (scope: SettingScope) => void;
  renderItem: (item: ThemeItem, ctx: RenderItemContext) => React.JSX.Element;
}): React.JSX.Element {
  return (
    <Box flexDirection="column" width="45%" paddingRight={2}>
      <Text
        bold={currentFocusedSection === 'theme'}
        wrap="truncate"
        color={Colors.Foreground}
      >
        {currentFocusedSection === 'theme' ? '> ' : '  '}Select Theme{' '}
        <Text color={Colors.Gray}>{otherScopeModifiedMessage}</Text>
      </Text>
      <RadioButtonSelect
        key={selectInputKey}
        items={themeItems}
        initialIndex={safeInitialThemeIndex}
        onSelect={handleThemeSelect}
        onHighlight={handleThemeHighlight}
        isFocused={currentFocusedSection === 'theme'}
        maxItemsToShow={8}
        showScrollArrows={true}
        showNumbers={currentFocusedSection === 'theme'}
        renderItem={renderItem}
      />
      {showScopeSelection && (
        <Box marginTop={1} flexDirection="column">
          <Text
            bold={currentFocusedSection === 'scope'}
            wrap="truncate"
            color={Colors.Foreground}
          >
            {currentFocusedSection === 'scope' ? '> ' : '  '}Apply To
          </Text>
          <RadioButtonSelect
            items={scopeItems}
            initialIndex={0}
            onSelect={handleScopeSelect}
            onHighlight={handleScopeHighlight}
            isFocused={currentFocusedSection === 'scope'}
            showNumbers={currentFocusedSection === 'scope'}
          />
        </Box>
      )}
    </Box>
  );
}

function useThemeDialogState(
  settings: LoadedSettings,
  onSelect: (themeName: string | undefined, scope: SettingScope) => void,
  onHighlight: (themeName: string | undefined) => void,
  terminalBackgroundColor: string | undefined,
) {
  const [selectedScope, setSelectedScope] = useState<SettingScope>(
    SettingScope.User,
  );
  const [highlightedThemeName, setHighlightedThemeName] = useState<string>(
    () => {
      if (settings.merged.ui.theme) return settings.merged.ui.theme;
      return pickDefaultThemeName(
        terminalBackgroundColor,
        themeManager.getAllThemes(),
        DEFAULT_THEME.name,
        'Default Light',
      );
    },
  );
  const [selectInputKey, setSelectInputKey] = useState(Date.now());
  const [focusedSection, setFocusedSection] = useState<'theme' | 'scope'>(
    'theme',
  );

  const customThemes =
    selectedScope === SettingScope.User
      ? (settings.user.settings.ui?.customThemes ?? {})
      : (settings.merged.ui.customThemes ?? {});
  const builtInThemes = themeManager
    .getAvailableThemes()
    .filter((t) => t.type !== 'custom');
  const customThemeNames = Object.keys(customThemes);
  const terminalThemeType: string | null =
    getThemeTypeFromBackgroundColor(terminalBackgroundColor) ?? null;

  const handleThemeSelect = useCallback(
    (name: string) => onSelect(name, selectedScope),
    [onSelect, selectedScope],
  );
  const handleThemeHighlight = useCallback(
    (name: string) => {
      setHighlightedThemeName(name);
      onHighlight(name);
    },
    [onHighlight],
  );
  const handleScopeHighlight = useCallback((scope: SettingScope) => {
    setSelectedScope(scope);
    setSelectInputKey(Date.now());
  }, []);
  const handleScopeSelect = useCallback(
    (scope: SettingScope) => {
      handleScopeHighlight(scope);
      setFocusedSection('theme');
    },
    [handleScopeHighlight],
  );

  useKeypress(
    (key) => {
      if (key.name === 'tab')
        setFocusedSection((p) => (p === 'theme' ? 'scope' : 'theme'));
      if (key.name === 'escape') onSelect(undefined, selectedScope);
    },
    { isActive: true },
  );

  return {
    selectedScope,
    highlightedThemeName,
    focusedSection,
    builtInThemes,
    customThemeNames,
    terminalThemeType,
    selectInputKey,
    handleThemeSelect,
    handleThemeHighlight,
    handleScopeHighlight,
    handleScopeSelect,
  };
}

function ThemeDialogContent({
  state,
  themeItems,
  safeInitialThemeIndex,
  scopeItems,
  otherScopeModifiedMessage,
  layout,
  previewTheme,
  renderItem,
}: {
  state: ReturnType<typeof useThemeDialogState>;
  themeItems: ThemeItem[];
  safeInitialThemeIndex: number;
  scopeItems: ReturnType<typeof getScopeItems>;
  otherScopeModifiedMessage: string;
  layout: ThemeLayoutValues;
  previewTheme: ReturnType<typeof themeManager.getTheme>;
  renderItem: (item: ThemeItem, ctx: RenderItemContext) => React.JSX.Element;
}): React.JSX.Element {
  return (
    <Box
      borderStyle="round"
      borderColor={Colors.Gray}
      flexDirection="column"
      paddingTop={layout.includePadding ? 1 : 0}
      paddingBottom={layout.includePadding ? 1 : 0}
      paddingLeft={1}
      paddingRight={1}
      width="100%"
    >
      <Box flexDirection="row">
        <ThemeSelectionColumn
          themeItems={themeItems}
          safeInitialThemeIndex={safeInitialThemeIndex}
          currentFocusedSection={layout.currentFocusedSection}
          otherScopeModifiedMessage={otherScopeModifiedMessage}
          selectInputKey={state.selectInputKey}
          handleThemeSelect={state.handleThemeSelect}
          handleThemeHighlight={state.handleThemeHighlight}
          showScopeSelection={layout.showScopeSelection}
          scopeItems={scopeItems}
          handleScopeSelect={state.handleScopeSelect}
          handleScopeHighlight={state.handleScopeHighlight}
          renderItem={renderItem}
        />
        <Box flexDirection="column" width="55%" paddingLeft={2}>
          <Text bold color={Colors.Foreground}>
            Preview
          </Text>
          <ThemePreviewPane
            includePadding={layout.includePadding}
            codeBlockHeight={layout.codeBlockHeight}
            colorizeCodeWidth={layout.colorizeCodeWidth}
            diffHeight={layout.diffHeight}
            previewTheme={previewTheme}
          />
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text color={Colors.Gray} wrap="truncate">
          (Use Enter to select
          {layout.showScopeSelection ? ', Tab to change focus' : ''}, Esc to
          close)
        </Text>
      </Box>
    </Box>
  );
}

export function ThemeDialog({
  onSelect,
  onHighlight,
  settings,
  availableTerminalHeight,
  terminalWidth,
}: ThemeDialogProps): React.JSX.Element {
  const { terminalBackgroundColor } = useUIState();
  const state = useThemeDialogState(
    settings,
    onSelect,
    onHighlight,
    terminalBackgroundColor,
  );
  const themeItems = useThemeItems(
    state.builtInThemes,
    state.customThemeNames,
    state.terminalThemeType,
  );
  const safeInitialThemeIndex = Math.max(
    0,
    themeItems.findIndex((i) => i.value === state.highlightedThemeName),
  );
  const scopeItems = getScopeItems();
  const otherScopeModifiedMessage = getScopeMessageForSetting(
    'theme',
    state.selectedScope,
    settings,
  );
  const layout = computeThemeLayout(
    themeItems.length,
    availableTerminalHeight,
    terminalWidth,
    state.focusedSection,
  );
  const previewTheme = useMemo(
    () => themeManager.getTheme(state.highlightedThemeName) ?? DEFAULT_THEME,
    [state.highlightedThemeName],
  );
  const renderItem = useCallback(
    (item: ThemeItem, ctx: RenderItemContext) =>
      renderThemeItem(state.terminalThemeType, item, ctx),
    [state.terminalThemeType],
  );

  return (
    <ThemeDialogContent
      state={state}
      themeItems={themeItems}
      safeInitialThemeIndex={safeInitialThemeIndex}
      scopeItems={scopeItems}
      otherScopeModifiedMessage={otherScopeModifiedMessage}
      layout={layout}
      previewTheme={previewTheme}
      renderItem={renderItem}
    />
  );
}
