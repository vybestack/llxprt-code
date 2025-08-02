/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState, useMemo } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
import { SuggestionsDisplay } from './SuggestionsDisplay.js';
import { useInputHistory } from '../hooks/useInputHistory.js';
import { TextBuffer } from './shared/text-buffer.js';
import { cpSlice, cpLen } from '../utils/textUtils.js';
import chalk from 'chalk';
import stringWidth from 'string-width';
import { useShellHistory } from '../hooks/useShellHistory.js';
import { useCompletion } from '../hooks/useCompletion.js';
import { useKeypress, Key } from '../hooks/useKeypress.js';
import { CommandContext, SlashCommand } from '../commands/types.js';
import { Config } from '@vybestack/llxprt-code-core';
import {
  clipboardHasImage,
  saveClipboardImage,
  cleanupOldClipboardImages,
} from '../utils/clipboardUtils.js';
import * as path from 'path';
import { secureInputHandler } from '../utils/secureInputHandler.js';

export interface InputPromptProps {
  buffer: TextBuffer;
  onSubmit: (value: string) => void;
  userMessages: readonly string[];
  onClearScreen: () => void;
  config: Config;
  slashCommands: readonly SlashCommand[];
  commandContext: CommandContext;
  placeholder?: string;
  focus?: boolean;
  inputWidth: number;
  suggestionsWidth: number;
  shellModeActive: boolean;
  setShellModeActive: (value: boolean) => void;
  vimHandleInput?: (key: Key) => boolean;
}

export const InputPrompt: React.FC<InputPromptProps> = ({
  buffer,
  onSubmit,
  userMessages,
  onClearScreen,
  config,
  slashCommands,
  commandContext,
  placeholder = '  Type your message or @path/to/file',
  focus = true,
  inputWidth,
  suggestionsWidth,
  shellModeActive,
  setShellModeActive,
  vimHandleInput,
}) => {
  const [justNavigatedHistory, setJustNavigatedHistory] = useState(false);
  const [pasteMessage, setPasteMessage] = useState<string | null>(null);

  const [dirs, setDirs] = useState<readonly string[]>(
    config.getWorkspaceContext().getDirectories(),
  );
  const dirsChanged = config.getWorkspaceContext().getDirectories();
  useEffect(() => {
    if (dirs.length !== dirsChanged.length) {
      setDirs(dirsChanged);
    }
  }, [dirs.length, dirsChanged]);

  const completion = useCompletion(
    buffer,
    dirs,
    config.getTargetDir(),
    slashCommands,
    commandContext,
    config,
  );

  const resetCompletionState = completion.resetCompletionState;
  const shellHistory = useShellHistory(config.getProjectRoot());

  const handleSubmitAndClear = useCallback(
    (submittedValue: string) => {
      // Get the actual value if in secure mode
      const actualValue = secureInputHandler.isInSecureMode()
        ? secureInputHandler.getActualValue()
        : submittedValue;

      if (shellModeActive) {
        // Sanitize for history if it's a secure command
        const historyValue = secureInputHandler.sanitizeForHistory(actualValue);
        shellHistory.addCommandToHistory(historyValue);
      }

      // Clear the buffer *before* calling onSubmit to prevent potential re-submission
      // if onSubmit triggers a re-render while the buffer still holds the old value.
      buffer.setText('');

      // Reset secure input handler
      secureInputHandler.reset();

      onSubmit(actualValue);
      resetCompletionState();
      setPasteMessage(null);
    },
    [onSubmit, buffer, resetCompletionState, shellModeActive, shellHistory],
  );

  const customSetTextAndResetCompletionSignal = useCallback(
    (newText: string) => {
      buffer.setText(newText);
      setJustNavigatedHistory(true);
      // Process through secure handler to update its state
      secureInputHandler.processInput(newText);
    },
    [buffer, setJustNavigatedHistory],
  );

  const inputHistory = useInputHistory({
    userMessages,
    onSubmit: handleSubmitAndClear,
    isActive:
      (!completion.showSuggestions || completion.suggestions.length === 1) &&
      !shellModeActive,
    currentQuery: buffer.text,
    onChange: customSetTextAndResetCompletionSignal,
  });

  // Effect to reset completion if history navigation just occurred and set the text
  useEffect(() => {
    if (justNavigatedHistory) {
      resetCompletionState();
      setJustNavigatedHistory(false);
    }
  }, [
    justNavigatedHistory,
    buffer.text,
    resetCompletionState,
    setJustNavigatedHistory,
  ]);

  // Handle clipboard image pasting with Ctrl+V
  const handleClipboardImage = useCallback(async () => {
    try {
      if (await clipboardHasImage()) {
        const imagePath = await saveClipboardImage(config.getTargetDir());
        if (imagePath) {
          // Clean up old images
          cleanupOldClipboardImages(config.getTargetDir()).catch(() => {
            // Ignore cleanup errors
          });

          // Get relative path from current directory
          const relativePath = path.relative(config.getTargetDir(), imagePath);

          // Insert @path reference at cursor position
          const insertText = `@${relativePath}`;
          const currentText = buffer.text;
          const [row, col] = buffer.cursor;

          // Calculate offset from row/col
          let offset = 0;
          for (let i = 0; i < row; i++) {
            offset += buffer.lines[i].length + 1; // +1 for newline
          }
          offset += col;

          // Add spaces around the path if needed
          let textToInsert = insertText;
          const charBefore = offset > 0 ? currentText[offset - 1] : '';
          const charAfter =
            offset < currentText.length ? currentText[offset] : '';

          if (charBefore && charBefore !== ' ' && charBefore !== '\n') {
            textToInsert = ' ' + textToInsert;
          }
          if (!charAfter || (charAfter !== ' ' && charAfter !== '\n')) {
            textToInsert = textToInsert + ' ';
          }

          // Insert at cursor position
          buffer.replaceRangeByOffset(offset, offset, textToInsert);
        }
      }
    } catch (error) {
      console.error('Error handling clipboard image:', error);
    }
  }, [buffer, config]);

  const handleInput = useCallback(
    (key: Key) => {
      /// We want to handle paste even when not focused to support drag and drop.
      if (!focus && !key.paste) {
        return;
      }

      if (vimHandleInput && vimHandleInput(key)) {
        return;
      }

      if (
        key.sequence === '!' &&
        buffer.text === '' &&
        !completion.showSuggestions
      ) {
        setShellModeActive(!shellModeActive);
        buffer.setText(''); // Clear the '!' from input
        return;
      }

      if (key.name === 'escape') {
        if (shellModeActive) {
          setShellModeActive(false);
          return;
        }

        if (completion.showSuggestions) {
          completion.resetCompletionState();
          return;
        }
      }

      if (key.ctrl && key.name === 'l') {
        onClearScreen();
        return;
      }

      // If the command is a perfect match, pressing enter should execute it.
      if (completion.isPerfectMatch && key.name === 'return') {
        handleSubmitAndClear(buffer.text);
        return;
      }

      if (completion.showSuggestions) {
        if (completion.suggestions.length > 1) {
          if (key.name === 'up' || (key.ctrl && key.name === 'p')) {
            completion.navigateUp();
            return;
          }
          if (key.name === 'down' || (key.ctrl && key.name === 'n')) {
            completion.navigateDown();
            return;
          }
        }
        if (key.name === 'tab' || (key.name === 'return' && !key.ctrl)) {
          if (completion.suggestions.length > 0) {
            const targetIndex =
              completion.activeSuggestionIndex === -1
                ? 0 // Default to the first if none is active
                : completion.activeSuggestionIndex;
            if (targetIndex < completion.suggestions.length) {
              completion.handleAutocomplete(targetIndex);
            }
          }
          return;
        }
      }

      if (!shellModeActive) {
        if (key.ctrl && key.name === 'p') {
          inputHistory.navigateUp();
          return;
        }
        if (key.ctrl && key.name === 'n') {
          inputHistory.navigateDown();
          return;
        }
        // Handle arrow-up/down for history on single-line or at edges
        if (
          key.name === 'up' &&
          (buffer.allVisualLines.length === 1 ||
            (buffer.visualCursor[0] === 0 && buffer.visualScrollRow === 0))
        ) {
          inputHistory.navigateUp();
          return;
        }
        if (
          key.name === 'down' &&
          (buffer.allVisualLines.length === 1 ||
            buffer.visualCursor[0] === buffer.allVisualLines.length - 1)
        ) {
          inputHistory.navigateDown();
          return;
        }
      } else {
        // Shell History Navigation
        if (key.name === 'up') {
          const prevCommand = shellHistory.getPreviousCommand();
          if (prevCommand !== null) buffer.setText(prevCommand);
          return;
        }
        if (key.name === 'down') {
          const nextCommand = shellHistory.getNextCommand();
          if (nextCommand !== null) buffer.setText(nextCommand);
          return;
        }
      }

      if (key.name === 'return' && !key.ctrl && !key.meta && !key.paste) {
        if (buffer.text.trim()) {
          const [row, col] = buffer.cursor;
          const line = buffer.lines[row];
          const charBefore = col > 0 ? cpSlice(line, col - 1, col) : '';
          if (charBefore === '\\') {
            buffer.backspace();
            buffer.newline();
          } else {
            handleSubmitAndClear(buffer.text);
          }
        }
        return;
      }

      // Newline insertion
      if (key.name === 'return' && (key.ctrl || key.meta || key.paste)) {
        buffer.newline();
        return;
      }

      // Ctrl+A (Home) / Ctrl+E (End)
      if (key.ctrl && key.name === 'a') {
        buffer.move('home');
        return;
      }
      if (key.ctrl && key.name === 'e') {
        buffer.move('end');
        buffer.moveToOffset(cpLen(buffer.text));
        return;
      }
      // Ctrl+C (Clear input)
      if (key.ctrl && key.name === 'c') {
        if (buffer.text.length > 0) {
          buffer.setText('');
          resetCompletionState();
          secureInputHandler.reset();
          return;
        }
        return;
      }

      // Kill line commands
      if (key.ctrl && key.name === 'k') {
        buffer.killLineRight();
        return;
      }
      if (key.ctrl && key.name === 'u') {
        buffer.killLineLeft();
        return;
      }
      // External editor
      const isCtrlX = key.ctrl && (key.name === 'x' || key.sequence === '\x18');
      if (isCtrlX) {
        buffer.openInExternalEditor();
        return;
      }

      // Ctrl+V for clipboard image paste
      if (key.ctrl && key.name === 'v') {
        handleClipboardImage();
        return;
      }

      // Check for multi-line paste
      if (key.paste && key.sequence) {
        const lines = key.sequence.split('\n');
        if (lines.length > 1) {
          setPasteMessage(`[${lines.length} lines pasted]`);
        }

        // Insert the paste content at cursor position
        buffer.insert(key.sequence);

        // Update secure input handler state after paste
        // This ensures the handler knows about the pasted content
        secureInputHandler.processInput(buffer.text);

        return;
      }

      // Fall back to the text buffer's default input handling for all other keys
      buffer.handleInput(key);

      // Update secure input handler state after any input
      // This ensures the handler always has the current text
      secureInputHandler.processInput(buffer.text);
    },
    [
      focus,
      buffer,
      completion,
      shellModeActive,
      setShellModeActive,
      onClearScreen,
      inputHistory,
      handleSubmitAndClear,
      shellHistory,
      handleClipboardImage,
      resetCompletionState,
      vimHandleInput,
    ],
  );

  useKeypress(handleInput, { isActive: true });

  // Process buffer text through secure input handler
  // This will return masked text if it detects /key command, otherwise returns original text
  const textToDisplay = useMemo(
    () => secureInputHandler.processInput(buffer.text),
    [buffer.text],
  );

  // Calculate visual lines for the display text
  const displayLines = useMemo(() => {
    if (!secureInputHandler.isInSecureMode()) {
      return buffer.viewportVisualLines;
    }

    // In secure mode, simply return the masked text as a single line
    // The issue is that buffer.viewportVisualLines are calculated from buffer.text
    // but we need to display textToDisplay instead

    // For now, let's just return the masked text as a single visual line
    // This works for single-line inputs (which is the common case for API keys)
    return [textToDisplay];
  }, [buffer.viewportVisualLines, textToDisplay]);

  const linesToRender = displayLines;
  const [cursorVisualRowAbsolute, cursorVisualColAbsolute] =
    buffer.visualCursor;
  const scrollVisualRow = buffer.visualScrollRow;

  return (
    <>
      <Box
        borderStyle="round"
        borderColor={shellModeActive ? Colors.AccentYellow : Colors.AccentBlue}
        paddingX={1}
      >
        <Text
          color={shellModeActive ? Colors.AccentYellow : Colors.AccentPurple}
        >
          {shellModeActive ? '! ' : '> '}
        </Text>
        <Box flexGrow={1} flexDirection="column">
          {textToDisplay.length === 0 && placeholder ? (
            focus ? (
              <Text>
                {chalk.inverse(placeholder.slice(0, 1))}
                <Text color={Colors.Gray}>{placeholder.slice(1)}</Text>
              </Text>
            ) : (
              <Text color={Colors.Gray}>{placeholder}</Text>
            )
          ) : (
            linesToRender.map(
              (lineText: string, visualIdxInRenderedSet: number) => {
                const cursorVisualRow =
                  cursorVisualRowAbsolute - scrollVisualRow;
                let display = cpSlice(lineText, 0, inputWidth);
                const currentVisualWidth = stringWidth(display);
                if (currentVisualWidth < inputWidth) {
                  display =
                    display + ' '.repeat(inputWidth - currentVisualWidth);
                }

                if (focus && visualIdxInRenderedSet === cursorVisualRow) {
                  const relativeVisualColForHighlight = cursorVisualColAbsolute;

                  if (relativeVisualColForHighlight >= 0) {
                    if (relativeVisualColForHighlight < cpLen(display)) {
                      const charToHighlight =
                        cpSlice(
                          display,
                          relativeVisualColForHighlight,
                          relativeVisualColForHighlight + 1,
                        ) || ' ';
                      const highlighted = chalk.inverse(charToHighlight);
                      display =
                        cpSlice(display, 0, relativeVisualColForHighlight) +
                        highlighted +
                        cpSlice(display, relativeVisualColForHighlight + 1);
                    } else if (
                      relativeVisualColForHighlight === cpLen(display) &&
                      cpLen(display) === inputWidth
                    ) {
                      display = display + chalk.inverse(' ');
                    }
                  }
                }
                return (
                  <Text
                    color={Colors.Foreground}
                    key={`line-${visualIdxInRenderedSet}`}
                  >
                    {display}
                  </Text>
                );
              },
            )
          )}
        </Box>
      </Box>
      {completion.showSuggestions && (
        <Box>
          <SuggestionsDisplay
            suggestions={completion.suggestions}
            activeIndex={completion.activeSuggestionIndex}
            isLoading={completion.isLoadingSuggestions}
            width={suggestionsWidth}
            scrollOffset={completion.visibleStartIndex}
            userInput={textToDisplay}
          />
        </Box>
      )}
      {pasteMessage && (
        <Box marginTop={1}>
          <Text color={Colors.Comment}>{pasteMessage}</Text>
        </Box>
      )}
    </>
  );
};
