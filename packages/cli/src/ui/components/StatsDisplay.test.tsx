/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'ink-testing-library';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatsDisplay } from './StatsDisplay.js';
import * as SessionContext from '../contexts/SessionContext.js';
import { SessionMetrics } from '../contexts/SessionContext.js';
import * as RuntimeContext from '../contexts/RuntimeContext.js';

// Mock the SessionContext to provide controlled data for testing
vi.mock('../contexts/SessionContext.js', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionContext>();
  return {
    ...actual,
    useSessionStats: vi.fn(),
  };
});

// Mock the RuntimeContext to provide controlled data for testing
vi.mock('../contexts/RuntimeContext.js', async (importOriginal) => {
  const actual = await importOriginal<typeof RuntimeContext>();
  return {
    ...actual,
    useRuntimeApi: vi.fn(),
  };
});

const useSessionStatsMock = vi.mocked(SessionContext.useSessionStats);
const useRuntimeApiMock = vi.mocked(RuntimeContext.useRuntimeApi);

const defaultTokenTracking = {
  tokensPerMinute: 0,
  throttleWaitTimeMs: 0,
  timeToFirstToken: null as number | null,
  tokensPerSecond: 0,
  sessionTokenUsage: {
    input: 0,
    output: 0,
    cache: 0,
    tool: 0,
    thought: 0,
    total: 0,
  },
};

const withTokenTracking = (
  partial: Omit<SessionMetrics, 'tokenTracking'> & {
    tokenTracking?: SessionMetrics['tokenTracking'];
  },
): SessionMetrics => ({
  ...partial,
  tokenTracking: partial.tokenTracking ?? { ...defaultTokenTracking },
});

const renderWithMockedStats = (
  metrics: Omit<SessionMetrics, 'tokenTracking'> & {
    tokenTracking?: SessionMetrics['tokenTracking'];
  },
) => {
  const withDefaults = withTokenTracking(metrics);

  useSessionStatsMock.mockReturnValue({
    stats: {
      sessionId: 'test-session-id',
      sessionStartTime: new Date(),
      metrics: withDefaults,
      lastPromptTokenCount: 0,
      promptCount: 5,
    },

    getPromptCount: () => 5,
    startNewPrompt: vi.fn(),
  });

  // Mock RuntimeContext to provide default provider metrics
  useRuntimeApiMock.mockReturnValue({
    getActiveProviderMetrics: vi.fn().mockReturnValue({
      tokensPerMinute: 0,
      throttleWaitTimeMs: 0,
      totalTokens: 0,
      totalRequests: 0,
    }),
    getSessionTokenUsage: vi.fn().mockReturnValue({
      input: 0,
      output: 0,
      cache: 0,
      tool: 0,
      thought: 0,
      total: 0,
    }),
  } as unknown as ReturnType<typeof RuntimeContext.useRuntimeApi>);

  return render(<StatsDisplay duration="1s" />);
};

const defaultZeroMetrics: SessionMetrics = {
  models: {},
  tools: {
    totalCalls: 0,
    totalSuccess: 0,
    totalFail: 0,
    totalDurationMs: 0,
    totalDecisions: { accept: 0, reject: 0, modify: 0 },
    byName: {},
  },
  files: {
    totalLinesAdded: 0,
    totalLinesRemoved: 0,
  },
  tokenTracking: { ...defaultTokenTracking },
};

const defaultStatsReturnValue = {
  stats: {
    sessionId: 'test-session-id',
    sessionStartTime: new Date(),
    metrics: defaultZeroMetrics,
    lastPromptTokenCount: 0,
    promptCount: 5,
  },

  getPromptCount: () => 5,
  startNewPrompt: vi.fn(),
};

describe('<StatsDisplay />', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useSessionStatsMock.mockReturnValue(defaultStatsReturnValue);

    useRuntimeApiMock.mockReturnValue({
      getActiveProviderMetrics: vi.fn().mockReturnValue({
        tokensPerMinute: 0,
        throttleWaitTimeMs: 0,
        totalTokens: 0,
        totalRequests: 0,
      }),
      getSessionTokenUsage: vi.fn().mockReturnValue({
        input: 0,
        output: 0,
        cache: 0,
        tool: 0,
        thought: 0,
        total: 0,
      }),
    } as unknown as ReturnType<typeof RuntimeContext.useRuntimeApi>);
  });

  it('renders only the Performance section in its zero state', () => {
    const zeroMetrics = withTokenTracking({
      models: {},
      tools: {
        totalCalls: 0,
        totalSuccess: 0,
        totalFail: 0,
        totalDurationMs: 0,
        totalDecisions: { accept: 0, reject: 0, modify: 0 },
        byName: {},
      },
      files: {
        totalLinesAdded: 0,
        totalLinesRemoved: 0,
      },
    });

    const { lastFrame } = renderWithMockedStats(zeroMetrics);
    const output = lastFrame();

    expect(output).toContain('Performance');
    expect(output).not.toContain('Interaction Summary');
    expect(output).not.toContain('Efficiency & Optimizations');
    expect(output).not.toContain('Model'); // The table header
    expect(output).not.toContain('Throughput:');
    expect(output).toMatchSnapshot();
  });

  it('renders a table with two models correctly', () => {
    const metrics = withTokenTracking({
      models: {
        'gemini-2.5-pro': {
          api: { totalRequests: 3, totalErrors: 0, totalLatencyMs: 15000 },
          tokens: {
            input: 500,
            prompt: 1000,
            candidates: 2000,
            total: 43234,
            cached: 500,
            thoughts: 100,
            tool: 50,
          },
        },
        'gemini-2.5-flash': {
          api: { totalRequests: 5, totalErrors: 1, totalLatencyMs: 4500 },
          tokens: {
            input: 15000,
            prompt: 25000,
            candidates: 15000,
            total: 150000000,
            cached: 10000,
            thoughts: 2000,
            tool: 1000,
          },
        },
      },
      tools: {
        totalCalls: 0,
        totalSuccess: 0,
        totalFail: 0,
        totalDurationMs: 0,
        totalDecisions: { accept: 0, reject: 0, modify: 0 },
        byName: {},
      },
      files: {
        totalLinesAdded: 0,
        totalLinesRemoved: 0,
      },
    });

    const { lastFrame } = renderWithMockedStats(metrics);
    const output = lastFrame();

    expect(output).toContain('gemini-2.5-pro');
    expect(output).toContain('gemini-2.5-flash');
    expect(output).toContain('500');
    expect(output).toContain('15,000');
    expect(output).toMatchSnapshot();
  });

  it('renders all sections when all data is present', () => {
    const metrics = withTokenTracking({
      models: {
        'gemini-2.5-pro': {
          api: { totalRequests: 1, totalErrors: 0, totalLatencyMs: 100 },
          tokens: {
            input: 50,
            prompt: 100,
            candidates: 100,
            total: 250,
            cached: 50,
            thoughts: 0,
            tool: 0,
          },
        },
      },
      tools: {
        totalCalls: 2,
        totalSuccess: 1,
        totalFail: 1,
        totalDurationMs: 123,
        totalDecisions: { accept: 1, reject: 0, modify: 0 },
        byName: {
          'test-tool': {
            count: 2,
            success: 1,
            fail: 1,
            durationMs: 123,
            decisions: { accept: 1, reject: 0, modify: 0 },
          },
        },
      },
      files: {
        totalLinesAdded: 0,
        totalLinesRemoved: 0,
      },
    });

    const { lastFrame } = renderWithMockedStats(metrics);
    const output = lastFrame();

    expect(output).toContain('Performance');
    expect(output).toContain('Interaction Summary');
    expect(output).toContain('User Agreement');
    expect(output).toContain('Savings Highlight');
    expect(output).toContain('gemini-2.5-pro');
    expect(output).toMatchSnapshot();
  });

  describe('Conditional Rendering Tests', () => {
    it('hides User Agreement when no decisions are made', () => {
      const metrics = withTokenTracking({
        models: {},
        tools: {
          totalCalls: 2,
          totalSuccess: 1,
          totalFail: 1,
          totalDurationMs: 123,
          totalDecisions: { accept: 0, reject: 0, modify: 0 }, // No decisions
          byName: {
            'test-tool': {
              count: 2,
              success: 1,
              fail: 1,
              durationMs: 123,
              decisions: { accept: 0, reject: 0, modify: 0 },
            },
          },
        },
        files: {
          totalLinesAdded: 0,
          totalLinesRemoved: 0,
        },
      });

      const { lastFrame } = renderWithMockedStats(metrics);
      const output = lastFrame();

      expect(output).toContain('Interaction Summary');
      expect(output).toContain('Success Rate');
      expect(output).not.toContain('User Agreement');
      expect(output).toMatchSnapshot();
    });

    it('hides Efficiency section when cache is not used', () => {
      const metrics = withTokenTracking({
        models: {
          'gemini-2.5-pro': {
            api: { totalRequests: 1, totalErrors: 0, totalLatencyMs: 100 },
            tokens: {
              input: 100,
              prompt: 100,
              candidates: 100,
              total: 200,
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
          totalDecisions: { accept: 0, reject: 0, modify: 0 },
          byName: {},
        },
        files: {
          totalLinesAdded: 0,
          totalLinesRemoved: 0,
        },
      });

      const { lastFrame } = renderWithMockedStats(metrics);
      const output = lastFrame();

      expect(output).toMatchSnapshot();
    });
  });

  describe('Conditional Color Tests', () => {
    it('renders success rate in green for high values', () => {
      const metrics = withTokenTracking({
        models: {},
        tools: {
          totalCalls: 10,
          totalSuccess: 10,
          totalFail: 0,
          totalDurationMs: 0,
          totalDecisions: { accept: 0, reject: 0, modify: 0 },
          byName: {},
        },
        files: {
          totalLinesAdded: 0,
          totalLinesRemoved: 0,
        },
      });
      const { lastFrame } = renderWithMockedStats(metrics);
      expect(lastFrame()).toMatchSnapshot();
    });

    it('renders success rate in yellow for medium values', () => {
      const metrics = withTokenTracking({
        models: {},
        tools: {
          totalCalls: 10,
          totalSuccess: 9,
          totalFail: 1,
          totalDurationMs: 0,
          totalDecisions: { accept: 0, reject: 0, modify: 0 },
          byName: {},
        },
        files: {
          totalLinesAdded: 0,
          totalLinesRemoved: 0,
        },
      });
      const { lastFrame } = renderWithMockedStats(metrics);
      expect(lastFrame()).toMatchSnapshot();
    });

    it('renders success rate in red for low values', () => {
      const metrics = withTokenTracking({
        models: {},
        tools: {
          totalCalls: 10,
          totalSuccess: 5,
          totalFail: 5,
          totalDurationMs: 0,
          totalDecisions: { accept: 0, reject: 0, modify: 0 },
          byName: {},
        },
        files: {
          totalLinesAdded: 0,
          totalLinesRemoved: 0,
        },
      });
      const { lastFrame } = renderWithMockedStats(metrics);
      expect(lastFrame()).toMatchSnapshot();
    });
  });

  describe('Code Changes Display', () => {
    it('displays Code Changes when line counts are present', () => {
      const metrics = withTokenTracking({
        models: {},
        tools: {
          totalCalls: 1,
          totalSuccess: 1,
          totalFail: 0,
          totalDurationMs: 100,
          totalDecisions: { accept: 0, reject: 0, modify: 0 },
          byName: {},
        },
        files: {
          totalLinesAdded: 42,
          totalLinesRemoved: 18,
        },
      });

      const { lastFrame } = renderWithMockedStats(metrics);
      const output = lastFrame();

      expect(output).toContain('Code Changes:');
      expect(output).toContain('+42');
      expect(output).toContain('-18');
      expect(output).toMatchSnapshot();
    });

    it('hides Code Changes when no lines are added or removed', () => {
      const metrics = withTokenTracking({
        models: {},
        tools: {
          totalCalls: 1,
          totalSuccess: 1,
          totalFail: 0,
          totalDurationMs: 100,
          totalDecisions: { accept: 0, reject: 0, modify: 0 },
          byName: {},
        },
        files: {
          totalLinesAdded: 0,
          totalLinesRemoved: 0,
        },
      });

      const { lastFrame } = renderWithMockedStats(metrics);
      const output = lastFrame();

      expect(output).not.toContain('Code Changes:');
      expect(output).toMatchSnapshot();
    });
  });

  describe('Title Rendering', () => {
    const zeroMetrics = withTokenTracking({
      models: {},
      tools: {
        totalCalls: 0,
        totalSuccess: 0,
        totalFail: 0,
        totalDurationMs: 0,
        totalDecisions: { accept: 0, reject: 0, modify: 0 },
        byName: {},
      },
      files: {
        totalLinesAdded: 0,
        totalLinesRemoved: 0,
      },
    });

    it('renders the default title when no title prop is provided', () => {
      const { lastFrame } = renderWithMockedStats(zeroMetrics);
      const output = lastFrame();
      expect(output).toContain('Session Stats');
      expect(output).not.toContain('Agent powering down');
      expect(output).toMatchSnapshot();
    });

    it('renders the custom title when a title prop is provided', () => {
      const { lastFrame } = render(
        <StatsDisplay duration="1s" title="Agent powering down. Goodbye!" />,
      );
      const output = lastFrame();
      expect(output).toContain('Agent powering down. Goodbye!');
      expect(output).not.toContain('Session Stats');
      expect(output).toMatchSnapshot();
    });
  });

  describe('Quota Display', () => {
    it('renders quota information when quotaLines are provided', () => {
      const metrics = withTokenTracking({
        models: {
          'gemini-2.5-pro': {
            api: { totalRequests: 1, totalErrors: 0, totalLatencyMs: 100 },
            tokens: {
              input: 50,
              prompt: 100,
              candidates: 100,
              total: 250,
              cached: 50,
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
          totalDecisions: { accept: 0, reject: 0, modify: 0 },
          byName: {},
        },
        files: {
          totalLinesAdded: 0,
          totalLinesRemoved: 0,
        },
      });

      const quotaLines = [
        '## Anthropic Quota Information\n',
        '**Daily Usage**',
        'Used: 1000 / 10000 tokens (10.0%)',
        'Remaining: 9000 tokens',
        'Resets: 2026-02-15 00:00:00 UTC',
      ];

      useSessionStatsMock.mockReturnValue({
        ...defaultStatsReturnValue,
        stats: { ...defaultStatsReturnValue.stats, metrics },
      });

      const { lastFrame } = render(
        <StatsDisplay duration="1s" quotaLines={quotaLines} />,
      );
      const output = lastFrame();

      expect(output).toContain('Quota Information');
      expect(output).toContain('Anthropic Quota Information');
      expect(output).toContain('Daily Usage');
      expect(output).toContain('Used: 1000 / 10000 tokens');
      expect(output).toMatchSnapshot();
    });

    it('does not render quota section when quotaLines are not provided', () => {
      const { lastFrame } = render(<StatsDisplay duration="1s" />);
      const output = lastFrame();

      expect(output).not.toContain('Quota Information');
      expect(output).toMatchSnapshot();
    });

    it('handles empty quotaLines gracefully', () => {
      const { lastFrame } = render(
        <StatsDisplay duration="1s" quotaLines={[]} />,
      );
      const output = lastFrame();

      expect(output).not.toContain('Quota Information');
      expect(output).toMatchSnapshot();
    });
  });

  describe('Model Usage Table Updates', () => {
    it('should display separate Input Tokens and Cache Reads columns', () => {
      const metrics = withTokenTracking({
        models: {
          'gemini-2.5-pro': {
            api: { totalRequests: 5, totalErrors: 0, totalLatencyMs: 1000 },
            tokens: {
              prompt: 1000,
              candidates: 500,
              total: 2000,
              cached: 400,
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
          totalDecisions: { accept: 0, reject: 0, modify: 0 },
          byName: {},
        },
        files: {
          totalLinesAdded: 0,
          totalLinesRemoved: 0,
        },
      });

      const { lastFrame } = renderWithMockedStats(metrics);
      const output = lastFrame();

      expect(output).toContain('Input Tokens');
      expect(output).toContain('Cache Reads');
      expect(output).toContain('600'); // uncached = 1000 - 400
      expect(output).toContain('400'); // cached
      expect(output).toMatchSnapshot();
    });

    it('should apply color to cache efficiency percentage', () => {
      const metrics = withTokenTracking({
        models: {
          'gemini-2.5-pro': {
            api: { totalRequests: 1, totalErrors: 0, totalLatencyMs: 100 },
            tokens: {
              prompt: 1000,
              candidates: 100,
              total: 1100,
              cached: 500, // 50% cache efficiency
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
          totalDecisions: { accept: 0, reject: 0, modify: 0 },
          byName: {},
        },
        files: {
          totalLinesAdded: 0,
          totalLinesRemoved: 0,
        },
      });

      const { lastFrame } = renderWithMockedStats(metrics);
      const output = lastFrame();

      expect(output).toContain('Savings Highlight');
      expect(output).toContain('50.0%');
      // Snapshot will verify color codes are present
      expect(output).toMatchSnapshot();
    });
  });

  describe('Issue #1805 metrics display', () => {
    it('shows throughput, TTFT, and output rate in performance section when available', () => {
      const metrics = withTokenTracking({
        models: {
          'gemini-2.5-pro': {
            api: { totalRequests: 2, totalErrors: 0, totalLatencyMs: 2500 },
            tokens: {
              input: 600,
              prompt: 900,
              candidates: 400,
              total: 1300,
              cached: 300,
              thoughts: 0,
              tool: 0,
            },
          },
        },
        tools: {
          totalCalls: 1,
          totalSuccess: 1,
          totalFail: 0,
          totalDurationMs: 250,
          totalDecisions: { accept: 1, reject: 0, modify: 0 },
          byName: {},
        },
        files: {
          totalLinesAdded: 0,
          totalLinesRemoved: 0,
        },
        tokenTracking: {
          ...defaultTokenTracking,
          tokensPerMinute: 1234,
          timeToFirstToken: 187,
          tokensPerSecond: 42.42,
        },
      });

      const { lastFrame } = renderWithMockedStats(metrics);
      const output = lastFrame();

      expect(output).toContain('Throughput:');
      expect(output).toContain('1.23k TPM');
      expect(output).toContain('(input+output)');
      expect(output).toContain('TTFT:');
      expect(output).toContain('187ms');
      expect(output).toContain('Output Rate:');
      expect(output).toContain('42.42 tok/s');
      expect(output).toMatchSnapshot();
    });

    it('hides throughput, TTFT, and output rate when values are unavailable', () => {
      const metrics = withTokenTracking({
        models: {},
        tools: {
          totalCalls: 0,
          totalSuccess: 0,
          totalFail: 0,
          totalDurationMs: 0,
          totalDecisions: { accept: 0, reject: 0, modify: 0 },
          byName: {},
        },
        files: {
          totalLinesAdded: 0,
          totalLinesRemoved: 0,
        },
        tokenTracking: {
          ...defaultTokenTracking,
          tokensPerMinute: 0,
          timeToFirstToken: null,
          tokensPerSecond: 0,
        },
      });

      const { lastFrame } = renderWithMockedStats(metrics);
      const output = lastFrame();

      expect(output).not.toContain('Throughput:');
      expect(output).not.toContain('TTFT:');
      expect(output).not.toContain('Output Rate:');
      expect(output).toMatchSnapshot();
    });

    it('shows throughput when TPM is present even if TTFT/output rate are unavailable', () => {
      const metrics = withTokenTracking({
        models: {},
        tools: {
          totalCalls: 0,
          totalSuccess: 0,
          totalFail: 0,
          totalDurationMs: 0,
          totalDecisions: { accept: 0, reject: 0, modify: 0 },
          byName: {},
        },
        files: {
          totalLinesAdded: 0,
          totalLinesRemoved: 0,
        },
        tokenTracking: {
          ...defaultTokenTracking,
          tokensPerMinute: 250,
          timeToFirstToken: null,
          tokensPerSecond: 0,
        },
      });

      const { lastFrame } = renderWithMockedStats(metrics);
      const output = lastFrame();

      expect(output).toContain('Throughput:');
      expect(output).toContain('250.00 TPM');
      expect(output).not.toContain('TTFT:');
      expect(output).not.toContain('Output Rate:');
      expect(output).toMatchSnapshot();
    });
  });
});
