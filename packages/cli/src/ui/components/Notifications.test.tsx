/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'bun:test';
import { render } from 'ink-testing-library';
import type { HistoryItem } from '../types.js';
import { StreamingState } from '../types.js';
import { useUIState } from '../contexts/UIStateContext.js';
import { Notifications } from './Notifications.js';

const realRealInkModule = {
  ...(await import('../../../test-utils/real-ink.js')),
};

void vi.mock('ink', () => realRealInkModule);

void vi.mock('node:fs/promises', () => ({
  access: async () => {},
  mkdir: async () => {},
  writeFile: async () => {},
}));

void vi.mock('./UpdateNotification.js', () => ({
  UpdateNotification: () => null,
}));

void vi.mock('../contexts/UIStateContext.js', () => ({
  useUIState: vi.fn(),
}));

const mockUseUIState = useUIState as Mock<typeof useUIState>;
const activeRenders: Array<ReturnType<typeof render>> = [];

interface NotificationTestOptions {
  initError?: string | null;
  streamingState?: StreamingState;
  startupWarnings?: string[];
  history?: HistoryItem[];
}

function renderNotifications(options: NotificationTestOptions = {}) {
  mockUseUIState.mockReturnValue({
    initError: options.initError ?? null,
    streamingState: options.streamingState ?? StreamingState.Idle,
  } as never);

  const rendered = render(
    <Notifications
      startupWarnings={options.startupWarnings ?? []}
      updateInfo={null}
      history={options.history ?? []}
    />,
  );
  activeRenders.push(rendered);
  return rendered;
}

describe('Notifications', () => {
  beforeEach(() => {
    mockUseUIState.mockReset();
  });

  afterEach(() => {
    for (const rendered of activeRenders.splice(0)) {
      rendered.unmount();
    }
  });

  // No live call site currently assigns a non-null initError; the plan records
  // that observation as a follow-up.
  it('renders an initialization error with actionable remediation', () => {
    const { lastFrame } = renderNotifications({
      initError: 'Missing API key',
    });

    const frame = lastFrame();
    expect(frame).toContain('Initialization Error: Missing API key');
    expect(frame).toContain('Please check API key and configuration.');
  });

  it('prefers the fuller matching error from history', () => {
    const historyText = 'Provider error: Missing API key is not configured.';
    const nonErrorDistractor =
      'INFORMATION_DISTRACTOR mentions Missing API key for documentation.';
    const unrelatedErrorDistractor =
      'UNRELATED_ERROR_DISTRACTOR: provider connection timed out.';
    const { lastFrame } = renderNotifications({
      initError: 'Missing API key',
      history: [
        { id: 1, type: 'info', text: nonErrorDistractor },
        { id: 2, type: 'error', text: unrelatedErrorDistractor },
        { id: 3, type: 'error', text: historyText },
      ],
    });

    const frame = lastFrame();
    expect(frame).toContain(historyText);
    expect(frame).not.toContain('INFORMATION_DISTRACTOR');
    expect(frame).not.toContain('UNRELATED_ERROR_DISTRACTOR');
    expect(frame).not.toContain('Please check API key and configuration.');
  });

  it('suppresses the initialization error while responding', () => {
    const { lastFrame } = renderNotifications({
      initError: 'Missing API key',
      streamingState: StreamingState.Responding,
    });

    const frame = lastFrame();
    expect(frame).not.toContain('Initialization Error');
    expect(frame).not.toContain('Missing API key');
    expect(frame).not.toContain('Please check API key and configuration.');
  });

  it('renders every startup warning', () => {
    const { lastFrame } = renderNotifications({
      startupWarnings: ['warning one', 'warning two'],
    });

    const frame = lastFrame();
    expect(frame).toContain('warning one');
    expect(frame).toContain('warning two');
  });

  it('renders startup warnings alongside an initialization error', () => {
    const { lastFrame } = renderNotifications({
      initError: 'Missing API key',
      startupWarnings: ['Configuration migration is recommended.'],
    });

    const frame = lastFrame();
    expect(frame).toContain('Configuration migration is recommended.');
    expect(frame).toContain('Initialization Error: Missing API key');
    expect(frame).toContain('Please check API key and configuration.');
  });

  it('renders nothing when there are no notifications', () => {
    const { lastFrame } = renderNotifications();

    expect(lastFrame()).toBe('');
  });
});
