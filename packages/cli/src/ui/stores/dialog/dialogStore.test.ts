/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  createDialogStore,
  selectActiveDialog,
  selectDialogOpen,
  type DialogCommands,
  type ListDialogKind,
  DIALOG_PRIORITY,
  type DialogKind,
  type DialogRequest,
} from './dialogStore.js';
import { SubagentView } from '../../components/SubagentManagement/types.js';

function prompt(settings?: { prompt?: string }) {
  return { prompt: settings?.prompt ?? 'proceed?', onConfirm: () => {} };
}

const bodyOrder: ListDialogKind[] = [
  'theme',
  'settings',
  'auth',
  'oauthCode',
  'editor',
  'provider',
  'loadProfile',
  'createProfile',
  'profileList',
  'profileDetail',
  'profileEditor',
  'tools',
  'privacy',
  'permissions',
  'logging',
  'subagent',
  'models',
  'sessionBrowser',
  'modelConfig',
  'policies',
];

function open(kinds: DialogKind[]) {
  const { store, commands } = createDialogStore();
  for (const kind of kinds) {
    commands.openDialog({ kind, payload: {} } as DialogRequest);
  }
  return { store, commands };
}

describe('createDialogStore', () => {
  it('opens a dialog and selectActiveDialog reports it', () => {
    const { store, commands } = createDialogStore();
    commands.openDialog({ kind: 'privacy', payload: {} });
    expect(selectActiveDialog(store.getState())).toStrictEqual({
      kind: 'privacy',
      payload: {},
    });
  });

  it('openDialog pushes distinct requests for distinct kinds', () => {
    const { store, commands } = createDialogStore();
    commands.openDialog({ kind: 'privacy', payload: {} });
    commands.openDialog({ kind: 'policies', payload: {} });
    commands.openDialog({ kind: 'models', payload: {} });
    expect(store.getState().requests).toHaveLength(3);
  });

  it('openDialog replaces an open kind in place (no duplicate request)', () => {
    const { store, commands } = createDialogStore();
    const extA = {
      name: 'a',
      version: '1.0.0',
      isActive: true,
      path: 'a',
      contextFiles: [],
    };
    const extB = {
      name: 'b',
      version: '1.0.0',
      isActive: true,
      path: 'b',
      contextFiles: [],
    };
    commands.openDialog({
      kind: 'workspaceMigration',
      payload: { extensions: [extA] },
    });
    commands.openDialog({
      kind: 'workspaceMigration',
      payload: { extensions: [extB] },
    });
    const state = store.getState();
    expect(state.requests).toHaveLength(1);
    expect(state.requests[0]).toStrictEqual({
      kind: 'workspaceMigration',
      payload: { extensions: [extB] },
    });
  });

  it('closeDialog removes only the targeted kind', () => {
    const { store, commands } = createDialogStore();
    commands.openDialog({ kind: 'privacy', payload: {} });
    commands.openDialog({ kind: 'policies', payload: {} });
    commands.closeDialog('privacy');
    expect(selectActiveDialog(store.getState())).toStrictEqual({
      kind: 'policies',
      payload: {},
    });
  });

  it('closeDialog on an absent kind is a no-op', () => {
    const { store, commands } = createDialogStore();
    commands.closeDialog('privacy');
    const state = store.getState();
    expect(state.requests).toHaveLength(0);
    expect(state.confirmationRequest).toBeNull();
  });

  it('updateDialogPayload merges a partial patch over the existing payload', () => {
    const { store, commands } = createDialogStore();
    commands.openDialog({
      kind: 'subagent',
      payload: { initialView: SubagentView.MENU, initialName: 'helper' },
    });
    commands.updateDialogPayload('subagent', { initialName: 'reviewer' });
    expect(store.getState().requests[0]?.payload).toStrictEqual({
      initialView: SubagentView.MENU,
      initialName: 'reviewer',
    });
  });

  it('updateDialogPayload on an absent kind is a no-op', () => {
    const { store, commands } = createDialogStore();
    commands.openDialog({ kind: 'privacy', payload: {} });
    commands.updateDialogPayload('settings', {});
    expect(store.getState().requests).toHaveLength(1);
    expect(store.getState().requests[0]).toStrictEqual({
      kind: 'privacy',
      payload: {},
    });
  });

  it('confirmation request uses the dedicated slot, not the requests list', () => {
    const { store, commands } = createDialogStore();
    commands.setConfirmationRequest({
      kind: 'confirmation',
      payload: prompt(),
    });
    expect(store.getState().requests).toHaveLength(0);
    expect(store.getState().confirmationRequest).toStrictEqual({
      kind: 'confirmation',
      payload: { prompt: 'proceed?', onConfirm: expect.any(Function) },
    });
  });

  it('openDialog (confirmation) uses the dedicated slot, not the requests list', () => {
    const { store, commands } = createDialogStore();
    commands.openDialog({ kind: 'confirmation', payload: prompt() });
    expect(store.getState().requests).toHaveLength(0);
    expect(store.getState().confirmationRequest).toStrictEqual({
      kind: 'confirmation',
      payload: { prompt: 'proceed?', onConfirm: expect.any(Function) },
    });
  });

  it('setConfirmationRequest replaces the previous slot', () => {
    const { store, commands } = createDialogStore();
    commands.setConfirmationRequest({
      kind: 'confirmation',
      payload: prompt(),
    });
    commands.setConfirmationRequest({
      kind: 'confirmation',
      payload: prompt({ prompt: 'second' }),
    });
    expect(store.getState().confirmationRequest).toStrictEqual({
      kind: 'confirmation',
      payload: { prompt: 'second', onConfirm: expect.any(Function) },
    });
  });

  it('setConfirmationRequest(null) clears the slot', () => {
    const { store, commands } = createDialogStore();
    commands.setConfirmationRequest({
      kind: 'confirmation',
      payload: prompt(),
    });
    commands.setConfirmationRequest(null);
    expect(store.getState().confirmationRequest).toBeNull();
  });

  it('extension confirm requests accumulate FIFO and the head renders first', () => {
    const { store, commands } = createDialogStore();
    const first = prompt({ prompt: 'first' });
    const second = prompt({ prompt: 'second' });
    commands.addConfirmUpdateExtensionRequest({
      kind: 'extensionUpdateConfirm',
      payload: first,
    });
    commands.addConfirmUpdateExtensionRequest({
      kind: 'extensionUpdateConfirm',
      payload: second,
    });
    const state = store.getState();
    expect(state.confirmUpdateLlxprtExtensionRequests).toHaveLength(2);
    expect(
      state.confirmUpdateLlxprtExtensionRequests.map((r) => r.payload.prompt),
    ).toStrictEqual(['first', 'second']);
    expect(selectActiveDialog(state)).toStrictEqual({
      kind: 'extensionUpdateConfirm',
      payload: first,
    });
  });

  it('openDialog (extensionUpdateConfirm) appends FIFO too', () => {
    const { store, commands } = createDialogStore();
    commands.openDialog({
      kind: 'extensionUpdateConfirm',
      payload: prompt({ prompt: 'first' }),
    });
    commands.openDialog({
      kind: 'extensionUpdateConfirm',
      payload: prompt({ prompt: 'second' }),
    });
    expect(
      store
        .getState()
        .confirmUpdateLlxprtExtensionRequests.map((r) => r.payload.prompt),
    ).toStrictEqual(['first', 'second']);
  });

  it('resolveConfirmUpdateExtensionRequest removes only that request', () => {
    const { store, commands } = createDialogStore();
    commands.addConfirmUpdateExtensionRequest({
      kind: 'extensionUpdateConfirm',
      payload: prompt({ prompt: 'x' }),
    });
    commands.addConfirmUpdateExtensionRequest({
      kind: 'extensionUpdateConfirm',
      payload: prompt({ prompt: 'y' }),
    });
    const target = store.getState().confirmUpdateLlxprtExtensionRequests[0];
    commands.resolveConfirmUpdateExtensionRequest(target);
    expect(
      store
        .getState()
        .confirmUpdateLlxprtExtensionRequests.map((r) => r.payload.prompt),
    ).toStrictEqual(['y']);
  });

  it('DIALOG_PRIORITY matches the DialogManager if-chain order', () => {
    expect([...DIALOG_PRIORITY]).toStrictEqual([
      'workspaceMigration',
      'idePrompt',
      'folderTrust',
      'welcome',
      'confirmation',
      'extensionUpdateConfirm',
      ...bodyOrder,
    ]);
  });

  it('early dialogs outrank later body dialogs by DIALOG_PRIORITY', () => {
    const { store, commands } = createDialogStore();
    commands.setConfirmationRequest({
      kind: 'confirmation',
      payload: prompt(),
    });
    commands.openDialog({ kind: 'folderTrust', payload: {} });
    expect(selectActiveDialog(store.getState())?.kind).toBe('folderTrust');

    commands.closeDialog('folderTrust');
    expect(selectActiveDialog(store.getState())?.kind).toBe('confirmation');
  });

  it('body dialogs resolve in DialogManager render order', () => {
    const { store, commands } = open(bodyOrder);
    expect(selectActiveDialog(store.getState())?.kind).toBe('theme');
    for (const kind of bodyOrder) {
      commands.closeDialog(kind);
    }
    expect(selectActiveDialog(store.getState())).toBeNull();
  });

  it('reopening a lower-ranked body dialog does not demote the active one', () => {
    const { store, commands } = open(['theme', 'settings']);
    const active = selectActiveDialog(store.getState());
    commands.openDialog({ kind: 'settings', payload: {} });
    expect(store.getState().requests).toHaveLength(2);
    expect(selectActiveDialog(store.getState())).toBe(active);
    expect(active?.kind).toBe('theme');
    commands.closeDialog('theme');
    expect(selectActiveDialog(store.getState())?.kind).toBe('settings');
  });

  it('selectActiveDialog returns null when nothing is open', () => {
    const { store } = createDialogStore();
    expect(selectActiveDialog(store.getState())).toBeNull();
  });
});

describe('store migration regressions', () => {
  it('selects list, confirmation and extension FIFO visibility', () => {
    const { store, commands } = createDialogStore();
    expect(selectDialogOpen(store.getState(), 'theme')).toBe(false);
    commands.openDialog({ kind: 'theme', payload: {} });
    commands.openDialog({ kind: 'confirmation', payload: prompt() });
    const extension = {
      kind: 'extensionUpdateConfirm',
      payload: prompt(),
    } as const;
    commands.openDialog(extension);
    expect(selectDialogOpen(store.getState(), 'theme')).toBe(true);
    expect(selectDialogOpen(store.getState(), 'confirmation')).toBe(true);
    expect(selectDialogOpen(store.getState(), 'extensionUpdateConfirm')).toBe(
      true,
    );
    commands.setConfirmationRequest(null);
    commands.resolveConfirmUpdateExtensionRequest(extension);
    expect(selectDialogOpen(store.getState(), 'confirmation')).toBe(false);
    expect(selectDialogOpen(store.getState(), 'extensionUpdateConfirm')).toBe(
      false,
    );
  });

  it('reserves slot dismissal for the dedicated lifecycle commands', () => {
    const closeExcludesSlots: Extract<
      Parameters<DialogCommands['closeDialog']>[0],
      'confirmation' | 'extensionUpdateConfirm'
    > extends never
      ? true
      : false = true;
    const updateExcludesSlots: Extract<
      Parameters<DialogCommands['updateDialogPayload']>[0],
      'confirmation' | 'extensionUpdateConfirm'
    > extends never
      ? true
      : false = true;
    void closeExcludesSlots;
    void updateExcludesSlots;
    const { store, commands } = createDialogStore();
    commands.openDialog({ kind: 'confirmation', payload: prompt() });
    commands.openDialog({ kind: 'theme', payload: {} });
    commands.closeDialog('theme');
    expect(selectActiveDialog(store.getState())?.kind).toBe('confirmation');
    commands.setConfirmationRequest(null);
    expect(selectActiveDialog(store.getState())).toBeNull();
  });
});
