/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deserialize } from 'node:v8';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import {
  journalSendFixture,
  type JournalSendFixture,
} from './journal-send-fixture.js';
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
  readonly selection: ProviderRequestSelection;
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
        await journalSendFixture(
          sourceRows({ directory, count: counts[size] }),
        ),
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
    return {
      rows: () => rows(false),
      hold: () => held,
      selection: {
        count: selection.count,
        readAt: (index, signal) => {
          const row = selection.readAt(index, signal);
          sampler?.trackRow(row);
          return row;
        },
        openReader: (signal) =>
          (async function* (): AsyncGenerator<IContent, void> {
            if (activeTrap !== undefined && !armed) {
              armed = true;
              held = await armSendTrap(activeTrap, rows(false));
            }
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
