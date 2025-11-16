/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable react/prop-types */

import React from 'react';
import { render } from 'ink-testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionMetrics } from '../contexts/SessionContext.js';

const recordedTextProps: Array<{ text: string; color?: string }> = [];

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  const InstrumentedText: typeof actual.Text = (props) => {
    const textContent = React.Children.toArray(props.children)
      .map((child) => {
        if (typeof child === 'string' || typeof child === 'number') {
          return child.toString();
        }
        return '';
      })
      .join('');

    recordedTextProps.push({
      text: textContent,
      color: props.color,
    });

    return React.createElement(actual.Text, props);
  };

  (
    InstrumentedText as React.ComponentType & { propTypes?: unknown }
  ).propTypes = (
    actual.Text as React.ComponentType & { propTypes?: unknown }
  ).propTypes;

  return {
    ...actual,
    Text: InstrumentedText,
  };
});

const runtimeStub = {
  getActiveProviderMetrics: vi.fn(() => ({
    tokensPerMinute: 0,
    throttleWaitTimeMs: 0,
    totalTokens: 0,
    totalRequests: 0,
  })),
  getSessionTokenUsage: vi.fn(() => ({
    input: 0,
    output: 0,
    cache: 0,
    tool: 0,
    thought: 0,
    total: 0,
  })),
};

vi.mock('../contexts/RuntimeContext.js', () => ({
  useRuntimeApi: () => runtimeStub,
}));

const standardMetrics: SessionMetrics = {
  models: {
    'gemini-1.5-pro': {
      api: { totalRequests: 2, totalErrors: 0, totalLatencyMs: 1000 },
      tokens: {
        prompt: 500,
        candidates: 250,
        total: 1000,
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
      input: 0,
      output: 0,
      cache: 0,
      tool: 0,
      thought: 0,
      total: 0,
    },
  },
};

vi.mock('../contexts/SessionContext.js', () => ({
  useSessionStats: () => ({
    stats: {
      sessionId: 'session-1234',
      sessionStartTime: new Date(),
      metrics: standardMetrics,
      lastPromptTokenCount: 0,
      promptCount: 1,
    },
    getPromptCount: () => 1,
    startNewPrompt: vi.fn(),
  }),
}));

const { StatsDisplay } = await import('./StatsDisplay.js');
const { theme } = await import('../semantic-colors.js');

describe('StatsDisplay theming', () => {
  beforeEach(() => {
    recordedTextProps.length = 0;
    runtimeStub.getActiveProviderMetrics.mockClear();
    runtimeStub.getSessionTokenUsage.mockClear();
  });

  it('renders the Model Usage header using the accent color from the active theme', () => {
    render(<StatsDisplay duration="1s" />);

    const headerEntry = recordedTextProps.find((entry) =>
      entry.text.trim().startsWith('Model Usage'),
    );

    expect(headerEntry?.color).toBe(theme.text.accent);

    const dividerEntry = recordedTextProps.find((entry) =>
      entry.text.trim().startsWith('─'),
    );
    expect(dividerEntry?.color).toBe(theme.text.secondary);
  });
});
