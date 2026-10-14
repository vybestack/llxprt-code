/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
/**
 * A history journal is cloned while its source may be inside a replacement.
 * The clone's recorder must close that transaction before it writes anything
 * else, or the next replacement nests inside it and every reader rejects the
 * file.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  commitReplacement,
  newRecorder,
  recordInterruptedReplace,
  recordTypesOf,
  viaBootStream,
  viaDurableFold,
  viaResolver,
  type InterruptedReplaceOptions,
} from '../../recording/__tests__/support/crashedReplaceFixture.js';
import type { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import { cloneHistoryJournal } from './cloneHistoryJournal.js';

type Clone = Awaited<ReturnType<typeof cloneHistoryJournal>>;

let sourceDir: string | undefined;
let source: SessionRecordingService | undefined;
let clone: Clone | undefined;

async function cloneOf(options: InterruptedReplaceOptions): Promise<Clone> {
  sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clone-journal-'));
  source = newRecorder(sourceDir);
  await recordInterruptedReplace(source, options);
  clone = await cloneHistoryJournal(source, () => false);
  return clone;
}

function journalOf(copy: Clone): string {
  const file = copy.recorder.getFilePath();
  if (file === null) throw new Error('clone has no journal');
  return file;
}

describe('cloneHistoryJournal with a replacement in flight', () => {
  afterEach(async () => {
    await clone?.recorder.dispose();
    if (clone !== undefined)
      await fs.rm(clone.directory, { recursive: true, force: true });
    await source?.dispose();
    if (sourceDir !== undefined)
      await fs.rm(sourceDir, { recursive: true, force: true });
    clone = undefined;
    source = undefined;
    sourceDir = undefined;
  });

  for (const taggedRows of [[], ['abandoned-0', 'abandoned-1']]) {
    it(`replaces readably after a source with ${taggedRows.length} unfinished tagged rows`, async () => {
      const copy = await cloneOf({ taggedRows });

      await commitReplacement(copy.recorder, ['new-a', 'new-b']);

      const file = journalOf(copy);
      expect({
        resolver: await viaResolver(file),
        durableFold: await viaDurableFold(file),
        bootStream: await viaBootStream(file),
      }).toStrictEqual({
        resolver: ['new-a', 'new-b'],
        durableFold: ['new-a', 'new-b'],
        bootStream: ['new-a', 'new-b'],
      });
    });
  }

  it('ends the copy outside the transaction and reports the byte offset past the abort', async () => {
    const copy = await cloneOf({ taggedRows: ['abandoned'] });

    const file = journalOf(copy);
    const types = await recordTypesOf(file);
    expect(types.slice(-3)).toStrictEqual([
      'replace_begin',
      'content',
      'replace_abort',
    ]);
    expect(copy.byteOffset).toBe((await fs.stat(file)).size);
    expect(await viaResolver(file)).toStrictEqual(['old']);
  });

  it('adds no abort when the source replacement committed', async () => {
    const copy = await cloneOf({ taggedRows: ['new-0'], commit: true });

    const file = journalOf(copy);
    expect(await recordTypesOf(file)).not.toContain('replace_abort');
    expect(copy.byteOffset).toBe((await fs.stat(file)).size);
    expect(await viaResolver(file)).toStrictEqual(['new-0']);

    await commitReplacement(copy.recorder, ['after']);
    expect(await viaResolver(file)).toStrictEqual(['after']);
    expect(await viaDurableFold(file)).toStrictEqual(['after']);
  });

  it('adds no abort when a later record already abandoned the transaction', async () => {
    const copy = await cloneOf({
      taggedRows: ['abandoned'],
      abandonedBy: 'after',
    });

    expect(await recordTypesOf(journalOf(copy))).not.toContain('replace_abort');
    expect(await viaResolver(journalOf(copy))).toStrictEqual(['old', 'after']);
  });
});
