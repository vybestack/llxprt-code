/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useCallback, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import type { Key } from '../hooks/useKeypress.js';
import { SemanticColors } from '../colors.js';
import { useResponsive } from '../hooks/useResponsive.js';
import { useKeypress } from '../hooks/useKeypress.js';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';
import { TextInput } from './ProfileCreateWizard/TextInput.js';
import { parseValue } from '../commands/setCommand.js';
import { parseEphemeralSettingValue } from '@vybestack/llxprt-code-providers/runtime.js';

const MODEL_PARAM_KEYS = [
  'temperature',
  'max_tokens',
  'top_p',
  'top_k',
  'frequency_penalty',
  'presence_penalty',
] as const;

const EPHEMERAL_SETTING_KEYS = [
  'reasoning.enabled',
  'reasoning.effort',
  'context-limit',
  'streaming',
  'prompt-caching',
] as const;

const PARAM_HINTS: Record<string, string> = {
  temperature: 'Sampling randomness (0.0-2.0)',
  max_tokens: 'Maximum output tokens',
  top_p: 'Nucleus sampling (0.0-1.0)',
  top_k: 'Top-k sampling',
  frequency_penalty: 'Penalize frequent tokens',
  presence_penalty: 'Penalize present tokens',
  'reasoning.enabled': 'Enable thinking/reasoning (true/false)',
  'reasoning.effort': 'minimal|low|medium|high|xhigh|max',
  'context-limit': 'Positive integer token cap',
  streaming: 'enabled|disabled',
  'prompt-caching': 'off|5m|1h|24h',
};

type FieldKind = 'param' | 'ephemeral';

interface ConfigField {
  key: string;
  kind: FieldKind;
  hint: string;
}

const ALL_FIELDS: readonly ConfigField[] = [
  ...MODEL_PARAM_KEYS.map((key) => ({
    key,
    kind: 'param' as const,
    hint: PARAM_HINTS[key] ?? '',
  })),
  ...EPHEMERAL_SETTING_KEYS.map((key) => ({
    key,
    kind: 'ephemeral' as const,
    hint: PARAM_HINTS[key] ?? '',
  })),
];

const PARAM_FIELDS: readonly ConfigField[] = ALL_FIELDS.filter(
  (f) => f.kind === 'param',
);
const EPHEMERAL_FIELDS: readonly ConfigField[] = ALL_FIELDS.filter(
  (f) => f.kind === 'ephemeral',
);

export interface ModelConfigDialogProps {
  onClose: () => void;
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return '(not set)';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

interface CommitResult {
  success: boolean;
  message?: string;
}

function commitParam(
  key: string,
  raw: string,
  setActiveModelParam: (key: string, value: unknown) => void,
): CommitResult {
  setActiveModelParam(key, parseValue(raw));
  return { success: true };
}

function commitEphemeral(
  field: ConfigField,
  raw: string,
  setEphemeralSetting: (key: string, value: unknown) => void,
): CommitResult {
  const result = parseEphemeralSettingValue(field.key, raw);
  if (!result.success) {
    return { success: false, message: result.message };
  }
  setEphemeralSetting(field.key, result.value);
  return { success: true };
}

function valueForField(
  field: ConfigField,
  params: Record<string, unknown>,
  ephemeral: Record<string, unknown>,
): unknown {
  if (field.kind === 'param') {
    return params[field.key];
  }
  return ephemeral[field.key];
}

const SectionHeader: React.FC<{ label: string }> = ({ label }) => (
  <Box marginTop={1}>
    <Text bold color={SemanticColors.text.accent}>
      {label}
    </Text>
  </Box>
);

const FieldRow: React.FC<{
  field: ConfigField;
  isSelected: boolean;
  currentValue: unknown;
}> = ({ field, isSelected, currentValue }) => {
  const indicator = isSelected ? '\u25CF' : '\u25CB';
  const color = isSelected
    ? SemanticColors.text.accent
    : SemanticColors.text.primary;
  return (
    <Box>
      <Text color={color}>{indicator} </Text>
      <Text color={color}>{field.key.padEnd(22)}</Text>
      <Text color={SemanticColors.text.secondary}>
        {formatValue(currentValue).padEnd(12)}
      </Text>
      <Text color={SemanticColors.text.secondary}>{field.hint}</Text>
    </Box>
  );
};

const FieldList: React.FC<{
  fields: readonly ConfigField[];
  selectedIndex: number;
  isEditing: boolean;
  params: Record<string, unknown>;
  ephemeral: Record<string, unknown>;
  startIndex: number;
}> = ({ fields, selectedIndex, isEditing, params, ephemeral, startIndex }) => (
  <>
    {fields.map((field, i) => (
      <FieldRow
        key={field.key}
        field={field}
        isSelected={!isEditing && selectedIndex === startIndex + i}
        currentValue={valueForField(field, params, ephemeral)}
      />
    ))}
  </>
);

const EditMode: React.FC<{
  field: ConfigField;
  value: string;
  onChange: (value: string) => void;
  validationError: string | null;
}> = ({ field, value, onChange, validationError }) => (
  <Box flexDirection="column" marginTop={1}>
    <Text color={SemanticColors.text.primary}>
      {`Edit ${field.key} (Enter=save Esc=cancel)`}
    </Text>
    <TextInput
      value={value}
      onChange={onChange}
      isFocused={true}
      placeholder={field.hint}
    />
    {validationError !== null && (
      <Box marginTop={1}>
        <Text color={SemanticColors.status.error}>{validationError}</Text>
      </Box>
    )}
  </Box>
);

interface RuntimeReads {
  providerName: string;
  modelName: string;
  modelParams: Record<string, unknown>;
  ephemeralSettings: Record<string, unknown>;
}

function useRuntimeReads(
  runtime: ReturnType<typeof useRuntimeApi>,
): RuntimeReads {
  // Read runtime snapshots directly on every render. These are inexpensive
  // snapshot reads, and memoizing on [runtime] causes stale values after a
  // write because the runtime API object identity does not change.
  return {
    providerName: runtime.getActiveProviderName(),
    modelName: runtime.getActiveModelName(),
    modelParams: runtime.getActiveModelParams(),
    ephemeralSettings: runtime.getEphemeralSettings(),
  };
}

function isPlainLetter(key: Key, letter: string): boolean {
  return key.name === letter && key.ctrl !== true && key.meta !== true;
}

function getClearableParamField(
  key: Key,
  field: ConfigField,
): ConfigField | null {
  if (field.kind === 'param' && isPlainLetter(key, 'c')) {
    return field;
  }
  return null;
}

interface KeypressDispatch {
  onClose: () => void;
  selectedIndex: number;
  editingField: ConfigField | null;
  editValue: string;
  setEditingField: (field: ConfigField | null) => void;
  setEditValue: (value: string) => void;
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  runtime: ReturnType<typeof useRuntimeApi>;
  setValidationError: (msg: string | null) => void;
  params: Record<string, unknown>;
  ephemeral: Record<string, unknown>;
}

function handleListKey(
  key: Key,
  onClose: () => void,
  selectedIndex: number,
  setEditingField: (f: ConfigField | null) => void,
  setEditValue: (v: string) => void,
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>,
  setValidationError: (m: string | null) => void,
  runtime: ReturnType<typeof useRuntimeApi>,
  params: Record<string, unknown>,
  ephemeral: Record<string, unknown>,
): void {
  if (key.name === 'escape') {
    onClose();
    return;
  }
  if (key.name === 'up') {
    setSelectedIndex((prev) => Math.max(0, prev - 1));
    return;
  }
  if (key.name === 'down') {
    setSelectedIndex((prev) => Math.min(ALL_FIELDS.length - 1, prev + 1));
    return;
  }
  if (key.name === 'return') {
    const field = ALL_FIELDS[selectedIndex];
    const current = valueForField(field, params, ephemeral);
    setEditValue(
      current === undefined || current === null ? '' : formatValue(current),
    );
    setValidationError(null);
    setEditingField(field);
    return;
  }
  const clearable = getClearableParamField(key, ALL_FIELDS[selectedIndex]);
  if (clearable !== null) {
    runtime.clearActiveModelParam(clearable.key);
  }
}

function handleEditKey(
  key: Key,
  editingField: ConfigField | null,
  editValue: string,
  runtime: ReturnType<typeof useRuntimeApi>,
  setEditingField: (f: ConfigField | null) => void,
  setValidationError: (m: string | null) => void,
): void {
  if (key.name === 'escape') {
    setEditingField(null);
    setValidationError(null);
    return;
  }
  if (key.name !== 'return') {
    return;
  }
  if (editingField === null) return;
  if (editingField.kind === 'param') {
    commitParam(editingField.key, editValue, runtime.setActiveModelParam);
    setEditingField(null);
    setValidationError(null);
    return;
  }
  const result = commitEphemeral(
    editingField,
    editValue,
    runtime.setEphemeralSetting,
  );
  if (!result.success) {
    setValidationError(result.message ?? 'Invalid value');
    return;
  }
  setEditingField(null);
  setValidationError(null);
}

function useModelConfigKeypress(d: KeypressDispatch): void {
  // Use a ref to hold the latest dispatch so the keypress callback identity
  // stays stable, avoiding unnecessary re-subscriptions in useKeypress.
  const dispatchRef = useRef(d);
  dispatchRef.current = d;
  const onKeypress = useCallback((key: Key) => {
    const cur = dispatchRef.current;
    if (cur.editingField !== null) {
      handleEditKey(
        key,
        cur.editingField,
        cur.editValue,
        cur.runtime,
        cur.setEditingField,
        cur.setValidationError,
      );
    } else {
      handleListKey(
        key,
        cur.onClose,
        cur.selectedIndex,
        cur.setEditingField,
        cur.setEditValue,
        cur.setSelectedIndex,
        cur.setValidationError,
        cur.runtime,
        cur.params,
        cur.ephemeral,
      );
    }
  }, []);
  useKeypress(onKeypress, { isActive: true });
}

const DialogHeader: React.FC<{
  providerName: string;
  modelName: string;
}> = ({ providerName, modelName }) => (
  <>
    <Box justifyContent="space-between">
      <Text bold color={SemanticColors.text.primary}>
        Model Configuration
      </Text>
    </Box>
    <Box marginBottom={1}>
      <Text color={SemanticColors.text.secondary}>
        {providerName} / {modelName}
      </Text>
    </Box>
  </>
);

export const ModelConfigDialog: React.FC<ModelConfigDialogProps> = ({
  onClose,
}) => {
  const runtime = useRuntimeApi();
  const { width } = useResponsive();
  const reads = useRuntimeReads(runtime);

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editingField, setEditingField] = useState<ConfigField | null>(null);
  const [editValue, setEditValue] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  useModelConfigKeypress({
    onClose,
    selectedIndex,
    editingField,
    editValue,
    setEditingField,
    setEditValue,
    setSelectedIndex,
    runtime,
    setValidationError,
    params: reads.modelParams,
    ephemeral: reads.ephemeralSettings,
  });

  const dialogWidth = Math.min(width, 80);

  return (
    <Box
      borderStyle="round"
      borderColor={SemanticColors.border.default}
      flexDirection="column"
      padding={1}
      width={dialogWidth}
    >
      <DialogHeader
        providerName={reads.providerName}
        modelName={reads.modelName}
      />

      <SectionHeader label="Model Parameters" />
      <FieldList
        fields={PARAM_FIELDS}
        selectedIndex={selectedIndex}
        isEditing={editingField !== null}
        params={reads.modelParams}
        ephemeral={reads.ephemeralSettings}
        startIndex={0}
      />

      <SectionHeader label="Model Behavior" />
      <FieldList
        fields={EPHEMERAL_FIELDS}
        selectedIndex={selectedIndex}
        isEditing={editingField !== null}
        params={reads.modelParams}
        ephemeral={reads.ephemeralSettings}
        startIndex={PARAM_FIELDS.length}
      />

      {editingField !== null && (
        <EditMode
          field={editingField}
          value={editValue}
          onChange={setEditValue}
          validationError={validationError}
        />
      )}

      {editingField === null && (
        <Box marginTop={1}>
          <Text color={SemanticColors.text.secondary}>
            {'\u2191'}/{'\u2193'} navigate Enter edit c=clear(param) Esc close
          </Text>
        </Box>
      )}
    </Box>
  );
};
