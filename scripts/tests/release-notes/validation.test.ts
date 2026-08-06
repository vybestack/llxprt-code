/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  buildDeterministicFallback,
  entriesToCategorizedBullets,
  validateHighlights,
  validateLlmOutput,
} from '../../release-notes/validation.js';
import {
  buildHighlightsFromSelection,
  extractSourceFacts,
} from '../../release-notes/provenance.js';
import type { ChangeEntry, EnrichedRef } from '../../release-notes/types.js';
import { renderReleaseNotes } from '../../release-notes/rendering.js';

function makeRef(overrides: Partial<EnrichedRef> = {}): EnrichedRef {
  return {
    number: 42,
    title: 'Faster streaming responses',
    body: 'Users now receive responses without intermittent stalls.',
    labels: ['bug'],
    labelsTruncated: false,
    author: 'alice',
    isPr: false,
    userImpact: null,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<ChangeEntry> = {}): ChangeEntry {
  const entry = {
    id: 'ref:42',
    subject: 'feat: mechanism details',
    hash: 'abcdef0',
    author: 'dev',
    refs: [],
    enriched: [makeRef()],
    category: 'new' as const,
    eligibleForHighlights: true,
    childHashes: [],
    sourceFacts: [],
    ...overrides,
  };
  return {
    ...entry,
    sourceFacts: overrides.sourceFacts ?? extractSourceFacts(entry),
  };
}

function sourceIdsOutput(sourceIds: readonly string[]): string {
  return JSON.stringify({ sourceIds });
}

describe('validateLlmOutput', () => {
  it('accepts a valid sourceIds array', () => {
    expect(
      validateLlmOutput(sourceIdsOutput(['ref:42', 'ref:43'])),
    ).not.toBeNull();
    expect(
      validateLlmOutput(sourceIdsOutput(['ref:42', 'ref:43']))?.sourceIds,
    ).toEqual(['ref:42', 'ref:43']);
  });

  it('accepts an empty sourceIds array', () => {
    expect(validateLlmOutput(sourceIdsOutput([]))?.sourceIds).toEqual([]);
  });

  it('rejects legacy free-form highlights array (no sourceIds field)', () => {
    expect(
      validateLlmOutput(
        JSON.stringify({
          highlights: [
            { sourceId: 'ref:42', text: 'Streaming no longer stalls' },
          ],
        }),
      ),
    ).toBeNull();
  });

  it.each([
    '{not json',
    JSON.stringify({ new: [] }),
    JSON.stringify({ sourceIds: 'ref:42' }),
    JSON.stringify({ sourceIds: [123] }),
  ])('rejects malformed or invalid JSON: %s', (raw) => {
    expect(validateLlmOutput(raw)).toBeNull();
  });

  it('accepts fenced JSON with sourceIds', () => {
    expect(
      validateLlmOutput(`\`\`\`json\n${sourceIdsOutput(['ref:42'])}\n\`\`\``),
    ).not.toBeNull();
  });
});

describe('validateHighlights', () => {
  it('accepts eligible source IDs and returns the validated selection', () => {
    expect(validateHighlights(['ref:42'], [makeEntry()])).toEqual(['ref:42']);
  });

  it('rejects unknown, ineligible, or duplicate source IDs', () => {
    expect(validateHighlights(['ref:99'], [makeEntry()])).toBeNull();
    expect(
      validateHighlights(
        ['ref:42'],
        [makeEntry({ eligibleForHighlights: false })],
      ),
    ).toBeNull();
    expect(validateHighlights(['ref:42', 'ref:42'], [makeEntry()])).toBeNull();
  });

  it('requires three source IDs when at least three eligible entries exist', () => {
    const entries = [1, 2, 3].map((number) =>
      makeEntry({ id: `ref:${number}` }),
    );
    expect(validateHighlights(['ref:1'], entries)).toBeNull();
  });

  it('builds deterministic highlight prose from validated source facts', () => {
    const entries = [makeEntry()];
    const validated = validateHighlights(['ref:42'], entries);
    expect(validated).not.toBeNull();
    const highlights = buildHighlightsFromSelection(validated!, entries);
    expect(highlights).toEqual([
      'Faster streaming responses: Users now receive responses without intermittent stalls.',
    ]);
  });

  it('omits highlights when the selected entry has only mechanism-only impact', () => {
    const entries = [
      makeEntry({
        enriched: [makeRef({ body: 'Internal refactor for code quality.' })],
      }),
    ];
    const validated = validateHighlights(['ref:42'], entries);
    // Mechanism-only impact means no eligible IDs → selection is invalid.
    expect(validated).toBeNull();
  });

  it('omits highlights when the selected entry has no defensible sentence', () => {
    const entries = [makeEntry({ enriched: [makeRef({ body: '' })] })];
    const validated = validateHighlights(['ref:42'], entries);
    expect(validated).toBeNull();
  });
});

describe('extractSourceFacts', () => {
  it('produces defensible facts from enriched user impact', () => {
    const facts = extractSourceFacts(makeEntry());
    expect(facts).toHaveLength(1);
    expect(facts[0]!.sourceId).toBe('ref:42');
    expect(facts[0]!.title).toBe('Faster streaming responses');
    expect(facts[0]!.userImpact).toContain(
      'Users now receive responses without intermittent stalls',
    );
  });

  it('returns empty when the body is mechanism-only', () => {
    const facts = extractSourceFacts(
      makeEntry({
        enriched: [makeRef({ body: 'Internal refactor for code quality.' })],
      }),
    );
    expect(facts).toEqual([]);
  });

  it('returns empty when the body has no defensible sentence', () => {
    const facts = extractSourceFacts(
      makeEntry({ enriched: [makeRef({ body: '' })] }),
    );
    expect(facts).toEqual([]);
  });
});

describe('deterministic rendering data', () => {
  it('builds user-impact fallback highlights from enriched title and body', () => {
    const result = buildDeterministicFallback([makeEntry()]);
    expect(result.highlights).toEqual([
      'Faster streaming responses: Users now receive responses without intermittent stalls.',
    ]);
    expect(result.highlights[0]).not.toContain('feat: mechanism');
  });

  it('omits fallback highlights without enriched impact', () => {
    const result = buildDeterministicFallback([
      makeEntry({ enriched: [makeRef({ body: '' })] }),
      makeEntry({
        id: 'ref:99',
        eligibleForHighlights: false,
        enriched: [makeRef({ body: 'Internal implementation changed.' })],
      }),
    ]);
    expect(result.highlights).toEqual([]);
  });

  it('uses enriched titles in categorized details and omits internal entries', () => {
    const bullets = entriesToCategorizedBullets([
      makeEntry(),
      makeEntry({
        id: 'commit:2',
        category: 'fix',
        enriched: [makeRef({ title: 'Crash-free startup' })],
      }),
      makeEntry({
        id: 'commit:3',
        category: 'internal',
        enriched: [
          makeRef({ number: 3, title: 'Internal change', labels: [] }),
        ],
      }),
    ]);
    expect(bullets.new).toEqual(['Faster streaming responses']);
    expect(bullets.fixes).toEqual(['Crash-free startup']);
    expect(bullets.improvements).toEqual([]);
  });

  it('omits internal-labeled entries from prominent categories (not just highlights)', () => {
    // A feat: commit with a Code Quality label must be demoted from New.
    const bullets = entriesToCategorizedBullets([
      makeEntry({
        category: 'new',
        enriched: [makeRef({ labels: ['Code Quality', 'Modularization'] })],
      }),
      makeEntry({
        id: 'ref:99',
        category: 'fix',
        enriched: [makeRef({ number: 99, labels: ['bug'] })],
      }),
    ]);
    expect(bullets.new).toEqual([]);
    expect(bullets.fixes).toEqual(['Faster streaming responses']);
  });
});

describe('deriveEffectiveCategory — promoting-label categorized rendering', () => {
  it('promotes an internal-prefix commit tagged feature into New', () => {
    const bullets = entriesToCategorizedBullets([
      makeEntry({
        subject: 'refactor: internal cleanup',
        category: 'internal',
        enriched: [makeRef({ labels: ['feature'] })],
      }),
    ]);
    expect(bullets.new).toEqual(['Faster streaming responses']);
    expect(bullets.improvements).toEqual([]);
  });

  it('promotes an internal-prefix commit tagged bug into Fixes', () => {
    const bullets = entriesToCategorizedBullets([
      makeEntry({
        subject: 'refactor: internal cleanup',
        category: 'internal',
        enriched: [makeRef({ labels: ['bug'] })],
      }),
    ]);
    expect(bullets.fixes).toEqual(['Faster streaming responses']);
    expect(bullets.new).toEqual([]);
  });

  it('promotes an internal-prefix commit tagged ux into Improvements', () => {
    const bullets = entriesToCategorizedBullets([
      makeEntry({
        subject: 'refactor: internal cleanup',
        category: 'internal',
        enriched: [makeRef({ labels: ['ux'] })],
      }),
    ]);
    expect(bullets.improvements).toEqual(['Faster streaming responses']);
    expect(bullets.new).toEqual([]);
  });

  it('internal label overrides promoting label in categorized rendering', () => {
    const bullets = entriesToCategorizedBullets([
      makeEntry({
        category: 'new',
        enriched: [makeRef({ labels: ['feature', 'tech-debt'] })],
      }),
    ]);
    expect(bullets.new).toEqual([]);
    expect(bullets.improvements).toEqual([]);
    expect(bullets.fixes).toEqual([]);
    expect(bullets.breaking).toEqual([]);
  });

  it('preserves original category when promoting label is lower-signal', () => {
    // A feat commit with a 'bug' promoting label stays in New, not demoted
    // to Fixes.
    const bullets = entriesToCategorizedBullets([
      makeEntry({
        subject: 'feat: add streaming',
        category: 'new',
        enriched: [makeRef({ labels: ['bug'] })],
      }),
    ]);
    expect(bullets.new).toEqual(['Faster streaming responses']);
    expect(bullets.fixes).toEqual([]);
  });

  it('renders promoted category in full release notes output', () => {
    const entries: ChangeEntry[] = [
      makeEntry({
        subject: 'refactor: internal cleanup',
        category: 'internal',
        enriched: [makeRef({ labels: ['feature'] })],
      }),
    ];
    const fallback = buildDeterministicFallback(entries);
    const md = renderReleaseNotes({
      releaseTag: 'v1.0.0',
      highlights: fallback.highlights,
      categorized: fallback.categorized,
      allChanges: [],
      contributors: [],
      lastTag: 'v0.9.0',
      isFirstRelease: false,
      comparisonUrl: null,
      curatedHeadline: null,
    });
    expect(md).toContain('#### New');
    expect(md).toContain('Faster streaming responses');
    expect(md).not.toContain('#### Improvements');
  });

  it('renders demoted internal-label entry in no prominent section', () => {
    const entries: ChangeEntry[] = [
      makeEntry({
        subject: 'feat: add streaming',
        category: 'new',
        enriched: [makeRef({ labels: ['feature', 'cleanup'] })],
      }),
    ];
    const fallback = buildDeterministicFallback(entries);
    const md = renderReleaseNotes({
      releaseTag: 'v1.0.0',
      highlights: fallback.highlights,
      categorized: fallback.categorized,
      allChanges: [],
      contributors: [],
      lastTag: 'v0.9.0',
      isFirstRelease: false,
      comparisonUrl: null,
      curatedHeadline: null,
    });
    expect(md).not.toContain('#### New');
    expect(md).not.toContain('#### Improvements');
    expect(md).not.toContain('#### Fixes');
  });

  it('processes multiple entries with mixed labels in full pipeline', async () => {
    const { buildChangeEntries } = await import(
      '../../release-notes/processing.js'
    );
    const commits = [
      {
        hash: 'aaa1111',
        subject: 'refactor: internal cleanup (#10)',
        author: 'dev',
        isMerge: false,
        parents: [] as readonly string[],
      },
      {
        hash: 'bbb2222',
        subject: 'chore: reorganize tooling (#20)',
        author: 'dev',
        isMerge: false,
        parents: [] as readonly string[],
      },
    ];
    const fakeGh = {
      async fetchRefs() {
        return new Map<number, EnrichedRef>([
          [
            10,
            makeRef({
              number: 10,
              title: 'Internal cleanup with feature tag',
              labels: ['feature'],
              isPr: true,
            }),
          ],
          [
            20,
            makeRef({
              number: 20,
              title: 'Update dependencies',
              labels: ['tech-debt'],
              isPr: true,
            }),
          ],
        ]);
      },
    };
    const entries = await buildChangeEntries(commits, fakeGh);
    // Entry #10: internal-prefix commit with feature promoting label → new
    const entry10 = entries.find((e) => e.id === 'ref:10')!;
    expect(entry10.category).toBe('new');
    expect(entry10.eligibleForHighlights).toBe(true);
    // Entry #20: chore-prefix commit with tech-debt internal label → internal
    const entry20 = entries.find((e) => e.id === 'ref:20')!;
    expect(entry20.category).toBe('internal');
    expect(entry20.eligibleForHighlights).toBe(false);
  });
});
