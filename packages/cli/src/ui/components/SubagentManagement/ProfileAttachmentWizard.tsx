/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useMemo } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../../colors.js';
import { useKeypress } from '../../hooks/useKeypress.js';
import type { SubagentInfo } from './types.js';

interface ProfileInfo {
  name: string;
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

interface ProfileAttachmentWizardProps {
  subagent: SubagentInfo;
  profiles: string[];
  getProfileInfo?: (profileName: string) => Promise<ProfileInfo | null>;
  onConfirm: (profileName: string) => Promise<void>;
  onCancel: () => void;
  isFocused?: boolean;
}

export const ProfileAttachmentWizard: React.FC<
  ProfileAttachmentWizardProps
> = ({
  subagent,
  profiles,
  getProfileInfo,
  onConfirm,
  onCancel,
  isFocused = true,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(() => {
    // Start at current profile if found
    const idx = profiles.indexOf(subagent.profile);
    return idx >= 0 ? idx : 0;
  });
  const [previewInfo, setPreviewInfo] = useState<ProfileInfo | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Current selection
  const selectedProfile = profiles[selectedIndex] || '';

  // Load profile info when selection changes
  React.useEffect(() => {
    let cancelled = false;
    if (getProfileInfo && selectedProfile) {
      getProfileInfo(selectedProfile)
        .then((info) => {
          if (!cancelled) setPreviewInfo(info);
        })
        .catch(() => {
          if (!cancelled) setPreviewInfo(null);
        });
    } else {
      if (!cancelled) setPreviewInfo(null);
    }
    return () => {
      cancelled = true;
    };
  }, [selectedProfile, getProfileInfo]);

  const moveSelection = useCallback(
    (delta: number) => {
      setSelectedIndex((prev) => {
        let newIndex = prev + delta;
        if (newIndex < 0) newIndex = 0;
        if (newIndex >= profiles.length) newIndex = profiles.length - 1;
        return newIndex;
      });
    },
    [profiles.length],
  );

  const handleConfirm = useCallback(async () => {
    if (!selectedProfile) return;

    setIsConfirming(true);
    setError(null);
    try {
      await onConfirm(selectedProfile);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to attach profile');
      setIsConfirming(false);
    }
  }, [selectedProfile, onConfirm]);

  useKeypress(
    (key) => {
      if (isConfirming) return;

      if (key.name === 'escape') {
        onCancel();
        return;
      }

      if (key.name === 'up') {
        moveSelection(-1);
        return;
      }
      if (key.name === 'down') {
        moveSelection(1);
        return;
      }

      if (key.name === 'return') {
        handleConfirm();
        return;
      }
    },
    { isActive: isFocused && !isConfirming },
  );

  // Calculate visible profiles (viewport)
  const maxVisible = 6;
  const startIndex = useMemo(
    () => Math.max(0, selectedIndex - Math.floor(maxVisible / 2)),
    [selectedIndex],
  );
  const endIndex = Math.min(profiles.length, startIndex + maxVisible);
  const visibleProfiles = profiles.slice(startIndex, endIndex);

  if (profiles.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color={Colors.Foreground}>
          No profiles available. Create a profile first.
        </Text>
        <Box marginTop={1}>
          <Text color={Colors.Gray}>[ESC] Cancel</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold color={Colors.Foreground}>
        Attach Profile to: {subagent.name}
      </Text>
      <Text color={Colors.Gray}>
        ──────────────────────────────────────────────────────
      </Text>

      {error && (
        <Box marginBottom={1}>
          <Text color="#ff0000">{error}</Text>
        </Box>
      )}

      {/* Profile Selection */}
      <Box marginY={1}>
        <Text color={Colors.Foreground}>
          Profile Selection (showing {startIndex + 1}-{endIndex} of{' '}
          {profiles.length}):
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        {visibleProfiles.map((profile, idx) => {
          const actualIndex = startIndex + idx;
          const isSelected = actualIndex === selectedIndex;
          const isCurrent = profile === subagent.profile;
          return (
            <Box key={profile}>
              <Text color={isSelected ? '#00ff00' : Colors.Foreground}>
                {isSelected ? '→ ' : '  '}
                {profile}
              </Text>
              {isCurrent && <Text color={Colors.Gray}> (current)</Text>}
            </Box>
          );
        })}
      </Box>

      {/* Live Preview */}
      <Box flexDirection="column" marginY={1}>
        <Text bold color={Colors.Foreground}>
          Selected Profile Preview:
        </Text>
        <Text color={Colors.Gray}>
          ──────────────────────────────────────────────────────
        </Text>
        {previewInfo ? (
          <>
            {previewInfo.provider && (
              <Box>
                <Text color={Colors.Gray}>Provider: </Text>
                <Text color={Colors.Foreground}>{previewInfo.provider}</Text>
              </Box>
            )}
            {previewInfo.model && (
              <Box>
                <Text color={Colors.Gray}>Model: </Text>
                <Text color={Colors.Foreground}>{previewInfo.model}</Text>
              </Box>
            )}
            {previewInfo.temperature !== undefined && (
              <Box>
                <Text color={Colors.Gray}>Temperature: </Text>
                <Text color={Colors.Foreground}>{previewInfo.temperature}</Text>
              </Box>
            )}
            {previewInfo.maxTokens !== undefined && (
              <Box>
                <Text color={Colors.Gray}>Max Tokens: </Text>
                <Text color={Colors.Foreground}>{previewInfo.maxTokens}</Text>
              </Box>
            )}
          </>
        ) : (
          <Text color={Colors.Gray}>Profile: {selectedProfile}</Text>
        )}
      </Box>

      {/* Controls */}
      <Box marginTop={1}>
        <Text color={Colors.Gray}>
          Controls: ↑↓ Navigate [Enter] Confirm [ESC] Cancel
        </Text>
      </Box>

      {isConfirming && (
        <Box marginTop={1}>
          <Text color={Colors.Gray}>Attaching profile...</Text>
        </Box>
      )}
    </Box>
  );
};
