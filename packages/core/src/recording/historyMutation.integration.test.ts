/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Behavioral integration tests for durable history mutations.
 * Tests that /chat clear and /chat restore persist rewind semantics and
 * replay consistently after process restart. Uses real recording files.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { SessionRecordingService } from './SessionRecordingService.js';
import { HistoryMutationService } from './HistoryMutationService.js';
import { replaySession } from './ReplayEngine.js';
import { type SessionRecordingServiceConfig } from './types.js';
import { type IContent } from '../services/history/IContent.js';

const PROJECT_HASH = 'mutate-project-hash';

function requireReplaySuccess(
  result: Awaited<ReturnType<typeof replaySession>>,
): asserts result is Extract<
  Awaited<ReturnType<typeof replaySession>>,
  { ok: true }
> {
  if (!result.ok) throw new Error(`Expected replay success: ${result.error}`);
}

function requireMutationSuccess<T extends { ok: boolean }>(
  result: T,
): asserts result is T & { ok: true } {
  if (!result.ok) throw new Error('Expected history mutation success');
}

function requireMutationFailure<T extends { ok: boolean }>(
  result: T,
): asserts result is T & { ok: false; error: string } {
  if (result.ok) throw new Error('Expected history mutation failure');
}
function makeConfig(
  chatsDir: string,
  overrides: Partial<SessionRecordingServiceConfig> = {},
): SessionRecordingServiceConfig {
  return {
    sessionId: overrides.sessionId ?? crypto.randomUUID(),
    projectHash: overrides.projectHash ?? PROJECT_HASH,
    chatsDir,
    workspaceDirs: overrides.workspaceDirs ?? ['/test/workspace'],
    provider: overrides.provider ?? 'anthropic',
    model: overrides.model ?? 'claude-4',
  };
}

function makeContent(
  text: string,
  speaker: IContent['speaker'] = 'human',
): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

function tempDirHelper(): {
  getDir: () => string;
  setup: () => Promise<void>;
  teardown: () => Promise<void>;
} {
  let dir = '';
  return {
    getDir: () => dir,
    setup: async () => {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mutate-'));
      await fs.mkdir(path.join(dir, 'chats'), { recursive: true });
    },
    teardown: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

describe('durable history mutation @plan:2026-07-28-issue-2625', () => {
  const tmp = tempDirHelper();
  beforeEach(tmp.setup);
  afterEach(tmp.teardown);
  const chatsDir = () => path.join(tmp.getDir(), 'chats');

  describe('A12: clear and restore survive replay using true turn boundaries', () => {
    it('clear removes non-initial content and survives process restart', async () => {
      const svc = new SessionRecordingService(makeConfig(chatsDir()));
      const history: IContent[] = [
        makeContent('A', 'human'),
        makeContent('B', 'ai'),
        makeContent('C', 'human'),
        makeContent('D', 'ai'),
        makeContent('E', 'human'),
        makeContent('F', 'ai'),
      ];
      for (const item of history) svc.recordContent(item);
      await svc.flush();

      const mutator = new HistoryMutationService();
      const result = await mutator.clear(history, svc);
      requireMutationSuccess(result);

      // After clear, only the first human turn remains (A + B)
      expect(result.remainingHistory).toHaveLength(2);
      expect(result.itemsRemoved).toBe(4);

      await svc.dispose();

      // Replay from disk — rewind must reconstruct the cleared state
      const replay = await replaySession(svc.getFilePath()!, PROJECT_HASH);
      requireReplaySuccess(replay);
      {
        expect(replay.history).toHaveLength(2);
        const texts = replay.history.map((h) =>
          h.blocks[0].type === 'text' ? h.blocks[0].text : '',
        );
        expect(texts).toStrictEqual(['A', 'B']);
      }
    });

    it('clear preserves exactly the first human-led turn when human entries are consecutive', async () => {
      const svc = new SessionRecordingService(makeConfig(chatsDir()));
      const history: IContent[] = [
        makeContent('first question', 'human'),
        makeContent('second question', 'human'),
        makeContent('second answer', 'ai'),
      ];
      for (const item of history) svc.recordContent(item);
      await svc.flush();

      const result = await new HistoryMutationService().clear(history, svc);
      requireMutationSuccess(result);
      expect(result.remainingHistory).toStrictEqual([history[0]]);
      expect(result.itemsRemoved).toBe(2);

      await svc.dispose();
      const replay = await replaySession(svc.getFilePath()!, PROJECT_HASH);
      requireReplaySuccess(replay);
      expect(replay.history).toStrictEqual([history[0]]);
    });

    it('restore removes last N human turns with tool-heavy content', async () => {
      const svc = new SessionRecordingService(makeConfig(chatsDir()));
      // A turn = human + ai + tool entries
      const history: IContent[] = [
        makeContent('Q1', 'human'), // turn 1
        makeContent('A1', 'ai'),
        makeContent('tool-result-1', 'tool'),
        makeContent('Q2', 'human'), // turn 2
        makeContent('A2', 'ai'),
        makeContent('tool-result-2', 'tool'),
        makeContent('Q3', 'human'), // turn 3
        makeContent('A3', 'ai'),
      ];
      for (const item of history) svc.recordContent(item);
      await svc.flush();

      const mutator = new HistoryMutationService();
      // Restore 2 turns: removes turn 2 and turn 3 (5 items)
      const result = await mutator.restore(history, 2, svc);
      requireMutationSuccess(result);

      // After restore, turn 1 remains: Q1, A1, tool-result-1
      expect(result.remainingHistory).toHaveLength(3);
      expect(result.itemsRemoved).toBe(5);

      await svc.dispose();

      const replay = await replaySession(svc.getFilePath()!, PROJECT_HASH);
      requireReplaySuccess(replay);
      {
        expect(replay.history).toHaveLength(3);
        const texts = replay.history.map((h) =>
          h.blocks[0].type === 'text' ? h.blocks[0].text : '',
        );
        expect(texts).toStrictEqual(['Q1', 'A1', 'tool-result-1']);
      }
    });

    it('restore 1 turn removes only the last human-led turn', async () => {
      const svc = new SessionRecordingService(makeConfig(chatsDir()));
      const history: IContent[] = [
        makeContent('Q1', 'human'),
        makeContent('A1', 'ai'),
        makeContent('Q2', 'human'),
        makeContent('A2', 'ai'),
      ];
      for (const item of history) svc.recordContent(item);
      await svc.flush();

      const mutator = new HistoryMutationService();
      const result = await mutator.restore(history, 1, svc);
      requireMutationSuccess(result);

      // Only turn 1 remains
      expect(result.remainingHistory).toHaveLength(2);
      expect(result.itemsRemoved).toBe(2);

      await svc.dispose();

      const replay = await replaySession(svc.getFilePath()!, PROJECT_HASH);
      requireReplaySuccess(replay);
      {
        expect(replay.history).toHaveLength(2);
      }
    });

    it('persistence failure leaves live history unchanged', async () => {
      const svc = new SessionRecordingService(makeConfig(chatsDir()));
      const history: IContent[] = [
        makeContent('A', 'human'),
        makeContent('B', 'ai'),
        makeContent('C', 'human'),
      ];
      for (const item of history) svc.recordContent(item);
      await svc.flush();

      // Dispose to make the recording inactive
      await svc.dispose();

      const mutator = new HistoryMutationService();
      const result = await mutator.clear(history, svc);
      requireMutationFailure(result);
      expect(result.error).toContain('not active');
    });
  });
});
