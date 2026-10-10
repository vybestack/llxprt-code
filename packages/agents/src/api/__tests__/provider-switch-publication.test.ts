/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import {
  coreEvents,
  CoreEvent,
} from '@vybestack/llxprt-code-core/utils/events.js';
import { useProfileOwner } from './helpers/profile-owner-fixture.js';

describe('provider switch commit publication', () => {
  const owner = useProfileOwner();

  it('retains the committed provider and replacement client when a publication observer fails', async () => {
    const current = owner();
    const previous = current.sessionClient.getAgentClient();
    const failure = new Error('publication observer rejected');
    const observe = (): never => {
      throw failure;
    };
    coreEvents.on(CoreEvent.ModelProfileChanged, observe);
    try {
      await expect(current.switchProvider('anthropic')).rejects.toBe(failure);
      expect(current.manager.getActiveProviderName()).toBe('anthropic');
      expect(current.settingsOwner.readSelectedProvider()).toBe('anthropic');
      expect(current.agentClient).not.toBe(previous);
      await current.agentClient.startChat();
      expect(current.agentClient.hasChatInitialized()).toBe(true);
      expect(current.settings.getProviderSettings('anthropic').model).toBe(
        current.settingsOwner.readSelectedModel(),
      );
    } finally {
      coreEvents.off(CoreEvent.ModelProfileChanged, observe);
    }
  });
});
