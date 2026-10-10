/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type { IdeClient, IdeContext } from '@vybestack/llxprt-code-core';
import { renderHook } from '../../../../__tests__/render.js';
import { useIdeContextBridge } from './useIdeContextBridge.js';

type ContextListener = (context: IdeContext | undefined) => void;

function createClient(initial: IdeContext | undefined) {
  let context = initial;
  const listeners = new Set<ContextListener>();
  const client = {
    getIdeContext: () => context,
    addContextChangeListener: (listener: ContextListener) =>
      listeners.add(listener),
    removeContextChangeListener: (listener: ContextListener) =>
      listeners.delete(listener),
  } as unknown as IdeClient;
  return {
    client,
    listenerCount: () => listeners.size,
    publish: (next: IdeContext | undefined) => {
      context = next;
      for (const listener of listeners) listener(next);
    },
  };
}

describe('useIdeContextBridge', () => {
  it('mirrors the owner IDE client context into UI state and stops on unmount', () => {
    const owner = createClient({
      workspaceState: { isTrusted: true },
    });
    const seen: Array<IdeContext | undefined> = [];
    const { unmount } = renderHook(() =>
      useIdeContextBridge({
        ide: { getIdeClient: () => owner.client },
        setIdeContextState: (value) => seen.push(value),
      }),
    );
    expect(seen.at(-1)?.workspaceState?.isTrusted).toBe(true);

    owner.publish({ workspaceState: { isTrusted: false } });
    expect(seen.at(-1)?.workspaceState?.isTrusted).toBe(false);

    unmount();
    expect(owner.listenerCount()).toBe(0);
  });

  it('reports no context when the owner has no IDE client', () => {
    const seen: Array<IdeContext | undefined> = [];
    renderHook(() =>
      useIdeContextBridge({
        ide: { getIdeClient: () => undefined },
        setIdeContextState: (value) => seen.push(value),
      }),
    );
    expect(seen).toStrictEqual([undefined]);
  });
});
