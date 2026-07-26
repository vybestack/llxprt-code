/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { renderReleaseNotes } from '../../release-notes/rendering.js';
import type { ReleaseNotesData } from '../../release-notes/types.js';

function makeData(overrides: Partial<ReleaseNotesData> = {}): ReleaseNotesData {
  return {
    releaseTag: 'v0.10.0',
    highlights: ['New Gemini support', 'Faster startup'],
    categorized: {
      new: ['Added Gemini provider'],
      improvements: ['Improved startup time'],
      fixes: ['Fixed crash on exit'],
      breaking: [],
    },
    allChanges: [
      '- feat: add Gemini (abc1234)',
      '- fix: crash on exit (def5678)',
    ],
    contributors: ['alice', 'bob'],
    lastTag: 'v0.9.0',
    isFirstRelease: false,
    comparisonUrl: 'https://github.com/owner/repo/compare/v0.9.0...v0.10.0',
    curatedHeadline: null,
    ...overrides,
  };
}

describe('renderReleaseNotes', () => {
  it('includes the release header with tag', () => {
    const md = renderReleaseNotes(makeData());
    expect(md).toContain('## Release v0.10.0');
  });

  it('includes installation instructions', () => {
    const md = renderReleaseNotes(makeData());
    expect(md).toContain('### Installation');
    expect(md).toContain('npm install -g @vybestack/llxprt-code');
    expect(md).toContain('npx @vybestack/llxprt-code');
  });

  it('renders highlights section when highlights exist', () => {
    const md = renderReleaseNotes(makeData());
    expect(md).toContain('### Highlights');
    expect(md).toContain('- New Gemini support');
    expect(md).toContain('- Faster startup');
  });

  it('renders a safe highlights placeholder when empty', () => {
    const md = renderReleaseNotes(makeData({ highlights: [] }));
    expect(md).toContain('### Highlights');
    expect(md).toContain('No major user-facing changes in this release.');
  });

  it('renders curated headline before highlights when provided', () => {
    const md = renderReleaseNotes(
      makeData({ curatedHeadline: '## Curated headline text' }),
    );
    const headlineIndex = md.indexOf('## Curated headline text');
    const highlightsIndex = md.indexOf('### Highlights');
    expect(headlineIndex).toBeGreaterThan(-1);
    expect(headlineIndex).toBeLessThan(highlightsIndex);
  });

  it('renders categorized New section', () => {
    const md = renderReleaseNotes(makeData());
    expect(md).toContain('#### New');
    expect(md).toContain('- Added Gemini provider');
  });

  it('renders categorized Improvements section', () => {
    const md = renderReleaseNotes(makeData());
    expect(md).toContain('#### Improvements');
    expect(md).toContain('- Improved startup time');
  });

  it('renders categorized Fixes section', () => {
    const md = renderReleaseNotes(makeData());
    expect(md).toContain('#### Fixes');
    expect(md).toContain('- Fixed crash on exit');
  });

  it('omits Breaking changes section when empty', () => {
    const md = renderReleaseNotes(makeData());
    expect(md).not.toContain('#### Breaking changes');
  });

  it('renders Breaking changes section when populated', () => {
    const md = renderReleaseNotes(
      makeData({
        categorized: {
          new: [],
          improvements: [],
          fixes: [],
          breaking: ['Removed old API'],
        },
      }),
    );
    expect(md).toContain('#### Breaking changes');
    expect(md).toContain('- Removed old API');
  });

  it('renders contributor thanks section', () => {
    const md = renderReleaseNotes(makeData());
    expect(md).toContain('### Thanks');
    expect(md).toContain('- @alice');
    expect(md).toContain('- @bob');
  });

  it('omits thanks section when no contributors', () => {
    const md = renderReleaseNotes(makeData({ contributors: [] }));
    expect(md).not.toContain('### Thanks');
  });

  it('renders All Changes section with raw commits', () => {
    const md = renderReleaseNotes(makeData());
    expect(md).toContain('### All Changes');
    expect(md).toContain('- feat: add Gemini (abc1234)');
  });

  it('includes comparison link when available', () => {
    const md = renderReleaseNotes(makeData());
    expect(md).toContain('**Full Changelog**');
    expect(md).toContain('compare/v0.9.0...v0.10.0');
  });

  it('omits comparison link when null', () => {
    const md = renderReleaseNotes(makeData({ comparisonUrl: null }));
    expect(md).not.toContain('**Full Changelog**');
  });

  it('orders sections: Installation, Highlights, categories, All Changes', () => {
    const md = renderReleaseNotes(makeData());
    const installIdx = md.indexOf('### Installation');
    const highlightsIdx = md.indexOf('### Highlights');
    const newIdx = md.indexOf('#### New');
    const allChangesIdx = md.indexOf('### All Changes');
    expect(installIdx).toBeLessThan(highlightsIdx);
    expect(highlightsIdx).toBeLessThan(newIdx);
    expect(newIdx).toBeLessThan(allChangesIdx);
  });

  it('places Thanks after categories and before All Changes', () => {
    const md = renderReleaseNotes(makeData());
    const fixesIdx = md.indexOf('#### Fixes');
    const thanksIdx = md.indexOf('### Thanks');
    const allChangesIdx = md.indexOf('### All Changes');
    expect(fixesIdx).toBeLessThan(thanksIdx);
    expect(thanksIdx).toBeLessThan(allChangesIdx);
  });

  it('does not contain emojis in hardcoded fixture data', () => {
    const md = renderReleaseNotes(makeData());
    const emojiPattern = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{27BF}]/u;
    expect(emojiPattern.test(md)).toBe(false);
  });

  it('strips emojis from untrusted highlight and bullet input', () => {
    const md = renderReleaseNotes(
      makeData({
        highlights: ['New Gemini support \u{1F680}'],
        categorized: {
          new: ['Added Gemini provider \u{1F389}'],
          improvements: [],
          fixes: [],
          breaking: [],
        },
      }),
    );
    const emojiPattern = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{27BF}]/u;
    expect(emojiPattern.test(md)).toBe(false);
    expect(md).toContain('New Gemini support');
    expect(md).toContain('Added Gemini provider');
  });

  it('strips bidi and zero-width controls from every untrusted render field', () => {
    const controls = '\u200b\u200c\u202e\u202c\u2066\u2069';
    const md = renderReleaseNotes(
      makeData({
        releaseTag: `v0.10.${controls}0`,
        highlights: [`Faster${controls} startup`],
        categorized: {
          new: [`New${controls} provider`],
          improvements: [],
          fixes: [],
          breaking: [],
        },
        allChanges: [`- fix: safe${controls} subject (#42)`],
        contributors: [`ali${controls}ce`],
        comparisonUrl: `https://github.com/owner/repo/compare/v0.9.0...v0.10.${controls}0`,
      }),
    );

    expect(md).not.toContain(controls);
    for (const control of controls) {
      expect(md).not.toContain(control);
    }
    expect(md).toContain('## Release v0.10.0');
    expect(md).toContain('- Faster startup');

    expect(md).toContain('- New provider');
    expect(md).toContain('- fix: safe subject (#42)');
    expect(md).not.toContain('@alice');
    expect(md).not.toContain('Full Changelog');
  });

  it('preserves emails while neutralizing ambiguous mention forms', () => {
    const md = renderReleaseNotes(
      makeData({
        highlights: [
          'Contact contact@example.com, not .@octocat, +@github, or .@octocat.com',
        ],
        categorized: {
          new: ['Notify +@github.com'],
          improvements: [],
          fixes: [],
          breaking: [],
        },
        allChanges: ['- fix: notify +@github (abc1234)'],
      }),
    );

    expect(md).toContain('contact@example.com');
    expect(md).not.toContain('@octocat');
    expect(md).not.toContain('@github');
  });

  it('neutralizes invalid email domains with consecutive dots', () => {
    const md = renderReleaseNotes(
      makeData({ highlights: ['Contact foo@bar..com for support.'] }),
    );

    expect(md).not.toContain('foo@bar..com');
  });

  it('neutralizes malformed email domains with trailing separators', () => {
    const md = renderReleaseNotes(
      makeData({ highlights: ['Contact foo@example.com- for support.'] }),
    );

    expect(md).not.toContain('@example.com-');
  });
  it('bounds large release bodies while preserving the comparison URL', () => {
    const allChanges = Array.from(
      { length: 1_200 },
      (_, index) => `- feat: ${'x'.repeat(200)} ${index}`,
    );
    const comparisonUrl =
      'https://github.com/owner/repo/compare/v0.9.0...v0.10.0';

    const md = renderReleaseNotes(makeData({ allChanges, comparisonUrl }));

    expect(Buffer.byteLength(md, 'utf8')).toBeLessThanOrEqual(120_000);
    expect(md).toContain('Additional details omitted');
    expect(md).toContain('### All Changes');
    expect(md).toContain('- feat:');
    expect(md).toContain(comparisonUrl);
  });
});
