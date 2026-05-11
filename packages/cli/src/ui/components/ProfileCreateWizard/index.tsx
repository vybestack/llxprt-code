/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useState, useCallback } from 'react';
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

const INITIAL_STATE: WizardState = {
  currentStep: WizardStep.PROVIDER_SELECT,
  stepHistory: [WizardStep.PROVIDER_SELECT],
  config: { provider: null, model: null, auth: { type: null } },
  validationErrors: {},
  skipValidation: false,
};

const CancelConfirmDialog: React.FC<{
  state: WizardState;
  handleCancelDialogSelect: (value: string) => void;
}> = ({ state, handleCancelDialogSelect }) => (
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
        { label: 'No, continue editing', value: 'resume', key: 'resume' },
        { label: 'Yes, discard and exit', value: 'confirm', key: 'confirm' },
      ]}
      onSelect={handleCancelDialogSelect}
      isFocused={true}
    />
  </Box>
);

interface StepHandlers {
  state: WizardState;
  handleContinue: () => void;
  goBack: () => void;
  handleCancel: () => void;
  handleUpdateProvider: (provider: string) => void;
  handleUpdateBaseUrl: (baseUrl: string) => void;
  handleUpdateModel: (model: string) => void;
  handleUpdateAuth: (auth: WizardState['config']['auth']) => void;
  handleUpdateParams: (params: WizardState['config']['params']) => void;
  handleUpdateProfileName: (name: string) => void;
  onClose: () => void;
  onLoadProfile?: (profileName: string) => void;
  availableProviders?: string[];
}

const STEP_RENDERERS: Record<WizardStep, React.FC<StepHandlers> | null> = {
  [WizardStep.PROVIDER_SELECT]: (h) => (
    <ProviderSelectStep
      state={h.state}
      onUpdateProvider={h.handleUpdateProvider}
      onCancel={h.handleCancel}
      availableProviders={h.availableProviders}
    />
  ),
  [WizardStep.BASE_URL_CONFIG]: (h) => (
    <BaseUrlConfigStep
      state={h.state}
      onUpdateBaseUrl={h.handleUpdateBaseUrl}
      onContinue={h.handleContinue}
      onBack={h.goBack}
    />
  ),
  [WizardStep.MODEL_SELECT]: (h) => (
    <ModelSelectStep
      state={h.state}
      onUpdateModel={h.handleUpdateModel}
      onContinue={h.handleContinue}
      onBack={h.goBack}
      onCancel={h.handleCancel}
    />
  ),
  [WizardStep.AUTHENTICATION]: (h) => (
    <AuthenticationStep
      state={h.state}
      onUpdateAuth={h.handleUpdateAuth}
      onContinue={h.handleContinue}
      onBack={h.goBack}
      onCancel={h.handleCancel}
    />
  ),
  [WizardStep.ADVANCED_PARAMS]: (h) => (
    <AdvancedParamsStep
      state={h.state}
      onUpdateParams={h.handleUpdateParams}
      onContinue={h.handleContinue}
      onBack={h.goBack}
      onCancel={h.handleCancel}
    />
  ),
  [WizardStep.SAVE_PROFILE]: (h) => (
    <ProfileSaveStep
      state={h.state}
      onUpdateProfileName={h.handleUpdateProfileName}
      onContinue={h.handleContinue}
      onBack={h.goBack}
      onCancel={h.handleCancel}
    />
  ),
  [WizardStep.SUCCESS_SUMMARY]: (h) => (
    <ProfileSuccessSummary
      state={h.state}
      onClose={h.onClose}
      onLoadProfile={h.onLoadProfile}
    />
  ),
};

const renderStep = (handlers: StepHandlers): React.ReactNode => {
  const renderer = STEP_RENDERERS[handlers.state.currentStep];
  if (renderer) {
    return renderer(handlers) as React.ReactNode;
  }
  return <Text color={Colors.Foreground}>Unknown step</Text>;
};

const useConfigUpdaters = (
  setState: React.Dispatch<React.SetStateAction<WizardState>>,
) => {
  const updateConfig = useCallback(
    <K extends keyof WizardState['config']>(
      key: K,
      value: WizardState['config'][K],
    ) => {
      setState((prev) => ({
        ...prev,
        config: { ...prev.config, [key]: value },
      }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setState is stable from useState
    [],
  );
  const handleUpdateProvider = useCallback((provider: string) => {
    setState((prev) => {
      const newConfig = { ...prev.config, provider };
      const nextStep = getNextStep(WizardStep.PROVIDER_SELECT, {
        ...prev,
        config: newConfig,
      });
      return {
        ...prev,
        config: newConfig,
        currentStep: nextStep,
        stepHistory: [...prev.stepHistory, nextStep],
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setState is stable from useState
  }, []);
  const handleUpdateProfileName = useCallback((name: string) => {
    setState((prev) => ({ ...prev, profileName: name }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setState is stable from useState
  }, []);
  return { updateConfig, handleUpdateProvider, handleUpdateProfileName };
};

const buildHandlers = (
  state: WizardState,
  handleContinue: () => void,
  goBack: () => void,
  handleCancel: () => void,
  updateConfig: <K extends keyof WizardState['config']>(
    key: K,
    value: WizardState['config'][K],
  ) => void,
  handleUpdateProvider: (provider: string) => void,
  handleUpdateProfileName: (name: string) => void,
  onClose: () => void,
  onLoadProfile?: (profileName: string) => void,
  availableProviders?: string[],
): StepHandlers => ({
  state,
  handleContinue,
  goBack,
  handleCancel,
  handleUpdateProvider,
  handleUpdateProfileName,
  handleUpdateBaseUrl: (b: string) => updateConfig('baseUrl', b),
  handleUpdateModel: (m: string) => updateConfig('model', m),
  handleUpdateAuth: (a: WizardState['config']['auth']) =>
    updateConfig('auth', a),
  handleUpdateParams: (p: WizardState['config']['params']) =>
    updateConfig('params', p),
  onClose,
  onLoadProfile,
  availableProviders,
});

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
  const [state, setState] = useState<WizardState>(INITIAL_STATE);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const navigateToStep = useCallback((nextStep: WizardStep) => {
    setState((prev) => ({
      ...prev,
      currentStep: nextStep,
      stepHistory: [...prev.stepHistory, nextStep],
    }));
  }, []);

  const goBack = useCallback(() => {
    setState((prev) => ({
      ...prev,
      currentStep: getPreviousStep(prev),
      stepHistory: prev.stepHistory.slice(0, -1),
    }));
  }, []);

  const handleContinue = useCallback(() => {
    navigateToStep(getNextStep(state.currentStep, state));
  }, [state, navigateToStep]);

  const handleCancel = useCallback(() => {
    if (
      state.currentStep === WizardStep.PROVIDER_SELECT &&
      !state.config.provider
    ) {
      onClose();
      return;
    }
    setShowCancelConfirm(true);
  }, [state.currentStep, state.config.provider, onClose]);

  const handleCancelDialogSelect = useCallback(
    (value: string) => {
      if (value === 'confirm') {
        onClose();
      } else {
        setShowCancelConfirm(false);
      }
    },
    [onClose],
  );

  const { updateConfig, handleUpdateProvider, handleUpdateProfileName } =
    useConfigUpdaters(setState);

  const handlers = buildHandlers(
    state,
    handleContinue,
    goBack,
    handleCancel,
    updateConfig,
    handleUpdateProvider,
    handleUpdateProfileName,
    onClose,
    onLoadProfile,
    availableProviders,
  );

  if (showCancelConfirm) {
    return (
      <CancelConfirmDialog
        state={state}
        handleCancelDialogSelect={handleCancelDialogSelect}
      />
    );
  }

  return (
    <Box
      borderStyle="round"
      borderColor={Colors.Gray}
      flexDirection="column"
      padding={1}
    >
      {renderStep(handlers)}
    </Box>
  );
};
