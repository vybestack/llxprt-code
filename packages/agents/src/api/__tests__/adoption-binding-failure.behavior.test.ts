/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'bun:test';
import { fromConfig } from '../fromConfig.js';
import { SessionClientOwner } from '../../session/session-client-owner.js';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';

describe('failed adopted session binding', () => {
  it('retires the created session client while retaining caller authority', async () => {
    const caller = await buildCliStyleConfig('plain-text.jsonl');
    let created: readonly SessionClientOwner[] = [];
    const failure = new Error('Session binding failed');
    const binding = vi
      .spyOn(SessionClientOwner.prototype, 'bindMcpRuntime')
      .mockImplementation(function (this: SessionClientOwner): void {
        created = [...created, this];
        throw failure;
      });
    try {
      await expect(
        fromConfig({
          config: caller.config,
          settingsOwner: caller.settingsOwner,
          settingsService: caller.settingsService,
          providerManager: caller.providerManager,
          agentClient: caller.agentClient,
          mcpRuntime: caller.mcpRuntime,
          messageBus: caller.messageBus,
        }),
      ).rejects.toBe(failure);
      const retiring = created.slice(-1).pop();
      if (retiring === undefined) throw new Error('No session reached binding');
      expect(() => retiring.getAgentClient()).toThrow('disposed');
      caller.settingsOwner.writeUserParameter('maxOutputTokens', 37);
      expect(caller.settingsService.get('maxOutputTokens')).toBe(37);
      expect(caller.agentClient.isInitialized()).toBe(true);
    } finally {
      binding.mockRestore();
      await created.slice(-1).pop()?.dispose();
      await caller.cleanup();
    }
  });
});
