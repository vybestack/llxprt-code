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
/** @plan PLAN-20260211-SESSIONRECORDING.P25 */
import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { SessionRecordingService } from './SessionRecordingService.js';
import { replaySession } from './ReplayEngine.js';
import { SessionDiscovery } from './SessionDiscovery.js';
import { SessionLockManager } from './SessionLockManager.js';
import { resumeSession } from './resumeSession.js';
import {
  PROJECT_HASH,
  assertReplayOk,
  assertReplayError,
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
      makeConfig(dirs.chatsDir, { sessionId: sid }),
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
    assertReplayOk(replay);
    expect(replay.history).toHaveLength(3);
    expect(replay.history[0].speaker).toBe('human');
    expect(replay.history[1].speaker).toBe('ai');
    expect(replay.history[2].speaker).toBe('tool');
  });
});

describe('integration: full session recording lifecycle / addendum cases 2', () => {
  const dirs = useIntegrationDirs();
  // =========================================================================
  // Test 25: Cancellation with partial tool output — only committed content persisted
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-INT-007
  // =========================================================================
  it('25: only committed content survives cancellation flush', async () => {
    const sid = crypto.randomUUID();
    const svc = new SessionRecordingService(
      makeConfig(dirs.chatsDir, { sessionId: sid }),
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
    assertReplayOk(replay);
    // 3 items: user message, AI tool call, tool 1 result
    expect(replay.history).toHaveLength(3);
    // Tool 2 and Tool 3 results are absent (not committed)
    const toolResponses = replay.history.filter((h) => h.speaker === 'tool');
    expect(toolResponses).toHaveLength(1);
  });
});

describe('integration: full session recording lifecycle / addendum cases 3', () => {
  const dirs = useIntegrationDirs();
  // =========================================================================
  // Test 26: Cancel mid-tool → resume loads captured partial turn
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-INT-007, REQ-INT-FULL-003
  // =========================================================================
  it('26: cancel mid-tool → resume loads partial turn, can append', async () => {
    const sid = crypto.randomUUID();
    const svc1 = new SessionRecordingService(
      makeConfig(dirs.chatsDir, { sessionId: sid }),
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
    await svc1.dispose();

    // Resume: replays the partial turn
    const replay = await replaySession(fp, PROJECT_HASH);
    assertReplayOk(replay);
    expect(replay.history).toHaveLength(2);
    expect(replay.history[0].speaker).toBe('human');
    expect(replay.history[1].speaker).toBe('ai');

    // Continue recording from resume
    const svc2 = new SessionRecordingService(
      makeConfig(dirs.chatsDir, { sessionId: sid }),
    );
    svc2.initializeForResume(fp, replay.lastSeq);
    svc2.recordContent(makeContent('new message after resume', 'human'));
    svc2.recordContent(makeContent('new response', 'ai'));
    await svc2.flush();
    void svc2.dispose();

    // Re-replay to verify continuation
    const replay2 = await replaySession(fp, PROJECT_HASH);
    assertReplayOk(replay2);
    expect(replay2.history).toHaveLength(4);
    expect(replay2.lastSeq).toBeGreaterThan(replay.lastSeq);
  });
});

describe('integration: full session recording lifecycle / addendum cases 4', () => {
  const dirs = useIntegrationDirs();
  // =========================================================================
  // Test 27: Crash with partial last JSONL line → resume discards corrupt tail → append works
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-RPL-003, REQ-REC-008
  // =========================================================================
  it('27: truncated last line → replay succeeds, new events append cleanly', async () => {
    // Create a valid session first
    const { filePath } = await createAndRecordSession(dirs.chatsDir, {
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
    assertReplayOk(replay);
    expect(replay.history).toHaveLength(4);

    // Resume and append new content
    const svc = new SessionRecordingService(
      makeConfig(dirs.chatsDir, { sessionId: replay.metadata.sessionId }),
    );
    svc.initializeForResume(filePath, replay.lastSeq);
    svc.recordContent(makeContent('after-crash', 'human'));
    svc.recordContent(makeContent('response-after-crash', 'ai'));
    await svc.flush();
    await svc.dispose();

    // Re-replay: corrupt line is skipped, original 4 + new 2 = 6
    const replay2 = await replaySession(filePath, PROJECT_HASH);
    assertReplayOk(replay2);
    expect(replay2.history).toHaveLength(6);
    expect((replay2.history[4].blocks[0] as { text: string }).text).toBe(
      'after-crash',
    );
  });
});

describe('integration: full session recording lifecycle / addendum cases 5', () => {
  const dirs = useIntegrationDirs();
  // =========================================================================
  // Test 28: Concurrent --continue while first process holds lock
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-CON-004
  // =========================================================================
  it('28: concurrent resume fails while lock is held', async () => {
    const { filePath, sessionId } = await createAndRecordSession(
      dirs.chatsDir,
      {
        contents: [makeContent('locked-data', 'human')],
      },
    );

    // Process A acquires the full header-session-ID lock.
    const lockHandle = await SessionLockManager.acquire(
      dirs.chatsDir,
      sessionId,
    );

    // Process B tries to resume the same session
    const result = await resumeSession(
      makeResumeRequest(dirs.chatsDir, sessionId),
    );
    assertReplayError(result);
    expect(result.error).toContain('in use');

    // Process A's recording is unaffected
    const svc = new SessionRecordingService(
      makeConfig(dirs.chatsDir, { sessionId }),
    );
    const replay1 = await replaySession(filePath, PROJECT_HASH);
    assertReplayOk(replay1);
    svc.initializeForResume(filePath, replay1.lastSeq);
    svc.recordContent(makeContent('from-process-a', 'human'));
    await svc.flush();
    await svc.dispose();

    // Verify file integrity
    const replay2 = await replaySession(filePath, PROJECT_HASH);
    assertReplayOk(replay2);
    expect(replay2.history).toHaveLength(2);

    await lockHandle.release();
  });
});

describe('integration: full session recording lifecycle / addendum cases 6', () => {
  const dirs = useIntegrationDirs();
  // =========================================================================
  // Test 29: Interactive and --prompt modes produce structurally identical JSONL
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-INT-FULL-001, REQ-INT-007
  // =========================================================================
  it('29: both paths produce structurally identical JSONL', async () => {
    // "Interactive" path: recording content via service
    const interactiveSvc = new SessionRecordingService(
      makeConfig(dirs.chatsDir, {
        sessionId: 'interactive-session',
        provider: 'anthropic',
        model: 'claude-4',
      }),
    );
    interactiveSvc.recordContent(makeContent('hello', 'human'));
    interactiveSvc.recordContent(makeContent('world', 'ai'));
    await interactiveSvc.flush();
    const interactivePath = interactiveSvc.getFilePath()!;
    void interactiveSvc.dispose();

    // "--prompt" path: same content through same service (different instance)
    const promptSvc = new SessionRecordingService(
      makeConfig(dirs.chatsDir, {
        sessionId: 'prompt-session',
        provider: 'anthropic',
        model: 'claude-4',
      }),
    );
    promptSvc.recordContent(makeContent('hello', 'human'));
    promptSvc.recordContent(makeContent('world', 'ai'));
    await promptSvc.flush();
    const promptPath = promptSvc.getFilePath()!;
    void promptSvc.dispose();

    // Both should replay identically
    const replay1 = await replaySession(interactivePath, PROJECT_HASH);
    const replay2 = await replaySession(promptPath, PROJECT_HASH);
    expect(replay1.ok).toBe(true);
    expect(replay2.ok).toBe(true);
    assertReplayOk(replay1);
    assertReplayOk(replay2);

    // Same number of history items
    expect(replay1.history).toHaveLength(2);
    expect(replay2.history).toHaveLength(2);

    // Structurally identical content (ignoring metadata timestamps)
    for (let i = 0; i < replay1.history.length; i++) {
      expect(replay1.history[i].speaker).toBe(replay2.history[i].speaker);
      expect(replay1.history[i].blocks).toStrictEqual(
        replay2.history[i].blocks,
      );
    }

    // Both files have identical structure (session_start + 2 content)
    const lines1 = await readJsonlLines(interactivePath);
    const lines2 = await readJsonlLines(promptPath);
    expect(lines1).toHaveLength(3); // session_start + 2 content
    expect(lines2).toHaveLength(3);
    expect(lines1.map((l) => l.type)).toStrictEqual(lines2.map((l) => l.type));
  });
});

describe('integration: full session recording lifecycle / addendum cases 7', () => {
  const dirs = useIntegrationDirs();
  // =========================================================================
  // Addendum: Crash recovery with truncated last JSONL line
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-RPL-003
  // =========================================================================
  it('addendum: truncated last line is silently discarded', async () => {
    const { filePath } = await createAndRecordSession(dirs.chatsDir, {
      contents: Array.from({ length: 10 }, (_, i) =>
        makeContent(`msg-${i}`, alternatingSpeaker(i)),
      ),
    });

    // Append truncated 11th line
    await fs.appendFile(
      filePath,
      '{"v":1,"seq":12,"type":"content","ts":"2026-01-01","payload":{"conte',
      'utf-8',
    );

    const replay = await replaySession(filePath, PROJECT_HASH);
    assertReplayOk(replay);
    expect(replay.history).toHaveLength(10);
    // Truncated last line should be silently discarded (no warning about it)
    const parseWarnings = replay.warnings.filter((w) =>
      w.includes('failed to parse'),
    );
    expect(parseWarnings).toHaveLength(0);
  });
});

describe('integration: full session recording lifecycle / addendum cases 8', () => {
  const dirs = useIntegrationDirs();
  // =========================================================================
  // Addendum: Mid-file corruption — bad line in middle
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-RPL-003
  // =========================================================================
  it('addendum: mid-file garbage line is skipped with warning', async () => {
    // Build JSONL manually to inject garbage in the middle
    const sid = crypto.randomUUID();
    const svc = new SessionRecordingService(
      makeConfig(dirs.chatsDir, { sessionId: sid }),
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
    assertReplayOk(replay);
    // m1, m2, m3, m4 — garbage line skipped
    expect(replay.history).toHaveLength(4);
    // Warning about the garbage line
    const jsonWarnings = replay.warnings.filter((w) =>
      w.includes('failed to parse'),
    );
    expect(jsonWarnings.length).toBeGreaterThanOrEqual(1);
  });
});

describe('integration: full session recording lifecycle / addendum cases 9', () => {
  const dirs = useIntegrationDirs();
  // =========================================================================
  // Addendum: Mixed .json and .jsonl — only .jsonl discovered
  // @plan PLAN-20260211-SESSIONRECORDING.P25
  // @requirement REQ-RSM-001
  // =========================================================================
  it('addendum: only .jsonl files discovered, .json ignored', async () => {
    // Create real .jsonl sessions
    await createAndRecordSession(dirs.chatsDir, {
      contents: [makeContent('jsonl-1', 'human')],
    });
    await new Promise((r) => setTimeout(r, 30));
    await createAndRecordSession(dirs.chatsDir, {
      contents: [makeContent('jsonl-2', 'human')],
    });

    // Create fake .json files
    await fs.writeFile(
      path.join(dirs.chatsDir, 'session-old1.json'),
      '{"old": true}',
      'utf-8',
    );
    await fs.writeFile(
      path.join(dirs.chatsDir, 'session-old2.json'),
      '{"old": true}',
      'utf-8',
    );

    const sessions = await SessionDiscovery.listSessions(
      dirs.chatsDir,
      PROJECT_HASH,
    );
    // Only .jsonl files
    expect(sessions).toHaveLength(2);
    for (const s of sessions) {
      expect(s.filePath).toMatch(/\.jsonl$/);
    }
  });
});
