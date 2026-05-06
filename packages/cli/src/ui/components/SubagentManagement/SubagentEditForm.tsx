/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useState, useCallback, useMemo } from 'react';
import { Box, Text } from 'ink';
import { useTextBuffer } from '../shared/text-buffer.js';
import { Colors } from '../../colors.js';
import { useKeypress } from '../../hooks/useKeypress.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import type { SubagentInfo } from './types.js';

interface SubagentEditFormProps {
  subagent: SubagentInfo;
  profiles: string[];
  pendingProfile?: string;
  onSave: (systemPrompt: string, profile: string) => Promise<void>;
  onCancel: () => void;
  onSelectProfile: () => void;
  isFocused?: boolean;
}

type FocusTarget = 'prompt' | 'profile' | 'actions';
type ActionTarget = 'save' | 'cancel';
const _FOCUS_ORDER: FocusTarget[] = ['prompt', 'profile', 'actions'];

function focusIndex(target: FocusTarget): number {
  return _FOCUS_ORDER.indexOf(target);
}

function isKey(
  key: { name?: string; sequence?: string },
  names: readonly string[],
): boolean {
  return names.includes(key.name ?? '') || names.includes(key.sequence ?? '');
}

function nextFocusIndex(current: FocusTarget, dir: 'up' | 'down'): number {
  const i = focusIndex(current);
  return dir === 'up'
    ? Math.max(0, i - 1)
    : Math.min(_FOCUS_ORDER.length - 1, i + 1);
}

function PromptLineRenderer({
  isEditingPrompt,
  promptBuffer,
}: {
  isEditingPrompt: boolean;
  promptBuffer: ReturnType<typeof useTextBuffer>;
}) {
  const renderLineWithCursor = useCallback(
    (line: string, idx: number) => {
      const relativeCursorRow =
        promptBuffer.visualCursor[0] - promptBuffer.visualScrollRow;
      const isCursorLine = idx === relativeCursorRow;
      if (!isCursorLine || !isEditingPrompt)
        return (
          <Text key={idx} color={Colors.Foreground} wrap="truncate-end">
            {line || ' '}
          </Text>
        );
      const col = promptBuffer.visualCursor[1];
      const safeCol = Math.max(0, Math.min(col, line.length));
      const before = line.slice(0, safeCol);
      const at = line[safeCol] ?? ' ';
      const after = line.slice(safeCol + 1);
      return (
        <Text key={idx} color={Colors.Foreground} wrap="truncate-end">
          {before}
          <Text color="#00ff00">{at}</Text>
          {after}
        </Text>
      );
    },
    [isEditingPrompt, promptBuffer.visualCursor, promptBuffer.visualScrollRow],
  );
  const visibleLines = promptBuffer.viewportVisualLines;
  return (
    <>
      {visibleLines.length > 0 ? (
        visibleLines.map(renderLineWithCursor)
      ) : (
        <Text color={Colors.Foreground}> </Text>
      )}
    </>
  );
}

function PromptEditorSection({
  focusTarget,
  isEditingPrompt,
  promptBuffer,
  editorHeight,
  startLine,
  endLine,
  totalVisualLines,
  promptHint,
}: {
  focusTarget: FocusTarget;
  isEditingPrompt: boolean;
  promptBuffer: ReturnType<typeof useTextBuffer>;
  editorHeight: number;
  startLine: number;
  endLine: number;
  totalVisualLines: number;
  promptHint: string | null;
}) {
  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text color={focusTarget === 'prompt' ? '#00ff00' : Colors.Foreground}>
          {focusTarget === 'prompt' ? '→ ' : '  '}1 System Prompt
        </Text>
        {isEditingPrompt && <Text color="#00ff00"> (editing)</Text>}
      </Box>
      <Box marginLeft={4} marginBottom={1}>
        <Text color={Colors.Gray}>
          Lines {startLine}-{endLine} of {totalVisualLines}
        </Text>
      </Box>
      <Box
        marginLeft={4}
        flexDirection="column"
        borderStyle="single"
        borderColor={focusTarget === 'prompt' ? '#00ff00' : Colors.Gray}
        paddingX={1}
        height={editorHeight + 2}
        overflow="hidden"
      >
        <PromptLineRenderer
          isEditingPrompt={isEditingPrompt}
          promptBuffer={promptBuffer}
        />
      </Box>
      {promptHint && (
        <Box marginLeft={4} marginTop={1}>
          <Text color={Colors.Gray}>{promptHint}</Text>
        </Box>
      )}
    </Box>
  );
}

function ProfileSection({
  focusTarget,
  selectedProfile,
  subagentProfile,
  profileHint,
}: {
  focusTarget: FocusTarget;
  selectedProfile: string;
  subagentProfile: string;
  profileHint: string;
}) {
  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text color={focusTarget === 'profile' ? '#00ff00' : Colors.Foreground}>
          {focusTarget === 'profile' ? '→ ' : '  '}2 Profile Assignment
        </Text>
      </Box>
      <Box marginLeft={4}>
        <Text color={Colors.Gray}>Current: </Text>
        <Text color={Colors.Foreground}>{selectedProfile}</Text>
        {selectedProfile !== subagentProfile && (
          <Text color="#ffff00"> (changed)</Text>
        )}
        <Text color={Colors.Gray}>{profileHint}</Text>
      </Box>
    </Box>
  );
}

function ActionsSection({
  focusTarget,
  saveColor,
  cancelColor,
  actionsHint,
}: {
  focusTarget: FocusTarget;
  saveColor: string;
  cancelColor: string;
  actionsHint: string;
}) {
  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text color={focusTarget === 'actions' ? '#00ff00' : Colors.Foreground}>
          {focusTarget === 'actions' ? '→ ' : '  '}3 Actions
        </Text>
      </Box>
      <Box marginLeft={4}>
        <Text color={saveColor}>[ Save ]</Text>
        <Text color={Colors.Gray}> </Text>
        <Text color={cancelColor}>[ Cancel ]</Text>
      </Box>
      {actionsHint && (
        <Box marginLeft={4}>
          <Text color={Colors.Gray}>{actionsHint}</Text>
        </Box>
      )}
    </Box>
  );
}

function useEditingPromptKeys(opts: {
  isFocused: boolean;
  isSaving: boolean;
  isEditingPrompt: boolean;
  promptBuffer: ReturnType<typeof useTextBuffer>;
  setIsEditingPrompt: (v: boolean) => void;
}) {
  useKeypress(
    (key) => {
      if (!opts.isFocused || opts.isSaving || !opts.isEditingPrompt) return;
      if (key.name === 'escape') {
        opts.setIsEditingPrompt(false);
        return;
      }
      opts.promptBuffer.handleInput(key);
    },
    { isActive: opts.isFocused && opts.isEditingPrompt && !opts.isSaving },
  );
}

function useNavKeys(opts: {
  isSaving: boolean;
  isEditingPrompt: boolean;
  focusTarget: FocusTarget;
  selectedAction: ActionTarget;
  moveFocus: (d: 'up' | 'down') => void;
  setIsEditingPrompt: (v: boolean) => void;
  setSelectedAction: (a: ActionTarget) => void;
  onCancel: () => void;
  onSelectProfile: () => void;
  handleSave: () => Promise<void>;
  isFocused: boolean;
}) {
  useKeypress(
    (key) => {
      if (opts.isSaving || opts.isEditingPrompt) return;
      if (key.name === 'escape') {
        opts.onCancel();
        return;
      }
      const isUp = isKey(key, ['up', 'k']);
      const isDown = isKey(key, ['down', 'j']);
      const isLeft = isKey(key, ['left', 'h']);
      const isRight = isKey(key, ['right', 'l']);
      const isActivate = isKey(key, ['return', 'space']);
      if (isUp) {
        opts.moveFocus('up');
        return;
      }
      if (isDown) {
        opts.moveFocus('down');
        return;
      }
      if (opts.focusTarget === 'actions' && isLeft) {
        opts.setSelectedAction('save');
        return;
      }
      if (opts.focusTarget === 'actions' && isRight) {
        opts.setSelectedAction('cancel');
        return;
      }
      if (!isActivate) return;
      if (opts.focusTarget === 'prompt') {
        opts.setIsEditingPrompt(true);
        return;
      }
      if (opts.focusTarget === 'profile') {
        opts.onSelectProfile();
        return;
      }
      if (opts.selectedAction === 'save') {
        void opts.handleSave();
      } else {
        opts.onCancel();
      }
    },
    { isActive: opts.isFocused && !opts.isSaving },
  );
}

function useEditFormState(
  subagent: SubagentInfo,
  pendingProfile: string | undefined,
) {
  const [focusTarget, setFocusTarget] = useState<FocusTarget>('prompt');
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [selectedAction, setSelectedAction] = useState<ActionTarget>('save');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { rows: terminalRows, columns: terminalColumns } = useTerminalSize();
  const selectedProfile = pendingProfile ?? subagent.profile;
  const NON_EDITOR_HEIGHT = 17;
  const editorHeight = Math.max(
    4,
    Math.min(10, terminalRows - NON_EDITOR_HEIGHT),
  );
  const editorWidth = Math.max(20, terminalColumns - 24);
  const promptBuffer = useTextBuffer({
    initialText: subagent.systemPrompt,
    viewport: { width: editorWidth, height: editorHeight },
    isValidPath: () => false,
  });
  const hasChanges =
    promptBuffer.text !== subagent.systemPrompt ||
    selectedProfile !== subagent.profile;
  return {
    focusTarget,
    setFocusTarget,
    isEditingPrompt,
    setIsEditingPrompt,
    selectedAction,
    setSelectedAction,
    isSaving,
    setIsSaving,
    error,
    setError,
    selectedProfile,
    editorHeight,
    promptBuffer,
    hasChanges,
  };
}

function useEditSaveHandler(
  hasChanges: boolean,
  onCancel: () => void,
  onSave: (sp: string, p: string) => Promise<void>,
  promptBuffer: ReturnType<typeof useTextBuffer>,
  selectedProfile: string,
  setIsSaving: (v: boolean) => void,
  setError: (e: string | null) => void,
) {
  return useCallback(async () => {
    if (!hasChanges) {
      onCancel();
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await onSave(promptBuffer.text, selectedProfile);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
      setIsSaving(false);
    }
  }, [
    hasChanges,
    onCancel,
    onSave,
    promptBuffer.text,
    selectedProfile,
    setIsSaving,
    setError,
  ]);
}

function useHints(
  focusTarget: FocusTarget,
  isEditingPrompt: boolean,
  selectedAction: ActionTarget,
  selectedProfile: string,
  subagentProfile: string,
) {
  const promptHint = useMemo(() => {
    if (isEditingPrompt) return '[ESC] Stop editing (changes kept, not saved)';
    if (focusTarget === 'prompt') return '[Enter] Edit prompt';
    return null;
  }, [focusTarget, isEditingPrompt]);

  const profileHint = useMemo(
    () => (focusTarget === 'profile' ? ' [Enter] Change Profile' : ''),
    [focusTarget],
  );

  const actionsHint = useMemo(
    () =>
      focusTarget === 'actions' ? '[←/→] Choose  [Enter/Space] Activate' : '',
    [focusTarget],
  );

  const saveColor =
    focusTarget === 'actions' && selectedAction === 'save'
      ? '#00ff00'
      : Colors.Foreground;
  const cancelColor =
    focusTarget === 'actions' && selectedAction === 'cancel'
      ? '#00ff00'
      : Colors.Foreground;
  const hasProfileChanged = selectedProfile !== subagentProfile;

  return {
    promptHint,
    profileHint,
    actionsHint,
    saveColor,
    cancelColor,
    hasProfileChanged,
  };
}

interface EditFormViewProps {
  subagent: SubagentInfo;
  focusTarget: FocusTarget;
  isEditingPrompt: boolean;
  promptBuffer: ReturnType<typeof useTextBuffer>;
  editorHeight: number;
  startLine: number;
  endLine: number;
  totalVisualLines: number;
  promptHint: string | null;
  selectedProfile: string;
  profileHint: string;
  saveColor: string;
  cancelColor: string;
  actionsHint: string;
  error: string | null;
  isSaving: boolean;
  hasChanges: boolean;
}

function EditFormView({
  subagent,
  focusTarget,
  isEditingPrompt,
  promptBuffer,
  editorHeight,
  startLine,
  endLine,
  totalVisualLines,
  promptHint,
  selectedProfile,
  profileHint,
  saveColor,
  cancelColor,
  actionsHint,
  error,
  isSaving,
  hasChanges,
}: EditFormViewProps) {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={Colors.Foreground}>
          Edit Configuration
        </Text>
      </Box>
      <Text color={Colors.Gray}>
        ──────────────────────────────────────────────────────
      </Text>

      {error && (
        <Box marginBottom={1}>
          <Text color="#ff0000">{error}</Text>
        </Box>
      )}

      <PromptEditorSection
        focusTarget={focusTarget}
        isEditingPrompt={isEditingPrompt}
        promptBuffer={promptBuffer}
        editorHeight={editorHeight}
        startLine={startLine}
        endLine={endLine}
        totalVisualLines={totalVisualLines}
        promptHint={promptHint}
      />
      <ProfileSection
        focusTarget={focusTarget}
        selectedProfile={selectedProfile}
        subagentProfile={subagent.profile}
        profileHint={profileHint}
      />
      <ActionsSection
        focusTarget={focusTarget}
        saveColor={saveColor}
        cancelColor={cancelColor}
        actionsHint={actionsHint}
      />

      <Box flexDirection="column" marginTop={1}>
        <Text color={Colors.Gray}>Controls: ↑↓ move focus, Enter activate</Text>
        <Text color={Colors.Gray}>ESC closes without saving</Text>
        {hasChanges && <Text color="#ffff00">* Unsaved changes</Text>}
      </Box>
      {isSaving && (
        <Box marginTop={1}>
          <Text color={Colors.Gray}>Saving...</Text>
        </Box>
      )}
    </Box>
  );
}

function useEditFormKeys(options: {
  isEditingPrompt: boolean;
  promptBuffer: ReturnType<typeof useTextBuffer>;
  setIsEditingPrompt: (value: boolean) => void;
  isSaving: boolean;
  focusTarget: FocusTarget;
  selectedAction: ActionTarget;
  setSelectedAction: (action: ActionTarget) => void;
  setFocusTarget: (target: FocusTarget) => void;
  onCancel: () => void;
  onSelectProfile: () => void;
  handleSave: () => Promise<void>;
  isFocused: boolean;
}) {
  const moveFocus = useCallback(
    (direction: 'up' | 'down') => {
      options.setFocusTarget(
        _FOCUS_ORDER[nextFocusIndex(options.focusTarget, direction)],
      );
    },
    [options],
  );

  useEditingPromptKeys({
    isFocused: options.isFocused,
    isSaving: options.isSaving,

    isEditingPrompt: options.isEditingPrompt,
    promptBuffer: options.promptBuffer,
    setIsEditingPrompt: options.setIsEditingPrompt,
  });
  useNavKeys({
    isSaving: options.isSaving,
    isEditingPrompt: options.isEditingPrompt,
    focusTarget: options.focusTarget,
    selectedAction: options.selectedAction,
    moveFocus,
    setIsEditingPrompt: options.setIsEditingPrompt,
    setSelectedAction: options.setSelectedAction,
    onCancel: options.onCancel,
    onSelectProfile: options.onSelectProfile,
    handleSave: options.handleSave,
    isFocused: options.isFocused,
  });
}

function useEditFormViewProps(
  subagent: SubagentInfo,
  pendingProfile: string | undefined,
  onCancel: () => void,
  onSave: (systemPrompt: string, profile: string) => Promise<void>,
  onSelectProfile: () => void,
  isFocused: boolean,
): EditFormViewProps {
  const state = useEditFormState(subagent, pendingProfile);
  const handleSave = useEditSaveHandler(
    state.hasChanges,
    onCancel,
    onSave,
    state.promptBuffer,
    state.selectedProfile,
    state.setIsSaving,
    state.setError,
  );

  const totalVisualLines = state.promptBuffer.allVisualLines.length;
  const visibleLines = state.promptBuffer.viewportVisualLines;
  const startLine =
    totalVisualLines > 0 ? state.promptBuffer.visualScrollRow + 1 : 0;
  const endLine =
    totalVisualLines > 0
      ? Math.min(startLine + visibleLines.length - 1, totalVisualLines)
      : 0;

  useEditFormKeys({
    isEditingPrompt: state.isEditingPrompt,
    promptBuffer: state.promptBuffer,
    setIsEditingPrompt: state.setIsEditingPrompt,
    isSaving: state.isSaving,
    focusTarget: state.focusTarget,
    selectedAction: state.selectedAction,
    setSelectedAction: state.setSelectedAction,
    setFocusTarget: state.setFocusTarget,
    onCancel,
    onSelectProfile,
    handleSave,
    isFocused,
  });

  const hints = useHints(
    state.focusTarget,
    state.isEditingPrompt,
    state.selectedAction,
    state.selectedProfile,
    subagent.profile,
  );

  return {
    subagent,
    focusTarget: state.focusTarget,
    isEditingPrompt: state.isEditingPrompt,
    promptBuffer: state.promptBuffer,
    editorHeight: state.editorHeight,
    startLine,
    endLine,
    totalVisualLines,
    promptHint: hints.promptHint,
    selectedProfile: state.selectedProfile,
    profileHint: hints.profileHint,
    saveColor: hints.saveColor,
    cancelColor: hints.cancelColor,
    actionsHint: hints.actionsHint,
    error: state.error,
    isSaving: state.isSaving,
    hasChanges: state.hasChanges,
  };
}

export const SubagentEditForm: React.FC<SubagentEditFormProps> = ({
  subagent,
  profiles: _profiles,
  pendingProfile,
  onSave,
  onCancel,
  onSelectProfile,
  isFocused = true,
}) => {
  const viewProps = useEditFormViewProps(
    subagent,
    pendingProfile,
    onCancel,
    onSave,
    onSelectProfile,
    isFocused,
  );

  return <EditFormView {...viewProps} />;
};
