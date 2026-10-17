/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'bun:test';
import { act } from 'react';
import { readFile } from 'node:fs/promises';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { renderHook } from '../../__tests__/render.js';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createDialogStore } from '../stores/dialog/dialogStore.js';
import { createDialogOpeners } from '../stores/dialog/dialogOpeners.js';

let ambientAgent: Agent | undefined;
function requireAmbientAgent(): Agent {
  if (!ambientAgent) throw new Error('Missing conflicting provider owner');
  return ambientAgent;
}
const selectedRuntimeMock1 = (() =>
  (() => {
    const useSelectedTestRuntime = () => ({
      listProviders: () => [requireAmbientAgent().getProvider()],
      getActiveProviderName: () => requireAmbientAgent().getProvider(),
      getActiveModelName: () => requireAmbientAgent().getModel(),
      setProvider: (name: string) => requireAmbientAgent().setProvider(name),
    });
    return {
      useListProviders: () => useSelectedTestRuntime().listProviders,
      useGetActiveProviderName: () =>
        useSelectedTestRuntime().getActiveProviderName,

      useGetActiveModelName: () => useSelectedTestRuntime().getActiveModelName,

      useSetProvider: () => useSelectedTestRuntime().setProvider,

      useRuntimeApi: useSelectedTestRuntime,
    };
  })())();
void vi.mock('../contexts/RuntimeContext.js', () => selectedRuntimeMock1);
void vi.mock(
  '../../__tests__/runtime-context-fixture.js',
  () => selectedRuntimeMock1,
);
const { useProviderDialog } = await import('./useProviderDialog.js');

async function beginRecording(agent: Agent): Promise<string> {
  await agent.setHistory([
    { speaker: 'human', blocks: [{ type: 'text', text: 'begin' }] },
  ]);
  await agent.session.setRecording({ enabled: true });
  const path = agent.session.getRecording().path;
  if (!path) throw new Error('Missing provider recording path');
  return path;
}

describe('provider dialog owner', () => {
  const makeOwner = useCommandOwners();
  it('records with captured provider and session operations through mounted owner replacement', async () => {
    const owner = await makeOwner('provider-dialog-owner');
    const sibling = await makeOwner('provider-dialog-sibling');
    const ownerPath = await beginRecording(owner);
    const siblingPath = await beginRecording(sibling);
    const store = createDialogStore();
    const dialogs = createDialogOpeners(store);
    ambientAgent = sibling;
    const hook = renderHook(
      ({ agent, decoy }: { agent: Agent; decoy: Agent }) =>
        useProviderDialog({
          ...{ agent: decoy, recordingOwner: 'agent', dialogs },
          addMessage: () => {},
          listProviders: () => [agent.getProvider()],
          getActiveProviderName: () => agent.getProvider(),
          setProvider: (name: string) =>
            agent.setProvider(name, agent.getModel()),
          getActiveModelName: () => agent.getModel(),
          recordProviderSwitch: (provider: string, model: string) =>
            agent.session.recordRecordingEvent({
              type: 'provider_switch',
              provider,
              model,
            }),
          openProviderDialog: () => dialogs.provider.open({}),
          closeProviderDialog: () => dialogs.provider.close(),
        }),
      { initialProps: { agent: owner, decoy: sibling } },
    );
    try {
      await act(async () => {
        await hook.result.current.handleSelect('fake');
      });
      expect(
        (await readFile(ownerPath, 'utf8'))
          .split('\n')
          .filter((line) => line.includes('provider_switch')),
      ).toHaveLength(1);
      expect(await readFile(ownerPath, 'utf8')).toContain(owner.getModel());
      expect(await readFile(siblingPath, 'utf8')).not.toContain(
        'provider_switch',
      );
      await owner.dispose();
      ambientAgent = owner;
      hook.rerender({ agent: sibling, decoy: owner });
      await act(async () => {
        await hook.result.current.handleSelect('fake');
      });
      expect(
        (await readFile(siblingPath, 'utf8'))
          .split('\n')
          .filter((line) => line.includes('provider_switch')),
      ).toHaveLength(1);
      expect(hook.result.current.currentProvider).toBe(sibling.getProvider());
    } finally {
      hook.unmount();
      ambientAgent = undefined;
    }
  });
});
