/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type MutableRefObject } from 'react';
import { render } from 'ink-testing-library';
import { act } from 'react-dom/test-utils';
import {
  SessionStatsProvider,
  useSessionStatsState,
  useSessionStatsDispatch,
} from './SessionContext.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GenerateContentResponseUsageMetadata } from '@google/genai';

// Mock data that simulates what the Gemini API would return.
const mockMetadata1: GenerateContentResponseUsageMetadata = {
  promptTokenCount: 100,
  candidatesTokenCount: 200,
  totalTokenCount: 300,
  cachedContentTokenCount: 50,
  toolUsePromptTokenCount: 10,
  thoughtsTokenCount: 20,
};

const mockMetadata2: GenerateContentResponseUsageMetadata = {
  promptTokenCount: 10,
  candidatesTokenCount: 20,
  totalTokenCount: 30,
  cachedContentTokenCount: 5,
  toolUsePromptTokenCount: 1,
  thoughtsTokenCount: 2,
};

/**
 * A test harness component that uses the hook and exposes the context value
 * via a mutable ref. This allows us to interact with the context's functions
 * and assert against its state directly in our tests.
 */
const TestHarness = ({
  stateRef,
  dispatchRef,
}: {
  stateRef: MutableRefObject<
    ReturnType<typeof useSessionStatsState> | undefined
  >;
  dispatchRef: MutableRefObject<
    ReturnType<typeof useSessionStatsDispatch> | undefined
  >;
}) => {
  stateRef.current = useSessionStatsState();
  dispatchRef.current = useSessionStatsDispatch();
  return null;
};

describe('SessionStatsContext', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  it('should provide the correct initial state', () => {
    const stateRef: MutableRefObject<
      ReturnType<typeof useSessionStatsState> | undefined
    > = { current: undefined };
    const dispatchRef: MutableRefObject<
      ReturnType<typeof useSessionStatsDispatch> | undefined
    > = { current: undefined };

    render(
      <SessionStatsProvider>
        <TestHarness stateRef={stateRef} dispatchRef={dispatchRef} />
      </SessionStatsProvider>,
    );

    const stats = stateRef.current;

    expect(stats?.sessionStartTime).toBeInstanceOf(Date);
    expect(stats?.currentTurn).toBeDefined();
    expect(stats?.cumulative.turnCount).toBe(0);
    expect(stats?.cumulative.totalTokenCount).toBe(0);
    expect(stats?.cumulative.promptTokenCount).toBe(0);
  });

  it('should increment turnCount when startNewTurn is called', () => {
    const stateRef: MutableRefObject<
      ReturnType<typeof useSessionStatsState> | undefined
    > = { current: undefined };
    const dispatchRef: MutableRefObject<
      ReturnType<typeof useSessionStatsDispatch> | undefined
    > = { current: undefined };

    render(
      <SessionStatsProvider>
        <TestHarness stateRef={stateRef} dispatchRef={dispatchRef} />
      </SessionStatsProvider>,
    );

    act(() => {
      dispatchRef.current?.startNewTurn();
    });

    const stats = stateRef.current;
    expect(stats?.currentTurn.totalTokenCount).toBe(0);
    expect(stats?.cumulative.turnCount).toBe(1);
    // Ensure token counts are unaffected
    expect(stats?.cumulative.totalTokenCount).toBe(0);
  });

  it('should aggregate token usage correctly when addUsage is called', async () => {
    const stateRef: MutableRefObject<
      ReturnType<typeof useSessionStatsState> | undefined
    > = { current: undefined };
    const dispatchRef: MutableRefObject<
      ReturnType<typeof useSessionStatsDispatch> | undefined
    > = { current: undefined };

    render(
      <SessionStatsProvider>
        <TestHarness stateRef={stateRef} dispatchRef={dispatchRef} />
      </SessionStatsProvider>,
    );

    act(() => {
      dispatchRef.current?.addUsage({ ...mockMetadata1, apiTimeMs: 123 });
    });

    // Advance timers to trigger the debounced flush
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const stats = stateRef.current;

    // Check that token counts are updated
    expect(stats?.cumulative.totalTokenCount).toBe(
      mockMetadata1.totalTokenCount ?? 0,
    );
    expect(stats?.cumulative.promptTokenCount).toBe(
      mockMetadata1.promptTokenCount ?? 0,
    );
    expect(stats?.cumulative.apiTimeMs).toBe(123);

    // Check that turn count is NOT incremented
    expect(stats?.cumulative.turnCount).toBe(0);

    // Check that currentTurn is updated
    expect(stats?.currentTurn?.totalTokenCount).toEqual(
      mockMetadata1.totalTokenCount,
    );
    expect(stats?.currentTurn?.apiTimeMs).toBe(123);
  });

  it('should correctly track a full logical turn with multiple API calls', async () => {
    const stateRef: MutableRefObject<
      ReturnType<typeof useSessionStatsState> | undefined
    > = { current: undefined };
    const dispatchRef: MutableRefObject<
      ReturnType<typeof useSessionStatsDispatch> | undefined
    > = { current: undefined };

    render(
      <SessionStatsProvider>
        <TestHarness stateRef={stateRef} dispatchRef={dispatchRef} />
      </SessionStatsProvider>,
    );

    // 1. User starts a new turn
    act(() => {
      dispatchRef.current?.startNewTurn();
    });

    // 2. First API call (e.g., prompt with a tool request)
    act(() => {
      dispatchRef.current?.addUsage({ ...mockMetadata1, apiTimeMs: 100 });
    });

    // 3. Second API call (e.g., sending tool response back)
    act(() => {
      dispatchRef.current?.addUsage({ ...mockMetadata2, apiTimeMs: 50 });
    });

    // Advance timers to trigger the debounced flush
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const stats = stateRef.current;

    // Turn count should only be 1
    expect(stats?.cumulative.turnCount).toBe(1);

    // --- Check Cumulative Stats ---
    // These fields should be the SUM of both calls
    expect(stats?.cumulative.totalTokenCount).toBe(300 + 30);
    expect(stats?.cumulative.candidatesTokenCount).toBe(200 + 20);
    expect(stats?.cumulative.thoughtsTokenCount).toBe(20 + 2);
    expect(stats?.cumulative.apiTimeMs).toBe(100 + 50);

    // These fields should be the SUM of both calls
    expect(stats?.cumulative.promptTokenCount).toBe(100 + 10);
    expect(stats?.cumulative.cachedContentTokenCount).toBe(50 + 5);
    expect(stats?.cumulative.toolUsePromptTokenCount).toBe(10 + 1);

    // --- Check Current Turn Stats ---
    // All fields should be the SUM of both calls for the turn
    expect(stats?.currentTurn.totalTokenCount).toBe(300 + 30);
    expect(stats?.currentTurn.candidatesTokenCount).toBe(200 + 20);
    expect(stats?.currentTurn.thoughtsTokenCount).toBe(20 + 2);
    expect(stats?.currentTurn.promptTokenCount).toBe(100 + 10);
    expect(stats?.currentTurn.cachedContentTokenCount).toBe(50 + 5);
    expect(stats?.currentTurn.toolUsePromptTokenCount).toBe(10 + 1);
    expect(stats?.currentTurn.apiTimeMs).toBe(100 + 50);
  });

  it('should overwrite currentResponse with each API call', async () => {
    const stateRef: MutableRefObject<
      ReturnType<typeof useSessionStatsState> | undefined
    > = { current: undefined };
    const dispatchRef: MutableRefObject<
      ReturnType<typeof useSessionStatsDispatch> | undefined
    > = { current: undefined };

    render(
      <SessionStatsProvider>
        <TestHarness stateRef={stateRef} dispatchRef={dispatchRef} />
      </SessionStatsProvider>,
    );

    // 1. First API call
    act(() => {
      dispatchRef.current?.addUsage({ ...mockMetadata1, apiTimeMs: 100 });
    });

    // Advance timers to trigger the debounced flush
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    let stats = stateRef.current;

    // currentResponse should match the first call
    expect(stats?.currentResponse.totalTokenCount).toBe(300);
    expect(stats?.currentResponse.apiTimeMs).toBe(100);

    // 2. Second API call
    act(() => {
      dispatchRef.current?.addUsage({ ...mockMetadata2, apiTimeMs: 50 });
    });

    // Advance timers to trigger the debounced flush
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    stats = stateRef.current;

    // currentResponse should now match the second call
    expect(stats?.currentResponse.totalTokenCount).toBe(30);
    expect(stats?.currentResponse.apiTimeMs).toBe(50);

    // 3. Start a new turn
    act(() => {
      dispatchRef.current?.startNewTurn();
    });

    stats = stateRef.current;

    // currentResponse should be reset
    expect(stats?.currentResponse.totalTokenCount).toBe(0);
    expect(stats?.currentResponse.apiTimeMs).toBe(0);
  });

  it('should throw an error when useSessionStats is used outside of a provider', () => {
    // Suppress the expected console error during this test.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const stateRef = { current: undefined };
    const dispatchRef = { current: undefined };

    // We expect rendering to fail, which React will catch and log as an error.
    render(<TestHarness stateRef={stateRef} dispatchRef={dispatchRef} />);

    // Assert that the first argument of the first call to console.error
    // contains the expected message. This is more robust than checking
    // the exact arguments, which can be affected by React/JSDOM internals.
    expect(errorSpy.mock.calls[0][0]).toContain(
      'useSessionStatsState must be used within a SessionStatsProvider',
    );

    errorSpy.mockRestore();
  });

  it('should debounce multiple consecutive addUsage calls into a single state update', async () => {
    let renderCount = 0;
    const RenderCounter = ({
      stateRef,
      dispatchRef,
    }: {
      stateRef: MutableRefObject<
        ReturnType<typeof useSessionStatsState> | undefined
      >;
      dispatchRef: MutableRefObject<
        ReturnType<typeof useSessionStatsDispatch> | undefined
      >;
    }) => {
      renderCount++;
      stateRef.current = useSessionStatsState();
      dispatchRef.current = useSessionStatsDispatch();
      return null;
    };

    const stateRef: MutableRefObject<
      ReturnType<typeof useSessionStatsState> | undefined
    > = { current: undefined };
    const dispatchRef: MutableRefObject<
      ReturnType<typeof useSessionStatsDispatch> | undefined
    > = { current: undefined };

    render(
      <SessionStatsProvider>
        <RenderCounter stateRef={stateRef} dispatchRef={dispatchRef} />
      </SessionStatsProvider>,
    );

    const initialRenderCount = renderCount;

    // Make multiple consecutive addUsage calls synchronously
    act(() => {
      dispatchRef.current?.addUsage({ ...mockMetadata1, apiTimeMs: 100 });
      dispatchRef.current?.addUsage({ ...mockMetadata2, apiTimeMs: 50 });
      dispatchRef.current?.addUsage({ ...mockMetadata1, apiTimeMs: 75 });
    });

    // At this point, no additional renders should have happened yet (updates are queued)
    expect(renderCount).toBe(initialRenderCount);

    // Advance timers to trigger the debounced flush
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const finalRenderCount = renderCount;
    const updatedStats = stateRef.current;

    // Verify the stats were aggregated correctly (sum of all three calls)
    expect(updatedStats?.cumulative.totalTokenCount).toBe(300 + 30 + 300); // 630
    expect(updatedStats?.cumulative.apiTimeMs).toBe(100 + 50 + 75); // 225

    // Verify currentResponse shows only the last call (overwrite behavior)
    expect(updatedStats?.currentResponse.totalTokenCount).toBe(300); // Last call was mockMetadata1
    expect(updatedStats?.currentResponse.apiTimeMs).toBe(75); // Last call was 75ms

    // The key assertion: verify we had minimal re-renders
    // We should have had only 1 additional render (from the batched state update)
    const additionalRenders = finalRenderCount - initialRenderCount;
    expect(additionalRenders).toBe(1); // Only one render for the batched update
  });

  it('should immediately flush pending updates when startNewTurn is called', async () => {
    const stateRef: MutableRefObject<
      ReturnType<typeof useSessionStatsState> | undefined
    > = { current: undefined };
    const dispatchRef: MutableRefObject<
      ReturnType<typeof useSessionStatsDispatch> | undefined
    > = { current: undefined };

    render(
      <SessionStatsProvider>
        <TestHarness stateRef={stateRef} dispatchRef={dispatchRef} />
      </SessionStatsProvider>,
    );

    // Add some usage without waiting for the debounce
    act(() => {
      dispatchRef.current?.addUsage({ ...mockMetadata1, apiTimeMs: 100 });
    });

    // Immediately call startNewTurn (should flush pending updates)
    act(() => {
      dispatchRef.current?.startNewTurn();
    });

    const stats = stateRef.current;

    // Verify the usage was applied despite not waiting for debounce
    expect(stats?.cumulative.totalTokenCount).toBe(300);
    expect(stats?.cumulative.turnCount).toBe(1);
    expect(stats?.cumulative.apiTimeMs).toBe(100);

    // Verify currentTurn was reset for the new turn
    expect(stats?.currentTurn.totalTokenCount).toBe(0);
    expect(stats?.currentTurn.apiTimeMs).toBe(0);
  });

  it('should handle rapid updates without maximum update depth errors', async () => {
    const stateRef: MutableRefObject<
      ReturnType<typeof useSessionStatsState> | undefined
    > = { current: undefined };
    const dispatchRef: MutableRefObject<
      ReturnType<typeof useSessionStatsDispatch> | undefined
    > = { current: undefined };

    render(
      <SessionStatsProvider>
        <TestHarness stateRef={stateRef} dispatchRef={dispatchRef} />
      </SessionStatsProvider>,
    );

    // Simulate rapid fire events that previously caused the error
    act(() => {
      for (let i = 0; i < 100; i++) {
        dispatchRef.current?.addUsage({
          promptTokenCount: i,
          candidatesTokenCount: i,
          totalTokenCount: i * 2,
          apiTimeMs: 10,
        });
      }
    });

    // Wait for debounce
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const stats = stateRef.current;

    // Verify all updates were processed correctly
    // Sum of 0..99 = 4950, totalTokenCount is 2x that
    expect(stats?.cumulative.promptTokenCount).toBe(4950);
    expect(stats?.cumulative.candidatesTokenCount).toBe(4950);
    expect(stats?.cumulative.totalTokenCount).toBe(9900);
    expect(stats?.cumulative.apiTimeMs).toBe(1000); // 100 * 10

    // Verify last update is in currentResponse
    expect(stats?.currentResponse.promptTokenCount).toBe(99);
    expect(stats?.currentResponse.candidatesTokenCount).toBe(99);
    expect(stats?.currentResponse.totalTokenCount).toBe(198);
  });

  it('should properly clean up on unmount', async () => {
    const stateRef: MutableRefObject<
      ReturnType<typeof useSessionStatsState> | undefined
    > = { current: undefined };
    const dispatchRef: MutableRefObject<
      ReturnType<typeof useSessionStatsDispatch> | undefined
    > = { current: undefined };

    const { unmount } = render(
      <SessionStatsProvider>
        <TestHarness stateRef={stateRef} dispatchRef={dispatchRef} />
      </SessionStatsProvider>,
    );

    // Add some usage
    act(() => {
      dispatchRef.current?.addUsage({ ...mockMetadata1, apiTimeMs: 100 });
    });

    // Unmount before the debounce completes
    unmount();

    // Advance timers - should not cause any errors
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    // Test passes if no errors are thrown
  });
});
