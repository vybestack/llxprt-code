/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { runPipeline } from '../pr-review-walkthrough.ts';
import { sanitizeSequenceDiagram } from '../pr-review-walkthrough-parse.ts';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

it('keeps the deterministic description check visible when model assessment is unavailable', async () => {
  const body = [
    'TLDR',
    'Dive Deeper',
    'Reviewer Test Plan',
    'Testing Matrix',
    'Linked issues / bugs',
  ]
    .map((heading) => `## ${heading}\nRefs #3781`)
    .join('\n');
  const dir = await workspace({ body });
  await runPipeline(dir, async () => {
    throw new Error('Local inference HTTP 401');
  });
  const outcome = await result(dir);
  const comment = await readFile(path.join(dir, 'comment.md'), 'utf8');
  expect(outcome.state).toBe('incomplete');
  expect(outcome.preMergeChecks).toBeNull();
  expect(comment).toContain('All expected template sections are present.');
  expect(comment).toContain('Title assessment unavailable');
  expect(comment).toContain('Issue assessment unavailable');
});
async function workspace({
  title = 'Change runtime',
  body = 'Refs #3781',
  packets = 1,
  closing = [],
  flow = false,
}: {
  title?: string;
  body?: string;
  packets?: number;
  closing?: Array<{ number: number }>;
  flow?: boolean;
} = {}): Promise<string> {
  const root = path.resolve(import.meta.dir, '../../tmp/verify3781-fixes');
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(path.join(root, 'regression-'));
  directories.push(dir);
  await mkdir(path.join(dir, 'issues'));
  await mkdir(path.join(dir, 'diffs'));
  await writeFile(
    path.join(dir, 'pr.json'),
    JSON.stringify({
      number: 5,
      title,
      body,
      closingIssuesReferences: closing,
    }),
  );
  await writeFile(
    path.join(dir, 'issues/3781.json'),
    JSON.stringify({
      number: 3781,
      title: 'Runtime changes',
      body: 'Acceptance criteria: use actual code.',
    }),
  );
  await writeFile(
    path.join(dir, 'numstat.txt'),
    '24\t0\tpackages/core/src/runtime.ts\n',
  );
  await writeFile(
    path.join(dir, 'diff-manifest.txt'),
    'runtime.diff\tpackages/core/src/runtime.ts\n',
  );
  await writeFile(
    path.join(dir, 'diffs/runtime.diff'),
    'diff --git a/runtime.ts b/runtime.ts\n' +
      Array.from(
        { length: packets },
        (_, index) =>
          `@@ -${index + 1} +${index + 1} @@\n+${'runtimeValue '.repeat(packets > 1 ? 750 : 1)}\n`,
      ).join(''),
  );
  if (flow) {
    await writeFile(
      path.join(dir, 'numstat.txt'),
      '24\t0\tpackages/core/src/runtime.ts\n1\t0\tpackages/core/src/caller.ts\n',
    );
    await writeFile(
      path.join(dir, 'diff-manifest.txt'),
      'runtime.diff\tpackages/core/src/runtime.ts\ncaller.diff\tpackages/core/src/caller.ts\n',
    );
    await writeFile(
      path.join(dir, 'diffs/caller.diff'),
      'diff --git a/caller.ts b/caller.ts\n@@ -1 +1 @@\n+runtime();\n',
    );
  }
  return dir;
}
function input(prompt: string): Record<string, unknown> {
  return z
    .record(z.unknown())
    .parse(
      JSON.parse(
        prompt.split('\n').find((line) => line.startsWith('{"pullRequest":')) ??
          '{}',
      ),
    );
}
function inference(
  prompt: string,
  {
    diagram = 'sequenceDiagram\nA->>B: invoke',
    mapSummary = 'Observed code. '.repeat(50),
    related = '',
  }: { diagram?: string; mapSummary?: string; related?: string } = {},
): string {
  const data = input(prompt);
  if (prompt.includes('analyzing a single'))
    return JSON.stringify({
      summary: mapSummary,
      observations: [],
      signature: '',
      triage: 'refactor',
    });
  if (prompt.includes('grouping changed')) {
    const files = z
      .array(z.object({ filePath: z.string() }))
      .parse(data.summaries);
    return JSON.stringify({
      themes: [
        {
          layer: 'core',
          files: [...new Set(files.map((file) => file.filePath))],
          summary: 'Runtime changes',
        },
      ],
    });
  }
  if (prompt.includes('writing a walkthrough'))
    return JSON.stringify({
      walkthrough: 'Before: old declarations. After: changed declarations.',
      release_notes:
        '## Release Notes\n### Refactor\n- Changes runtime declarations.',
    });
  if (prompt.includes('drawing a runtime')) return JSON.stringify({ diagram });
  if (prompt.includes('semantically related'))
    return JSON.stringify(
      related.includes('](') &&
        !related.includes(
          'https://github.com/vybestack/llxprt-code/issues/2943)',
        ) &&
        !related.includes('https://github.com/vybestack/llxprt-code/pull/3000)')
        ? { related }
        : {
            selections: [...related.matchAll(/#(\d+)/g)].map((match) => ({
              number: Number(match[1]),
              reason: 'runtime changes',
            })),
          },
    );
  if (prompt.includes('collecting acceptance evidence'))
    return JSON.stringify({
      evidence: 'packages/core/src/runtime.ts: runtime declarations change.',
    });
  return JSON.stringify({
    title: { ok: true, note: 'Title describes runtime changes' },
    description: { ok: false, note: 'Missing sections' },
    linked_issues: {
      ok: true,
      note: 'Runtime changes align with the referenced issue',
    },
    out_of_scope: { note: 'No unrelated changes observed' },
  });
}
async function result(
  dir: string,
): Promise<{ state: string; unavailable: string[]; preMergeChecks: unknown }> {
  return z
    .object({
      state: z.string(),
      unavailable: z.array(z.string()),
      preMergeChecks: z.unknown(),
    })
    .parse(JSON.parse(await readFile(path.join(dir, 'result.json'), 'utf8')));
}

describe('retrieved related publication', () => {
  for (const related of [
    '- [#2943](https://github.com/vybestack/llxprt-code/issues/9999): sandbox security',
    '- [#2943](https://github.com/other/repo/issues/2943): sandbox security',
    '- [#2943](https://external.invalid/issues/2943): sandbox security',
  ]) {
    it(`marks an unverified destination incomplete without publishing it: ${related}`, async () => {
      const dir = await workspace();
      await writeFile(
        path.join(dir, 'related.json'),
        JSON.stringify({
          state: 'complete',
          items: [
            {
              number: 2943,
              title: 'Sandbox security',
              body: 'Ownership behavior',
              state: 'open',
              kind: 'issue',
              url: 'https://github.com/vybestack/llxprt-code/issues/2943',
            },
          ],
        }),
      );
      await runPipeline(dir, async (prompt) => inference(prompt, { related }));
      const outcome = await result(dir);
      expect(outcome.state).toBe('incomplete');
      expect(outcome.unavailable).toContain('related');
      const comment = await readFile(path.join(dir, 'comment.md'), 'utf8');
      expect(comment).not.toContain(related);
      expect(comment).not.toContain('sandbox security');
      expect(comment).not.toContain('external.invalid');
      expect(comment).not.toContain('/issues/9999');
    });
  }
  it('renders verified unlinked issue and PR references from trusted discovery', async () => {
    const { discoverRelated } = await import('../pr-review-related.ts');
    const dir = await workspace();
    const items = await discoverRelated({
      repository: 'vybestack/llxprt-code',
      title: 'runtime',
      linkedIssues: [{ number: 3781 }],
      pullRequestNumber: 5,
      transport: async () =>
        Response.json({
          incomplete_results: false,
          items: [
            {
              number: 2943,
              title: 'Runtime sandbox security',
              body: 'Ownership behavior',
              state: 'open',
              html_url: 'https://github.com/vybestack/llxprt-code/issues/2943',
              repository_url:
                'https://api.github.com/repos/vybestack/llxprt-code',
            },
            {
              number: 3000,
              title: 'Runtime recovery',
              body: 'Startup behavior',
              state: 'closed',
              html_url: 'https://github.com/vybestack/llxprt-code/pull/3000',
              repository_url:
                'https://api.github.com/repos/vybestack/llxprt-code',
              pull_request: {},
            },
          ],
        }),
    });
    await writeFile(
      path.join(dir, 'related.json'),
      JSON.stringify({ state: 'complete', items }),
    );
    for (const related of [
      '- #2943: ownership security; #3000: startup recovery',
      '- [#2943](https://github.com/vybestack/llxprt-code/issues/2943): ownership security; [#3000](https://github.com/vybestack/llxprt-code/pull/3000): startup recovery',
    ]) {
      await runPipeline(dir, async (prompt) => inference(prompt, { related }));
      const outcome = await result(dir);
      expect(outcome.state).toBe('complete');
      expect(outcome.unavailable).toEqual([]);
      const comment = await readFile(path.join(dir, 'comment.md'), 'utf8');
      expect(comment).toContain(
        '[#2943](https://github.com/vybestack/llxprt-code/issues/2943)',
      );
      expect(comment).toContain(
        '[#3000](https://github.com/vybestack/llxprt-code/pull/3000)',
      );
    }
  });
  it('marks failed trusted discovery incomplete without granting model search tools', async () => {
    const dir = await workspace();
    await writeFile(
      path.join(dir, 'related.json'),
      JSON.stringify({ state: 'unavailable', items: [] }),
    );
    await runPipeline(dir, async (prompt) =>
      inference(prompt, { related: '- #3781: runtime changes' }),
    );
    const outcome = await result(dir);
    expect(outcome.state).toBe('incomplete');
    expect(outcome.unavailable).toContain('related-discovery');
    expect(outcome.unavailable).not.toContain('related');
    expect(await readFile(path.join(dir, 'comment.md'), 'utf8')).toContain(
      '#3781',
    );
  });
});

describe('phase budget and completion accounting', () => {
  it('synthesizes every packet of one file instead of reporting completion without release notes', async () => {
    const dir = await workspace({ packets: 24, closing: [{ number: 3781 }] });
    const observedPackets: number[] = [];
    await runPipeline(dir, async (prompt) => {
      expect(Buffer.byteLength(prompt)).toBeLessThanOrEqual(20000);
      if (prompt.includes('writing a walkthrough')) {
        const evidence = z
          .array(z.object({ packet: z.number() }))
          .parse(input(prompt).fileEvidence);
        observedPackets.push(...evidence.map((item) => item.packet));
      }
      return inference(prompt);
    });
    expect([...new Set(observedPackets)].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 24 }, (_, index) => index + 1),
    );
    expect((await result(dir)).state).toBe('complete');
    expect(await readFile(path.join(dir, 'comment.md'), 'utf8')).toContain(
      '## Release Notes',
    );
  });
  for (const phase of ['synthesis', 'related', 'diagram']) {
    it(`records ${phase} budget construction failure before inference`, async () => {
      const dir = await workspace({ title: 'X'.repeat(20500), flow: true });
      await runPipeline(dir, async (prompt) => inference(prompt));
      const outcome = await result(dir);
      expect(outcome.state).toBe('incomplete');
      expect(outcome.unavailable).toContain(phase);
      expect(
        await readFile(path.join(dir, 'comment.md'), 'utf8'),
      ).not.toContain(
        'All changed-file packets and walkthrough stages completed',
      );
    });
  }
  it('chunks an oversized observation without losing its tail or claiming unperformed synthesis', async () => {
    const dir = await workspace({ closing: [{ number: 3781 }] });
    let evidence = '';
    await runPipeline(dir, async (prompt) => {
      if (prompt.includes('writing a walkthrough')) {
        expect(Buffer.byteLength(prompt)).toBeLessThanOrEqual(20000);
        evidence += z
          .array(z.object({ summary: z.string() }))
          .parse(input(prompt).fileEvidence)
          .map((item) => item.summary)
          .join('');
      }
      return inference(prompt, {
        mapSummary: '😀'.repeat(5500) + 'OBSERVATION_TAIL',
      });
    });
    expect(evidence).toContain('OBSERVATION_TAIL');
    expect(evidence.match(/😀/g)).toHaveLength(5500);
    expect((await result(dir)).unavailable).not.toContain('synthesis');
  });
});

describe('referenced issue alignment', () => {
  it('retains all independent checks for actual empty closing metadata and asks alignment rather than closure', async () => {
    const dir = await workspace();
    let assessment = '';
    await runPipeline(dir, async (prompt) => {
      if (prompt.includes('evaluating a PR')) assessment = prompt;
      return inference(prompt);
    });
    const checks = z
      .object({
        title: z.object({ ok: z.boolean() }),
        description: z.object({ ok: z.boolean() }),
        linked_issues: z.object({ note: z.string() }),
        out_of_scope: z.object({ note: z.string() }),
      })
      .parse((await result(dir)).preMergeChecks);
    expect(checks.title.ok).toBe(true);
    expect(checks.description.ok).toBe(false);
    expect(checks.out_of_scope.note).toContain('unrelated');
    expect(assessment).toContain('referenced alignment');
    expect(assessment).not.toContain(
      'Do the actual changes fulfill the full linked-issue acceptance criteria?',
    );
    expect(checks.linked_issues.note).toContain('Referenced alignment');
  });
});

describe('executable artifact diagnostics', () => {
  for (const problem of ['malformed', 'missing', 'schema']) {
    it(`retains safe private cause for ${problem} pr.json with generic public output`, async () => {
      const dir = await workspace();
      if (problem === 'missing') await rm(path.join(dir, 'pr.json'));
      else
        await writeFile(
          path.join(dir, 'pr.json'),
          problem === 'malformed'
            ? '{SECRET_SERVER_TOKEN'
            : JSON.stringify({
                title: 'SECRET_SERVER_TOKEN',
                number: 'not-a-number',
              }),
        );
      const process = Bun.spawn(
        ['bun', path.resolve(import.meta.dir, '../pr-review-walkthrough.ts')],
        {
          env: { ...Bun.env, REVIEW_DIR: dir },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      const stderr = await new Response(process.stderr).text();
      expect(await process.exited).toBe(1);
      const diagnostic = z
        .object({
          state: z.literal('unavailable'),
          diagnostic: z.object({
            category: z.string(),
            operation: z.string(),
            path: z.string(),
          }),
        })
        .parse(
          JSON.parse(await readFile(path.join(dir, 'result.json'), 'utf8')),
        );
      expect(diagnostic.diagnostic.path).toBe('pr.json');
      const operations: Record<string, string> = {
        missing: 'read',
        malformed: 'parse',
        schema: 'validate',
      };
      expect(diagnostic.diagnostic.operation).toBe(operations[problem]);
      expect(stderr).toContain('pr.json');
      expect(stderr).not.toContain('SECRET_SERVER_TOKEN');
      expect(
        await readFile(path.join(dir, 'comment.md'), 'utf8'),
      ).not.toContain('pr.json');
      expect(JSON.stringify(diagnostic)).not.toContain('SECRET_SERVER_TOKEN');
    });
  }
});

describe('Mermaid structural validation', () => {
  for (const diagram of [
    '```mermaid\nsequenceDiagram\nA->>B: run',
    'sequenceDiagram\nA->>B: run\n```',
    '```mermaid\nsequenceDiagram\n```mermaid\nA->>B: run\n```\n```',
    'sequenceDiagram\nalt condition\nA->>B: run',
    'sequenceDiagram\nend\nA->>B: run',
  ]) {
    it(`rejects malformed structure ${JSON.stringify(diagram)}`, () => {
      expect(sanitizeSequenceDiagram(diagram)).toBe('');
    });
  }
  it('marks retained Gemma unclosed diagrams unavailable rather than wrapping nested fences', async () => {
    const diagrams = z
      .array(z.string())
      .parse(
        JSON.parse(
          await readFile(
            path.resolve(
              import.meta.dir,
              'fixtures/pr-review-malformed-diagrams.json',
            ),
            'utf8',
          ),
        ),
      );
    expect(diagrams.length).toBeGreaterThanOrEqual(2);
    for (const diagram of diagrams) {
      expect(sanitizeSequenceDiagram(diagram)).toBe('');
      const dir = await workspace({ flow: true });
      await runPipeline(dir, async (prompt) => inference(prompt, { diagram }));
      expect((await result(dir)).unavailable).toContain(
        'invalid sequence diagram',
      );
      expect(
        await readFile(path.join(dir, 'comment.md'), 'utf8'),
      ).not.toContain('```mermaid\n```mermaid');
    }
  });
});
