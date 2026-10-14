/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { finalizeAgent } from '../createAgent.js';
import {
  createSessionClientEngineFixture,
  engineGate,
} from './helpers/session-client-engine-fixture.js';

describe('Agent finalization collaborators', () => {
  it('binds the supplied settings and joins concurrent disposal through one close operation', async () => {
    const built = await createSessionClientEngineFixture();
    const closing = engineGate();
    const release = engineGate();
    let releases = 0;
    built.owner.bindProviderFiles(
      built.handle.providerFileLifecycle,
      (provider) => built.handle.oauthManager.composeRetryOperations(provider),
    );
    const agent = await finalizeAgent(
      { provider: 'fake', model: 'fake-model' },
      { baseUrl: undefined },
      built.config,
      built.handle.providerManager,
      built.handle.oauthManager,
      built.settingsService,
      built.handle.runtimeId,
      built.handle.settingsOwner,
      () => built.handle.readRuntimeKind(),
      async () => {
        releases += 1;
        closing.release();
        await release.promise;
        await built.handle.cleanup();
      },
      undefined,
      undefined,
      undefined,
      [],
      'caller',
      undefined,
      built.mcp,
      undefined,
      undefined,
      'facade',
      undefined,
      built.owner,
      built.mcp.workspaceSkills.operations,
    );
    try {
      await agent.setModel('finalized-model');
      expect(built.handle.settingsOwner.readSelectedModel()).toBe(
        agent.getModel(),
      );
      await agent.setHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'finalized history' }],
        },
      ]);
      expect(await built.owner.getAgentClient().getHistory()).toStrictEqual(
        await agent.getHistory(),
      );
      let completed = 0;
      const first = agent.dispose().then(() => {
        completed += 1;
      });
      await closing.promise;
      const second = agent.dispose().then(() => {
        completed += 1;
      });
      expect(completed).toBe(0);
      expect(await built.media.store.getStoredByteLength()).toBe(0);
      release.release();
      await Promise.all([first, second]);
      await agent.dispose();
      expect({ completed, releases }).toStrictEqual({
        completed: 2,
        releases: 1,
      });
      expect(await built.media.store.getStoredByteLength()).toBe(0);
    } finally {
      release.release();
      await agent.dispose();
      await built.cleanup();
    }
  });
});
