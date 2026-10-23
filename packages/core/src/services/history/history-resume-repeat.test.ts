/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * #854: resuming a session binds chronology to rows that lack it. Rows that
 * already carry it must not be recorded again, or every --continue makes the
 * journal bigger and the next resume slower.
 */
import { collectRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROJECT_HASH } from '../../recording/__tests__/support/p05dTestKit.js';
import { HistoryService } from './HistoryService.js';

import { createResumableSession } from '../../recording/__tests__/support/resumableSession.js';
import { resumeSession } from '../../recording/resumeSession.js';

let root: string;

interface JournalRowsShape {
  readonly rows: number;
  readonly texts: string[];
  readonly chronology: unknown[];
}

async function resumeJournalOnce(sessionId: string): Promise<JournalRowsShape> {
  const result = await resumeSession({
    continueRef: sessionId,
    chatsDir: root,
    projectHash: PROJECT_HASH,
    currentProvider: 'anthropic',
    currentModel: 'model-1',
    workspaceDirs: [],
  });
  if (!result.ok) throw new Error(result.error);
  const service = new HistoryService({});
  try {
    await service.adoptResumeBoot(result.recording, result.boot);
    await result.recording.flush();
    const shape: JournalRowsShape = { rows: 0, texts: [], chronology: [] };
    await collectRowsForAssertions(service.streamRawHistory(), (rows) => {
      for (const row of rows) {
        shape.texts.push(
          row.blocks[0].type === 'text' ? row.blocks[0].text : '',
        );
        shape.chronology.push(row.metadata?.chronology);
      }
    });
    return { ...shape, rows: shape.texts.length };
  } finally {
    await service.dispose();
    await result.recording.dispose();
  }
}

describe('repeated resume of an unchanged journal session', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'history-resume-repeat-journal-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('keeps the rows and their chronology the same on every resume', async () => {
    const fixture = await createResumableSession(root, { rows: 3 });

    const shapes: JournalRowsShape[] = [];
    for (let resume = 0; resume < 4; resume += 1)
      shapes.push(await resumeJournalOnce(fixture.sessionId));

    expect(shapes[0].rows).toBe(3);
    expect(shapes[0].chronology.every((marker) => marker !== undefined)).toBe(
      true,
    );
    for (const later of shapes.slice(1)) expect(later).toStrictEqual(shapes[0]);
  });
});
