/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text } from 'ink';
import { SemanticColors } from '../colors.js';
import { useResponsive } from '../hooks/useResponsive.js';
import { useKeypress } from '../hooks/useKeypress.js';
import type { Profile } from '@vybestack/llxprt-code-core';

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

// Simple JSON editor that allows line-by-line editing
export const ProfileInlineEditor: React.FC<ProfileInlineEditorProps> = ({
  profileName,
  profile,
  onSave,
  onCancel,
  error: externalError,
}) => {
  const { width } = useResponsive();

  // Convert profile to formatted JSON lines
  const formatProfile = (p: Profile): string[] => {
    const json = JSON.stringify(p, null, 2);
    return json.split('\n');
  };

  const [lines, setLines] = useState<string[]>(() => formatProfile(profile));
  const [cursorLine, setCursorLine] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [editBuffer, setEditBuffer] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Visible window for scrolling
  const maxVisibleLines = 15;
  const [scrollOffset, setScrollOffset] = useState(0);

  // Reset editor when a different profile is loaded into the dialog.
  useEffect(() => {
    setLines(formatProfile(profile));
    setCursorLine(0);
    setScrollOffset(0);
    setIsEditing(false);
    setEditBuffer('');
    setValidationError(null);
    setHasChanges(false);
  }, [profileName, profile]);

  // Ensure cursor line is visible
  useEffect(() => {
    if (cursorLine < scrollOffset) {
      setScrollOffset(cursorLine);
    } else if (cursorLine >= scrollOffset + maxVisibleLines) {
      setScrollOffset(cursorLine - maxVisibleLines + 1);
    }
  }, [cursorLine, scrollOffset, maxVisibleLines]);

  // Validate JSON on changes
  const validateJson = useMemo(() => {
    try {
      const jsonString = lines.join('\n');
      JSON.parse(jsonString);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Invalid JSON';
    }
  }, [lines]);

  // Clear stale validation errors when JSON becomes valid
  useEffect(() => {
    if (!validateJson) {
      setValidationError(null);
    }
  }, [validateJson]);

  useKeypress(
    (key) => {
      if (isEditing) {
        // Edit mode
        if (key.name === 'escape') {
          // Cancel line edit
          setIsEditing(false);
          setEditBuffer('');
          return;
        }
        if (key.name === 'return') {
          // Commit line edit
          const newLines = [...lines];
          newLines[cursorLine] = editBuffer;
          setLines(newLines);
          setIsEditing(false);
          setEditBuffer('');
          setHasChanges(true);
          return;
        }
        if (key.name === 'backspace' || key.name === 'delete') {
          setEditBuffer((prev) => prev.slice(0, -1));
          return;
        }
        if (
          typeof key.sequence === 'string' &&
          !key.ctrl &&
          !key.meta &&
          key.sequence.length === 1
        ) {
          setEditBuffer((prev) => prev + key.sequence);
          return;
        }
        return;
      }

      // Navigation mode
      if (key.name === 'escape') {
        onCancel();
        return;
      }

      // Save
      if (key.ctrl && key.name === 's') {
        if (validateJson) {
          setValidationError(validateJson);
          return;
        }
        try {
          const updatedProfile = JSON.parse(lines.join('\n'));
          // Comprehensive profile validation
          const profileError = validateProfile(updatedProfile);
          if (profileError) {
            setValidationError(profileError);
            return;
          }
          onSave(profileName, updatedProfile as Profile);
        } catch (e) {
          setValidationError(e instanceof Error ? e.message : 'Invalid JSON');
        }
        return;
      }

      // Navigation
      if (key.name === 'up' || key.sequence === 'k') {
        setCursorLine((prev) => Math.max(0, prev - 1));
        return;
      }
      if (key.name === 'down' || key.sequence === 'j') {
        setCursorLine((prev) => Math.min(lines.length - 1, prev + 1));
        return;
      }

      // Enter edit mode
      if (key.name === 'return' || key.sequence === 'e') {
        setIsEditing(true);
        setEditBuffer(lines[cursorLine]);
        setValidationError(null);
        return;
      }

      // Page up/down
      if (key.name === 'pageup') {
        setCursorLine((prev) => Math.max(0, prev - maxVisibleLines));
        return;
      }
      if (key.name === 'pagedown') {
        setCursorLine((prev) =>
          Math.min(lines.length - 1, prev + maxVisibleLines),
        );
        return;
      }

      // Home/End
      if (key.sequence === 'g') {
        setCursorLine(0);
        return;
      }
      if (key.sequence === 'G') {
        setCursorLine(lines.length - 1);
        return;
      }
    },
    { isActive: true },
  );

  const visibleLines = lines.slice(
    scrollOffset,
    scrollOffset + maxVisibleLines,
  );
  const dialogWidth = Math.min(width, 90);

  return (
    <Box
      borderStyle="round"
      borderColor={
        validateJson
          ? SemanticColors.status.error
          : hasChanges
            ? SemanticColors.status.warning
            : SemanticColors.border.default
      }
      flexDirection="column"
      padding={1}
      width={dialogWidth}
    >
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color={SemanticColors.text.accent}>
          Edit: {profileName}
        </Text>
        {hasChanges && (
          <Text color={SemanticColors.status.warning}> (modified)</Text>
        )}
      </Box>

      {/* Error display */}
      {(validationError || externalError || validateJson) && (
        <Box marginBottom={1}>
          <Text color={SemanticColors.status.error}>
            Error: {validationError || externalError || validateJson}
          </Text>
        </Box>
      )}

      {/* Editor area */}
      <Box flexDirection="column" marginBottom={1}>
        {visibleLines.map((line, idx) => {
          const actualLine = scrollOffset + idx;
          const isCurrentLine = actualLine === cursorLine;

          return (
            <Box key={actualLine}>
              {/* Line number */}
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

              {/* Line content */}
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
        })}
      </Box>

      {/* Scroll indicator */}
      {lines.length > maxVisibleLines && (
        <Box marginBottom={1}>
          <Text color={SemanticColors.text.secondary}>
            Lines {scrollOffset + 1}-
            {Math.min(scrollOffset + maxVisibleLines, lines.length)} of{' '}
            {lines.length}
          </Text>
        </Box>
      )}

      {/* Instructions */}
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
    </Box>
  );
};
