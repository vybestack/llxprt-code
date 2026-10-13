/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * #854: resuming a session binds chronology to rows that lack it. Rows that
 * already carry it must not be recorded again, or every --continue makes the
 * journal bigger and the next resume slower.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
import { HistoryService } from './HistoryService.js';
import {
  createRecordedSession,
  PROJECT_HASH,
} from '../../recording/p05dTestKit.js';
import { resumeSession } from '../../recording/resumeSession.js';

interface JournalShape {
  readonly bytes: number;
  readonly records: number;
  readonly chronologyBinds: number;
  readonly chronology: unknown[];
}

let root: string;

async function resumeOnce(sessionId: string): Promise<JournalShape> {
  const result = await resumeSession({
    continueRef: sessionId,
    chatsDir: root,
    projectHash: PROJECT_HASH,
    currentProvider: 'anthropic',
    currentModel: 'claude-4',
    workspaceDirs: [],
  });
  if (!result.ok) throw new Error(result.error);
  const service = new HistoryService();
  try {
    await service.adoptResumeBoot(result.recording, result.boot);
    await result.recording.flush();
    const chronology: unknown[] = [];
    await collectRowsForAssertions(service.streamRawHistory(), (rows) => {
      for (const row of rows) chronology.push(row.metadata?.chronology);
    });
    const text = await readFile(result.boot.filePath, 'utf8');
    // Every resume appends one "Session resumed" marker by design; what must
    // not grow is everything else.
    const lines = text
      .split('\n')
      .filter(
        (line) => line !== '' && !line.includes('"type":"session_event"'),
      );
    return {
      bytes: Buffer.byteLength(lines.join('\n')),
      records: lines.length,
      chronologyBinds: lines.filter((line) =>
        line.includes('"type":"chronology_bind"'),
      ).length,
      chronology,
    };
  } finally {
    await service.dispose();
    await result.recording.dispose();
  }
}

describe('repeated resume of an unchanged session', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'history-resume-repeat-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('binds chronology once and then writes nothing on later resumes', async () => {
    const fixture = await createRecordedSession(root, { rows: 3 });
    const initial = (await readFile(fixture.filePath, 'utf8'))
      .split('\n')
      .filter((line) => line !== '').length;

    const shapes: JournalShape[] = [];
    for (let resume = 0; resume < 4; resume += 1)
      shapes.push(await resumeOnce(fixture.sessionId));

    expect(shapes[0].records).toBeGreaterThan(initial);
    expect(shapes[0].chronologyBinds).toBe(3);
    for (const later of shapes.slice(1)) {
      expect(later.records).toBe(shapes[0].records);
      expect(later.bytes).toBe(shapes[0].bytes);
      expect(later.chronology).toStrictEqual(shapes[0].chronology);
    }
  });
});
