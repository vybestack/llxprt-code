/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, spyOn, vi } from 'bun:test';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { AgentClient } from '../../core/client.js';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createAgent } from '../createAgent.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {
    throw new Error('Uninitialized gate');
  };
  const promise = new Promise<void>((ready) => {
    resolve = ready;
  });
  return { promise, resolve };
}

describe('History observer admission', () => {
  const credentials = useOwnedCredentials();

  for (const method of ['tokens', 'recording']) {
    it(`rejects ${method} observers synchronously during joined shutdown and after disposal without allocating intervals`, async () => {
      const home = process.env.LLXPRT_CONFIG_HOME;
      if (home === undefined) throw new Error('Missing isolated home');
      const directory = join(home, 'workspace');
      await mkdir(directory, { recursive: true });
      const agent = await createAgent({
        provider: 'openai',
        model: 'observer-admission',
        auth: { apiKey: 'nonsecret-test-key' },
        workingDir: directory,
        credentialAuthority: credentials().authority,
        oauthSettings: null,
        mcpEnabled: false,
        skillsSupport: false,
        telemetry: { enabled: false },
        harness: {
          includeProcessCwd: false,
          forceInteractive: false,
          forceConfirmations: false,
        },
        settings: { storageRoot: home, enableHooks: false },
      });
      const entered = deferred();
      const release = deferred();
      const histories = new Set<HistoryService>();
      const read = AgentClient.prototype.getHistory;
      const held = spyOn(
        AgentClient.prototype,
        'getHistory',
      ).mockImplementation(async function (this: AgentClient) {
        const result = await read.call(this);
        const history = this.getHistoryService();
        if (history !== null) histories.add(history);
        entered.resolve();
        await release.promise;
        return result;
      });
      const accepted = agent.session.getHistory();
      await entered.promise;
      let closed = false;
      const closing = agent.dispose().then(() => {
        closed = true;
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      vi.useFakeTimers();
      const listeners = [...histories].map((history) =>
        history.listenerCount('tokensUpdated'),
      );
      const stops: Array<() => void> = [];
      const subscribe = (): void => {
        stops.push(
          method === 'tokens'
            ? agent.session.subscribeHistoryTokens(() => {})
            : agent.session.connectRecordingHistory(() => null),
        );
      };
      const assertObserverRejected = (): void => {
        expect(subscribe).toThrow('Session disposed');
        expect(vi.getTimerCount()).toBe(0);
        expect(
          [...histories].map((history) =>
            history.listenerCount('tokensUpdated'),
          ),
        ).toStrictEqual(listeners);
      };
      try {
        expect(closed).toBe(false);
        assertObserverRejected();
        release.resolve();
        await accepted;
        await closing;
        expect(closed).toBe(true);
        assertObserverRejected();
      } finally {
        for (const stop of stops) stop();
        vi.clearAllTimers();
        vi.useRealTimers();
        held.mockRestore();
        release.resolve();
        await accepted;
        await closing;
      }
    });
  }
});
