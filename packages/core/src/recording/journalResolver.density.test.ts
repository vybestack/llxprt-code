/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IContent } from '../services/history/IContent.js';
import { DurableDensityIndex } from './durableDensityIndex.js';
import { JournalResolver } from './journalResolver.js';
import { MetadataJsonProjection } from './metadataJsonProjection.js';

const ROWS = 10_000;
/** Far below the 7,500 ids and replacements one density event carries. */
const COLLECTION_BOUND = 256;

let root: string;
function row(label: string, seq: number): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text: label }],
    metadata: { chronology: { seq, userTurn: 1, step: 1, recordedAt: 1 } },
  };
}

function line(seq: number, type: string, payload: object): string {
  return `${JSON.stringify({ v: 1, seq, ts: 'fixed', type, payload })}\n`;
}

/**
 * One journal whose single density event drops every odd chronology seq and
 * replaces every fourth one, so the event touches most of the context.
 */
function writeJournal(): string {
  const file = path.join(root, 'session-density.jsonl');
  let text = line(1, 'session_start', {
    sessionId: 'density',
    projectHash: 'p',
    startTime: 'fixed',
    provider: 'test',
    model: 'test',
  });
  const removedSeqs: number[] = [];
  const replacements: Array<{ replacedSeq: number; replacement: IContent }> =
    [];
  for (let index = 0; index < ROWS; index += 1) {
    text += line(index + 2, 'content', {
      content: row(`row-${index}`, index + 1),
    });
    if (index % 2 === 1) removedSeqs.push(index + 1);
    if (index % 4 === 0)
      replacements.push({
        replacedSeq: index + 1,
        replacement: row(`dense-${index}`, index + 1),
      });
  }
  text += line(ROWS + 2, 'density_mutation', { removedSeqs, replacements });
  fs.writeFileSync(file, text);
  return file;
}

function expectedSurvivors(): string[] {
  const texts: string[] = [];
  for (let index = 0; index < ROWS; index += 2)
    texts.push(index % 4 === 0 ? `dense-${index}` : `row-${index}`);
  return texts;
}

function textOf(content: IContent): string {
  const block = content.blocks[0];
  if (block.type !== 'text') throw new Error('Expected a text block');
  return block.text;
}

function retainedSlots(value: unknown, seen = new Set<object>()): number {
  if (typeof value !== 'object' || value === null || seen.has(value)) return 0;
  seen.add(value);
  const children = Array.isArray(value) ? value : Object.values(value);
  return children.reduce(
    (sum: number, child) => sum + 1 + retainedSlots(child, seen),
    0,
  );
}

interface Measurement {
  readonly survivors: string[];
  readonly rowCount: number;
  readonly collectionAdds: number;
  readonly parserPeakSlots: number;
  readonly indexedEntries: number;
}

/**
 * Resolves the journal while counting every Map/Set insertion made during
 * the pass and the peak size of the parser's open containers. `retain`
 * stands in for an implementation that keeps a metadata index of the event.
 */
async function measure(
  file: string,
  retain?: (seq: number) => void,
): Promise<Measurement> {
  let collectionAdds = 0;
  let parserPeakSlots = 0;
  let indexedEntries = 0;
  const mapSet = Map.prototype.set;
  const setAdd = Set.prototype.add;
  const push = MetadataJsonProjection.prototype.push;
  const add = DurableDensityIndex.prototype.add;
  Map.prototype.set = function (this: Map<unknown, unknown>, key, value) {
    collectionAdds += 1;
    return mapSet.call(this, key, value);
  };
  Set.prototype.add = function (this: Set<unknown>, value) {
    collectionAdds += 1;
    return setAdd.call(this, value);
  };
  const pushWatch = spyOn(
    MetadataJsonProjection.prototype,
    'push',
  ).mockImplementation(function (this: MetadataJsonProjection, text: string) {
    push.call(this, text);
    const frames: unknown = Reflect.get(this, 'stack');
    if (!Array.isArray(frames)) throw new Error('Missing parser frames');
    const seen = new Set<object>();
    const slots = frames.reduce(
      (sum: number, frame: unknown) =>
        sum + retainedSlots(Reflect.get(frame as object, 'value'), seen),
      0,
    );
    parserPeakSlots = Math.max(parserPeakSlots, slots);
  });
  const addWatch = spyOn(
    DurableDensityIndex.prototype,
    'add',
  ).mockImplementation(function (
    this: DurableDensityIndex,
    ...args: Parameters<typeof add>
  ) {
    indexedEntries += 1;
    retain?.(args[1].seq);
    add.apply(this, args);
  });
  const survivors: string[] = [];
  let rowCount = 0;
  const scratchRoot = path.join(root, 'scratch');
  fs.mkdirSync(scratchRoot);
  const resolver = await JournalResolver.open(file, { scratchRoot });
  try {
    rowCount = await resolver.countRows();
    for await (const entry of resolver.resolve())
      survivors.push(textOf(entry.content));
  } finally {
    await resolver.close();
    Map.prototype.set = mapSet;
    Set.prototype.add = setAdd;
    pushWatch.mockRestore();
    addWatch.mockRestore();
  }
  expect(fs.readdirSync(scratchRoot)).toStrictEqual([]);
  return {
    survivors,
    rowCount,
    collectionAdds,
    parserPeakSlots,
    indexedEntries,
  };
}

describe('journal resolver single large density event', () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'resolver-density-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('resolves the survivors through the disk-backed density index without context-sized collections', async () => {
    const measured = await measure(writeJournal());
    expect(measured.survivors).toStrictEqual(expectedSurvivors());
    expect(measured.rowCount).toBe(ROWS / 2);
    // Aliveness: the event really flowed through the disk-backed index.
    expect(measured.indexedEntries).toBe(ROWS / 2 + ROWS / 4);
    expect(measured.collectionAdds).toBeLessThan(COLLECTION_BOUND);
    expect(measured.parserPeakSlots).toBeLessThan(COLLECTION_BOUND);
  });

  it('trap: a deliberately retained metadata index of the event fails the same bound', async () => {
    const retained = new Map<number, number>();
    const measured = await measure(writeJournal(), (seq) => {
      retained.set(seq, seq);
    });
    expect(measured.survivors).toStrictEqual(expectedSurvivors());
    expect(retained.size).toBeGreaterThan(COLLECTION_BOUND);
    expect(measured.collectionAdds).toBeGreaterThanOrEqual(COLLECTION_BOUND);
  });
});
