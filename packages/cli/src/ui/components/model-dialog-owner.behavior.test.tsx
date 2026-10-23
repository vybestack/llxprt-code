import { bindModelSwitchRecording } from '../utils/recordActiveProviderSwitch.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { act } from 'react';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { renderHook, waitFor } from '../../__tests__/render.js';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createSessionModelCommand } from '../../runtime/session-model-command.js';
import { createDialogStore } from '../stores/dialog/dialogStore.js';
import { useModelDialogHandler } from './modelDialogHandler.js';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

function createOwnedModelSelection(agent: Agent) {
  const store = createDialogStore();
  store.commands.openDialog({ kind: 'models', payload: {} });
  const useSelection = () =>
    useModelDialogHandler(
      {
        setActiveModel: createSessionModelCommand(agent),
        setProvider: async () => {
          throw new Error('Unexpected provider switch');
        },
        providerStatus: () => ({ providerName: agent.getProvider() }),
      },
      (item) => {
        if (item.type === 'error') throw new Error(item.text);
        return 0;
      },
      store,
      'fake',
      bindModelSwitchRecording(
        'agent',
        (event) => agent.session.recordRecordingEvent(event),
        undefined,
      ),
    );
  const { result, unmount } = renderHook(useSelection);
  return { result, store, unmount };
}

async function select(agent: Agent, model: string): Promise<void> {
  const hook = createOwnedModelSelection(agent);
  await act(async () => {
    hook.result.current({
      id: model,
      name: model,
      provider: 'fake',
      supportedToolFormats: [],
    });
  });
  await waitFor(() => {
    expect(
      hook.store.store
        .getState()
        .requests.some((dialog) => dialog.kind === 'modelConfig'),
    ).toBe(true);
  });
  hook.unmount();
}

describe('model dialog recording owner', () => {
  const makeOwner = useCommandOwners();
  it('records model selection through captured session operations and preserves its sibling', async () => {
    const owner = await makeOwner('owner');
    const sibling = await makeOwner('sibling');
    await owner.chat('initialize owner', { mcpDiscovery: 'skip' });
    await sibling.chat('initialize sibling', { mcpDiscovery: 'skip' });
    await owner.session.setRecording({ enabled: true });
    await sibling.session.setRecording({ enabled: true });
    await select(owner, 'owner-dialog-model');
    const ownerPath = owner.session.getRecording().path;
    const siblingPath = sibling.session.getRecording().path;
    if (!ownerPath || !siblingPath) throw new Error('Missing recording paths');
    expect(await readFile(ownerPath, 'utf8')).toContain('owner-dialog-model');
    expect(await readFile(siblingPath, 'utf8')).not.toContain(
      'owner-dialog-model',
    );
    await owner.dispose();
    await select(sibling, 'sibling-dialog-model');
    expect(await readFile(siblingPath, 'utf8')).toContain(
      'sibling-dialog-model',
    );
  });
});
