/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'ink-testing-library';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatsDisplay } from './StatsDisplay.js';
import * as SessionContext from '../contexts/SessionContext.js';
import * as RuntimeContext from '../contexts/RuntimeContext.js';
import {
  createMockRuntimeApi,
  defaultTokenTracking,
  defaultTiming,
  defaultZeroMetrics,
  withTokenTracking,
  type TestMetricsInput,
} from './StatsDisplay.testHelpers.js';

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

const renderWithMockedStats = (metrics: TestMetricsInput) => {
  const withDefaults = withTokenTracking(metrics);

  useSessionStatsMock.mockReturnValue({
    stats: {
      sessionId: 'test-session-id',
      sessionStartTime: new Date(),
      metrics: withDefaults,
      lastPromptTokenCount: 0,
      historyTokenCount: 0,
      promptCount: 5,
    },

    getPromptCount: () => 5,
    startNewPrompt: vi.fn(),
    updateHistoryTokenCount: vi.fn(),
  });

  // Mock RuntimeContext to provide default provider metrics
  useRuntimeApiMock.mockReturnValue(createMockRuntimeApi());

  return render(<StatsDisplay duration="1s" />);
};

const defaultStatsReturnValue = {
  stats: {
    sessionId: 'test-session-id',
    sessionStartTime: new Date(),
    metrics: defaultZeroMetrics(),
    lastPromptTokenCount: 0,
    historyTokenCount: 0,
    promptCount: 5,
  },

  getPromptCount: () => 5,
  startNewPrompt: vi.fn(),
  updateHistoryTokenCount: vi.fn(),
};

describe('<StatsDisplay /> sections', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useSessionStatsMock.mockReturnValue(defaultStatsReturnValue);

    useRuntimeApiMock.mockReturnValue(createMockRuntimeApi());
  });

  describe('Title Rendering', () => {
    const zeroMetrics = withTokenTracking({
      models: {},
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
          totalDecisions: { accept: 0, reject: 0, modify: 0, auto_accept: 0 },
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
              input: 600,
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
          totalDecisions: { accept: 0, reject: 0, modify: 0, auto_accept: 0 },
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
              input: 500,
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
          totalDecisions: { accept: 0, reject: 0, modify: 0, auto_accept: 0 },
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

  describe('performance metrics display', () => {
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
          totalDecisions: { accept: 1, reject: 0, modify: 0, auto_accept: 0 },
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
        timing: {
          ...defaultTiming,
          completeTokensPerMinute: 1234,
          outputGenerationTps: 15.5,
          effectiveInputTps: 3200,
        },
      });

      const { lastFrame } = renderWithMockedStats(metrics);
      const output = lastFrame();

      expect(output).toContain('Throughput');
      expect(output).toContain('1.23k TPM');
      expect(output).toContain('TTFT (last):');
      expect(output).toContain('187ms');
      expect(output).toContain('Output Gen Rate');
      expect(output).toContain('15.50 tok/s');
      expect(output).toContain('Input Rate');
      expect(output).toContain('3200.00 tok/s');
      expect(output).toMatchSnapshot();
    });

    it('hides throughput, TTFT, and output rate when values are non-finite', () => {
      const metrics = withTokenTracking({
        models: {},
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
          ...defaultTokenTracking,
          tokensPerMinute: Number.NaN,
          timeToFirstToken: Number.POSITIVE_INFINITY,
          tokensPerSecond: Number.NEGATIVE_INFINITY,
        },
      });

      const { lastFrame } = renderWithMockedStats(metrics);
      const output = lastFrame();

      expect(output).not.toContain('Throughput');
      expect(output).not.toContain('TTFT (last):');
      expect(output).not.toContain('Token Rate (avg):');
      expect(output).not.toContain('NaN');
      expect(output).not.toContain('Infinity');
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
          totalDecisions: { accept: 0, reject: 0, modify: 0, auto_accept: 0 },
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

      expect(output).not.toContain('Throughput');
      expect(output).not.toContain('TTFT (last):');
      expect(output).not.toContain('Token Rate (avg):');
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
          totalDecisions: { accept: 0, reject: 0, modify: 0, auto_accept: 0 },
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
        timing: {
          ...defaultTiming,
          completeTokensPerMinute: 250,
        },
      });

      const { lastFrame } = renderWithMockedStats(metrics);
      const output = lastFrame();

      expect(output).toContain('Throughput');
      expect(output).toContain('250.00 TPM');
      expect(output).not.toContain('TTFT (last):');
      expect(output).not.toContain('Token Rate (avg):');
      expect(output).toMatchSnapshot();
    });
  });

  describe('Session API section', () => {
    it('renders Session API section with total requests and errors', () => {
      const metrics = withTokenTracking({
        models: {
          'gemini-pro': {
            api: {
              totalRequests: 5,
              totalErrors: 1,
              totalLatencyMs: 10000,
            },
            tokens: {
              input: 100,
              prompt: 200,
              candidates: 50,
              total: 250,
              cached: 100,
              thoughts: 0,
              tool: 0,
            },
          },
          'claude-sonnet': {
            api: {
              totalRequests: 3,
              totalErrors: 0,
              totalLatencyMs: 6000,
            },
            tokens: {
              input: 50,
              prompt: 80,
              candidates: 30,
              total: 110,
              cached: 30,
              thoughts: 0,
              tool: 0,
            },
          },
        },
      });

      const { lastFrame } = renderWithMockedStats(metrics);
      const output = lastFrame();

      // Total requests across models = 5 + 3 = 8; assert the specific label
      // and value rather than a bare number that could match anywhere.
      expect(output).toContain('Session API');
      expect(output).toMatch(/Total Requests:[\s\S]*8/);
      // Total errors = 1 (only gemini-pro has errors)
      expect(output).toMatch(/Total Errors:[\s\S]*1/);
    });

    it('hides Session API section when total requests is 0', () => {
      const { lastFrame } = renderWithMockedStats({});
      const output = lastFrame();

      expect(output).not.toContain('Session API');
    });
  });
});
