/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import { stripScratchpadSections } from './compressionSummaryScratchpad.js';

const SNAPSHOT =
  '<state_snapshot><overall_goal>Ship #4128</overall_goal></state_snapshot>';

function textOf(content: IContent | undefined): string {
  return (content?.blocks ?? [])
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('');
}

describe('stripScratchpadSections', () => {
  it('removes a complete scratchpad block before the snapshot', () => {
    expect(
      stripScratchpadSections(
        `<scratchpad>I should keep the goal.</scratchpad>\n${SNAPSHOT}`,
      ),
    ).toBe(SNAPSHOT);
  });

  it('removes every complete scratchpad block', () => {
    expect(
      stripScratchpadSections(
        `<SCRATCHPAD>one</SCRATCHPAD>${SNAPSHOT}<scratchpad>two</scratchpad>`,
      ),
    ).toBe(SNAPSHOT);
  });

  it('removes an unterminated leading scratchpad up to the snapshot', () => {
    expect(
      stripScratchpadSections(
        `  <scratchpad>\nFirst I review the history.\n\n${SNAPSHOT}`,
      ),
    ).toBe(SNAPSHOT);
  });

  it('reduces an unterminated scratchpad without a snapshot to nothing', () => {
    expect(stripScratchpadSections('<scratchpad>only reasoning')).toBe('');
  });

  it('returns text without a scratchpad unchanged, whitespace included', () => {
    const text = `\n${SNAPSHOT}\n`;
    expect(stripScratchpadSections(text)).toBe(text);
  });
});

describe('provider requests recover summaries that carry a scratchpad', () => {
  function serviceWith(...contents: IContent[]): HistoryService {
    const service = new HistoryService();
    for (const content of contents) {
      service.add(content);
    }
    return service;
  }

  const legacySummary: IContent = {
    speaker: 'human',
    blocks: [
      {
        type: 'text',
        text: `<scratchpad>\nI will now review the conversation.\n</scratchpad>\n\n${SNAPSHOT}`,
      },
    ],
    metadata: {
      isSummary: true,
      synthetic: true,
      reason: 'compression-state-snapshot',
    },
  };

  it('sends a tagged summary with its scratchpad removed and the snapshot intact', () => {
    const service = serviceWith(legacySummary, {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'Continuing.' }],
    });

    const [summary] = service.getCuratedForProvider();

    expect(textOf(summary)).toBe(SNAPSHOT);
  });

  it('recovers summaries tagged only by the isSummary flag', () => {
    const service = serviceWith({
      ...legacySummary,
      blocks: [{ type: 'text', text: `<scratchpad>notes\n${SNAPSHOT}` }],
      metadata: { isSummary: true },
    });

    expect(textOf(service.getCuratedForProvider()[0])).toBe(SNAPSHOT);
  });

  it('recovers summaries tagged only by the snapshot reason', () => {
    const service = serviceWith({
      ...legacySummary,
      metadata: { reason: 'compression-state-snapshot' },
    });

    expect(textOf(service.getCuratedForProvider()[0])).toBe(SNAPSHOT);
  });

  it('leaves the stored history untouched', () => {
    const service = serviceWith(legacySummary);

    service.getCuratedForProvider();

    expect(textOf(service.getAll()[0])).toBe(textOf(legacySummary));
  });

  it('never alters an ordinary user message that mentions a scratchpad', () => {
    const userText =
      'Why does the summary start with <scratchpad>notes</scratchpad>?';
    const service = serviceWith({
      speaker: 'human',
      blocks: [{ type: 'text', text: userText }],
    });

    expect(textOf(service.getCuratedForProvider()[0])).toBe(userText);
  });

  it('never alters an assistant reply that mentions a scratchpad', () => {
    const aiText = '<scratchpad> is the tag the old prompt asked for.';
    const service = serviceWith(
      { speaker: 'human', blocks: [{ type: 'text', text: 'Explain it.' }] },
      { speaker: 'ai', blocks: [{ type: 'text', text: aiText }] },
    );

    expect(textOf(service.getCuratedForProvider()[1])).toBe(aiText);
  });

  it('drops a tagged summary that held nothing but an unterminated scratchpad', () => {
    const service = serviceWith(
      {
        ...legacySummary,
        blocks: [{ type: 'text', text: '<scratchpad>truncated reasoning' }],
      },
      { speaker: 'human', blocks: [{ type: 'text', text: 'Next request' }] },
    );

    const contents = service.getCuratedForProvider();

    expect(contents.map(textOf)).toStrictEqual(['Next request']);
  });
});
