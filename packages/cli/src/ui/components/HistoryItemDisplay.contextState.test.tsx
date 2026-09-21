/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260917-ISSUE854.P03
 * @requirement G3
 *
 * Badge display contract on the history row component
 * (issue-854-design.md §5 rev 3): a row whose membership state is `purged`
 * renders a visible `purged` chip and the row is dimmed; `in-context` and
 * `n/a` rows render no chip and no dimming. The state arrives as the
 * `contextState` prop computed by the parent via classifyContextState;
 * rows rendered without the prop (every existing call site) stay
 * unchanged.
 *
 * Dim styling itself is not assertable in this lane: the stub-ink test
 * lane strips all SGR output (verified 2026-09-20 — a dimColor Text
 * renders plain), so the chip presence/absence is the pinned observable
 * and the dim application on the purged branch is a green-session
 * requirement checked in the real-Ink lane.
 */

import { describe, it, expect, vi } from 'bun:test';
import { HistoryItemDisplay } from './HistoryItemDisplay.js';
import { type HistoryItem, MessageType } from '../types.js';
import type { Config } from '@vybestack/llxprt-code-core';
import type { HistoryContextState } from '../utils/historyContextState.js';
import { renderWithProviders } from '../../test-utils/render.js';

// The real RuntimeContextProvider resolves the CLI runtime scope, which this
// component test does not establish. Preserve the complete module shape and
// replace only the hook so unrelated exports keep their production contract.
const actual = { ...(await import('../contexts/RuntimeContext.js')) };
void vi.mock('../contexts/RuntimeContext.js', () => ({
  ...actual,
  useRuntimeApi: () => ({
    getActiveProviderStatus: () => ({ providerName: 'gemini' }),
    getEphemeralSetting: () => undefined,
  }),
}));

// Mock child components
void vi.mock('./messages/ToolGroupMessage.js', () => ({
  ToolGroupMessage: vi.fn(() => <div />),
}));

describe('<HistoryItemDisplay /> contextState badge', () => {
  const mockConfig = {} as unknown as Config;
  const baseItem = {
    id: 1,
    timestamp: 12345,
    isPending: false,
    terminalWidth: 80,
    config: mockConfig,
  };

  function renderRow(contextState: HistoryContextState | undefined): string {
    const item: HistoryItem = {
      ...baseItem,
      type: MessageType.USER,
      text: 'plain row text',
    };
    const { lastFrame } = renderWithProviders(
      <HistoryItemDisplay
        {...baseItem}
        item={item}
        contextState={contextState}
      />,
    );
    return lastFrame() ?? '';
  }

  it('purged row renders a visible purged chip and dims the row', () => {
    const frame = renderRow('purged');
    expect(frame).toContain('plain row text');
    expect(frame).toContain('purged');
  });

  it('in-context row renders no chip', () => {
    const frame = renderRow('in-context');
    expect(frame).toContain('plain row text');
    expect(frame).not.toContain('purged');
  });

  it('n/a row renders no chip and no dimming (undecorated row)', () => {
    expect(renderRow('n/a')).not.toContain('purged');
    // Rows rendered without the prop (all existing call sites) are
    // equally undecorated.
    expect(renderRow(undefined)).not.toContain('purged');
  });
});
