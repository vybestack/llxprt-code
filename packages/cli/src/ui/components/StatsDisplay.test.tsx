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

describe('<StatsDisplay />', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useSessionStatsMock.mockReturnValue(defaultStatsReturnValue);

    useRuntimeApiMock.mockReturnValue(createMockRuntimeApi());
  });

  it('renders only the Performance section in its zero state', () => {
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
        totalDecisions: { accept: 1, reject: 0, modify: 0, auto_accept: 0 },
        byName: {
          'test-tool': {
            count: 2,
            success: 1,
            fail: 1,
            cancelled: 0,
            durationMs: 123,
            decisions: { accept: 1, reject: 0, modify: 0, auto_accept: 0 },
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
          totalDecisions: { accept: 0, reject: 0, modify: 0, auto_accept: 0 },
          byName: {
            'test-tool': {
              count: 2,
              success: 1,
              fail: 1,
              cancelled: 0,
              durationMs: 123,
              decisions: { accept: 0, reject: 0, modify: 0, auto_accept: 0 },
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
          totalDecisions: { accept: 0, reject: 0, modify: 0, auto_accept: 0 },
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
          totalDecisions: { accept: 0, reject: 0, modify: 0, auto_accept: 0 },
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
          totalDecisions: { accept: 0, reject: 0, modify: 0, auto_accept: 0 },
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
          totalDecisions: { accept: 0, reject: 0, modify: 0, auto_accept: 0 },
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

      expect(output).not.toContain('Code Changes:');
      expect(output).toMatchSnapshot();
    });
  });
});
