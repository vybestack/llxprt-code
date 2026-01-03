/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback } from 'react';
import { Box } from 'ink';
import { Colors } from '../../colors.js';
import { useKeypress } from '../../hooks/useKeypress.js';
import { WelcomeStep, type WelcomeChoice } from './WelcomeStep.js';
import { ProviderSelectStep } from './ProviderSelectStep.js';
import { AuthMethodStep } from './AuthMethodStep.js';
import { AuthenticationStep } from './AuthenticationStep.js';
import { CompletionStep } from './CompletionStep.js';
import { SkipExitStep } from './SkipExitStep.js';
import type {
  WelcomeState,
  WelcomeActions,
} from '../../hooks/useWelcomeOnboarding.js';

interface WelcomeDialogProps {
  state: WelcomeState;
  actions: WelcomeActions;
  availableProviders: string[];
  triggerAuth: (
    provider: string,
    method: 'oauth' | 'api_key',
    apiKey?: string,
  ) => Promise<void>;
}

export const WelcomeDialog: React.FC<WelcomeDialogProps> = ({
  state,
  actions,
  availableProviders,
  triggerAuth,
}) => {
  // Handle global escape to skip (except during auth)
  useKeypress(
    (key) => {
      if (key.name === 'escape' && !state.authInProgress) {
        actions.skipSetup();
      }
    },
    { isActive: state.step !== 'completion' && state.step !== 'skipped' },
  );

  const handleWelcomeSelect = useCallback(
    (choice: WelcomeChoice) => {
      if (choice === 'setup') {
        actions.startSetup();
      } else {
        actions.skipSetup();
      }
    },
    [actions],
  );

  const renderStep = () => {
    switch (state.step) {
      case 'welcome':
        return <WelcomeStep onSelect={handleWelcomeSelect} />;

      case 'provider':
        return (
          <ProviderSelectStep
            providers={availableProviders}
            onSelect={actions.selectProvider}
            onSkip={actions.skipSetup}
          />
        );

      case 'auth_method':
        return (
          <AuthMethodStep
            provider={state.selectedProvider!}
            onSelect={actions.selectAuthMethod}
            onBack={actions.goBack}
            error={state.error}
          />
        );

      case 'authenticating':
        return (
          <AuthenticationStep
            provider={state.selectedProvider!}
            method={state.selectedAuthMethod!}
            onComplete={actions.onAuthComplete}
            onError={actions.onAuthError}
            onBack={actions.goBack}
            triggerAuth={triggerAuth}
          />
        );

      case 'completion':
        return (
          <CompletionStep
            provider={state.selectedProvider!}
            authMethod={state.selectedAuthMethod!}
            onSaveProfile={actions.saveProfile}
            onDismiss={actions.dismiss}
          />
        );

      case 'skipped':
        return <SkipExitStep onDismiss={actions.dismiss} />;

      default:
        return null;
    }
  };

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={Colors.AccentCyan}
      padding={1}
      width="100%"
      marginLeft={1}
    >
      {renderStep()}
    </Box>
  );
};
