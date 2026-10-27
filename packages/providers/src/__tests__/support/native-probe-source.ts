/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { deserialize } from 'node:v8';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { JournalSendFixture } from './journal-send-fixture.js';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { JournalProviderRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/journal-provider-request.js';
import { encodedRows } from '@vybestack/llxprt-code-core/services/history/journalPublication.js';
import { armSendTrap, type SendTrap, type TrapHold } from './sendPeakTraps.js';
import type { SendPeakPlan } from './sendPeakMeasurement.js';

export interface ProbeJob {
  readonly directory: string;
  readonly count: number;
}

interface ProbeSampler {
  trackRow(row: IContent): void;
  sample(): Promise<void>;
}

interface NativeSelectionHandle {
  readonly selection: ProviderRequestSnapshot;
  arm(): Promise<void>;
  rows(): AsyncIterable<IContent>;
  hold(): TrapHold | undefined;
}

function* sourceRows(job: ProbeJob): Generator<IContent> {
  for (let index = 0; index < job.count; index++) {
    const row: IContent = deserialize(
      readFileSync(join(job.directory, `${index}.row`)),
    );
    yield row;
  }
}

async function probeJournal(job: ProbeJob): Promise<JournalSendFixture> {
  const directory = join(job.directory, 'journal');
  mkdirSync(directory, { recursive: true });
  const session = await JournalSession.create(join(directory, 'session.llxj'));
  try {
    await session.store.commit([
      { kind: 'replace', rows: encodedRows(sourceRows(job), 0) },
    ]);
    const snapshot = await session.store.snapshot();
    const selection = await JournalProviderRequestSnapshot.create(
      snapshot,
      [],
      {},
      undefined,
      () => snapshot.close(),
      (pin, registration) =>
        session.store.prepareSnapshotFormat(pin, registration),
      undefined,
      (pin) => session.store.prepareSnapshotKimi(pin),
    );
    return {
      selection,
      async close() {
        await selection.close();
        await session.close();
      },
    };
  } catch (error) {
    await session.close();
    throw error;
  }
}

export async function prepareNativeProbeSources(
  root: string,
  plan: SendPeakPlan,
): Promise<NativeProbeSources> {
  const fixtures = new Map<string, JournalSendFixture>();
  for (const [shape, counts] of Object.entries(plan.shapes)) {
    for (const size of ['small', 'large'] as const) {
      const directory = join(root, shape, size);
      fixtures.set(
        directory,
        await probeJournal({ directory, count: counts[size] }),
      );
    }
  }
  return new NativeProbeSources(fixtures);
}

export class NativeProbeSources {
  constructor(
    private readonly fixtures: ReadonlyMap<string, JournalSendFixture>,
  ) {}

  handle(
    job: ProbeJob,
    sampler: ProbeSampler | undefined,
    activeTrap: SendTrap | undefined,
  ): NativeSelectionHandle {
    const fixture = this.fixtures.get(job.directory);
    if (fixture === undefined)
      throw new Error(`Missing native source ${job.directory}`);
    const selection = fixture.selection;
    let held: TrapHold | undefined;
    let armed = false;
    async function* rows(
      sample: boolean,
      signal?: AbortSignal,
    ): AsyncGenerator<IContent, void> {
      let index = 0;
      for await (const row of selection.openReader(signal)) {
        sampler?.trackRow(row);
        if (sample && index % 2048 === 0) await sampler?.sample();
        index += 1;
        yield row;
      }
      if (sample) await sampler?.sample();
    }
    const arm = async (): Promise<void> => {
      if (activeTrap !== undefined && !armed) {
        armed = true;
        held = await armSendTrap(activeTrap, rows(false));
      }
    };
    return {
      arm,
      rows: () => rows(false),
      hold: () => held,
      selection: {
        get native() {
          return process.env.ISSUE854_DROP_NATIVE_CAPABILITY === '1'
            ? undefined
            : selection.native;
        },
        get count() {
          return selection.count;
        },
        get pending() {
          return selection.pending;
        },
        isPending: (index) => selection.isPending(index),
        readAt: async (index, signal) => {
          const row = await selection.readAt(index, signal);
          sampler?.trackRow(row);
          return row;
        },
        openReader: (signal) =>
          (async function* (): AsyncGenerator<IContent, void> {
            await arm();
            yield* rows(true, signal);
          })(),
        close: () => undefined,
      },
    };
  }

  async close(): Promise<void> {
    for (const fixture of this.fixtures.values()) await fixture.close();
  }
}
