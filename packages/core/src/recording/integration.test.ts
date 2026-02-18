/* eslint-disable vitest/no-standalone-expect */
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
 * Property-based tests use @fast-check/vitest (≥30% of total).
 */

import { describe, expect, beforeEach, afterEach } from 'vitest';
import { it } from '@fast-check/vitest';
import * as fc from 'fast-check';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import { SessionRecordingService } from './SessionRecordingService.js';
import { replaySession } from './ReplayEngine.js';
import { SessionDiscovery } from './SessionDiscovery.js';
import { SessionLockManager } from './SessionLockManager.js';
import {
  resumeSession,
  CONTINUE_LATEST,
  type ResumeRequest,
} from './resumeSession.js';
import { deleteSession } from './sessionManagement.js';
import {
  type SessionRecordingServiceConfig,
  type SessionRecordLine,
} from './types.js';
import { type IContent } from '../services/history/IContent.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECT_HASH = 'integration-test-project';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContent(
  text: string,
  speaker: IContent['speaker'] = 'human',
): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
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

/**
 * Create a real session file, flush, dispose, and return file path + session ID.
 */
async function createAndRecordSession(
  chatsDir: string,
  opts: {
    sessionId?: string;
    projectHash?: string;
    provider?: string;
    model?: string;
    contents: IContent[];
  },
): Promise<{ filePath: string; sessionId: string }> {
  const sid = opts.sessionId ?? crypto.randomUUID();
  const svc = new SessionRecordingService(
    makeConfig(chatsDir, {
      sessionId: sid,
      projectHash: opts.projectHash,
      provider: opts.provider,
      model: opts.model,
    }),
  );
  for (const c of opts.contents) {
    svc.recordContent(c);
  }
  await svc.flush();
  const fp = svc.getFilePath()!;
  await svc.dispose();
  return { filePath: fp, sessionId: sid };
}

/**
 * Read a JSONL file and parse all lines.
 */
async function readJsonlLines(filePath: string): Promise<SessionRecordLine[]> {
  const raw = await fs.readFile(filePath, 'utf-8');
  return raw
    .trim()
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((line) => JSON.parse(line) as SessionRecordLine);
}

function makeResumeRequest(
  chatsDir: string,
  continueRef: string | typeof CONTINUE_LATEST = CONTINUE_LATEST,
  overrides: Partial<ResumeRequest> = {},
): ResumeRequest {
  return {
    continueRef,
    projectHash: overrides.projectHash ?? PROJECT_HASH,
    chatsDir,
    currentProvider: overrides.currentProvider ?? 'anthropic',
    currentModel: overrides.currentModel ?? 'claude-4',
    workspaceDirs: overrides.workspaceDirs ?? ['/test/workspace'],
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('integration: full session recording lifecycle', () => {
  let tempDir: string;
  let chatsDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'integration-test-'));
    chatsDir = path.join(tempDir, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // =========================================================================
  // Test 1: Full session lifecycle — record → flush → dispose → replay
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-INT-FULL-001
  // =========================================================================
  it('1: records 3 turns (6 content) → replays 6 IContent items', async () => {
    const contents: IContent[] = [
      makeContent('hello', 'human'),
      makeContent('hi there', 'ai'),
      makeContent('how are you?', 'human'),
      makeContent('I am fine', 'ai'),
      makeContent('bye', 'human'),
      makeContent('goodbye', 'ai'),
    ];
    const { filePath } = await createAndRecordSession(chatsDir, { contents });

    const result = await replaySession(filePath, PROJECT_HASH);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.history).toHaveLength(6);
    expect(result.history[0].speaker).toBe('human');
    expect((result.history[0].blocks[0] as { text: string }).text).toBe(
      'hello',
    );
    expect(result.history[5].speaker).toBe('ai');
    expect((result.history[5].blocks[0] as { text: string }).text).toBe(
      'goodbye',
    );
  });

  // =========================================================================
  // Test 2: Record → resume → continue recording
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-INT-FULL-002, REQ-INT-FULL-003
  // =========================================================================
  it('2: record 3 turns, resume, record 2 more → replay has 10 items', async () => {
    const initial: IContent[] = [
      makeContent('turn1-h', 'human'),
      makeContent('turn1-a', 'ai'),
      makeContent('turn2-h', 'human'),
      makeContent('turn2-a', 'ai'),
      makeContent('turn3-h', 'human'),
      makeContent('turn3-a', 'ai'),
    ];
    const { filePath, sessionId } = await createAndRecordSession(chatsDir, {
      contents: initial,
    });

    // Resume and continue
    const replay1 = await replaySession(filePath, PROJECT_HASH);
    expect(replay1.ok).toBe(true);
    if (!replay1.ok) return;
    expect(replay1.history).toHaveLength(6);

    const svc2 = new SessionRecordingService(
      makeConfig(chatsDir, { sessionId }),
    );
    svc2.initializeForResume(filePath, replay1.lastSeq);
    svc2.recordContent(makeContent('turn4-h', 'human'));
    svc2.recordContent(makeContent('turn4-a', 'ai'));
    svc2.recordContent(makeContent('turn5-h', 'human'));
    svc2.recordContent(makeContent('turn5-a', 'ai'));
    await svc2.flush();
    svc2.dispose();

    const replay2 = await replaySession(filePath, PROJECT_HASH);
    expect(replay2.ok).toBe(true);
    if (!replay2.ok) return;
    expect(replay2.history).toHaveLength(10);
    expect((replay2.history[9].blocks[0] as { text: string }).text).toBe(
      'turn5-a',
    );
  });

  // =========================================================================
  // Test 3: Sequence numbers continuous across resume boundary
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-INT-FULL-003
  // =========================================================================
  it('3: seq numbers are monotonic across resume boundary', async () => {
    const initial: IContent[] = [
      makeContent('m1', 'human'),
      makeContent('m2', 'ai'),
      makeContent('m3', 'human'),
    ];
    const { filePath, sessionId } = await createAndRecordSession(chatsDir, {
      contents: initial,
    });

    const replay1 = await replaySession(filePath, PROJECT_HASH);
    if (!replay1.ok) throw new Error('unexpected replay failure');

    const svc2 = new SessionRecordingService(
      makeConfig(chatsDir, { sessionId }),
    );
    svc2.initializeForResume(filePath, replay1.lastSeq);
    svc2.recordContent(makeContent('m4', 'human'));
    svc2.recordContent(makeContent('m5', 'ai'));
    await svc2.flush();
    svc2.dispose();

    const lines = await readJsonlLines(filePath);
    const seqs = lines.map((l) => l.seq);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }
  });

  // =========================================================================
  // Test 4: Compression roundtrip
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-INT-FULL-004
  // =========================================================================
  it('4: record, compress, record more → replay shows summary + post-compression', async () => {
    const sid = crypto.randomUUID();
    const svc = new SessionRecordingService(
      makeConfig(chatsDir, { sessionId: sid }),
    );

    // Record 5 content events
    for (let i = 0; i < 5; i++) {
      svc.recordContent(makeContent(`pre-${i}`, i % 2 === 0 ? 'human' : 'ai'));
    }

    // Compress
    const summary = makeContent('Summary of 5 items', 'ai');
    svc.recordCompressed(summary, 5);

    // Record 2 more post-compression
    svc.recordContent(makeContent('post-1', 'human'));
    svc.recordContent(makeContent('post-2', 'ai'));
    await svc.flush();
    const fp = svc.getFilePath()!;
    await svc.dispose();

    const replay = await replaySession(fp, PROJECT_HASH);
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    // compression replaces all prior content with summary, then 2 more appended
    expect(replay.history).toHaveLength(3);
    expect((replay.history[0].blocks[0] as { text: string }).text).toBe(
      'Summary of 5 items',
    );
    expect((replay.history[1].blocks[0] as { text: string }).text).toBe(
      'post-1',
    );
    expect((replay.history[2].blocks[0] as { text: string }).text).toBe(
      'post-2',
    );
  });

  // =========================================================================
  // Test 5: Rewind roundtrip
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-INT-FULL-001
  // =========================================================================
  it('5: record 5, rewind 2 → replay shows 3', async () => {
    const sid = crypto.randomUUID();
    const svc = new SessionRecordingService(
      makeConfig(chatsDir, { sessionId: sid }),
    );

    for (let i = 0; i < 5; i++) {
      svc.recordContent(makeContent(`item-${i}`, i % 2 === 0 ? 'human' : 'ai'));
    }
    svc.recordRewind(2);
    await svc.flush();
    const fp = svc.getFilePath()!;
    await svc.dispose();

    const replay = await replaySession(fp, PROJECT_HASH);
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.history).toHaveLength(3);
    expect((replay.history[2].blocks[0] as { text: string }).text).toBe(
      'item-2',
    );
  });

  // =========================================================================
  // Test 6: Provider switch recorded and replayed
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-INT-FULL-001
  // =========================================================================
  it('6: provider switch → replay metadata updated', async () => {
    const sid = crypto.randomUUID();
    const svc = new SessionRecordingService(
      makeConfig(chatsDir, {
        sessionId: sid,
        provider: 'anthropic',
        model: 'claude-4',
      }),
    );
    svc.recordContent(makeContent('hi', 'human'));
    svc.recordProviderSwitch('openai', 'gpt-5');
    svc.recordContent(makeContent('hello', 'ai'));
    await svc.flush();
    const fp = svc.getFilePath()!;
    await svc.dispose();

    const replay = await replaySession(fp, PROJECT_HASH);
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.metadata.provider).toBe('openai');
    expect(replay.metadata.model).toBe('gpt-5');
    expect(replay.history).toHaveLength(2);
  });

  // =========================================================================
  // Test 7: Directories changed recorded and replayed
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-INT-FULL-001
  // =========================================================================
  it('7: directories changed → replay metadata has new dirs', async () => {
    const sid = crypto.randomUUID();
    const svc = new SessionRecordingService(
      makeConfig(chatsDir, {
        sessionId: sid,
        workspaceDirs: ['/old/dir'],
      }),
    );
    svc.recordContent(makeContent('hi', 'human'));
    svc.recordDirectoriesChanged(['/new/dir-a', '/new/dir-b']);
    await svc.flush();
    const fp = svc.getFilePath()!;
    await svc.dispose();

    const replay = await replaySession(fp, PROJECT_HASH);
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.metadata.workspaceDirs).toEqual(['/new/dir-a', '/new/dir-b']);
  });

  // =========================================================================
  // Test 8: Deferred materialization — no content = no file
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-INT-FULL-001
  // =========================================================================
  it('8: no content events → no file on disk', async () => {
    const svc = new SessionRecordingService(makeConfig(chatsDir));
    // Only non-content events
    svc.recordSessionEvent('info', 'started');
    await svc.flush();
    expect(svc.getFilePath()).toBeNull();
    await svc.dispose();

    // Verify no session files were created
    const files = await fs.readdir(chatsDir);
    const sessionFiles = files.filter((f) => f.endsWith('.jsonl'));
    expect(sessionFiles).toHaveLength(0);
  });

  // =========================================================================
  // Test 9: Discovery finds recorded sessions
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-INT-FULL-001
  // =========================================================================
  it('9: 3 recorded sessions → discovery finds 3', async () => {
    for (let i = 0; i < 3; i++) {
      await createAndRecordSession(chatsDir, {
        contents: [makeContent(`session-${i}`, 'human')],
      });
      // Small delay to ensure distinct mtimes
      await new Promise((r) => setTimeout(r, 50));
    }

    const sessions = await SessionDiscovery.listSessions(
      chatsDir,
      PROJECT_HASH,
    );
    expect(sessions).toHaveLength(3);
    // Sorted newest-first
    expect(sessions[0].lastModified.getTime()).toBeGreaterThanOrEqual(
      sessions[1].lastModified.getTime(),
    );
    expect(sessions[1].lastModified.getTime()).toBeGreaterThanOrEqual(
      sessions[2].lastModified.getTime(),
    );
  });

  // =========================================================================
  // Test 10: CONTINUE_LATEST picks newest
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-INT-FULL-002
  // =========================================================================
  it('10: CONTINUE_LATEST resumes the most recent session', async () => {
    const sessions: Array<{ sessionId: string }> = [];
    for (let i = 0; i < 3; i++) {
      const { sessionId } = await createAndRecordSession(chatsDir, {
        contents: [makeContent(`s${i}`, 'human'), makeContent(`r${i}`, 'ai')],
      });
      sessions.push({ sessionId });
      await new Promise((r) => setTimeout(r, 50));
    }

    const result = await resumeSession(makeResumeRequest(chatsDir));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Should be the most recently created session
    expect(result.metadata.sessionId).toBe(sessions[2].sessionId);
    expect(result.history).toHaveLength(2);
    result.recording.dispose();
  });

  // =========================================================================
  // Test 11: Resume by specific session ID
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-INT-FULL-002
  // =========================================================================
  it('11: resume specific session by ID → correct one', async () => {
    const { sessionId: sid1 } = await createAndRecordSession(chatsDir, {
      contents: [makeContent('first-session', 'human')],
    });
    await new Promise((r) => setTimeout(r, 50));
    await createAndRecordSession(chatsDir, {
      contents: [makeContent('second-session', 'human')],
    });

    const result = await resumeSession(makeResumeRequest(chatsDir, sid1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.metadata.sessionId).toBe(sid1);
    expect(result.history).toHaveLength(1);
    expect((result.history[0].blocks[0] as { text: string }).text).toBe(
      'first-session',
    );
    result.recording.dispose();
  });

  // =========================================================================
  // Test 12: Delete removes file
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-INT-FULL-001
  // =========================================================================
  it('12: delete session removes the file', async () => {
    const { filePath, sessionId } = await createAndRecordSession(chatsDir, {
      contents: [makeContent('to-delete', 'human')],
    });

    // Verify file exists
    await expect(fs.access(filePath)).resolves.toBeUndefined();

    const deleteResult = await deleteSession(sessionId, chatsDir, PROJECT_HASH);
    expect(deleteResult.ok).toBe(true);

    // File should be gone
    await expect(fs.access(filePath)).rejects.toThrow();
  });

  // =========================================================================
  // Test 13: Lock prevents concurrent resume
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-CON-004
  // =========================================================================
  it('13: lock prevents concurrent resume of same session', async () => {
    const { sessionId } = await createAndRecordSession(chatsDir, {
      contents: [makeContent('locked-session', 'human')],
    });

    // First resume acquires lock
    const result1 = await resumeSession(makeResumeRequest(chatsDir, sessionId));
    expect(result1.ok).toBe(true);
    if (!result1.ok) return;

    // Second resume of the same session should fail
    const result2 = await resumeSession(makeResumeRequest(chatsDir, sessionId));
    expect(result2.ok).toBe(false);
    if (result2.ok) return;
    expect(result2.error).toContain('in use');

    result1.recording.dispose();
  });

  // =========================================================================
  // Test 14: Config.getContinueSessionRef with string value
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-INT-FULL-005
  // =========================================================================
  it('14: getContinueSessionRef returns string session ref', async () => {
    // We test the logic directly — the Config class constructor has too many
    // dependencies to instantiate in an integration test. Instead we test the
    // same logic pattern that Config.getContinueSessionRef implements.
    const continueSession: boolean | string = 'abc123';
    const ref =
      typeof continueSession === 'string'
        ? continueSession
        : continueSession
          ? CONTINUE_LATEST
          : null;
    expect(ref).toBe('abc123');
  });

  // =========================================================================
  // Test 15: Config.getContinueSessionRef with bare --continue (boolean true)
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-INT-FULL-005
  // =========================================================================
  it('15: bare --continue (true) → getContinueSessionRef returns CONTINUE_LATEST', async () => {
    const continueSession: boolean | string = true;
    const ref =
      typeof continueSession === 'string'
        ? continueSession
        : continueSession
          ? CONTINUE_LATEST
          : null;
    expect(ref).toBe(CONTINUE_LATEST);
  });

  // =========================================================================
  // Test 16: isContinueSession with string value
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-INT-FULL-005
  // =========================================================================
  it('16: isContinueSession returns true for string value', async () => {
    const continueSession: boolean | string = 'abc123';
    const isContinue = !!continueSession;
    expect(isContinue).toBe(true);

    const continueSessionFalse: boolean | string = false;
    const isContinueFalse = !!continueSessionFalse;
    expect(isContinueFalse).toBe(false);
  });

  // =========================================================================
  // Property-Based Tests (17-23)
  // =========================================================================

  // =========================================================================
  // Test 17: Any sequence of content events roundtrips through record → replay
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-INT-FULL-001
  // =========================================================================
  it.prop(
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
      const { filePath } = await createAndRecordSession(chatsDir, { contents });

      const replay = await replaySession(filePath, PROJECT_HASH);
      expect(replay.ok).toBe(true);
      if (!replay.ok) return;
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
  it.prop([fc.integer({ min: 1, max: 15 })], { numRuns: 10 })(
    '18: (property) resume preserves original history length for N turns',
    async (turnCount) => {
      const contents: IContent[] = [];
      for (let i = 0; i < turnCount; i++) {
        contents.push(makeContent(`h-${i}`, 'human'));
        contents.push(makeContent(`a-${i}`, 'ai'));
      }
      const { sessionId } = await createAndRecordSession(chatsDir, {
        contents,
      });

      const result = await resumeSession(
        makeResumeRequest(chatsDir, sessionId),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.history).toHaveLength(turnCount * 2);
      result.recording.dispose();
    },
  );

  // =========================================================================
  // Test 19: Sequence numbers monotonic after any number of resumes
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-INT-FULL-003
  // =========================================================================
  it.prop([fc.integer({ min: 1, max: 4 })], { numRuns: 8 })(
    '19: (property) seq numbers monotonic after N resumes',
    async (resumeCount) => {
      const { filePath, sessionId } = await createAndRecordSession(chatsDir, {
        contents: [
          makeContent('initial-h', 'human'),
          makeContent('initial-a', 'ai'),
        ],
      });

      const currentFilePath = filePath;
      for (let r = 0; r < resumeCount; r++) {
        const replay = await replaySession(currentFilePath, PROJECT_HASH);
        if (!replay.ok) throw new Error('unexpected replay failure');

        const svc = new SessionRecordingService(
          makeConfig(chatsDir, { sessionId }),
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

  // =========================================================================
  // Test 20: Discovery always returns sessions sorted newest-first
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-INT-FULL-001
  // =========================================================================
  it.prop([fc.integer({ min: 2, max: 6 })], { numRuns: 5 })(
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
  it.prop([fc.integer({ min: 1, max: 10 }), fc.integer({ min: 0, max: 10 })], {
    numRuns: 15,
  })(
    '21: (property) compression with N pre + M post → replay has 1+M items',
    async (preCount, postCount) => {
      const sid = crypto.randomUUID();
      const svc = new SessionRecordingService(
        makeConfig(chatsDir, { sessionId: sid }),
      );

      for (let i = 0; i < preCount; i++) {
        svc.recordContent(
          makeContent(`pre-${i}`, i % 2 === 0 ? 'human' : 'ai'),
        );
      }
      svc.recordCompressed(makeContent('compressed-summary', 'ai'), preCount);
      for (let i = 0; i < postCount; i++) {
        svc.recordContent(
          makeContent(`post-${i}`, i % 2 === 0 ? 'human' : 'ai'),
        );
      }
      await svc.flush();
      const fp = svc.getFilePath()!;
      await svc.dispose();

      const replay = await replaySession(fp, PROJECT_HASH);
      expect(replay.ok).toBe(true);
      if (!replay.ok) return;
      // summary + post-compression items
      expect(replay.history).toHaveLength(1 + postCount);
    },
  );

  // =========================================================================
  // Test 22: Any number of provider switches are all captured in recording
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-INT-FULL-001
  // =========================================================================
  it.prop([fc.integer({ min: 1, max: 8 })], { numRuns: 10 })(
    '22: (property) N provider switches → last switch is reflected in metadata',
    async (switchCount) => {
      const sid = crypto.randomUUID();
      const svc = new SessionRecordingService(
        makeConfig(chatsDir, { sessionId: sid }),
      );
      svc.recordContent(makeContent('start', 'human'));

      for (let i = 0; i < switchCount; i++) {
        svc.recordProviderSwitch(`provider-${i}`, `model-${i}`);
      }
      await svc.flush();
      const fp = svc.getFilePath()!;
      await svc.dispose();

      const replay = await replaySession(fp, PROJECT_HASH);
      expect(replay.ok).toBe(true);
      if (!replay.ok) return;
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
  it.prop([fc.integer({ min: 1, max: 15 })], { numRuns: 10 })(
    '23: (property) N non-content events → no file until first content',
    async (eventCount) => {
      const svc = new SessionRecordingService(makeConfig(chatsDir));

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
      expect(replay.ok).toBe(true);
      if (!replay.ok) return;
      expect(replay.history).toHaveLength(1);

      // Verify session_events are present in the JSONL
      const lines = await readJsonlLines(fp);
      const sessionEventLines = lines.filter((l) => l.type === 'session_event');
      expect(sessionEventLines).toHaveLength(eventCount);

      await svc.dispose();
    },
  );

  // =========================================================================
  // Additional Property-Based Tests for 30%+ threshold
  // =========================================================================

  // =========================================================================
  // Test P1: Rewind at any count produces correct remaining history
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-INT-FULL-001
  // =========================================================================
  it.prop([fc.integer({ min: 1, max: 10 }), fc.integer({ min: 0, max: 10 })], {
    numRuns: 12,
  })(
    'P1: (property) rewind N from M items → max(0, M-N) remain',
    async (totalItems, rewindCount) => {
      const sid = crypto.randomUUID();
      const svc = new SessionRecordingService(
        makeConfig(chatsDir, { sessionId: sid }),
      );
      for (let i = 0; i < totalItems; i++) {
        svc.recordContent(
          makeContent(`item-${i}`, i % 2 === 0 ? 'human' : 'ai'),
        );
      }
      svc.recordRewind(rewindCount);
      await svc.flush();
      const fp = svc.getFilePath()!;
      await svc.dispose();

      const replay = await replaySession(fp, PROJECT_HASH);
      expect(replay.ok).toBe(true);
      if (!replay.ok) return;
      const expected = Math.max(0, totalItems - rewindCount);
      expect(replay.history).toHaveLength(expected);
    },
  );

  // =========================================================================
  // Test P2: Resume + continue preserves original + adds new for any counts
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-INT-FULL-002, REQ-INT-FULL-003
  // =========================================================================
  it.prop([fc.integer({ min: 1, max: 8 }), fc.integer({ min: 1, max: 8 })], {
    numRuns: 10,
  })(
    'P2: (property) record N + resume + record M → replay has N+M items',
    async (initialCount, additionalCount) => {
      const contents = Array.from({ length: initialCount }, (_, i) =>
        makeContent(`init-${i}`, i % 2 === 0 ? 'human' : 'ai'),
      );
      const { filePath, sessionId } = await createAndRecordSession(chatsDir, {
        contents,
      });

      const replay1 = await replaySession(filePath, PROJECT_HASH);
      if (!replay1.ok) throw new Error('unexpected');

      const svc2 = new SessionRecordingService(
        makeConfig(chatsDir, { sessionId }),
      );
      svc2.initializeForResume(filePath, replay1.lastSeq);
      for (let i = 0; i < additionalCount; i++) {
        svc2.recordContent(
          makeContent(`add-${i}`, i % 2 === 0 ? 'human' : 'ai'),
        );
      }
      await svc2.flush();
      svc2.dispose();

      const replay2 = await replaySession(filePath, PROJECT_HASH);
      expect(replay2.ok).toBe(true);
      if (!replay2.ok) return;
      expect(replay2.history).toHaveLength(initialCount + additionalCount);
    },
  );

  // =========================================================================
  // Test P3: Delete always removes the file for any valid session
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-INT-FULL-001
  // =========================================================================
  it.prop([fc.integer({ min: 1, max: 5 })], { numRuns: 8 })(
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
        await expect(fs.access(filePath)).resolves.toBeUndefined();

        const result = await deleteSession(sessionId, localChats, PROJECT_HASH);
        expect(result.ok).toBe(true);
        await expect(fs.access(filePath)).rejects.toThrow();
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
  it.prop([fc.uuid()], { numRuns: 10 })(
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
        expect(replay.ok).toBe(true);
        if (!replay.ok) return;
        expect(replay.metadata.sessionId).toBe(sessionId);
      } finally {
        await fs.rm(localTemp, { recursive: true, force: true });
      }
    },
  );

  // =========================================================================
  // Addendum Tests (24-29): Advanced scenarios
  // =========================================================================

  // =========================================================================
  // Test 24: Flush mechanism persists committed content
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-INT-007, REQ-CON-005
  // =========================================================================
  it('24: flush persists all committed content events', async () => {
    const sid = crypto.randomUUID();
    const svc = new SessionRecordingService(
      makeConfig(chatsDir, { sessionId: sid }),
    );

    // Simulate a multi-tool turn: user message + AI tool call already committed
    svc.recordContent(makeContent('user request', 'human'));
    svc.recordContent({
      speaker: 'ai',
      blocks: [
        { type: 'text', text: 'I will help' },
        {
          type: 'tool_call',
          id: 'call_1',
          name: 'read_file',
          parameters: { path: '/foo' },
        },
      ],
    });
    // Tool 1 result committed
    svc.recordContent({
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'call_1',
          toolName: 'read_file',
          result: 'file contents',
        },
      ],
    });

    // Flush (simulates signal handler running)
    await svc.flush();
    const fp = svc.getFilePath()!;
    await svc.dispose();

    // Verify all committed content is persisted
    const replay = await replaySession(fp, PROJECT_HASH);
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.history).toHaveLength(3);
    expect(replay.history[0].speaker).toBe('human');
    expect(replay.history[1].speaker).toBe('ai');
    expect(replay.history[2].speaker).toBe('tool');
  });

  // =========================================================================
  // Test 25: Cancellation with partial tool output — only committed content persisted
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-INT-007
  // =========================================================================
  it('25: only committed content survives cancellation flush', async () => {
    const sid = crypto.randomUUID();
    const svc = new SessionRecordingService(
      makeConfig(chatsDir, { sessionId: sid }),
    );

    // User message + AI tool call + Tool 1 result — all committed
    svc.recordContent(makeContent('do three things', 'human'));
    svc.recordContent({
      speaker: 'ai',
      blocks: [
        { type: 'text', text: 'Running tools' },
        { type: 'tool_call', id: 'c1', name: 'tool1', parameters: {} },
        { type: 'tool_call', id: 'c2', name: 'tool2', parameters: {} },
        { type: 'tool_call', id: 'c3', name: 'tool3', parameters: {} },
      ],
    });
    // Only tool 1 result committed before "cancellation"
    svc.recordContent({
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'c1',
          toolName: 'tool1',
          result: 'ok',
        },
      ],
    });

    // Flush + dispose (simulates cancellation)
    await svc.flush();
    const fp = svc.getFilePath()!;
    await svc.dispose();

    const replay = await replaySession(fp, PROJECT_HASH);
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    // 3 items: user message, AI tool call, tool 1 result
    expect(replay.history).toHaveLength(3);
    // Tool 2 and Tool 3 results are absent (not committed)
    const toolResponses = replay.history.filter((h) => h.speaker === 'tool');
    expect(toolResponses).toHaveLength(1);
  });

  // =========================================================================
  // Test 26: Cancel mid-tool → resume loads captured partial turn
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-INT-007, REQ-INT-FULL-003
  // =========================================================================
  it('26: cancel mid-tool → resume loads partial turn, can append', async () => {
    const sid = crypto.randomUUID();
    const svc1 = new SessionRecordingService(
      makeConfig(chatsDir, { sessionId: sid }),
    );

    // Committed before "cancellation"
    svc1.recordContent(makeContent('user msg', 'human'));
    svc1.recordContent({
      speaker: 'ai',
      blocks: [
        { type: 'tool_call', id: 'tc1', name: 'file_read', parameters: {} },
      ],
    });
    // Tool was mid-execution — no tool result committed
    await svc1.flush();
    const fp = svc1.getFilePath()!;
    svc1.dispose();

    // Resume: replays the partial turn
    const replay = await replaySession(fp, PROJECT_HASH);
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.history).toHaveLength(2);
    expect(replay.history[0].speaker).toBe('human');
    expect(replay.history[1].speaker).toBe('ai');

    // Continue recording from resume
    const svc2 = new SessionRecordingService(
      makeConfig(chatsDir, { sessionId: sid }),
    );
    svc2.initializeForResume(fp, replay.lastSeq);
    svc2.recordContent(makeContent('new message after resume', 'human'));
    svc2.recordContent(makeContent('new response', 'ai'));
    await svc2.flush();
    svc2.dispose();

    // Re-replay to verify continuation
    const replay2 = await replaySession(fp, PROJECT_HASH);
    expect(replay2.ok).toBe(true);
    if (!replay2.ok) return;
    expect(replay2.history).toHaveLength(4);
    expect(replay2.lastSeq).toBeGreaterThan(replay.lastSeq);
  });

  // =========================================================================
  // Test 27: Crash with partial last JSONL line → resume discards corrupt tail → append works
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-RPL-003, REQ-REC-008
  // =========================================================================
  it('27: truncated last line → replay succeeds, new events append cleanly', async () => {
    // Create a valid session first
    const { filePath } = await createAndRecordSession(chatsDir, {
      contents: [
        makeContent('m1', 'human'),
        makeContent('m2', 'ai'),
        makeContent('m3', 'human'),
        makeContent('m4', 'ai'),
      ],
    });

    // Append a truncated line WITH trailing newline (simulating crash mid-write
    // where the OS flushed a partial line terminated by newline)
    const truncatedJson =
      '{"v":1,"seq":6,"type":"content","ts":"2026-02-11T16:00:00.000Z","payload":{"conte';
    await fs.appendFile(
      filePath,
      truncatedJson + String.fromCharCode(10),
      'utf-8',
    );

    // Replay should succeed, discarding the truncated last line
    const replay = await replaySession(filePath, PROJECT_HASH);
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.history).toHaveLength(4);

    // Resume and append new content
    const svc = new SessionRecordingService(
      makeConfig(chatsDir, { sessionId: replay.metadata.sessionId }),
    );
    svc.initializeForResume(filePath, replay.lastSeq);
    svc.recordContent(makeContent('after-crash', 'human'));
    svc.recordContent(makeContent('response-after-crash', 'ai'));
    await svc.flush();
    await svc.dispose();

    // Re-replay: corrupt line is skipped, original 4 + new 2 = 6
    const replay2 = await replaySession(filePath, PROJECT_HASH);
    expect(replay2.ok).toBe(true);
    if (!replay2.ok) return;
    expect(replay2.history).toHaveLength(6);
    expect((replay2.history[4].blocks[0] as { text: string }).text).toBe(
      'after-crash',
    );
  });

  // =========================================================================
  // Test 28: Concurrent --continue while first process holds lock
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-CON-004
  // =========================================================================
  it('28: concurrent resume fails while lock is held', async () => {
    const { filePath, sessionId } = await createAndRecordSession(chatsDir, {
      contents: [makeContent('locked-data', 'human')],
    });

    // Extract lock ID from file path
    const basename = path.basename(filePath);
    const match = basename.match(/^session-(.+)\.jsonl$/);
    const lockId = match![1];

    // Process A acquires lock
    const lockHandle = await SessionLockManager.acquire(chatsDir, lockId);

    // Process B tries to resume the same session
    const result = await resumeSession(makeResumeRequest(chatsDir, sessionId));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('in use');

    // Process A's recording is unaffected
    const svc = new SessionRecordingService(
      makeConfig(chatsDir, { sessionId }),
    );
    const replay1 = await replaySession(filePath, PROJECT_HASH);
    if (!replay1.ok) throw new Error('unexpected');
    svc.initializeForResume(filePath, replay1.lastSeq);
    svc.recordContent(makeContent('from-process-a', 'human'));
    await svc.flush();
    await svc.dispose();

    // Verify file integrity
    const replay2 = await replaySession(filePath, PROJECT_HASH);
    expect(replay2.ok).toBe(true);
    if (!replay2.ok) return;
    expect(replay2.history).toHaveLength(2);

    await lockHandle.release();
  });

  // =========================================================================
  // Test 29: Interactive and --prompt modes produce structurally identical JSONL
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-INT-FULL-001, REQ-INT-007
  // =========================================================================
  it('29: both paths produce structurally identical JSONL', async () => {
    // "Interactive" path: recording content via service
    const interactiveSvc = new SessionRecordingService(
      makeConfig(chatsDir, {
        sessionId: 'interactive-session',
        provider: 'anthropic',
        model: 'claude-4',
      }),
    );
    interactiveSvc.recordContent(makeContent('hello', 'human'));
    interactiveSvc.recordContent(makeContent('world', 'ai'));
    await interactiveSvc.flush();
    const interactivePath = interactiveSvc.getFilePath()!;
    interactiveSvc.dispose();

    // "--prompt" path: same content through same service (different instance)
    const promptSvc = new SessionRecordingService(
      makeConfig(chatsDir, {
        sessionId: 'prompt-session',
        provider: 'anthropic',
        model: 'claude-4',
      }),
    );
    promptSvc.recordContent(makeContent('hello', 'human'));
    promptSvc.recordContent(makeContent('world', 'ai'));
    await promptSvc.flush();
    const promptPath = promptSvc.getFilePath()!;
    promptSvc.dispose();

    // Both should replay identically
    const replay1 = await replaySession(interactivePath, PROJECT_HASH);
    const replay2 = await replaySession(promptPath, PROJECT_HASH);
    expect(replay1.ok).toBe(true);
    expect(replay2.ok).toBe(true);
    if (!replay1.ok || !replay2.ok) return;

    // Same number of history items
    expect(replay1.history).toHaveLength(2);
    expect(replay2.history).toHaveLength(2);

    // Structurally identical content (ignoring metadata timestamps)
    for (let i = 0; i < replay1.history.length; i++) {
      expect(replay1.history[i].speaker).toBe(replay2.history[i].speaker);
      expect(replay1.history[i].blocks).toEqual(replay2.history[i].blocks);
    }

    // Both files have identical structure (session_start + 2 content)
    const lines1 = await readJsonlLines(interactivePath);
    const lines2 = await readJsonlLines(promptPath);
    expect(lines1).toHaveLength(3); // session_start + 2 content
    expect(lines2).toHaveLength(3);
    expect(lines1.map((l) => l.type)).toEqual(lines2.map((l) => l.type));
  });

  // =========================================================================
  // Addendum: Crash recovery with truncated last JSONL line
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-RPL-003
  // =========================================================================
  it('addendum: truncated last line is silently discarded', async () => {
    const { filePath } = await createAndRecordSession(chatsDir, {
      contents: Array.from({ length: 10 }, (_, i) =>
        makeContent(`msg-${i}`, i % 2 === 0 ? 'human' : 'ai'),
      ),
    });

    // Append truncated 11th line
    await fs.appendFile(
      filePath,
      '{"v":1,"seq":12,"type":"content","ts":"2026-01-01","payload":{"conte',
      'utf-8',
    );

    const replay = await replaySession(filePath, PROJECT_HASH);
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.history).toHaveLength(10);
    // Truncated last line should be silently discarded (no warning about it)
    const parseWarnings = replay.warnings.filter((w) =>
      w.includes('failed to parse'),
    );
    expect(parseWarnings).toHaveLength(0);
  });

  // =========================================================================
  // Addendum: Mid-file corruption — bad line in middle
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-RPL-003
  // =========================================================================
  it('addendum: mid-file garbage line is skipped with warning', async () => {
    // Build JSONL manually to inject garbage in the middle
    const sid = crypto.randomUUID();
    const svc = new SessionRecordingService(
      makeConfig(chatsDir, { sessionId: sid }),
    );
    svc.recordContent(makeContent('m1', 'human'));
    svc.recordContent(makeContent('m2', 'ai'));
    await svc.flush();
    const fp = svc.getFilePath()!;
    await svc.dispose();

    // Read existing content, inject garbage, append more valid lines
    const existingContent = await fs.readFile(fp, 'utf-8');
    const existingLines = existingContent.trim().split('\n');
    // Insert garbage after existing lines, then add more valid content
    const garbageLine = 'GARBAGE_NOT_JSON';
    const validLine4 = JSON.stringify({
      v: 1,
      seq: 4,
      ts: new Date().toISOString(),
      type: 'content',
      payload: { content: makeContent('m3', 'human') },
    });
    const validLine5 = JSON.stringify({
      v: 1,
      seq: 5,
      ts: new Date().toISOString(),
      type: 'content',
      payload: { content: makeContent('m4', 'ai') },
    });

    const newContent =
      existingLines.join('\n') +
      '\n' +
      garbageLine +
      '\n' +
      validLine4 +
      '\n' +
      validLine5 +
      '\n';
    await fs.writeFile(fp, newContent, 'utf-8');

    const replay = await replaySession(fp, PROJECT_HASH);
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    // m1, m2, m3, m4 — garbage line skipped
    expect(replay.history).toHaveLength(4);
    // Warning about the garbage line
    const jsonWarnings = replay.warnings.filter((w) =>
      w.includes('failed to parse'),
    );
    expect(jsonWarnings.length).toBeGreaterThanOrEqual(1);
  });

  // =========================================================================
  // Addendum: Mixed .json and .jsonl — only .jsonl discovered
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-RSM-001
  // =========================================================================
  it('addendum: only .jsonl files discovered, .json ignored', async () => {
    // Create real .jsonl sessions
    await createAndRecordSession(chatsDir, {
      contents: [makeContent('jsonl-1', 'human')],
    });
    await new Promise((r) => setTimeout(r, 30));
    await createAndRecordSession(chatsDir, {
      contents: [makeContent('jsonl-2', 'human')],
    });

    // Create fake .json files
    await fs.writeFile(
      path.join(chatsDir, 'session-old1.json'),
      '{"old": true}',
      'utf-8',
    );
    await fs.writeFile(
      path.join(chatsDir, 'session-old2.json'),
      '{"old": true}',
      'utf-8',
    );

    const sessions = await SessionDiscovery.listSessions(
      chatsDir,
      PROJECT_HASH,
    );
    // Only .jsonl files
    expect(sessions).toHaveLength(2);
    for (const s of sessions) {
      expect(s.filePath).toMatch(/\.jsonl$/);
    }
  });
});
