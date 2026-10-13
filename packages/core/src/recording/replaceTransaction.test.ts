/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
/**
 * Replace transactions make a streamed history replacement atomic: every
 * reader folds a committed transaction to the new rows and an unfinished one
 * to the prior history. Each journal below is folded by independent readers
 * (resolver, disk-backed durable fold, pending/overlay fold, in-memory store
 * fold) and all of them must agree.
 */
import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IContent } from '../services/history/IContent.js';
import {
  HistoryJournalStore,
  type HistoryJournalOp,
} from '../services/history/historyJournalStore.js';
import { SessionRecordingService } from './SessionRecordingService.js';
import { JournalResolver } from './journalResolver.js';
import { foldDurableRows } from './durableRowFold.js';

function row(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }], metadata: {} };
}

function textOf(content: IContent): string {
  const block = content.blocks[0];
  if (block.type !== 'text') throw new Error('expected a text block');
  return block.text;
}

const OLD = ['old-0', 'old-1', 'old-2'];
const NEW = ['new-0', 'new-1', 'new-2'];

function transactionOps(
  txId: string,
  rows: readonly string[],
  commit: boolean,
): HistoryJournalOp[] {
  const ops: HistoryJournalOp[] = [{ kind: 'replaceBegin', txId }];
  for (const text of rows)
    ops.push({ kind: 'content', content: row(text), tx: txId });
  if (commit) ops.push({ kind: 'replaceCommit', txId, rowCount: rows.length });
  return ops;
}

interface Written {
  readonly root: string;
  readonly file: string;
  /** Byte offset after each journal line, in order. */
  readonly ends: number[];
  readonly lines: string[];
}

async function writeJournal(
  ops: readonly HistoryJournalOp[],
): Promise<Written> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'replace-tx-test-'));
  const recorder = new SessionRecordingService({
    sessionId: 'replace-tx',
    projectHash: 'replace-tx',
    chatsDir: root,
    workspaceDirs: [root],
    provider: 'test',
    model: 'test',
  });
  const store = new HistoryJournalStore(recorder);
  for (const op of ops) store.apply(op);
  await store.waitForDurable();
  const file = recorder.getFilePath();
  store.dispose();
  await recorder.dispose();
  if (file === null) throw new Error('journal was not materialized');
  const lines = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((text) => text !== '');
  const ends: number[] = [];
  let total = 0;
  for (const text of lines) {
    total += Buffer.byteLength(text) + 1;
    ends.push(total);
  }
  return { root, file, ends, lines };
}

function prefixFile(written: Written, lineCount: number, tail = ''): string {
  const target = path.join(written.root, `prefix-${lineCount}.jsonl`);
  fs.writeFileSync(
    target,
    written.lines.slice(0, lineCount).join('\n') + '\n' + tail,
  );
  return target;
}

function plainLine(seq: number, text: string): string {
  return (
    JSON.stringify({
      v: 2,
      seq,
      ts: '2026-10-10T00:00:00Z',
      type: 'content',
      payload: { content: row(text) },
    }) + '\n'
  );
}

async function viaResolver(file: string): Promise<string[]> {
  const resolver = await JournalResolver.open(file);
  const rows: string[] = [];
  try {
    for await (const entry of resolver.resolve())
      rows.push(textOf(entry.content));
  } finally {
    await resolver.close();
  }
  return rows;
}

async function viaDurableFold(file: string): Promise<string[]> {
  const fold = await foldDurableRows({
    filePath: file,
    maxBytes: fs.statSync(file).size,
  });
  const rows: string[] = [];
  try {
    for (let index = 0; index < fold.length; index += 1)
      rows.push(textOf(await fold.readRow(index)));
  } finally {
    await fold.close();
  }
  return rows;
}

const READERS: ReadonlyArray<
  readonly [string, (file: string) => Promise<string[]>]
> = [
  ['resolver', viaResolver],
  ['durable fold', viaDurableFold],
];

async function readAll(file: string): Promise<Record<string, string[]>> {
  const rows: Record<string, string[]> = {};
  for (const [name, read] of READERS) rows[name] = await read(file);
  return rows;
}

/** What every reader must return when they agree on `expected`. */
function agreed(expected: readonly string[]): Record<string, string[]> {
  const rows: Record<string, string[]> = {};
  for (const [name] of READERS) rows[name] = [...expected];
  return rows;
}

/** Rows through the pending-overlay cursor fold, an independent reader. */
function overlayRows(store: HistoryJournalStore): string[] {
  return store.withReadRows((cursor) => [...cursor.rows()].map(textOf));
}

/**
 * Append records verbatim after a seeded row. Neither the store nor the
 * recorder will publish a malformed transaction, so the lines go straight to
 * the file to prove that every reader still rejects one.
 */
async function appendRaw(
  recorder: SessionRecordingService,
  ops: readonly HistoryJournalOp[],
): Promise<string> {
  recorder.enqueue('content', { content: row('seed') });
  await recorder.flush();
  const file = recorder.getFilePath();
  if (file === null) throw new Error('journal was not materialized');
  let seq = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length;
  for (const op of ops) {
    const record = rawRecord(op);
    if (record === undefined) continue;
    seq += 1;
    fs.appendFileSync(
      file,
      JSON.stringify({
        v: 2,
        seq,
        ts: '2026-10-10T00:00:00Z',
        ...record,
      }) + '\n',
    );
  }
  return file;
}

function rawRecord(
  op: HistoryJournalOp,
): { type: string; payload: unknown } | undefined {
  switch (op.kind) {
    case 'content':
      return { type: 'content', payload: { content: op.content, tx: op.tx } };
    case 'replaceBegin':
      return { type: 'replace_begin', payload: { txId: op.txId } };
    case 'replaceCommit':
      return {
        type: 'replace_commit',
        payload: { txId: op.txId, rowCount: op.rowCount },
      };
    default:
      return undefined;
  }
}

async function foldOutcomes(file: string): Promise<Record<string, string>> {
  const outcomes: Record<string, string> = {};
  for (const [name, read] of READERS)
    outcomes[name] = await read(file).then(
      () => 'folded',
      (error: unknown) => String(error),
    );
  return outcomes;
}

async function journalWithTransaction(commit: boolean): Promise<Written> {
  return writeJournal([
    ...OLD.map(
      (text): HistoryJournalOp => ({ kind: 'content', content: row(text) }),
    ),
    ...transactionOps('tx-1', NEW, commit),
  ]);
}

describe('replace transactions', () => {
  it('a committed transaction replays to the new rows in every reader', async () => {
    const written = await journalWithTransaction(true);
    try {
      expect(await readAll(written.file)).toStrictEqual(agreed(NEW));
    } finally {
      fs.rmSync(written.root, { recursive: true, force: true });
    }
  });

  it('a journal cut at any point before commit replays to the prior rows', async () => {
    const written = await journalWithTransaction(true);
    try {
      // lines: session_start, 3 old rows, begin, 3 tx rows, commit
      const begin = 1 + OLD.length + 1;
      const cuts = {
        'at the begin boundary': begin,
        'after the first transaction row': begin + 1,
        'in the middle of the rows': begin + 2,
        'right before commit': begin + NEW.length,
      };
      for (const [label, lineCount] of Object.entries(cuts)) {
        const file = prefixFile(written, lineCount);
        const got = await viaResolver(file);
        expect([label, got]).toStrictEqual([label, OLD]);
        expect(await readAll(file)).toStrictEqual(agreed(OLD));
      }
    } finally {
      fs.rmSync(written.root, { recursive: true, force: true });
    }
  });

  it('a torn partial line inside the transaction still replays to the prior rows', async () => {
    const written = await journalWithTransaction(true);
    try {
      const begin = 1 + OLD.length + 1;
      const file = prefixFile(written, begin + 1, '{"v":2,"seq":99,"ty');
      expect(await readAll(file)).toStrictEqual(agreed(OLD));
    } finally {
      fs.rmSync(written.root, { recursive: true, force: true });
    }
  });

  it('appends after an incomplete transaction fold onto the prior rows', async () => {
    const written = await journalWithTransaction(true);
    try {
      const begin = 1 + OLD.length + 1;
      const file = prefixFile(
        written,
        begin + 2,
        plainLine(written.lines.length + 1, 'resumed'),
      );
      expect(await readAll(file)).toStrictEqual(agreed([...OLD, 'resumed']));
    } finally {
      fs.rmSync(written.root, { recursive: true, force: true });
    }
  });

  it('an explicit abort restores the prior rows and later appends survive', async () => {
    const written = await writeJournal([
      ...OLD.map(
        (text): HistoryJournalOp => ({ kind: 'content', content: row(text) }),
      ),
      ...transactionOps('tx-1', NEW, false),
      { kind: 'replaceAbort', txId: 'tx-1', rowCount: NEW.length },
      { kind: 'content', content: row('after') },
    ]);
    try {
      expect(await readAll(written.file)).toStrictEqual(
        agreed([...OLD, 'after']),
      );
    } finally {
      fs.rmSync(written.root, { recursive: true, force: true });
    }
  });

  it('an uncommitted transaction in the store overlay folds to the prior rows', async () => {
    const written = await journalWithTransaction(false);
    try {
      const recorder = new SessionRecordingService({
        sessionId: 'replace-tx-live',
        projectHash: 'replace-tx',
        chatsDir: written.root,
        workspaceDirs: [written.root],
        provider: 'test',
        model: 'test',
      });
      const store = new HistoryJournalStore(recorder);
      for (const text of OLD)
        store.apply({ kind: 'content', content: row(text) });
      for (const op of transactionOps('tx-live', NEW, false)) store.apply(op);
      expect(store.materialize().map(textOf)).toStrictEqual(OLD);
      expect(overlayRows(store)).toStrictEqual(OLD);
      store.apply({
        kind: 'replaceCommit',
        txId: 'tx-live',
        rowCount: NEW.length,
      });
      expect(store.materialize().map(textOf)).toStrictEqual(NEW);
      expect(overlayRows(store)).toStrictEqual(NEW);
      await store.waitForDurable();
      expect(store.materialize().map(textOf)).toStrictEqual(NEW);
      expect(overlayRows(store)).toStrictEqual(NEW);
      store.dispose();
      await recorder.dispose();
    } finally {
      fs.rmSync(written.root, { recursive: true, force: true });
    }
  });

  describe('malformed transactions fail fast', () => {
    const malformed: ReadonlyArray<readonly [string, HistoryJournalOp[]]> = [
      [
        'commit without begin',
        [
          { kind: 'content', content: row('a') },
          { kind: 'replaceCommit', txId: 'tx-x', rowCount: 0 },
        ],
      ],
      [
        'nested begin',
        [
          { kind: 'replaceBegin', txId: 'tx-a' },
          { kind: 'replaceBegin', txId: 'tx-b' },
        ],
      ],
      [
        'wrong transaction id on commit',
        [
          { kind: 'replaceBegin', txId: 'tx-a' },
          { kind: 'content', content: row('x'), tx: 'tx-a' },
          { kind: 'replaceCommit', txId: 'tx-b', rowCount: 1 },
        ],
      ],
      [
        'row count that does not match the written rows',
        [
          { kind: 'replaceBegin', txId: 'tx-a' },
          { kind: 'content', content: row('x'), tx: 'tx-a' },
          { kind: 'replaceCommit', txId: 'tx-a', rowCount: 2 },
        ],
      ],
      [
        'tagged row outside any transaction',
        [{ kind: 'content', content: row('x'), tx: 'tx-a' }],
      ],
    ];
    it.each(malformed)('%s', async (_label, ops) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'replace-tx-bad-'));
      const recorder = new SessionRecordingService({
        sessionId: 'replace-tx-bad',
        projectHash: 'replace-tx',
        chatsDir: root,
        workspaceDirs: [root],
        provider: 'test',
        model: 'test',
      });
      try {
        const file = await appendRaw(recorder, ops);
        const outcomes = await foldOutcomes(file);
        for (const outcome of Object.values(outcomes))
          expect(outcome).toContain('Malformed replace transaction');
        expect(Object.keys(outcomes)).toStrictEqual(READERS.map(([n]) => n));
      } finally {
        await recorder.dispose();
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });
});
