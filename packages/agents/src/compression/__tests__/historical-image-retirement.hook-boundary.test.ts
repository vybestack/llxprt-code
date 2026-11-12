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
import { BeforeModelHookOutput } from '@vybestack/llxprt-code-core/hooks/types.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { fireBeforeModelHook } from '../../core/beforeModelHookFire.js';
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
    beforeModel: async () =>
      new BeforeModelHookOutput({
        hookSpecificOutput: { llm_request: { contents: replacement } },
      }),
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
    const history = session.history.getCurated();
    const requestContents = [...history, original];
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

    const fired = await fireBeforeModelHook({
      owner: splittingHook(replacement),
      requestContents,
      pendingUserIContents: [original],
      tools: undefined,
      hookRestrictedAllowedTools: undefined,
      model: 'claude-sonnet-4-20250514',
      log: () => undefined,
    });
    await session.send([original], true, {
      pending: fired.pendingContents,
      protectedContents: fired.protectedContents,
      contents: fired.contents,
    });

    const body = session.lastBody();
    expect({
      boundaryKnown: fired.pendingContents !== undefined,
      sentImages: collectImageData(body, []),
      notes: countRetirementNotes(body),
    }).toStrictEqual({
      boundaryKnown: false,
      sentImages: [first.base64, second.base64],
      notes: 1,
    });
  });
});
