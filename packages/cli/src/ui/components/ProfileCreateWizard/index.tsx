/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../../colors.js';
import { RadioButtonSelect } from '../shared/RadioButtonSelect.js';
import { WizardStep, type WizardState } from './types.js';
import { getNextStep, getPreviousStep } from './utils.js';
import { ProviderSelectStep } from './ProviderSelectStep.js';
import { BaseUrlConfigStep } from './BaseUrlConfigStep.js';
import { ModelSelectStep } from './ModelSelectStep.js';
import { AuthenticationStep } from './AuthenticationStep.js';
import { AdvancedParamsStep } from './AdvancedParamsStep.js';
import { ProfileSaveStep } from './ProfileSaveStep.js';
import { ProfileSuccessSummary } from './ProfileSuccessSummary.js';

interface ProfileCreateWizardProps {
  onClose: () => void;
  onLoadProfile?: (profileName: string) => void;
  availableProviders?: string[];
}

export const ProfileCreateWizard: React.FC<ProfileCreateWizardProps> = ({
  onClose,
  onLoadProfile,
  availableProviders,
}) => {
  const [state, setState] = useState<WizardState>({
    currentStep: WizardStep.PROVIDER_SELECT,
    stepHistory: [WizardStep.PROVIDER_SELECT],
    config: {
      provider: null,
      model: null,
      auth: {
        type: null,
      },
    },
    validationErrors: {},
    skipValidation: false,
  });
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const navigateToStep = useCallback((nextStep: WizardStep) => {
    setState((prev) => ({
      ...prev,
      currentStep: nextStep,
      stepHistory: [...prev.stepHistory, nextStep],
    }));
  }, []);

  const goBack = useCallback(() => {
    setState((prev) => {
      const prevStep = getPreviousStep(prev);
      return {
        ...prev,
        currentStep: prevStep,
        stepHistory: prev.stepHistory.slice(0, -1),
      };
    });
  }, []);

  const handleContinue = useCallback(() => {
    const nextStep = getNextStep(state.currentStep, state);
    navigateToStep(nextStep);
  }, [state, navigateToStep]);

  const handleCancel = useCallback(() => {
    // If no config entered yet (still on first step with no provider), exit immediately
    if (
      state.currentStep === WizardStep.PROVIDER_SELECT &&
      !state.config.provider
    ) {
      onClose();
      return;
    }

    // Show confirmation dialog
    setShowCancelConfirm(true);
  }, [state.currentStep, state.config.provider, onClose]);

  const handleCancelConfirm = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleCancelResume = useCallback(() => {
    setShowCancelConfirm(false);
  }, []);

  const handleCancelDialogSelect = useCallback(
    (value: string) => {
      if (value === 'confirm') {
        handleCancelConfirm();
      } else {
        handleCancelResume();
      }
    },
    [handleCancelConfirm, handleCancelResume],
  );

  const updateConfig = useCallback(
    <K extends keyof WizardState['config']>(
      key: K,
      value: WizardState['config'][K],
    ) => {
      setState((prev) => ({
        ...prev,
        config: {
          ...prev.config,
          [key]: value,
        },
      }));
    },
    [],
  );

  const handleUpdateProvider = useCallback((provider: string) => {
    // Navigate based on the new provider value
    setState((prev) => {
      const newConfig = { ...prev.config, provider };
      const tempState = { ...prev, config: newConfig };
      const nextStep = getNextStep(WizardStep.PROVIDER_SELECT, tempState);
      return {
        ...prev,
        config: newConfig,
        currentStep: nextStep,
        stepHistory: [...prev.stepHistory, nextStep],
      };
    });
  }, []);

  const handleUpdateBaseUrl = useCallback(
    (baseUrl: string) => updateConfig('baseUrl', baseUrl),
    [updateConfig],
  );

  const handleUpdateModel = useCallback(
    (model: string) => updateConfig('model', model),
    [updateConfig],
  );

  const handleUpdateAuth = useCallback(
    (auth: WizardState['config']['auth']) => updateConfig('auth', auth),
    [updateConfig],
  );

  const handleUpdateParams = useCallback(
    (params: WizardState['config']['params']) => updateConfig('params', params),
    [updateConfig],
  );

  const handleUpdateProfileName = useCallback((name: string) => {
    setState((prev) => ({ ...prev, profileName: name }));
  }, []);

  // Render current step
  const renderStep = () => {
    switch (state.currentStep) {
      case WizardStep.PROVIDER_SELECT:
        return (
          <ProviderSelectStep
            state={state}
            onUpdateProvider={handleUpdateProvider}
            onCancel={handleCancel}
            availableProviders={availableProviders}
          />
        );

      case WizardStep.BASE_URL_CONFIG:
        return (
          <BaseUrlConfigStep
            state={state}
            onUpdateBaseUrl={handleUpdateBaseUrl}
            onContinue={handleContinue}
            onBack={goBack}
          />
        );

      case WizardStep.MODEL_SELECT:
        return (
          <ModelSelectStep
            state={state}
            onUpdateModel={handleUpdateModel}
            onContinue={handleContinue}
            onBack={goBack}
            onCancel={handleCancel}
          />
        );

      case WizardStep.AUTHENTICATION:
        return (
          <AuthenticationStep
            state={state}
            onUpdateAuth={handleUpdateAuth}
            onContinue={handleContinue}
            onBack={goBack}
            onCancel={handleCancel}
          />
        );

      case WizardStep.ADVANCED_PARAMS:
        return (
          <AdvancedParamsStep
            state={state}
            onUpdateParams={handleUpdateParams}
            onContinue={handleContinue}
            onBack={goBack}
            onCancel={handleCancel}
          />
        );

      case WizardStep.SAVE_PROFILE:
        return (
          <ProfileSaveStep
            state={state}
            onUpdateProfileName={handleUpdateProfileName}
            onContinue={handleContinue}
            onBack={goBack}
            onCancel={handleCancel}
          />
        );

      case WizardStep.SUCCESS_SUMMARY:
        return (
          <ProfileSuccessSummary
            state={state}
            onClose={onClose}
            onLoadProfile={onLoadProfile}
          />
        );

      default:
        return <Text color={Colors.Foreground}>Unknown step</Text>;
    }
  };

  // Render cancel confirmation dialog if needed
  if (showCancelConfirm) {
    return (
      <Box
        borderStyle="round"
        borderColor={Colors.Gray}
        flexDirection="column"
        padding={1}
      >
        <Text bold color={Colors.AccentYellow}>
          Cancel Profile Creation?
        </Text>
        <Text color={Colors.Foreground}> </Text>
        <Text color={Colors.Foreground}>Your configuration will be lost:</Text>
        {state.config.provider && (
          <Text color={Colors.Gray}> • Provider: {state.config.provider}</Text>
        )}
        {state.config.model && (
          <Text color={Colors.Gray}> • Model: {state.config.model}</Text>
        )}
        {state.config.baseUrl && (
          <Text color={Colors.Gray}> • Base URL: {state.config.baseUrl}</Text>
        )}
        <Text color={Colors.Foreground}> </Text>
        <Text color={Colors.Foreground}>Are you sure you want to cancel?</Text>
        <Text color={Colors.Foreground}> </Text>
        <RadioButtonSelect
          items={[
            {
              label: 'No, continue editing',
              value: 'resume',
              key: 'resume',
            },
            {
              label: 'Yes, discard and exit',
              value: 'confirm',
              key: 'confirm',
            },
          ]}
          onSelect={handleCancelDialogSelect}
          isFocused={true}
        />
      </Box>
    );
  }

  return (
    <Box
      borderStyle="round"
      borderColor={Colors.Gray}
      flexDirection="column"
      padding={1}
    >
      {renderStep()}
    </Box>
  );
};
