/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4036: a refused provider attempt is an audit-only `refusal` journal
 * record. It materializes the session file, and replay accepts it without
 * touching history or reporting an unknown event type.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { SessionRecordingService } from './SessionRecordingService.js';
import { replaySession } from './ReplayEngine.js';
import type { RefusalPayload } from './types.js';
import {
  assertReplayOk,
  makeContent,
} from './__tests__/replay-test-helpers.js';

const PROJECT_HASH = 'refusal-project';

const REFUSAL: RefusalPayload = {
  time: '2026-11-11T21:12:00.000Z',
  provider: 'claudecode',
  model: 'claude-opus-5-5',
  promptId: 'prompt-1',
  turnId: 'turn-1',
  attemptIndex: 0,
  finishReason: 'refusal',
  rawStopReason: 'refusal',
  usage: { promptTokens: 120, completionTokens: 0, totalTokens: 120 },
  action: 'stop',
};

describe('refusal journal record (issue #4036)', () => {
  let chatsDir: string;
  const services: SessionRecordingService[] = [];

  beforeEach(async () => {
    chatsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'recording-refusal-'));
  });

  afterEach(async () => {
    for (const service of services.splice(0)) await service.dispose();
    await fs.rm(chatsDir, { recursive: true, force: true });
  });

  function createService(): SessionRecordingService {
    const service = new SessionRecordingService({
      sessionId: 'refusal-session-0001',
      projectHash: PROJECT_HASH,
      chatsDir,
      workspaceDirs: [chatsDir],
      provider: 'claudecode',
      model: 'claude-opus-5-5',
    });
    services.push(service);
    return service;
  }

  it('materializes a session whose only event is a refused first request', async () => {
    const service = createService();

    service.recordRefusal(REFUSAL);
    await service.flush();

    const filePath = service.getFilePath();
    expect(filePath).not.toBeNull();
    const lines = (await fs.readFile(filePath!, 'utf-8')).trim().split('\n');
    expect(lines.map((line) => JSON.parse(line).type)).toStrictEqual([
      'session_start',
      'refusal',
    ]);
  });

  it('writes the refusal payload verbatim', async () => {
    const service = createService();

    service.recordRefusal(REFUSAL);
    await service.flush();

    const lines = (await fs.readFile(service.getFilePath()!, 'utf-8'))
      .trim()
      .split('\n');
    expect(JSON.parse(lines[1]).payload).toStrictEqual(REFUSAL);
  });

  it('replays a refusal-only session with empty history and no warnings', async () => {
    const service = createService();
    service.recordRefusal(REFUSAL);
    await service.flush();

    const result = await replaySession(service.getFilePath()!, PROJECT_HASH);

    assertReplayOk(result);
    expect({
      history: result.history,
      warnings: result.warnings,
    }).toStrictEqual({
      history: [],
      warnings: [],
    });
  });

  it('leaves the history of surrounding content unchanged on replay', async () => {
    const service = createService();
    service.recordContent(makeContent('first question', 'human'));
    service.recordContent(makeContent('first answer', 'ai'));
    service.recordRefusal(REFUSAL);
    service.recordContent(makeContent('second question', 'human'));
    await service.flush();

    const result = await replaySession(service.getFilePath()!, PROJECT_HASH);

    assertReplayOk(result);
    expect(
      result.history.map((content) => ({
        speaker: content.speaker,
        blocks: content.blocks,
      })),
    ).toStrictEqual([
      { speaker: 'human', blocks: [{ type: 'text', text: 'first question' }] },
      { speaker: 'ai', blocks: [{ type: 'text', text: 'first answer' }] },
      { speaker: 'human', blocks: [{ type: 'text', text: 'second question' }] },
    ]);
    expect(result.warnings).toStrictEqual([]);
  });

  it('reports a refusal record with an invalid payload as malformed', async () => {
    const service = createService();
    service.recordContent(makeContent('first question', 'human'));
    await service.flush();
    const filePath = service.getFilePath()!;
    const malformed = JSON.stringify({
      v: 1,
      seq: 3,
      ts: '2026-11-11T21:12:00.000Z',
      type: 'refusal',
      payload: { action: 'explode' },
    });
    await fs.appendFile(filePath, `${malformed}\n`);

    const result = await replaySession(filePath, PROJECT_HASH);

    assertReplayOk(result);
    expect(result.warnings.some((w) => w.includes('malformed refusal'))).toBe(
      true,
    );
    expect(result.history).toHaveLength(1);
  });
});
