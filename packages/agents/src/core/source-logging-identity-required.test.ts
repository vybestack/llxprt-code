/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { openNativeProviderFixture } from '@vybestack/llxprt-code-core/services/history/__tests__/support/native-provider-fixture.js';
import { openNativeRowFixture } from '@vybestack/llxprt-code-core/services/history/__tests__/support/native-row-fixture.js';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import { createSafeJsonReplacer } from './turnJsonUtils.js';
import { stageRequestArtifactFixture } from './__tests__/support/request-artifact-fixture.js';

const root = sourceRootSetup();

async function capture(shared: boolean, withinRow: boolean) {
  const hash = createHash('sha256');
  const replacer = createSafeJsonReplacer();
  const block = { type: 'text' as const, text: 'same text 雪 😀' };
  hash.update('[');
  try {
    const rows = await openNativeRowFixture(
      root(),
      {
        async *[Symbol.asyncIterator](): AsyncGenerator<
          IContent,
          void,
          unknown
        > {
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
      },
      64,
    );
    try {
      hash.update(']');
      const staged = await stageRequestArtifactFixture(root(), {
        [Symbol.asyncIterator]: () => rows.openReader(),
      });
      return {
        legacySha256: hash.digest('hex'),
        diskSha256: staged.content_sha256,
        contentChars: staged.content_chars,
        rowCount: staged.row_count,
      };
    } finally {
      await rows.close();
    }
  } finally {
    hash.destroy();
  }
}

async function comparison(withinRow: boolean) {
  const shared = await capture(true, withinRow);
  const independent = await capture(false, withinRow);
  return { shared, independent };
}
async function normalized() {
  const snapshot = await openNativeProviderFixture(
    root(),
    {
      async *[Symbol.asyncIterator](): AsyncGenerator<IContent, void, unknown> {
        for (let index = 0; index < 64; index++)
          yield {
            speaker: index % 2 === 0 ? 'human' : 'ai',
            blocks: [{ type: 'text', text: `${index}: same text 雪 😀` }],
          };
      },
    },
    64,
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
    const staged = await stageRequestArtifactFixture(root(), {
      [Symbol.asyncIterator]: () => snapshot.openReader(),
    });
    return { requestWideSha256: hash.digest('hex'), ...staged };
  } finally {
    await snapshot.close();
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
    const facts = await normalized();
    expect(facts.row_count).toBe(64);
    expect(facts.content_sha256).toBe(facts.requestWideSha256);
  });
});
