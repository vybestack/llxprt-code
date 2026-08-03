/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Bun-native tests for the Mermaid sequenceDiagram sanitizer and the
// sequenceDiagram prompt hardening added for issue #2944. These run under
// Bun's native test runner (see scripts/bun-test-manifest.ts); vitest skips
// `*.bun.test.ts` files (see scripts/tests/vitest.config.ts).

import { describe, expect, it } from 'bun:test';
import { sanitizeSequenceDiagram } from '../pr-review-walkthrough-parse.ts';
import { buildSynthesisPrompts } from '../pr-review-prompts.ts';

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

describe('buildSynthesisPrompts sequenceDiagram hardening', () => {
  const SAMPLE_PR_CONTEXT = {
    number: 2261,
    title: 'Repurpose PR Review',
    author: 'acoliver',
    body: 'This PR repurposes the reviewer into a walkthrough commenter.',
    baseRefName: 'main',
    headRefName: 'issue2261',
    additions: 120,
    deletions: 30,
    changedFiles: 4,
    commits: 3,
  };

  const context = {
    prContext: SAMPLE_PR_CONTEXT,
    summaries: [
      {
        filePath: 'a.mjs',
        summary: 'adds map function',
        signature: 'map()',
        triage: 'feature',
      },
    ],
    themes: [{ layer: 'core', files: ['a.mjs'], summary: 'logic' }],
    fullIssueBodies: [
      {
        number: 2261,
        title: 'Repurpose',
        body: 'Make it a walkthrough commenter.',
      },
    ],
  };

  it('sequenceDiagram prompt forbids semicolons in labels (Mermaid statement-separator guard)', () => {
    const prompt = buildSynthesisPrompts(context).sequenceDiagram;
    // Belt-and-suspenders alongside the deterministic sanitizer: the prompt
    // itself must steer the model away from the reserved character.
    expect(prompt).toMatch(/semicolon/i);
    expect(prompt).toMatch(/one interaction per line/i);
  });
});
