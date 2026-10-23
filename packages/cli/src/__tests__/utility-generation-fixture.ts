/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core';
import type { GenerateChatOptions } from '@vybestack/llxprt-code-providers';
import type { GenerationProvider } from '../../../agents/src/api/__tests__/helpers/generation-owner-fixture.js';

export function useCliGenerationEnvironment(): void {
  let navigator: PropertyDescriptor | undefined;
  beforeEach(() => {
    navigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Reflect.deleteProperty(globalThis, 'navigator');
  });
  afterEach(() => {
    if (navigator !== undefined)
      Object.defineProperty(globalThis, 'navigator', navigator);
  });
}

export function servePromptChunks(
  provider: GenerationProvider,
  chunks: readonly string[],
): void {
  provider.generateChatCompletion = async function* (
    options: GenerateChatOptions | IContent[],
  ): AsyncIterableIterator<IContent> {
    if (Array.isArray(options)) throw new Error('Expected provider invocation');
    provider.requests = [...provider.requests, options];
    await provider.generating?.(options);
    for (const text of chunks)
      yield { speaker: 'ai', blocks: [{ type: 'text', text }] };
  };
}
