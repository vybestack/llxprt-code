/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createChatSessionRuntime } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import type { IProvider } from '@vybestack/llxprt-code-providers/IProvider.js';
import { prepareAtSendSeam } from './promptEnvelopeSendSeam.js';

describe('prepareAtSendSeam', () => {
  it(
    'awaits projection cleanup before an estimation failure escapes',
    awaitsProjectionCleanupBeforeEstimationFailure,
  );
});

async function awaitsProjectionCleanupBeforeEstimationFailure(): Promise<void> {
  const cleanupEvents: string[] = [];
  const provider: IProvider = {
    name: 'failing-estimate-provider',
    getModels: () => Promise.resolve([]),
    getServerTools: () => [],
    invokeServerTool: () => Promise.resolve(undefined),
    async *generateChatCompletion(): AsyncIterableIterator<IContent> {
      yield { speaker: 'ai', blocks: [{ type: 'text', text: 'unused' }] };
    },
    projectPromptEnvelope: () =>
      Promise.resolve({
        model: '',
        protocol: 'anthropic-messages',
        method: 'messages/v1',
        projectionRevision: 1,
        unsupportedMedia: [],
        transportToken: Object.freeze({}),
        finalizedProjection: [],
        legacyEstimate: () => Promise.resolve(1),
        releaseIfUnsent: async () => {
          await Promise.resolve();
          cleanupEvents.push('released');
        },
      }),
  };
  const runtime = createChatSessionRuntime({ provider });

  const error = await prepareAtSendSeam(provider, {
    contents: [],
    config: runtime.config,
  }).catch((reason: unknown) => reason);

  expect(error).toBeInstanceOf(Error);
  expect(cleanupEvents).toStrictEqual(['released']);
}
