/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, vi } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { createAgent } from '../../createAgent.js';
import { AggregateDisposeError } from '../../disposeErrors.js';
import { buildAgentClientFactory } from '../../agentBootstrap.js';
import { createAgentRuntimeFactoryBindings } from '../../runtimeFactories.js';

/**
 * Builds agents through `createAgent` whose session client fails its
 * disposal. The failure is injected on the real client the agent retains,
 * the last one its client factory returned (an instance spy). The returned function disposes the
 * agent and yields the failures its disposal reports.
 */
export function installFailingSessionFixture(): (
  failure: Error,
) => Promise<() => Promise<readonly unknown[]>> {
  const directories: string[] = [];
  afterEach(async () => {
    const removals = await Promise.allSettled(
      directories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
    const failures = removals.flatMap((removal) =>
      removal.status === 'rejected' ? [removal.reason] : [],
    );
    if (failures.length > 0)
      throw new AggregateError(failures, 'Failing session cleanup failed');
  });
  return async (failure) => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'failing-session-')),
    );
    directories.push(directory);
    const bindings = createAgentRuntimeFactoryBindings();
    const createClient = buildAgentClientFactory();
    const built: AgentClientContract[] = [];
    const agent = await createAgent({
      provider: 'fake',
      model: 'fake-model',
      workingDir: directory,
      runtimeFactoryBindings: {
        ...bindings,
        agentClientFactory: (...operands) => {
          const client = createClient(...operands);
          built.push(client);
          return client;
        },
      },
    });
    // Activation replaces and disposes clients while the agent is built, so
    // the failure goes on the client the finished agent retains.
    const retained = built[built.length - 1];
    vi.spyOn(retained, 'dispose').mockImplementation(async () => {
      throw failure;
    });
    return async (): Promise<readonly unknown[]> =>
      Promise.resolve(agent.dispose()).then(
        () => {
          throw new Error('Expected session cleanup failure');
        },
        (error: unknown) => {
          if (!(error instanceof AggregateDisposeError)) throw error;
          return error.errors;
        },
      );
  };
}
