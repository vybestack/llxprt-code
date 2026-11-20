import { readCurated } from './retirement-source-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4000 CodeRabbit round 3 (R5): when a hook removes duplicates from a
 * declared pending item, the item's original occurrence count can make older
 * unlabeled copies of the same image look like missing fragments, so they are
 * protected. Over-protection is the safe direction: the boundary cannot tell a
 * dropped duplicate from an older paste, and guessing the other way would
 * silently retire a current-turn image. The outcome is the explicit
 * PendingMediaBudgetError, never a silent loss. This test pins that decision.
 *
 * Real LocalMediaStore, HistoryService, ProviderContentEnforcer, production
 * send seam and AnthropicProvider projection; only HTTP is stubbed.
 */

import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { PendingMediaBudgetError } from '../pendingMediaBudgetError.js';
import { rejection } from './image-retirement-harness.js';
import { useReliefConversation } from './media-relief-fixtures.js';

/** Raw bytes of a 400,000 character base64 image, as the shared fixtures use. */
const SESSION_IMAGE_BYTES = (400_000 / 4) * 3;

function human(blocks: IContent['blocks'], turnId?: string): IContent {
  return {
    speaker: 'human',
    ...(turnId === undefined ? {} : { metadata: { turnId } }),
    blocks,
  };
}

describe('over-protection after a hook removed pending duplicates (issue #4000 CodeRabbit round 3 R5)', () => {
  const conversation = useReliefConversation('llxprt-issue4000-cr3-r5-');

  it('reports the pending overflow explicitly instead of retiring a possibly current image', async () => {
    const session = conversation.session();
    const shared = await session.admit(SESSION_IMAGE_BYTES, 77);
    const label = { type: 'text' as const, text: 'older paste' };
    session.history.add(human([label, shared.reference]));
    session.history.add(human([label, shared.reference]));
    const original = human(
      [
        { type: 'text', text: 'compare these' },
        shared.reference,
        shared.reference,
        shared.reference,
      ],
      'turn-now',
    );
    const afterHook = human(
      [{ type: 'text', text: 'compare these' }, shared.reference],
      'turn-now',
    );

    const error = await rejection(
      session.send([original], true, {
        pending: [original],
        contents: [...(await readCurated(session.history)), afterHook],
      }),
    );

    expect({
      pendingOverflow: error instanceof PendingMediaBudgetError,
      sent: session.sent.length,
    }).toStrictEqual({ pendingOverflow: true, sent: 0 });
  });
});
