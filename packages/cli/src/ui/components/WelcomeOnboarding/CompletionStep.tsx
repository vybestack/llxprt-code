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
  authMethod: 'oauth' | 'api_key';
  onSaveProfile: (name: string) => Promise<void>;
  onDismiss: () => void;
  isFocused?: boolean;
}

export const CompletionStep: React.FC<CompletionStepProps> = ({
  provider,
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
    if (!profileName.trim()) {
      setShowProfilePrompt(false);
      return;
    }

    setSaving(true);
    setError(undefined);

    try {
      await onSaveProfile(profileName.trim());
      setShowProfilePrompt(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save profile');
      setSaving(false);
    }
  }, [profileName, onSaveProfile]);

  // Handle keyboard input
  useKeypress(
    (key) => {
      if (key.name === 'escape' && showProfilePrompt && !saving) {
        setShowProfilePrompt(false);
        return;
      }

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

      // Only accept printable characters
      const char = key.sequence;
      if (
        char &&
        char.length === 1 &&
        !key.ctrl &&
        !key.meta &&
        key.insertable
      ) {
        setProfileName((prev) => prev + char);
      }
    },
    { isActive: isFocused },
  );

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.AccentGreen}>
          {"✓ You're all set!"}
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text>Provider: {providerDisplay}</Text>
        <Text>Authentication: {authDisplay}</Text>
      </Box>

      {showProfilePrompt ? (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text bold>Save this setup as a profile? (optional)</Text>
          </Box>

          <Text color={Colors.Gray}>
            Profiles let you quickly switch between configurations.
          </Text>
          <Text color={Colors.Gray}>
            Use /profile load &lt;name&gt; to restore this setup later.
          </Text>

          <Box marginTop={1} flexDirection="column">
            {error && (
              <Box marginBottom={1}>
                <Text color={Colors.AccentRed}>{error}</Text>
              </Box>
            )}

            {saving ? (
              <Text>Saving profile...</Text>
            ) : (
              <Box>
                <Text>Profile name: </Text>
                <Text>{profileName}</Text>
                <Text color={Colors.AccentCyan}>▌</Text>
              </Box>
            )}
          </Box>

          <Box marginTop={1}>
            <Text color={Colors.Gray}>
              Enter a name and press Enter to save, or Esc to skip
            </Text>
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text>Try asking me something like:</Text>
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
