/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect, it } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { marked } from 'marked';
import {
  bindSourceEvidence,
  renderRelatedSelections,
} from '../pr-review-evidence.ts';
import { createLocalReviewRunner } from '../pr-review-local.ts';

it('allows a descriptive summary without generated proof ranges', async () => {
  const { parseMapResponse } = await import('../pr-review-walkthrough.ts');
  const result = parseMapResponse(
    '{"summary":"Changes an awaited duration.","signature":"","triage":"fix"}',
  );
  expect(result.summary).toContain('duration');
  expect(
    bindSourceEvidence('src/wait.ts', '+await wait(1000);', 1, []).execution,
  ).toBe('not-observed');
});

it('binds reported verification to committed documentation, never an observed execution', () => {
  const content = '@@ -0,0 +1 @@\n+Docker and Podman passed 18 checks.\n';
  const evidence = bindSourceEvidence('project-plans/report.md', content, 2, [
    {
      quote: '+Docker and Podman passed 18 checks.',
      claim: 'Reports engine checks passed.',
    },
  ]);
  expect(evidence.kind).toBe('documentation');
  expect(evidence.execution).toBe('not-observed');
  expect(evidence.packet).toBe(2);
  expect(evidence.diffSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(evidence.observations[0].quote).toContain('18');
  expect(evidence.path).toBe('project-plans/report.md');
});

it('keeps test assertions and implementation separate and rejects fabricated source quotes', () => {
  const code = '@@ -1 +1 @@\n+await wait(1000);\n';
  const observations = [
    { quote: '+await wait(1000);', claim: 'Awaits 1000 ms.' },
  ];
  expect(
    bindSourceEvidence('src/retry.test.ts', code, 1, observations).kind,
  ).toBe('test');
  expect(bindSourceEvidence('src/retry.ts', code, 1, observations).kind).toBe(
    'implementation',
  );
  expect(() =>
    bindSourceEvidence('src/retry.ts', code, 1, [
      { quote: '+await wait(2000);', claim: 'Waits two seconds.' },
    ]),
  ).toThrow('source quote');
});

it('retains exact barrel scope and non-executed before/head linkage context', () => {
  const content = '@@ -1 +0,0 @@\n-export { Provider } from "./Provider";\n';
  const context = [
    {
      revision: 'a'.repeat(40),
      path: 'src/Provider.ts',
      content: 'export class Provider {}',
    },
  ];
  const evidence = bindSourceEvidence(
    'src/index.ts',
    content,
    1,
    [
      {
        quote: '-export { Provider } from "./Provider";',
        claim: 'Deletes a barrel re-export.',
      },
    ],
    context,
  );
  expect(evidence.observations[0].quote).toContain('export { Provider }');
  expect(evidence.context).toEqual(context);
  expect(evidence.execution).toBe('not-observed');
});

it('renders only verified candidate destinations and escapes untrusted metadata/reasons', () => {
  const corpus = [
    {
      number: 2943,
      title: 'Ownership [link](https://evil.invalid)',
      url: 'https://github.com/vybestack/llxprt-code/issues/2943',
    },
    {
      number: 3000,
      title: 'Recovery',
      url: 'https://github.com/vybestack/llxprt-code/pull/3000',
    },
  ];
  const output = renderRelatedSelections(
    JSON.stringify({
      selections: [
        {
          number: 2943,
          reason: 'Shares ownership <script> and [bad](https://evil.invalid)',
        },
        { number: 3000, reason: 'Shares startup behavior' },
      ],
    }),
    corpus,
  );
  expect(output).toContain(
    '[#2943](https://github.com/vybestack/llxprt-code/issues/2943)',
  );
  expect(output).toContain(
    '[#3000](https://github.com/vybestack/llxprt-code/pull/3000)',
  );
  expect(output).not.toContain('<script>');
  expect(output).not.toContain('[bad](');
  const destinations: string[] = [];
  marked.walkTokens(marked.lexer(output), (token) => {
    if (token.type === 'link') destinations.push(token.href);
  });
  expect(destinations).toEqual(corpus.map((item) => item.url));
  expect(() =>
    renderRelatedSelections('{"selections":[{"number":2943,"reason":"ok"}]}', [
      {
        ...corpus[0],
        kind: 'issue',
        url: 'https://github.com/vybestack/llxprt-code/pull/2943',
      },
    ]),
  ).toThrow();
  for (const selections of [
    [{ number: 9999, reason: 'Invented' }],
    [
      { number: 2943, reason: 'A' },
      { number: 2943, reason: 'B' },
    ],
    [{ number: 2943, reason: 'x'.repeat(241) }],
  ])
    expect(() =>
      renderRelatedSelections(JSON.stringify({ selections }), corpus),
    ).toThrow();
  expect(() =>
    renderRelatedSelections('{"related":"- #2943"}', corpus),
  ).toThrow();
  expect(() =>
    renderRelatedSelections('{"selections":[{"number":2943,"reason":"ok"}]}', [
      { ...corpus[0], url: 'https://github.com/other/repo/issues/2943' },
    ]),
  ).toThrow();
});

it('uses native chat without thinking for factual stages and preserves reasoning for final assessment', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pr-review-stage-modes-'));
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const body = z
        .object({
          think: z.boolean(),
          messages: z.array(z.object({ content: z.string() })),
        })
        .parse(await request.json());
      expect(new URL(request.url).pathname).toBe('/api/chat');
      return Response.json({
        done: true,
        done_reason: 'stop',
        prompt_eval_count: 4,
        eval_count: 4,
        message: {
          content: JSON.stringify({
            mode: body.think,
            length: body.messages[0].content.length,
          }),
        },
      });
    },
  });
  try {
    const run = createLocalReviewRunner({
      endpoint: `http://127.0.0.1:${server.port}`,
      model: 'qwen3.5:4b',
      think: false,
      factualThink: true,
      evidenceDir: dir,
    });
    const factual = JSON.parse(
      await run('extract source', undefined, { phase: 'map' }),
    );
    const reasoning = JSON.parse(
      await run('assess evidence', undefined, { phase: 'pre-merge' }),
    );
    expect(factual.mode).toBe(false);
    expect(reasoning.mode).toBe(true);
    expect(reasoning.length).toBeGreaterThan(0);
    const defaultRun = createLocalReviewRunner({
      endpoint: `http://127.0.0.1:${server.port}`,
      model: 'qwen3.5:4b',
      think: true,
    });
    expect(
      JSON.parse(
        await defaultRun(
          'extract with the retained thinking default',
          undefined,
          { phase: 'map' },
        ),
      ).mode,
    ).toBe(true);
    const retained = JSON.parse(
      await readFile(path.join(dir, 'inference-1.json'), 'utf8'),
    );
    expect(retained.request.think).toBe(false);
    expect(retained.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(retained.phase).toBe('map');
  } finally {
    server.stop(true);
    await rm(dir, { recursive: true, force: true });
  }
});
