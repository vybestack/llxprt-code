/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect, it } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { runPipeline } from '../pr-review-walkthrough.ts';

it('carries static source classifications and all packet identities into later stages', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pr-review-provenance-flow-'));
  const files = ['src/retry.ts', 'src/retry.test.ts', 'reports/checks.md'];
  const lines = [
    '+await wait(1000);',
    '+expect(calls).toBe(1);',
    '+Docker passed 18 checks.',
  ];
  const phases = new Set<string>();
  let relatedAttempts = 0;
  try {
    await mkdir(path.join(dir, 'diffs'));
    await mkdir(path.join(dir, 'issues'));
    await writeFile(
      path.join(dir, 'pr.json'),
      JSON.stringify({
        number: 4,
        title: 'Retry handling',
        closingIssuesReferences: [{ number: 5 }],
      }),
    );
    await writeFile(
      path.join(dir, 'issues/5.json'),
      JSON.stringify({
        number: 5,
        title: 'Retry handling',
        body: 'Await 1000 ms; tests cover the bound; verify Docker.',
      }),
    );
    await writeFile(
      path.join(dir, 'numstat.txt'),
      files.map((file) => `1\t0\t${file}\n`).join(''),
    );
    await writeFile(
      path.join(dir, 'diff-manifest.txt'),
      files.map((file, index) => `${index}.diff\t${file}\n`).join(''),
    );
    for (const [index, file] of files.entries())
      await writeFile(
        path.join(dir, `diffs/${index}.diff`),
        `diff --git a/${file} b/${file}\n@@ -0,0 +1 @@\n${lines[index]}\n`,
      );
    await runPipeline(dir, async (prompt, _format, options) => {
      const input = z
        .record(z.unknown())
        .parse(
          JSON.parse(
            prompt
              .split('\n')
              .find((line) => line.startsWith('{"pullRequest":')) ?? '{}',
          ),
        );
      const phase = options?.phase ?? '';
      phases.add(phase);
      if (phase === 'map') {
        const file = z
          .object({ path: z.string(), diff: z.string() })
          .parse(input.file);
        const selected =
          file.diff.split('\n').findIndex((line) => /^\d+\| \+/.test(line)) + 1;
        return JSON.stringify({
          summary: 'Static source change',
          signature: '',
          triage: 'fix',
          observations: [
            {
              startLine: selected,
              endLine: selected,
              claim: 'Static source includes the selected line.',
            },
          ],
        });
      }
      if (phase === 'group') {
        const evidence = z
          .array(
            z.object({
              filePath: z.string(),
              sourceEvidence: z.array(
                z.object({
                  kind: z.string(),
                  execution: z.string(),
                  packet: z.number(),
                }),
              ),
            }),
          )
          .parse(input.summaries);
        expect(
          evidence
            .flatMap((file) => file.sourceEvidence.map((source) => source.kind))
            .sort(),
        ).toEqual(['documentation', 'implementation', 'test']);
        expect(
          evidence
            .flatMap((file) => file.sourceEvidence)
            .every((source) => source.execution === 'not-observed'),
        ).toBe(true);
        return JSON.stringify({
          themes: [
            {
              layer: 'core',
              files: evidence.map((file) => file.filePath),
              summary: 'Retry, test assertions and reported checks.',
            },
          ],
        });
      }
      if (phase === 'synthesis') {
        const evidence = z
          .array(
            z.object({
              source: z.object({
                kind: z.string(),
                observations: z.array(z.object({ quote: z.string() })),
              }),
            }),
          )
          .parse(input.fileEvidence);
        expect(evidence.map((file) => file.source.kind).sort()).toEqual([
          'documentation',
          'implementation',
          'test',
        ]);
        expect(evidence.every((file) => file.source.kind.length > 0)).toBe(
          true,
        );
        return JSON.stringify({
          walkthrough:
            'Before: not established. After: source includes changes.',
          release_notes: '## Tests\n- Adds test source.',
        });
      }
      if (phase === 'related') {
        relatedAttempts++;
        return JSON.stringify({
          selections: [
            {
              number: relatedAttempts === 1 ? 9999 : 5,
              reason: 'Shares retry handling',
            },
          ],
        });
      }
      if (phase === 'pre-merge') {
        const evidence = z
          .array(
            z.object({
              filePath: z.string(),
              diff: z.string(),
              sources: z.array(
                z.object({ kind: z.string(), execution: z.string() }),
              ),
            }),
          )
          .parse(input.actualCodeChanges);
        expect(evidence.map((file) => file.filePath).sort()).toEqual(
          [...files].sort(),
        );
        expect(
          evidence
            .flatMap((file) => file.sources)
            .filter((source) => source.kind === 'documentation')
            .every((source) => source.execution === 'not-observed'),
        ).toBe(true);
        expect(
          z
            .array(z.record(z.unknown()))
            .parse(input.actualCodeChanges)
            .some((item) => 'diff' in item),
        ).toBe(true);
        return JSON.stringify({
          title: { ok: true, note: 'Specific' },
          description: { ok: false, note: 'No template' },
          linked_issues: {
            ok: false,
            note: 'Runtime verification was reported in documentation, not observed.',
          },
          out_of_scope: { note: 'None' },
        });
      }
      return JSON.stringify({ diagram: '' });
    });
    const result = z
      .object({
        state: z.string(),
        summaries: z.array(
          z.object({
            packet: z.number(),
            source: z.object({ diffSha256: z.string(), execution: z.string() }),
          }),
        ),
      })
      .parse(JSON.parse(await readFile(path.join(dir, 'result.json'), 'utf8')));
    expect(result.state).toBe('complete');
    expect(result.summaries).toHaveLength(files.length);
    expect(
      new Set(result.summaries.map((item) => item.source.diffSha256)).size,
    ).toBe(files.length);
    expect([...phases].sort()).toEqual([
      'group',
      'map',
      'pre-merge',
      'related',
      'synthesis',
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
