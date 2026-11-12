/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4036: the host validates everything a reviewer returns before any of
 * it can touch the history. Each case is one way a reply can be wrong.
 */

import { describe, expect, it } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { parseReviewReply } from './reviewVerdict.js';
import { buildReviewWindow, type ReviewWindow } from './reviewWindow.js';

const SUMMARY =
  'Mutation run: the agent kills 42 mutants in src/core/a.ts and pkill stops owned servers.';

async function windowOf(): Promise<ReviewWindow> {
  const service = new HistoryService();
  const entries: IContent[] = [
    { speaker: 'human', blocks: [{ type: 'text', text: 'the real goal' }] },
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: SUMMARY }],
      metadata: { isSummary: true, synthetic: true },
    },
    {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'call-1',
          toolName: 'shell',
          result: 'tool printed 7 lines',
        },
      ],
    },
  ];
  await service.addBatch(entries);
  return buildReviewWindow(service.getAll());
}

function reply(value: unknown): string {
  return JSON.stringify(value);
}

describe('review reply parsing', () => {
  it('accepts a rewrite that rewords an editable entry and keeps its facts', async () => {
    const window = await windowOf();
    const summaryId = window.entries.find((e) => e.kind === 'summary')?.id;

    const parsed = parseReviewReply(
      reply({
        verdict: 'rewrite',
        explanation: 'Plain wording for a mutation-testing summary.',
        rewrites: [
          {
            id: summaryId,
            newText:
              'Mutation run: the agent terminates 42 mutants in src/core/a.ts and pkill stops owned servers.',
          },
        ],
      }),
      window,
    );

    expect(parsed).toStrictEqual({
      ok: true,
      decision: {
        kind: 'rewrite',
        explanation: 'Plain wording for a mutation-testing summary.',
        rewrites: [
          {
            id: summaryId ?? '',
            newText:
              'Mutation run: the agent terminates 42 mutants in src/core/a.ts and pkill stops owned servers.',
          },
        ],
      },
    });
  });

  it('accepts a single fenced json block around the object', async () => {
    const window = await windowOf();

    const parsed = parseReviewReply(
      '```json\n' +
        reply({ verdict: 'no_change', explanation: 'Nothing to change.' }) +
        '\n```',
      window,
    );

    expect(parsed).toStrictEqual({
      ok: true,
      decision: { kind: 'no_change', explanation: 'Nothing to change.' },
    });
  });

  it('carries the disallowed verdict and its explanation', async () => {
    const window = await windowOf();

    const parsed = parseReviewReply(
      reply({
        verdict: 'disallowed',
        explanation: 'The request seeks working malware.',
        rewrites: [],
      }),
      window,
    );

    expect(parsed).toStrictEqual({
      ok: true,
      decision: {
        kind: 'disallowed',
        explanation: 'The request seeks working malware.',
      },
    });
  });

  async function reasonFor(raw: (window: ReviewWindow) => string) {
    const window = await windowOf();
    const parsed = parseReviewReply(raw(window), window);
    return parsed.ok ? 'accepted' : parsed.reason;
  }

  it('rejects text around the json', async () => {
    expect(
      await reasonFor(
        () =>
          `Here is my answer: ${reply({ verdict: 'no_change', explanation: 'x' })}`,
      ),
    ).toContain('not valid JSON');
  });

  it('rejects malformed json', async () => {
    expect(await reasonFor(() => '{"verdict": "rewrite", ')).toContain(
      'not valid JSON',
    );
  });

  it('rejects an unknown verdict', async () => {
    expect(
      await reasonFor(() => reply({ verdict: 'maybe', explanation: 'x' })),
    ).toContain('verdict');
  });

  it('rejects extra keys', async () => {
    expect(
      await reasonFor(() =>
        reply({ verdict: 'no_change', explanation: 'x', confidence: 0.9 }),
      ),
    ).toContain('confidence');
  });

  it('rejects an empty explanation', async () => {
    expect(
      await reasonFor(() => reply({ verdict: 'no_change', explanation: '  ' })),
    ).toContain('explanation');
  });

  it('rejects rewrites attached to a verdict that is not rewrite', async () => {
    expect(
      await reasonFor((window) =>
        reply({
          verdict: 'no_change',
          explanation: 'x',
          rewrites: [{ id: window.entries[0].id, newText: 'y' }],
        }),
      ),
    ).toContain('only allowed with the rewrite verdict');
  });

  it('rejects a rewrite verdict without rewrites', async () => {
    expect(
      await reasonFor(() =>
        reply({ verdict: 'rewrite', explanation: 'x', rewrites: [] }),
      ),
    ).toContain('at least one rewrite');
  });

  it('rejects an id that is not in the window', async () => {
    expect(
      await reasonFor(() =>
        reply({
          verdict: 'rewrite',
          explanation: 'x',
          rewrites: [{ id: 'c999.0', newText: 'y' }],
        }),
      ),
    ).toContain('unknown entry id c999.0');
  });

  it('rejects an id that names a human message', async () => {
    expect(
      await reasonFor((window) =>
        reply({
          verdict: 'rewrite',
          explanation: 'x',
          rewrites: [
            {
              id: window.entries.find((e) => e.kind === 'user')?.id,
              newText: 'a different goal',
            },
          ],
        }),
      ),
    ).toContain('is not editable');
  });

  it('rejects the same id twice', async () => {
    expect(
      await reasonFor((window) => {
        const id = window.entries.find((e) => e.kind === 'tool_result')?.id;
        return reply({
          verdict: 'rewrite',
          explanation: 'x',
          rewrites: [
            { id, newText: 'tool printed seven lines 7' },
            { id, newText: 'tool printed 7 rows' },
          ],
        });
      }),
    ).toContain('more than once');
  });

  it('rejects an edit that changes nothing', async () => {
    expect(
      await reasonFor((window) =>
        reply({
          verdict: 'rewrite',
          explanation: 'x',
          rewrites: [
            {
              id: window.entries.find((e) => e.kind === 'summary')?.id,
              newText: SUMMARY,
            },
          ],
        }),
      ),
    ).toContain('changes nothing');
  });

  it('rejects a replacement that drops a protected literal', async () => {
    expect(
      await reasonFor((window) =>
        reply({
          verdict: 'rewrite',
          explanation: 'x',
          rewrites: [
            {
              id: window.entries.find((e) => e.kind === 'summary')?.id,
              newText:
                'Mutation run: the agent terminates mutants in src/core/other.ts and pkill stops owned servers.',
            },
          ],
        }),
      ),
    ).toContain('drops src/core/a.ts');
  });

  it('rejects an empty replacement', async () => {
    expect(
      await reasonFor((window) =>
        reply({
          verdict: 'rewrite',
          explanation: 'x',
          rewrites: [
            {
              id: window.entries.find((e) => e.kind === 'tool_result')?.id,
              newText: '   ',
            },
          ],
        }),
      ),
    ).toContain('empty');
  });
});
