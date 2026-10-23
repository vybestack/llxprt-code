/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import { acceptsHistoryOrigin } from './historyOriginId.js';
import {
  FanoutHarness,
  rowText,
  textRow,
} from './__tests__/support/fanout-harness.js';

const CASES = 10;
const STEPS = 12;

/** Small deterministic generator so a failing case replays from its seed. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

type Operation = 'add' | 'cut' | 'insert' | 'replace' | 'compensate' | 'purge';

const OPERATIONS: readonly Operation[] = [
  'add',
  'add',
  'add',
  'cut',
  'insert',
  'replace',
  'compensate',
  'purge',
];

function seqOf(row: IContent): number {
  const seq = row.metadata?.chronology?.seq;
  if (typeof seq !== 'number') throw new Error('shared row has no chronology');
  return seq;
}

interface Participant {
  readonly name: string;
  readonly owner: object;
  readonly id: string;
  readonly mirror: Parameters<FanoutHarness['replayed']>[0];
}

describe('recorder mirrors stay replayable under random operations', () => {
  const harness = new FanoutHarness();
  beforeEach(() => harness.setup());
  afterEach(() => harness.teardown());

  async function runCase(seed: number): Promise<void> {
    const next = generator(seed);
    const pick = <T>(items: readonly T[]): T =>
      items[Math.floor(next() * items.length)];
    const { service, ownerA, ownerB, a, b } = await harness.twoOrigins();
    const people: Participant[] = [
      { name: 'A', owner: ownerA, id: 'A', mirror: a },
      { name: 'B', owner: ownerB, id: 'B', mirror: b },
    ];
    // Rows are identified by chronology sequence; null marks an unowned row.
    const owners = new Map<number, string | null>();
    let counter = 0;
    const label = (prefix: string): string => `${prefix}${counter++}`;

    const ownNewRows = async (
      owner: string | undefined,
      replaceAll: boolean,
    ): Promise<void> => {
      if (replaceAll) owners.clear();
      for (const row of await harness.shared(service))
        if (replaceAll || !owners.has(seqOf(row)))
          owners.set(seqOf(row), owner ?? null);
    };

    await ownNewRows(undefined, false);

    // A repair row answers a tool call, so it belongs to the owner of the row
    // it follows.
    const ownRepairRows = async (): Promise<void> => {
      const rows = await harness.shared(service);
      rows.forEach((row, position) => {
        if (owners.has(seqOf(row))) return;
        const call = position === 0 ? undefined : rows[position - 1];
        owners.set(
          seqOf(row),
          call === undefined ? null : (owners.get(seqOf(call)) ?? null),
        );
      });
    };

    const step = async (operation: Operation): Promise<void> => {
      const who = pick(people);
      const rows = await harness.shared(service);
      switch (operation) {
        case 'add':
          service.add(textRow(label(who.name)), undefined, who.owner);
          await ownNewRows(who.id, false);
          return;
        case 'cut': {
          if (rows.length === 0) return;
          const keep = Math.floor(next() * rows.length);
          await service.replaceAll(rows.slice(0, keep), undefined, {
            origin: who.owner,
          });
          return;
        }
        case 'insert':
          service.add(
            {
              speaker: 'ai',
              blocks: [
                {
                  type: 'tool_call',
                  id: label('call-'),
                  name: 'tool',
                  parameters: {},
                },
              ],
            },
            undefined,
            who.owner,
          );
          await ownNewRows(who.id, false);
          await service.validateAndFix();
          await service.waitForCommit();
          await ownRepairRows();
          return;
        case 'replace': {
          const count = 1 + Math.floor(next() * 3);
          await service.replaceAll(
            Array.from({ length: count }, () => textRow(label('R'))),
            undefined,
            { origin: who.owner },
          );
          await ownNewRows(who.id, true);
          return;
        }
        case 'compensate':
          await expect(compensated(service, who.owner, label)).rejects.toThrow(
            'reject',
          );
          return;
        case 'purge':
          if (rows.length === 0) return;
          await service.detachedValues.transform(
            async (source, sink) => {
              for await (const row of source.streamRows())
                await sink.appendValue({
                  ...row,
                  blocks: [{ type: 'text', text: `${rowText(row)}*` }],
                });
            },
            undefined,
            { origin: who.owner },
          );
          await ownNewRows(who.id, true);
          return;
        default:
          throw new Error(`unknown operation ${String(operation)}`);
      }
    };

    for (let index = 0; index < STEPS; index++) {
      const operation = pick(OPERATIONS);
      const before = (await harness.shared(service)).map(rowText);
      await step(operation);
      await service.waitForCommit();
      const shared = await harness.shared(service);
      if (operation === 'compensate')
        expect(shared.map(rowText)).toStrictEqual(before);
      for (const person of people) {
        const expected = shared
          .filter((row) =>
            acceptsHistoryOrigin(
              person.id,
              owners.get(seqOf(row)) ?? undefined,
            ),
          )
          .map(rowText);
        expect({
          seed,
          index,
          operation,
          mirror: person.name,
          rows: await harness.replayed(person.mirror),
        }).toStrictEqual({
          seed,
          index,
          operation,
          mirror: person.name,
          rows: expected,
        });
      }
    }
  }

  it('after every operation each mirror replays to its own rows of the shared history', async () => {
    const seeds = Array.from({ length: CASES }, (_, index) => index + 1);
    const result = await (async () => {
      for (const seed of seeds) await runCase(seed);
    })();
    expect(result).toBeUndefined();
  }, 120_000);
});

/** A publication that fails after its rows were admitted, so it is compensated. */
async function compensated(
  service: HistoryService,
  origin: object,
  label: (prefix: string) => string,
): Promise<void> {
  const afterPublication = (): void => {
    throw new Error('reject');
  };
  await service.replaceAll(
    [textRow(label('X')), textRow(label('X'))],
    undefined,
    { origin, afterPublication },
  );
}
