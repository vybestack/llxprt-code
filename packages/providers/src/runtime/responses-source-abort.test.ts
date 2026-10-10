/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { requestScopedContents } from '../utils/requestScopedBody.js';
import { serializeResponsesPromptEnvelope } from './responses-source-serializer.js';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';

const context = {
  includeReasoningInContext: false,
  mediaPdfEnabled: true,
  outputLimiterConfig: { getEphemeralSettings: () => ({}) },
  debug: (): void => {},
};
const row: IContent = {
  speaker: 'human',
  blocks: [{ type: 'text', text: 'never append this pending row' }],
};

function gate(): { wait: Promise<void>; release(): void } {
  let release = (): void => {};
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release };
}

function turn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function checkpoint<T>(promise: Promise<T>): Promise<T | 'pending'> {
  return Promise.race([promise, turn().then<'pending'>(() => 'pending')]);
}

function workspace(before: ReadonlySet<string>): string[] {
  return readdirSync(getScratchRoot())
    .filter((name) => !before.has(name))
    .map((name) => join(getScratchRoot(), name));
}

async function blockedSerialization(failure?: Error): Promise<number> {
  const before = new Set(readdirSync(getScratchRoot()));
  const started = gate();
  const blocked = gate();
  const controller = new AbortController();
  const reason = new Error('cancel request while source pull is pending');
  let closed = false;
  let rowReads = 0;
  let uploads = 0;
  const bodies: unknown[] = [];
  const pendingRow: IContent = {
    speaker: 'human',
    get blocks() {
      rowReads++;
      return row.blocks;
    },
  };
  async function* contents(): AsyncIterable<IContent> {
    try {
      started.release();
      await blocked.wait;
      if (failure !== undefined) throw failure;
      yield pendingRow;
    } finally {
      closed = true;
    }
  }
  const pending = serializeResponsesPromptEnvelope({
    model: 'gpt-5.6',
    contents: contents(),
    context,
    signal: controller.signal,
  });
  const observed = pending.then(
    (prompt) => {
      bodies.push(prompt);
      uploads++;
      return 'resolved';
    },
    (error: unknown) => error,
  );
  await started.wait;
  const owned = workspace(before);
  try {
    expect(owned).toHaveLength(2);
    controller.abort(reason);
    expect(await checkpoint(observed)).toBe(reason);
    expect(await checkpoint(pending.cleanup)).toBe('pending');
    expect(closed).toBe(false);
    expect(uploads).toBe(0);
    expect(bodies).toStrictEqual([]);
    const snapshot = owned.find((path) => path.includes('request-snapshot'));
    if (snapshot === undefined) throw new Error('Missing snapshot');
    expect(statSync(join(snapshot, 'rows')).size).toBe(0);
  } finally {
    blocked.release();
    await observed;
  }
  const cleanup = await pending.cleanup;
  expect(cleanup).toStrictEqual(
    failure === undefined
      ? { status: 'fulfilled' }
      : { status: 'rejected', reason: failure },
  );
  expect(closed).toBe(true);
  expect(owned.every((path) => !existsSync(path))).toBe(true);
  expect(workspace(before)).toStrictEqual([]);
  return rowReads;
}

describe('Responses pending-source abort ownership', () => {
  it('rejects the request before source settlement and cleans after manual unblock', async () => {
    expect(await blockedSerialization()).toBe(0);
  });
  it('retains a late external source rejection in the explicit cleanup outcome', async () => {
    expect(
      await blockedSerialization(new Error('external next failed after abort')),
    ).toBe(0);
  });
});

describe('Responses aborted history fencing', () => {
  it('fences new readers and materialization before the pending source settles', async () => {
    const started = gate();
    const blocked = gate();
    const controller = new AbortController();
    const reason = new Error('stop replay and source pulls');
    let pulls = 0;
    const owner = requestScopedContents(
      {
        async *[Symbol.asyncIterator]() {
          pulls++;
          started.release();
          await blocked.wait;
          yield row;
        },
      },
      controller.signal,
    );
    const reader = owner.stream()[Symbol.asyncIterator]();
    const observed = reader.next().then(
      () => 'resolved',
      (error: unknown) => error,
    );
    await started.wait;
    controller.abort(reason);
    const reopened = owner
      .stream()
      [Symbol.asyncIterator]()
      .next()
      .then(
        () => 'resolved',
        (error: unknown) => error,
      );
    const materialized = owner.materialize().then(
      () => 'resolved',
      (error: unknown) => error,
    );
    try {
      expect(await checkpoint(reopened)).toBe(reason);
      expect(await checkpoint(materialized)).toBe(reason);
      expect(pulls).toBe(1);
    } finally {
      blocked.release();
      await Promise.all([observed, reopened, materialized]);
      await reader.return?.();
      await owner.dispose();
    }
  });
});

describe('Responses external source cleanup failure', () => {
  it('preserves source and iterator-return failures rather than replacing either', async () => {
    const started = gate();
    const blocked = gate();
    const controller = new AbortController();
    const abort = new Error('abort');
    const sourceFailure = new Error('external pull rejected');
    const closeFailure = new Error('external return rejected');
    const contents: AsyncIterable<IContent> = {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            started.release();
            await blocked.wait;
            throw sourceFailure;
          },
          async return() {
            throw closeFailure;
          },
        };
      },
    };
    const pending = serializeResponsesPromptEnvelope({
      model: 'gpt-5.6',
      contents,
      context,
      signal: controller.signal,
    });
    const observed = pending.then(
      () => 'resolved',
      (error: unknown) => error,
    );
    await started.wait;
    controller.abort(abort);
    try {
      expect(await checkpoint(observed)).toBe(abort);
    } finally {
      blocked.release();
    }
    const cleanup = await pending.cleanup;
    expect(cleanup.status).toBe('rejected');
    if (
      cleanup.status !== 'rejected' ||
      !(cleanup.reason instanceof AggregateError)
    )
      throw new Error('Missing aggregate cleanup failure');
    expect(cleanup.reason.errors).toStrictEqual([sourceFailure, closeFailure]);
  });
});

describe('Responses delayed iterator-return cleanup', () => {
  it('returns the source only after its pending pull settles and waits for return settlement', async () => {
    const before = new Set(readdirSync(getScratchRoot()));
    const nextStarted = gate();
    const unblockNext = gate();
    const returnStarted = gate();
    const unblockReturn = gate();
    const controller = new AbortController();
    const reason = new Error('abort pending pull with pending cleanup');
    let returning = false;
    const contents: AsyncIterable<IContent> = {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            nextStarted.release();
            await unblockNext.wait;
            return { done: false, value: row };
          },
          async return() {
            returning = true;
            returnStarted.release();
            await unblockReturn.wait;
            return { done: true, value: undefined };
          },
        };
      },
    };
    const pending = serializeResponsesPromptEnvelope({
      model: 'gpt-5.6',
      contents,
      context,
      signal: controller.signal,
    });
    const observed = pending.then(
      () => 'resolved',
      (error: unknown) => error,
    );
    await nextStarted.wait;
    controller.abort(reason);
    try {
      expect(await checkpoint(observed)).toBe(reason);
      expect(returning).toBe(false);
      const whileNextPending = await checkpoint(pending.cleanup);
      unblockNext.release();
      await returnStarted.wait;
      const whileReturnPending = await checkpoint(pending.cleanup);
      expect([whileNextPending, whileReturnPending]).toStrictEqual([
        'pending',
        'pending',
      ]);
      expect(workspace(before)).toHaveLength(2);
    } finally {
      unblockNext.release();
      unblockReturn.release();
    }
    expect(await pending.cleanup).toStrictEqual({ status: 'fulfilled' });
    expect(workspace(before)).toStrictEqual([]);
  });
});

describe('Responses stateful cancellation ownership', () => {
  it('cleans the sealed base and blocked incremental workspace after manual unblock', async () => {
    const before = new Set(readdirSync(getScratchRoot()));
    const started = gate();
    const blocked = gate();
    const controller = new AbortController();
    const reason = new Error('cancel incremental serialization');
    async function* base(): AsyncIterable<IContent> {
      yield row;
    }
    async function* incremental(): AsyncIterable<IContent> {
      started.release();
      await blocked.wait;
      yield row;
    }
    const pending = serializeResponsesPromptEnvelope({
      model: 'gpt-5.6',
      contents: base(),
      context,
      signal: controller.signal,
      stateful: {
        statefulParentUsed: true,
        retainedBaselineTokens: 100,
        incrementalContents: incremental(),
      },
    });
    const observed = pending.then(
      () => 'resolved',
      (error: unknown) => error,
    );
    await started.wait;
    controller.abort(reason);
    try {
      expect(await checkpoint(observed)).toBe(reason);
      expect(workspace(before)).toHaveLength(3);
      expect(await checkpoint(pending.cleanup)).toBe('pending');
    } finally {
      blocked.release();
    }
    expect(await pending.cleanup).toStrictEqual({ status: 'fulfilled' });
    expect(workspace(before)).toStrictEqual([]);
  });
});
