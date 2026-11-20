/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import {
  buildCliStyleConfig,
  buildFactoryLessConfig,
} from './helpers/buildCliStyleConfig.js';
import { useConsumerPromptDirectory } from './helpers/consumer-owner-primitives.js';
import { fromConfig } from '../fromConfig.js';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { withRecordingLifetimeFixture } from './helpers/recording-owner-lifetime-fixture.js';

describe('CLI fixture journal ownership', () => {
  useConsumerPromptDirectory();

  it('builds a factoryless Config that a public facade can adopt', async () => {
    const fixture = await buildFactoryLessConfig('plain-text.jsonl');
    const agent = await fromConfig(
      fixture.config,
      fixture.settingsService,
      {},
      new CredentialAuthority(),
    );
    try {
      const result = await agent.chat('hello');
      expect(result.text.length).toBeGreaterThan(0);
      const rows = [];
      for await (const row of agent.streamHistory()) rows.push(row);
      expect(rows.some((row) => row.speaker === 'human')).toBe(true);
      expect(rows.some((row) => row.speaker === 'ai')).toBe(true);
    } finally {
      await agent.dispose();
      await fixture.cleanup();
    }
  });

  it('keeps streamed history when the explicitly owned client is replaced', async () => {
    const fixture = await buildCliStyleConfig('plain-text.jsonl');
    try {
      await fixture.agentClient.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'carried row' }] },
      ]);
      const original = fixture.agentClient;
      await fixture.sessionClient.clients.refreshAuth();
      expect(Object.is(fixture.agentClient, original)).toBe(false);
      const rows = [];
      for await (const row of fixture.agentClient.getHistory()) rows.push(row);
      expect(rows).toMatchObject([
        { speaker: 'human', blocks: [{ type: 'text', text: 'carried row' }] },
      ]);
    } finally {
      await fixture.cleanup();
    }
  });
  it('binds the refresh barrier to the facade whose disposal joins it', async () => {
    const entered = Promise.withResolvers<AbortSignal>();
    const body = Promise.withResolvers<void>();
    await withRecordingLifetimeFixture(
      async ({ agent }) => {
        const applying = agent.profiles
          .applySnapshot({
            version: 1,
            provider: 'recording-refresh-oauth',
            model: 'recording-refresh-model',
            modelParams: {},
            ephemeralSettings: {},
            auth: { type: 'oauth', buckets: ['primary', 'secondary'] },
          })
          .then(
            () => undefined,
            (error: unknown) => error,
          );
        let closing: Promise<void> | undefined;
        try {
          const signal = await Promise.race([
            entered.promise,
            applying.then((error) => {
              throw new Error('Profile settled before refresh', {
                cause: error,
              });
            }),
          ]);
          let closed = false;
          closing = agent.dispose();
          void closing.then(() => {
            closed = true;
          });
          expect(signal.aborted).toBe(true);
          expect(closed).toBe(false);
          await expect(
            agent.session.setRecording({ enabled: true }),
          ).rejects.toThrow(/disposed|closed/i);
        } finally {
          body.resolve();
          await applying;
          await closing;
        }
        expect(agent.session.getRecording().enabled).toBe(false);
      },
      { entered: entered.resolve, body: body.promise },
    );
  });
});
