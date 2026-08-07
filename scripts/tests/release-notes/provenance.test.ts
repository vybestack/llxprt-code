/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { extractSourceFacts } from '../../release-notes/provenance.js';
import type { ChangeEntry, EnrichedRef } from '../../release-notes/types.js';

function makeRef(overrides: Partial<EnrichedRef> = {}): EnrichedRef {
  return {
    number: 42,
    title: 'Faster streaming responses',
    body: 'Users now receive responses without intermittent stalls.',
    labels: ['feature'],
    labelsTruncated: false,
    author: 'alice',
    isPr: false,
    userImpact: null,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<ChangeEntry> = {}): ChangeEntry {
  return {
    id: 'ref:42',
    subject: 'feat: thing',
    hash: 'abc',
    author: 'dev',
    refs: [],
    enriched: [makeRef()],
    category: 'new',
    eligibleForHighlights: true,
    childHashes: [],
    sourceFacts: [],
    ...overrides,
  };
}

describe('extractUserImpact (via extractSourceFacts)', () => {
  it('extracts a clear user-impact sentence', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'Users now experience faster streaming responses.',
          }),
        ],
      }),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.userImpact).toContain('faster streaming responses');
  });

  it('skips issue-template heading boilerplate like "Summary Fixes #2208"', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: '## Summary\nFixes #2208\n\nUsers can now configure streaming.',
          }),
        ],
      }),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.userImpact).toContain('configure streaming');
    // The boilerplate "Fixes #2208" must NOT be the impact.
    expect(facts[0]!.userImpact).not.toContain('Fixes #2208');
  });

  it('skips "Summary:" section label prefix', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'Summary: This is the template summary field.\n\nUsers can now export data.',
          }),
        ],
      }),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.userImpact).toContain('export data');
    expect(facts[0]!.userImpact).not.toContain('template summary field');
  });

  it('skips closing keywords lines (Fixes #N at line start)', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'Fixes #1234\n\nUsers benefit from lower latency.',
          }),
        ],
      }),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.userImpact).toContain('lower latency');
    expect(facts[0]!.userImpact).not.toContain('Fixes #1234');
  });

  it('skips verification/checklist boilerplate until another heading', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: [
              '## Verification',
              'I ran the test suite and it passed.',
              '',
              '## Impact',
              'Users can now use the new feature.',
            ].join('\n'),
          }),
        ],
      }),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.userImpact).toContain('new feature');
  });

  it('skips checklist items ([ ] / [x])', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: [
              '[x] I have tested this change',
              '[ ] I have updated the docs',
              '',
              'Users see a cleaner interface.',
            ].join('\n'),
          }),
        ],
      }),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.userImpact).toContain('cleaner interface');
  });

  it('skips mechanism-only sentences', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'This is an internal refactor for code quality.',
          }),
        ],
      }),
    );
    expect(facts).toEqual([]);
  });

  it('skips mechanism-only line and uses the next defensible line', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: [
              'This adds test coverage for the module.',
              'Users can now configure providers at runtime.',
            ].join('\n'),
          }),
        ],
      }),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.userImpact).toContain('configure providers at runtime');
  });

  it('removes code blocks before parsing', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: [
              '```js',
              'const x = dangerous.statement();',
              '```',
              '',
              'Users can now pin a specific version.',
            ].join('\n'),
          }),
        ],
      }),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.userImpact).toContain('pin a specific version');
    expect(facts[0]!.userImpact).not.toContain('dangerous');
  });

  it('returns empty when body is entirely boilerplate', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: '## Summary\nFixes #2208',
          }),
        ],
      }),
    );
    expect(facts).toEqual([]);
  });

  it('returns empty when body is empty', () => {
    const facts = extractSourceFacts(
      makeEntry({ enriched: [makeRef({ body: '' })] }),
    );
    expect(facts).toEqual([]);
  });

  it('handles a real-world issue template with mixed boilerplate and impact', () => {
    const realTemplateBody = [
      '## Summary',
      'Fixes #2208',
      '',
      'Users can now connect Ollama models and run inference locally without external API keys.',
      '',
      '## Motivation',
      'Local model support has been requested by many users.',
      '',
      '## Checklist',
      '- [x] Tests added',
      '- [x] Docs updated',
    ].join('\n');
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            title: 'Add Ollama provider support',
            body: realTemplateBody,
          }),
        ],
      }),
    );
    expect(facts).toHaveLength(1);
    // The first defensible impact line (outside boilerplate sections) is used.
    expect(facts[0]!.userImpact).toContain('Ollama models');
    expect(facts[0]!.userImpact).not.toContain('Fixes #2208');
    expect(facts[0]!.userImpact).not.toContain('Checklist');
  });

  it('does not accept a single-word heading as impact', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [makeRef({ body: '# Summary\n# Description' })],
      }),
    );
    expect(facts).toEqual([]);
  });

  it('uses user-facing evidence from an Expected section', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: '## Expected\nUsers can resume interrupted sessions safely.',
          }),
        ],
      }),
    );
    expect(facts[0]?.userImpact).toBe(
      'Users can resume interrupted sessions safely.',
    );
  });

  it('skips "Steps to reproduce" section', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: [
              '## Steps to reproduce',
              '1. Open the app',
              '2. Click the button',
              '',
              '## Impact',
              'Users now get a confirmation dialog.',
            ].join('\n'),
          }),
        ],
      }),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.userImpact).toContain('confirmation dialog');
  });

  it('does not end a hard-suppress boilerplate section on a blank line (only on a heading)', () => {
    // Verification heading starts a hard-suppress section. A blank line must
    // NOT end it — only another heading does. The prose after the blank line
    // is still inside Verification and must be skipped.
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: [
              '## Verification',
              'I ran the test suite and it passed.',
              '',
              'This looks like user impact but is inside the verification section.',
              '',
              '## Result',
              'Users benefit from faster startup.',
            ].join('\n'),
          }),
        ],
      }),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.userImpact).toContain('faster startup');
    // Must not pick up Verification-section prose.
    expect(facts[0]!.userImpact).not.toContain('verification section');
  });

  it('suppresses an implementation provenance section until another heading', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: [
              '## Implementation',
              'Refactored the handler to use a state machine.',
              'Added comprehensive test coverage.',
              '',
              '## Result',
              'Users experience a 3x faster response time.',
            ].join('\n'),
          }),
        ],
      }),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.userImpact).toContain('faster response time');
    expect(facts[0]!.userImpact).not.toContain('state machine');
  });

  it('suppresses a reproduction section until another heading', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: [
              '## Reproduction',
              'Run the CLI with --verbose to see the error.',
              '',
              '## Fix',
              'Users no longer see spurious error messages.',
            ].join('\n'),
          }),
        ],
      }),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.userImpact).toContain('spurious error messages');
    expect(facts[0]!.userImpact).not.toContain('--verbose');
  });

  it('never selects test/mechanism prose even outside boilerplate sections', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'This adds test coverage for the streaming module.',
          }),
        ],
      }),
    );
    expect(facts).toEqual([]);
  });

  it('suppresses a tilde-fenced code block and recovers subsequent prose', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: [
              '~~~ruby',
              'Users can now run this dangerous command.',
              '~~~',
              '',
              'Users benefit from lower latency.',
            ].join('\n'),
          }),
        ],
      }),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.userImpact).toContain('lower latency');
    expect(facts[0]!.userImpact).not.toContain('dangerous');
  });

  it('suppresses content after an unterminated fence through EOF', () => {
    for (const opener of ['```', '~~~js']) {
      const facts = extractSourceFacts(
        makeEntry({
          enriched: [
            makeRef({
              body: [
                opener,
                'Users can now execute malicious code.',
                'Users no longer see any errors.',
              ].join('\n'),
            }),
          ],
        }),
      );
      expect(facts).toEqual([]);
    }
  });

  it('handles interleaved backtick and tilde fences independently', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: [
              '```',
              'Users dangerous one.',
              '```',
              '',
              'Users can now pin a specific model.',
              '',
              '~~~',
              'Users dangerous two.',
              '~~~',
            ].join('\n'),
          }),
        ],
      }),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.userImpact).toContain('pin a specific model');
  });

  it('requires the closing fence to match the opening character and length', () => {
    // A tilde fence is not closed by backticks.
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: [
              '~~~',
              'Users dangerous content stays inside.',
              '```',
              '',
              'Users benefit from improved reliability.',
            ].join('\n'),
          }),
        ],
      }),
    );
    expect(facts).toEqual([]);
  });

  it.each([
    ['blockquote', '> ~~~', '> Users can now run dangerous code.', '> ~~~'],
    ['list item', '- ~~~', '  Users can now run dangerous code.', '  ~~~'],
  ])('suppresses a fence nested in a %s', (_name, open, content, close) => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: [
              open,
              content,
              close,
              '',
              'Users benefit from lower latency.',
            ].join('\n'),
          }),
        ],
      }),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.userImpact).toContain('lower latency');
    expect(facts[0]!.userImpact).not.toContain('dangerous');
  });

  it('handles up to three spaces of indentation before a fence', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: [
              '   ```',
              '   Users can now do something dangerous inside indented code.',
              '   ```',
              '',
              'Users see a cleaner interface.',
            ].join('\n'),
          }),
        ],
      }),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.userImpact).toContain('cleaner interface');
    expect(facts[0]!.userImpact).not.toContain('dangerous');
  });
});

describe('extractUserImpact — word-boundary adversarial inputs (no substring collisions)', () => {
  // These tests guard against the `\b` word-boundary contract: the
  // USER_IMPACT_SIGNALS list contains "fix", "new", "option", "user",
  // etc. Without word boundaries, "prefix" would match "fix", "renew"
  // would match "new", "optional" would match "option", and "username"
  // would match "user" — letting mechanism-only prose masquerade as
  // user impact. Each adversarial sentence below MUST be rejected.
  it('rejects "prefix" (fix must not match prefix)', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'Updated the prefix matcher to avoid false positives in parsing.',
          }),
        ],
      }),
    );
    expect(facts).toEqual([]);
  });

  it('rejects "renew" (new must not match renew)', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'The token renew logic was refactored for internal clarity.',
          }),
        ],
      }),
    );
    expect(facts).toEqual([]);
  });

  it('rejects "username" (user must not match username)', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'The username field was validated against the internal schema.',
          }),
        ],
      }),
    );
    expect(facts).toEqual([]);
  });

  it('rejects "optional" (option must not match optional)', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'Made the optional configuration field nullable in the internal model.',
          }),
        ],
      }),
    );
    expect(facts).toEqual([]);
  });

  it('accepts a genuine "fix" sentence (boundary-anchored)', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'This fix resolves a crash that users encountered on startup.',
          }),
        ],
      }),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.userImpact).toContain('fix resolves a crash');
  });

  it('accepts a genuine "new" sentence (boundary-anchored)', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'A new command lets users inspect the session history.',
          }),
        ],
      }),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.userImpact).toContain('new command');
  });

  it('accepts a genuine "option" sentence (boundary-anchored)', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'Users can now pass an option to control the output format.',
          }),
        ],
      }),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.userImpact).toContain('option to control');
  });

  it('accepts a genuine "user" sentence (boundary-anchored)', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'Each user can now pin a specific model for inference.',
          }),
        ],
      }),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.userImpact).toContain('user can now pin');
  });
});

describe('extractSourceFacts — observable user-impact requirement', () => {
  // A source fact must always carry a non-empty userImpact string; the
  // observable output contract is that every emitted SourceFact has a
  // defensible, non-empty userImpact that survives sanitization.
  it('every emitted fact has a non-empty userImpact', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'Users can now export conversation history to a file.',
          }),
          makeRef({
            number: 43,
            body: 'Users can now import conversation history from a file.',
          }),
        ],
      }),
    );
    expect(facts.length).toBeGreaterThan(0);
    for (const fact of facts) {
      expect(fact.userImpact.length).toBeGreaterThan(0);
      expect(fact.userImpact.trim()).toBe(fact.userImpact);
    }
  });

  it('emits zero facts when no ref carries defensible impact', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({ body: 'Internal refactoring for clarity.' }),
          makeRef({ number: 43, body: '' }),
        ],
      }),
    );
    expect(facts).toEqual([]);
  });

  it('emits one fact per ref that carries defensible impact', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [
          makeRef({
            body: 'Users can now export conversation history to a file.',
          }),
          makeRef({
            number: 43,
            body: 'Users can now import conversation history from a file.',
          }),
          makeRef({ number: 44, body: 'Internal cleanup only.' }),
        ],
      }),
    );
    expect(facts).toHaveLength(2);
    expect(facts[0]!.sourceId).toBe('ref:42');
    expect(facts[1]!.sourceId).toBe('ref:42');
    expect(facts[0]!.userImpact).toContain('export');
    expect(facts[1]!.userImpact).toContain('import');
  });
});
