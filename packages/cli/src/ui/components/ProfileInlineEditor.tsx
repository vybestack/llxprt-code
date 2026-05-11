/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable complexity, eslint-comments/disable-enable-pair -- Phase 5: legacy UI boundary retained while larger decomposition continues. */

import type React from 'react';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { Box, Text } from 'ink';
import { SemanticColors } from '../colors.js';
import { useResponsive } from '../hooks/useResponsive.js';
import { useKeypress } from '../hooks/useKeypress.js';
import type { Profile } from '@vybestack/llxprt-code-core';

/**
 * Get border color based on editor state.
 */
function getEditorBorderColor(
  validationMessage: string | null,
  hasChanges: boolean,
): string {
  if (validationMessage !== null) return SemanticColors.status.error;
  if (hasChanges) return SemanticColors.status.warning;
  return SemanticColors.border.default;
}

interface ProfileInlineEditorProps {
  profileName: string;
  profile: Profile;
  onSave: (profileName: string, updatedProfile: Profile) => void;
  onCancel: () => void;
  error?: string;
}

/**
 * Validates a profile structure. Returns error message or null if valid.
 */
function validateProfile(profile: unknown): string | null {
  if (typeof profile !== 'object' || profile === null) {
    return 'Invalid profile: must be an object';
  }

  const p = profile as Record<string, unknown>;

  if (!('version' in p) || typeof p.version !== 'string') {
    return 'Missing or invalid version';
  }

  if (!('type' in p) || typeof p.type !== 'string') {
    return 'Missing or invalid type';
  }

  if (p.type === 'standard') {
    if (!('provider' in p) || typeof p.provider !== 'string' || !p.provider) {
      return 'Standard profile requires provider';
    }
    if (!('model' in p) || typeof p.model !== 'string' || !p.model) {
      return 'Standard profile requires model';
    }
  } else if (p.type === 'loadbalancer') {
    if (!('profiles' in p) || !Array.isArray(p.profiles)) {
      return 'Load balancer requires profiles array';
    }
    if (p.profiles.length === 0) {
      return 'Load balancer requires at least one profile';
    }
    if (!p.profiles.every((item) => typeof item === 'string')) {
      return 'Profiles must be strings';
    }
    if (!('policy' in p) || typeof p.policy !== 'string' || !p.policy) {
      return 'Load balancer requires policy';
    }
  } else {
    return `Unknown profile type: ${p.type}`;
  }

  return null;
}

function formatProfile(p: Profile): string[] {
  const json = JSON.stringify(p, null, 2);
  return json.split('\n');
}

function handleEditModeKeys(
  key: { name?: string; sequence?: string; ctrl?: boolean; meta?: boolean },
  setEditBuffer: React.Dispatch<React.SetStateAction<string>>,
  commitLine: () => void,
  cancelEdit: () => void,
): boolean {
  if (key.name === 'escape') {
    cancelEdit();
    return true;
  }
  if (key.name === 'return') {
    commitLine();
    return true;
  }
  if (key.name === 'backspace' || key.name === 'delete') {
    setEditBuffer((prev) => prev.slice(0, -1));
    return true;
  }
  if (
    typeof key.sequence === 'string' &&
    key.ctrl !== true &&
    key.meta !== true &&
    key.sequence.length === 1
  ) {
    setEditBuffer((prev) => prev + key.sequence);
    return true;
  }
  return false;
}

function handleSaveKeys(
  key: { name?: string; sequence?: string; ctrl?: boolean; meta?: boolean },
  validateJson: string | null,
  lines: string[],
  profileName: string,
  onSave: (profileName: string, updatedProfile: Profile) => void,
  setValidationError: React.Dispatch<React.SetStateAction<string | null>>,
): boolean {
  if (!(key.ctrl === true && key.name === 's')) return false;

  if (validateJson !== null) {
    setValidationError(validateJson);
    return true;
  }
  try {
    const updatedProfile = JSON.parse(lines.join('\n'));
    const profileError = validateProfile(updatedProfile);
    if (profileError !== null) {
      setValidationError(profileError);
      return true;
    }
    onSave(profileName, updatedProfile as Profile);
  } catch (e) {
    setValidationError(e instanceof Error ? e.message : 'Invalid JSON');
  }
  return true;
}

function handleNavModeKeys(
  key: { name?: string; sequence?: string; ctrl?: boolean; meta?: boolean },
  lines: string[],
  cursorLine: number,
  setCursorLine: React.Dispatch<React.SetStateAction<number>>,
  maxVisibleLines: number,
  validateJson: string | null,
  setValidationError: React.Dispatch<React.SetStateAction<string | null>>,
  profileName: string,
  onSave: (profileName: string, updatedProfile: Profile) => void,
  onCancel: () => void,
  startEditing: () => void,
): boolean {
  if (key.name === 'escape') {
    onCancel();
    return true;
  }

  if (
    handleSaveKeys(
      key,
      validateJson,
      lines,
      profileName,
      onSave,
      setValidationError,
    )
  )
    return true;

  if (key.name === 'up' || key.sequence === 'k') {
    setCursorLine((prev) => Math.max(0, prev - 1));
    return true;
  }
  if (key.name === 'down' || key.sequence === 'j') {
    setCursorLine((prev) => Math.min(lines.length - 1, prev + 1));
    return true;
  }

  if (key.name === 'return' || key.sequence === 'e') {
    startEditing();
    return true;
  }

  if (key.name === 'pageup') {
    setCursorLine((prev) => Math.max(0, prev - maxVisibleLines));
    return true;
  }
  if (key.name === 'pagedown') {
    setCursorLine((prev) => Math.min(lines.length - 1, prev + maxVisibleLines));
    return true;
  }

  if (key.sequence === 'g') {
    setCursorLine(0);
    return true;
  }
  if (key.sequence === 'G') {
    setCursorLine(lines.length - 1);
    return true;
  }

  return false;
}

const EditorHeader: React.FC<{
  profileName: string;
  hasChanges: boolean;
}> = ({ profileName, hasChanges }) => (
  <Box marginBottom={1}>
    <Text bold color={SemanticColors.text.accent}>
      Edit: {profileName}
    </Text>
    {hasChanges && (
      <Text color={SemanticColors.status.warning}> (modified)</Text>
    )}
  </Box>
);

const ErrorDisplay: React.FC<{
  validationError: string | null;
  externalError: string | undefined;
  validateJson: string | null;
}> = ({ validationError, externalError, validateJson }) => {
  // intentional falsy coalescing for error display (empty string means no error)
  const error: string | null | undefined =
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    validationError || externalError || validateJson;
  if (error == null) return null;

  return (
    <Box marginBottom={1}>
      <Text color={SemanticColors.status.error}>Error: {error}</Text>
    </Box>
  );
};

const EditorLine: React.FC<{
  actualLine: number;
  line: string;
  isCurrentLine: boolean;
  isEditing: boolean;
  editBuffer: string;
}> = ({ actualLine, line, isCurrentLine, isEditing, editBuffer }) => (
  <Box key={actualLine}>
    <Box width={4}>
      <Text
        color={
          isCurrentLine
            ? SemanticColors.text.accent
            : SemanticColors.text.secondary
        }
      >
        {String(actualLine + 1).padStart(3, ' ')}
      </Text>
    </Box>

    {isEditing && isCurrentLine ? (
      <Box>
        <Text color={SemanticColors.text.accent}>
          {editBuffer}
          <Text color={SemanticColors.text.accent}>▌</Text>
        </Text>
      </Box>
    ) : (
      <Text
        color={
          isCurrentLine
            ? SemanticColors.text.accent
            : SemanticColors.text.primary
        }
        bold={isCurrentLine}
      >
        {isCurrentLine ? '› ' : '  '}
        {line}
      </Text>
    )}
  </Box>
);

const ScrollIndicator: React.FC<{
  linesLength: number;
  maxVisibleLines: number;
  scrollOffset: number;
}> = ({ linesLength, maxVisibleLines, scrollOffset }) => {
  if (linesLength <= maxVisibleLines) return null;

  return (
    <Box marginBottom={1}>
      <Text color={SemanticColors.text.secondary}>
        Lines {scrollOffset + 1}-
        {Math.min(scrollOffset + maxVisibleLines, linesLength)} of {linesLength}
      </Text>
    </Box>
  );
};

const InstructionsBar: React.FC<{
  isEditing: boolean;
  cursorLine: number;
}> = ({ isEditing, cursorLine }) => (
  <Box
    borderStyle="single"
    borderTop
    borderBottom={false}
    borderLeft={false}
    borderRight={false}
    borderColor={SemanticColors.border.default}
    paddingTop={1}
  >
    {isEditing ? (
      <Text color={SemanticColors.text.secondary}>
        Editing line {cursorLine + 1}. Enter=commit, Esc=cancel
      </Text>
    ) : (
      <Text color={SemanticColors.text.secondary}>
        ↑/↓=navigate, Enter/e=edit line, Ctrl+S=save, Esc=cancel
      </Text>
    )}
  </Box>
);

// Simple JSON editor that allows line-by-line editing
const EditorArea: React.FC<{
  visibleLines: string[];
  scrollOffset: number;
  cursorLine: number;
  isEditing: boolean;
  editBuffer: string;
}> = ({ visibleLines, scrollOffset, cursorLine, isEditing, editBuffer }) => (
  <Box flexDirection="column" marginBottom={1}>
    {visibleLines.map((line, idx) => {
      const actualLine = scrollOffset + idx;
      const isCurrentLine = actualLine === cursorLine;
      return (
        <EditorLine
          key={actualLine}
          actualLine={actualLine}
          line={line}
          isCurrentLine={isCurrentLine}
          isEditing={isEditing}
          editBuffer={editBuffer}
        />
      );
    })}
  </Box>
);

const EditorLayout: React.FC<{
  profileName: string;
  hasChanges: boolean;
  validationError: string | null;
  externalError: string | undefined;
  validateJson: string | null;
  visibleLines: string[];
  scrollOffset: number;
  cursorLine: number;
  isEditing: boolean;
  editBuffer: string;
  linesLength: number;
  maxVisibleLines: number;
  dialogWidth: number;
}> = ({
  profileName,
  hasChanges,
  validationError,
  externalError,
  validateJson,
  visibleLines,
  scrollOffset,
  cursorLine,
  isEditing,
  editBuffer,
  linesLength,
  maxVisibleLines,
  dialogWidth,
}) => (
  <Box
    borderStyle="round"
    borderColor={getEditorBorderColor(validateJson, hasChanges)}
    flexDirection="column"
    padding={1}
    width={dialogWidth}
  >
    <EditorHeader profileName={profileName} hasChanges={hasChanges} />
    <ErrorDisplay
      validationError={validationError}
      externalError={externalError}
      validateJson={validateJson}
    />
    <EditorArea
      visibleLines={visibleLines}
      scrollOffset={scrollOffset}
      cursorLine={cursorLine}
      isEditing={isEditing}
      editBuffer={editBuffer}
    />
    <ScrollIndicator
      linesLength={linesLength}
      maxVisibleLines={maxVisibleLines}
      scrollOffset={scrollOffset}
    />
    <InstructionsBar isEditing={isEditing} cursorLine={cursorLine} />
  </Box>
);

function useEditorKeypress(
  isEditing: boolean,
  setEditBuffer: React.Dispatch<React.SetStateAction<string>>,
  commitLine: () => void,
  cancelEdit: () => void,
  lines: string[],
  cursorLine: number,
  setCursorLine: React.Dispatch<React.SetStateAction<number>>,
  maxVisibleLines: number,
  validateJson: string | null,
  setValidationError: React.Dispatch<React.SetStateAction<string | null>>,
  profileName: string,
  onSave: (profileName: string, updatedProfile: Profile) => void,
  onCancel: () => void,
  startEditing: () => void,
) {
  const handleKeypress = useCallback(
    (key: Parameters<Parameters<typeof useKeypress>[0]>[0]) => {
      if (isEditing) {
        handleEditModeKeys(key, setEditBuffer, commitLine, cancelEdit);
        return;
      }
      handleNavModeKeys(
        key,
        lines,
        cursorLine,
        setCursorLine,
        maxVisibleLines,
        validateJson,
        setValidationError,
        profileName,
        onSave,
        onCancel,
        startEditing,
      );
    },
    [
      isEditing,
      setEditBuffer,
      commitLine,
      cancelEdit,
      lines,
      cursorLine,
      setCursorLine,
      maxVisibleLines,
      validateJson,
      setValidationError,
      profileName,
      onSave,
      onCancel,
      startEditing,
    ],
  );

  useKeypress(handleKeypress, { isActive: true });
}

function useEditorState(
  profileName: string,
  profile: Profile,
  setValidationError: React.Dispatch<React.SetStateAction<string | null>>,
) {
  const [lines, setLines] = useState<string[]>(() => formatProfile(profile));
  const [cursorLine, setCursorLine] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [editBuffer, setEditBuffer] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const maxVisibleLines = 15;
  const [scrollOffset, setScrollOffset] = useState(0);

  useEffect(() => {
    setLines(formatProfile(profile));
    setCursorLine(0);
    setScrollOffset(0);
    setIsEditing(false);
    setEditBuffer('');
    setValidationError(null);
    setHasChanges(false);
  }, [profileName, profile, setValidationError]);

  useEffect(() => {
    if (cursorLine < scrollOffset) {
      setScrollOffset(cursorLine);
    } else if (cursorLine >= scrollOffset + maxVisibleLines) {
      setScrollOffset(cursorLine - maxVisibleLines + 1);
    }
  }, [cursorLine, scrollOffset, maxVisibleLines]);

  return {
    lines,
    setLines,
    cursorLine,
    setCursorLine,
    isEditing,
    setIsEditing,
    editBuffer,
    setEditBuffer,
    hasChanges,
    setHasChanges,
    scrollOffset,
    maxVisibleLines,
  };
}

function useEditorActions(
  lines: string[],
  setLines: React.Dispatch<React.SetStateAction<string[]>>,
  cursorLine: number,
  setIsEditing: React.Dispatch<React.SetStateAction<boolean>>,
  editBuffer: string,
  setEditBuffer: React.Dispatch<React.SetStateAction<string>>,
  setHasChanges: React.Dispatch<React.SetStateAction<boolean>>,
  setValidationError: React.Dispatch<React.SetStateAction<string | null>>,
) {
  const commitLine = useCallback(() => {
    const newLines = [...lines];
    newLines[cursorLine] = editBuffer;
    setLines(newLines);
    setIsEditing(false);
    setEditBuffer('');
    setHasChanges(true);
  }, [
    lines,
    cursorLine,
    editBuffer,
    setLines,
    setIsEditing,
    setEditBuffer,
    setHasChanges,
  ]);

  const cancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditBuffer('');
  }, [setIsEditing, setEditBuffer]);

  const startEditing = useCallback(() => {
    setIsEditing(true);
    setEditBuffer(lines[cursorLine]);
    setValidationError(null);
  }, [lines, cursorLine, setIsEditing, setEditBuffer, setValidationError]);

  return { commitLine, cancelEdit, startEditing };
}

export const ProfileInlineEditor: React.FC<ProfileInlineEditorProps> = ({
  profileName,
  profile,
  onSave,
  onCancel,
  error: externalError,
}) => {
  const { width } = useResponsive();
  const [validationError, setValidationError] = useState<string | null>(null);

  const state = useEditorState(profileName, profile, setValidationError);

  const validateJson = useMemo(() => {
    try {
      JSON.parse(state.lines.join('\n'));
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Invalid JSON';
    }
  }, [state.lines]);

  useEffect(() => {
    if (validateJson === null) setValidationError(null);
  }, [validateJson]);

  const { commitLine, cancelEdit, startEditing } = useEditorActions(
    state.lines,
    state.setLines,
    state.cursorLine,
    state.setIsEditing,
    state.editBuffer,
    state.setEditBuffer,
    state.setHasChanges,
    setValidationError,
  );

  useEditorKeypress(
    state.isEditing,
    state.setEditBuffer,
    commitLine,
    cancelEdit,
    state.lines,
    state.cursorLine,
    state.setCursorLine,
    state.maxVisibleLines,
    validateJson,
    setValidationError,
    profileName,
    onSave,
    onCancel,
    startEditing,
  );

  const visibleLines = state.lines.slice(
    state.scrollOffset,
    state.scrollOffset + state.maxVisibleLines,
  );
  const dialogWidth = Math.min(width, 90);

  return (
    <EditorLayout
      profileName={profileName}
      hasChanges={state.hasChanges}
      validationError={validationError}
      externalError={externalError}
      validateJson={validateJson}
      visibleLines={visibleLines}
      scrollOffset={state.scrollOffset}
      cursorLine={state.cursorLine}
      isEditing={state.isEditing}
      editBuffer={state.editBuffer}
      linesLength={state.lines.length}
      maxVisibleLines={state.maxVisibleLines}
      dialogWidth={dialogWidth}
    />
  );
};
