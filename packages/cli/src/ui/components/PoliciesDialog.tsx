/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import {
  PolicyDecision,
  type ApprovalMode,
  type PolicyEngine,
  type PolicyRule,
  listEditableRules,
  addEditableRule,
  updateEditableRule,
  deleteEditableRule,
  duplicateEditableRule,
  reloadUserPolicyRules,
  type EditablePolicyRule,
} from '@vybestack/llxprt-code-core';
import { Colors } from '../colors.js';
import { theme } from '../semantic-colors.js';
import { RadioButtonSelect } from './shared/RadioButtonSelect.js';
import { useKeypress } from '../hooks/useKeypress.js';
import { getBorderStyle } from '../contexts/UnicodeRenderingContext.js';
import type { HistoryItemWithoutId } from '../types.js';
import { MessageType } from '../types.js';
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
import {
  PolicyForm,
  PolicyStackView,
  buildMenuItems,
  ruleSummary,
  ACTION_ITEMS,
  type MenuItem,
} from './policiesDialogViews.js';

/** Narrow runtime surface the dialog depends on. */
export interface PoliciesDialogRuntime {
  getPolicyEngine(): PolicyEngine;
  getApprovalMode(): ApprovalMode;
}

interface PoliciesDialogProps {
  config?: PoliciesDialogRuntime;
  addItem: UseHistoryManagerReturn['addItem'];
  onExit: () => void;
}

type View = 'menu' | 'actions' | 'form' | 'stack';

interface DialogState {
  view: View;
  rules: EditablePolicyRule[];
  engineRules: readonly PolicyRule[];
  selectedIndex: number;
  formMode: 'add' | 'edit';
  message: string | null;
  messageType: MessageType | null;
  busy: boolean;
}

function initialDialogState(): DialogState {
  return {
    view: 'menu',
    rules: [],
    engineRules: [],
    selectedIndex: -1,
    formMode: 'add',
    message: null,
    messageType: null,
    busy: false,
  };
}

/** Extract a human-readable detail string from a caught error. */
function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface RunMutationDeps {
  busyRef: React.MutableRefObject<boolean>;
  mountedRef: React.MutableRefObject<boolean>;
  patch: (p: Partial<DialogState>) => void;
  refreshRules: () => Promise<void>;
  recordMessage: (type: MessageType, text: string) => void;
}

/** Execute a mutation, then refresh. Report distinct errors for each phase. */
function makeRunMutation(deps: RunMutationDeps) {
  const { busyRef, mountedRef, patch, refreshRules, recordMessage } = deps;
  return async (label: string, fn: () => Promise<void>): Promise<void> => {
    if (busyRef.current) return;
    busyRef.current = true;
    patch({ busy: true });
    try {
      await fn();
    } catch (error) {
      if (!mountedRef.current) return;
      recordMessage(
        MessageType.ERROR,
        `Policy update failed: ${errorDetail(error)}`,
      );
      return;
    } finally {
      busyRef.current = false;
      if (mountedRef.current) patch({ busy: false });
    }
    // Mutation succeeded; refresh may still fail. Report a distinct error
    // so the user knows the change was written but the display is stale.
    try {
      await refreshRules();
    } catch (error) {
      if (!mountedRef.current) return;
      recordMessage(
        MessageType.ERROR,
        `Policy: ${label}. Refresh failed: ${errorDetail(error)}`,
      );
      return;
    }
    if (!mountedRef.current) return;
    recordMessage(MessageType.INFO, `Policy: ${label}`);
    patch({ view: 'menu', selectedIndex: -1 });
  };
}

interface PoliciesDialogStateProps {
  engine: PolicyEngine | undefined;
  approvalMode: ApprovalMode;
  addItem: UseHistoryManagerReturn['addItem'];
}

function usePoliciesDialogState({
  engine,
  approvalMode,
  addItem,
}: PoliciesDialogStateProps) {
  const [state, setState] = useState<DialogState>(initialDialogState);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const patch = useCallback(
    (p: Partial<DialogState>) => setState((s) => ({ ...s, ...p })),
    [],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshRules = useCallback(async () => {
    if (engine === undefined) return;
    const editable = await listEditableRules();
    await reloadUserPolicyRules(engine, approvalMode);
    if (!mountedRef.current) return;
    patch({ rules: editable, engineRules: engine.getRules() });
  }, [engine, approvalMode, patch]);

  useEffect(() => {
    void refreshRules().catch((error) => {
      if (!mountedRef.current) return;
      patch({
        message: `Policy refresh failed: ${errorDetail(error)}`,
        messageType: MessageType.ERROR,
      });
    });
  }, [refreshRules, patch]);

  const recordMessage = useCallback(
    (type: MessageType, text: string) => {
      patch({ message: text, messageType: type });
      addItem({ type, text } as HistoryItemWithoutId, Date.now());
    },
    [addItem, patch],
  );

  const runMutation = useMemo(
    () =>
      makeRunMutation({
        busyRef,
        mountedRef,
        patch,
        refreshRules,
        recordMessage,
      }),
    [refreshRules, recordMessage, patch],
  );

  const handleAdd = useCallback(
    (rule: EditablePolicyRule) => {
      void runMutation(`added ${ruleSummary(rule)}`, async () => {
        await addEditableRule(rule);
      });
    },
    [runMutation],
  );

  return { state, patch, refreshRules, runMutation, handleAdd, recordMessage };
}

function useMutationHandlers(
  state: DialogState,
  runMutation: (label: string, fn: () => Promise<void>) => Promise<void>,
  patch: (p: Partial<DialogState>) => void,
) {
  const handleEdit = useCallback(
    (rule: EditablePolicyRule) => {
      void runMutation(`updated to ${ruleSummary(rule)}`, async () => {
        await updateEditableRule(state.selectedIndex, rule);
      });
    },
    [runMutation, state.selectedIndex],
  );

  const handleDelete = useCallback(() => {
    if (state.selectedIndex < 0 || state.selectedIndex >= state.rules.length) {
      return;
    }
    const target = state.rules[state.selectedIndex];
    void runMutation(`deleted ${ruleSummary(target)}`, () =>
      deleteEditableRule(state.selectedIndex),
    );
  }, [state.rules, state.selectedIndex, runMutation]);

  const handleDuplicate = useCallback(() => {
    void runMutation(
      `duplicated rule #${state.selectedIndex + 1}`,
      async () => {
        await duplicateEditableRule(state.selectedIndex);
      },
    );
  }, [state.selectedIndex, runMutation]);

  const handleMenuSelect = useCallback(
    (value: string) => {
      if (value === '__add__') {
        patch({ formMode: 'add', view: 'form' });
      } else if (value === '__stack__') {
        patch({ view: 'stack' });
      } else if (value === '__close__') {
        // Close handled by parent via onExit
      } else {
        patch({
          selectedIndex: Number.parseInt(value, 10),
          view: 'actions',
        });
      }
    },
    [patch],
  );

  const handleActionSelect = useCallback(
    (value: string) => {
      if (value === 'edit') {
        patch({ formMode: 'edit', view: 'form' });
      } else if (value === 'delete') {
        handleDelete();
      } else if (value === 'duplicate') {
        handleDuplicate();
      } else {
        patch({ view: 'menu' });
      }
    },
    [patch, handleDelete, handleDuplicate],
  );

  return {
    handleEdit,
    handleDelete,
    handleDuplicate,
    handleMenuSelect,
    handleActionSelect,
  };
}

export const PoliciesDialog: React.FC<PoliciesDialogProps> = ({
  config,
  addItem,
  onExit,
}) => {
  const engine = config?.getPolicyEngine();
  const approvalMode = config?.getApprovalMode() ?? ('default' as ApprovalMode);
  const { state, patch, runMutation, handleAdd } = usePoliciesDialogState({
    engine,
    approvalMode,
    addItem,
  });
  const { handleEdit, handleMenuSelect, handleActionSelect } =
    useMutationHandlers(state, runMutation, patch);

  useKeypress(
    (key) => {
      if (state.busy) return;
      if (key.name === 'escape') {
        if (state.view === 'menu') {
          onExit();
        } else if (state.view !== 'form') {
          patch({ view: 'menu' });
        }
      }
    },
    { isActive: state.view !== 'form' },
  );

  if (engine === undefined) {
    return (
      <Box marginLeft={1}>
        <Text color={theme.status.error}>
          Policy engine not available. Cannot manage policies.
        </Text>
      </Box>
    );
  }

  return (
    <PolicyDialogShell
      state={state}
      menuItems={buildMenuItems(state.rules)}
      onMenuSelect={(v) => {
        if (v === '__close__') onExit();
        else handleMenuSelect(v);
      }}
      onActionSelect={handleActionSelect}
      onAdd={handleAdd}
      onEdit={handleEdit}
      onCancel={() => patch({ view: 'menu' })}
      onStackBack={() => patch({ view: 'menu' })}
    />
  );
};

interface PolicyDialogShellProps {
  state: DialogState;
  menuItems: MenuItem[];
  onMenuSelect: (value: string) => void;
  onActionSelect: (value: string) => void;
  onAdd: (rule: EditablePolicyRule) => void;
  onEdit: (rule: EditablePolicyRule) => void;
  onCancel: () => void;
  onStackBack: () => void;
}

const PolicyDialogShell: React.FC<PolicyDialogShellProps> = (props) => {
  const {
    state,
    menuItems,
    onMenuSelect,
    onActionSelect,
    onAdd,
    onEdit,
    onCancel,
    onStackBack,
  } = props;

  return (
    <Box flexDirection="column">
      <Box
        flexDirection="column"
        borderStyle={getBorderStyle('round')}
        borderColor={Colors.AccentBlue}
        padding={1}
        width="100%"
      >
        <DialogHeader message={state.message} messageType={state.messageType} />

        {state.view === 'menu' && (
          <MenuView
            rules={state.rules}
            menuItems={menuItems}
            onSelect={onMenuSelect}
            busy={state.busy}
          />
        )}

        {state.view === 'actions' && (
          <ActionsView
            rules={state.rules}
            selectedIndex={state.selectedIndex}
            onSelect={onActionSelect}
            busy={state.busy}
          />
        )}

        {state.view === 'form' && (
          <Box marginTop={1}>
            <PolicyForm
              title={state.formMode === 'add' ? 'Add Rule' : 'Edit Rule'}
              initial={
                state.formMode === 'edit' &&
                state.selectedIndex >= 0 &&
                state.selectedIndex < state.rules.length
                  ? state.rules[state.selectedIndex]
                  : {
                      toolName: '',
                      decision: PolicyDecision.ALLOW,
                      priority: 100,
                    }
              }
              onSubmit={state.formMode === 'add' ? onAdd : onEdit}
              onCancel={onCancel}
            />
          </Box>
        )}

        {state.view === 'stack' && (
          <StackView rules={state.engineRules} onBack={onStackBack} />
        )}

        {state.busy && (
          <Box marginTop={1}>
            <Text color={Colors.AccentYellow}>{'Applying\u2026'}</Text>
          </Box>
        )}
      </Box>
      <Box marginLeft={1} marginTop={1}>
        <Text color={Colors.Gray}>
          (Use arrow keys to navigate, Enter to select, Esc to go back/exit)
        </Text>
      </Box>
    </Box>
  );
};

const DialogHeader: React.FC<{
  message: string | null;
  messageType: MessageType | null;
}> = ({ message, messageType }) => (
  <>
    <Text color={Colors.Foreground} bold>
      Policy Manager
    </Text>
    <Text color={Colors.Comment}>
      Editable overrides (auto-saved.toml) apply immediately. Default &amp;
      system tiers are read-only.
    </Text>
    {message !== null && (
      <Box marginTop={1}>
        <Text
          color={
            messageType === MessageType.ERROR
              ? theme.status.error
              : Colors.AccentGreen
          }
        >
          {message}
        </Text>
      </Box>
    )}
  </>
);

const MenuView: React.FC<{
  rules: readonly EditablePolicyRule[];
  menuItems: MenuItem[];
  onSelect: (value: string) => void;
  busy: boolean;
}> = ({ rules, menuItems, onSelect, busy }) => (
  <Box marginTop={1} flexDirection="column">
    {rules.length === 0 && (
      <Text color={Colors.Comment}>
        No user overrides yet. Add a rule to get started.
      </Text>
    )}
    <RadioButtonSelect
      items={menuItems}
      onSelect={onSelect}
      isFocused={!busy}
    />
  </Box>
);

const ActionsView: React.FC<{
  rules: readonly EditablePolicyRule[];
  selectedIndex: number;
  onSelect: (value: string) => void;
  busy: boolean;
}> = ({ rules, selectedIndex, onSelect, busy }) => {
  const inBounds = selectedIndex >= 0 && selectedIndex < rules.length;
  return (
    <Box marginTop={1} flexDirection="column">
      <Text color={Colors.AccentCyan}>
        Selected: {inBounds ? ruleSummary(rules[selectedIndex]) : '(none)'}
      </Text>
      <RadioButtonSelect
        items={ACTION_ITEMS}
        onSelect={onSelect}
        isFocused={!busy}
      />
    </Box>
  );
};

const StackView: React.FC<{
  rules: readonly PolicyRule[];
  onBack: () => void;
}> = ({ rules, onBack }) => (
  <Box marginTop={1} flexDirection="column">
    <PolicyStackView rules={rules} />
    <Box marginTop={1}>
      <Text color={Colors.Gray}>(Esc or Enter to go back to the menu)</Text>
    </Box>
    <StackBackHandler onBack={onBack} />
  </Box>
);

const StackBackHandler: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  useKeypress(
    (key) => {
      if (key.name === 'return') {
        onBack();
      }
    },
    { isActive: true },
  );
  return null;
};
