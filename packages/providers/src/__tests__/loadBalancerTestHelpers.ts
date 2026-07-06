/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared test helpers for LoadBalancingProvider behavioral suites. Extracted to
 * remove verbatim duplication between the active-model and current-model tests.
 */

import type { IProvider } from '../IProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

/** A minimal mock delegate provider that yields a single content chunk. */
export function makeMockProvider(name: string): IProvider {
  return {
    name,
    async *generateChatCompletion(): AsyncIterableIterator<IContent> {
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: `${name} response` }],
      } as IContent;
    },
    getModels: async () => [],
    getDefaultModel: () => 'model',
    getServerTools: () => [],
    invokeServerTool: async () => ({}),
  } as unknown as IProvider;
}

/**
 * A provider that fails immediately: its stream rejects on the first `next()`
 * call, before any chunk is produced. Implemented as a manual async iterator
 * (rather than a generator with an unreachable post-throw `yield`) so there is
 * no dead code to satisfy the require-yield lint rule.
 */
export function makeThrowingProvider(name: string): IProvider {
  return {
    name,
    generateChatCompletion(): AsyncIterableIterator<IContent> {
      return {
        [Symbol.asyncIterator]() {
          return this;
        },
        next(): Promise<IteratorResult<IContent>> {
          return Promise.reject(new Error(`${name} failed before yielding`));
        },
        return(): Promise<IteratorResult<IContent>> {
          return Promise.resolve({
            done: true,
            value: undefined,
          } as IteratorResult<IContent>);
        },
        throw(error?: unknown): Promise<IteratorResult<IContent>> {
          return Promise.reject(
            error instanceof Error ? error : new Error(String(error)),
          );
        },
      };
    },
    getModels: async () => [],
    getDefaultModel: () => 'model',
    getServerTools: () => [],
    invokeServerTool: async () => ({}),
  } as unknown as IProvider;
}

/** Fully consume an async iterator, discarding its chunks. */
export async function drain(
  iterator: AsyncIterableIterator<IContent>,
): Promise<void> {
  for await (const _chunk of iterator) {
    // consume
  }
}
