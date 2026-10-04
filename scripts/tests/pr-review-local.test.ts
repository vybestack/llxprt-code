/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runPipeline, parseMapResponse } from '../pr-review-walkthrough.ts';
import { readArtifacts } from '../pr-review-artifacts.ts';
import {
  createLocalReviewRunner,
  splitReviewDiff,
  parseSynthesis,
  parsePreMergeChecks,
  validateRelated,
  checkDescription,
} from '../pr-review-local.ts';

const servers: Array<ReturnType<typeof Bun.serve>> = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});
function serve(
  handler: (request: Request) => Promise<Response> | Response,
): string {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: handler });
  servers.push(server);
  return `http://127.0.0.1:${server.port}`;
}
function envelope(
  response: string,
  overrides: Record<string, unknown> = {},
): Response {
  return Response.json({
    message: { content: response },
    done: true,
    done_reason: 'stop',
    prompt_eval_count: 100,
    eval_count: 30,
    ...overrides,
  });
}

describe('local static prereview inference', () => {
  it('sends only bounded static data with no tools or credentials', async () => {
    const endpoint = serve(async (request) => {
      const body = await request.json();
      expect(body).toMatchObject({
        model: 'qwen3.5:4b',
        stream: false,
        think: false,
        format: 'json',
        options: { num_ctx: 32768, num_predict: 1024, temperature: 0 },
      });
      expect(body).not.toHaveProperty('tools');
      expect(request.headers.get('authorization')).toBeNull();
      return envelope(
        JSON.stringify({ inputBytes: JSON.stringify(body).length }),
      );
    });
    const result = JSON.parse(
      await createLocalReviewRunner({ endpoint })('Describe the change'),
    );
    expect(result.inputBytes).toBeGreaterThan('Describe the change'.length);
  });
  it('rejects hosted destinations and credential-bearing loopback URLs before inference', () => {
    for (const endpoint of [
      'https://api.z.ai',
      'http://localhost:12644',
      'http://127.0.0.1.example.com',
      'http://user:secret@127.0.0.1:12644',
      'http://127.0.0.1:12644/path',
    ]) {
      expect(() => createLocalReviewRunner({ endpoint })).toThrow('loopback');
    }
  });
  it('does not follow redirects to another server', async () => {
    const endpoint = serve(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://api.z.ai' },
        }),
    );
    await expect(
      createLocalReviewRunner({ endpoint })('input'),
    ).rejects.toThrow('HTTP 302');
  });
  it('rejects empty, truncated and context-overrun responses', async () => {
    for (const overrides of [
      { message: { content: '' } },
      { done: false },
      { done_reason: 'length' },
      { prompt_eval_count: 24577 },
      { eval_count: 8192 },
      { error: 'bad' },
    ]) {
      const endpoint = serve(() => envelope('{}', overrides));
      await expect(
        createLocalReviewRunner({ endpoint })('input'),
      ).rejects.toThrow();
    }
  });
  it('rejects over-budget input without sending any request', async () => {
    const endpoint = serve(() => {
      throw new Error('must not reach transport');
    });
    await expect(
      createLocalReviewRunner({ endpoint })('😀'.repeat(5001)),
    ).rejects.toThrow('input budget');
  });
  it('keeps HTTP failures bounded and excludes server data from errors', async () => {
    const endpoint = serve(
      () => new Response('SECRET UNTRUSTED DATA', { status: 500 }),
    );
    await expect(
      createLocalReviewRunner({ endpoint })('input'),
    ).rejects.toThrow('Local inference HTTP 500');
  });
  it('serializes concurrent callers through one server', async () => {
    let active = 0;
    let maximum = 0;
    const endpoint = serve(async () => {
      active++;
      maximum = Math.max(active, maximum);
      await Bun.sleep(15);
      active--;
      return envelope('{}');
    });
    const run = createLocalReviewRunner({ endpoint });
    await Promise.all([run('one'), run('two'), run('three')]);
    expect(maximum).toBe(1);
  });
  it('enforces per-call and shared deadlines', async () => {
    const endpoint = serve(async () => {
      await Bun.sleep(100);
      return envelope('{}');
    });
    await expect(
      createLocalReviewRunner({ endpoint, timeoutMs: 10 })('one'),
    ).rejects.toThrow();
    const expired = createLocalReviewRunner({ endpoint, budgetMs: 1 });
    await Bun.sleep(5);
    await expect(expired('two')).rejects.toThrow('deadline');
  });
});

it('supports explicit thinking and a response schema without changing default inference', async () => {
  const endpoint = serve(async (request) => {
    const body = z
      .object({
        think: z.boolean(),
        format: z.object({ required: z.array(z.string()) }),
      })
      .parse(await request.json());
    expect(new URL(request.url).pathname).toBe('/api/chat');
    const content = JSON.stringify({
      thinking: body.think,
      fieldCount: body.format.required.length,
    });
    return envelope(content, {
      response: undefined,
      message: { role: 'assistant', content },
    });
  });
  const responseFormat = {
    type: 'object',
    properties: { value: { type: 'string' } },
    required: ['value'],
  };
  const result = JSON.parse(
    await createLocalReviewRunner({ endpoint, think: true })(
      'input',
      responseFormat,
    ),
  );
  expect(result.thinking).toBe(true);
  expect(result.fieldCount).toBe(1);
});
it('keeps bounded response grammars within the local runtime repetition limit', async () => {
  const { reviewResponseFormat } = await import('../pr-review-local.ts');
  const format = z
    .object({
      properties: z.object({ evidence: z.object({ maxLength: z.number() }) }),
    })
    .parse(reviewResponseFormat('acceptance-evidence'));
  expect(format.properties.evidence.maxLength).toBeLessThanOrEqual(1024);
});
it('provides required-field grammars for every public review stage', async () => {
  const { reviewResponseFormat } = await import('../pr-review-local.ts');
  for (const phase of [
    'map',
    'group',
    'synthesis',
    'diagram',
    'related',
    'pre-merge',
    'acceptance-evidence',
  ]) {
    const format = z
      .object({
        type: z.literal('object'),
        required: z.array(z.string()).min(1),
      })
      .parse(reviewResponseFormat(phase));
    expect(format.required.length).toBeGreaterThan(0);
  }
});
describe('bounded walkthrough evidence and schemas', () => {
  it('splits complete hunks without losing their provenance', () => {
    const header =
      'diff --git a/src/__file.ts b/src/__file.ts\n--- a/src/__file.ts\n+++ b/src/__file.ts\n';
    const hunks = [
      '@@ -1 +1 @@\n-old\n+new\n',
      '@@ -9 +9 @@\n-before\n+after\n',
    ];
    const packets = splitReviewDiff(header + hunks.join(''), 130);
    expect(packets.map((p) => p.content)).toEqual(
      hunks.map((hunk) => header + hunk),
    );
    expect(packets.every((p) => p.available)).toBe(true);
  });
  it('checks template headings from the actual body without inventing omissions', () => {
    const body = [
      'TLDR',
      'Dive Deeper',
      'Reviewer Test Plan',
      'Testing Matrix',
      'Linked issues / bugs',
    ]
      .map((heading) => `## ${heading}\nContent`)
      .join('\n');
    expect(checkDescription(body).ok).toBe(true);
    expect(checkDescription('## TLDR\nBody').ok).toBe(false);
    expect(checkDescription('## TLDR\nBody').note).toContain(
      'Reviewer Test Plan',
    );
    expect(() => parseMapResponse('{"summary":" ","triage":"fix"}')).toThrow();
  });

  it('splits large added files with line provenance and accounts for oversized individual lines', () => {
    const hunks =
      'diff --git a/x b/x\n@@ -0,0 +1,1000 @@\n' +
      '+changed line\n'.repeat(1000);
    const packets = splitReviewDiff(hunks);
    expect(packets.length).toBeGreaterThan(1);
    expect(packets.every((packet) => packet.available)).toBe(true);
    expect(
      packets
        .map(
          (packet) => packet.content.match(/^\+changed line$/gm)?.length ?? 0,
        )
        .reduce((a, b) => a + b, 0),
    ).toBe(1000);
    expect(packets[1].content).toContain('original hunk');
    const large = splitReviewDiff(
      'diff --git a/x b/x\n@@ -1 +1 @@\n+' + 'x'.repeat(13000),
    );
    expect(large).toHaveLength(1);
    expect(large[0].available).toBe(false);
    expect(
      splitReviewDiff('Binary files a/x and b/x differ')[0].content,
    ).toContain('Binary');
  });
  it('rejects missing required synthesis and invalid alignment booleans or notes', () => {
    for (const raw of [
      '{}',
      '{"walkthrough":"","release_notes":"x"}',
      '{"walkthrough":"x","release_notes":""}',
    ])
      expect(() => parseSynthesis(raw)).toThrow();
    const valid = {
      title: { ok: true, note: 'Clear title' },
      description: { ok: false, note: 'Missing test plan' },
      linked_issues: {
        ok: false,
        note: 'Caller migration missing in src/app.ts',
      },
      out_of_scope: { note: 'No unrelated changes' },
    };
    expect(parsePreMergeChecks(JSON.stringify(valid)).linked_issues.ok).toBe(
      false,
    );
    expect(() =>
      parsePreMergeChecks(
        JSON.stringify({ ...valid, title: { ok: 'false', note: 'bad' } }),
      ),
    ).toThrow();
    expect(() =>
      parsePreMergeChecks(
        JSON.stringify({ ...valid, linked_issues: { ok: true, note: '' } }),
      ),
    ).toThrow();
  });
  it('rejects invented related references and preserves fetched items', () => {
    expect(() =>
      validateRelated('- #123: related because ...', [{ number: 3781 }]),
    ).toThrow();
    expect(
      validateRelated('- #3781: local prereview', [{ number: 3781 }]),
    ).toContain('#3781');
  });
});

describe('local walkthrough pipeline completion', () => {
  it('retains useful sections while visibly marking missing evidence and failed stages', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'review3781-'));
    try {
      await mkdir(path.join(dir, 'issues'));
      await mkdir(path.join(dir, 'diffs'));
      await writeFile(
        path.join(dir, 'pr.json'),
        JSON.stringify({
          number: 3781,
          title: 'Migrate local review',
          changedFiles: 1,
        }),
      );
      await writeFile(
        path.join(dir, 'issues/3781.json'),
        JSON.stringify({
          number: 3781,
          title: 'Local review',
          body: 'Must review every changed file',
        }),
      );
      await writeFile(path.join(dir, 'numstat.txt'), '1\t1\tsrc/app.ts\n');
      await writeFile(
        path.join(dir, 'diff-manifest.txt'),
        'app.diff\tsrc/app.ts\n',
      );
      await writeFile(
        path.join(dir, 'diffs/app.diff'),
        'diff --git a/src/app.ts b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n',
      );
      const endpoint = serve(
        () => new Response('SECRET server failure', { status: 400 }),
      );
      await runPipeline(dir, createLocalReviewRunner({ endpoint }));
      const comment = await readFile(path.join(dir, 'comment.md'), 'utf8');
      const result = JSON.parse(
        await readFile(path.join(dir, 'result.json'), 'utf8'),
      );
      expect(comment).toContain('Review incomplete');
      expect(comment).toContain('src/app.ts');
      expect(comment).toContain('per-file summary unavailable');
      expect(comment).toContain('## Magnitude');
      expect(comment).not.toContain('SECRET');
      expect(result.state).toBe('incomplete');
      expect(result.unavailable.length).toBeGreaterThan(0);
      await writeFile(path.join(dir, 'issues/broken.json'), '{malformed');
      await expect(readArtifacts(dir)).rejects.toThrow('artifact');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('bounded grouping and issue aggregation', () => {
  it('retains every file across batches and combines every linked acceptance assessment', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'review3781-batches-'));
    try {
      await mkdir(path.join(dir, 'issues'));
      await mkdir(path.join(dir, 'diffs'));
      const files = Array.from(
        { length: 14 },
        (_, index) => `src/file-${index}.ts`,
      );
      await writeFile(
        path.join(dir, 'pr.json'),
        JSON.stringify({
          number: 3781,
          title: 'Change fourteen files',
          changedFiles: files.length,
        }),
      );
      await writeFile(
        path.join(dir, 'numstat.txt'),
        files.map((file) => `1\t1\t${file}\n`).join(''),
      );
      await writeFile(
        path.join(dir, 'diff-manifest.txt'),
        files.map((file, index) => `${index}.diff\t${file}\n`).join(''),
      );
      for (const [index, file] of files.entries())
        await writeFile(
          path.join(dir, `diffs/${index}.diff`),
          `diff --git a/${file} b/${file}\n@@ -1 +1 @@\n-old\n+new\n`,
        );
      for (const number of [11, 12])
        await writeFile(
          path.join(dir, `issues/${number}.json`),
          JSON.stringify({
            number,
            title: `Issue ${number}`,
            body: 'Acceptance criteria',
          }),
        );
      let incompleteGroup = true;
      const endpoint = serve(async (request) => {
        const { prompt } = z
          .object({ messages: z.array(z.object({ content: z.string() })) })
          .transform((body) => ({ prompt: body.messages[0].content }))
          .parse(await request.json());
        const lines = prompt.split('\n');
        const inputLine = lines.find((line) =>
          line.startsWith('{"pullRequest":'),
        );
        const input = z
          .record(z.unknown())
          .parse(JSON.parse(inputLine ?? '{}'));
        if (prompt.includes('analyzing a single changed file'))
          return envelope(
            JSON.stringify({
              summary: 'Replaces old value with new value',
              observations: [],
              signature: '',
              triage: 'fix',
            }),
          );
        if (prompt.includes('grouping changed files')) {
          const batch = z
            .array(z.object({ filePath: z.string() }))
            .parse(input.summaries);
          const groupedBatch = incompleteGroup ? batch.slice(1) : batch;
          incompleteGroup = false;
          return envelope(
            JSON.stringify({
              themes: [
                {
                  layer: 'core',
                  files: groupedBatch.map((item) => item.filePath),
                  summary: 'Replace values in supplied files',
                },
              ],
            }),
          );
        }
        if (prompt.includes('writing a walkthrough'))
          return envelope(
            JSON.stringify({
              walkthrough: 'Values previously old now become new.',
              release_notes:
                '## Release Notes\n### Bug Fixes\n- Replaces old values.',
            }),
          );
        if (prompt.includes('drawing a runtime sequence diagram'))
          return envelope(
            JSON.stringify({ diagram: 'sequenceDiagram\nA->>B: new value' }),
          );
        if (prompt.includes('semantically related'))
          return envelope(JSON.stringify({ selections: [] }));
        const issues = z
          .array(z.object({ number: z.number() }))
          .parse(input.linkedIssues);
        const evidence = z
          .array(z.object({ filePath: z.string(), diff: z.string() }))
          .parse(input.actualCodeChanges);
        expect(evidence.map((item) => item.filePath).sort()).toEqual(
          [...files].sort(),
        );
        expect(evidence.every((item) => item.diff.includes('-old\n+new'))).toBe(
          true,
        );
        const issue = issues[0];
        return envelope(
          JSON.stringify({
            title: { ok: true, note: 'Clear scope' },
            description: { ok: true, note: 'Template checked' },
            linked_issues: {
              ok: issue.number === 11,
              note: `Issue ${issue.number} assessed`,
            },
            out_of_scope: { note: 'No unrelated changes' },
          }),
        );
      });
      await runPipeline(dir, createLocalReviewRunner({ endpoint }));
      const result = z
        .object({
          state: z.string(),
          themes: z.array(z.object({ files: z.array(z.string()) })),
          preMergeChecks: z.object({
            linked_issues: z.object({ ok: z.boolean(), note: z.string() }),
          }),
        })
        .parse(
          JSON.parse(await readFile(path.join(dir, 'result.json'), 'utf8')),
        );
      expect(result.state).toBe('complete');
      expect(await readFile(path.join(dir, 'comment.md'), 'utf8')).toContain(
        'Runner-local model',
      );
      expect(result.themes.map((theme) => theme.files.length)).toEqual([12, 2]);
      expect(result.themes.flatMap((theme) => theme.files).sort()).toEqual(
        [...files].sort(),
      );
      expect(result.preMergeChecks.linked_issues.ok).toBe(false);
      expect(result.preMergeChecks.linked_issues.note).toContain(
        'Issue 11 assessed',
      );
      expect(result.preMergeChecks.linked_issues.note).toContain(
        'Issue 12 assessed',
      );
      await writeFile(
        path.join(dir, 'pr.json'),
        JSON.stringify({
          number: 3781,
          title: 'Related-only change',
          closingIssuesReferences: [],
        }),
      );
      await runPipeline(dir, createLocalReviewRunner({ endpoint }));
      const referenced = z
        .object({
          state: z.string(),
          unavailable: z.array(z.string()),
          preMergeChecks: z.object({
            title: z.object({ ok: z.boolean() }),
            description: z.object({ ok: z.boolean() }),
            linked_issues: z.object({ ok: z.boolean(), note: z.string() }),
            out_of_scope: z.object({ note: z.string() }),
          }),
        })
        .parse(
          JSON.parse(await readFile(path.join(dir, 'result.json'), 'utf8')),
        );
      expect(referenced.state).toBe('complete');
      expect(referenced.unavailable).not.toContain('pre-merge');
      expect(referenced.preMergeChecks.linked_issues.note).toContain(
        'Referenced alignment',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('rendered stage budgets', () => {
  it('partitions using UTF-8 rendered prompts without dropping or duplicating evidence', async () => {
    const { batchReviewInputs } = await import('../pr-review-local.ts');
    const items = Array.from({ length: 45 }, (_, index) => ({
      filePath: `src/part-${index}.ts`,
      summary: '😀'.repeat(180),
    }));
    const render = (batch: typeof items): string =>
      'instructions'.repeat(70) + JSON.stringify(batch);
    const batches = batchReviewInputs(items, render);
    expect(batches.flat()).toEqual(items);
    expect(
      batches.every((batch) => Buffer.byteLength(render(batch)) <= 20000),
    ).toBe(true);
    expect(batches.length).toBeGreaterThan(1);
  });
  it('fails explicitly when even one evidence item cannot fit', async () => {
    const { batchReviewInputs } = await import('../pr-review-local.ts');
    expect(() =>
      batchReviewInputs(['x'.repeat(20001)], JSON.stringify),
    ).toThrow('input budget');
  });
  it('selects only closing targets for acceptance and retains related metadata separately', async () => {
    const { buildArtifactContext } = await import('../pr-review-artifacts.ts');
    const issues = [
      { number: 4, body: 'Acceptance criteria' },
      { number: 9, body: 'Separate scope' },
    ];
    const result = buildArtifactContext(
      {
        number: 1,
        title: 'cleanup',
        body: 'Closes #4. Related #9.',
        closingIssuesReferences: [{ number: 4 }],
      },
      issues,
      [],
      [],
    );
    expect(result).toMatchObject({ issues, acceptanceIssues: [issues[0]] });
  });
  it('keeps supplied linked issues when closing metadata is absent', async () => {
    const { buildArtifactContext } = await import('../pr-review-artifacts.ts');
    const issues = [{ number: 4, body: 'Acceptance criteria' }];
    expect(
      buildArtifactContext(
        { number: 1, title: 'cleanup', body: 'Fixes #4' },
        issues,
        [],
        [],
      ),
    ).toMatchObject({ acceptanceIssues: issues });
  });
  it('uses explicit experiment models while retaining the production default', async () => {
    const endpoint = serve(async (request) => {
      const body = z
        .object({
          model: z.string(),
          messages: z.array(z.object({ content: z.string() })),
        })
        .transform((body) => ({
          model: body.model,
          prompt: body.messages[0].content,
        }))
        .parse(await request.json());
      return envelope(
        JSON.stringify({
          experiment: body.model !== 'qwen3.5:4b',
          inputLength: body.prompt.length,
        }),
      );
    });
    const experiment = JSON.parse(
      await createLocalReviewRunner({ endpoint, model: 'gemma4:e2b-it-qat' })(
        'hello',
      ),
    );
    const production = JSON.parse(
      await createLocalReviewRunner({ endpoint })('hello'),
    );
    expect(experiment.experiment).toBe(true);
    expect(production.experiment).toBe(false);
  });
});

describe('large local review stage coverage', () => {
  it('bounds every rendered stage and retains code evidence independently of grouping', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'review3781-stage-'));
    try {
      await mkdir(path.join(dir, 'diffs'));
      await mkdir(path.join(dir, 'issues'));
      const files = Array.from(
        { length: 45 },
        (_, index) => `packages/core/src/component-${index}.ts`,
      );
      await writeFile(
        path.join(dir, 'pr.json'),
        JSON.stringify({
          number: 5,
          title: 'Replace values',
          body: 'Closes #6; related to #7',
          changedFiles: files.length,
          closingIssuesReferences: [{ number: 6 }],
        }),
      );
      await writeFile(
        path.join(dir, 'issues/6.json'),
        JSON.stringify({
          number: 6,
          title: 'Replace old values',
          body: 'Acceptance: old values are replaced.',
        }),
      );
      await writeFile(
        path.join(dir, 'issues/7.json'),
        JSON.stringify({
          number: 7,
          title: 'Other work',
          body: 'x'.repeat(22000),
        }),
      );
      await writeFile(
        path.join(dir, 'numstat.txt'),
        files.map((file) => `1000\t0\t${file}\n`).join(''),
      );
      await writeFile(
        path.join(dir, 'diff-manifest.txt'),
        files.map((file, index) => `${index}.diff\t${file}\n`).join(''),
      );
      for (const [index, file] of files.entries())
        await writeFile(
          path.join(dir, `diffs/${index}.diff`),
          `diff --git a/${file} b/${file}\n@@ -0,0 +1,1000 @@\n${'+const value = 2;\n'.repeat(1000)}`,
        );
      const evidencePaths: string[] = [];
      const groupPaths: string[] = [];
      const endpoint = serve(async (request) => {
        const { prompt } = z
          .object({ messages: z.array(z.object({ content: z.string() })) })
          .transform((body) => ({ prompt: body.messages[0].content }))
          .parse(await request.json());
        expect(Buffer.byteLength(prompt)).toBeLessThanOrEqual(20000);
        const inputLine = prompt
          .split('\n')
          .find((line) => line.startsWith('{"pullRequest":'));
        const input = z
          .record(z.unknown())
          .parse(JSON.parse(inputLine ?? '{}'));
        if (prompt.includes('analyzing a single changed file'))
          return envelope(
            JSON.stringify({
              summary:
                'Adds explicit values. ' + 'Observed declaration. '.repeat(40),
              observations: [],
              signature: '',
              triage: 'refactor',
            }),
          );
        if (prompt.includes('grouping changed files')) {
          const batch = z
            .array(z.object({ filePath: z.string() }))
            .parse(input.summaries);
          groupPaths.push(...batch.map((item) => item.filePath));
          return envelope(
            JSON.stringify({
              themes: batch.map((item) => ({
                layer: 'core',
                files: [item.filePath],
                summary:
                  'Replaces values. ' + 'Observed declaration. '.repeat(25),
              })),
            }),
          );
        }
        if (prompt.includes('collecting acceptance evidence')) {
          const notes = z
            .array(
              z.object({ paths: z.array(z.string()), evidence: z.string() }),
            )
            .safeParse(input.actualCodeChanges);
          if (notes.success)
            return envelope(
              JSON.stringify({
                evidence: `Observed declarations across ${[...new Set(notes.data.flatMap((item) => item.paths))].join(', ')}. Runtime verification not supplied.`,
              }),
            );
          const evidence = z
            .array(z.object({ filePath: z.string(), diff: z.string() }))
            .parse(input.actualCodeChanges);
          evidencePaths.push(...evidence.map((item) => item.filePath));
          expect(
            evidence.every((item) => item.diff.includes('+const value = 2;')),
          ).toBe(true);
          return envelope(
            JSON.stringify({
              evidence: `Added value declarations in ${evidence.map((item) => item.filePath).join(', ')}. Runtime verification not supplied. ${'Direct declarations only. '.repeat(50)}`,
            }),
          );
        }
        if (prompt.includes('writing a walkthrough'))
          return envelope(
            JSON.stringify({
              walkthrough: 'Previously absent declarations are now explicit.',
              release_notes:
                '## Release Notes\n### Refactor\n- Adds declarations.',
            }),
          );
        if (prompt.includes('drawing a runtime'))
          return envelope(JSON.stringify({ diagram: '' }));
        if (prompt.includes('semantically related'))
          return envelope(JSON.stringify({ selections: [] }));
        const issues = z
          .array(z.object({ number: z.number() }))
          .parse(input.linkedIssues);
        expect(issues.map((item) => item.number)).toEqual([6]);
        return envelope(
          JSON.stringify({
            title: { ok: true, note: 'Clear' },
            description: { ok: false, note: 'No sections' },
            linked_issues: { ok: true, note: 'Declarations visible' },
            out_of_scope: { note: 'None shown' },
          }),
        );
      });
      await runPipeline(
        dir,
        createLocalReviewRunner({ endpoint, model: 'qwen3.5:4b' }),
        { model: 'qwen3.5:4b' },
      );
      const result = z
        .object({
          state: z.string(),
          model: z.string(),
          themes: z.array(z.object({ files: z.array(z.string()) })),
        })
        .parse(
          JSON.parse(await readFile(path.join(dir, 'result.json'), 'utf8')),
        );
      expect(result.state).toBe('incomplete');
      expect(result.model).toBe('qwen3.5:4b');
      expect([...new Set(groupPaths)].sort()).toEqual([...files].sort());
      expect(groupPaths).toHaveLength(files.length);
      const incomplete = JSON.parse(
        await readFile(path.join(dir, 'result.json'), 'utf8'),
      );
      expect(incomplete.unavailable).toContain('pre-merge');
      expect(incomplete.summaries).toHaveLength(90);
      expect(incomplete.preMergeChecks).toBeNull();
      expect(result.themes.flatMap((theme) => theme.files).sort()).toEqual(
        [...files].sort(),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
