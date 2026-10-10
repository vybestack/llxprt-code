/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { prepareProviderContentSnapshot } from '@vybestack/llxprt-code-core/services/history/provider-curated-stream.js';
import { BoundarySnapshotDisk } from './boundary-snapshot-disk.js';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import { createSafeJsonReplacer } from './turnJsonUtils.js';
import { stageTurnRequestArtifact } from './turn-request-artifact.js';

const root = sourceRootSetup();

async function capture(shared: boolean, withinRow: boolean) {
  const disk = new BoundarySnapshotDisk(root());
  const hash = createHash('sha256');
  const replacer = createSafeJsonReplacer();
  const block = { type: 'text' as const, text: 'same text 雪 😀' };
  hash.update('[');
  try {
    await disk.capture('after', {
      count: 64,
      async *openReader(): AsyncGenerator<IContent, void, unknown> {
        for (let index = 0; index < 64; index++) {
          const selected = shared ? block : { ...block };
          const row: IContent = {
            speaker: index % 2 === 0 ? 'human' : 'ai',
            blocks: withinRow
              ? [selected, shared ? selected : { ...block }]
              : [selected],
          };
          if (index > 0) hash.update(',');
          hash.update(JSON.stringify(row, replacer));
          yield row;
        }
      },
    });
    hash.update(']');
    const staged = await stageTurnRequestArtifact(root(), {
      [Symbol.asyncIterator]: () => disk.selection('after').openReader(),
    });
    return {
      legacySha256: hash.digest('hex'),
      diskSha256: staged.content_sha256,
      contentChars: staged.content_chars,
      rowCount: staged.row_count,
    };
  } finally {
    disk.close();
  }
}

async function comparison(withinRow: boolean) {
  const shared = await capture(true, withinRow);
  const independent = await capture(false, withinRow);
  return { shared, independent };
}
async function normalized(withBoundary: boolean) {
  const boundaryId = Object.freeze({});
  const snapshot = await prepareProviderContentSnapshot(
    {
      async *[Symbol.asyncIterator](): AsyncGenerator<IContent, void, unknown> {
        for (let index = 0; index < 64; index++)
          yield {
            speaker: index % 2 === 0 ? 'human' : 'ai',
            blocks: [{ type: 'text', text: `${index}: same text 雪 😀` }],
            ...(withBoundary
              ? {
                  metadata: {
                    semanticMediaPurgeBoundary: { blockIndex: 0, boundaryId },
                  },
                }
              : {}),
          };
      },
    },
    [],
    new DebugLogger('source-logging-identity'),
    { root: root() },
  );
  const hash = createHash('sha256');
  const replacer = createSafeJsonReplacer();
  try {
    hash.update('[');
    let index = 0;
    for await (const row of snapshot.openReader()) {
      if (index++ > 0) hash.update(',');
      hash.update(JSON.stringify(row, replacer));
    }
    hash.update(']');
    const staged = await stageTurnRequestArtifact(root(), {
      [Symbol.asyncIterator]: () => snapshot.openReader(),
    });
    return { requestWideSha256: hash.digest('hex'), ...staged };
  } finally {
    snapshot.close();
  }
}

describe('disk source TEXT identity information', () => {
  it.each([false, true])(
    'exposes identical persisted values for different identity graphs, within-row=%s',
    async (withinRow) => {
      const { shared, independent } = await comparison(withinRow);
      expect(shared.rowCount).toBe(64);
      expect(shared.diskSha256).toBe(independent.diskSha256);
      expect(shared.legacySha256).not.toBe(independent.legacySha256);
      expect(independent.diskSha256).toBe(independent.legacySha256);
    },
  );
  it('matches request-wide identity on ordinary normalized independent TEXT', async () => {
    const facts = await normalized(false);
    expect(facts.row_count).toBe(64);
    expect(facts.content_sha256).toBe(facts.requestWideSha256);
  });
  it('preserves the reconstructed boundary identity on normalized TEXT', async () => {
    const facts = await normalized(true);
    expect(facts.row_count).toBe(64);
    expect(facts.content_sha256).toBe(facts.requestWideSha256);
  });
});
