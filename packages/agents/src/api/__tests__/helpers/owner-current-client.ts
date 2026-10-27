/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { SessionClientOwner } from '../../../session/session-client-owner.js';
import { ownerClients } from './session-client-capture.js';

/**
 * The client the owner currently delegates to, found by an effect: the owner's
 * next public conversation read runs on exactly one client. Each client the
 * owner's factory returned gets an instance wrapper on `getHistory` for the
 * duration of that read.
 */
export async function currentOwnerClient(
  owner: SessionClientOwner,
): Promise<AgentClientContract> {
  const receivers: AgentClientContract[] = [];
  const restores = ownerClients(owner).map((client) => {
    const hadOwn = Object.prototype.hasOwnProperty.call(client, 'getHistory');
    const original = client.getHistory;
    client.getHistory = () => {
      receivers.push(client);
      return original.call(client);
    };
    return () => {
      if (hadOwn) client.getHistory = original;
      else Reflect.deleteProperty(client, 'getHistory');
    };
  });
  try {
    await owner.clients.conversationBinding.conversation.getHistory();
  } finally {
    for (const restore of restores) restore();
  }
  if (receivers.length !== 1)
    throw new Error(
      `Expected one session client to serve the read, got ${receivers.length}`,
    );
  return receivers[0];
}
