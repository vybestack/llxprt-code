/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { buildAgent } from './helpers/agentHarness.js';
import { gate } from './helpers/recording-finalizer-join-fixture.js';

describe('session client stop admission', () => {
  it('closes the whole public session client before joining a held acquisition', async () => {
    const entered = gate();
    const release = gate();
    let disposals = 0;
    const built = await buildAgent('plain-text.jsonl', {
      toolSchedulerFactory: async () => {
        entered.release();
        await release.promise;
        return {
          dispose: async () => {
            disposals += 1;
          },
        };
      },
    });
    const channel = built.agent.tools.openClientChannel();
    const ready = channel.ready.then(
      () => undefined,
      (error: unknown) => error,
    );
    await entered.promise;
    const closing = built.agent.dispose();
    let finished = false;
    void closing.then(() => {
      finished = true;
    });
    try {
      await expect(built.agent.generateEmbedding(['late'])).rejects.toThrow(
        /closed/,
      );
      await expect(built.agent.sessionClient.refreshAuth()).rejects.toThrow(
        'Session settings owner is closed',
      );
      await expect(built.agent.generate('late')).rejects.toThrow(/closed/);
      expect(built.agent.dispose()).toBe(closing);
      await Promise.resolve();
      expect(finished).toBe(false);
      release.release();
      expect(await ready).toBeInstanceOf(Error);
      await closing;
      expect(disposals).toBe(1);
    } finally {
      release.release();
      await built.cleanup();
    }
  });
});
