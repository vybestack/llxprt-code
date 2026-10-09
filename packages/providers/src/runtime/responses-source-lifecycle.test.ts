/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { serializeResponsesPromptEnvelope } from './responses-source-serializer.js';
import { requestScopedContents } from '../utils/requestScopedBody.js';

const context = {
  includeReasoningInContext: false,
  mediaPdfEnabled: true,
  outputLimiterConfig: { getEphemeralSettings: () => ({}) },
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
    const before = new Set(readdirSync(tmpdir()));
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
    await expect(
      serializeResponsesPromptEnvelope({
        model: 'gpt-5.6',
        contents: contents(),
        context,
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(closed).toBe(true);
    const leaked = readdirSync(tmpdir()).filter((name) => !before.has(name));
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
      expect(owner.isMaterialized).toBe(false);
    } finally {
      await owner.dispose();
    }
  });
  it('provides a sealed text-only adapter projection without reopening history', async () => {
    let pulls = 0;
    async function* contents(): AsyncIterable<IContent> {
      pulls++;
      yield row;
    }
    const prompt = await serializeResponsesPromptEnvelope({
      model: 'gpt-5.6',
      contents: contents(),
      context,
    });
    try {
      const estimator = prompt.toEstimatorProjection();
      expect(
        readFileSync(estimator.promptSegments[0].source.path, 'utf8'),
      ).toBe('[{"role":"user","content":"first"}]');
      expect(Object.isFrozen(estimator.promptSegments[0].source)).toBe(true);
      expect(pulls).toBe(1);
    } finally {
      await prompt.dispose();
    }
  });
});

if (process.env.ISSUE854_SERIALIZER_PENDING_ABORT === '1') {
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
      const pending = serializeResponsesPromptEnvelope({
        model: 'gpt-5.6',
        contents: contents(),
        context,
        signal: controller.signal,
      });
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
}
