/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
/**
 * A process that stops inside a replacement leaves `replace_begin` (and maybe
 * tagged rows) at the end of the journal. Resuming must close that transaction
 * in the file, so a later replacement is a legal journal for every reader.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import {
  CrashedReplaceSession,
  allReadersSee,
  row,
} from './__tests__/support/crashedReplaceFixture.js';

let session: CrashedReplaceSession | undefined;

async function crashed(
  taggedRows: readonly string[],
  commit = false,
): Promise<CrashedReplaceSession> {
  session = await CrashedReplaceSession.create({ taggedRows, commit });
  return session;
}

describe('replacement after resuming an unfinished replacement', () => {
  afterEach(async () => {
    await session?.cleanup();
    session = undefined;
  });

  it('replaces after a begin with no rows written', async () => {
    const crash = await crashed([]);
    const { history } = await crash.resumeHistory();

    await history.replaceBatch([row('restored', 3), row('restored again', 4)]);
    await crash.stop();

    expect(await crash.readEveryWay()).toStrictEqual(
      allReadersSee(['restored', 'restored again']),
    );
  });

  it('replaces after a partially written transaction', async () => {
    const crash = await crashed(['incomplete-0', 'incomplete-1']);
    const { history } = await crash.resumeHistory();

    await history.replaceBatch([row('restored', 4), row('restored again', 5)]);
    await crash.stop();

    expect(await crash.readEveryWay()).toStrictEqual(
      allReadersSee(['restored', 'restored again']),
    );
  });

  it('aborts the unfinished transaction before anything else is recorded', async () => {
    const crash = await crashed(['incomplete']);
    const { resumed } = await crash.resumeHistory('another-model');
    await resumed.recording.flush();

    const records = await crash.records();
    const begin = records.findIndex(
      (record) => record.type === 'replace_begin',
    );
    expect(records.slice(begin).map((record) => record.type)).toStrictEqual([
      'replace_begin',
      'content',
      'replace_abort',
      'session_event',
      'provider_switch',
      'session_event',
    ]);
    expect(records[begin + 2].payload).toStrictEqual({ txId: 'crashed' });
  });

  it('keeps the prior history when nothing is replaced after the resume', async () => {
    const crash = await crashed(['incomplete']);
    const { resumed } = await crash.resumeHistory();
    await resumed.recording.flush();
    await crash.stop();

    expect(await crash.readEveryWay()).toStrictEqual(allReadersSee(['old']));
  });

  it('aborts once across repeated restarts', async () => {
    const crash = await crashed(['incomplete']);
    await crash.resume();
    await crash.stop();
    await crash.resume();
    await crash.stop();
    const { history } = await crash.resumeHistory();
    await history.replaceBatch([row('restored', 4)]);
    await crash.stop();

    const types = await crash.recordTypes();
    expect(types.filter((type) => type === 'replace_abort')).toHaveLength(1);
    expect(await crash.readEveryWay()).toStrictEqual(
      allReadersSee(['restored']),
    );
    await crash.resume();
    await crash.stop();
    expect(await crash.readEveryWay()).toStrictEqual(
      allReadersSee(['restored']),
    );
  });

  it('adds no abort to a journal whose replacement committed', async () => {
    const crash = await crashed(['new-0', 'new-1'], true);
    await crash.resume();
    await crash.stop();

    expect(await crash.recordTypes()).not.toContain('replace_abort');
    expect(await crash.readEveryWay()).toStrictEqual(
      allReadersSee(['new-0', 'new-1']),
    );
  });

  it('adds no abort when a later record already abandoned the transaction', async () => {
    session = await CrashedReplaceSession.create({
      taggedRows: ['incomplete'],
      abandonedBy: 'after',
    });
    await session.resume();
    await session.stop();

    expect(await session.recordTypes()).not.toContain('replace_abort');
    expect(await session.readEveryWay()).toStrictEqual(
      allReadersSee(['old', 'after']),
    );
  });
});
