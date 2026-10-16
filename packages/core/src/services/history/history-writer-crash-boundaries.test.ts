/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
/**
 * Every writer that replaces a non-empty history with rows must do it as one
 * replace transaction: a journal cut at the begin record, between rows, or
 * just before the commit record still reopens as the previous history, and
 * the complete journal reopens as the replacement.
 */
import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { JournalResolver } from '../../recording/journalResolver.js';
import { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import { appendHistoryJournal } from './attachHistoryJournal.js';
import { HistoryJournalStore } from './historyJournalStore.js';
import type { HistoryJournalOp } from './historyStorePort.js';
import { HistoryDensityRows } from './historyDensityRows.js';
import { replaceAllOps, restoreRowsOps } from './historyReplaceOps.js';
import { HistoryRowOrigins } from './historyRowOrigins.js';
import { planHistoryMutation, planMutation } from './planHistoryMutation.js';
import type { HistoryMutationInput } from './historyBatchContracts.js';
import type { IContent } from './IContent.js';

function row(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }], metadata: {} };
}

function textOf(content: IContent): string {
  const block = content.blocks[0];
  if (block.type !== 'text') throw new Error('expected a text block');
  return block.text;
}

const OLD = ['old-0', 'old-1', 'old-2'].map(row);
const NEW = ['new-0', 'new-1', 'new-2', 'new-3'].map(row);

interface Scenario {
  readonly name: string;
  /** Rows the journal holds before the writer runs. */
  readonly before: readonly IContent[];
  /** Writes the replacement of `before` into the recorder's journal. */
  write(recorder: SessionRecordingService): Promise<void>;
  /** Rows the complete journal reopens as. */
  readonly complete: readonly IContent[];
}

function newRecorder(root: string, id: string): SessionRecordingService {
  return new SessionRecordingService({
    sessionId: id,
    projectHash: id,
    chatsDir: root,
    workspaceDirs: [root],
    provider: 'test',
    model: 'test',
  });
}

async function seed(
  recorder: SessionRecordingService,
  rows: readonly IContent[],
): Promise<void> {
  for (const content of rows) await recorder.commit('content', { content });
}

async function applyOps(
  recorder: SessionRecordingService,
  ops: Iterable<HistoryJournalOp>,
): Promise<void> {
  const store = new HistoryJournalStore(recorder);
  try {
    for (const op of ops) store.apply(op);
    await store.waitForDurable();
  } finally {
    await store.dispose();
  }
}

const unusedInput = {} as HistoryMutationInput;

const SCENARIOS: readonly Scenario[] = [
  {
    name: 'planMutation replaceAll',
    before: OLD,
    complete: NEW,
    write: async (recorder) => {
      const next = new HistoryDensityRows();
      try {
        for (const content of NEW) next.append(content);
        await applyOps(
          recorder,
          planMutation(OLD, {
            ...unusedInput,
            nextHistory: next,
            options: { replaceAll: true },
          }),
        );
      } finally {
        next.close();
      }
    },
  },
  {
    name: 'planHistoryMutation general replacement',
    before: OLD,
    complete: NEW,
    write: (recorder) => applyOps(recorder, planHistoryMutation(OLD, NEW)),
  },
  {
    name: 'compensation / repair rollback / clear restore (restoreRowsOps)',
    before: NEW,
    complete: OLD,
    write: async (recorder) => {
      const origins = HistoryRowOrigins.capture({
        length: OLD.length,
        originAt: () => undefined,
      });
      try {
        await applyOps(recorder, restoreRowsOps(OLD, origins, 7));
      } finally {
        origins.close();
      }
    },
  },
  {
    name: 'clear restore (replaceAllOps)',
    before: NEW,
    complete: OLD,
    write: (recorder) => applyOps(recorder, replaceAllOps(OLD)),
  },
  {
    name: 'attachHistoryJournal replace=true',
    before: OLD,
    complete: NEW,
    write: async (recorder) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'attach-source-'));
      const source = newRecorder(root, 'attach-source');
      try {
        await seed(source, NEW);
        await source.flush();
        const filePath = source.getFilePath();
        if (filePath === null) throw new Error('missing source journal');
        await appendHistoryJournal(
          { filePath, byteOffset: fs.statSync(filePath).size },
          recorder,
          true,
          () => false,
        );
      } finally {
        await source.dispose();
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
];

async function reopen(file: string): Promise<string[]> {
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

interface Journal {
  readonly root: string;
  readonly lines: string[];
  /** Index of the first line of the replacement transaction. */
  readonly beginIndex: number;
}

async function writeScenario(scenario: Scenario): Promise<Journal> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'writer-crash-'));
  const recorder = newRecorder(root, 'writer-crash');
  await seed(recorder, scenario.before);
  await recorder.flush();
  const file = recorder.getFilePath();
  if (file === null) throw new Error('missing journal');
  const before = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  await scenario.write(recorder);
  await recorder.dispose();
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  return { root: path.dirname(file), lines, beginIndex: before.length };
}

function cutJournal(journal: Journal, lineCount: number, name: string): string {
  const target = path.join(journal.root, `${name}.jsonl`);
  fs.writeFileSync(target, journal.lines.slice(0, lineCount).join('\n') + '\n');
  return target;
}

describe('writers replace history as one transaction', () => {
  for (const scenario of SCENARIOS) {
    const previous = scenario.before;
    describe(`${scenario.name}`, () => {
      it('writes begin, tagged rows and commit', async () => {
        const journal = await writeScenario(scenario);
        try {
          const types = journal.lines
            .slice(journal.beginIndex)
            .map((line) => (JSON.parse(line) as { type: string }).type);
          expect(types[0]).toBe('replace_begin');
          expect(types[types.length - 1]).toBe('replace_commit');
          expect(types.slice(1, -1).every((type) => type === 'content')).toBe(
            true,
          );
        } finally {
          fs.rmSync(journal.root, { recursive: true, force: true });
        }
      });

      it('reopens as the previous rows when cut at begin, mid-rows or before commit', async () => {
        const journal = await writeScenario(scenario);
        try {
          const last = journal.lines.length;
          const cuts: ReadonlyArray<readonly [string, number]> = [
            ['at-begin', journal.beginIndex + 1],
            ['after-first-row', journal.beginIndex + 2],
            ['mid-rows', journal.beginIndex + 3],
            ['before-commit', last - 1],
          ];
          for (const [name, lineCount] of cuts) {
            const file = cutJournal(journal, lineCount, name);
            expect(await reopen(file)).toStrictEqual(previous.map(textOf));
          }
        } finally {
          fs.rmSync(journal.root, { recursive: true, force: true });
        }
      });

      it('reopens the complete journal as the replacement', async () => {
        const journal = await writeScenario(scenario);
        try {
          const file = cutJournal(journal, journal.lines.length, 'complete');
          expect(await reopen(file)).toStrictEqual(
            scenario.complete.map(textOf),
          );
        } finally {
          fs.rmSync(journal.root, { recursive: true, force: true });
        }
      });
    });
  }
});
