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
import { getSettingSpec } from '@vybestack/llxprt-code-settings';

// Pending values for one field, staged in the dialog until [Save] commits
// them to the runtime. Cancel/Esc discards them wholesale.
interface PendingEdit {
  text: string;
  enumIndex: number | null;
  boolValue: boolean | null;
}

function pendingValueFor(
  field: ConfigField,
  edit: PendingEdit | undefined,
): unknown {
  if (edit === undefined) return undefined;
  if (field.editor === 'boolean') return edit.boolValue ?? undefined;
  if (field.editor === 'enum') {
    if (edit.enumIndex === null) return undefined;
    return field.enumValues?.[edit.enumIndex];
  }
  return edit.text === '' ? undefined : parseValue(edit.text);
}

const PARAM_KEYS = [
  'max_tokens',
  'temperature',
  'top_p',
  'top_k',
  'frequency_penalty',
  'presence_penalty',
] as const;

const EPHEMERAL_KEYS = [
  'reasoning.enabled',
  'reasoning.effort',
  'streaming',
  'prompt-caching',
] as const;

const PARAM_HINTS: Record<string, string> = {
  'context-limit': 'Positive integer token cap',
  max_tokens: 'Maximum output tokens',
  temperature: 'Sampling randomness (0.0-2.0)',
  top_p: 'Nucleus sampling (0.0-1.0)',
  top_k: 'Top-k sampling',
  frequency_penalty: 'Penalize frequent tokens',
  presence_penalty: 'Penalize present tokens',
  'reasoning.enabled': 'Enable thinking/reasoning',
  'reasoning.effort': 'minimal|low|medium|high|xhigh|max',
  streaming: 'enabled|disabled',
  'prompt-caching': 'off|5m|1h|24h',
};

const BOOLEAN_EPHEMERALS = new Set(['reasoning.enabled']);

function buildFields(unallowed: ReadonlySet<string>): readonly ConfigField[] {
  const paramKeys = PARAM_KEYS.filter((key) => !unallowed.has(key));
  const ephemeralKeys = EPHEMERAL_KEYS.filter((key) => !unallowed.has(key));

  // context-limit leads the list, then max_tokens, then the rest.
  const leadingKeys = [
    { key: 'context-limit', kind: 'ephemeral' as const },
    { key: 'max_tokens', kind: 'param' as const },
  ].filter((e) => !unallowed.has(e.key));

  const paramFields = paramKeys
    .filter((key) => key !== 'max_tokens')
    .map((key) => ({
      key,
      kind: 'param' as const,
      hint: PARAM_HINTS[key] ?? '',
      editor: 'text' as const,
    }));

  const ephemeralFields = ephemeralKeys.map((key) => {
    let editor: EditorType = 'text';
    if (BOOLEAN_EPHEMERALS.has(key)) {
      editor = 'boolean';
    } else {
      const spec = getSettingSpec(key);
      if (spec?.type === 'enum') {
        editor = 'enum';
      }
    }
    const enumValues =
      editor === 'enum' ? (getSettingSpec(key)?.enumValues ?? []) : undefined;
    return {
      key,
      kind: 'ephemeral' as const,
      hint: PARAM_HINTS[key] ?? '',
      editor,
      enumValues,
    };
  });

  const leadingFields = leadingKeys.map((e) => ({
    key: e.key,
    kind: e.kind,
    hint: PARAM_HINTS[e.key] ?? '',
    editor: 'text' as const,
  }));

  return [...leadingFields, ...paramFields, ...ephemeralFields];
}

const KEY_COLUMN_WIDTH = Math.max(
  22,
  ...PARAM_KEYS.map((k) => k.length),
  ...EPHEMERAL_KEYS.map((k) => k.length),
  'context-limit'.length,
  'max_tokens'.length,
);

type FieldKind = 'param' | 'ephemeral';
type EditorType = 'text' | 'boolean' | 'enum';

interface ConfigField {
  key: string;
  kind: FieldKind;
  hint: string;
  editor: EditorType;
  enumValues?: readonly string[];
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

function isFieldImmutable(field: ConfigField, value: unknown): boolean {
  // A boolean model-behavior switch is immutable while it is ON. The model
  // (or its inherited alias defaults) forced the behavior on, so silently
  // flipping it off would either be rejected by the API or would leave the
  // user with no explanation. Show a reason instead of swallowing the key.
  return field.editor === 'boolean' && value === true;
}

function immutableReasonFor(field: ConfigField): string | null {
  if (field.key === 'reasoning.enabled') {
    return 'always-on for this model';
  }
  return 'fixed for this model';
}

interface RuntimeReads {
  providerName: string;
  modelName: string;
  modelParams: Record<string, unknown>;
  ephemeralSettings: Record<string, unknown>;
  unallowedParameters: ReadonlySet<string>;
}

function readRuntimeSnapshot(
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
        <Text color={color}>{field.key.padEnd(KEY_COLUMN_WIDTH)}</Text>
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
    const immutable = isFieldImmutable(field, currentValue);
    return (
      <Box>
        <Text color={color}>{indicator} </Text>
        <Text color={color}>{field.key.padEnd(KEY_COLUMN_WIDTH)}</Text>
        <Text color={SemanticColors.text.secondary}>
          {boolVal ? '[true ]' : '[false]'}
        </Text>
        <Text color={SemanticColors.text.secondary}>
          {immutable ? ` (${immutableReasonFor(field)})` : ' (Space toggle)'}
        </Text>
      </Box>
    );
  }

  if (isEditing && field.editor === 'enum') {
    const values = field.enumValues ?? [];
    return (
      <Box>
        <Text color={color}>{indicator} </Text>
        <Text color={color}>{field.key.padEnd(KEY_COLUMN_WIDTH)}</Text>
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
      <Text color={color}>{field.key.padEnd(KEY_COLUMN_WIDTH)}</Text>
      <Text color={SemanticColors.text.secondary}>{displayValue}</Text>
      {isFieldImmutable(field, currentValue) ? (
        <Text color={SemanticColors.text.secondary}>
          {`(${immutableReasonFor(field)})`}
        </Text>
      ) : (
        <Text color={SemanticColors.text.secondary}>{field.hint}</Text>
      )}
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
  fields: readonly ConfigField[];
  pendingEdits: Readonly<Record<string, PendingEdit>>;
  setPendingEdit: (key: string, edit: PendingEdit) => void;
  clearPendingEdits: () => void;
}

// Resolves a field's displayed value: a staged pending edit wins, then the
// committed runtime value (with the inherited-default fallback for params).
function effectiveValueFor(field: ConfigField, d: KeypressDispatch): unknown {
  const pending = pendingValueFor(field, d.pendingEdits[field.key]);
  if (pending !== undefined) return pending;
  return valueForField(field, d.params, d.ephemeral);
}

function togglePendingBoolean(field: ConfigField, d: KeypressDispatch): void {
  const current = effectiveValueFor(field, d);
  d.setPendingEdit(field.key, {
    text: '',
    enumIndex: null,
    boolValue: current !== true,
  });
}

function cyclePendingEnum(
  field: ConfigField,
  enumIndex: number,
  direction: 1 | -1,
): number {
  const values = field.enumValues ?? [];
  if (values.length === 0) return enumIndex;
  return (enumIndex + direction + values.length) % values.length;
}

function stageTextEdit(field: ConfigField, d: KeypressDispatch): void {
  d.setPendingEdit(field.key, {
    text: d.editValue,
    enumIndex: null,
    boolValue: null,
  });
  d.setEditingIndex(null);
  d.setValidationError(null);
}

function stageEnumEdit(field: ConfigField, d: KeypressDispatch): void {
  d.setPendingEdit(field.key, {
    text: '',
    enumIndex: d.enumIndex,
    boolValue: null,
  });
  d.setEditingIndex(null);
  d.setValidationError(null);
}

function stageClear(field: ConfigField, d: KeypressDispatch): void {
  d.setPendingEdit(field.key, { text: '', enumIndex: null, boolValue: null });
}

function stageBooleanToggle(field: ConfigField, d: KeypressDispatch): void {
  togglePendingBoolean(field, d);
  d.setEditingIndex(null);
  d.setValidationError(null);
}

// Validates staged text edits, then writes every pending value into the
// runtime. Returns true when the commit succeeded (dialog may close).
function commitPendingEdits(d: KeypressDispatch): boolean {
  for (const field of d.fields) {
    if (!(field.key in d.pendingEdits)) continue;
    const edit = d.pendingEdits[field.key];
    const error = commitFieldEdit(field, edit, d);
    if (error !== null) {
      d.setValidationError(`${field.key}: ${error}`);
      return false;
    }
  }
  d.clearPendingEdits();
  d.setValidationError(null);
  return true;
}

// Commits a single staged edit for a field. Returns an error message on
// validation failure, or null when the write succeeded (or was a no-op).
function commitFieldEdit(
  field: ConfigField,
  edit: PendingEdit,
  d: KeypressDispatch,
): string | null {
  try {
    return applyFieldEdit(field, edit, d);
  } catch (e) {
    // setEphemeralSetting/setActiveModelParam can throw (e.g. no active
    // provider); surface the error instead of crashing the dialog.
    return e instanceof Error ? e.message : String(e);
  }
}

function applyFieldEdit(
  field: ConfigField,
  edit: PendingEdit,
  d: KeypressDispatch,
): string | null {
  if (field.editor === 'boolean') {
    if (edit.boolValue !== null) {
      d.runtime.setEphemeralSetting(field.key, edit.boolValue);
    }
    return null;
  }

  if (field.editor === 'enum') {
    if (edit.enumIndex !== null) {
      const value = field.enumValues?.[edit.enumIndex];
      if (value !== undefined) {
        d.runtime.setEphemeralSetting(field.key, value);
      }
    }
    return null;
  }

  const raw = edit.text;
  if (raw === '') {
    if (field.kind === 'param') {
      d.runtime.clearActiveModelParam(field.key);
    } else {
      d.runtime.setEphemeralSetting(field.key, undefined);
    }
    return null;
  }

  if (field.kind === 'param') {
    const result = commitParam(raw, (value) =>
      d.runtime.setActiveModelParam(field.key, value),
    );
    return result.success ? null : (result.message ?? 'Invalid value');
  }

  const result = commitEphemeral(field, raw, (value) =>
    d.runtime.setEphemeralSetting(field.key, value),
  );
  return result.success ? null : (result.message ?? 'Invalid value');
}

function commitParam(
  raw: string,
  setActiveModelParam: (value: unknown) => void,
): CommitResult {
  try {
    setActiveModelParam(parseValue(raw));
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
  setEphemeralSetting: (value: unknown) => void,
): CommitResult {
  const result = parseEphemeralSettingValue(field.key, raw);
  if (!result.success) {
    return { success: false, message: result.message };
  }
  setEphemeralSetting(result.value);
  return { success: true };
}

function handleListKey(key: Key, d: KeypressDispatch): void {
  const field = d.fields[d.selectedIndex];

  if (key.name === 'escape') {
    // Cancel: discard all pending edits and close — nothing is committed.
    d.clearPendingEdits();
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
      const current = effectiveValueFor(field, d);
      if (isFieldImmutable(field, current)) {
        d.setEditingIndex(d.selectedIndex);
        return;
      }
      togglePendingBoolean(field, d);
      return;
    }
    if (field.editor === 'enum') {
      const current = effectiveValueFor(field, d);
      const idx = field.enumValues?.indexOf(String(current)) ?? -1;
      d.setEnumIndex(idx >= 0 ? idx : 0);
      d.setEditingIndex(d.selectedIndex);
      return;
    }
    const current = effectiveValueFor(field, d);
    d.setEditValue(
      current === undefined || current === null ? '' : formatValue(current),
    );
    d.setValidationError(null);
    d.setEditingIndex(d.selectedIndex);
    return;
  }
  if (isPlainLetter(key, 'space') && field.editor === 'boolean') {
    const current = effectiveValueFor(field, d);
    if (isFieldImmutable(field, current)) return;
    togglePendingBoolean(field, d);
    return;
  }
  if (isPlainLetter(key, 'c') && field.kind === 'param') {
    stageClear(field, d);
    return;
  }
  if (isPlainLetter(key, 's') && commitPendingEdits(d)) {
    d.onClose();
  }
}

function handleEditKey(key: Key, d: KeypressDispatch): void {
  const field = d.fields[d.editingIndex!];

  if (key.name === 'escape') {
    // Esc backs out of the field editor without staging the edit.
    d.setEditingIndex(null);
    d.setValidationError(null);
    return;
  }

  if (field.editor === 'boolean') {
    if (isPlainLetter(key, 'space')) {
      const current = effectiveValueFor(field, d);
      if (isFieldImmutable(field, current)) return;
      stageBooleanToggle(field, d);
      return;
    }
    if (key.name === 'return') {
      d.setEditingIndex(null);
      d.setValidationError(null);
      return;
    }
    return;
  }

  if (field.editor === 'enum') {
    if (key.name === 'left') {
      d.setEnumIndex((prev) => cyclePendingEnum(field, prev, -1));
      return;
    }
    if (key.name === 'right') {
      d.setEnumIndex((prev) => cyclePendingEnum(field, prev, 1));
      return;
    }
    if (key.name === 'return') {
      stageEnumEdit(field, d);
      return;
    }
    return;
  }

  if (key.name !== 'return') {
    return;
  }

  stageTextEdit(field, d);
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

const DialogFooter: React.FC<{ isEditing: boolean }> = ({ isEditing }) => (
  <Box marginTop={1}>
    {isEditing ? (
      <Text color={SemanticColors.text.secondary}>
        {'[Enter] stage  [Esc] back'}
      </Text>
    ) : (
      <Text color={SemanticColors.text.secondary}>
        {'↑/↓ navigate Enter edit Space toggle c=clear  [s]ave  [Esc]cancel'}
      </Text>
    )}
  </Box>
);

// Owns the pending-edit staging state for the dialog. Extracted from the
// component body to keep the main component under the line-count budget.
function usePendingEdits() {
  const [pendingEdits, setPendingEdits] = useState<
    Readonly<Record<string, PendingEdit>>
  >({});
  const setPendingEdit = useCallback((key: string, edit: PendingEdit) => {
    setPendingEdits((prev) => ({ ...prev, [key]: edit }));
  }, []);
  const clearPendingEdits = useCallback(() => setPendingEdits({}), []);
  return { pendingEdits, setPendingEdit, clearPendingEdits };
}

const FieldRows: React.FC<{
  fields: readonly ConfigField[];
  selectedIndex: number;
  editingIndex: number | null;
  editValue: string;
  pendingEdits: Readonly<Record<string, PendingEdit>>;
  reads: RuntimeReads;
  enumIndex: number;
  onEditChange: (value: string) => void;
}> = ({
  fields,
  selectedIndex,
  editingIndex,
  editValue,
  pendingEdits,
  reads,
  enumIndex,
  onEditChange,
}) => (
  <>
    {fields.map((field, i) => {
      const pending = pendingValueFor(field, pendingEdits[field.key]);
      const committed = valueForField(
        field,
        reads.modelParams,
        reads.ephemeralSettings,
      );
      return (
        <FieldRow
          key={field.key}
          field={field}
          isSelected={selectedIndex === i}
          isEditing={editingIndex === i}
          editValue={editValue}
          currentValue={pending !== undefined ? pending : committed}
          enumIndex={enumIndex}
          onEditChange={onEditChange}
        />
      );
    })}
  </>
);

export const ModelConfigDialog: React.FC<ModelConfigDialogProps> = ({
  onClose,
}) => {
  const runtime = useRuntimeApi();
  const { width } = useResponsive();
  const reads = readRuntimeSnapshot(runtime);
  const fields = buildFields(reads.unallowedParameters);

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [enumIndex, setEnumIndex] = useState(0);
  const { pendingEdits, setPendingEdit, clearPendingEdits } = usePendingEdits();

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
    fields,
    pendingEdits,
    setPendingEdit,
    clearPendingEdits,
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
      <FieldRows
        fields={fields}
        selectedIndex={selectedIndex}
        editingIndex={editingIndex}
        editValue={editValue}
        pendingEdits={pendingEdits}
        reads={reads}
        enumIndex={enumIndex}
        onEditChange={setEditValue}
      />

      {validationError !== null && (
        <Box marginTop={1}>
          <Text color={SemanticColors.status.error}>{validationError}</Text>
        </Box>
      )}

      <DialogFooter isEditing={editingIndex !== null} />
    </Box>
  );
};
