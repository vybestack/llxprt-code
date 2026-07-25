/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  parseMapResponse,
  parseGroupResponse,
  renderWalkthroughComment,
  computeMagnitude,
  mapWithConcurrency,
  gateSequenceDiagram,
  validateGroupThemes,
  escapeMarkdownTableCell,
  sanitizeErrorMessage,
  parseDiffManifest,
  resolveOriginalPath,
  MAX_DIFF_BYTES,
} from '../pr-review-walkthrough.mjs';

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
  const BS = String.fromCharCode(92);
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
  const BS = String.fromCharCode(92);
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
      await mapWithConcurrency(['a', 'b', 'c'], 2, async (item) =>
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
      async (item) => {
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

describe('sanitizeErrorMessage (CRITICAL 1)', () => {
  it('redacts the API key value following --key', () => {
    const sanitized = sanitizeErrorMessage(
      new Error(
        "Command failed: llxprt --key sk-secret-12345 --prompt 'hello'",
      ),
    );
    expect(sanitized.message).toContain('[REDACTED]');
    expect(sanitized.message).not.toContain('sk-secret-12345');
  });

  it('preserves the --key flag itself', () => {
    const sanitized = sanitizeErrorMessage(
      new Error('cmd --key secret-value --prompt hi'),
    );
    expect(sanitized.message).toContain('--key');
    expect(sanitized.message).toContain('[REDACTED]');
  });

  it('redacts multiple --key occurrences', () => {
    const sanitized = sanitizeErrorMessage(
      new Error('--key aaa --prompt x --key bbb'),
    );
    expect(sanitized.message).not.toContain('aaa');
    expect(sanitized.message).not.toContain('bbb');
    expect(sanitized.message).toMatch(/\[REDACTED\].*\[REDACTED\]/);
  });

  it('returns the error unchanged when no --key is present', () => {
    const sanitized = sanitizeErrorMessage(
      new Error('some other error with no key'),
    );
    expect(sanitized.message).toBe('some other error with no key');
  });

  it('preserves error code and exitCode properties', () => {
    const error = new Error('--key secret');
    error.code = 'ENOENT';
    error.exitCode = 127;
    const sanitized = sanitizeErrorMessage(error);
    expect(sanitized.code).toBe('ENOENT');
    expect(sanitized.exitCode).toBe(127);
  });

  it('wraps non-Error values in a new Error', () => {
    const sanitized = sanitizeErrorMessage('just a string');
    expect(sanitized).toBeInstanceOf(Error);
    expect(sanitized.message).toBe('just a string');
  });

  it('does not redact --prompt when --key has no value (OCR Finding 9)', () => {
    const sanitized = sanitizeErrorMessage(
      new Error('Command failed: llxprt --key --prompt hello'),
    );
    expect(sanitized.message).toContain('--prompt');
    expect(sanitized.message).not.toContain('[REDACTED]');
  });

  it('redacts a real key value but preserves a following --prompt flag (OCR Finding 9)', () => {
    const sanitized = sanitizeErrorMessage(
      new Error('cmd --key secret123 --prompt hello'),
    );
    expect(sanitized.message).toContain('[REDACTED]');
    expect(sanitized.message).not.toContain('secret123');
    expect(sanitized.message).toContain('--prompt');
  });

  it('does not redact a value starting with a single dash after --key', () => {
    const sanitized = sanitizeErrorMessage(
      new Error('cmd --key -v --prompt hello'),
    );
    expect(sanitized.message).not.toContain('[REDACTED]');
  });
});

describe('parseDiffManifest and resolveOriginalPath (HIGH 3)', () => {
  it('resolveOriginalPath uses manifest mapping when available', () => {
    const manifest = new Map([
      ['src__tests__foo.test.ts.diff', 'src/__tests__/foo.test.ts'],
    ]);
    expect(resolveOriginalPath('src__tests__foo.test.ts.diff', manifest)).toBe(
      'src/__tests__/foo.test.ts',
    );
  });

  it('resolveOriginalPath falls back to naive replace when manifest is null', () => {
    expect(resolveOriginalPath('src__tests__foo.test.ts.diff', null)).toBe(
      'src/tests/foo.test.ts',
    );
  });

  it('resolveOriginalPath falls back when manifest lacks the entry', () => {
    const manifest = new Map([['other.diff', 'other.ts']]);
    expect(resolveOriginalPath('src__tests__foo.diff', manifest)).toBe(
      'src/tests/foo',
    );
  });

  it('parseDiffManifest returns null for a missing file', async () => {
    expect(
      await parseDiffManifest('/nonexistent/path/diff-manifest.txt'),
    ).toBeNull();
  });

  it('parseDiffManifest parses tab-separated lines into a Map', async () => {
    const os = await import('node:os');
    const nodeFs = await import('node:fs');
    const pathMod = (await import('node:path')).default;
    const manifestPath = pathMod.join(
      os.tmpdir(),
      `test-manifest-${Date.now()}.txt`,
    );
    const TAB = String.fromCharCode(9);
    const NL = String.fromCharCode(10);
    const lines = [
      'src__tests__foo.test.ts.diff' + TAB + 'src/__tests__/foo.test.ts',
      'packages__cli__index.ts.diff' + TAB + 'packages/cli/index.ts',
      '',
      'malformed-line-without-tab',
    ];
    await nodeFs.promises.writeFile(manifestPath, lines.join(NL), 'utf8');
    try {
      const manifest = await parseDiffManifest(manifestPath);
      expect(manifest).not.toBeNull();
      expect(manifest.get('src__tests__foo.test.ts.diff')).toBe(
        'src/__tests__/foo.test.ts',
      );
      expect(manifest.get('packages__cli__index.ts.diff')).toBe(
        'packages/cli/index.ts',
      );
    } finally {
      await nodeFs.promises
        .unlink(manifestPath)
        .catch((err) => console.error('cleanup:', err.message));
    }
  });
});

describe('gateSequenceDiagram', () => {
  it('returns true for multi-package cross-layer changes', () => {
    expect(
      gateSequenceDiagram(
        [
          { layer: 'api', files: ['a.ts'], summary: 'api' },
          { layer: 'core', files: ['b.ts'], summary: 'core' },
        ],
        ['packages/api/a.ts', 'packages/core/b.ts'],
      ),
    ).toBe(true);
  });

  it('returns false for single-package changes', () => {
    expect(
      gateSequenceDiagram(
        [{ layer: 'utils', files: ['a.ts'], summary: 'util' }],
        ['packages/tools/a.ts'],
      ),
    ).toBe(false);
  });

  it('returns false for docs-only changes', () => {
    expect(
      gateSequenceDiagram(
        [{ layer: 'docs', files: ['README.md'], summary: 'docs' }],
        ['docs/README.md'],
      ),
    ).toBe(false);
  });

  it('returns true when themes include recognized runtime layers even in one package', () => {
    expect(
      gateSequenceDiagram(
        [
          { layer: 'provider', files: ['a.ts'], summary: 'provider' },
          { layer: 'server', files: ['b.ts'], summary: 'server' },
        ],
        ['src/a.ts', 'src/b.ts'],
      ),
    ).toBe(true);
  });
});

describe('integration: renderWalkthroughComment with realistic inputs', () => {
  it('produces a well-formed comment with all sections', () => {
    const comment = renderWalkthroughComment({
      releaseNotes: [
        '## Release Notes',
        '',
        '### New Features',
        '- Walkthrough pipeline replaces bug-finding review',
        '',
        '### Tests',
        '- Added 50 behavioral tests for pure functions',
      ].join('\n'),
      walkthrough:
        'This PR transforms the PR review workflow from a bug-finding reviewer into a walkthrough/summary commenter. Before, it produced a Ready/Needs-Work verdict. After, it produces a CodeRabbit-style top-of-comment with release notes, walkthrough, changes tables, and pre-merge checks.',
      themes: [
        {
          layer: 'scripts',
          files: ['scripts/pr-review-walkthrough.mjs'],
          summary: 'New orchestrator module',
        },
        {
          layer: 'tests',
          files: ['scripts/tests/pr-review-walkthrough.test.js'],
          summary: 'Behavioral tests',
        },
        {
          layer: 'ci',
          files: ['.github/workflows/pr-review.yml'],
          summary: 'Workflow repurposed',
        },
      ],
      sequenceDiagram:
        '```mermaid\nsequenceDiagram\n  participant WF as Workflow\n  participant ORC as Orchestrator\n  WF->>ORC: node scripts/pr-review-walkthrough.mjs\n  ORC-->>WF: review/walkthrough.md\n```',
      magnitude: computeMagnitude({
        additions: 800,
        deletions: 400,
        changedFiles: 4,
        packageCount: 1,
        criteriaCount: 8,
      }),
      related: '- #2260 related: ocr workflow\n- #2256 planner issue',
      preMergeChecks: {
        title: { ok: true, note: 'Title is descriptive' },
        description: { ok: true, note: 'All template sections present' },
        linked_issues: {
          ok: true,
          note: 'Fulfills all 8 acceptance criteria of #2261',
        },
        out_of_scope: { note: 'No new secrets introduced' },
      },
    });
    expect(comment.startsWith('<!-- llxprt-walkthrough -->')).toBe(true);
    expect(comment).toContain('# Walkthrough');
    expect(comment).toContain('Release Notes');
    expect(comment).toContain('New Features');
    expect(comment).toContain('Changes');
    expect(comment).toContain('scripts/pr-review-walkthrough.mjs');
    expect(comment).toContain('sequenceDiagram');
    expect(comment).toContain('Magnitude');
    expect(comment).toContain('Related');
    expect(comment).toContain('#2260');
    expect(comment).toContain('Pre-merge');
    expect(comment).toContain('#2256');
    expect(comment).toMatch(/Planner issue: #\d+/);
  });
});
