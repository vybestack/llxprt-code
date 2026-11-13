/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4036: what the reviewer does with a reply once it has one. The
 * history, the review window and the rewrite commit are real. The provider is
 * the external boundary, so the provider's canned reply comes from the same
 * replay provider the agent tests use.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeProvider } from '@vybestack/llxprt-code-providers';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { HistoryRefusalReviewer } from './refusalReviewer.js';
import type { RefusalAttempt } from './refusalTypes.js';
import type { ReviewOutcome } from './reviewTypes.js';
import { buildReviewWindow } from './reviewWindow.js';

const SUMMARY =
  'Mutation run: the agent kills 42 mutants in src/core/a.ts and pkill stops owned servers.';
const REWRITTEN =
  'Mutation run: the agent terminates 42 mutants in src/core/a.ts and pkill stops owned servers.';

const ATTEMPT: RefusalAttempt = {
  finishReason: 'refusal',
  turnId: 'turn-1',
  promptId: 'prompt-1',
  attemptIndex: 1,
  provider: 'fake',
  model: 'fake-model',
};

function seed(): IContent[] {
  return [
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: SUMMARY }],
      metadata: { isSummary: true, synthetic: true },
    },
    {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'Continuing from the snapshot.' }],
      metadata: { synthetic: true, reason: 'compression-continuation' },
    },
  ];
}

function textsOf(history: readonly IContent[]): string[] {
  return history.flatMap((content) =>
    content.blocks.flatMap((block) =>
      block.type === 'text' ? [block.text] : [],
    ),
  );
}

describe('reviewer commit (issue #4036)', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'llxprt-reviewer-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  async function review(options: {
    readonly abortBeforeCommit: boolean;
  }): Promise<{
    readonly outcome: ReviewOutcome | { readonly aborted: true };
    readonly history: HistoryService;
    readonly before: readonly IContent[];
  }> {
    const history = new HistoryService();
    await history.addBatch(seed());
    const before = history.getAll();
    const summaryId =
      buildReviewWindow(before).entries.find((e) => e.kind === 'summary')?.id ??
      'missing';
    const fixture = join(directory, 'reply.jsonl');
    writeFileSync(
      fixture,
      `${JSON.stringify({
        chunks: [
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'text',
                text: JSON.stringify({
                  verdict: 'rewrite',
                  explanation: 'Plain wording.',
                  rewrites: [{ id: summaryId, newText: REWRITTEN }],
                }),
              },
            ],
            metadata: { finishReason: 'stop' },
          },
        ],
      })}\n`,
    );
    const provider = new FakeProvider(fixture);
    const controller = new AbortController();
    const runtimeState = createAgentRuntimeState({
      runtimeId: 'reviewer-test',
      provider: 'fake',
      model: 'fake-model',
      sessionId: 'reviewer-test-session',
    });
    const reviewer = new HistoryRefusalReviewer({
      history: () => history,
      runtimeState,
      config: () => undefined,
      compressionProfile: () => undefined,
      resolveProvider: () =>
        Promise.resolve({
          provider,
          runtime: { runtimeId: 'reviewer-test', metadata: {} },
          config: undefined,
          resolved: { model: 'fake-model' },
          invocation: createRuntimeInvocationContext({
            fetch: globalThis.fetch,
            providerName: 'fake',
            runtimeId: 'reviewer-test',
            ephemeralsSnapshot: {},
          }),
        }),
      usageLogger: () => null,
      // The clock is read right before the commit: a cancel pressed at that
      // moment must still stop the rewrite.
      now: () => {
        if (options.abortBeforeCommit) controller.abort();
        return new Date('2026-11-12T10:00:00.000Z');
      },
      newOperationId: () => 'op-1',
    });
    const outcome = await reviewer
      .review({
        attempt: ATTEMPT,
        reviewProfile: undefined,
        retriesTried: 1,
        execution: undefined,
        pending: undefined,
        modelParameters: undefined,
        signal: controller.signal,
      })
      .catch(() => ({ aborted: true as const }));
    return { outcome, history, before };
  }

  it('commits the rewrite when the request is still live', async () => {
    const { outcome, history } = await review({ abortBeforeCommit: false });

    expect({
      kind: 'kind' in outcome ? outcome.kind : 'aborted',
      texts: textsOf(history.getAll()),
    }).toStrictEqual({
      kind: 'rewritten',
      texts: [REWRITTEN, 'Continuing from the snapshot.'],
    });
  });

  it('rejects and leaves the history untouched when the request is aborted before the commit', async () => {
    const { outcome, history, before } = await review({
      abortBeforeCommit: true,
    });

    expect({
      aborted: 'aborted' in outcome,
      untouched: history.getAll().every((c, i) => c === before[i]),
      texts: textsOf(history.getAll()),
    }).toStrictEqual({
      aborted: true,
      untouched: true,
      texts: [SUMMARY, 'Continuing from the snapshot.'],
    });
  });
});
