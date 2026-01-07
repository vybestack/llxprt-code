/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../../colors.js';
import { useKeypress } from '../../hooks/useKeypress.js';

interface CompletionStepProps {
  provider: string;
  model?: string;
  authMethod: 'oauth' | 'api_key';
  onSaveProfile: (name: string) => Promise<void>;
  onDismiss: () => void;
  isFocused?: boolean;
}

export const CompletionStep: React.FC<CompletionStepProps> = ({
  provider,
  model,
  authMethod,
  onSaveProfile,
  onDismiss,
  isFocused = true,
}) => {
  const [showProfilePrompt, setShowProfilePrompt] = useState(true);
  const [profileName, setProfileName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const providerDisplay = provider.charAt(0).toUpperCase() + provider.slice(1);
  const authDisplay = authMethod === 'oauth' ? 'OAuth' : 'API Key';

  const handleProfileSubmit = useCallback(async () => {
    const trimmedName = profileName.trim();
    if (!trimmedName) {
      setError('Profile name is required');
      return;
    }

    setSaving(true);
    setError(undefined);

    try {
      await onSaveProfile(trimmedName);
      setShowProfilePrompt(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save profile');
      setSaving(false);
    }
  }, [profileName, onSaveProfile]);

  // Handle keyboard input
  useKeypress(
    (key) => {
      if (key.name === 'return') {
        if (showProfilePrompt && !saving) {
          handleProfileSubmit();
        } else if (!showProfilePrompt) {
          onDismiss();
        }
        return;
      }

      // Only accept input in profile prompt mode
      if (!showProfilePrompt || saving) {
        return;
      }

      if (key.name === 'backspace' || key.name === 'delete') {
        setProfileName((prev) => prev.slice(0, -1));
        return;
      }

      // Accept printable characters (including paste - multi-char sequences)
      const char = key.sequence;
      if (char && !key.ctrl && !key.meta) {
        // Filter to only printable ASCII characters
        const printable = char.replace(/[^\x20-\x7E]/g, '');
        if (printable) {
          setProfileName((prev) => prev + printable);
        }
      }
    },
    { isActive: isFocused },
  );

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.AccentCyan}>
          Step 5 of 5: Save Your Profile
        </Text>
        <Text color={Colors.Foreground}> </Text>
        <Text bold color={Colors.AccentGreen}>
          {'[OK] Authentication complete!'}
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color={Colors.Foreground}>Provider: {providerDisplay}</Text>
        {model && <Text color={Colors.Foreground}>Model: {model}</Text>}
        <Text color={Colors.Foreground}>Authentication: {authDisplay}</Text>
      </Box>

      {showProfilePrompt ? (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text bold color={Colors.Foreground}>
              Save this setup as a profile
            </Text>
          </Box>

          <Text color={Colors.Gray}>
            This profile will be loaded automatically on startup.
          </Text>
          <Text color={Colors.Gray}>
            Use /profile load &lt;name&gt; to switch profiles later.
          </Text>

          <Box marginTop={1} flexDirection="column">
            {error && (
              <Box marginBottom={1}>
                <Text color={Colors.AccentRed}>{error}</Text>
              </Box>
            )}

            {saving ? (
              <Text color={Colors.Foreground}>Saving profile...</Text>
            ) : (
              <Box>
                <Text color={Colors.Foreground}>Profile name: </Text>
                <Text color={Colors.Foreground}>{profileName}</Text>
                <Text color={Colors.AccentCyan}>▌</Text>
              </Box>
            )}
          </Box>

          <Box marginTop={1}>
            <Text color={Colors.Gray}>
              Enter a name and press Enter to save
            </Text>
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text color={Colors.Foreground}>Try asking me something like:</Text>
            <Text color={Colors.AccentCyan}>
              {'"Explain how async/await works in JavaScript"'}
            </Text>
          </Box>

          <Box marginTop={1}>
            <Text color={Colors.Gray}>Press Enter to continue...</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};
