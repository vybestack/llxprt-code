/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { SessionClientOwner } from '../../../session/session-client-owner.js';
import { acquireSessionClient } from '../../../session/session-client-binding.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { AgentResourceCapture } from './agent-resource-capture.js';
import { buildAgentClientFactory } from '../../agentBootstrap.js';

const acquisitions = new WeakMap<SessionClientOwner, AgentResourceCapture>();
const createSessionOwner = SessionClientOwner.create;

export async function createCapturedSessionOwner(
  ...args: Parameters<typeof SessionClientOwner.create>
): Promise<SessionClientOwner> {
  const capture = new AgentResourceCapture();
  const factory = args[3];
  args[3] = (...operands) => {
    const client = factory(...operands);
    if (client !== undefined) {
      capture.clients.push(client);
      capture.observe(client);
    }
    return client;
  };
  const borrowed = args[10];
  if (borrowed !== undefined) capture.observe(borrowed);
  const owner = await createSessionOwner(...args);
  acquisitions.set(owner, capture);
  return owner;
}

export async function acquireCapturedSessionClient(
  ...args: Parameters<typeof acquireSessionClient>
): Promise<SessionClientOwner> {
  const capture = new AgentResourceCapture();
  const factory = args[9] ?? buildAgentClientFactory();
  args[9] = (...operands) => {
    const client = factory(...operands);
    capture.clients.push(client);
    capture.observe(client);
    return client;
  };
  const borrowed = args[14];
  if (borrowed !== undefined) capture.observe(borrowed);
  const owner = await acquireSessionClient(...args);
  acquisitions.set(owner, capture);
  return owner;
}

export function capturedSessionClient(
  owner: SessionClientOwner,
): AgentClientContract {
  const capture = acquisitions.get(owner);
  if (capture === undefined)
    throw new Error('Session owner has no actual acquisition capture');
  return capture.publishedClient(owner.conversation);
}
