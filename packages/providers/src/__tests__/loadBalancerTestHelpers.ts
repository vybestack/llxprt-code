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
import {
  createRuntimeInvocationContext,
  type RuntimeInvocationContext,
} from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import type { NetworkFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';

const rejectingFetch: NetworkFetch = () =>
  Promise.reject(new Error('This test must not make network requests'));

/**
 * The invocation a load-balancer call receives from the manager's wrapper. A
 * load-balancer call without one throws, so tests that call the provider
 * directly hand it this parent invocation; its fetch rejects because these
 * suites never reach a network.
 */
export function makeLoadBalancerInvocation(): RuntimeInvocationContext {
  return createRuntimeInvocationContext({
    fetch: rejectingFetch,
    providerName: 'load-balancer',
    ephemeralsSnapshot: {},
    fallbackRuntimeId: 'load-balancer-test',
  });
}

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
