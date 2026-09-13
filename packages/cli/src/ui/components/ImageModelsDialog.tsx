/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { useCallback, useEffect, useState, type JSX } from 'react';
import { Box, Text } from 'ink';
import {
  ProfileManager,
  type ImageProfile,
} from '@vybestack/llxprt-code-settings';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';
import { useKeypress } from '../hooks/useKeypress.js';
import { theme } from '../semantic-colors.js';
import { selectImageModel } from '../commands/imageModelSelection.js';
import { RadioButtonSelect } from './shared/RadioButtonSelect.js';
import { TextInput } from './ProfileCreateWizard/TextInput.js';
import {
  ImageModelWizard,
  listImageModelChoices,
  type ImageModelChoice,
  type ImageModelOption,
} from './imageModelWizard.js';

const authModes: Array<{ label: string; value: ImageProfile['auth']['type'] }> =
  [
    { label: 'No authentication (local backend)', value: 'none' },
    { label: 'Codex OAuth', value: 'oauth' },
    { label: 'API key', value: 'api-key' },
    { label: 'Named key', value: 'named-key' },
    { label: 'Key file', value: 'keyfile' },
  ];

function useImageModelDialog() {
  const runtime = useRuntimeApi();
  const [options, setOptions] = useState<ImageModelOption[]>([]);
  const [wizard, setWizard] = useState<ImageModelWizard>();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState<string>();
  const [, refresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const manager =
      runtime.getCliRuntimeServices().profileManager ?? new ProfileManager();
    void listImageModelChoices(manager).then(
      (choices) => {
        if (!cancelled) {
          setOptions(choices);
          setBusy(false);
        }
      },
      (reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
          setBusy(false);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [runtime]);

  const select = async (choice: ImageModelChoice): Promise<void> => {
    setError(undefined);
    if (choice.kind === 'new') {
      setWizard(
        new ImageModelWizard(choice.backend, runtime.setActiveImageProfile),
      );
      return;
    }
    setBusy(true);
    try {
      const result = await selectImageModel(choice.name);
      if (result.messageType === 'error') setError(result.content);
      else setMessage(result.content);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const advance = (action: () => void): void => {
    try {
      action();
      setError(undefined);
      setValue('');
      refresh((count) => count + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  return {
    options,
    wizard,
    value,
    setValue,
    error,
    busy,
    message,
    select,
    advance,
  };
}

/** Interactive image selection and in-memory configuration, separate from text models. */
export function ImageModelsDialog({
  onClose,
}: {
  readonly onClose: () => void;
}): JSX.Element {
  const state = useImageModelDialog();
  useKeypress(
    useCallback(
      (key) => {
        if (key.name === 'escape') {
          onClose();
          return true;
        }
        return false;
      },
      [onClose],
    ),
    { isActive: true },
  );

  return (
    <Box flexDirection="column" borderStyle="round" padding={1}>
      <Text color={theme.text.primary}>Image models</Text>
      {state.error && <Text color={theme.status.error}>{state.error}</Text>}
      <ImageModelContent state={state} />
      <Text color={theme.text.secondary}>
        Escape to close. Save configuration with /profile save image
        &lt;name&gt;.
      </Text>
    </Box>
  );
}

function ImageModelContent({
  state,
}: {
  readonly state: ReturnType<typeof useImageModelDialog>;
}): JSX.Element {
  if (state.busy)
    return <Text color={theme.text.secondary}>Loading image profiles...</Text>;
  if (state.message)
    return <Text color={theme.status.success}>{state.message}</Text>;
  if (state.wizard)
    return (
      <ImageWizardFields
        wizard={state.wizard}
        value={state.value}
        onChange={state.setValue}
        advance={state.advance}
      />
    );
  return (
    <RadioButtonSelect<ImageModelChoice>
      items={state.options.map((option) => ({
        ...option,
        key:
          option.value.kind === 'saved'
            ? `saved:${option.value.name}`
            : `new:${option.value.backend}`,
      }))}
      onSelect={(choice) => {
        void state.select(choice);
      }}
    />
  );
}

function fieldLabel(wizard: ImageModelWizard): string {
  if (wizard.step === 'model') return 'Model name';
  if (wizard.step === 'baseUrl') return 'Base URL';
  switch (wizard.credentialMode) {
    case 'api-key':
      return 'API key';
    case 'named-key':
      return 'Key name';
    default:
      return 'Key file path';
  }
}

function ImageWizardFields({
  wizard,
  value,
  onChange,
  advance,
}: {
  readonly wizard: ImageModelWizard;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly advance: (action: () => void) => void;
}): JSX.Element {
  if (wizard.step === 'done')
    return (
      <Text color={theme.status.success}>
        Image configuration active (not saved).
      </Text>
    );
  if (wizard.step === 'auth')
    return (
      <RadioButtonSelect<ImageProfile['auth']['type']>
        items={authModes.map((mode) => ({ ...mode, key: mode.value }))}
        onSelect={(mode) => advance(() => wizard.chooseAuth(mode))}
      />
    );
  return (
    <Box flexDirection="column">
      <Text color={theme.text.primary}>{fieldLabel(wizard)}</Text>
      <TextInput
        key={wizard.step}
        value={value}
        onChange={onChange}
        onSubmit={() => advance(() => wizard.submit(value))}
        mask={wizard.credentialMode === 'api-key'}
        isFocused
      />
    </Box>
  );
}
