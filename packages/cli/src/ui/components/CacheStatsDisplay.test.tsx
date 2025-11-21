/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'ink-testing-library';
import { describe, it, expect, vi } from 'vitest';
import { CacheStatsDisplay } from './CacheStatsDisplay.js';
import * as SessionContext from '../contexts/SessionContext.js';
import { SessionMetrics } from '../contexts/SessionContext.js';

// Mock the context to provide controlled data for testing
vi.mock('../contexts/SessionContext.js', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionContext>();
  return {
    ...actual,
    useSessionStats: vi.fn(),
  };
});

const useSessionStatsMock = vi.mocked(SessionContext.useSessionStats);

const renderWithMockedStats = (metrics: SessionMetrics) => {
  useSessionStatsMock.mockReturnValue({
    stats: {
      sessionStartTime: new Date(),
      metrics,
      lastPromptTokenCount: 0,
      promptCount: 5,
      sessionId: 'test-session',
      historyTokenCount: 0,
    },

    getPromptCount: () => 5,
    startNewPrompt: vi.fn(),
    updateHistoryTokenCount: vi.fn(),
  });

  return render(<CacheStatsDisplay />);
};

describe('<CacheStatsDisplay />', () => {
  it('should render "no cache data" message when there are no cache hits', () => {
    const { lastFrame } = renderWithMockedStats({
      models: {
        'test-model': {
          api: {
            totalRequests: 5,
            totalErrors: 0,
            totalLatencyMs: 1000,
          },
          tokens: {
            prompt: 1000,
            candidates: 500,
            total: 1500,
            cached: 0,
            thoughts: 0,
            tool: 0,
          },
        },
      },
      tools: {
        totalCalls: 0,
        totalSuccess: 0,
        totalFail: 0,
        totalDurationMs: 0,
        totalDecisions: { accept: 0, reject: 0, modify: 0, auto_accept: 0 },
        byName: {},
      },
      files: {
        totalLinesAdded: 0,
        totalLinesRemoved: 0,
      },
      tokenTracking: {
        tokensPerMinute: 0,
        throttleWaitTimeMs: 0,
        sessionTokenUsage: {
          input: 1000,
          output: 500,
          cache: 0,
          tool: 0,
          thought: 0,
          total: 1500,
        },
      },
    });

    expect(lastFrame()).toContain('No cache data available');
    expect(lastFrame()).toContain('Anthropic');
  });

  it('should display cache statistics when cache data is available', () => {
    const { lastFrame } = renderWithMockedStats({
      models: {
        'claude-3-5-sonnet': {
          api: {
            totalRequests: 5,
            totalErrors: 0,
            totalLatencyMs: 1000,
          },
          tokens: {
            prompt: 10000,
            candidates: 5000,
            total: 13000,
            cached: 2000,
            thoughts: 0,
            tool: 0,
          },
        },
      },
      tools: {
        totalCalls: 0,
        totalSuccess: 0,
        totalFail: 0,
        totalDurationMs: 0,
        totalDecisions: { accept: 0, reject: 0, modify: 0, auto_accept: 0 },
        byName: {},
      },
      files: {
        totalLinesAdded: 0,
        totalLinesRemoved: 0,
      },
      tokenTracking: {
        tokensPerMinute: 0,
        throttleWaitTimeMs: 0,
        sessionTokenUsage: {
          input: 10000,
          output: 5000,
          cache: 2000,
          tool: 0,
          thought: 0,
          total: 13000,
        },
      },
    });

    const output = lastFrame();
    expect(output).toContain('Cache Stats For Nerds');
    expect(output).toContain('Total Cache Reads');
    expect(output).toContain('2,000');
    expect(output).toContain('Cache Hit Rate');
    expect(output).toContain('20.0%');
    expect(output).toContain('Token Savings');
    expect(output).toContain('1,800');
  });

  it('should handle multiple models with cache data', () => {
    const { lastFrame } = renderWithMockedStats({
      models: {
        'claude-3-5-sonnet': {
          api: {
            totalRequests: 3,
            totalErrors: 0,
            totalLatencyMs: 500,
          },
          tokens: {
            prompt: 5000,
            candidates: 2000,
            total: 6500,
            cached: 1000,
            thoughts: 0,
            tool: 0,
          },
        },
        'claude-3-opus': {
          api: {
            totalRequests: 2,
            totalErrors: 0,
            totalLatencyMs: 500,
          },
          tokens: {
            prompt: 3000,
            candidates: 1500,
            total: 4000,
            cached: 500,
            thoughts: 0,
            tool: 0,
          },
        },
      },
      tools: {
        totalCalls: 0,
        totalSuccess: 0,
        totalFail: 0,
        totalDurationMs: 0,
        totalDecisions: { accept: 0, reject: 0, modify: 0, auto_accept: 0 },
        byName: {},
      },
      files: {
        totalLinesAdded: 0,
        totalLinesRemoved: 0,
      },
      tokenTracking: {
        tokensPerMinute: 0,
        throttleWaitTimeMs: 0,
        sessionTokenUsage: {
          input: 8000,
          output: 3500,
          cache: 1500,
          tool: 0,
          thought: 0,
          total: 10500,
        },
      },
    });

    const output = lastFrame();
    expect(output).toContain('Total Cache Reads');
    expect(output).toContain('1,500');
  });
});
