/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseMapResponse,
  parseGroupResponse,
  renderWalkthroughComment,
  computeMagnitude,
  mapWithConcurrency,
  validateGroupThemes,
  escapeMarkdownTableCell,
  MAX_DIFF_BYTES,
} from '../pr-review-walkthrough.ts';
import { buildArtifactContext } from '../pr-review-artifacts.ts';
import { asString, parseJsonObject } from './typed-test-helpers.ts';

const BACKSLASH = String.fromCharCode(92);
describe('parseMapResponse', () => {
  it('parses clean JSON', () => {
    expect(
      parseMapResponse(
        '{"summary":"adds a function","signature":"foo()->number","triage":"feature"}',
      ),
    ).toEqual({
      summary: 'adds a function',
      signature: 'foo()->number',
      triage: 'feature',
    });
  });

  it('parses JSON wrapped in ```json fences', () => {
    const result = parseMapResponse(
      '```json\n{"summary":"adds","signature":"foo()","triage":"fix"}\n```',
    );
    expect(result.summary).toBe('adds');
    expect(result.triage).toBe('fix');
  });

  it('parses JSON surrounded by prose', () => {
    const result = parseMapResponse(
      'Here is the summary:\n{"summary":"adds","signature":"foo()","triage":"test"}\nThanks!',
    );
    expect(result.summary).toBe('adds');
    expect(result.triage).toBe('test');
  });

  it('throws on truly unparseable input', () => {
    expect(() => parseMapResponse('this is not json at all')).toThrow();
  });

  it('throws on empty input', () => {
    expect(() => parseMapResponse('')).toThrow();
  });

  it('defaults invalid triage to chore (HIGH 6)', () => {
    expect(
      parseMapResponse(
        '{"summary":"ok","signature":"foo()","triage":"bogus-tag"}',
      ).triage,
    ).toBe('chore');
  });

  it('keeps a valid triage tag unchanged', () => {
    expect(
      parseMapResponse(
        '{"summary":"ok","signature":"foo()","triage":"refactor"}',
      ).triage,
    ).toBe('refactor');
  });
});
it('extracts the first balanced JSON object after prose with unrelated braces', () => {
  const result = parseMapResponse(
    'Example function { return 1; } then {"summary":"adds","signature":"foo()","triage":"test"}',
  );
  expect(result).toEqual({
    summary: 'adds',
    signature: 'foo()',
    triage: 'test',
  });
});

it('does not expose raw response text in parse errors', () => {
  expect(() =>
    parseMapResponse('secret-token-that-must-not-appear { malformed'),
  ).toThrow('Cannot parse JSON from response');
  try {
    parseMapResponse('secret-token-that-must-not-appear { malformed');
  } catch (error: unknown) {
    expect(
      error instanceof Error ? error.message : String(error),
    ).not.toContain('secret-token-that-must-not-appear');
  }
});

describe('extractJsonObject non-object rejection (OCR Finding 1)', () => {
  it('throws when direct parse yields a JSON string', () => {
    expect(() => parseMapResponse('"just a string"')).toThrow(/object/);
  });

  it('throws when direct parse yields a JSON number', () => {
    expect(() => parseMapResponse('42')).toThrow(/object/);
  });

  it('throws when direct parse yields a JSON array', () => {
    expect(() => parseMapResponse('[1, 2, 3]')).toThrow(/object/);
  });

  it('throws when direct parse yields JSON null', () => {
    expect(() => parseMapResponse('null')).toThrow(/object/);
  });

  it('throws when direct parse yields JSON boolean', () => {
    expect(() => parseMapResponse('true')).toThrow(/object/);
  });

  it('throws when fenced JSON is a non-object array', () => {
    expect(() =>
      parseGroupResponse('```json\n["not", "an", "object"]\n```'),
    ).toThrow(/object/);
  });

  it('throws when brace-slice extraction yields a non-object', () => {
    expect(() => parseMapResponse('prefix [1,2,3] suffix')).toThrow();
  });
});

describe('parseMapResponse summary truncation (OCR Finding 8)', () => {
  it('truncates a summary exceeding 150 words to <= 101 words', () => {
    const words = Array.from({ length: 200 }, (_, i) => `word${i}`);
    const longSummary = words.join(' ');
    const result = parseMapResponse(
      `{"summary":"${longSummary}","signature":"foo()","triage":"feature"}`,
    );
    const resultWords = result.summary.split(/\s+/);
    expect(resultWords.length).toBeLessThanOrEqual(101);
    expect(result.summary.endsWith('...')).toBe(true);
  });

  it('does not truncate a summary at the 100-word boundary', () => {
    const words = Array.from({ length: 100 }, (_, i) => `word${i}`);
    const summary = words.join(' ');
    const result = parseMapResponse(
      `{"summary":"${summary}","signature":"foo()","triage":"feature"}`,
    );
    expect(result.summary).toBe(summary);
  });

  it('does not truncate a short summary', () => {
    const result = parseMapResponse(
      '{"summary":"short summary","signature":"foo()","triage":"feature"}',
    );
    expect(result.summary).toBe('short summary');
  });
});

describe('parseGroupResponse', () => {
  it('parses a clean themes array', () => {
    const result = parseGroupResponse(
      '{"themes":[{"layer":"core","files":["a.mjs"],"summary":"logic"}]}',
    );
    expect(result.themes).toHaveLength(1);
    expect(result.themes[0].layer).toBe('core');
    expect(result.themes[0].files).toEqual(['a.mjs']);
    expect(result.themes[0].summary).toBe('logic');
  });

  it('parses JSON wrapped in fences', () => {
    const result = parseGroupResponse(
      '```json\n{"themes":[{"layer":"ui","files":["x.ts"],"summary":"render"}]}\n```',
    );
    expect(result.themes[0].layer).toBe('ui');
  });

  it('parses JSON surrounded by prose', () => {
    expect(parseGroupResponse('Sure!\n{"themes":[]}\nDone.').themes).toEqual(
      [],
    );
  });

  it('throws on garbage input', () => {
    expect(() => parseGroupResponse('totally not json')).toThrow();
  });
});

describe('validateGroupThemes (HIGH 6)', () => {
  it('passes through valid themes with all required fields', () => {
    const result = validateGroupThemes([
      { layer: 'core', files: ['a.ts'], summary: 'logic' },
      { layer: 'ui', files: ['b.tsx'], summary: 'render' },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      layer: 'core',
      files: ['a.ts'],
      summary: 'logic',
    });
  });

  it('drops themes missing layer or summary', () => {
    const result = validateGroupThemes([
      { layer: 'core', files: ['a.ts'], summary: 'logic' },
      { files: ['b.ts'], summary: 'no layer' },
      { layer: 'ui', files: ['c.ts'] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].layer).toBe('core');
  });

  it('coerces missing files array to empty array (no crash)', () => {
    expect(validateGroupThemes([{ layer: 'core', summary: 'logic' }])).toEqual([
      { layer: 'core', files: [], summary: 'logic' },
    ]);
  });

  it('filters non-string entries out of the files array', () => {
    const result = validateGroupThemes([
      { layer: 'core', files: ['a.ts', 42, null, 'b.ts'], summary: 'logic' },
    ]);
    expect(result[0].files).toEqual(['a.ts', 'b.ts']);
  });

  it('returns empty array for non-array input', () => {
    expect(validateGroupThemes(null)).toEqual([]);
    expect(validateGroupThemes(undefined)).toEqual([]);
    expect(validateGroupThemes({})).toEqual([]);
  });

  it('drops null/non-object entries', () => {
    expect(
      validateGroupThemes([null, 'string', { layer: 'ok', summary: 's' }]),
    ).toHaveLength(1);
  });
});

describe('renderChangesTable defensive handling (HIGH 6)', () => {
  it('renders (none) for a theme with missing files array', () => {
    const comment = renderWalkthroughComment({
      walkthrough: 'test',
      themes: [{ layer: 'core', summary: 'logic' }],
      preMergeChecks: null,
    });
    expect(comment).toContain('(none)');
    expect(comment).toContain('core');
  });

  it('renders (none) for a theme with empty files array', () => {
    const comment = renderWalkthroughComment({
      walkthrough: 'test',
      themes: [{ layer: 'core', files: [], summary: 'logic' }],
      preMergeChecks: null,
    });
    expect(comment).toContain('(none)');
  });
});
describe('MAX_DIFF_BYTES constant (HIGH 5)', () => {
  it('is a positive number', () => {
    expect(typeof MAX_DIFF_BYTES).toBe('number');
    expect(MAX_DIFF_BYTES).toBeGreaterThan(0);
  });

  it('is set to 50000', () => {
    expect(MAX_DIFF_BYTES).toBe(50000);
  });
});

describe('renderWalkthroughComment', () => {
  const fullInput = {
    releaseNotes:
      '## Release Notes\n- **New Features**: Walkthrough\n- **Bug Fixes**: None',
    walkthrough: 'Before: bug-finding reviewer. After: walkthrough commenter.',
    themes: [{ layer: 'core', files: ['a.mjs'], summary: 'adds map function' }],
    sequenceDiagram: '```mermaid\nsequenceDiagram\n  A->>B: request\n```',
    magnitude: { score: 2, label: 'M', basis: '4 files, 120 additions' },
    related: '- #2260 relates to walkthrough',
    preMergeChecks: {
      title: { ok: true, note: 'clear' },
      description: { ok: true, note: 'complete' },
      linked_issues: { ok: true, note: 'fulfills #2261' },
      out_of_scope: { note: 'none' },
    },
  };

  it('starts with the llxprt-walkthrough marker', () => {
    expect(
      renderWalkthroughComment(fullInput).startsWith(
        '<!-- llxprt-walkthrough -->',
      ),
    ).toBe(true);
  });

  it('includes all sections when present', () => {
    const comment = renderWalkthroughComment(fullInput);
    expect(comment).toContain('Walkthrough');
    expect(comment).toContain('Release Notes');
    expect(comment).toContain('Changes');
    expect(comment).toContain('sequenceDiagram');
    expect(comment).toContain('Magnitude');
    expect(comment).toContain('Related');
    expect(comment.toLowerCase()).toContain('pre-merge');
  });

  it('omits the sequence diagram when empty', () => {
    expect(
      renderWalkthroughComment({ ...fullInput, sequenceDiagram: '' }),
    ).not.toContain('sequenceDiagram');
  });

  it('omits the sequence diagram when undefined', () => {
    const { sequenceDiagram: _omit, ...rest } = fullInput;
    expect(renderWalkthroughComment(rest)).not.toContain('sequenceDiagram');
  });

  it('always renders the Related section even when empty (HIGH 7)', () => {
    const comment = renderWalkthroughComment({ ...fullInput, related: '' });
    expect(comment).toContain('## Related');
    expect(comment).toContain('No related items found.');
  });

  it('always renders the Related section when undefined (HIGH 7)', () => {
    const { related: _omit, ...rest } = fullInput;
    const comment = renderWalkthroughComment(rest);
    expect(comment).toContain('## Related');
    expect(comment).toContain('No related items found.');
  });

  it('includes a footer linking issue #2256', () => {
    expect(renderWalkthroughComment(fullInput)).toContain('#2256');
  });

  it('includes magnitude section', () => {
    const comment = renderWalkthroughComment(fullInput);
    expect(comment).toContain('Magnitude');
    expect(comment).toContain('M');
    expect(comment).toContain('4 files, 120 additions');
  });

  it('renders the per-theme changes table', () => {
    const comment = renderWalkthroughComment(fullInput);
    expect(comment).toContain('Layer');
    expect(comment).toContain('File(s)');
    expect(comment).toContain('Summary');
    expect(comment).toContain('a.mjs');
    expect(comment).toContain('adds map function');
  });
});

describe('escapeMarkdownTableCell (MEDIUM 11)', () => {
  const BS = BACKSLASH;
  it('escapes pipe characters', () => {
    expect(escapeMarkdownTableCell('a|b')).toBe('a' + BS + '|b');
  });

  it('escapes backslash characters', () => {
    expect(escapeMarkdownTableCell('a' + BS + 'b')).toBe('a' + BS + BS + 'b');
  });

  it('replaces newlines with br', () => {
    expect(
      escapeMarkdownTableCell('line1' + String.fromCharCode(10) + 'line2'),
    ).toBe('line1<br>line2');
  });

  it('replaces carriage returns with br', () => {
    expect(
      escapeMarkdownTableCell('line1' + String.fromCharCode(13) + 'line2'),
    ).toBe('line1<br>line2');
  });

  it('replaces cr+lf with a single br', () => {
    const crlf = String.fromCharCode(13) + String.fromCharCode(10);
    expect(escapeMarkdownTableCell('a' + crlf + 'b')).toBe('a<br>b');
  });

  it('returns empty string for null/undefined', () => {
    expect(escapeMarkdownTableCell(null)).toBe('');
    expect(escapeMarkdownTableCell(undefined)).toBe('');
  });

  it('coerces non-strings to string', () => {
    expect(escapeMarkdownTableCell(42)).toBe('42');
  });
});

describe('renderWalkthroughComment markdown escaping in tables (MEDIUM 11)', () => {
  const BS = BACKSLASH;
  it('escapes pipes in file paths in the changes table', () => {
    const comment = renderWalkthroughComment({
      walkthrough: 'test',
      themes: [{ layer: 'core', files: ['src/a|b.ts'], summary: 'logic' }],
      preMergeChecks: null,
    });
    expect(comment).toContain('src/a' + BS + '|b.ts');
  });

  it('escapes pipes in pre-merge check notes', () => {
    const comment = renderWalkthroughComment({
      walkthrough: 'test',
      themes: [],
      preMergeChecks: {
        title: { ok: true, note: 'has | pipe' },
        description: { ok: true, note: 'ok' },
        linked_issues: { ok: true, note: 'ok' },
        out_of_scope: { note: 'none' },
      },
    });
    expect(comment).toContain('has ' + BS + '| pipe');
  });
});

describe('computeMagnitude', () => {
  it('is deterministic — same inputs always produce the same output', () => {
    const input = {
      additions: 100,
      deletions: 10,
      changedFiles: 3,
      packageCount: 2,
      criteriaCount: 2,
    };
    expect(computeMagnitude(input)).toEqual(computeMagnitude(input));
  });

  it('produces a score in the 1-5 range', () => {
    const result = computeMagnitude({
      additions: 0,
      deletions: 0,
      changedFiles: 1,
      packageCount: 1,
      criteriaCount: 1,
    });
    expect(result.score).toBeGreaterThanOrEqual(1);
    expect(result.score).toBeLessThanOrEqual(5);
  });

  it('produces a label that matches the score', () => {
    const labels = { 1: 'S', 2: 'M', 3: 'L', 4: 'XL', 5: 'XXL' };
    for (const [scoreStr, expectedLabel] of Object.entries(labels)) {
      const scale = Number(scoreStr);
      const result = computeMagnitude({
        additions: scale * 500,
        deletions: scale * 50,
        changedFiles: scale * 5,
        packageCount: scale,
        criteriaCount: scale,
      });
      expect(result.label).toBe(expectedLabel);
    }
  });

  it('basis contains no time estimates', () => {
    const basis = computeMagnitude({
      additions: 100,
      deletions: 10,
      changedFiles: 3,
      packageCount: 2,
      criteriaCount: 2,
    }).basis.toLowerCase();
    expect(basis).not.toContain('hour');
    expect(basis).not.toContain('minute');
    expect(basis).not.toContain('day');
    expect(basis).not.toContain('time');
    expect(basis).not.toContain('effort');
  });

  it('basis mentions LoC/files/packages', () => {
    const basis = computeMagnitude({
      additions: 100,
      deletions: 10,
      changedFiles: 3,
      packageCount: 2,
      criteriaCount: 2,
    }).basis;
    expect(basis).toContain('100');
    expect(basis).toContain('3');
    expect(basis).toContain('2');
  });
});

describe('mapWithConcurrency', () => {
  it('runs all items and returns results in input order', async () => {
    expect(
      await mapWithConcurrency(['a', 'b', 'c'], 2, async (item: string) =>
        item.toUpperCase(),
      ),
    ).toEqual(['A', 'B', 'C']);
  });

  it('respects the concurrency limit', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (item) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;
      return item;
    });
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(maxInFlight).toBe(2);
  });

  it('isolates failures — a failing item becomes an error result without failing the batch', async () => {
    const results = await mapWithConcurrency(
      ['ok1', 'fail', 'ok2'],
      2,
      async (item: string) => {
        if (item === 'fail') {
          throw new Error('boom');
        }
        return item;
      },
    );
    expect(results[0]).toBe('ok1');
    expect(results[1]).toHaveProperty('error');
    expect(results[2]).toBe('ok2');
  });

  it('includes filePath in the error result when item has it', async () => {
    const results = await mapWithConcurrency(
      [{ filePath: 'x.mjs', diff: '...' }],
      1,
      async () => {
        throw new Error('network');
      },
    );
    expect(results[0]).toHaveProperty('error');
    expect(results[0]).toHaveProperty('filePath', 'x.mjs');
  });

  it('throws RangeError for concurrency 0 (OCR Finding 7)', async () => {
    await expect(
      mapWithConcurrency(['a', 'b'], 0, async (item) => item),
    ).rejects.toThrow(RangeError);
  });

  it('throws RangeError for negative concurrency (OCR Finding 7)', async () => {
    await expect(
      mapWithConcurrency(['a', 'b'], -1, async (item) => item),
    ).rejects.toThrow(RangeError);
  });

  it('throws RangeError for non-integer concurrency (OCR Finding 7)', async () => {
    await expect(
      mapWithConcurrency(['a', 'b'], 2.5, async (item) => item),
    ).rejects.toThrow(RangeError);
  });

  it('throws RangeError for NaN concurrency (OCR Finding 7)', async () => {
    await expect(
      mapWithConcurrency(['a', 'b'], Number.NaN, async (item) => item),
    ).rejects.toThrow(RangeError);
  });
});

const WALKTHROUGH_SCRIPT = nodePath.resolve(
  import.meta.dirname,
  '..',
  'pr-review-walkthrough.ts',
);

const PHASE_TIMEOUT = 60000;

function makeFakeLlxprtScript(counterDir: string): string {
  return [
    '#!/usr/bin/env node',
    'const fs = require("fs");',
    'const path = require("path");',
    'const args = process.argv.slice(2);',
    'const promptIndex = args.indexOf("--prompt");',
    'const prompt = promptIndex >= 0 ? args[promptIndex + 1] : "";',
    'let phase = "unknown";',
    'let response = "{}";',
    'if (prompt.includes("analyzing a single changed file")) {',
    '  phase = "map";',
    '  response = JSON.stringify({summary:"changed file",signature:"foo()",triage:"fix"});',
    '} else if (prompt.includes("grouping changed files")) {',
    '  phase = "group";',
    '  response = JSON.stringify({themes:[{layer:"core",files:["packages/a/src/index.ts","packages/b/src/index.ts"],summary:"cross-package change"}]});',
    '} else if (prompt.includes("writing a walkthrough")) {',
    '  phase = "synthesis";',
    '  response = JSON.stringify({walkthrough:"before after",release_notes:"## Release Notes\\n- change"});',
    '} else if (prompt.includes("drawing a runtime sequence diagram")) {',
    '  phase = "diagram";',
    '  response = "[\\"non-object\\"]";',
    '} else if (prompt.includes("finding issues and PRs semantically related")) {',
    '  phase = "related";',
    '  response = "[\\"non-object\\"]";',
    '} else if (prompt.includes("evaluating a PR against pre-merge")) {',
    '  phase = "pre-merge";',
    '  response = JSON.stringify({title:{ok:true,note:"clear"},description:{ok:true,note:"ok"},linked_issues:{ok:true,note:"ok"},out_of_scope:{note:"none"}});',
    '}',
    'fs.writeFileSync(path.join(' +
      JSON.stringify(counterDir) +
      ', phase + "-" + process.pid), "1");',
    'process.stdout.write(response);',
  ].join('\n');
}

function setupReviewWorkspace(): {
  workspace: string;
  reviewDir: string;
  binDir: string;
  counterDir: string;
  pathWithFake: string;
} {
  const workspace = nodeFs.mkdtempSync(
    nodePath.join(nodeOs.tmpdir(), 'walkthrough-2777-'),
  );
  const reviewDir = nodePath.join(workspace, 'review');
  const binDir = nodePath.join(workspace, 'bin');
  const counterDir = nodePath.join(workspace, 'counts');
  nodeFs.mkdirSync(reviewDir, { recursive: true });
  nodeFs.mkdirSync(binDir, { recursive: true });
  nodeFs.mkdirSync(counterDir, { recursive: true });

  nodeFs.writeFileSync(
    nodePath.join(reviewDir, 'pr.json'),
    JSON.stringify({
      number: 2777,
      title: 'Parse reliability for walkthrough',
      body: 'test body',
      baseRefName: 'main',
      headRefName: 'issue2777',
      additions: 100,
      deletions: 10,
      changedFiles: 2,
      commits: [{ oid: 'abc1234', message: 'initial commit' }],
    }),
  );

  const issuesDir = nodePath.join(reviewDir, 'issues');
  nodeFs.mkdirSync(issuesDir, { recursive: true });
  nodeFs.writeFileSync(
    nodePath.join(issuesDir, '2777.json'),
    JSON.stringify({
      number: 2777,
      title: 'Parse reliability',
      body: '## Acceptance Criteria\n- [ ] item 1\n- [ ] item 2',
    }),
  );

  const diffsDir = nodePath.join(reviewDir, 'diffs');
  nodeFs.mkdirSync(diffsDir, { recursive: true });
  const diffA = 'packages__a__src__index.ts.diff';
  const diffB = 'packages__b__src__index.ts.diff';
  nodeFs.writeFileSync(
    nodePath.join(diffsDir, diffA),
    'diff --git a/packages/a/src/index.ts b/packages/a/src/index.ts\n+added',
  );
  nodeFs.writeFileSync(
    nodePath.join(diffsDir, diffB),
    'diff --git a/packages/b/src/index.ts b/packages/b/src/index.ts\n+added',
  );

  nodeFs.writeFileSync(
    nodePath.join(reviewDir, 'diff-manifest.txt'),
    `${diffA}\tpackages/a/src/index.ts\n${diffB}\tpackages/b/src/index.ts\n`,
  );

  nodeFs.writeFileSync(
    nodePath.join(reviewDir, 'numstat.txt'),
    '50\t5\tpackages/a/src/index.ts\n50\t5\tpackages/b/src/index.ts\n',
  );

  const isWindows = process.platform === 'win32';
  const fakeName = isWindows ? 'llxprt.cmd' : 'llxprt';
  const fakePath = nodePath.join(binDir, fakeName);
  if (isWindows) {
    nodeFs.writeFileSync(
      fakePath,
      `@echo off\r\nnode "${nodePath.join(binDir, 'llxprt-fake.js')}" %*\r\n`,
    );
  } else {
    nodeFs.writeFileSync(fakePath, makeFakeLlxprtScript(counterDir), {
      mode: 0o755,
    });
  }
  if (isWindows) {
    nodeFs.writeFileSync(
      nodePath.join(binDir, 'llxprt-fake.js'),
      makeFakeLlxprtScript(counterDir).replace('#!/usr/bin/env node\n', ''),
    );
  }

  const pathWithFake = process.env.PATH
    ? `${binDir}${nodePath.delimiter}${process.env.PATH}`
    : binDir;
  return { workspace, reviewDir, binDir, counterDir, pathWithFake };
}

function countPhaseCalls(counterDir: string, phase: string): number {
  return nodeFs
    .readdirSync(counterDir)
    .filter((file) => file.startsWith(`${phase}-`)).length;
}

describe('private optional-stage retry and diagnostics', () => {
  it(
    'exhausts optional stages without failing or rendering their content',
    () => {
      const { workspace, reviewDir, counterDir, pathWithFake } =
        setupReviewWorkspace();
      try {
        const result = spawnSync('bun', [WALKTHROUGH_SCRIPT], {
          cwd: workspace,
          encoding: 'utf8',
          timeout: PHASE_TIMEOUT,
          env: {
            ...process.env,
            PATH: pathWithFake,
            LLXPRT_DEFAULT_PROVIDER: 'fake',
            OPENAI_API_KEY: 'test-key',
            OPENAI_BASE_URL: 'http://localhost',
            LLXPRT_DEFAULT_MODEL: 'test-model',
            LLXPRT_STRONG_MODEL: 'test-strong',
          },
        });
        if (result.error) {
          throw new Error(
            `Failed to spawn walkthrough script: ${result.error.message}`,
          );
        }
        const comment = nodeFs.readFileSync(
          nodePath.join(reviewDir, 'comment.md'),
          'utf8',
        );
        const walkthrough = nodeFs.readFileSync(
          nodePath.join(reviewDir, 'walkthrough.md'),
          'utf8',
        );
        const files = nodeFs.readdirSync(reviewDir);
        const diagramRaw = files.find((file) =>
          file.startsWith('parse-failure-raw-diagram-'),
        );
        const relatedRaw = files.find((file) =>
          file.startsWith('parse-failure-raw-related-'),
        );
        const infoFiles = files.filter((file) =>
          file.startsWith('parse-failure-info-'),
        );
        if (!diagramRaw || !relatedRaw || infoFiles.length !== 2) {
          throw new Error('Expected distinct diagram and related diagnostics');
        }
        const metadata = infoFiles
          .map((file) =>
            parseJsonObject(
              nodeFs.readFileSync(nodePath.join(reviewDir, file), 'utf8'),
            ),
          )
          .sort((left, right) =>
            asString(left.phase).localeCompare(asString(right.phase)),
          );
        expect({
          status: result.status,
          outputMatches: walkthrough === comment,
          hasMarker: comment.includes('<!-- llxprt-walkthrough -->'),
          hasDiagram: comment.includes('## Sequence Diagram'),
          hasRelated: comment.includes('## Related'),
          hasEmptyRelated: comment.includes('No related items found.'),
          calls: {
            map: countPhaseCalls(counterDir, 'map'),
            group: countPhaseCalls(counterDir, 'group'),
            synthesis: countPhaseCalls(counterDir, 'synthesis'),
            diagram: countPhaseCalls(counterDir, 'diagram'),
            related: countPhaseCalls(counterDir, 'related'),
            preMerge: countPhaseCalls(counterDir, 'pre-merge'),
            unknown: countPhaseCalls(counterDir, 'unknown'),
          },
          raw: [diagramRaw, relatedRaw]
            .map((file) =>
              nodeFs.readFileSync(nodePath.join(reviewDir, file), 'utf8'),
            )
            .sort(),
          metadata: metadata.map((info) => ({
            phase: info.phase,
            hasPromptLength:
              typeof info.promptLength === 'number' && info.promptLength > 0,
            rawLength: info.rawLength,
          })),
        }).toEqual({
          status: 0,
          outputMatches: true,
          hasMarker: true,
          hasDiagram: false,
          hasRelated: true,
          hasEmptyRelated: true,
          calls: {
            map: 2,
            group: 1,
            synthesis: 1,
            diagram: 3,
            related: 3,
            preMerge: 1,
            unknown: 0,
          },
          raw: ['["non-object"]', '["non-object"]'],
          metadata: [
            {
              phase: 'diagram',
              hasPromptLength: true,
              rawLength: '["non-object"]'.length,
            },
            {
              phase: 'related',
              hasPromptLength: true,
              rawLength: '["non-object"]'.length,
            },
          ],
        });
      } finally {
        nodeFs.rmSync(workspace, { recursive: true, force: true });
      }
    },
    PHASE_TIMEOUT,
  );
});

describe('buildArtifactContext commits normalization (gh CLI shape)', () => {
  const basePr = {
    number: 42,
    title: 'Test PR',
    body: 'body',
    baseRefName: 'main',
    headRefName: 'feature',
    additions: 10,
    deletions: 5,
    changedFiles: 2,
  };
  const issues: Array<Record<string, unknown>> = [];
  const diffs: Array<Record<string, unknown>> = [];
  const numstat = [
    { additions: 5, deletions: 2, filename: 'a.ts' },
    { additions: 5, deletions: 3, filename: 'b.ts' },
  ];

  it('normalizes gh CLI commits array to a count', () => {
    const result = buildArtifactContext(
      {
        ...basePr,
        commits: [
          { oid: 'abc', authors: [{ login: 'alice' }] },
          { oid: 'def', authors: [{ login: 'bob' }] },
        ],
      },
      issues,
      diffs,
      numstat,
    );
    const prContext = result.prContext as Record<string, unknown>;
    expect(prContext.commits).toBe(2);
  });

  it('passes through a numeric commits value unchanged', () => {
    const result = buildArtifactContext(
      { ...basePr, commits: 7 },
      issues,
      diffs,
      numstat,
    );
    const prContext = result.prContext as Record<string, unknown>;
    expect(prContext.commits).toBe(7);
  });

  it('sets commits to undefined when missing', () => {
    const result = buildArtifactContext(basePr, issues, diffs, numstat);
    const prContext = result.prContext as Record<string, unknown>;
    expect(prContext.commits).toBeUndefined();
  });
});
