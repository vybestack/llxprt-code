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

const PARAM_KEYS = [
  'max_tokens',
  'temperature',
  'top_p',
  'top_k',
  'frequency_penalty',
  'presence_penalty',
] as const;

const EPHEMERAL_KEYS = [
  'context-limit',
  'reasoning.enabled',
  'reasoning.effort',
  'streaming',
  'prompt-caching',
] as const;

const PARAM_HINTS: Record<string, string> = {
  max_tokens: 'Maximum output tokens',
  temperature: 'Sampling randomness (0.0-2.0)',
  top_p: 'Nucleus sampling (0.0-1.0)',
  top_k: 'Top-k sampling',
  frequency_penalty: 'Penalize frequent tokens',
  presence_penalty: 'Penalize present tokens',
  'context-limit': 'Positive integer token cap',
  'reasoning.enabled': 'Enable thinking/reasoning',
  'reasoning.effort': 'minimal|low|medium|high|xhigh|max',
  streaming: 'enabled|disabled',
  'prompt-caching': 'off|5m|1h|24h',
};

const BOOLEAN_EPHEMERALS = new Set(['reasoning.enabled']);
const ENUM_EPHEMERALS: Record<string, readonly string[]> = {
  streaming: ['enabled', 'disabled'],
  'prompt-caching': ['off', '5m', '1h', '24h'],
};

type FieldKind = 'param' | 'ephemeral';
type EditorType = 'text' | 'boolean' | 'enum';

interface ConfigField {
  key: string;
  kind: FieldKind;
  hint: string;
  editor: EditorType;
  enumValues?: readonly string[];
}

function buildFields(unallowed: ReadonlySet<string>): readonly ConfigField[] {
  const paramFields = PARAM_KEYS.filter((key) => !unallowed.has(key)).map(
    (key) => ({
      key,
      kind: 'param' as const,
      hint: PARAM_HINTS[key] ?? '',
      editor: 'text' as const,
    }),
  );

  const ephemeralFields = EPHEMERAL_KEYS.map((key) => {
    let editor: EditorType = 'text';
    if (BOOLEAN_EPHEMERALS.has(key)) {
      editor = 'boolean';
    } else if (Object.hasOwn(ENUM_EPHEMERALS, key)) {
      editor = 'enum';
    }
    return {
      key,
      kind: 'ephemeral' as const,
      hint: PARAM_HINTS[key] ?? '',
      editor,
      enumValues: ENUM_EPHEMERALS[key],
    };
  });

  return [...paramFields, ...ephemeralFields];
}

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
  try {
    setActiveModelParam(key, parseValue(raw));
    return { success: true };
  } catch (e) {
    return {
      success: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
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
    // Provider-scoped params take precedence; fall back to the global
    // ephemeral snapshot so inherited modelDefaults render as initial values.
    return params[field.key] ?? ephemeral[field.key];
  }
  return ephemeral[field.key];
}

interface RuntimeReads {
  providerName: string;
  modelName: string;
  modelParams: Record<string, unknown>;
  ephemeralSettings: Record<string, unknown>;
  unallowedParameters: ReadonlySet<string>;
}

function useRuntimeReads(
  runtime: ReturnType<typeof useRuntimeApi>,
): RuntimeReads {
  return {
    providerName: runtime.getActiveProviderName(),
    modelName: runtime.getActiveModelName(),
    modelParams: runtime.getActiveModelParams(),
    ephemeralSettings: runtime.getEphemeralSettings(),
    unallowedParameters: new Set(
      runtime.getUnallowedParametersForActiveModel(),
    ),
  };
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
  isEditing: boolean;
  editValue: string;
  currentValue: unknown;
  enumIndex: number;
  onEditChange: (value: string) => void;
}> = ({
  field,
  isSelected,
  isEditing,
  editValue,
  currentValue,
  enumIndex,
  onEditChange,
}) => {
  const indicator = isSelected ? '\u25CF' : '\u25CB';
  const color = isSelected
    ? SemanticColors.text.accent
    : SemanticColors.text.primary;
  const displayValue = formatValue(currentValue).padEnd(12);

  if (isEditing && field.editor === 'text') {
    return (
      <Box>
        <Text color={color}>{indicator} </Text>
        <Text color={color}>{field.key.padEnd(22)}</Text>
        <TextInput
          value={editValue}
          onChange={onEditChange}
          isFocused={true}
          placeholder={field.hint}
        />
      </Box>
    );
  }

  if (isEditing && field.editor === 'boolean') {
    const boolVal = currentValue === true;
    return (
      <Box>
        <Text color={color}>{indicator} </Text>
        <Text color={color}>{field.key.padEnd(22)}</Text>
        <Text color={SemanticColors.text.secondary}>
          {boolVal ? 'true ' : 'false'}
        </Text>
        <Text color={SemanticColors.text.secondary}>
          {' (Space to toggle)'}
        </Text>
      </Box>
    );
  }

  if (isEditing && field.editor === 'enum') {
    const values = field.enumValues ?? [];
    return (
      <Box>
        <Text color={color}>{indicator} </Text>
        <Text color={color}>{field.key.padEnd(22)}</Text>
        {values.map((v, i) => (
          <Text
            key={v}
            color={
              i === enumIndex
                ? SemanticColors.text.accent
                : SemanticColors.text.secondary
            }
          >
            {i === enumIndex ? `[${v}]` : ` ${v} `}
          </Text>
        ))}
      </Box>
    );
  }

  return (
    <Box>
      <Text color={color}>{indicator} </Text>
      <Text color={color}>{field.key.padEnd(22)}</Text>
      <Text color={SemanticColors.text.secondary}>{displayValue}</Text>
      <Text color={SemanticColors.text.secondary}>{field.hint}</Text>
    </Box>
  );
};

interface KeypressDispatch {
  onClose: () => void;
  selectedIndex: number;
  editingIndex: number | null;
  editValue: string;
  setEditingIndex: (index: number | null) => void;
  setEditValue: (value: string) => void;
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  enumIndex: number;
  setEnumIndex: React.Dispatch<React.SetStateAction<number>>;
  runtime: ReturnType<typeof useRuntimeApi>;
  setValidationError: (msg: string | null) => void;
  validationError: string | null;
  params: Record<string, unknown>;
  ephemeral: Record<string, unknown>;
  forceRender: () => void;
  fields: readonly ConfigField[];
}

function toggleBooleanValue(
  field: ConfigField,
  current: unknown,
  runtime: ReturnType<typeof useRuntimeApi>,
): void {
  if (field.kind !== 'ephemeral') return;
  const next = current !== true;
  runtime.setEphemeralSetting(field.key, next);
}

function cycleEnumValue(
  field: ConfigField,
  enumIndex: number,
  direction: 1 | -1,
  runtime: ReturnType<typeof useRuntimeApi>,
): number {
  const values = field.enumValues ?? [];
  if (values.length === 0) return enumIndex;
  const nextIndex = (enumIndex + direction + values.length) % values.length;
  runtime.setEphemeralSetting(field.key, values[nextIndex]);
  return nextIndex;
}

function handleListKey(key: Key, d: KeypressDispatch): void {
  const field = d.fields[d.selectedIndex];

  if (key.name === 'escape') {
    d.onClose();
    return;
  }
  if (key.name === 'up') {
    d.setSelectedIndex((prev) => Math.max(0, prev - 1));
    return;
  }
  if (key.name === 'down') {
    d.setSelectedIndex((prev) => Math.min(d.fields.length - 1, prev + 1));
    return;
  }
  if (key.name === 'return') {
    if (field.editor === 'boolean') {
      toggleBooleanValue(
        field,
        valueForField(field, d.params, d.ephemeral),
        d.runtime,
      );
      d.forceRender();
      return;
    }
    if (field.editor === 'enum') {
      const current = valueForField(field, d.params, d.ephemeral);
      const idx = field.enumValues?.indexOf(String(current)) ?? -1;
      d.setEnumIndex(idx >= 0 ? idx : 0);
      d.setEditingIndex(d.selectedIndex);
      return;
    }
    const current = valueForField(field, d.params, d.ephemeral);
    d.setEditValue(
      current === undefined || current === null ? '' : formatValue(current),
    );
    d.setValidationError(null);
    d.setEditingIndex(d.selectedIndex);
    return;
  }
  if (isPlainLetter(key, 'c') && field.kind === 'param') {
    d.runtime.clearActiveModelParam(field.key);
    d.forceRender();
  }
}

function handleEditKey(key: Key, d: KeypressDispatch): void {
  const field = d.fields[d.editingIndex!];

  if (key.name === 'escape') {
    d.setEditingIndex(null);
    d.setValidationError(null);
    return;
  }

  if (field.editor === 'enum') {
    if (key.name === 'left') {
      d.setEnumIndex((prev) => {
        const next = cycleEnumValue(field, prev, -1, d.runtime);
        return next;
      });
      return;
    }
    if (key.name === 'right') {
      d.setEnumIndex((prev) => {
        const next = cycleEnumValue(field, prev, 1, d.runtime);
        return next;
      });
      return;
    }
    if (key.name === 'return') {
      d.setEditingIndex(null);
      d.setValidationError(null);
      return;
    }
    return;
  }

  if (key.name !== 'return') {
    return;
  }

  if (field.kind === 'param') {
    const result = commitParam(
      field.key,
      d.editValue,
      d.runtime.setActiveModelParam,
    );
    if (!result.success) {
      d.setValidationError(result.message ?? 'Invalid value');
      return;
    }
    d.setEditingIndex(null);
    d.setValidationError(null);
    return;
  }

  const result = commitEphemeral(
    field,
    d.editValue,
    d.runtime.setEphemeralSetting,
  );
  if (!result.success) {
    d.setValidationError(result.message ?? 'Invalid value');
    return;
  }
  d.setEditingIndex(null);
  d.setValidationError(null);
}

function isPlainLetter(key: Key, letter: string): boolean {
  return key.name === letter && key.ctrl !== true && key.meta !== true;
}

function useModelConfigKeypress(d: KeypressDispatch): void {
  const dispatchRef = useRef(d);
  dispatchRef.current = d;
  const onKeypress = useCallback((key: Key) => {
    const cur = dispatchRef.current;
    if (cur.editingIndex !== null) {
      handleEditKey(key, cur);
    } else {
      handleListKey(key, cur);
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
  const fields = buildFields(reads.unallowedParameters);

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [enumIndex, setEnumIndex] = useState(0);
  const [, setRenderTick] = useState(0);
  const forceRender = useCallback(() => setRenderTick((t) => t + 1), []);

  useModelConfigKeypress({
    onClose,
    selectedIndex,
    editingIndex,
    editValue,
    setEditingIndex,
    setEditValue,
    setSelectedIndex,
    enumIndex,
    setEnumIndex,
    runtime,
    setValidationError,
    validationError,
    params: reads.modelParams,
    ephemeral: reads.ephemeralSettings,
    forceRender,
    fields,
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
      {fields.map((field, i) => (
        <FieldRow
          key={field.key}
          field={field}
          isSelected={selectedIndex === i}
          isEditing={editingIndex === i}
          editValue={editValue}
          currentValue={valueForField(
            field,
            reads.modelParams,
            reads.ephemeralSettings,
          )}
          enumIndex={enumIndex}
          onEditChange={setEditValue}
        />
      ))}

      {validationError !== null && (
        <Box marginTop={1}>
          <Text color={SemanticColors.status.error}>{validationError}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={SemanticColors.text.secondary}>
          {'\u2191'}/{'\u2193'} navigate Enter edit c=clear(param) Esc close
        </Text>
      </Box>
    </Box>
  );
};
