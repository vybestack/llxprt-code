/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { act } from 'react';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { renderHook } from '../../__tests__/render.js';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createDialogStore } from '../stores/dialog/dialogStore.js';
import { createDialogOpeners } from '../stores/dialog/dialogOpeners.js';
import { useToolsDialog } from './useToolsDialog.js';

async function disableReadFile(owner: Agent, decoy: Agent): Promise<void> {
  const store = createDialogStore();
  const context = createMockCommandContext({ services: { agent: decoy } });
  if (context.services.config === null)
    throw new Error('Missing fixture config');
  const config = context.services.config;
  const hook = renderHook(() =>
    useToolsDialog({
      ...{ agent: decoy, config, dialogs: createDialogOpeners(store) },
      addMessage: () => {},
      listTools: () => owner.tools.list(),
      readDisabledTools: () => owner.getEphemeralSettings()['tools.disabled'],
      writeDisabledTools: (names: string[]) =>
        owner.setEphemeralSetting('tools.disabled', names),
      openToolsDialog: (action: 'enable' | 'disable') =>
        store.commands.openDialog({ kind: 'tools', payload: { action } }),
      closeToolsDialog: () => store.commands.closeDialog('tools'),
    }),
  );
  try {
    await act(async () => {
      await hook.result.current.openDialog('disable');
    });
    act(() => {
      hook.result.current.handleSelect('read_file');
    });
  } finally {
    hook.unmount();
  }
}

describe('tool dialog captured owner', () => {
  const makeOwner = useCommandOwners();
  it('changes only the captured tool policy and leaves a sibling usable after disposal', async () => {
    const owner = await makeOwner('tool-dialog-owner');
    const sibling = await makeOwner('tool-dialog-sibling');
    await disableReadFile(owner, sibling);
    expect(owner.getEphemeralSettings()['tools.disabled']).toContain(
      'read_file',
    );
    expect(sibling.getEphemeralSettings()['tools.disabled']).toBeUndefined();
    await owner.dispose();
    await disableReadFile(sibling, owner);
    expect(sibling.getEphemeralSettings()['tools.disabled']).toContain(
      'read_file',
    );
  });
});
