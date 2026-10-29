/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';
import {
  nativeRows,
  readJournalFileFacts,
  requireRecordingPath,
} from './helpers/native-session-fixture.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';

describe('recording live selection on first durable content', () => {
  it.each([false, true])(
    'reads the selection after recorder creation, new session=%s',
    async (newSession) => {
      const built = await buildCliStyleConfig('plain-text.jsonl', {
        sessionId: randomUUID(),
      });
      let selection = { provider: 'unknown', model: '' };
      const session = built.sessionClient.createSessionControl(
        'config',
        () => built.config.getSessionId(),
        (operation) => operation(),
        () => {},
        () => {},
        () => selection.provider,
        () => selection.model,
      );
      try {
        await session.setRecording({ enabled: true });
        if (newSession) await session.startNewSession();
        expect(session.getRecording().path).toBeUndefined();
        selection = { provider: 'anthropic', model: 'claude-opus-5-5' };
        await built.agentClient.addHistory({
          speaker: 'human',
          blocks: [{ type: 'text', text: 'first durable content' }],
        });
        await session.flushRecording();
        const path = requireRecordingPath(session.getRecording().path);
        const header = await readJournalFileFacts(path);
        expect({
          provider: header?.facts.provider,
          model: header?.facts.model,
        }).toStrictEqual({
          provider: 'anthropic',
          model: 'claude-opus-5-5',
        });
        expect((await nativeRows(path)).map((row) => row.blocks)).toStrictEqual(
          [[{ type: 'text', text: 'first durable content' }]],
        );
      } finally {
        await runCleanupSteps([() => session.dispose(), built.cleanup]);
      }
    },
  );
});
