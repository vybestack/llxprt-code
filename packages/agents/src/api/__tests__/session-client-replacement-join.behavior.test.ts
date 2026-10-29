/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { buildAgentClientFactory } from '../agentBootstrap.js';
import { cleanupFailedCreatedAgent } from '../createAgent.js';
import { gate as createGate } from './helpers/async-child-disposal-join-fixture.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import {
  openSessionClientEngine,
  type SessionClientFactory,
} from './helpers/session-client-engine.js';

/**
 * The production client factory, with the test observing or faulting each real
 * client it returns on the instance. Nothing is patched on the class.
 */
function interceptClients(
  intercept: (client: AgentClientContract) => void,
): SessionClientFactory {
  const production = buildAgentClientFactory();
  return (...operands) => {
    const client = production(...operands);
    intercept(client);
    return client;
  };
}

describe('Session owner cleanup joining', () => {
  const credentials = useOwnedCredentials();
  useFakeResponsesReplay('multi-turn-text.jsonl');
  it('joins the preflight client before media cleanup when adoption runtime construction fails', async () => {
    const engine = await openSessionClientEngine(credentials().authority);
    let cleanupStates: readonly boolean[] = [];
    try {
      await engine.openStartedOwner();
      const owner = await engine.createOwner(
        interceptClients((client) => {
          const dispose = client.dispose.bind(client);
          client.dispose = async () => {
            const open = await engine.media.store.getStoredByteLength().then(
              () => true,
              () => false,
            );
            cleanupStates = [...cleanupStates, open];
            await dispose();
          };
        }),
      );
      await expect(
        cleanupFailedCreatedAgent(
          new Error('Runtime assembly fault'),
          () => engine.release.close(),
          engine.media,
          () => owner.dispose(),
          () => engine.mcp.dispose(),
        ),
      ).rejects.toThrow('Runtime assembly fault');
      expect(cleanupStates.length).toBeGreaterThan(0);
      expect(cleanupStates).not.toContain(false);
      await expect(engine.media.store.getStoredByteLength()).rejects.toThrow(
        /closed/i,
      );
    } finally {
      await engine.close();
    }
  }, 30000);
  it('joins an accepted replacement and closes every owned client before resolving disposal', async () => {
    const engine = await openSessionClientEngine(credentials().authority);
    let subscriptions = 0;
    const subscribe = engine.settingsOwner.subscribeModelChanges.bind(
      engine.settingsOwner,
    );
    engine.settingsOwner.subscribeModelChanges = (listener) => {
      const unsubscribe = subscribe(listener);
      subscriptions += 1;
      return () => {
        try {
          unsubscribe();
        } finally {
          subscriptions -= 1;
        }
      };
    };
    try {
      await engine.openStartedOwner();
      const entered = createGate();
      const released = createGate();
      const before = subscriptions;
      const owner = await engine.createOwner(
        interceptClients((client) => {
          const initialize = client.initialize.bind(client);
          client.initialize = async (content) => {
            entered.release();
            await released.promise;
            await initialize(content);
          };
        }),
      );
      const pending = owner.clients.refreshAuth();
      await entered.promise;
      let closed = false;
      const closing = owner.dispose().then(() => {
        closed = true;
      });
      try {
        await Promise.resolve();
        await Promise.resolve();
        expect(closed).toBe(false);
      } finally {
        released.release();
        await pending;
        await closing;
        await engine.close();
      }
      expect(subscriptions).toBe(before - 1);
    } finally {
      await engine.close();
    }
  }, 30000);
  it('still closes separately owned media when client cleanup rejects', async () => {
    const engine = await openSessionClientEngine(credentials().authority);
    try {
      await engine.openStartedOwner();
      const owner = await engine.createOwner(
        interceptClients((client) => {
          const dispose = client.dispose.bind(client);
          client.dispose = async () => {
            await dispose();
            throw new Error('Client cleanup fault');
          };
        }),
      );
      await expect(
        cleanupFailedCreatedAgent(
          new Error('Activation failed'),
          () => engine.release.close(),
          engine.media,
          () => owner.dispose(),
          () => engine.mcp.dispose(),
        ),
      ).rejects.toThrow(/cleanup/i);
      await expect(engine.media.store.getStoredByteLength()).rejects.toThrow(
        /closed/i,
      );
    } finally {
      await engine.close();
    }
  }, 30000);
});
