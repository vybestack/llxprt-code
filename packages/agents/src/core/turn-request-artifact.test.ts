/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import { getRequestTextFromContents } from './turnLogging.js';
import { stageTurnRequestArtifact } from './turn-request-artifact.js';
import { sourceHeap } from './__tests__/support/streamprocessor-source-measurements.js';

const root = sourceRootSetup();
const failureMessage = {
  abort: 'cancel turn artifact',
  'reader-error': 'reader failed',
  'encoding-error': 'encode failed',
};
function row(index: number, large = false): IContent {
  return {
    speaker: index % 2 === 0 ? 'human' : 'ai',
    blocks: [
      {
        type: 'text',
        text:
          `${index}:雪🌊\n"\\` +
          (large ? 'x'.repeat(10 * 1024 * 1024 + 1) : 'abc'.repeat(2048)),
      },
    ],
    metadata: { turnId: `t-${index}`, id: `id-${index}` },
  };
}
function expected(large: boolean): {
  bytes: number;
  chars: number;
  sha256: string;
} {
  const hash = createHash('sha256');
  let bytes = 0;
  let chars = 0;
  const append = (text: string): void => {
    hash.update(text);
    bytes += Buffer.byteLength(text);
    chars += text.length;
  };
  append('[');
  for (let index = 0; index < 64; index++) {
    if (index > 0) append(',');
    const text = row(index, large && index === 63).blocks[0];
    if (text.type !== 'text') throw new Error('Expected text fixture');
    append(
      JSON.stringify({
        blocks: [{ text: text.text, type: 'text' }],
        metadata: { id: `id-${index}`, turnId: `t-${index}` },
        speaker: index % 2 === 0 ? 'human' : 'ai',
      }),
    );
  }
  append(']');
  return { bytes, chars, sha256: hash.digest('hex') };
}

describe('bounded neutral turn request artifact fallback', () => {
  it.each([false, true])(
    'writes exact legacy sorted JSON for 64 independent rows, oversized=%s',
    async (large) => {
      const state = { active: 0, closed: 0, pulled: 0 };
      const contents = (async function* (): AsyncGenerator<IContent> {
        state.active++;
        try {
          for (let index = 0; index < 64; index++) {
            state.pulled++;
            yield row(index, large && index === 63);
          }
        } finally {
          state.active--;
          state.closed++;
        }
      })();
      const artifact = await stageTurnRequestArtifact(root(), contents);
      const oracle = expected(large);
      expect(artifact).toMatchObject({
        schema_version: 2,
        content_offset: 0,
        row_count: 64,
        content_bytes: oracle.bytes,
        content_chars: oracle.chars,
        content_sha256: oracle.sha256,
      });
      const bytes = await readFile(artifact.artifact_path);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(
        oracle.sha256,
      );
      expect(bytes.length).toBe(oracle.bytes);
      expect((await stat(artifact.artifact_path)).mode & 0o777).toBe(0o600);
      expect(state).toStrictEqual({ active: 0, closed: 1, pulled: 64 });
      expect(
        (await readdir(root())).filter((name) =>
          name.startsWith('.turn-request-'),
        ),
      ).toHaveLength(0);
      expect(oracle.bytes).toBeGreaterThan(large ? 10 * 1024 * 1024 : 0);
    },
    60000,
  );
});

describe('turn artifact safe row encoding', () => {
  it('preserves within-row cycles, bigint and key ordering', async () => {
    const metadata: Record<string, unknown> = { z: 3n, a: '雪' };
    metadata.self = metadata;
    const content: IContent = { speaker: 'human', blocks: [], metadata };
    const artifact = await stageTurnRequestArtifact(
      root(),
      (async function* () {
        yield content;
      })(),
    );
    expect(await readFile(artifact.artifact_path, 'utf8')).toBe(
      getRequestTextFromContents([content]),
    );
  });
});

describe('turn artifact failure cleanup', () => {
  it('rejects a row whose custom JSON representation is undefined and closes its reader', async () => {
    let closed = 0;
    const content = { ...row(0), toJSON: (): undefined => undefined };
    await expect(
      stageTurnRequestArtifact(
        root(),
        (async function* (): AsyncGenerator<IContent> {
          try {
            yield content;
          } finally {
            closed++;
          }
        })(),
      ),
    ).rejects.toThrow('Turn request row did not serialize to JSON');
    expect(closed).toBe(1);
    expect(await readdir(root())).toHaveLength(0);
  });
  it.each(['abort', 'reader-error', 'encoding-error'] as const)(
    'closes the input reader and removes partial output after %s',
    async (mode) => {
      const controller = new AbortController();
      let closed = 0;
      let pulled = 0;
      const contents = (async function* (): AsyncGenerator<IContent> {
        try {
          yield row(pulled++);
          if (mode === 'abort')
            controller.abort(new Error('cancel turn artifact'));
          if (mode === 'reader-error') throw new Error('reader failed');
          const metadata = {
            id: 'encoding-error',
            toJSON() {
              throw new Error('encode failed');
            },
          };
          const bad: IContent = { ...row(pulled++), metadata };
          yield mode === 'encoding-error' ? bad : row(2);
        } finally {
          closed++;
        }
      })();
      await expect(
        stageTurnRequestArtifact(root(), contents, controller.signal),
      ).rejects.toThrow(failureMessage[mode]);
      expect(closed).toBe(1);
      expect(pulled).toBeLessThanOrEqual(2);
      expect(await readdir(root())).toHaveLength(0);
    },
  );
  it('does not open a row reader or create a file for a pre-aborted request', async () => {
    const controller = new AbortController();
    controller.abort(new Error('already aborted'));
    let reads = 0;
    await expect(
      stageTurnRequestArtifact(
        root(),
        (async function* () {
          reads++;
          yield row(0);
        })(),
        controller.signal,
      ),
    ).rejects.toThrow('already aborted');
    expect(reads).toBe(0);
    expect(await readdir(root())).toHaveLength(0);
  });
});

async function measureRowRelease(trap: boolean) {
  const warm = await stageTurnRequestArtifact(
    root(),
    (async function* () {
      yield row(0);
    })(),
  );
  expect(warm.row_count).toBe(1);
  const baseline = await sourceHeap();
  const references: Array<WeakRef<IContent>> = [];
  const retained: IContent[] = [];
  const artifact = await stageTurnRequestArtifact(
    root(),
    (async function* () {
      for (let index = 0; index < 64; index++) {
        const content = row(index, index === 63);
        references.push(new WeakRef(content));
        if (trap) retained.push(content);
        yield content;
      }
    })(),
  );
  const settled = await sourceHeap();
  return {
    baseline,
    settled,
    delta: settled - baseline,
    liveRows: references.filter((ref) => ref.deref() !== undefined).length,
    retainedRows: retained.length,
    artifact,
  };
}

describe('turn artifact row release with retaining-sink adverse control', () => {
  it('releases input rows and completed writer ownership below strict 1 MiB', async () => {
    const facts = await measureRowRelease(false);
    expect(facts.liveRows).toBe(0);
    expect(facts.delta).toBeLessThan(1_048_576);
    expect(facts.artifact.row_count).toBe(64);
  }, 60000);
  it('trap: deliberately retained input rows fail the release gate', async () => {
    const facts = await measureRowRelease(true);
    expect(facts.retainedRows).toBe(64);
    expect(() => expect(facts.liveRows).toBe(0)).toThrow('Expected: 0');
  }, 60000);
});
