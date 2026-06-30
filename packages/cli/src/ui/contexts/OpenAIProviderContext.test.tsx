/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** @vitest-environment jsdom */

import { type MutableRefObject, act } from 'react';
import { render } from '../../test-utils/render.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  OpenAIProviderContextProvider,
  useOpenAIProviderContext,
} from './OpenAIProviderContext.js';

vi.mock('../hooks/useOpenAIProviderInfo.js', () => ({
  useOpenAIProviderInfo: vi.fn(),
}));

import { useOpenAIProviderInfo } from '../hooks/useOpenAIProviderInfo.js';

type OpenAIProviderInfoReturn = ReturnType<typeof useOpenAIProviderInfo>;

interface ProviderStub {
  name: string;
}

function makeProviderInfo(
  provider: ProviderStub | null,
): OpenAIProviderInfoReturn {
  return {
    provider,
    conversationCache: null,
    isResponsesAPI: false,
    currentModel: provider ? 'test-model' : null,
    remoteTokenInfo: {},
    refresh: () => {},
    getCachedConversation: () => null,
  } as unknown as OpenAIProviderInfoReturn;
}

const TestHarness = ({
  contextRef,
}: {
  contextRef: MutableRefObject<
    ReturnType<typeof useOpenAIProviderContext> | undefined
  >;
}) => {
  contextRef.current = useOpenAIProviderContext();
  return null;
};

const providerA: ProviderStub = { name: 'provider-a' };
const providerB: ProviderStub = { name: 'provider-b' };

function populateStats(
  contextRef: MutableRefObject<
    ReturnType<typeof useOpenAIProviderContext> | undefined
  >,
  prompt: number,
  candidates: number,
  total: number,
): void {
  act(() => {
    contextRef.current?.updateRemoteTokenStats({
      promptTokenCount: prompt,
      candidatesTokenCount: candidates,
      totalTokenCount: total,
    });
  });
}

describe('OpenAIProviderContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useOpenAIProviderInfo).mockReturnValue(
      makeProviderInfo(providerA),
    );
  });

  it('resets remoteTokenStats to zeros when provider changes from A to B', () => {
    const contextRef: MutableRefObject<
      ReturnType<typeof useOpenAIProviderContext> | undefined
    > = { current: undefined };

    const { rerender } = render(
      <OpenAIProviderContextProvider>
        <TestHarness contextRef={contextRef} />
      </OpenAIProviderContextProvider>,
    );

    populateStats(contextRef, 500, 200, 700);
    expect(contextRef.current?.remoteTokenStats.totalTokenCount).toBe(700);

    vi.mocked(useOpenAIProviderInfo).mockReturnValue(
      makeProviderInfo(providerB),
    );

    rerender(
      <OpenAIProviderContextProvider>
        <TestHarness contextRef={contextRef} />
      </OpenAIProviderContextProvider>,
    );

    const stats = contextRef.current?.remoteTokenStats;
    expect(stats?.totalTokenCount).toBe(0);
    expect(stats?.promptTokenCount).toBe(0);
    expect(stats?.candidatesTokenCount).toBe(0);
    expect(stats?.lastUpdated).toBeNull();
  });

  it('does NOT reset when provider stays the same on re-render', () => {
    const contextRef: MutableRefObject<
      ReturnType<typeof useOpenAIProviderContext> | undefined
    > = { current: undefined };

    const { rerender } = render(
      <OpenAIProviderContextProvider>
        <TestHarness contextRef={contextRef} />
      </OpenAIProviderContextProvider>,
    );

    populateStats(contextRef, 500, 200, 700);

    vi.mocked(useOpenAIProviderInfo).mockReturnValue(
      makeProviderInfo(providerA),
    );

    rerender(
      <OpenAIProviderContextProvider>
        <TestHarness contextRef={contextRef} />
      </OpenAIProviderContextProvider>,
    );

    expect(contextRef.current?.remoteTokenStats.totalTokenCount).toBe(700);
  });

  it('resets when provider becomes null', () => {
    const contextRef: MutableRefObject<
      ReturnType<typeof useOpenAIProviderContext> | undefined
    > = { current: undefined };

    const { rerender } = render(
      <OpenAIProviderContextProvider>
        <TestHarness contextRef={contextRef} />
      </OpenAIProviderContextProvider>,
    );

    populateStats(contextRef, 500, 200, 700);

    vi.mocked(useOpenAIProviderInfo).mockReturnValue(makeProviderInfo(null));

    rerender(
      <OpenAIProviderContextProvider>
        <TestHarness contextRef={contextRef} />
      </OpenAIProviderContextProvider>,
    );

    expect(contextRef.current?.remoteTokenStats.totalTokenCount).toBe(0);
  });
});
