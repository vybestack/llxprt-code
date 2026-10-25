/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { parseOutputLimits } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import { readdirSync } from 'node:fs';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { readOwnedSource } from './__tests__/owned-source-read.js';
import {
  nativePrompt,
  nativeRows,
  nativePromptKeys,
} from './__tests__/native-responses-fixture.js';
import { requestScopedContents } from '../utils/requestScopedBody.js';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';

const context = {
  includeReasoningInContext: false,
  mediaPdfEnabled: true,
  outputLimits: parseOutputLimits({}),
  debug: (): void => {},
};
const row: IContent = {
  speaker: 'human',
  blocks: [{ type: 'text', text: 'first' }],
};

function gate(): { wait: Promise<void>; release(): void } {
  let release = (): void => {};
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release };
}

describe('Responses source deterministic lifecycle', () => {
  it('returns the exact abort reason and closes a partially consumed source', async () => {
    const before = new Set(readdirSync(getScratchRoot()));
    const controller = new AbortController();
    const reason = new Error('abort while serializing');
    let closed = false;
    async function* contents(): AsyncIterable<IContent> {
      try {
        yield row;
        controller.abort(reason);
        yield row;
      } finally {
        closed = true;
      }
    }
    await expect(readOwnedSource(contents(), controller.signal)).rejects.toBe(
      reason,
    );
    expect(closed).toBe(true);
    const leaked = readdirSync(getScratchRoot()).filter(
      (name) => !before.has(name),
    );
    expect(leaked).toStrictEqual([]);
  });
  it('keeps a second disk reader independent when the first reader throws', async () => {
    async function* contents(): AsyncIterable<IContent> {
      yield row;
      yield { ...row, blocks: [{ type: 'text', text: 'second' }] };
    }
    const owner = requestScopedContents(contents());
    try {
      const a = owner.stream()[Symbol.asyncIterator]();
      const b = owner.stream()[Symbol.asyncIterator]();
      expect((await a.next()).value).toStrictEqual(row);
      const reason = new Error('consumer failure');
      await expect(a.throw?.(reason)).rejects.toBe(reason);
      expect((await b.next()).value).toStrictEqual(row);
      expect((await b.next()).done).toBe(false);
      await b.return?.();
    } finally {
      await owner.dispose();
    }
  });
  it('propagates the exact abort reason between chunks of one native text row', async () => {
    const controller = new AbortController();
    const reason = new Error('abort inside native text');
    const prompt = await nativePrompt(
      nativeRows([
        { ...row, blocks: [{ type: 'text', text: 'x'.repeat(70_000) }] },
      ]),
      { model: 'gpt-5.6', context, signal: controller.signal },
    );
    const reader = prompt.body(prompt.envelope())[Symbol.asyncIterator]();
    try {
      let next = await reader.next();
      while (
        next.done !== true &&
        !new TextDecoder().decode(next.value).endsWith('x')
      )
        next = await reader.next();
      expect(next.done).toBe(false);
      expect(next.value?.byteLength).toBeLessThan(70_000);
      controller.abort(reason);
      await expect(reader.next()).rejects.toBe(reason);
    } finally {
      await reader.return();
      await prompt.dispose();
    }
  });
  it('provides a native text-only estimator without a captured prompt string', async () => {
    let pulls = 0;
    const rows = {
      ...nativeRows([row]),
      readAt: () => {
        pulls++;
        return row;
      },
    };
    const prompt = await nativePrompt(rows, { model: 'gpt-5.6', context });
    try {
      const estimator = prompt.toEstimatorProjection();
      expect((await nativePromptKeys(prompt))[0]).toBe(
        '[{"role":"user","content":"first"}]',
      );
      expect(
        Object.getOwnPropertyDescriptor(estimator, 'promptSegments'),
      ).toBeUndefined();
      expect(pulls).toBe(2);
    } finally {
      await prompt.dispose();
    }
  });
});

describe('Responses source pending-next cancellation demand', () => {
  it('settles abort before an uncooperative source next completes', async () => {
    const started = gate();
    const blocked = gate();
    const controller = new AbortController();
    const reason = new Error('pending abort');
    async function* contents(): AsyncIterable<IContent> {
      started.release();
      await blocked.wait;
      yield row;
    }
    const pending = readOwnedSource(contents(), controller.signal);
    await started.wait;
    controller.abort(reason);
    const result = await Promise.race([
      pending.then(
        () => 'resolved',
        (error) => (error === reason ? 'aborted' : 'wrong error'),
      ),
      new Promise<void>((resolve) => setImmediate(resolve)).then(
        () => 'pending',
      ),
    ]);
    blocked.release();
    const settled = await pending.then(
      () => 'resolved',
      (error: unknown) => error,
    );
    expect(settled).toBe(reason);
    expect(await pending.cleanup).toStrictEqual({ status: 'fulfilled' });
    expect(result).toBe('aborted');
  });
});
