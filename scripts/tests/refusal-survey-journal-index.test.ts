/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { SessionRecordingService } from '../../packages/core/src/recording/SessionRecordingService.js';
import type { RefusalPayload } from '../../packages/core/src/recording/refusalPayload.js';
import {
  hasRecoveryContent,
  readJournalIndex,
} from '../lib/refusal-survey-journal-index.ts';

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe('refusal survey journal reader', () => {
  it('keeps unrelated later prompts from proving recovery when old identity is missing', async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), 'refusal-survey-journal-'),
    );
    temporaryDirectories.push(root);
    const service = new SessionRecordingService({
      sessionId: 'journal-session',
      projectHash: 'journal-project',
      chatsDir: path.join(root, 'chats'),
      workspaceDirs: [],
      provider: 'anthropic',
      model: 'claude-test',
    });
    try {
      service.recordRefusal({
        time: '2026-11-02T10:00:00.000Z',
        provider: 'anthropic',
        model: 'claude-test',
        promptId: 'prompt-1',
        turnId: null,
        attemptIndex: 1,
        finishReason: 'refusal',
        action: 'stop',
      } satisfies RefusalPayload);
      service.recordContent({
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'unrelated prompt B response' }],
        metadata: { promptId: 'prompt-2' },
      });
      await service.flush();
      const journal = await readJournalIndex(root, { count: 0, examples: [] });

      expect(hasRecoveryContent(journal, 'prompt-1', 1)).toBeUndefined();
      expect(hasRecoveryContent(journal, 'prompt-1', 0)).toBe(false);
      expect(hasRecoveryContent(journal, 'another-prompt', 1)).toBe(false);
    } finally {
      await service.dispose();
    }
  });
});
