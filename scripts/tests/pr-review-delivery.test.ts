/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect, it } from 'bun:test';
import {
  batchReviewInputs,
  LOCAL_REVIEW_INPUT_BYTES,
} from '../pr-review-local.ts';
import { renderRelatedSelections } from '../pr-review-evidence.ts';
import { marked } from 'marked';
import { readFileSync } from 'node:fs';
import {
  createLocalReviewRunner,
  reviewResponseFormat,
} from '../pr-review-local.ts';
import { buildMapPrompt } from '../pr-review-prompts.ts';

it('uses fast bounded stages and reserves thinking for acceptance without requiring line selections', async () => {
  const requests: Array<{ think: boolean; options: { num_predict: number } }> =
    [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      requests.push(await request.json());
      return Response.json({
        message: { content: '{"ok":true}' },
        done: true,
        done_reason: 'stop',
        prompt_eval_count: 50,
        eval_count: 12,
      });
    },
  });
  try {
    const run = createLocalReviewRunner({
      endpoint: `http://127.0.0.1:${server.port}`,
    });
    await run('summarize', reviewResponseFormat('map'), { phase: 'map' });
    await run('assess', reviewResponseFormat('pre-merge'), {
      phase: 'pre-merge',
    });
    expect(requests.map((request) => request.think)).toEqual([false, true]);
    expect(requests[0].options.num_predict).toBeLessThan(
      requests[1].options.num_predict,
    );
    expect(JSON.stringify(reviewResponseFormat('map'))).not.toContain(
      'startLine',
    );
  } finally {
    server.stop(true);
  }
});

it('supplies literal source context without a mandatory extraction protocol', () => {
  const prompt = buildMapPrompt(
    'config.json',
    '@@ -30 +30 @@\n- "a.test.ts"\n+ "b.test.ts"',
    { number: 1, title: 'Adjust configuration' },
    {
      packet: 1,
      packetCount: 1,
      source: { context: [{ path: 'config.json', content: '"exclude": [' }] },
    },
  );
  expect(prompt).toContain('exclude');
  expect(prompt).not.toContain('startLine');
  expect(prompt).not.toContain('endLine');
});

it('leaves later stages usable when the mapping allowance has expired', async () => {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () =>
      Response.json({
        message: { content: '{}' },
        done: true,
        done_reason: 'stop',
        prompt_eval_count: 1,
        eval_count: 1,
      }),
  });
  try {
    const run = createLocalReviewRunner({
      endpoint: `http://127.0.0.1:${server.port}`,
      budgetMs: 5000,
      mapBudgetMs: 1,
    });
    await Bun.sleep(5);
    await expect(run('map', undefined, { phase: 'map' })).rejects.toThrow(
      'mapping allowance',
    );
    expect(
      await run('remaining section', undefined, { phase: 'synthesis' }),
    ).toBe('{}');
  } finally {
    server.stop(true);
  }
});

it('renders ordinary Related punctuation without corrupting entities or adding links', () => {
  const output = renderRelatedSelections(
    '{"selections":[{"number":3781,"reason":"Review: @actor"}]}',
    [
      {
        number: 3781,
        title: 'feat(ci): local inference',
        url: 'https://github.com/vybestack/llxprt-code/issues/3781',
      },
    ],
  );
  const html = marked.parse(output);
  expect(html).not.toContain('&amp;#58;');
  expect(html).not.toContain('&amp;#64;');
  expect(html).toContain('feat(ci)&#58; local inference');
  expect(html).toContain('Review&#58; &#64;actor');
});
it('retains room for a corrective retry when packing dense evidence', () => {
  const batches = batchReviewInputs(
    ['x'.repeat(10000), 'y'.repeat(9900)],
    (batch) => batch.join(''),
  );
  expect(
    batches.every(
      (batch) =>
        Buffer.byteLength(batch.join('')) <= LOCAL_REVIEW_INPUT_BYTES - 400,
    ),
  ).toBe(true);
});
it('does not persist write credentials in the trusted Git checkout', () => {
  const source = readFileSync(
    new URL('../../.github/workflows/pr-review.yml', import.meta.url),
    'utf8',
  );
  expect(source).toContain('persist-credentials: false');
});
