/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useEffect } from 'react';
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
    state.profileName || '',
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const [existingProfiles, setExistingProfiles] = useState<string[]>([]);

  // Generate name suggestions on mount
  const [suggestions] = useState(() =>
    generateProfileNameSuggestions(state.config),
  );

  // Handle Escape key to go back
  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        if (focusedComponent === 'input') {
          // Go back to previous step
          onBack();
        } else if (focusedComponent === 'conflict') {
          // Go back to input from conflict dialog
          setFocusedComponent('input');
        }
        // Don't allow escape during saving
      }
    },
    { isActive: true },
  );

  // Load existing profiles on mount
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
        // Directory might not exist yet
        setExistingProfiles([]);
      }
    };
    loadExistingProfiles();
  }, []);

  const handleProfileNameChange = useCallback(
    (value: string) => {
      setProfileNameInput(value);

      if (!value.trim()) {
        setValidationError('Profile name cannot be empty');
        return;
      }

      // Basic validation (async validation happens on submit)
      if (value.includes('/') || value.includes('\\')) {
        setValidationError('Profile name cannot contain path separators');
        return;
      }

      // Check for conflicts (best-effort early validation for UX)
      // Note: Filesystem is the final source of truth via atomic save operation
      if (existingProfiles.includes(value)) {
        setValidationError('Profile name already exists');
        return;
      }

      setValidationError(null);
      onUpdateProfileName(value);
    },
    [onUpdateProfileName, existingProfiles],
  );

  const handleProfileNameSubmit = useCallback(
    async (forceSave: boolean = false) => {
      if (!profileNameInput.trim()) {
        setValidationError('Profile name cannot be empty');
        return;
      }
      if (validationError && !forceSave) {
        // If the only error is "already exists", show conflict dialog
        if (validationError === 'Profile name already exists') {
          setFocusedComponent('conflict');
          return;
        }
        return;
      }

      // Save immediately
      setFocusedComponent('saving');
      setSaveError(null);

      const profileJSON = buildProfileJSON(state);
      // Atomic save operation - filesystem is source of truth for conflicts
      // Uses 'wx' flag by default to prevent overwrite unless forceSave=true
      const result = await saveProfile(profileNameInput, profileJSON, {
        overwrite: forceSave,
      });

      if (result.success) {
        onContinue();
      } else if (result.alreadyExists) {
        // Filesystem reports file exists - show conflict dialog
        // This catches stale existingProfiles or race conditions
        setValidationError('Profile name already exists');
        setFocusedComponent('conflict');
      } else {
        setSaveError(result.error || 'Failed to save profile');
        setFocusedComponent('input');
      }
    },
    [profileNameInput, validationError, state, onContinue],
  );

  const handleConflictResolution = useCallback(
    (value: string) => {
      if (value === 'rename') {
        setFocusedComponent('input');
      } else if (value === 'overwrite') {
        // Clear validation error and force save
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

      {focusedComponent === 'input' && (
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
          <Text color={Colors.Gray}>
            ← → Move cursor Enter Continue Esc Back
          </Text>
        </>
      )}

      {focusedComponent === 'saving' && (
        <Text color={Colors.Gray}>Saving profile...</Text>
      )}

      {focusedComponent === 'conflict' && (
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
      )}
    </Box>
  );
};
