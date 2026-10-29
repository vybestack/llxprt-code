/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  RecordingIntegration,
  resumeSession,
} from '@vybestack/llxprt-code-core';
import { createResumableSession } from '../../../core/src/recording/__tests__/support/resumableSession.js';
import { PROJECT_HASH } from '../../../core/src/recording/__tests__/support/p05dTestKit.js';
import { openRouteAAgent } from '../api/__tests__/helpers/route-a-agent.js';
import { useFakeResponsesReplay } from '../api/__tests__/helpers/fake-responses-replay.js';

describe('session journal resume publication', () => {
  useFakeResponsesReplay('plain-text.jsonl');

  it('attaches recording from the adoption publication callback without deadlocking and preserves rollback', async () => {
    const route = await openRouteAAgent();
    const fixture = await createResumableSession(route.directory, { rows: 3 });
    const resumed = await resumeSession({
      continueRef: fixture.sessionId,
      projectHash: PROJECT_HASH,
      chatsDir: route.directory,
      currentProvider: 'fake',
      currentModel: 'fake-model',
      workspaceDirs: [],
    });
    if (!resumed.ok) throw new Error(resumed.error);
    const integration = new RecordingIntegration(resumed.recording);
    try {
      const session = route.agent.session;
      await expect(
        session.adoptResumeBoot(resumed.recording, resumed.boot, async () => {
          await session.attachRecording(integration);
          throw new Error('publication rejected');
        }),
      ).rejects.toThrow('publication rejected');
      expect(session.getJournalLength()).toBe(0);
      await session.adoptResumeBoot(resumed.recording, resumed.boot, () =>
        session.attachRecording(integration),
      );
      expect(session.getJournalLength()).toBe(3);
      expect(session.getContextRange().totalEntries).toBe(3);
      expect(await session.getHistory()).toStrictEqual(fixture.contents);
    } finally {
      await integration.dispose();
      await route.close();
      await resumed.boot.close();
      await resumed.recording.dispose();
      await resumed.lockHandle.release();
    }
  });
});
