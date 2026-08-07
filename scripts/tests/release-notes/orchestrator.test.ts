/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { generateReleaseNotes } from '../../release-notes/orchestrator.js';
import type {
  EnrichedRef,
  GhPort,
  LlmPort,
  RawCommit,
} from '../../release-notes/types.js';

function makeCommit(overrides: Partial<RawCommit> = {}): RawCommit {
  return {
    hash: 'abcdef0',
    subject: 'feat: something (#42)',
    author: 'dev',
    isMerge: false,
    parents: [],
    ...overrides,
  };
}

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

function fakeGh(entries: readonly EnrichedRef[]): GhPort {
  return {
    async fetchRefs() {
      return new Map(entries.map((entry) => [entry.number, entry]));
    },
  };
}

function fakeLlm(response: string | Error): LlmPort {
  return {
    async generateHighlights(context) {
      if (response instanceof Error) {
        throw response;
      }
      return response.replace('__CONTEXT__', context);
    },
  };
}

function llmOutput(sourceIds: readonly string[]): string {
  return JSON.stringify({ sourceIds });
}

const baseInput = {
  releaseTag: 'v0.11.0',
  lastTag: 'v0.10.0',
  isFirstRelease: false,
  isNightly: false,
  contributors: ['alice'],
  curatedHeadline: null,
  repository: 'vybestack/llxprt-code',
};

describe('generateReleaseNotes', () => {
  it('renders provenance-validated LLM highlights and stable sections', async () => {
    const md = await generateReleaseNotes({
      ...baseInput,
      rawCommits: [
        makeCommit(),
        makeCommit({ hash: 'bbbbbbb', subject: 'feat: another (#43)' }),
        makeCommit({ hash: 'ccccccc', subject: 'fix: third (#44)' }),
      ],
      ghPort: fakeGh([
        makeRef(),
        makeRef({
          number: 43,
          title: 'Configure a new provider',
          body: 'Users can select the provider in settings.',
        }),
        makeRef({
          number: 44,
          title: 'Crash-free startup',
          body: 'Users no longer experience crashes on startup.',
        }),
      ]),
      llmPort: fakeLlm(llmOutput(['ref:42', 'ref:43', 'ref:44'])),
    });

    expect(md).toContain('### Highlights');
    expect(md).toContain(
      'Faster streaming responses: Users now receive responses without intermittent stalls.',
    );
    expect(md).toContain('Users can select the provider in settings.');
    expect(md).toContain(
      'Crash-free startup: Users no longer experience crashes on startup.',
    );
    expect(md).toContain('#### New');
    expect(md).toContain('### Installation');
    expect(md).toContain('### Thanks');
    expect(md).toContain('### All Changes');
    expect(md).toContain('compare/v0.10.0...v0.11.0');
  });

  it('sends only eligible enriched changes to the model', async () => {
    let capturedContext = '';
    const llmPort: LlmPort = {
      async generateHighlights(context) {
        capturedContext = context;
        return llmOutput(['ref:43', 'ref:44', 'ref:45']);
      },
    };
    await generateReleaseNotes({
      ...baseInput,
      rawCommits: [
        makeCommit({ subject: 'refactor: internals (#42)' }),
        makeCommit({ hash: 'bbbbbbb', subject: 'feat: provider (#43)' }),
        makeCommit({ hash: 'ccccccc', subject: 'fix: crash (#44)' }),
        makeCommit({ hash: 'ddddddd', subject: 'feat: ui (#45)' }),
      ],
      ghPort: fakeGh([
        makeRef({
          number: 42,
          title: 'Internal provider rewrite',
          body: 'Implementation details only.',
          labels: ['CODE QUALITY / MODULARIZATION'],
        }),
        makeRef({
          number: 43,
          title: 'Configure a new provider',
          body: 'Users can select the provider in settings.',
        }),
        makeRef({
          number: 44,
          title: 'Crash-free startup',
          body: 'Users no longer experience crashes on startup.',
        }),
        makeRef({
          number: 45,
          title: 'Improved UI layout',
          body: 'Users see a cleaner layout.',
        }),
      ]),
      llmPort,
    });

    expect(capturedContext).not.toContain('Internal provider rewrite');
    expect(capturedContext).not.toContain('Implementation details only');
    expect(capturedContext).toContain('Configure a new provider');
  });

  it('uses deterministic fallback when no complete change fits the LLM context', async () => {
    let calls = 0;
    const llmPort: LlmPort = {
      async generateHighlights() {
        calls += 1;
        return llmOutput(['ref:42']);
      },
    };
    const md = await generateReleaseNotes({
      ...baseInput,
      rawCommits: [makeCommit()],
      ghPort: fakeGh([
        makeRef({
          labels: ['feature', 'x'.repeat(70_000)],
        }),
      ]),
      llmPort,
    });

    expect(calls).toBe(0);
    expect(md).toContain(
      'Faster streaming responses: Users now receive responses without intermittent stalls.',
    );
  });
  it('uses enriched user impact for deterministic fallback', async () => {
    const md = await generateReleaseNotes({
      ...baseInput,
      rawCommits: [
        makeCommit(),
        makeCommit({ hash: 'bbbbbbb', subject: 'feat: another (#43)' }),
        makeCommit({ hash: 'ccccccc', subject: 'fix: third (#44)' }),
      ],
      ghPort: fakeGh([
        makeRef(),
        makeRef({
          number: 43,
          title: 'Configure a new provider',
          body: 'Users can select the provider in settings.',
        }),
        makeRef({
          number: 44,
          title: 'Crash-free startup',
          body: 'Users no longer experience crashes on startup.',
        }),
      ]),
      llmPort: fakeLlm(new Error('model unavailable')),
    });

    expect(md).toContain(
      'Faster streaming responses: Users now receive responses without intermittent stalls.',
    );
    expect(
      md.slice(md.indexOf('### Highlights'), md.indexOf('####')),
    ).not.toContain('feat: something');
  });

  it('omits fallback Highlights when no impact can be established', async () => {
    const md = await generateReleaseNotes({
      ...baseInput,
      rawCommits: [makeCommit({ subject: 'feat: mechanism only' })],
      ghPort: fakeGh([]),
      llmPort: fakeLlm(new Error('model unavailable')),
    });
    expect(md).toContain('### Highlights');
    expect(md).toContain('No major user-facing changes in this release.');
    expect(md).toContain('#### New');
  });

  it('uses curated headlines only for stable releases', async () => {
    const input = {
      ...baseInput,
      rawCommits: [],
      ghPort: fakeGh([]),
      llmPort: fakeLlm(llmOutput([])),
      curatedHeadline: '## Maintainer-selected headline',
    };
    const stable = await generateReleaseNotes(input);
    const nightly = await generateReleaseNotes({ ...input, isNightly: true });
    expect(stable).toContain('Maintainer-selected headline');
    expect(nightly).not.toContain('Maintainer-selected headline');
  });

  it('retains raw merge and process commits in All Changes', async () => {
    const md = await generateReleaseNotes({
      ...baseInput,
      rawCommits: [
        makeCommit({
          subject: 'Merge pull request #42',
          isMerge: true,
          parents: ['p1', 'p2'],
        }),
        makeCommit({ hash: 'bbbbbbb', subject: 'chore: fix lint' }),
      ],
      ghPort: fakeGh([]),
      llmPort: fakeLlm(llmOutput([])),
    });
    expect(md).toContain('Merge pull request #42');
    expect(md).toContain('chore: fix lint');
  });

  it('rejects model selections with ineligible source IDs (falls back)', async () => {
    const md = await generateReleaseNotes({
      ...baseInput,
      rawCommits: [
        makeCommit(),
        makeCommit({ hash: 'bbbbbbb', subject: 'feat: another (#43)' }),
        makeCommit({ hash: 'ccccccc', subject: 'fix: third (#44)' }),
      ],
      ghPort: fakeGh([
        makeRef(),
        makeRef({
          number: 43,
          title: 'Configure a new provider',
          body: 'Users can select the provider in settings.',
        }),
        makeRef({
          number: 44,
          title: 'Crash-free startup',
          body: 'Users no longer experience crashes on startup.',
        }),
      ]),
      llmPort: fakeLlm(llmOutput(['ref:99', 'ref:42', 'ref:43'])),
    });

    expect(md).toContain('### Highlights');
    expect(md).toContain('Faster streaming responses');
  });

  it('produces 3-6 highlights when enough defensible facts exist', async () => {
    const md = await generateReleaseNotes({
      ...baseInput,
      rawCommits: [1, 2, 3, 4].map((n) =>
        makeCommit({
          hash: `hash${n}`,
          subject: `feat: feature ${n} (#${40 + n})`,
        }),
      ),
      ghPort: fakeGh(
        [1, 2, 3, 4].map((n) =>
          makeRef({
            number: 40 + n,
            title: `Feature ${n}`,
            body: `Users can now use feature ${n} for better productivity.`,
          }),
        ),
      ),
      llmPort: fakeLlm(llmOutput(['ref:41', 'ref:42', 'ref:43', 'ref:44'])),
    });

    expect(md).toContain('### Highlights');
    const highlightsSection = md.slice(
      md.indexOf('### Highlights'),
      md.indexOf('####'),
    );
    const bullets = highlightsSection
      .split('\n')
      .filter((line) => line.startsWith('- '));
    expect(bullets.length).toBeGreaterThanOrEqual(3);
    expect(bullets.length).toBeLessThanOrEqual(6);
  });

  it('uses validated model selections for highlight membership and order', async () => {
    const rawCommits = [1, 2, 3, 4, 5, 6, 7].map((number) =>
      makeCommit({
        hash: `abcde${number}0`,
        subject: `feat: feature ${number} (#${40 + number})`,
      }),
    );
    const ghPort = fakeGh(
      [1, 2, 3, 4, 5, 6, 7].map((number) =>
        makeRef({
          number: 40 + number,
          title: `Feature ${number}`,
          body: `Users can now use feature ${number}.`,
        }),
      ),
    );
    const generate = (sourceIds: readonly string[]) =>
      generateReleaseNotes({
        ...baseInput,
        rawCommits,
        ghPort,
        llmPort: fakeLlm(llmOutput(sourceIds)),
      });

    const first = await generate([
      'ref:41',
      'ref:42',
      'ref:43',
      'ref:44',
      'ref:45',
      'ref:46',
    ]);
    const second = await generate([
      'ref:47',
      'ref:46',
      'ref:45',
      'ref:44',
      'ref:43',
      'ref:42',
    ]);
    const highlights = (markdown: string) =>
      markdown.slice(
        markdown.indexOf('### Highlights'),
        markdown.indexOf('####'),
      );

    expect(highlights(first)).toContain('Users can now use feature 1.');
    expect(highlights(first)).not.toContain('Users can now use feature 7.');
    expect(highlights(second)).toContain('Users can now use feature 7.');
    expect(highlights(second)).not.toContain('Users can now use feature 1.');
    expect(highlights(second).indexOf('feature 7')).toBeLessThan(
      highlights(second).indexOf('feature 6'),
    );
  });
});

describe('generateReleaseNotes — All Changes sanitization (issue6)', () => {
  it('sanitizes All Changes subjects as plain text', async () => {
    const md = await generateReleaseNotes({
      ...baseInput,
      rawCommits: [
        makeCommit({
          hash: 'abc1234',
          subject: 'feat: add `[evil](https://x.invalid)` markdown',
        }),
      ],
      ghPort: fakeGh([]),
      llmPort: fakeLlm(new Error('no llm')),
    });
    const allChangesSection = md.slice(md.indexOf('### All Changes'));
    expect(allChangesSection).not.toContain('https://x.invalid');
    expect(allChangesSection).not.toContain('`[evil]`');
    expect(allChangesSection).toContain('abc1234');
  });

  it('retains the hash after a maximally long sanitized subject', async () => {
    const md = await generateReleaseNotes({
      ...baseInput,
      rawCommits: [
        makeCommit({
          hash: 'abc1234',
          subject: 'a'.repeat(500),
        }),
      ],
      ghPort: fakeGh([]),
      llmPort: fakeLlm(new Error('no llm')),
    });
    const allChangesSection = md.slice(md.indexOf('### All Changes'));
    expect(allChangesSection).toContain(`- ${'a'.repeat(500)} (abc1234)`);
  });

  it('omits invalid hashes from the parenthetical', async () => {
    const md = await generateReleaseNotes({
      ...baseInput,
      rawCommits: [
        makeCommit({
          hash: 'not-a-hash!;rm -rf',
          subject: 'feat: safe subject',
        }),
      ],
      ghPort: fakeGh([]),
      llmPort: fakeLlm(new Error('no llm')),
    });
    const allChangesSection = md.slice(md.indexOf('### All Changes'));
    expect(allChangesSection).not.toContain('rm -rf');
    expect(allChangesSection).not.toContain('(not-a-hash');
  });

  it('strips HTML injection from All Changes subjects', async () => {
    const md = await generateReleaseNotes({
      ...baseInput,
      rawCommits: [
        makeCommit({
          hash: 'abc1234',
          subject: 'feat: <script>alert(1)</script> thing',
        }),
      ],
      ghPort: fakeGh([]),
      llmPort: fakeLlm(new Error('no llm')),
    });
    const allChangesSection = md.slice(md.indexOf('### All Changes'));
    expect(allChangesSection).not.toContain('<script>');
  });

  it('strips control characters and newlines from All Changes subjects', async () => {
    const md = await generateReleaseNotes({
      ...baseInput,
      rawCommits: [
        makeCommit({
          hash: 'abc1234',
          subject: 'feat: inject\x1erecord\x1fsep\nnewline',
        }),
      ],
      ghPort: fakeGh([]),
      llmPort: fakeLlm(new Error('no llm')),
    });
    const allChangesSection = md.slice(md.indexOf('### All Changes'));
    expect(allChangesSection).not.toContain('\x1e');
    expect(allChangesSection).not.toContain('\x1f');
  });

  it('strips emoji characters from All Changes subjects', async () => {
    const md = await generateReleaseNotes({
      ...baseInput,
      rawCommits: [
        makeCommit({
          hash: 'abc1234',
          subject: 'feat: add streaming \u{1F680} support',
        }),
      ],
      ghPort: fakeGh([]),
      llmPort: fakeLlm(new Error('no llm')),
    });
    const allChangesSection = md.slice(md.indexOf('### All Changes'));
    const emojiPattern = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{27BF}]/u;
    expect(emojiPattern.test(allChangesSection)).toBe(false);
    expect(allChangesSection).toContain('add streaming');
    expect(allChangesSection).toContain('abc1234');
  });
});

describe('generateReleaseNotes — comparison URL (issue13)', () => {
  it('builds comparison URL from validated repository input', async () => {
    const md = await generateReleaseNotes({
      ...baseInput,
      repository: 'vybestack/llxprt-code',
      rawCommits: [],
      ghPort: fakeGh([]),
      llmPort: fakeLlm(llmOutput([])),
    });
    expect(md).toContain(
      'https://github.com/vybestack/llxprt-code/compare/v0.10.0...v0.11.0',
    );
  });

  it('omits comparison URL when repository is missing', async () => {
    const md = await generateReleaseNotes({
      ...baseInput,
      repository: undefined,
      rawCommits: [],
      ghPort: fakeGh([]),
      llmPort: fakeLlm(llmOutput([])),
    });
    expect(md).not.toContain('**Full Changelog**');
  });

  it('omits comparison URL when repository is malformed', async () => {
    const md = await generateReleaseNotes({
      ...baseInput,
      repository: 'not/a/valid/repo',
      rawCommits: [],
      ghPort: fakeGh([]),
      llmPort: fakeLlm(llmOutput([])),
    });
    expect(md).not.toContain('**Full Changelog**');
  });

  it('omits comparison URL when repository has injection characters', async () => {
    const md = await generateReleaseNotes({
      ...baseInput,
      repository: 'evil/repo"; rm -rf /',
      rawCommits: [],
      ghPort: fakeGh([]),
      llmPort: fakeLlm(llmOutput([])),
    });
    expect(md).not.toContain('rm -rf');
    expect(md).not.toContain('**Full Changelog**');
  });
});

describe('generateReleaseNotes — enrichment failure handling (issue7)', () => {
  it('produces sensible output when gh port throws (total enrichment failure)', async () => {
    const failingGh: GhPort = {
      async fetchRefs() {
        throw new Error('total network failure');
      },
    };
    const md = await generateReleaseNotes({
      ...baseInput,
      rawCommits: [
        makeCommit({ subject: 'feat: real work (#42)' }),
        makeCommit({
          hash: 'bbbbbbb',
          subject: 'fix: another (#43)',
        }),
      ],
      ghPort: failingGh,
      llmPort: fakeLlm(new Error('no llm')),
    });
    // Without enrichment, highlights are omitted but the structure is intact.
    expect(md).toContain('### Highlights');
    expect(md).toContain('No major user-facing changes in this release.');
    expect(md).toContain('### Installation');
    expect(md).toContain('### All Changes');
    expect(md).toContain('feat: real work');
    expect(md).toContain('fix: another');
  });
});
