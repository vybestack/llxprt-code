/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Text, useIsScreenReaderEnabled } from 'ink';
import { useEffect, useState } from 'react';
import { useUIState } from '../contexts/UIStateContext.js';
import { theme } from '../semantic-colors.js';
import { Colors } from '../colors.js';
import { StreamingState } from '../types.js';
import { UpdateNotification } from './UpdateNotification.js';
import type { UpdateObject } from '../utils/updateCheck.js';
import type { HistoryItem } from '../types.js';
import { Storage } from '@vybestack/llxprt-code-core';

import * as fs from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const settingsPath = path.join(homedir(), '.llxprt-code', 'settings.json');

const screenReaderNudgeFilePath = path.join(
  Storage.getGlobalTempDir(),
  'seen_screen_reader_nudge.json',
);

interface NotificationsProps {
  startupWarnings: string[];
  updateInfo: UpdateObject | null;
  history: HistoryItem[];
}

export const Notifications = ({
  startupWarnings,
  updateInfo,
  history,
}: NotificationsProps) => {
  const { initError, streamingState } = useUIState();
  const isScreenReaderEnabled = useIsScreenReaderEnabled();
  const showStartupWarnings = startupWarnings.length > 0;
  const showInitError =
    initError && streamingState !== StreamingState.Responding;

  const [hasSeenScreenReaderNudge, setHasSeenScreenReaderNudge] = useState<
    boolean | undefined
  >(undefined);

  useEffect(() => {
    const checkScreenReaderNudge = async () => {
      try {
        await fs.access(screenReaderNudgeFilePath);
        setHasSeenScreenReaderNudge(true);
      } catch {
        setHasSeenScreenReaderNudge(false);
      }
    };
    checkScreenReaderNudge();
  }, []);

  const showScreenReaderNudge =
    isScreenReaderEnabled && hasSeenScreenReaderNudge === false;

  useEffect(() => {
    const writeScreenReaderNudgeFile = async () => {
      if (showScreenReaderNudge) {
        try {
          await fs.mkdir(path.dirname(screenReaderNudgeFilePath), {
            recursive: true,
          });
          await fs.writeFile(screenReaderNudgeFilePath, 'true');
        } catch (error) {
          console.error('Error storing screen reader nudge', error);
        }
      }
    };
    writeScreenReaderNudgeFile();
  }, [showScreenReaderNudge]);

  if (
    !showStartupWarnings &&
    !showInitError &&
    !updateInfo &&
    !showScreenReaderNudge
  ) {
    return null;
  }

  return (
    <>
      {showScreenReaderNudge && (
        <Text color={Colors.Foreground}>
          You are currently in screen reader-friendly view. To switch out, open{' '}
          {settingsPath} and remove the entry for {'"screenReader"'}. This will
          disappear on next run.
        </Text>
      )}
      {updateInfo && <UpdateNotification message={updateInfo.message} />}
      {showStartupWarnings && (
        <Box
          borderStyle="round"
          borderColor={theme.status.warning}
          paddingX={1}
          marginY={1}
          flexDirection="column"
        >
          {startupWarnings.map((warning, index) => (
            <Text key={index} color={theme.status.warning}>
              {warning}
            </Text>
          ))}
        </Box>
      )}
      {showInitError && (
        <Box
          borderStyle="round"
          borderColor={theme.status.error}
          paddingX={1}
          marginBottom={1}
        >
          {(() => {
            const matchingHistoryError = history.find(
              (item) => item.type === 'error' && item.text?.includes(initError),
            );
            if (matchingHistoryError?.text) {
              return (
                <Text color={theme.status.error}>
                  {matchingHistoryError.text}
                </Text>
              );
            }
            return (
              <>
                <Text color={theme.status.error}>
                  Initialization Error: {initError}
                </Text>
                <Text color={theme.status.error}>
                  {' '}
                  Please check API key and configuration.
                </Text>
              </>
            );
          })()}
        </Box>
      )}
    </>
  );
};
