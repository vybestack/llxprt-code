/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  computeMagnitude,
  gateSequenceDiagram,
  isRetryableLlxprtError,
  parseDiffManifest,
  renderWalkthroughComment,
  resolveOriginalPath,
  sanitizeErrorMessage,
} from '../pr-review-walkthrough.ts';

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
    Object.defineProperty(error, 'code', { value: 'ENOENT', enumerable: true });
    Object.defineProperty(error, 'exitCode', { value: 127, enumerable: true });
    const sanitized = sanitizeErrorMessage(error);
    const sanitizedCode = Object.getOwnPropertyDescriptor(sanitized, 'code');
    const sanitizedExit = Object.getOwnPropertyDescriptor(
      sanitized,
      'exitCode',
    );
    expect(sanitizedCode?.value).toBe('ENOENT');
    expect(sanitizedExit?.value).toBe(127);
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

  it('redacts an equals-format key value', () => {
    const sanitized = sanitizeErrorMessage(
      new Error('cmd --key=equals-secret --prompt hello'),
    );
    expect(sanitized.message).toContain('--key=[REDACTED]');
    expect(sanitized.message).not.toContain('equals-secret');
  });

  it('redacts a quoted equals-format key value', () => {
    const sanitized = sanitizeErrorMessage(
      new Error('cmd --key="quoted secret" --prompt hello'),
    );
    expect(sanitized.message).toContain('--key=[REDACTED]');
    expect(sanitized.message).not.toContain('quoted secret');
  });

  it('leaves a trailing --key without a value unchanged', () => {
    const sanitized = sanitizeErrorMessage(new Error('cmd --key'));
    expect(sanitized.message).toBe('cmd --key');
  });

  it('redacts an explicitly supplied literal key value', () => {
    const sanitized = sanitizeErrorMessage(
      new Error('provider echoed literal-secret in stderr'),
      'literal-secret',
    );
    expect(sanitized.message).toContain('[REDACTED]');
    expect(sanitized.message).not.toContain('literal-secret');
  });

  it('preserves the original Error when the supplied secret is empty', () => {
    const error = new Error('provider failure without a secret');
    expect(sanitizeErrorMessage(error, '')).toBe(error);
  });
});

describe('isRetryableLlxprtError', () => {
  it('retries rate limits and transient network failures', () => {
    expect(isRetryableLlxprtError(new Error('HTTP 429 rate limit'))).toBe(true);
    expect(
      isRetryableLlxprtError(
        Object.assign(new Error('reset'), { code: 'ECONNRESET' }),
      ),
    ).toBe(true);
  });

  it('does not retry authentication or missing-binary failures', () => {
    expect(isRetryableLlxprtError(new Error('HTTP 401 unauthorized'))).toBe(
      false,
    );
    expect(
      isRetryableLlxprtError(
        Object.assign(new Error('missing'), { code: 'ENOENT' }),
      ),
    ).toBe(false);
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
      expect(manifest?.get('src__tests__foo.test.ts.diff')).toBe(
        'src/__tests__/foo.test.ts',
      );
      expect(manifest?.get('packages__cli__index.ts.diff')).toBe(
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
          files: ['scripts/pr-review-walkthrough.ts'],
          summary: 'New orchestrator module',
        },
        {
          layer: 'tests',
          files: ['scripts/tests/pr-review-walkthrough.test.ts'],
          summary: 'Behavioral tests',
        },
        {
          layer: 'ci',
          files: ['.github/workflows/pr-review.yml'],
          summary: 'Workflow repurposed',
        },
      ],
      sequenceDiagram:
        '```mermaid\nsequenceDiagram\n  participant WF as Workflow\n  participant ORC as Orchestrator\n  WF->>ORC: bun scripts/pr-review-walkthrough.ts\n  ORC-->>WF: review/walkthrough.md\n```',
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
    expect(comment).toContain('scripts/pr-review-walkthrough.ts');
    expect(comment).toContain('sequenceDiagram');
    expect(comment).toContain('Magnitude');
    expect(comment).toContain('Related');
    expect(comment).toContain('#2260');
    expect(comment).toContain('Pre-merge');
    expect(comment).toContain('#2256');
    expect(comment).toMatch(/Planner issue: #\d+/);
  });
});
