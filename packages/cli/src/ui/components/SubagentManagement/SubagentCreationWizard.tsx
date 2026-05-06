/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useState, useCallback, useMemo } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../../colors.js';
import { useKeypress } from '../../hooks/useKeypress.js';
import { RadioButtonSelect } from '../shared/RadioButtonSelect.js';
import { CreateStep, type CreateWizardState } from './types.js';

interface SubagentCreationWizardProps {
  profiles: string[];
  activeProfileName?: string | null;
  onSave: (
    name: string,
    systemPrompt: string,
    profile: string,
    mode: 'auto' | 'manual',
  ) => Promise<void>;
  onCancel: () => void;
  isFocused?: boolean;
}

type FieldName = 'name' | 'mode' | 'systemPrompt' | 'profile';

function ModeSelectModal({
  currentMode,
  onSelect,
}: {
  currentMode: 'auto' | 'manual';
  onSelect: (mode: 'auto' | 'manual') => void;
}) {
  const modeItems = [
    {
      label: 'Manual (enter full system prompt)',
      value: 'manual' as const,
      key: 'manual',
    },
    {
      label: 'Auto (LLM expands your description)',
      value: 'auto' as const,
      key: 'auto',
    },
  ];
  return (
    <Box flexDirection="column">
      <Text bold color={Colors.Foreground}>
        Select Mode
      </Text>
      <Text color={Colors.Gray}>
        ──────────────────────────────────────────────────────────
      </Text>
      <RadioButtonSelect<'auto' | 'manual'>
        items={modeItems}
        onSelect={onSelect}
        isFocused={true}
        initialIndex={currentMode === 'auto' ? 1 : 0}
        maxItemsToShow={10}
      />
      <Box marginTop={1}>
        <Text color={Colors.Gray}>[ESC] Cancel</Text>
      </Box>
    </Box>
  );
}

function ProfileSelectModal({
  profiles,
  onSelect,
}: {
  profiles: string[];
  onSelect: (profile: string) => void;
}) {
  const profileItems = profiles.map((p) => ({ label: p, value: p, key: p }));
  return (
    <Box flexDirection="column">
      <Text bold color={Colors.Foreground}>
        Select Profile
      </Text>
      <Text color={Colors.Gray}>
        ──────────────────────────────────────────────────────────
      </Text>
      <RadioButtonSelect<string>
        items={profileItems}
        onSelect={onSelect}
        isFocused={true}
        maxItemsToShow={10}
      />
      <Box marginTop={1}>
        <Text color={Colors.Gray}>[ESC] Cancel</Text>
      </Box>
    </Box>
  );
}

function SelectionFieldDisplay({
  value,
  isFieldFocused,
}: {
  value: string;
  isFieldFocused: boolean;
}) {
  return (
    <Box marginLeft={4}>
      <Text color={Colors.Gray}>Current: </Text>
      <Text color={Colors.Foreground}>{value || '(none)'}</Text>
      {isFieldFocused && <Text color={Colors.Gray}> [Enter] Select</Text>}
    </Box>
  );
}

function EditingFieldDisplay({
  value,
  multiline,
}: {
  value: string;
  multiline: boolean;
}) {
  return (
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
  );
}

function formatFieldValue(value: string, multiline: boolean): string {
  if (!value) return '(empty)';
  if (!multiline) return value;
  if (value.length > 40) return `[${value.slice(0, 40)}...]`;
  return value;
}

function InactiveFieldDisplay({
  value,
  multiline,
  isFieldFocused,
}: {
  value: string;
  multiline: boolean;
  isFieldFocused: boolean;
}) {
  return (
    <Box marginLeft={4}>
      <Text color={Colors.Gray}>{formatFieldValue(value, multiline)}</Text>
      {isFieldFocused && <Text color={Colors.Gray}> [Enter] Edit</Text>}
    </Box>
  );
}

function FieldDisplay({
  field,
  focusedField,
  isEditing,
  value,
  multiline,
}: {
  field: FieldName;
  focusedField: FieldName;
  isEditing: boolean;
  value: string;
  multiline: boolean;
}) {
  const isFieldFocused = focusedField === field;
  if (field === 'profile' || field === 'mode')
    return (
      <SelectionFieldDisplay value={value} isFieldFocused={isFieldFocused} />
    );
  if (isFieldFocused && isEditing)
    return <EditingFieldDisplay value={value} multiline={multiline} />;
  return (
    <InactiveFieldDisplay
      value={value}
      multiline={multiline}
      isFieldFocused={isFieldFocused}
    />
  );
}

function FormStepField({
  field,
  label,
  step,
  focusedField,
  isEditing,
  value,
  multiline,
}: {
  field: FieldName;
  label: string;
  step: number;
  focusedField: FieldName;
  isEditing: boolean;
  value: string;
  multiline?: boolean;
}) {
  const isFieldFocused = focusedField === field;
  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text color={isFieldFocused ? '#00ff00' : Colors.Foreground}>
          {isFieldFocused ? '→ ' : '  '}
          {step} {label}
        </Text>
      </Box>
      <FieldDisplay
        field={field}
        focusedField={focusedField}
        isEditing={isEditing}
        value={value}
        multiline={multiline ?? false}
      />
    </Box>
  );
}

function FormFields({
  state,
  focusedField,
  isEditing,
}: {
  state: CreateWizardState;
  focusedField: FieldName;
  isEditing: boolean;
}) {
  return (
    <>
      <Box marginTop={1}>
        <Text bold color={Colors.Foreground}>
          Step 1: Name
        </Text>
      </Box>
      <FormStepField
        field="name"
        label="Name (a-z, 0-9, -, _)"
        step={1}
        focusedField={focusedField}
        isEditing={isEditing}
        value={state.name}
      />
      <Box marginTop={1}>
        <Text bold color={Colors.Foreground}>
          Step 2: Mode
        </Text>
      </Box>
      <FormStepField
        field="mode"
        label="Mode"
        step={2}
        focusedField={focusedField}
        isEditing={isEditing}
        value={state.mode}
      />
      <Box marginTop={1}>
        <Text bold color={Colors.Foreground}>
          Step 3: {state.mode === 'auto' ? 'Description' : 'System Prompt'}
        </Text>
      </Box>
      <FormStepField
        field="systemPrompt"
        label={state.mode === 'auto' ? 'Description' : 'System Prompt'}
        step={3}
        focusedField={focusedField}
        isEditing={isEditing}
        value={state.systemPrompt}
        multiline={true}
      />
      <Box marginTop={1}>
        <Text bold color={Colors.Foreground}>
          Step 4: Profile Assignment
        </Text>
      </Box>
      <FormStepField
        field="profile"
        label="Profile"
        step={4}
        focusedField={focusedField}
        isEditing={isEditing}
        value={state.selectedProfile}
      />
    </>
  );
}

function CreationWizardForm({
  state,
  focusedField,
  isEditing,
  isSaving,
  error,
}: {
  state: CreateWizardState;
  focusedField: FieldName;
  isEditing: boolean;
  isSaving: boolean;
  error: string | null;
}) {
  return (
    <Box flexDirection="column">
      <Text bold color={Colors.Foreground}>
        Create New Subagent
      </Text>
      <Text color={Colors.Gray}>
        ──────────────────────────────────────────────────────────
      </Text>
      {error && (
        <Box marginBottom={1}>
          <Text color="#ff0000">{error}</Text>
        </Box>
      )}
      <FormFields
        state={state}
        focusedField={focusedField}
        isEditing={isEditing}
      />
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
}

function useModalEscape(
  isFocused: boolean,
  showModeSelect: boolean,
  showProfileSelect: boolean,
  setShowModeSelect: (v: boolean) => void,
  setShowProfileSelect: (v: boolean) => void,
) {
  useKeypress(
    (key) => {
      if (showModeSelect && key.name === 'escape') {
        setShowModeSelect(false);
        return;
      }
      if (showProfileSelect && key.name === 'escape') {
        setShowProfileSelect(false);
      }
    },
    { isActive: isFocused && (showModeSelect || showProfileSelect) },
  );
}

function useEditingKeys(opts: {
  isFocused: boolean;
  isModalOpen: boolean;
  isEditing: boolean;
  focusedField: FieldName;
  handleBackspace: () => void;
  handleInput: (c: string) => void;
  setIsEditing: (v: boolean) => void;
  moveField: (d: number) => void;
}) {
  useKeypress(
    (key) => {
      if (!opts.isFocused || opts.isModalOpen || !opts.isEditing) return;
      if (key.name === 'escape') {
        opts.setIsEditing(false);
        return;
      }
      if (key.name === 'backspace' || key.name === 'delete') {
        opts.handleBackspace();
        return;
      }
      if (key.name === 'return' && opts.focusedField === 'systemPrompt') {
        opts.handleInput('\n');
        return;
      }
      if (key.name === 'return' && opts.focusedField === 'name') {
        opts.setIsEditing(false);
        opts.moveField(1);
        return;
      }
      const input = key.sequence;
      if (input && !key.ctrl && !key.meta) {
        opts.handleInput(input);
      }
    },
    { isActive: opts.isFocused && !opts.isModalOpen && opts.isEditing },
  );
}

function useNavKeys(opts: {
  isSaving: boolean;
  isModalOpen: boolean;
  isEditing: boolean;
  focusedField: FieldName;
  moveField: (d: number) => void;
  setShowModeSelect: (v: boolean) => void;
  setShowProfileSelect: (v: boolean) => void;
  setIsEditing: (v: boolean) => void;
  handleSave: () => Promise<void>;
  onCancel: () => void;
  isFocused: boolean;
}) {
  useKeypress(
    (key) => {
      if (opts.isSaving || opts.isModalOpen || opts.isEditing) return;
      if (key.name === 'escape') {
        opts.onCancel();
        return;
      }
      if (key.name === 'up') {
        opts.moveField(-1);
        return;
      }
      if (key.name === 'down') {
        opts.moveField(1);
        return;
      }
      if (key.name === 'return') {
        if (opts.focusedField === 'mode') opts.setShowModeSelect(true);
        else if (opts.focusedField === 'profile')
          opts.setShowProfileSelect(true);
        else opts.setIsEditing(true);
        return;
      }
      if (key.sequence === 's') {
        void opts.handleSave();
      }
    },
    { isActive: opts.isFocused && !opts.isSaving && !opts.isModalOpen },
  );
}

function useWizardState(profiles: string[], activeProfileName?: string | null) {
  return useState<CreateWizardState>(() => ({
    currentStep: CreateStep.FORM,
    name: '',
    mode: 'auto',
    systemPrompt: '',
    selectedProfile:
      (activeProfileName && profiles.includes(activeProfileName)
        ? activeProfileName
        : profiles[0]) || '',
    validationErrors: {},
  }));
}

function useInputHandlers(
  focusedField: FieldName,
  setState: React.Dispatch<React.SetStateAction<CreateWizardState>>,
) {
  const handleInput = useCallback(
    (char: string) => {
      setState((prev) => {
        if (focusedField === 'profile' || focusedField === 'mode') return prev;
        if (focusedField === 'name' && char === ' ') return prev;
        const field = focusedField;
        if (char === '\n' && field === 'systemPrompt')
          return { ...prev, [field]: prev[field] + '\n' };
        return { ...prev, [field]: prev[field] + char };
      });
    },
    [focusedField, setState],
  );
  const handleBackspace = useCallback(() => {
    setState((prev) => {
      if (focusedField === 'profile' || focusedField === 'mode') return prev;
      return { ...prev, [focusedField]: prev[focusedField].slice(0, -1) };
    });
  }, [focusedField, setState]);
  return { handleInput, handleBackspace };
}

function useSaveHandler(
  state: CreateWizardState,
  onSave: SubagentCreationWizardProps['onSave'],
  setError: React.Dispatch<React.SetStateAction<string | null>>,
  setIsSaving: React.Dispatch<React.SetStateAction<boolean>>,
) {
  const validateName = useCallback((name: string): string | null => {
    if (!name.trim()) return 'Name is required';
    if (!/^[a-zA-Z0-9_-]+$/.test(name))
      return 'Only letters, numbers, hyphens, and underscores allowed';
    return null;
  }, []);
  return useCallback(async () => {
    const nameError = validateName(state.name);
    if (nameError) {
      setError(nameError);
      return;
    }
    if (!state.systemPrompt.trim()) {
      setError(
        state.mode === 'auto'
          ? 'Description is required'
          : 'System prompt is required',
      );
      return;
    }
    if (!state.selectedProfile) {
      setError('Profile is required');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await onSave(
        state.name,
        state.systemPrompt,
        state.selectedProfile,
        state.mode,
      );
      setIsSaving(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
      setIsSaving(false);
    }
  }, [state, validateName, onSave, setError, setIsSaving]);
}

function useSelectHandlers(
  setState: React.Dispatch<React.SetStateAction<CreateWizardState>>,
  setFocusedField: React.Dispatch<React.SetStateAction<FieldName>>,
  setShowModeSelect: React.Dispatch<React.SetStateAction<boolean>>,
  setShowProfileSelect: React.Dispatch<React.SetStateAction<boolean>>,
) {
  const handleModeSelect = useCallback(
    (mode: 'auto' | 'manual') => {
      setState((prev) => ({ ...prev, mode }));
      setShowModeSelect(false);
      setFocusedField('mode');
    },
    [setState, setFocusedField, setShowModeSelect],
  );
  const handleProfileSelect = useCallback(
    (profile: string) => {
      setState((prev) => ({ ...prev, selectedProfile: profile }));
      setShowProfileSelect(false);
      setFocusedField('profile');
    },
    [setState, setFocusedField, setShowProfileSelect],
  );
  return { handleModeSelect, handleProfileSelect };
}

function useFieldMover(
  focusedField: FieldName,
  fields: FieldName[],
  setFocusedField: React.Dispatch<React.SetStateAction<FieldName>>,
) {
  return useCallback(
    (delta: number) => {
      const currentIndex = fields.indexOf(focusedField);
      let newIndex = currentIndex + delta;
      if (newIndex < 0) newIndex = 0;
      if (newIndex >= fields.length) newIndex = fields.length - 1;
      setFocusedField(fields[newIndex]);
    },
    [focusedField, fields, setFocusedField],
  );
}

export const SubagentCreationWizard: React.FC<SubagentCreationWizardProps> = ({
  profiles,
  activeProfileName,
  onSave,
  onCancel,
  isFocused = true,
}) => {
  const [state, setState] = useWizardState(profiles, activeProfileName);
  const [focusedField, setFocusedField] = useState<FieldName>('name');
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showModeSelect, setShowModeSelect] = useState(false);
  const [showProfileSelect, setShowProfileSelect] = useState(false);

  const fields = useMemo<FieldName[]>(
    () => ['name', 'mode', 'systemPrompt', 'profile'],
    [],
  );

  const { handleInput, handleBackspace } = useInputHandlers(
    focusedField,
    setState,
  );
  const handleSave = useSaveHandler(state, onSave, setError, setIsSaving);
  const { handleModeSelect, handleProfileSelect } = useSelectHandlers(
    setState,
    setFocusedField,
    setShowModeSelect,
    setShowProfileSelect,
  );
  const moveField = useFieldMover(focusedField, fields, setFocusedField);
  const isModalOpen = showModeSelect || showProfileSelect;

  useModalEscape(
    isFocused,
    showModeSelect,
    showProfileSelect,
    setShowModeSelect,
    setShowProfileSelect,
  );
  useEditingKeys({
    isFocused,
    isModalOpen,
    isEditing,
    focusedField,
    handleBackspace,
    handleInput,
    setIsEditing,
    moveField,
  });
  useNavKeys({
    isSaving,
    isModalOpen,
    isEditing,
    focusedField,
    moveField,
    setShowModeSelect,
    setShowProfileSelect,
    setIsEditing,
    handleSave,
    onCancel,
    isFocused,
  });

  if (showModeSelect)
    return (
      <ModeSelectModal currentMode={state.mode} onSelect={handleModeSelect} />
    );
  if (showProfileSelect)
    return (
      <ProfileSelectModal profiles={profiles} onSelect={handleProfileSelect} />
    );
  return (
    <CreationWizardForm
      state={state}
      focusedField={focusedField}
      isEditing={isEditing}
      isSaving={isSaving}
      error={error}
    />
  );
};
