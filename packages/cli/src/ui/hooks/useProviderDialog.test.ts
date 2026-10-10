/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'bun:test';
import { act } from 'react';
import { renderHook } from '../../__tests__/render.js';
import { hasDialogRequest } from '../../__tests__/dialogStore.js';
import { createDialogStore } from '../stores/dialog/dialogStore.js';
import { createDialogOpeners } from '../stores/dialog/dialogOpeners.js';
import { MessageType } from '../types.js';
import { readFile } from 'node:fs/promises';
import { withRecordingLifetimeFixture } from '../../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';

// The provider service is the external boundary; dialog and message delivery stay real.
const runtime = {
  getActiveProviderName: () => 'old',
  getActiveModelName: () => 'fallback-model',
  setProvider: async (name: string) => ({
    nextProvider: name.trim(),
    infoMessages: [
      'Endpoint: https://example.test',
      'Selected model: example',
      'Set an API key with /key',
    ],
  }),
};
void vi.mock('../contexts/RuntimeContext.js', () => ({
  useRuntimeApi: () => runtime,
}));
const { useProviderDialog } = await import('./useProviderDialog.js');

describe('provider switch notices', () => {
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
        dialogs,
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
    await withRecordingLifetimeFixture(async ({ agent }) => {
      await agent.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'start' }] },
      ]);
      await agent.session.setRecording({ enabled: true });
      const path = agent.session.getRecording().path;
      if (!path) throw new Error('No recording path');
      const store = createDialogStore();
      const rawWrite = vi.fn();
      const { result, unmount } = renderHook(() =>
        useProviderDialog({
          dialogs: createDialogOpeners(store),
          addMessage: () => {},
          recordingOwner: 'agent',
          agent,
          recordingIntegration: { recordProviderSwitch: rawWrite } as never,
        }),
      );
      await act(async () => {
        await result.current.handleSelect('owner-provider');
      });
      const lines = (await readFile(path, 'utf8')).split('\n');
      expect(
        lines.filter((line) => line.includes('provider_switch')),
      ).toHaveLength(1);
      expect(lines.join('\n')).toContain('owner-provider');
      expect(rawWrite).not.toHaveBeenCalled();
      unmount();
    });
  }, 30000);
});
