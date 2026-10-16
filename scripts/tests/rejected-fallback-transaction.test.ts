/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { ContextOverflowError } from '../../packages/agents/src/compression/contextOverflowError.js';
import {
  durableRowsOf,
  rowsOf,
} from '../../packages/core/src/services/history/chronology-rollback-test-helpers.js';
import { buildProviderContent } from '../../packages/core/src/services/history/historyProviderPipeline.js';
import { buildCuratedHistory } from '../../packages/core/src/services/history/historyCuration.js';
import { appendBodyEvidence } from '../../packages/test-utils/src/body-evidence-writer.js';
import {
  transactionFixture,
  rawState,
  runRejection,
  bodyFor,
  logger,
  pending,
  rejection,
  baselineFailure,
} from './rejected-fallback-transaction-helpers.js';

function errors(value: unknown): unknown[] {
  return value instanceof AggregateError
    ? value.errors.flatMap(errors)
    : [value];
}

async function verifyRestoration(
  route: 'provider' | 'pending',
  kind: 'false' | 'throw',
): Promise<void> {
  await transactionFixture(async (fixture) => {
    const before = await rawState(fixture);
    const expected = await bodyFor(
      buildProviderContent(
        buildCuratedHistory(logger, before.rows, false),
        pending,
        logger,
      ),
      fixture.store,
    );
    const outcome = await runRejection(fixture, route, kind);
    const after = await rawState(fixture);
    const actual = await bodyFor(
      buildProviderContent(
        buildCuratedHistory(logger, after.rows, false),
        pending,
        logger,
      ),
      fixture.store,
    );
    const output = process.env.TRANSFORM_BODY_OUTPUT;
    if (output !== undefined)
      await appendBodyEvidence(output, { route, kind }, actual, expected);
    expect(after).toStrictEqual(before);
    expect(await durableRowsOf(fixture.recorder)).toStrictEqual(before.rows);
    expect(actual).toBe(expected);
    if (route === 'provider')
      expect(outcome).toBeInstanceOf(ContextOverflowError);
    else if (kind === 'throw') expect(outcome).toBe(rejection);
    else expect(outcome).toBeInstanceOf(Error);
    expect(fixture.owners.snapshot().liveRows).toBe(0);
    expect(
      fixture.owners.within({
        rows: 440,
        serializedBytes: 8 * 1024 * 1024,
      }),
    ).toBe(true);
    fixture.history.add({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'next turn' }],
    });
    await fixture.history.waitForCommit();
    const rows = await rowsOf(fixture.history);
    expect(rows.at(-1)?.metadata?.chronology?.seq).toBe(
      (before.ordinals.at(-1)?.seq ?? 0) + 1,
    );
  });
}

async function verifyAbort(
  route: 'provider' | 'pending',
  kind: 'restore-admission' | 'restore-baseline',
): Promise<void> {
  await transactionFixture(async (fixture) => {
    const before = await rawState(fixture);
    const outcome = await runRejection(fixture, route, kind);
    expect(outcome).toBeInstanceOf(AggregateError);
    expect(errors(outcome)).toContain(rejection);
    expect(errors(outcome)).toContain(
      kind === 'restore-admission' ? fixture.recorder.failure : baselineFailure,
    );
    expect(fixture.state.projectionsAfterInstall).toBe(0);
    const after = await rawState(fixture);
    const expectedState =
      kind === 'restore-baseline'
        ? { ...before, baseline: 0 }
        : fixture.installedState();
    expect(after).toStrictEqual(expectedState);
    expect(await durableRowsOf(fixture.recorder)).toStrictEqual(after.rows);
    const actual = await bodyFor(
      buildProviderContent(
        buildCuratedHistory(logger, after.rows, false),
        pending,
        logger,
      ),
      fixture.store,
    );
    const expected = await bodyFor(
      buildProviderContent(
        buildCuratedHistory(logger, expectedState.rows, false),
        pending,
        logger,
      ),
      fixture.store,
    );
    const output = process.env.TRANSFORM_BODY_OUTPUT;
    if (output !== undefined)
      await appendBodyEvidence(
        output,
        { route, kind, aborted: true },
        actual,
        expected,
      );
    expect(actual).toBe(expected);
    expect(fixture.owners.snapshot().liveRows).toBe(0);
    expect(
      fixture.owners.within({
        rows: 440,
        serializedBytes: 8 * 1024 * 1024,
      }),
    ).toBe(true);
  });
}

describe('rejected fallback transaction with an existing empty AI row', () => {
  const restorationCases: Array<['provider' | 'pending', 'false' | 'throw']> = [
    ['provider', 'false'],
    ['provider', 'throw'],
    ['pending', 'false'],
    ['pending', 'throw'],
  ];
  const abortCases: Array<
    ['provider' | 'pending', 'restore-admission' | 'restore-baseline']
  > = [
    ['provider', 'restore-admission'],
    ['provider', 'restore-baseline'],
    ['pending', 'restore-admission'],
    ['pending', 'restore-baseline'],
  ];
  it.each(restorationCases)(
    'restores exact raw state and BODY after %s %s',
    verifyRestoration,
  );
  it.each(abortCases)(
    'aborts %s on %s without projecting shortened history',
    verifyAbort,
  );
  it('releases its restoration capability when the checkpoint scope closes', async () => {
    await transactionFixture(async (fixture) => {
      let held: (() => Promise<void>) | undefined;
      await fixture.history.detachedValues.withRollbackCheckpoint(
        async (restore) => {
          held = restore;
        },
      );
      if (held === undefined) throw new Error('Missing checkpoint restore');
      await expect(held()).rejects.toThrow('checkpoint is closed');
      expect(fixture.owners.snapshot().liveRows).toBe(0);
    });
  });
  it('continues to reject empty rows at public admission without modifying history', async () => {
    await transactionFixture(async (fixture) => {
      const before = await rawState(fixture);
      await expect(
        fixture.history.detachedValues.replace([{ speaker: 'ai', blocks: [] }]),
      ).rejects.toThrow('content has no blocks');
      const after = await rawState(fixture);
      expect(after).toStrictEqual(before);
    });
  });
});
