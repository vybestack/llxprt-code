/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useMemo } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../../colors.js';
import { useKeypress } from '../../hooks/useKeypress.js';
import { RadioButtonSelect } from '../shared/RadioButtonSelect.js';
import { CreateStep, type CreateWizardState } from './types.js';

interface SubagentCreationWizardProps {
  profiles: string[];
  onSave: (
    name: string,
    systemPrompt: string,
    profile: string,
  ) => Promise<void>;
  onCancel: () => void;
  isFocused?: boolean;
}

type FieldName = 'name' | 'systemPrompt' | 'profile';

export const SubagentCreationWizard: React.FC<SubagentCreationWizardProps> = ({
  profiles,
  onSave,
  onCancel,
  isFocused = true,
}) => {
  const [state, setState] = useState<CreateWizardState>({
    currentStep: CreateStep.FORM,
    name: '',
    systemPrompt: '',
    selectedProfile: profiles[0] || '',
    validationErrors: {},
  });

  const [focusedField, setFocusedField] = useState<FieldName>('name');
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showProfileSelect, setShowProfileSelect] = useState(false);

  const fields = useMemo<FieldName[]>(
    () => ['name', 'systemPrompt', 'profile'],
    [],
  );

  const validateName = useCallback((name: string): string | null => {
    if (!name.trim()) return 'Name is required';
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      return 'Only letters, numbers, hyphens, and underscores allowed';
    }
    return null;
  }, []);

  const handleInput = useCallback(
    (char: string) => {
      setState((prev) => {
        // Skip input for profile field
        if (focusedField === 'profile') return prev;

        const field = focusedField;
        if (char === '\n' && field === 'systemPrompt') {
          return { ...prev, [field]: prev[field] + '\n' };
        }
        return { ...prev, [field]: prev[field] + char };
      });
    },
    [focusedField],
  );

  const handleBackspace = useCallback(() => {
    setState((prev) => {
      // Skip backspace for profile field
      if (focusedField === 'profile') return prev;

      const field = focusedField;
      return { ...prev, [field]: prev[field].slice(0, -1) };
    });
  }, [focusedField]);

  const handleSave = useCallback(async () => {
    // Validate
    const nameError = validateName(state.name);
    if (nameError) {
      setError(nameError);
      return;
    }
    if (!state.systemPrompt.trim()) {
      setError('System prompt is required');
      return;
    }
    if (!state.selectedProfile) {
      setError('Profile is required');
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      await onSave(state.name, state.systemPrompt, state.selectedProfile);
      setIsSaving(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
      setIsSaving(false);
    }
  }, [state, validateName, onSave]);

  const handleProfileSelect = useCallback((profile: string) => {
    setState((prev) => ({ ...prev, selectedProfile: profile }));
    setShowProfileSelect(false);
    setFocusedField('profile');
  }, []);

  const moveField = useCallback(
    (delta: number) => {
      const currentIndex = fields.indexOf(focusedField);
      let newIndex = currentIndex + delta;
      if (newIndex < 0) newIndex = 0;
      if (newIndex >= fields.length) newIndex = fields.length - 1;
      setFocusedField(fields[newIndex]);
    },
    [focusedField, fields],
  );

  useKeypress(
    (key) => {
      const input = key.sequence;
      if (isSaving) return;

      // Profile selection mode
      if (showProfileSelect) {
        if (key.name === 'escape') {
          setShowProfileSelect(false);
        }
        return;
      }

      // Editing mode
      if (isEditing) {
        if (key.name === 'escape') {
          setIsEditing(false);
          return;
        }
        if (key.name === 'backspace' || key.name === 'delete') {
          handleBackspace();
          return;
        }
        if (key.name === 'return' && focusedField === 'systemPrompt') {
          handleInput('\n');
          return;
        }
        if (key.name === 'return' && focusedField === 'name') {
          setIsEditing(false);
          moveField(1);
          return;
        }
        if (input && !key.ctrl && !key.meta) {
          handleInput(input);
        }
        return;
      }

      // Navigation mode
      if (key.name === 'escape') {
        onCancel();
        return;
      }

      if (key.name === 'up') {
        moveField(-1);
        return;
      }
      if (key.name === 'down') {
        moveField(1);
        return;
      }

      if (key.name === 'return') {
        if (focusedField === 'profile') {
          setShowProfileSelect(true);
        } else {
          setIsEditing(true);
        }
        return;
      }

      // Quick save with 's'
      if (input === 's') {
        handleSave();
        return;
      }
    },
    { isActive: isFocused && !isSaving },
  );

  // Profile selection modal
  if (showProfileSelect) {
    const profileItems = profiles.map((p) => ({
      label: p,
      value: p,
      key: p,
    }));

    return (
      <Box flexDirection="column">
        <Text bold color={Colors.Foreground}>
          Select Profile
        </Text>
        <Text color={Colors.Gray}>
          ──────────────────────────────────────────────────────
        </Text>
        <RadioButtonSelect<string>
          items={profileItems}
          onSelect={handleProfileSelect}
          isFocused={true}
          maxItemsToShow={10}
        />
        <Box marginTop={1}>
          <Text color={Colors.Gray}>[ESC] Cancel</Text>
        </Box>
      </Box>
    );
  }

  const renderField = (
    field: FieldName,
    label: string,
    step: number,
    value: string,
    multiline = false,
  ) => {
    const isFocused = focusedField === field;
    const isCurrentlyEditing = isFocused && isEditing;

    return (
      <Box flexDirection="column" marginY={1} key={field}>
        <Box>
          <Text color={isFocused ? '#00ff00' : Colors.Foreground}>
            {isFocused ? '→ ' : '  '}
            {step} {label}
          </Text>
        </Box>
        {field === 'profile' ? (
          <Box marginLeft={4}>
            <Text color={Colors.Gray}>Current: </Text>
            <Text color={Colors.Foreground}>{value || '(none)'}</Text>
            {isFocused && <Text color={Colors.Gray}> [Enter] Select</Text>}
          </Box>
        ) : isCurrentlyEditing ? (
          <Box
            flexDirection="column"
            borderStyle="single"
            borderColor="#00ff00"
            marginLeft={4}
            paddingX={1}
          >
            {multiline ? (
              <>
                {value.split('\n').map((line, idx) => (
                  <Text key={idx} color={Colors.Foreground}>
                    {line || ' '}
                  </Text>
                ))}
                <Text color="#00ff00">|</Text>
              </>
            ) : (
              <Text color={Colors.Foreground}>
                {value}
                <Text color="#00ff00">|</Text>
              </Text>
            )}
            <Text color={Colors.Gray}>
              {multiline ? '[ESC] Done Editing' : '[Enter] Next field'}
            </Text>
          </Box>
        ) : (
          <Box marginLeft={4}>
            <Text color={Colors.Gray}>
              {value
                ? multiline
                  ? `[${value.slice(0, 40)}...]`
                  : value
                : '(empty)'}
            </Text>
            {isFocused && <Text color={Colors.Gray}> [Enter] Edit</Text>}
          </Box>
        )}
      </Box>
    );
  };

  return (
    <Box flexDirection="column">
      <Text bold color={Colors.Foreground}>
        Create New Subagent
      </Text>
      <Text color={Colors.Gray}>
        ──────────────────────────────────────────────────────
      </Text>

      {error && (
        <Box marginBottom={1}>
          <Text color="#ff0000">{error}</Text>
        </Box>
      )}

      {/* Step 1: Name */}
      <Box marginTop={1}>
        <Text bold color={Colors.Foreground}>
          Step 1: Name
        </Text>
      </Box>
      {renderField('name', 'Name', 1, state.name)}

      {/* Step 2: System Prompt */}
      <Box marginTop={1}>
        <Text bold color={Colors.Foreground}>
          Step 2: System Prompt
        </Text>
      </Box>
      {renderField(
        'systemPrompt',
        'System Prompt',
        2,
        state.systemPrompt,
        true,
      )}

      {/* Step 3: Profile Assignment */}
      <Box marginTop={1}>
        <Text bold color={Colors.Foreground}>
          Step 3: Profile Assignment
        </Text>
      </Box>
      {renderField('profile', 'Profile', 3, state.selectedProfile)}

      {/* Controls */}
      <Box flexDirection="column" marginTop={1}>
        <Text color={Colors.Gray}>
          Controls: ↑↓ Navigate fields [Enter] Edit/Select
        </Text>
        <Text color={Colors.Gray}> [s] Save [ESC] Cancel</Text>
        <Text color={Colors.Gray}>
          {' '}
          Current field: {focusedField}
          {isEditing ? ' (editing)' : ''}
        </Text>
      </Box>

      {isSaving && (
        <Box marginTop={1}>
          <Text color={Colors.Gray}>Creating subagent...</Text>
        </Box>
      )}
    </Box>
  );
};
