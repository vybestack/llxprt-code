import { readCurated } from './retirement-source-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4000 CodeRabbit round (T3), production seam: a real BeforeModel hook
 * output splits the user's pending turn into fragments through
 * fireBeforeModelHook, the result goes to the real enforcer and the real
 * provider projection, and the user's images are still the ones sent. Only
 * HTTP is stubbed.
 */

import { describe, expect, it } from 'bun:test';
import type { HookExecutionOwner } from '@vybestack/llxprt-code-core/hooks/hookEventHandler.js';
import { HookOutputOwner } from '@vybestack/llxprt-code-core/hooks/hookOutputSnapshot.js';
import { HookModelSnapshotOutput } from '@vybestack/llxprt-code-core/hooks/hookSnapshotAggregator.js';
import { callerOwnedProviderRequest } from '@vybestack/llxprt-code-core/services/history/caller-owned-provider-request.js';
import { tmpdir } from 'node:os';
import { collectRequestRows } from './retirement-source-fixture.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { fireBeforeModelSnapshotHook } from '../../core/beforeModelHookFire.js';
import {
  collectImageData,
  countRetirementNotes,
} from './image-retirement-harness.js';
import { useReliefConversation } from './media-relief-fixtures.js';

/** Raw bytes of a 400,000 character base64 image, as the shared fixtures use. */
const SESSION_IMAGE_BYTES = (400_000 / 4) * 3;

function splittingHook(replacement: IContent[]): HookExecutionOwner {
  return {
    sessionId: () => 'issue4000-hook-boundary',
    transcriptPath: () => undefined,
    beforeModelSnapshot: async () => {
      const output = new HookOutputOwner(tmpdir());
      output.stdout.append(
        Buffer.from(
          JSON.stringify({
            hookSpecificOutput: { llm_request: { contents: replacement } },
          }),
        ),
      );
      const document = output.output(0);
      if (document === undefined) throw new Error('Missing hook output');
      return {
        success: true,
        errors: [],
        totalDuration: 0,
        finalOutput: new HookModelSnapshotOutput([document]),
        close: () => output.dispose(),
      };
    },
  };
}

describe('a BeforeModel hook that splits the user turn (issue #4000 CodeRabbit T3)', () => {
  const conversation = useReliefConversation('llxprt-issue4000-cr-t3-hook-');

  it('leaves the compression boundary unknown yet keeps both user images in the sent request', async () => {
    const session = conversation.session();
    await conversation.seedImages(1);
    const first = await session.admit(SESSION_IMAGE_BYTES, 101);
    const second = await session.admit(SESSION_IMAGE_BYTES, 102);
    const original: IContent = {
      speaker: 'human',
      metadata: { turnId: 'turn-now' },
      blocks: [
        { type: 'text', text: 'look at both' },
        first.reference,
        second.reference,
      ],
    };
    const history = await readCurated(session.history);
    const requestContents =
      await session.history.prepareCuratedForProviderSnapshot([original]);
    const rawPending = await callerOwnedProviderRequest([original]);
    const redactedHistory = history.map((content) =>
      content.speaker === 'ai'
        ? { ...content, blocks: [{ type: 'text' as const, text: 'redacted' }] }
        : content,
    );
    const replacement: IContent[] = [
      ...redactedHistory,
      {
        speaker: 'human',
        metadata: { turnId: 'turn-now' },
        blocks: [{ type: 'text', text: 'look at both' }, first.reference],
      },
      {
        speaker: 'human',
        metadata: { turnId: 'turn-now' },
        blocks: [second.reference],
      },
      { speaker: 'human', blocks: [{ type: 'text', text: 'hook note' }] },
    ];

    const fired = await fireBeforeModelSnapshotHook({
      owner: splittingHook(replacement),
      requestContents,
      rawPending,
      tools: undefined,
      model: 'claude-sonnet-4-20250514',
      log: () => undefined,
    });
    if (fired === undefined) throw new Error('Hook did not fire');
    try {
      await session.send([original], true, {
        pending:
          fired.pendingSelection === undefined
            ? undefined
            : await collectRequestRows(fired.pendingSelection),
        protectedContents: [original],
        contents: await collectRequestRows(fired.contents),
      });
    } finally {
      await fired.close();
      await requestContents.close();
      await rawPending.close();
    }

    const body = session.lastBody();
    expect({
      boundaryKnown: fired.pendingSelection !== undefined,
      sentImages: collectImageData(body, []),
      notes: countRetirementNotes(body),
    }).toStrictEqual({
      boundaryKnown: false,
      sentImages: [first.base64, second.base64],
      notes: 1,
    });
  });
});
