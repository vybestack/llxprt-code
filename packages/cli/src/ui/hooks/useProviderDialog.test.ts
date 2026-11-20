import { openRouteAAgent } from '../../../../agents/src/api/__tests__/helpers/route-a-agent.js';
import { useFakeResponsesReplay } from '../../../../agents/src/api/__tests__/helpers/fake-responses-replay.js';
import { describe, expect, it, vi } from 'bun:test';
import { act } from 'react';
import { renderHook } from '../../__tests__/render.js';
import { hasDialogRequest } from '../../__tests__/dialogStore.js';
import { createDialogStore } from '../stores/dialog/dialogStore.js';
import { createDialogOpeners } from '../stores/dialog/dialogOpeners.js';
import { MessageType } from '../types.js';
import { bindModelSwitchRecording } from '../utils/recordActiveProviderSwitch.js';
import { readRecordedFacts } from '../../__tests__/journal-recording.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// The provider service is the external boundary; dialog and message delivery stay real.
const runtime = {
  getActiveProviderName: () => 'old',
  getActiveModelName: () => 'fallback-model',
  listProviders: () => ['old', 'new'],
  setProvider: async (name: string) => ({
    changed: true,
    previousProvider: 'old',
    nextProvider: name.trim(),
    infoMessages: [
      'Endpoint: https://example.test',
      'Selected model: example',
      'Set an API key with /key',
    ],
  }),
};
const selectedRuntimeMock1 = (() =>
  (() => {
    const useSelectedTestRuntime = () => runtime;
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

describe('provider switch notices', () => {
  useFakeResponsesReplay('multi-turn-text.jsonl');
  it('delivers endpoint, model and authentication notices to the message history', async () => {
    const messages: Array<{
      type: MessageType;
      content: string;
      timestamp: Date;
    }> = [];
    const store = createDialogStore();
    const dialogs = createDialogOpeners(store);
    dialogs.provider.open({});
    const { result, unmount } = renderHook(() =>
      useProviderDialog({
        ...runtime,
        recordProviderSwitch: () => {},
        openProviderDialog: () => dialogs.provider.open({}),
        closeProviderDialog: dialogs.provider.close,
        addMessage: (message) => messages.push(message),
      }),
    );
    await act(async () => {
      await result.current.handleSelect('  new  ');
    });
    expect(messages.map((message) => message.content)).toStrictEqual([
      'Switched from old to new',
      'Endpoint: https://example.test',
      'Selected model: example',
      'Set an API key with /key',
    ]);
    expect(messages.every((message) => message.type === MessageType.INFO)).toBe(
      true,
    );
    expect(hasDialogRequest(store, 'provider')).toBe(false);
    unmount();
  });
  it('records a provider selection in the Agent session exactly once', async () => {
    const route = await openRouteAAgent({ config: { interactive: true } });
    try {
      const { agent } = route;
      await agent.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'start' }] },
      ]);
      await agent.session.setRecording({ enabled: true });
      const path = agent.session.getRecording().path;
      if (!path) throw new Error('No recording path');
      const store = createDialogStore();
      const rawWrite = vi.fn();
      const recordedProviders: string[] = [];
      const recordProviderSwitch = bindModelSwitchRecording(
        'agent',
        (event) => {
          recordedProviders.push(event.provider);
          return agent.session.recordRecordingEvent(event);
        },
        { recordProviderSwitch: rawWrite },
      );
      const { result, unmount } = renderHook(() =>
        useProviderDialog({
          ...runtime,
          addMessage: () => {},
          recordProviderSwitch,
          openProviderDialog: () =>
            store.commands.openDialog({ kind: 'provider', payload: {} }),
          closeProviderDialog: () => store.commands.closeDialog('provider'),
        }),
      );
      await act(async () => {
        await result.current.handleSelect('owner-provider');
      });
      expect(await readRecordedFacts(path)).toMatchObject({
        provider: 'owner-provider',
        model: 'fallback-model',
      });
      expect(recordedProviders).toStrictEqual(['owner-provider']);
      expect(rawWrite).not.toHaveBeenCalled();
      unmount();
    } finally {
      await route.close();
    }
  }, 30000);
});
