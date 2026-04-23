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
  /** Callback function when a theme is selected */
  onSelect: (themeName: string | undefined, scope: SettingScope) => void;

  /** Callback function when a theme is highlighted */
  onHighlight: (themeName: string | undefined) => void;
  /** The settings object */
  settings: LoadedSettings;
  availableTerminalHeight?: number;
  terminalWidth: number;
}

interface ThemeItem extends RadioSelectItem<string> {
  isCompatible: boolean;
  themeType: string;
}

export function ThemeDialog({
  onSelect,
  onHighlight,
  settings,
  availableTerminalHeight,
  terminalWidth,
}: ThemeDialogProps): React.JSX.Element {
  const { terminalBackgroundColor } = useUIState();
  const [selectedScope, setSelectedScope] = useState<SettingScope>(
    SettingScope.User,
  );

  // Track the currently highlighted theme name
  const [highlightedThemeName, setHighlightedThemeName] = useState<string>(
    () => {
      // If a theme is already set, use it.
      if (settings.merged.ui.theme) {
        return settings.merged.ui.theme;
      }

      // Otherwise, try to pick a theme that matches the terminal background.
      return pickDefaultThemeName(
        terminalBackgroundColor,
        themeManager.getAllThemes(),
        DEFAULT_THEME.name,
        'Default Light',
      );
    },
  );

  // Generate theme items filtered by selected scope
  const customThemes =
    selectedScope === SettingScope.User
      ? (settings.user.settings.ui?.customThemes ?? {})
      : (settings.merged.ui.customThemes ?? {});
  const builtInThemes = themeManager
    .getAvailableThemes()
    .filter((theme) => theme.type !== 'custom');
  const customThemeNames = Object.keys(customThemes);

  // Calculate terminal theme type for compatibility checking
  const terminalThemeType = getThemeTypeFromBackgroundColor(
    terminalBackgroundColor,
  );

  // Generate theme items with compatibility information
  const themeItems: ThemeItem[] = useMemo(() => {
    const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

    const items: ThemeItem[] = [
      ...builtInThemes.map((theme) => {
        const isCompatible =
          !terminalThemeType || theme.type === terminalThemeType;
        return {
          label: theme.name,
          value: theme.name,
          themeNameDisplay: theme.name,
          themeTypeDisplay: capitalize(theme.type),
          key: theme.name,
          isCompatible,
          themeType: theme.type,
        };
      }),
      ...customThemeNames.map((name) => ({
        label: name,
        value: name,
        themeNameDisplay: name,
        themeTypeDisplay: 'Custom',
        key: name,
        isCompatible: true, // Custom themes are always considered compatible
        themeType: 'custom',
      })),
    ];

    // Sort: compatible themes first, then by name
    return items.sort((a, b) => {
      if (a.isCompatible !== b.isCompatible) {
        return a.isCompatible ? -1 : 1;
      }
      return a.label.localeCompare(b.label);
    });
  }, [builtInThemes, customThemeNames, terminalThemeType]);
  const [selectInputKey, setSelectInputKey] = useState(Date.now());

  // Find the index of the selected theme, using the bg-aware default
  const initialThemeIndex = themeItems.findIndex(
    (item) => item.value === highlightedThemeName,
  );
  // If not found, fall back to the first theme
  const safeInitialThemeIndex = initialThemeIndex >= 0 ? initialThemeIndex : 0;

  const scopeItems = getScopeItems();

  const handleThemeSelect = useCallback(
    (themeName: string) => {
      onSelect(themeName, selectedScope);
    },
    [onSelect, selectedScope],
  );

  const handleThemeHighlight = useCallback(
    (themeName: string) => {
      setHighlightedThemeName(themeName);
      onHighlight(themeName);
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
      setFocusedSection('theme'); // Reset focus to theme section
    },
    [handleScopeHighlight],
  );

  const [focusedSection, setFocusedSection] = useState<'theme' | 'scope'>(
    'theme',
  );

  useKeypress(
    (key) => {
      if (key.name === 'tab') {
        setFocusedSection((prev) => (prev === 'theme' ? 'scope' : 'theme'));
      }
      if (key.name === 'escape') {
        onSelect(undefined, selectedScope);
      }
    },
    { isActive: true },
  );

  // Generate scope message for theme setting
  const otherScopeModifiedMessage = getScopeMessageForSetting(
    'theme',
    selectedScope,
    settings,
  );

  // Constants for calculating preview pane layout.
  // These values are based on the JSX structure below.
  const PREVIEW_PANE_WIDTH_PERCENTAGE = 0.55;
  // A safety margin to prevent text from touching the border.
  // This is a complete hack unrelated to the 0.9 used in App.tsx
  const PREVIEW_PANE_WIDTH_SAFETY_MARGIN = 0.9;
  // Combined horizontal padding from the dialog and preview pane.
  const TOTAL_HORIZONTAL_PADDING = 4;
  const colorizeCodeWidth = Math.max(
    Math.floor(
      (terminalWidth - TOTAL_HORIZONTAL_PADDING) *
        PREVIEW_PANE_WIDTH_PERCENTAGE *
        PREVIEW_PANE_WIDTH_SAFETY_MARGIN,
    ),
    1,
  );

  const DIALOG_PADDING = 2;
  const selectThemeHeight = themeItems.length + 1;
  const SCOPE_SELECTION_HEIGHT = 4; // Height for the scope selection section + margin.
  const SPACE_BETWEEN_THEME_SELECTION_AND_APPLY_TO = 1;
  const TAB_TO_SELECT_HEIGHT = 2;
  availableTerminalHeight = availableTerminalHeight ?? Number.MAX_SAFE_INTEGER;
  availableTerminalHeight -= 2; // Top and bottom borders.
  availableTerminalHeight -= TAB_TO_SELECT_HEIGHT;

  let totalLeftHandSideHeight =
    DIALOG_PADDING +
    selectThemeHeight +
    SCOPE_SELECTION_HEIGHT +
    SPACE_BETWEEN_THEME_SELECTION_AND_APPLY_TO;

  let showScopeSelection = true;
  let includePadding = true;

  // Remove content from the LHS that can be omitted if it exceeds the available height.
  if (totalLeftHandSideHeight > availableTerminalHeight) {
    includePadding = false;
    totalLeftHandSideHeight -= DIALOG_PADDING;
  }

  if (totalLeftHandSideHeight > availableTerminalHeight) {
    // First, try hiding the scope selection
    totalLeftHandSideHeight -= SCOPE_SELECTION_HEIGHT;
    showScopeSelection = false;
  }

  // Don't focus the scope selection if it is hidden due to height constraints.
  const currentFocusedSection = !showScopeSelection ? 'theme' : focusedSection;

  // Vertical space taken by elements other than the two code blocks in the preview pane.
  // Includes "Preview" title, borders, and margin between blocks.
  const PREVIEW_PANE_FIXED_VERTICAL_SPACE = 8;

  // The right column doesn't need to ever be shorter than the left column.
  availableTerminalHeight = Math.max(
    availableTerminalHeight,
    totalLeftHandSideHeight,
  );
  const availableTerminalHeightCodeBlock =
    availableTerminalHeight -
    PREVIEW_PANE_FIXED_VERTICAL_SPACE -
    (includePadding ? 2 : 0) * 2;

  // Subtract margin between code blocks from available height.
  const availableHeightForPanes = Math.max(
    0,
    availableTerminalHeightCodeBlock - 1,
  );

  // The code block is slightly longer than the diff, so give it more space.
  const codeBlockHeight = Math.ceil(availableHeightForPanes * 0.6);
  const diffHeight = Math.floor(availableHeightForPanes * 0.4);

  const previewTheme = useMemo(
    () =>
      themeManager.getTheme(highlightedThemeName ?? DEFAULT_THEME.name) ??
      DEFAULT_THEME,
    [highlightedThemeName],
  );

  const previewContent = useMemo(
    () => (
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
    ),
    [
      codeBlockHeight,
      colorizeCodeWidth,
      diffHeight,
      includePadding,
      previewTheme,
    ],
  );

  // Custom render function for theme items with compatibility labels
  const renderThemeItem = useCallback(
    (item: ThemeItem, { titleColor }: RenderItemContext) => {
      // Show compatibility labels only if we have terminal background color
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

      // Standard display without compatibility labels
      return (
        <Text color={titleColor} wrap="truncate">
          {item.themeNameDisplay}{' '}
          <Text color={theme.text.secondary}>{item.themeTypeDisplay}</Text>
        </Text>
      );
    },
    [terminalThemeType],
  );

  return (
    <Box
      borderStyle="round"
      borderColor={Colors.Gray}
      flexDirection="column"
      paddingTop={includePadding ? 1 : 0}
      paddingBottom={includePadding ? 1 : 0}
      paddingLeft={1}
      paddingRight={1}
      width="100%"
    >
      <Box flexDirection="row">
        {/* Left Column: Selection */}
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
            renderItem={renderThemeItem}
          />

          {/* Scope Selection */}
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
                initialIndex={0} // Default to User Settings
                onSelect={handleScopeSelect}
                onHighlight={handleScopeHighlight}
                isFocused={currentFocusedSection === 'scope'}
                showNumbers={currentFocusedSection === 'scope'}
              />
            </Box>
          )}
        </Box>

        {/* Right Column: Preview */}
        <Box flexDirection="column" width="55%" paddingLeft={2}>
          <Text bold color={Colors.Foreground}>
            Preview
          </Text>
          {/* Get the Theme object for the highlighted theme, fall back to default if not found */}
          {previewContent}
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text color={Colors.Gray} wrap="truncate">
          (Use Enter to select
          {showScopeSelection ? ', Tab to change focus' : ''}, Esc to close)
        </Text>
      </Box>
    </Box>
  );
}
