/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useCallback } from 'react';
import { Box, Text, useStdin } from 'ink';
import { useSettings } from '../contexts/SettingsContext.js';
import type { LoadedSettings } from '../../config/settings.js';

interface WelcomeScreenProps {
  onDismiss: () => void;
  onOpenConfig: () => void;
  onOpenDocs: () => void;
  onOpenTutorials: () => void;
  onGoogleAuth: () => void;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  onDismiss,
  onOpenConfig,
  onOpenDocs,
  onOpenTutorials,
  onGoogleAuth,
}) => {
  const { stdin, setRawMode } = useStdin();

  const handleKeypress = useCallback(
    (data: string) => {
      switch (data.toLowerCase()) {
        case 'g':
          onGoogleAuth();
          onDismiss();
          break;
        case 'c':
          onOpenConfig();
          onDismiss();
          break;
        case 'd':
          onOpenDocs();
          onDismiss();
          break;
        case 't':
          onOpenTutorials();
          onDismiss();
          break;
        case 'escape':
        case 'esc':
        case 'enter':
        case 'return':
        case ' ':
        case 'q':
          onDismiss();
          break;
        default:
          // Ignore unhandled keys
          break;
      }
    },
    [onDismiss, onOpenConfig, onOpenDocs, onOpenTutorials, onGoogleAuth],
  );

  useEffect(() => {
    setRawMode(true);

    const handleInput = (data: Buffer) => {
      const input = data.toString();
      handleKeypress(input);
    };

    stdin?.on('data', handleInput);

    return () => {
      setRawMode(false);
      stdin?.off('data', handleInput);
    };
  }, [stdin, handleKeypress, setRawMode]);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="green"
      padding={2}
      width={80}
      height={30}
      justifyContent="center"
      alignItems="center"
    >
      <Box flexDirection="column" alignItems="center">
        <Text bold color="green" underline>
          Welcome to LLxprt Code!
        </Text>

        <Text> </Text>

        <Box flexDirection="column" alignItems="center">
          <Text>
            You&apos;re ready to start using LLxprt Code. Here are the essential
          </Text>
          <Text>commands to get you going:</Text>
        </Box>

        <Text> </Text>
        <Text> </Text>

        <Box flexDirection="column" alignItems="flex-start">
          <Text>
            <Text bold color="yellow">
              G
            </Text>{' '}
            - Configure Google authentication
          </Text>
          <Text>
            <Text bold color="yellow">
              C
            </Text>{' '}
            - Open API key configuration
          </Text>
          <Text>
            <Text bold color="yellow">
              D
            </Text>{' '}
            - View documentation
          </Text>
          <Text>
            <Text bold color="yellow">
              T
            </Text>{' '}
            - Browse tutorials
          </Text>
        </Box>

        <Text> </Text>
        <Text> </Text>

        <Text>
          <Text bold dimColor>
            Press any key above, or ESC/Enter/Space/Q to dismiss
          </Text>
        </Text>

        <Text> </Text>
        <Text> </Text>

        <Box flexDirection="column" alignItems="flex-start">
          <Text dimColor>Quick Setup Commands:</Text>
          <Text dimColor>
            • /g <Text dimColor># Google auth setup</Text>
          </Text>
          <Text dimColor>
            • /set api_key=<Text dimColor>your-key</Text>{' '}
            <Text dimColor># Configure provider</Text>
          </Text>
          <Text dimColor>
            • /profile save {'<name>'}{' '}
            <Text dimColor># Save configuration</Text>
          </Text>
        </Box>

        <Text> </Text>

        <Text dimColor color="cyan">
          Ask a question or type /help for more commands
        </Text>
      </Box>
    </Box>
  );
};

/**
 * Hook to determine if welcome screen should be shown
 */
export const useShowWelcomeScreen = (): boolean => {
  const settings = useSettings() as ExtendedSettings;

  // Show welcome screen if no provider API keys are configured
  // and welcome screen hasn't been dismissed before
  const providerApiKeys = settings.providerApiKeys || {};
  const hasProviderKeys =
    providerApiKeys &&
    Object.keys(providerApiKeys).length > 0 &&
    Object.values(providerApiKeys).some(
      (key: string) => key && key.trim() !== '',
    );

  const wasPreviouslyShown = settings.welcomeScreenShown === true;

  return !wasPreviouslyShown && !hasProviderKeys;
};

/**
 * Hook to mark welcome screen as shown
 */
// Settings schema extension to include welcomeScreenShown
interface ExtendedSettings extends LoadedSettings {
  providerApiKeys?: Record<string, string>;
  welcomeScreenShown?: boolean;
  setSettings?: (settings: Partial<LoadedSettings>) => void;
}

/**
 * Hook to mark welcome screen as shown
 */
export const useMarkWelcomeScreenShown = () => {
  const settings = useSettings() as ExtendedSettings;

  return useCallback(() => {
    // This will be implemented when we have access to settings update functionality
    // For now, we assume the settings will be updated elsewhere
    if (settings.setSettings) {
      settings.setSettings({
        welcomeScreenShown: true,
      } as Partial<LoadedSettings>);
    }
  }, [settings]);
};
