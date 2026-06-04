/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Text, useIsScreenReaderEnabled } from 'ink';
import type { FC } from 'react';
import { useEffect, useState } from 'react';
import { useUIState } from '../contexts/UIStateContext.js';
import { theme } from '../semantic-colors.js';
import { Colors } from '../colors.js';
import { StreamingState } from '../types.js';
import { UpdateNotification } from './UpdateNotification.js';
import type { UpdateObject } from '../utils/updateCheck.js';
import type { HistoryItem } from '../types.js';
import { Storage, debugLogger } from '@vybestack/llxprt-code-core';

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

function useScreenReaderNudge(
  isScreenReaderEnabled: boolean,
): [boolean | undefined, () => void] {
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
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    checkScreenReaderNudge();
  }, []);

  useEffect(() => {
    const writeScreenReaderNudgeFile = async () => {
      if (isScreenReaderEnabled && hasSeenScreenReaderNudge === false) {
        try {
          await fs.mkdir(path.dirname(screenReaderNudgeFilePath), {
            recursive: true,
          });
          await fs.writeFile(screenReaderNudgeFilePath, 'true');
        } catch (error) {
          debugLogger.error('Error storing screen reader nudge', error);
        }
      }
    };
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    writeScreenReaderNudgeFile();
  }, [isScreenReaderEnabled, hasSeenScreenReaderNudge]);

  return [hasSeenScreenReaderNudge, () => setHasSeenScreenReaderNudge(true)];
}

const ScreenReaderNudge: FC = () => (
  <Text color={Colors.Foreground}>
    You are currently in screen reader-friendly view. To switch out, open{' '}
    {settingsPath} and remove the entry for {'"screenReader"'}. This will
    disappear on next run.
  </Text>
);

interface StartupWarningsBoxProps {
  warnings: string[];
}

const StartupWarningsBox: FC<StartupWarningsBoxProps> = ({ warnings }) => (
  <Box
    borderStyle="round"
    borderColor={theme.status.warning}
    paddingX={1}
    marginY={1}
    flexDirection="column"
  >
    {warnings.map((warning, index) => (
      <Text key={index} color={theme.status.warning}>
        {warning}
      </Text>
    ))}
  </Box>
);

interface InitErrorBoxProps {
  initError: string;
  history: HistoryItem[];
}

const InitErrorBox: FC<InitErrorBoxProps> = ({ initError, history }) => {
  const matchingHistoryError = history.find(
    (item) => item.type === 'error' && item.text.includes(initError),
  );

  if (matchingHistoryError?.text) {
    return (
      <Box
        borderStyle="round"
        borderColor={theme.status.error}
        paddingX={1}
        marginBottom={1}
      >
        <Text color={theme.status.error}>{matchingHistoryError.text}</Text>
      </Box>
    );
  }

  return (
    <Box
      borderStyle="round"
      borderColor={theme.status.error}
      paddingX={1}
      marginBottom={1}
    >
      <Text color={theme.status.error}>Initialization Error: {initError}</Text>
      <Text color={theme.status.error}>
        {' '}
        Please check API key and configuration.
      </Text>
    </Box>
  );
};

export const Notifications: FC<NotificationsProps> = ({
  startupWarnings,
  updateInfo,
  history,
}) => {
  const { initError, streamingState } = useUIState();
  const isScreenReaderEnabled = useIsScreenReaderEnabled();
  const [hasSeenScreenReaderNudge] = useScreenReaderNudge(
    isScreenReaderEnabled,
  );

  const showStartupWarnings = startupWarnings.length > 0;
  const showInitError =
    initError != null && streamingState !== StreamingState.Responding;
  const showScreenReaderNudge =
    isScreenReaderEnabled && hasSeenScreenReaderNudge === false;

  if (
    !showStartupWarnings &&
    !showInitError &&
    updateInfo == null &&
    !showScreenReaderNudge
  ) {
    return null;
  }

  return (
    <>
      {showScreenReaderNudge && <ScreenReaderNudge />}
      {updateInfo && <UpdateNotification message={updateInfo.message} />}
      {showStartupWarnings && <StartupWarningsBox warnings={startupWarnings} />}
      {showInitError && (
        <InitErrorBox initError={initError} history={history} />
      )}
    </>
  );
};
