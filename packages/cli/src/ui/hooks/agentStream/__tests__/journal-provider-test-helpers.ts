/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { spyOn } from 'bun:test';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { IContent } from '@vybestack/llxprt-code-core';
import { FakeProvider } from '../../../../../../providers/src/fake/FakeProvider.js';

export function scriptProvider(
  agent: Agent,
  generate: () => AsyncIterableIterator<IContent>,
): ReturnType<typeof spyOn<FakeProvider, 'generateChatCompletion'>> {
  if (agent.getProvider() !== 'fake') throw new Error('Missing fake provider');
  return spyOn(
    FakeProvider.prototype,
    'generateChatCompletion',
  ).mockImplementation(generate);
}

export function gate(): { readonly promise: Promise<void>; release(): void } {
  let release = (): void => {
    throw new Error('Uninitialized gate');
  };
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
