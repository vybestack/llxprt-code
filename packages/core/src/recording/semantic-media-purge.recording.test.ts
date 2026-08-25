/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IContent } from '../services/history/IContent.js';
import { replaySession } from './ReplayEngine.js';
import { SessionRecordingService } from './SessionRecordingService.js';

const PROJECT_HASH = 'semantic-purge-recording';

const original: IContent[] = [
  {
    speaker: 'human',
    blocks: [
      { type: 'text', text: 'inspect' },
      {
        type: 'media',
        mimeType: 'image/png',
        encoding: 'base64',
        data: 'aW1hZ2U=',
      },
    ],
  },
];

const purged: IContent[] = [
  {
    speaker: 'human',
    blocks: [{ type: 'text', text: 'inspect' }],
    metadata: {
      semanticMediaPurgeFrontier: { contentIndex: 0, blockIndex: 0 },
    },
  },
];

describe('semantic purge recording state', () => {
  let directory = '';

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'semantic-purge-recording-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('replays candidate replacement and frontier from one durable event', async () => {
    const recording = new SessionRecordingService({
      sessionId: 'semantic-session',
      projectHash: PROJECT_HASH,
      chatsDir: directory,
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
    });
    recording.recordContent(original[0]);
    recording.recordSemanticMediaPurge(purged, {
      contentIndex: 0,
      blockIndex: 0,
    });
    await recording.flush();
    const path = recording.getFilePath();
    if (path === null) throw new Error('Expected recording path');

    const replay = await replaySession(path, PROJECT_HASH);
    await recording.dispose();

    if (!replay.ok) throw new Error(replay.error);
    expect(replay.ok).toBe(true);
    expect(replay.history).toEqual(purged);
    expect(replay.semanticMediaPurgeFrontier).toEqual({
      contentIndex: 0,
      blockIndex: 0,
    });
  });

  it('rejects unsupported recording versions during replay', async () => {
    const recording = new SessionRecordingService({
      sessionId: 'unsupported-version',
      projectHash: PROJECT_HASH,
      chatsDir: directory,
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
    });
    recording.recordContent({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'versioned' }],
    });
    await recording.flush();
    const path = recording.getFilePath();
    if (path === null) throw new Error('Expected recording path');
    await recording.dispose();
    const lines = (await readFile(path, 'utf8')).trim().split('\n');
    const contentLine: unknown = JSON.parse(lines[1] ?? '{}');
    if (typeof contentLine !== 'object' || contentLine === null) {
      throw new Error('Expected content line');
    }
    await writeFile(
      path,
      `${lines[0]}\n${JSON.stringify({ ...contentLine, v: 999 })}\n`,
    );

    const replay = await replaySession(path, PROJECT_HASH);

    expect(replay.ok).toBe(false);
    if (replay.ok) throw new Error('Expected replay failure');
    expect(replay.error).toMatch(/recording version/i);
  });
});
