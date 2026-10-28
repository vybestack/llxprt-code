/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'bun:test';
import { EventEmitter } from 'node:events';
import { installTestWorkspacePaths } from '@vybestack/llxprt-code-test-utils/core/config.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { CoreEvent } from '@vybestack/llxprt-code-core/utils/events.js';
import { AgentClient } from '../client.js';

const fixturePaths = installTestWorkspacePaths({
  targetDir: process.cwd(),
  isTrusted: () => true,
});

function buildClient(): AgentClient {
  const config = new Config({
    sessionId: 'test-session-id',
    targetDir: process.cwd(),
  });
  const runtimeState = createAgentRuntimeState({
    runtimeId: 'dispose-test-runtime-001',
    provider: 'gemini',
    model: 'gemini-2.0-flash',
    sessionId: 'dispose-test-session-001',
  });
  return new AgentClient(
    config,
    runtimeState,
    () => undefined,
    new LocalMediaStore({
      rootDirectory: config.projectTempDir + '/media',
      quotaBytes: config.getMediaStoreQuotaByteLimit(),
    }),
    fixturePaths(),
  );
}

describe('AgentClient.dispose', () => {
  it('removes owner-scoped model listeners and is safe on repeated calls', async () => {
    const client = buildClient();
    const notifications = new EventEmitter();
    client.bindModelNotifications((listener) => {
      notifications.on(CoreEvent.ModelChanged, listener);
      notifications.on(CoreEvent.ModelProfileChanged, listener);
      return () => {
        notifications.off(CoreEvent.ModelChanged, listener);
        notifications.off(CoreEvent.ModelProfileChanged, listener);
      };
    });
    const listenerCounts = (): readonly number[] =>
      [CoreEvent.ModelChanged, CoreEvent.ModelProfileChanged].map((event) =>
        notifications.listenerCount(event),
      );

    expect(listenerCounts()).toStrictEqual([1, 1]);
    await client.dispose();
    expect(listenerCounts()).toStrictEqual([0, 0]);
    await client.dispose();
    expect(listenerCounts()).toStrictEqual([0, 0]);
  });

  it('rejects with the error thrown while releasing the model subscription', async () => {
    const client = buildClient();
    const removalError = new Error('old model removal failed');
    client.bindModelNotifications(() => () => {
      throw removalError;
    });

    const disposal = await client.dispose().then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(disposal).toBeInstanceOf(AggregateError);
    expect((disposal as AggregateError).errors).toStrictEqual([removalError]);
  });
});
