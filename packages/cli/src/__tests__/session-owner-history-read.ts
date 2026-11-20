/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { SessionClientOwner } from '../../../agents/src/session/session-client-owner.js';
import { ownerClients } from '../../../agents/src/api/__tests__/helpers/session-client-capture.js';

/**
 * The history service of the client the owner currently delegates to, found
 * through an effect: `getHistoryService` is wrapped on the instance of each
 * client the owner's factory built, a context-range subscription reads the
 * active history, and the wrapper that fired reports what that client returned.
 * The wrappers are removed again before returning.
 */
export function readCurrentOwnerHistory(
  owner: SessionClientOwner,
): HistoryService | null {
  const reads: Array<HistoryService | null> = [];
  const restores = ownerClients(owner).map((client) => {
    const hadOwn = Object.prototype.hasOwnProperty.call(
      client,
      'getHistoryService',
    );
    const previous = client.getHistoryService;
    client.getHistoryService = () => {
      const history = previous.call(client);
      reads.push(history);
      return history;
    };
    return () => {
      if (hadOwn) client.getHistoryService = previous;
      else Reflect.deleteProperty(client, 'getHistoryService');
    };
  });
  try {
    const stop = owner.clients.conversationBinding.subscribeContextRange(
      new Set(),
      () => {},
    );
    stop();
  } finally {
    for (const restore of restores) restore();
  }
  if (reads.length !== 1)
    throw new Error(
      `Expected the active session client to read its history once, saw ${reads.length}`,
    );
  return reads[0];
}
