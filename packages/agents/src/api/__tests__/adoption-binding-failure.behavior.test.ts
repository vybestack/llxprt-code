/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'bun:test';
import { fromConfig } from '../fromConfig.js';
import { SessionClientOwner } from '../../session/session-client-owner.js';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

describe('failed adopted session binding', () => {
  const credentials = useOwnedCredentials();

  it('retires the created session client while retaining caller authority', async () => {
    const caller = await buildCliStyleConfig('plain-text.jsonl');
    await caller.mcpRuntime.workspaceMemory.dispose();
    const retired: SessionClientOwner[] = [];
    const dispose = SessionClientOwner.prototype.dispose;
    const observation = vi
      .spyOn(SessionClientOwner.prototype, 'dispose')
      .mockImplementation(async function (
        this: SessionClientOwner,
      ): Promise<void> {
        await dispose.call(this);
        retired.push(this);
      });
    try {
      const failure = await fromConfig({
        credentialAuthority: credentials().authority,
        config: caller.config,
        settingsOwner: caller.settingsOwner,
        settingsService: caller.settingsService,
        providerManager: caller.providerManager,
        agentClient: caller.agentClient,
        mcpRuntime: caller.mcpRuntime,
        messageBus: caller.messageBus,
      }).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(AggregateError);
      expect(failure).toMatchObject({
        message: 'Workspace memory is disposed',
      });
      expect(retired).toHaveLength(1);
      expect(() => retired[0].getAgentClient()).toThrow('disposed');
      expect(credentials().snapshot()).toStrictEqual([1]);
      caller.settingsOwner.writeUserParameter('maxOutputTokens', 37);
      expect(caller.settingsService.get('maxOutputTokens')).toBe(37);
      expect(caller.agentClient.isInitialized()).toBe(true);
      expect(caller.providerManager.getActiveProviderName()).toBe('fake');
      expect(caller.messageBus.evaluate('read_file', {})).toBeDefined();
    } finally {
      observation.mockRestore();
      await caller.cleanup();
    }
  });
});
