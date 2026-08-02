/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  computeMagnitude,
  gateSequenceDiagram,
  isRetryableLlxprtError,
  parseDiffManifest,
  renderWalkthroughComment,
  resolveOriginalPath,
  sanitizeErrorMessage,
  sanitizeSequenceDiagram,
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

describe('sanitizeSequenceDiagram', () => {
  const fence = '```';

  function brokenDiagramFromPr2938(): string {
    return `${fence}mermaid
sequenceDiagram
  participant User
  participant CLI as ExtensionSettingsStorage / CLI
  participant Auth as KeyringTokenStore
  participant Tools as ToolKeyStorage
  participant Store as SecureStore
  participant Identity as RuntimeIdentity
  participant Adapter as DefaultKeyringAdapter

  User->>CLI: Save/load sensitive extension settings
  User->>Auth: Save/get/remove OAuth token
  User->>Tools: Save/get/delete tool API key

  par Storage entry checks
    CLI->>Store: set() / get() / delete() / list()
    Auth->>Store: set() / get() / delete() / list()
    Tools->>Store: set() / get() / delete()
  end

  Store->>Identity: detect unlinked/runtime-replaced state

  alt Runtime executable is unlinked
    Identity-->>Store: runtime replaced detected
    Store-->>CLI: throw RUNTIME_REPLACED
    Store-->>Auth: throw RUNTIME_REPLACED
    Store-->>Tools: throw RUNTIME_REPLACED

    CLI->>CLI: rethrow instead of log-and-continue
    Auth->>Auth: propagate terminal error; no silent fallback
    Tools->>Tools: rethrow; block encrypted-file fallback
  else Runtime is intact
    Store->>Adapter: native keyring operation
    Adapter-->>Store: credential result
    Store-->>CLI: success
    Store-->>Auth: success
    Store-->>Tools: success
  end
${fence}`;
  }

  it('re-encodes bare semicolons in message labels as the #59; entity (PR #2938 regression)', () => {
    const result = sanitizeSequenceDiagram(brokenDiagramFromPr2938());
    // The offending labels keep their meaning but no longer carry a bare
    // statement separator.
    expect(result).toContain(
      'Auth->>Auth: propagate terminal error#59; no silent fallback',
    );
    expect(result).toContain(
      'Tools->>Tools: rethrow#59; block encrypted-file fallback',
    );
    expect(result).not.toContain('error; no silent');
    expect(result).not.toContain('rethrow; block');
    // No message/Note line retains a bare `;` (every remaining `;` must sit
    // inside a Mermaid entity escape such as `#59;`).
    const bareSemicolon = result.split('\n').filter((line) => {
      if (!line.includes(':')) {
        return false;
      }
      return line
        .replace(/&[a-zA-Z][a-zA-Z0-9]*;|#[a-zA-Z0-9]+;/g, '')
        .includes(';');
    });
    expect(bareSemicolon).toEqual([]);
    // Structure and slash-bearing aliases are preserved untouched.
    expect(result).toContain(
      'participant CLI as ExtensionSettingsStorage / CLI',
    );
    expect(result).toContain('par Storage entry checks');
    expect(result).toContain('alt Runtime executable is unlinked');
    // Output stays a fenced mermaid block.
    expect(result.startsWith(`${fence}mermaid\n`)).toBe(true);
    expect(result.endsWith(`\n${fence}`)).toBe(true);
  });

  it('returns an empty string for empty or whitespace-only input', () => {
    expect(sanitizeSequenceDiagram('')).toBe('');
    expect(sanitizeSequenceDiagram('   \n  ')).toBe('');
  });

  it('drops a diagram that is not a sequenceDiagram', () => {
    const graph = `${fence}mermaid\ngraph TD\n  A-->B\n${fence}`;
    expect(sanitizeSequenceDiagram(graph)).toBe('');
  });

  it('preserves a valid diagram that contains no reserved characters', () => {
    const clean = `${fence}mermaid\nsequenceDiagram\n  A->>B: hello world\n${fence}`;
    expect(sanitizeSequenceDiagram(clean)).toBe(clean);
  });

  it('wraps an unfenced sequenceDiagram in fences', () => {
    const result = sanitizeSequenceDiagram('sequenceDiagram\n  A->>B: hi');
    expect(result.startsWith(`${fence}mermaid\n`)).toBe(true);
    expect(result.endsWith(`\n${fence}`)).toBe(true);
    expect(result).toContain('A->>B: hi');
  });

  it('only neutralizes semicolons in message labels, leaving structure intact', () => {
    const input = `${fence}mermaid
sequenceDiagram
  participant P
  par checks here
  A->>B: x; y
${fence}`;
    const result = sanitizeSequenceDiagram(input);
    expect(result).toContain('  participant P');
    expect(result).toContain('  par checks here');
    expect(result).toContain('A->>B: x#59; y');
    expect(result).not.toContain('x; y');
  });

  it('drops diagrams whose directive is an invalid lookalike', () => {
    for (const directive of [
      'sequenceDiagram-v2',
      'sequenceDiagram:',
      'sequenceDiagram()',
      'sequenceDiagramExtra',
    ]) {
      expect(
        sanitizeSequenceDiagram(`${directive}
  A->>B: x; y`),
      ).toBe('');
    }
  });

  it('preserves existing Mermaid entity escapes and only escapes bare semicolons', () => {
    const input = `${fence}mermaid
sequenceDiagram
  A->>B: love #9829; and use #59; here; ok
${fence}`;
    const result = sanitizeSequenceDiagram(input);
    // The two pre-existing entities stay; only the trailing bare `;` is escaped.
    expect(result).toContain('love #9829; and use #59; here#59; ok');
    expect(result).not.toContain('here; ok');
  });

  it('leaves inline participant configuration containing a semicolon untouched', () => {
    const input = `${fence}mermaid
sequenceDiagram
  participant API@{ "type": "boundary", "alias": "Public; API" }
  API->>API: check; done
${fence}`;
    const result = sanitizeSequenceDiagram(input);
    // The inline config (which carries a colon in its JSON) is preserved
    // verbatim, including its semicolon; the arrow message is re-encoded.
    expect(result).toContain(
      'participant API@{ "type": "boundary", "alias": "Public; API" }',
    );
    expect(result).toContain('API->>API: check#59; done');
    expect(result).not.toContain('check; done');
  });

  it('re-encodes semicolons in Note labels and preserves nested colons', () => {
    const input = `${fence}mermaid
sequenceDiagram
  A->>B: error: code 42; retry
  Note over A,B: first; second
${fence}`;
    const result = sanitizeSequenceDiagram(input);
    // Nested colon is retained; the bare semicolons are escaped.
    expect(result).toContain('A->>B: error: code 42#59; retry');
    expect(result).toContain('Note over A,B: first#59; second');
    expect(result).not.toContain('code 42; retry');
    expect(result).not.toContain('first; second');
  });
  it('treats Note directive keywords as case-insensitive (NOTE, NoTe)', () => {
    const input = `${fence}mermaid
sequenceDiagram
  NOTE over A,B: first; second
  NoTe over A,B: third; fourth
${fence}`;
    const result = sanitizeSequenceDiagram(input);
    expect(result).toContain('first#59; second');
    expect(result).toContain('third#59; fourth');
    expect(result).not.toContain('first; second');
    expect(result).not.toContain('third; fourth');
  });
  it('escapes semicolons in loop/alt/critical/break block-header descriptions', () => {
    const input = `${fence}mermaid
sequenceDiagram
  loop check every 30s; retry
    A->>B: ping
  alt success; proceed
    A->>B: ok
  end
  CRITICAL handle; recover
    A->>B: rescue
  end
  break on error; stop
    A->>B: abort
  end
${fence}`;
    const result = sanitizeSequenceDiagram(input);
    expect(result).toContain('loop check every 30s#59; retry');
    expect(result).toContain('alt success#59; proceed');
    expect(result).toContain('CRITICAL handle#59; recover');
    expect(result).toContain('break on error#59; stop');
    expect(result).not.toContain('30s; retry');
    expect(result).not.toContain('success; proceed');
    expect(result).not.toContain('handle; recover');
    expect(result).not.toContain('error; stop');
  });
  it('escapes a bare semicolon in a block-header description that also contains a colon', () => {
    // A block-header line whose free-text description includes a colon must not
    // be misread as a message line and bypass escaping (issue surfaced by OCR).
    const input = `${fence}mermaid
sequenceDiagram
  loop while status: pending; retry
    A->>B: tick
  end
${fence}`;
    const result = sanitizeSequenceDiagram(input);
    expect(result).toContain('loop while status: pending#59; retry');
    expect(result).not.toContain('pending; retry');
  });
});
