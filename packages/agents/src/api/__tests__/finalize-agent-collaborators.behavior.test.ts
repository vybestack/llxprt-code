/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';

import { buildAgent } from './helpers/agentHarness.js';
import { gate } from './helpers/async-child-disposal-join-fixture.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { openRouteAAgent } from './helpers/route-a-agent.js';

describe('Agent finalization collaborators', () => {
  useFakeResponsesReplay('multi-turn-text.jsonl');
  const credentials = useOwnedCredentials();

  it('binds the supplied SettingsService through fromConfig', async () => {
    const built = await openRouteAAgent({
      authority: credentials().authority,
    });
    try {
      await built.agent.setModel('finalized-model');
      expect(built.agent.getModel()).toBe('finalized-model');
      expect(built.settings.getProviderSettings('fake').model).toBe(
        built.agent.getModel(),
      );
    } finally {
      await built.close();
    }
  });

  it('joins concurrent disposal through one close operation', async () => {
    const closing = gate();
    const release = gate();
    let releases = 0;
    const built = await buildAgent('multi-turn-text.jsonl', {
      credentialAuthority: credentials().authority,
      toolSchedulerFactory: async () => ({
        dispose: async () => {
          releases += 1;
          closing.release();
          await release.promise;
        },
      }),
    });
    const agent = built.agent;
    try {
      await agent.tools.openClientChannel().ready;
      const history = [
        {
          speaker: 'human' as const,
          blocks: [{ type: 'text' as const, text: 'finalized history' }],
        },
      ];
      await agent.setHistory(history);
      expect(await agent.session.getHistory()).toStrictEqual(
        history.map((row, index) => ({
          ...row,
          metadata: {
            chronology: {
              seq: index + 1,
              userTurn: 1,
              step: index + 1,
              recordedAt: expect.any(Number),
            },
          },
        })),
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
      release.release();
      await Promise.all([first, second]);
      await agent.dispose();
      expect({ completed, releases }).toStrictEqual({
        completed: 2,
        releases: 1,
      });
    } finally {
      release.release();
      await built.cleanup();
    }
  });
});
