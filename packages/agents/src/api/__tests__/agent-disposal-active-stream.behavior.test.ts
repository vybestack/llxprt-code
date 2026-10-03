/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';

type Deferred = {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
};

function deferred(): Deferred {
  let resolvePromise = (): void => {
    throw new Error('Deferred promise was not initialized');
  };
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function requireObject(value: unknown, label: string): object {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${label} is not an object`);
  }
  return value;
}

function invokeMember(record: object, key: string): unknown {
  const value = Reflect.get(record, key);
  if (typeof value !== 'function') {
    throw new Error(`${key} is not a function`);
  }
  return Reflect.apply(value, record, []);
}

function installBlockingLoop(
  agent: Agent,
  started: Deferred,
  aborted: Deferred,
  release: Deferred,
): void {
  const agentObject = requireObject(agent, 'agent');
  const deps = requireObject(Reflect.get(agentObject, 'deps'), 'agent deps');
  const holder = requireObject(Reflect.get(deps, 'loopHolder'), 'loop holder');

  Reflect.set(holder, 'activeRunController', new AbortController());
  Reflect.set(holder, 'boundClient', invokeMember(deps, 'resolveClient'));
  Reflect.set(holder, 'current', {
    run: (_message: unknown, signal: AbortSignal) => {
      let consumed = false;
      return {
        [Symbol.asyncIterator]() {
          return this;
        },
        async next(): Promise<IteratorResult<never>> {
          if (consumed) return { done: true, value: undefined };
          consumed = true;
          started.resolve();
          if (!signal.aborted) {
            await new Promise<void>((resolve) => {
              signal.addEventListener('abort', () => resolve(), { once: true });
            });
          }
          aborted.resolve();
          await release.promise;
          return { done: true, value: undefined };
        },
      };
    },
  });
}

describe('Agent disposal with an active stream', () => {
  it('aborts the owned signal even with a caller signal, joins the stream, and rejects late turns', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    const started = deferred();
    const aborted = deferred();
    const release = deferred();
    const callerController = new AbortController();
    const agent = await fromConfig({ config: built.config });
    installBlockingLoop(agent, started, aborted, release);

    try {
      const iterator = agent
        .stream('wait', { signal: callerController.signal })
        [Symbol.asyncIterator]();
      const pendingNext = iterator.next();
      await started.promise;

      const disposal = agent.dispose();
      await aborted.promise;
      expect(callerController.signal.aborted).toBe(false);

      let disposalSettled = false;
      void disposal.then(
        () => {
          disposalSettled = true;
        },
        () => {
          disposalSettled = true;
        },
      );
      await Promise.resolve();
      expect(disposalSettled).toBe(false);
      await expect(
        agent.stream('late turn')[Symbol.asyncIterator]().next(),
      ).rejects.toThrow('Session is disposing or disposed');

      release.resolve();
      await disposal;
      expect((await pendingNext).done).toBe(true);
      expect(disposalSettled).toBe(true);
    } finally {
      release.resolve();
      await agent.dispose().catch(() => undefined);
      await built.cleanup();
    }
  });
});
