/**
 * Copyright 2025 Vybestack LLC
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
 * @plan PLAN-20260211-SESSIONRECORDING.P25
 * @requirement REQ-INT-FULL-001, REQ-INT-FULL-002, REQ-INT-FULL-003, REQ-INT-FULL-004, REQ-INT-FULL-005
 *
 * End-to-end integration tests exercising the full recording → replay →
 * resume → continue lifecycle. Uses real filesystem, real services, no mocks.
 *
 * Property-based tests use fast-check (≥30% of total).
 */

import { describe, expect } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { SessionRecordingService } from './SessionRecordingService.js';
import { replaySession } from './ReplayEngine.js';
import { SessionDiscovery } from './SessionDiscovery.js';
import { resumeSession } from './resumeSession.js';
import { deleteSession } from './sessionManagement.js';
import { collectRows } from './p05dTestKit.js';
import type { IContent } from '../services/history/IContent.js';
import {
  PROJECT_HASH,
  itProp,
  assertReplayOk,
  makeContent,
  makeConfig,
  alternatingSpeaker,
  createAndRecordSession,
  readJsonlLines,
  makeResumeRequest,
  useIntegrationDirs,
} from './integration-advanced.test.helpers.js';

describe('integration: full session recording lifecycle', () => {
  const dirs = useIntegrationDirs();
  // Test 1: Full session lifecycle — record → flush → dispose → replay
  // @plan PLAN-20260211-SESSIONRECORDING.P25

  // =========================================================================

  // =========================================================================
  // Test 17: Any sequence of content events roundtrips through record → replay
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-INT-FULL-001
  // =========================================================================
  itProp(
    [
      fc.array(
        fc.record({
          speaker: fc.constantFrom('human' as const, 'ai' as const),
          text: fc.string({ minLength: 1, maxLength: 100 }),
        }),
        { minLength: 1, maxLength: 20 },
      ),
    ],
    { numRuns: 15 },
  )(
    '17: (property) any content sequence roundtrips through record → replay',
    async (items) => {
      const contents = items.map((item) =>
        makeContent(item.text, item.speaker),
      );
      const { filePath } = await createAndRecordSession(dirs.chatsDir, {
        contents,
      });

      const replay = await replaySession(filePath, PROJECT_HASH);
      assertReplayOk(replay);
      expect(replay.history).toHaveLength(contents.length);
      for (let i = 0; i < contents.length; i++) {
        expect(replay.history[i].speaker).toBe(contents[i].speaker);
        expect((replay.history[i].blocks[0] as { text: string }).text).toBe(
          (contents[i].blocks[0] as { text: string }).text,
        );
      }
    },
  );
  // =========================================================================
  // Test 18: Resume always preserves original history length
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-INT-FULL-002
  // =========================================================================
  itProp([fc.integer({ min: 1, max: 15 })], { numRuns: 10 })(
    '18: (property) resume preserves original history length for N turns',
    async (turnCount) => {
      const contents: IContent[] = [];
      for (let i = 0; i < turnCount; i++) {
        contents.push(makeContent(`h-${i}`, 'human'));
        contents.push(makeContent(`a-${i}`, 'ai'));
      }
      const { sessionId } = await createAndRecordSession(dirs.chatsDir, {
        contents,
      });

      const result = await resumeSession(
        makeResumeRequest(dirs.chatsDir, sessionId),
      );
      assertReplayOk(result);
      expect(await collectRows(result.boot)).toHaveLength(turnCount * 2);
      void result.recording.dispose();
    },
  );
});

describe('integration: full session recording lifecycle / property cases 2', () => {
  const dirs = useIntegrationDirs();
  // =========================================================================
  // Test 19: Sequence numbers monotonic after any number of resumes
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-INT-FULL-003
  // =========================================================================
  itProp([fc.integer({ min: 1, max: 4 })], { numRuns: 8 })(
    '19: (property) seq numbers monotonic after N resumes',
    async (resumeCount) => {
      const { filePath, sessionId } = await createAndRecordSession(
        dirs.chatsDir,
        {
          contents: [
            makeContent('initial-h', 'human'),
            makeContent('initial-a', 'ai'),
          ],
        },
      );

      const currentFilePath = filePath;
      for (let r = 0; r < resumeCount; r++) {
        const replay = await replaySession(currentFilePath, PROJECT_HASH);
        assertReplayOk(replay);

        const svc = new SessionRecordingService(
          makeConfig(dirs.chatsDir, { sessionId }),
        );
        svc.initializeForResume(currentFilePath, replay.lastSeq);
        svc.recordContent(makeContent(`resume-${r}-h`, 'human'));
        svc.recordContent(makeContent(`resume-${r}-a`, 'ai'));
        await svc.flush();
        await svc.dispose();
      }

      const lines = await readJsonlLines(currentFilePath);
      const seqs = lines.map((l) => l.seq);
      for (let i = 1; i < seqs.length; i++) {
        expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
      }
    },
  );
});

describe('integration: full session recording lifecycle / property cases 3', () => {
  const dirs = useIntegrationDirs();
  // =========================================================================
  // Test 20: Discovery always returns sessions sorted newest-first
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-INT-FULL-001
  // =========================================================================
  itProp([fc.integer({ min: 2, max: 6 })], { numRuns: 5 })(
    '20: (property) discovery returns sessions sorted newest-first',
    async (sessionCount) => {
      const localTemp = await fs.mkdtemp(
        path.join(os.tmpdir(), 'prop-discovery-'),
      );
      const localChats = path.join(localTemp, 'chats');
      await fs.mkdir(localChats, { recursive: true });
      try {
        for (let i = 0; i < sessionCount; i++) {
          await createAndRecordSession(localChats, {
            contents: [makeContent(`s${i}`, 'human')],
          });
          await new Promise((r) => setTimeout(r, 30));
        }

        const sessions = await SessionDiscovery.listSessions(
          localChats,
          PROJECT_HASH,
        );
        expect(sessions).toHaveLength(sessionCount);
        for (let i = 1; i < sessions.length; i++) {
          expect(sessions[i - 1].lastModified.getTime()).toBeGreaterThanOrEqual(
            sessions[i].lastModified.getTime(),
          );
        }
      } finally {
        await fs.rm(localTemp, { recursive: true, force: true });
      }
    },
  );
  // =========================================================================
  // Test 21: Compression at any point produces correct post-compression count
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-INT-FULL-004
  // =========================================================================
  itProp([fc.integer({ min: 1, max: 10 }), fc.integer({ min: 0, max: 10 })], {
    numRuns: 15,
  })(
    '21: (property) compression with N pre + M post → replay has 1+M items',
    async (preCount, postCount) => {
      const sid = crypto.randomUUID();
      const svc = new SessionRecordingService(
        makeConfig(dirs.chatsDir, { sessionId: sid }),
      );

      for (let i = 0; i < preCount; i++) {
        svc.recordContent(makeContent(`pre-${i}`, alternatingSpeaker(i)));
      }
      svc.recordCompressed(makeContent('compressed-summary', 'ai'), preCount);
      for (let i = 0; i < postCount; i++) {
        svc.recordContent(makeContent(`post-${i}`, alternatingSpeaker(i)));
      }
      await svc.flush();
      const fp = svc.getFilePath()!;
      await svc.dispose();

      const replay = await replaySession(fp, PROJECT_HASH);
      assertReplayOk(replay);
      // summary + post-compression items
      expect(replay.history).toHaveLength(1 + postCount);
    },
  );
});

describe('integration: full session recording lifecycle / property cases 4', () => {
  const dirs = useIntegrationDirs();
  // =========================================================================
  // Test 22: Any number of provider switches are all captured in recording
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-INT-FULL-001
  // =========================================================================
  itProp([fc.integer({ min: 1, max: 8 })], { numRuns: 10 })(
    '22: (property) N provider switches → last switch is reflected in metadata',
    async (switchCount) => {
      const sid = crypto.randomUUID();
      const svc = new SessionRecordingService(
        makeConfig(dirs.chatsDir, { sessionId: sid }),
      );
      svc.recordContent(makeContent('start', 'human'));

      for (let i = 0; i < switchCount; i++) {
        svc.recordProviderSwitch(`provider-${i}`, `model-${i}`);
      }
      await svc.flush();
      const fp = svc.getFilePath()!;
      await svc.dispose();

      const replay = await replaySession(fp, PROJECT_HASH);
      assertReplayOk(replay);
      // All provider_switch events are captured and final state reflected
      expect(replay.metadata.provider).toBe(`provider-${switchCount - 1}`);
      expect(replay.metadata.model).toBe(`model-${switchCount - 1}`);

      // Verify all switch events in the JSONL
      const lines = await readJsonlLines(fp);
      const switchLines = lines.filter((l) => l.type === 'provider_switch');
      expect(switchLines).toHaveLength(switchCount);
    },
  );
  // =========================================================================
  // Test 23: Deferred materialization holds for any number of non-content events
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-INT-FULL-001
  // =========================================================================
  itProp([fc.integer({ min: 1, max: 15 })], { numRuns: 10 })(
    '23: (property) N non-content events → no file until first content',
    async (eventCount) => {
      const svc = new SessionRecordingService(makeConfig(dirs.chatsDir));

      for (let i = 0; i < eventCount; i++) {
        svc.recordSessionEvent('info', `event-${i}`);
      }
      await svc.flush();

      expect(svc.getFilePath()).toBeNull();

      // Now add content — file should materialize
      svc.recordContent(makeContent('trigger', 'human'));
      await svc.flush();
      expect(svc.getFilePath()).not.toBeNull();

      const fp = svc.getFilePath()!;
      const replay = await replaySession(fp, PROJECT_HASH);
      assertReplayOk(replay);
      expect(replay.history).toHaveLength(1);

      // Verify session_events are present in the JSONL
      const lines = await readJsonlLines(fp);
      const sessionEventLines = lines.filter((l) => l.type === 'session_event');
      expect(sessionEventLines).toHaveLength(eventCount);

      await svc.dispose();
    },
  );
});

describe('integration: full session recording lifecycle / property cases 5', () => {
  const dirs = useIntegrationDirs();
  // =========================================================================
  // Additional Property-Based Tests for 30%+ threshold
  // =========================================================================

  // =========================================================================
  // Test P1: Rewind at any count produces correct remaining history
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-INT-FULL-001
  // =========================================================================
  itProp([fc.integer({ min: 1, max: 10 }), fc.integer({ min: 0, max: 10 })], {
    numRuns: 12,
  })(
    'P1: (property) rewind N from M items → max(0, M-N) remain',
    async (totalItems, rewindCount) => {
      const sid = crypto.randomUUID();
      const svc = new SessionRecordingService(
        makeConfig(dirs.chatsDir, { sessionId: sid }),
      );
      for (let i = 0; i < totalItems; i++) {
        svc.recordContent(makeContent(`item-${i}`, alternatingSpeaker(i)));
      }
      svc.recordRewind(rewindCount);
      await svc.flush();
      const fp = svc.getFilePath()!;
      await svc.dispose();

      const replay = await replaySession(fp, PROJECT_HASH);
      assertReplayOk(replay);
      const expected = Math.max(0, totalItems - rewindCount);
      expect(replay.history).toHaveLength(expected);
    },
  );
});

describe('integration: full session recording lifecycle / property cases 6', () => {
  const dirs = useIntegrationDirs();
  // =========================================================================
  // Test P2: Resume + continue preserves original + adds new for any counts
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-INT-FULL-002, REQ-INT-FULL-003
  // =========================================================================
  itProp([fc.integer({ min: 1, max: 8 }), fc.integer({ min: 1, max: 8 })], {
    numRuns: 10,
  })(
    'P2: (property) record N + resume + record M → replay has N+M items',
    async (initialCount, additionalCount) => {
      const contents = Array.from({ length: initialCount }, (_, i) =>
        makeContent(`init-${i}`, alternatingSpeaker(i)),
      );
      const { filePath, sessionId } = await createAndRecordSession(
        dirs.chatsDir,
        {
          contents,
        },
      );

      const replay1 = await replaySession(filePath, PROJECT_HASH);
      assertReplayOk(replay1);

      const svc2 = new SessionRecordingService(
        makeConfig(dirs.chatsDir, { sessionId }),
      );
      svc2.initializeForResume(filePath, replay1.lastSeq);
      for (let i = 0; i < additionalCount; i++) {
        svc2.recordContent(makeContent(`add-${i}`, alternatingSpeaker(i)));
      }
      await svc2.flush();
      void svc2.dispose();

      const replay2 = await replaySession(filePath, PROJECT_HASH);
      assertReplayOk(replay2);
      expect(replay2.history).toHaveLength(initialCount + additionalCount);
    },
  );
});

describe('integration: full session recording lifecycle / property cases 7', () => {
  useIntegrationDirs();
  // =========================================================================
  // Test P3: Delete always removes the file for any valid session
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-INT-FULL-001
  // =========================================================================
  itProp([fc.integer({ min: 1, max: 5 })], { numRuns: 8 })(
    'P3: (property) delete removes file for session with N content items',
    async (contentCount) => {
      const localTemp = await fs.mkdtemp(
        path.join(os.tmpdir(), 'prop-delete-'),
      );
      const localChats = path.join(localTemp, 'chats');
      await fs.mkdir(localChats, { recursive: true });
      try {
        const contents = Array.from({ length: contentCount }, (_, i) =>
          makeContent(`del-${i}`, 'human'),
        );
        const { filePath, sessionId } = await createAndRecordSession(
          localChats,
          {
            contents,
          },
        );
        await expect(fs.access(filePath)).resolves.toBeFalsy();

        const result = await deleteSession(sessionId, localChats, PROJECT_HASH);
        expect(result.ok).toBe(true);
        await expect(fs.access(filePath)).rejects.toThrow(/ENOENT/);
      } finally {
        await fs.rm(localTemp, { recursive: true, force: true });
      }
    },
  );
  // =========================================================================
  // Test P4: Session ID is always preserved across record → replay cycle
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-INT-FULL-001
  // =========================================================================
  itProp([fc.uuid()], { numRuns: 10 })(
    'P4: (property) session ID preserved through record → replay',
    async (sessionId) => {
      const localTemp = await fs.mkdtemp(path.join(os.tmpdir(), 'prop-sid-'));
      const localChats = path.join(localTemp, 'chats');
      await fs.mkdir(localChats, { recursive: true });

      try {
        const { filePath } = await createAndRecordSession(localChats, {
          sessionId,
          contents: [makeContent('hello', 'human')],
        });

        const replay = await replaySession(filePath, PROJECT_HASH);
        assertReplayOk(replay);
        expect(replay.metadata.sessionId).toBe(sessionId);
      } finally {
        await fs.rm(localTemp, { recursive: true, force: true });
      }
    },
  );
});
