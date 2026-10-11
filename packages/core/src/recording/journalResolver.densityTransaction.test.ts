/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
/**
 * A density event is a history record, so the replace-transaction fold rule
 * applies to it: an unfinished transaction is abandoned before the event
 * folds, a committed one has already replaced the history the event sees.
 * The resolver and the disk-backed durable fold must agree on both.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IContent } from '../services/history/IContent.js';
import { foldDurableRows } from './durableRowFold.js';
import { JournalResolver } from './journalResolver.js';

let root: string;

function row(label: string, seq: number): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text: label }],
    metadata: { chronology: { seq, userTurn: 1, step: 1, recordedAt: 1 } },
  };
}

class JournalText {
  private text = '';
  private seq = 0;

  add(type: string, payload: object): this {
    this.seq += 1;
    this.text += `${JSON.stringify({ v: 1, seq: this.seq, ts: 'fixed', type, payload })}\n`;
    return this;
  }

  content(label: string, chronology: number, tx?: string): this {
    return this.add('content', {
      content: row(label, chronology),
      ...(tx === undefined ? {} : { tx }),
    });
  }

  write(name: string): string {
    const file = path.join(root, name);
    fs.writeFileSync(file, this.text);
    return file;
  }
}

function densityEvent(removed: number, replaced: number): object {
  return {
    removedSeqs: [removed],
    replacements: [
      {
        replacedSeq: replaced,
        replacement: row(`dense-${replaced}`, replaced),
      },
    ],
  };
}

function startedJournal(): JournalText {
  return new JournalText().add('session_start', {
    sessionId: 'density-tx',
    projectHash: 'p',
    startTime: 'fixed',
    provider: 'test',
    model: 'test',
  });
}

function textOf(content: IContent): string {
  const block = content.blocks[0];
  if (block.type !== 'text') throw new Error('Expected a text block');
  return block.text;
}

async function viaResolver(file: string): Promise<string[]> {
  const scratchRoot = path.join(root, 'resolver-scratch');
  fs.mkdirSync(scratchRoot, { recursive: true });
  const resolver = await JournalResolver.open(file, { scratchRoot });
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
  const scratchRoot = path.join(root, 'fold-scratch');
  fs.mkdirSync(scratchRoot, { recursive: true });
  const fold = await foldDurableRows({
    filePath: file,
    maxBytes: fs.statSync(file).size,
    scratchRoot,
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

async function readBoth(
  file: string,
): Promise<Record<'resolver' | 'durableFold', string[]>> {
  return {
    resolver: await viaResolver(file),
    durableFold: await viaDurableFold(file),
  };
}

function agreed(
  expected: readonly string[],
): Record<'resolver' | 'durableFold', string[]> {
  return { resolver: [...expected], durableFold: [...expected] };
}

describe('density events inside replace transactions', () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'resolver-density-tx-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('abandons an open transaction, then applies the density event to the prior history', async () => {
    const file = startedJournal()
      .content('old-1', 1)
      .content('old-2', 2)
      .content('old-3', 3)
      .add('replace_begin', { txId: 'tx-a' })
      .content('new-2', 2, 'tx-a')
      .content('new-3', 3, 'tx-a')
      .add('density_mutation', densityEvent(2, 3))
      .write('open-then-density.jsonl');
    expect(await readBoth(file)).toStrictEqual(agreed(['old-1', 'dense-3']));
  });

  it('applies the density event to the rows of a committed transaction', async () => {
    const file = startedJournal()
      .content('old-1', 1)
      .content('old-2', 2)
      .add('replace_begin', { txId: 'tx-a' })
      .content('new-1', 1, 'tx-a')
      .content('new-2', 2, 'tx-a')
      .content('new-3', 3, 'tx-a')
      .add('replace_commit', { txId: 'tx-a', rowCount: 3 })
      .add('density_mutation', densityEvent(2, 3))
      .write('committed-then-density.jsonl');
    expect(await readBoth(file)).toStrictEqual(agreed(['new-1', 'dense-3']));
  });

  it('keeps the prior history for an aborted transaction followed by a density event', async () => {
    const file = startedJournal()
      .content('old-1', 1)
      .content('old-2', 2)
      .add('replace_begin', { txId: 'tx-a' })
      .content('new-1', 1, 'tx-a')
      .add('replace_abort', { txId: 'tx-a' })
      .add('density_mutation', densityEvent(2, 1))
      .write('aborted-then-density.jsonl');
    expect(await readBoth(file)).toStrictEqual(agreed(['dense-1']));
  });
});
