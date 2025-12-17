/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
import { PrepareLabel } from './PrepareLabel.js';
import { isSlashCommand } from '../utils/commandUtils.js';
export interface Suggestion {
  label: string;
  value: string;
  description?: string;
  matchedIndex?: number;
}
interface SuggestionsDisplayProps {
  suggestions: Suggestion[];
  activeIndex: number;
  isLoading: boolean;
  width: number;
  scrollOffset: number;
  userInput: string;
  activeHint?: string;
}

export const MAX_SUGGESTIONS_TO_SHOW = 8;

/**
 * @plan:PLAN-20251013-AUTOCOMPLETE.P08
 * @requirement:REQ-002
 * @requirement:REQ-003
 * Feature flag enabled for hint display integration
 */
const SHOW_ARGUMENT_HINTS = true;

/**
 * @plan:PLAN-20251013-AUTOCOMPLETE.P08
 * @requirement:REQ-002
 * @requirement:REQ-003
 * @requirement:REQ-004
 * @pseudocode UIHintRendering.md lines 4-7
 * Full implementation of hint line rendering
 * - Line 4: Modify SuggestionsDisplay to accept activeHint prop
 * - Line 5-6: Render hint in dedicated line above suggestion list
 * - Line 7: Ensure consistent height to avoid layout shift
 */
export function SuggestionsDisplay({
  suggestions,
  activeIndex,
  isLoading,
  width,
  scrollOffset,
  userInput,
  activeHint,
}: SuggestionsDisplayProps) {
  if (isLoading) {
    return (
      <Box paddingX={1} width={width}>
        <Text color={Colors.Gray}>Loading suggestions...</Text>
      </Box>
    );
  }

  if (suggestions.length === 0) {
    return null;
  }

  // Calculate the visible slice based on scrollOffset
  const startIndex = scrollOffset;
  const endIndex = Math.min(
    scrollOffset + MAX_SUGGESTIONS_TO_SHOW,
    suggestions.length,
  );
  const visibleSuggestions = suggestions.slice(startIndex, endIndex);

  const isSlashCommandMode = isSlashCommand(userInput);
  let commandNameWidth = 0;

  if (isSlashCommandMode) {
    const maxLabelLength = visibleSuggestions.length
      ? Math.max(...visibleSuggestions.map((s) => s.label.length))
      : 0;

    const maxAllowedWidth = Math.floor(width * 0.35);
    commandNameWidth = Math.max(
      15,
      Math.min(maxLabelLength + 2, maxAllowedWidth),
    );
  }

  // Calculate how many lines we need to reserve
  const hasScrollUp = scrollOffset > 0;
  const hasScrollDown = endIndex < suggestions.length;
  const hasCounter = suggestions.length > MAX_SUGGESTIONS_TO_SHOW;

  return (
    <Box flexDirection="column" paddingX={1} width={width}>
      {/* Hint line - rendered when feature flag is enabled and hint is provided */}
      {SHOW_ARGUMENT_HINTS && activeHint ? (
        <Box marginBottom={1}>
          <Text color={Colors.Gray} wrap="wrap">
            {activeHint}
          </Text>
        </Box>
      ) : null}

      {hasScrollUp && <Text color={Colors.Foreground}>▲</Text>}

      {visibleSuggestions.map((suggestion, index) => {
        const originalIndex = startIndex + index;
        const isActive = originalIndex === activeIndex;
        const textColor = isActive ? '#00ff00' : Colors.Foreground;
        const labelElement = (
          <PrepareLabel
            label={suggestion.label}
            matchedIndex={suggestion.matchedIndex}
            userInput={userInput}
            textColor={textColor}
          />
        );

        return (
          <Box key={`${suggestion.value}-${originalIndex}`} width={width}>
            <Box flexDirection="row">
              {isSlashCommandMode ? (
                <>
                  <Box width={commandNameWidth} flexShrink={0}>
                    {labelElement}
                  </Box>
                  {suggestion.description ? (
                    <Box flexGrow={1} marginLeft={1}>
                      <Text color={textColor} wrap="wrap">
                        {suggestion.description}
                      </Text>
                    </Box>
                  ) : null}
                </>
              ) : (
                <>
                  {labelElement}
                  {suggestion.description ? (
                    <Box flexGrow={1} marginLeft={1}>
                      <Text color={textColor} wrap="wrap">
                        {suggestion.description}
                      </Text>
                    </Box>
                  ) : null}
                </>
              )}
            </Box>
          </Box>
        );
      })}

      {hasScrollDown && <Text color={Colors.Gray}>▼</Text>}
      {hasCounter && (
        <Text color={Colors.Gray}>
          ({activeIndex + 1}/{suggestions.length})
        </Text>
      )}
    </Box>
  );
}
