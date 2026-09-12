/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'bun:test';
import { act } from 'react';
import { renderHook } from '../../test-utils/render.js';
import { hasDialogRequest } from '../../test-utils/dialogStore.js';
import { createDialogStore } from '../stores/dialog/dialogStore.js';
import { createDialogOpeners } from '../stores/dialog/dialogOpeners.js';
import { MessageType } from '../types.js';

// The provider service is the external boundary; dialog and message delivery stay real.
const runtime = {
  getActiveProviderName: () => 'old',
  setProvider: async (name: string) => ({
    nextProvider: name,
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
      await result.current.handleSelect('new');
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
});
