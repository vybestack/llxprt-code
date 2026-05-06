/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useState, useCallback, useEffect } from 'react';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Box, Text } from 'ink';
import { Colors } from '../../colors.js';
import { RadioButtonSelect } from '../shared/RadioButtonSelect.js';
import { TextInput } from './TextInput.js';
import { useKeypress } from '../../hooks/useKeypress.js';
import {
  generateProfileNameSuggestions,
  buildProfileJSON,
  saveProfile,
  getStepPosition,
} from './utils.js';
import type { WizardState } from './types.js';

const useExistingProfiles = () => {
  const [existingProfiles, setExistingProfiles] = useState<string[]>([]);

  useEffect(() => {
    const loadExistingProfiles = async () => {
      try {
        const profilesDir = path.join(os.homedir(), '.llxprt', 'profiles');
        const files = await fs.readdir(profilesDir);
        const profileNames = files
          .filter((f) => f.endsWith('.json'))
          .map((f) => f.replace(/\.json$/, ''));
        setExistingProfiles(profileNames);
      } catch {
        setExistingProfiles([]);
      }
    };
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    loadExistingProfiles();
  }, []);

  return existingProfiles;
};

const ConflictDialog: React.FC<{
  profileNameInput: string;
  handleConflictResolution: (value: string) => void;
}> = ({ profileNameInput, handleConflictResolution }) => (
  <>
    <Text color={Colors.AccentYellow}>Profile Name Conflict</Text>
    <Text color={Colors.Foreground}> </Text>
    <Text color={Colors.Foreground}>
      A profile named &apos;{profileNameInput}&apos; already exists.
    </Text>
    <Text color={Colors.Gray}>
      Choose a different name or overwrite the existing profile:
    </Text>
    <Text color={Colors.Foreground}> </Text>
    <RadioButtonSelect
      items={[
        {
          label: 'Choose different name',
          value: 'rename',
          key: 'rename',
        },
        {
          label: 'Overwrite existing profile',
          value: 'overwrite',
          key: 'overwrite',
        },
        { label: 'Back', value: 'back', key: 'back' },
        { label: 'Cancel', value: 'cancel', key: 'cancel' },
      ]}
      onSelect={handleConflictResolution}
      isFocused={true}
    />
  </>
);

const ProfileNameInput: React.FC<{
  profileNameInput: string;
  saveError: string | null;
  validationError: string | null;
  suggestions: string[];
  handleProfileNameChange: (value: string) => void;
  handleProfileNameSubmit: (forceSave?: boolean) => void;
}> = ({
  profileNameInput,
  saveError,
  validationError,
  suggestions,
  handleProfileNameChange,
  handleProfileNameSubmit,
}) => (
  <>
    <Text color={Colors.Foreground}>Profile name:</Text>
    <TextInput
      value={profileNameInput}
      onChange={handleProfileNameChange}
      onSubmit={handleProfileNameSubmit}
      isFocused={true}
      placeholder="my-profile"
    />
    {saveError && <Text color={Colors.AccentRed}>✗ {saveError}</Text>}
    {validationError && (
      <Text color={Colors.AccentRed}>✗ {validationError}</Text>
    )}
    {!validationError && !saveError && profileNameInput && (
      <Text color={Colors.AccentGreen}>✓ Name is available</Text>
    )}
    <Text color={Colors.Foreground}> </Text>
    <Text color={Colors.Gray}>ℹ Suggested names:</Text>
    {suggestions.map((suggestion) => (
      <Text key={suggestion} color={Colors.Gray}>
        • {suggestion}
      </Text>
    ))}
    <Text color={Colors.Foreground}> </Text>
    <Text color={Colors.Gray}>← → Move cursor Enter Continue Esc Back</Text>
  </>
);

const validateProfileName = (
  value: string,
  existingProfiles: string[],
): string | null => {
  if (!value.trim()) {
    return 'Profile name cannot be empty';
  }
  if (value.includes('/') || value.includes('\\')) {
    return 'Profile name cannot contain path separators';
  }
  if (existingProfiles.includes(value)) {
    return 'Profile name already exists';
  }
  return null;
};

const executeSave = async (
  profileNameInput: string,
  state: WizardState,
  forceSave: boolean,
  onContinue: () => void,
  setFocusedComponent: (v: 'input' | 'saving' | 'conflict') => void,
  setSaveError: (v: string | null) => void,
  setValidationError: (v: string | null) => void,
) => {
  setFocusedComponent('saving');
  setSaveError(null);

  const profileJSON = buildProfileJSON(state);
  const result = await saveProfile(profileNameInput, profileJSON, {
    overwrite: forceSave,
  });

  if (result.success) {
    onContinue();
  } else if (result.alreadyExists ?? false) {
    setValidationError('Profile name already exists');
    setFocusedComponent('conflict');
  } else {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing for empty-string error fallback
    setSaveError(result.error || 'Failed to save profile');
    setFocusedComponent('input');
  }
};

const useSaveEscapeHandler = (
  focusedComponent: 'input' | 'saving' | 'conflict',
  setFocusedComponent: (v: 'input' | 'saving' | 'conflict') => void,
  onBack: () => void,
) => {
  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        if (focusedComponent === 'input') {
          onBack();
        } else if (focusedComponent === 'conflict') {
          setFocusedComponent('input');
        }
      }
    },
    { isActive: true },
  );
};

const useProfileNameHandler = (
  existingProfiles: string[],
  onUpdateProfileName: (name: string) => void,
  setProfileNameInput: (v: string) => void,
  setValidationError: (v: string | null) => void,
) =>
  useCallback(
    (value: string) => {
      setProfileNameInput(value);
      const error = validateProfileName(value, existingProfiles);
      setValidationError(error);
      if (!error) {
        onUpdateProfileName(value);
      }
    },
    [
      onUpdateProfileName,
      existingProfiles,
      setProfileNameInput,
      setValidationError,
    ],
  );

const useProfileNameSubmitHandler = (
  profileNameInput: string,
  validationError: string | null,
  state: WizardState,
  onContinue: () => void,
  setFocusedComponent: (v: 'input' | 'saving' | 'conflict') => void,
  setSaveError: (v: string | null) => void,
  setValidationError: (v: string | null) => void,
) =>
  useCallback(
    (forceSave: boolean = false) => {
      void (async () => {
        try {
          if (!profileNameInput.trim()) {
            setValidationError('Profile name cannot be empty');
            return;
          }
          if (validationError && !forceSave) {
            if (validationError === 'Profile name already exists') {
              setFocusedComponent('conflict');
              return;
            }
            return;
          }

          await executeSave(
            profileNameInput,
            state,
            forceSave,
            onContinue,
            setFocusedComponent,
            setSaveError,
            setValidationError,
          );
        } catch (error) {
          setSaveError(
            error instanceof Error ? error.message : 'Failed to save profile',
          );
          setFocusedComponent('input');
        }
      })();
    },
    [
      profileNameInput,
      validationError,
      state,
      onContinue,
      setFocusedComponent,
      setSaveError,
      setValidationError,
    ],
  );

const FocusedContentView: React.FC<{
  focusedComponent: 'input' | 'saving' | 'conflict';
  profileNameInput: string;
  saveError: string | null;
  validationError: string | null;
  suggestions: string[];
  handleProfileNameChange: (value: string) => void;
  handleProfileNameSubmit: (forceSave?: boolean) => void;
  handleConflictResolution: (value: string) => void;
}> = ({
  focusedComponent,
  profileNameInput,
  saveError,
  validationError,
  suggestions,
  handleProfileNameChange,
  handleProfileNameSubmit,
  handleConflictResolution,
}) => (
  <>
    {focusedComponent === 'saving' && (
      <Text color={Colors.Gray}>Saving profile...</Text>
    )}
    {focusedComponent === 'conflict' && (
      <ConflictDialog
        profileNameInput={profileNameInput}
        handleConflictResolution={handleConflictResolution}
      />
    )}
    {focusedComponent === 'input' && (
      <ProfileNameInput
        profileNameInput={profileNameInput}
        saveError={saveError}
        validationError={validationError}
        suggestions={suggestions}
        handleProfileNameChange={handleProfileNameChange}
        handleProfileNameSubmit={handleProfileNameSubmit}
      />
    )}
  </>
);

interface ProfileSaveStepProps {
  state: WizardState;
  onUpdateProfileName: (name: string) => void;
  onContinue: () => void;
  onBack: () => void;
  onCancel: () => void;
}

export const ProfileSaveStep: React.FC<ProfileSaveStepProps> = ({
  state,
  onUpdateProfileName,
  onContinue,
  onBack,
  onCancel,
}) => {
  const [focusedComponent, setFocusedComponent] = useState<
    'input' | 'saving' | 'conflict'
  >('input');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [profileNameInput, setProfileNameInput] = useState(
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing for empty-string profile name
    state.profileName || '',
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const existingProfiles = useExistingProfiles();

  const [suggestions] = useState(() =>
    generateProfileNameSuggestions(state.config),
  );

  useSaveEscapeHandler(focusedComponent, setFocusedComponent, onBack);

  const handleProfileNameChange = useProfileNameHandler(
    existingProfiles,
    onUpdateProfileName,
    setProfileNameInput,
    setValidationError,
  );

  const handleProfileNameSubmit = useProfileNameSubmitHandler(
    profileNameInput,
    validationError,
    state,
    onContinue,
    setFocusedComponent,
    setSaveError,
    setValidationError,
  );

  const handleConflictResolution = useCallback(
    (value: string) => {
      if (value === 'rename') {
        setFocusedComponent('input');
      } else if (value === 'overwrite') {
        setValidationError(null);
        handleProfileNameSubmit(true);
      } else if (value === 'back') {
        onBack();
      } else if (value === 'cancel') {
        onCancel();
      }
    },
    [onBack, onCancel, handleProfileNameSubmit],
  );

  const { current, total } = getStepPosition(state);

  return (
    <Box flexDirection="column">
      <Text bold color={Colors.AccentCyan}>
        Create New Profile - Step {current} of {total}
      </Text>
      <Text color={Colors.Foreground}> </Text>
      <Text color={Colors.Foreground}>Name Your Profile:</Text>
      <Text color={Colors.Gray}>Enter a name for this profile</Text>
      <Text color={Colors.Foreground}> </Text>
      <FocusedContentView
        focusedComponent={focusedComponent}
        profileNameInput={profileNameInput}
        saveError={saveError}
        validationError={validationError}
        suggestions={suggestions}
        handleProfileNameChange={handleProfileNameChange}
        handleProfileNameSubmit={handleProfileNameSubmit}
        handleConflictResolution={handleConflictResolution}
      />
    </Box>
  );
};
