/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4036: which part of the history a reviewer sees, which of it may be
 * edited, and what an accepted edit does to the history.
 */

import { describe, expect, it } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { applyReviewRewrites, buildReviewWindow } from './reviewWindow.js';

function human(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

function ai(text: string): IContent {
  return { speaker: 'ai', blocks: [{ type: 'text', text }] };
}

function summary(text: string): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    metadata: { isSummary: true, synthetic: true },
  };
}

function continuation(): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'Continuing from the summary.' }],
    metadata: { synthetic: true, reason: 'compression-continuation' },
  };
}

function toolResult(callId: string, result: unknown): IContent {
  return {
    speaker: 'tool',
    blocks: [{ type: 'tool_response', callId, toolName: 'shell', result }],
  };
}

async function historyOf(
  entries: readonly IContent[],
): Promise<readonly IContent[]> {
  const service = new HistoryService();
  await service.addBatch([...entries]);
  return service.getAll();
}

function texts(window: ReturnType<typeof buildReviewWindow>): string[] {
  return window.entries.map((entry) => entry.text);
}

describe('review window selection', () => {
  it('starts at the last successful provider response and excludes what came before it', async () => {
    const history = await historyOf([
      human('first goal'),
      ai('first answer'),
      human('second goal'),
      ai('second answer'),
      toolResult('call-1', 'tool output after the last answer'),
    ]);

    const window = buildReviewWindow(history);

    expect(texts(window)).toStrictEqual([
      'second answer',
      'tool output after the last answer',
    ]);
  });

  it('lets the reviewer edit the last response a refused continue request resends', async () => {
    const history = await historyOf([
      human('goal'),
      ai('the agent kills the surviving mutants'),
    ]);

    const window = buildReviewWindow(history, [human('continue')]);

    expect(
      window.entries.map(({ text, editable }) => ({ text, editable })),
    ).toStrictEqual([
      { text: 'the agent kills the surviving mutants', editable: true },
      { text: 'continue', editable: false },
    ]);
  });

  it('does not clip a long human request, so the goal is classified from all of it', async () => {
    const request = `${'context '.repeat(900)}and the decisive last sentence`;
    const history = await historyOf([human(request)]);

    const window = buildReviewWindow(history);

    expect({
      goal: window.goal,
      entry: window.entries[0].text,
    }).toStrictEqual({ goal: request, entry: request });
  });

  it('includes the whole history when no provider response has succeeded yet', async () => {
    const history = await historyOf([human('goal'), toolResult('c', 'output')]);

    const window = buildReviewWindow(history);

    expect(texts(window)).toStrictEqual(['goal', 'output']);
  });

  it('includes a compression summary written after the last response, even at the head', async () => {
    const earlier = [human('old goal'), ai('old answer')];
    const service = new HistoryService();
    await service.addBatch(earlier);
    const tail = toolResult('c1', 'tail output');
    await service.addBatch([tail]);
    await service.replaceBatch([
      summary('state snapshot after compression'),
      continuation(),
      ...earlier.slice(1),
      tail,
    ]);

    const window = buildReviewWindow(service.getAll());

    expect(texts(window)).toStrictEqual([
      'state snapshot after compression',
      'old answer',
      'tail output',
    ]);
  });

  it('leaves out a compression summary older than the last response', async () => {
    const history = await historyOf([
      summary('old snapshot'),
      continuation(),
      human('goal since then'),
      ai('answer since then'),
    ]);

    const window = buildReviewWindow(history);

    expect(texts(window)).toStrictEqual(['answer since then']);
  });

  it('reports the latest human goal that is not a summary', async () => {
    const history = await historyOf([
      human('older goal'),
      ai('answer'),
      human('the latest goal'),
      summary('snapshot'),
    ]);

    expect(buildReviewWindow(history).goal).toBe('the latest goal');
  });
});

describe('review window editability', () => {
  const callBlock = {
    type: 'tool_call' as const,
    id: 'call-9',
    name: 'shell',
    parameters: { command: 'pkill -f owned-server' },
  };
  const mediaBlock = {
    type: 'media' as const,
    mimeType: 'image/png',
    encoding: 'base64' as const,
    data: 'aW1hZ2U=',
  };

  async function mixedWindow(): Promise<ReturnType<typeof buildReviewWindow>> {
    // The assistant turn is synthetic so it is not itself the last successful
    // response, which would put everything before it outside the window.
    const history = await historyOf([
      human('please check'),
      human('latest human message'),
      summary('snapshot text'),
      {
        speaker: 'ai',
        blocks: [
          { type: 'thinking', thought: 'private reasoning' },
          { type: 'text', text: 'visible assistant text' },
          callBlock,
        ],
        metadata: { synthetic: true },
      },
      {
        speaker: 'human',
        blocks: [mediaBlock],
      },
      toolResult('call-9', 'plain tool output'),
      toolResult('call-10', { output: 'wrapped output', exitCode: 1 }),
      toolResult('call-11', { exitCode: 2 }),
    ]);
    return buildReviewWindow(history);
  }

  function editableOf(
    window: ReturnType<typeof buildReviewWindow>,
    text: string,
  ): boolean | undefined {
    return window.entries.find((entry) => entry.text.includes(text))?.editable;
  }

  it('allows summary text, assistant text and tool-result text', async () => {
    const window = await mixedWindow();

    expect([
      editableOf(window, 'snapshot text'),
      editableOf(window, 'visible assistant text'),
      editableOf(window, 'plain tool output'),
      editableOf(window, 'wrapped output'),
    ]).toStrictEqual([true, true, true, true]);
  });

  it('never allows human messages, tool calls, media, thinking or unreadable results', async () => {
    const window = await mixedWindow();

    expect([
      editableOf(window, 'latest human message'),
      editableOf(window, 'pkill -f owned-server'),
      editableOf(window, 'image/png'),
      editableOf(window, 'thinking'),
      editableOf(window, 'exitCode'),
    ]).toStrictEqual([false, false, false, false, false]);
  });

  it('gives every entry a distinct, repeatable id', async () => {
    const first = await mixedWindow();
    const second = await mixedWindow();

    const ids = first.entries.map((entry) => entry.id);
    expect({
      distinct: new Set(ids).size === ids.length,
      repeatable: ids.join() === second.entries.map((e) => e.id).join(),
    }).toStrictEqual({ distinct: true, repeatable: true });
  });
});

describe('applying reviewed rewrites', () => {
  it('replaces only the targeted text and keeps structure, ids and markers', async () => {
    const call = {
      type: 'tool_call' as const,
      id: 'call-1',
      name: 'shell',
      parameters: { command: 'echo hi' },
    };
    const history = await historyOf([
      human('goal'),
      { speaker: 'ai', blocks: [{ type: 'text', text: 'running it' }, call] },
      toolResult('call-1', { output: 'kills 3 mutants', exitCode: 0 }),
    ]);
    const window = buildReviewWindow(history);
    const target = window.entries.find((entry) =>
      entry.text.includes('kills 3 mutants'),
    );

    const rewritten = applyReviewRewrites(window, [
      { id: target?.id ?? 'missing', newText: 'terminates 3 mutants' },
    ]);

    expect({
      untouched: rewritten[0] === history[0] && rewritten[1] === history[1],
      result: rewritten[2].blocks[0],
      marker:
        rewritten[2].metadata?.chronology === history[2].metadata?.chronology,
      source: history[2].blocks[0],
    }).toStrictEqual({
      untouched: true,
      result: {
        type: 'tool_response',
        callId: 'call-1',
        toolName: 'shell',
        result: { output: 'terminates 3 mutants', exitCode: 0 },
      },
      marker: true,
      source: {
        type: 'tool_response',
        callId: 'call-1',
        toolName: 'shell',
        result: { output: 'kills 3 mutants', exitCode: 0 },
      },
    });
  });

  it('rewrites summary text in place', async () => {
    const history = await historyOf([summary('snapshot kills'), ai('x')]);
    const window = buildReviewWindow(history.slice(0, 1));

    const rewritten = applyReviewRewrites(window, [
      { id: window.entries[0].id, newText: 'snapshot terminates' },
    ]);

    expect(rewritten[0].blocks).toStrictEqual([
      { type: 'text', text: 'snapshot terminates' },
    ]);
  });
});
