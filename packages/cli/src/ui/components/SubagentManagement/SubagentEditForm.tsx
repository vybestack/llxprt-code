/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useMemo } from 'react';
import { Box, Text } from 'ink';
import { useTextBuffer } from '../shared/text-buffer.js';
import { Colors } from '../../colors.js';
import { useKeypress } from '../../hooks/useKeypress.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import type { SubagentInfo } from './types.js';

interface SubagentEditFormProps {
  subagent: SubagentInfo;
  profiles: string[];
  pendingProfile?: string; // Profile selected from wizard, not yet saved
  onSave: (systemPrompt: string, profile: string) => Promise<void>;
  onCancel: () => void;
  onSelectProfile: () => void;
  isFocused?: boolean;
}

type FocusTarget = 'prompt' | 'profile' | 'actions';
type ActionTarget = 'save' | 'cancel';

const FOCUS_ORDER: FocusTarget[] = ['prompt', 'profile', 'actions'];

export const SubagentEditForm: React.FC<SubagentEditFormProps> = ({
  subagent,
  profiles: _profiles,
  pendingProfile,
  onSave,
  onCancel,
  onSelectProfile,
  isFocused = true,
}) => {
  const [focusTarget, setFocusTarget] = useState<FocusTarget>('prompt');
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [selectedAction, setSelectedAction] = useState<ActionTarget>('save');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { rows: terminalRows, columns: terminalColumns } = useTerminalSize();

  const selectedProfile = pendingProfile ?? subagent.profile;

  // Keep conservative to avoid rendering off-screen.
  const NON_EDITOR_HEIGHT = 17;
  const editorHeight = Math.max(
    4,
    Math.min(10, terminalRows - NON_EDITOR_HEIGHT),
  );
  const editorWidth = Math.max(20, terminalColumns - 24);

  const promptBuffer = useTextBuffer({
    initialText: subagent.systemPrompt,
    viewport: { width: editorWidth, height: editorHeight },
    isValidPath: () => false,
  });

  const hasChanges =
    promptBuffer.text !== subagent.systemPrompt ||
    selectedProfile !== subagent.profile;

  const handleSave = useCallback(async () => {
    if (!hasChanges) {
      onCancel();
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await onSave(promptBuffer.text, selectedProfile);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
      setIsSaving(false);
    }
  }, [hasChanges, onCancel, onSave, promptBuffer.text, selectedProfile]);

  const visibleLines = promptBuffer.viewportVisualLines;
  const totalVisualLines = promptBuffer.allVisualLines.length;
  const startLine = totalVisualLines > 0 ? promptBuffer.visualScrollRow + 1 : 0;
  const endLine =
    totalVisualLines > 0
      ? Math.min(startLine + visibleLines.length - 1, totalVisualLines)
      : 0;

  const moveFocus = useCallback(
    (direction: 'up' | 'down') => {
      const currentIndex = FOCUS_ORDER.indexOf(focusTarget);
      const nextIndex =
        direction === 'up'
          ? Math.max(0, currentIndex - 1)
          : Math.min(FOCUS_ORDER.length - 1, currentIndex + 1);
      setFocusTarget(FOCUS_ORDER[nextIndex]);
    },
    [focusTarget],
  );

  useKeypress(
    (key) => {
      if (isSaving) {
        return;
      }

      if (isEditingPrompt) {
        if (key.name === 'escape') {
          setIsEditingPrompt(false);
          return;
        }

        promptBuffer.handleInput(key);
        return;
      }

      if (key.name === 'escape') {
        onCancel();
        return;
      }

      const isUp = key.name === 'up' || key.sequence === 'k';
      const isDown = key.name === 'down' || key.sequence === 'j';
      const isLeft = key.name === 'left' || key.sequence === 'h';
      const isRight = key.name === 'right' || key.sequence === 'l';
      const isActivate = key.name === 'return' || key.name === 'space';

      if (isUp) {
        moveFocus('up');
        return;
      }

      if (isDown) {
        moveFocus('down');
        return;
      }

      if (focusTarget === 'actions') {
        if (isLeft) {
          setSelectedAction('save');
          return;
        }

        if (isRight) {
          setSelectedAction('cancel');
          return;
        }
      }

      if (!isActivate) {
        return;
      }

      if (focusTarget === 'prompt') {
        setIsEditingPrompt(true);
        return;
      }

      if (focusTarget === 'profile') {
        onSelectProfile();
        return;
      }

      if (focusTarget === 'actions') {
        if (selectedAction === 'save') {
          handleSave();
        } else {
          onCancel();
        }
      }
    },
    { isActive: isFocused && !isSaving },
  );

  const renderLineWithCursor = useCallback(
    (line: string, idx: number) => {
      const relativeCursorRow =
        promptBuffer.visualCursor[0] - promptBuffer.visualScrollRow;
      const isCursorLine = idx === relativeCursorRow;

      if (!isCursorLine || !isEditingPrompt) {
        return (
          <Text key={idx} color={Colors.Foreground} wrap="truncate-end">
            {line || ' '}
          </Text>
        );
      }

      const col = promptBuffer.visualCursor[1];
      const safeCol = Math.max(0, Math.min(col, line.length));
      const before = line.slice(0, safeCol);
      const at = line[safeCol] ?? ' ';
      const after = line.slice(safeCol + 1);

      return (
        <Text key={idx} color={Colors.Foreground} wrap="truncate-end">
          {before}
          <Text color="#00ff00">{at}</Text>
          {after}
        </Text>
      );
    },
    [isEditingPrompt, promptBuffer.visualCursor, promptBuffer.visualScrollRow],
  );

  const promptHint = useMemo(() => {
    if (isEditingPrompt) {
      return '[ESC] Stop editing (changes kept, not saved)';
    }

    if (focusTarget === 'prompt') {
      return '[Enter] Edit prompt';
    }

    return null;
  }, [focusTarget, isEditingPrompt]);

  const profileHint = useMemo(
    () => (focusTarget === 'profile' ? ' [Enter] Change Profile' : ''),
    [focusTarget],
  );

  const actionsHint = useMemo(
    () =>
      focusTarget === 'actions' ? '[←/→] Choose  [Enter/Space] Activate' : '',
    [focusTarget],
  );

  const saveColor =
    focusTarget === 'actions' && selectedAction === 'save'
      ? '#00ff00'
      : Colors.Foreground;
  const cancelColor =
    focusTarget === 'actions' && selectedAction === 'cancel'
      ? '#00ff00'
      : Colors.Foreground;

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={Colors.Foreground}>
          Edit Configuration
        </Text>
      </Box>
      <Text color={Colors.Gray}>
        ──────────────────────────────────────────────────────
      </Text>

      {error && (
        <Box marginBottom={1}>
          <Text color="#ff0000">{error}</Text>
        </Box>
      )}

      <Box flexDirection="column" marginY={1}>
        <Box>
          <Text
            color={focusTarget === 'prompt' ? '#00ff00' : Colors.Foreground}
          >
            {focusTarget === 'prompt' ? '→ ' : '  '}1 System Prompt
          </Text>
          {isEditingPrompt && <Text color="#00ff00"> (editing)</Text>}
        </Box>

        <Box marginLeft={4} marginBottom={1}>
          <Text color={Colors.Gray}>
            Lines {startLine}-{endLine} of {totalVisualLines}
          </Text>
        </Box>

        <Box
          marginLeft={4}
          flexDirection="column"
          borderStyle="single"
          borderColor={focusTarget === 'prompt' ? '#00ff00' : Colors.Gray}
          paddingX={1}
          height={editorHeight + 2}
          overflow="hidden"
        >
          {visibleLines.length > 0 ? (
            visibleLines.map(renderLineWithCursor)
          ) : (
            <Text color={Colors.Foreground}> </Text>
          )}
        </Box>

        {promptHint && (
          <Box marginLeft={4} marginTop={1}>
            <Text color={Colors.Gray}>{promptHint}</Text>
          </Box>
        )}
      </Box>

      <Box flexDirection="column" marginY={1}>
        <Box>
          <Text
            color={focusTarget === 'profile' ? '#00ff00' : Colors.Foreground}
          >
            {focusTarget === 'profile' ? '→ ' : '  '}2 Profile Assignment
          </Text>
        </Box>
        <Box marginLeft={4}>
          <Text color={Colors.Gray}>Current: </Text>
          <Text color={Colors.Foreground}>{selectedProfile}</Text>
          {selectedProfile !== subagent.profile && (
            <Text color="#ffff00"> (changed)</Text>
          )}
          <Text color={Colors.Gray}>{profileHint}</Text>
        </Box>
      </Box>

      <Box flexDirection="column" marginY={1}>
        <Box>
          <Text
            color={focusTarget === 'actions' ? '#00ff00' : Colors.Foreground}
          >
            {focusTarget === 'actions' ? '→ ' : '  '}3 Actions
          </Text>
        </Box>
        <Box marginLeft={4}>
          <Text color={saveColor}>[ Save ]</Text>
          <Text color={Colors.Gray}> </Text>
          <Text color={cancelColor}>[ Cancel ]</Text>
        </Box>
        {actionsHint && (
          <Box marginLeft={4}>
            <Text color={Colors.Gray}>{actionsHint}</Text>
          </Box>
        )}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text color={Colors.Gray}>Controls: ↑↓ move focus, Enter activate</Text>
        <Text color={Colors.Gray}>ESC closes without saving</Text>
        {hasChanges && <Text color="#ffff00">* Unsaved changes</Text>}
      </Box>

      {isSaving && (
        <Box marginTop={1}>
          <Text color={Colors.Gray}>Saving...</Text>
        </Box>
      )}
    </Box>
  );
};
