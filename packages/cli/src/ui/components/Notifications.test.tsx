import { waitFor } from '../../__tests__/render.js';
import { readJournalItems } from '../stores/turn/read-journal-items.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'bun:test';
import { render } from 'ink-testing-library';
import { withJournalTurn } from '../stores/turn/journal-turn-test-helpers.js';
import {
  createScrollbackPagerStore,
  type ScrollbackPagerStore,
} from '../stores/turn/scrollbackPager.js';
import { StreamingState } from '../types.js';
import { Notifications } from './Notifications.js';
import { TurnProvider } from '../stores/turn/TurnContext.js';
import { createTurnStore } from '../stores/turn/turnStore.js';
import { SettingsProfileProvider } from '../stores/settings/SettingsContext.js';
import { createSettingsProfileStore } from '../stores/settings/settingsStore.js';

const realRealInkModule = {
  ...(await import('../../../test-utils/real-ink.js')),
};

void vi.mock('ink', () => realRealInkModule);

void vi.mock('./UpdateNotification.js', () => ({
  UpdateNotification: () => null,
}));

const activeRenders: Array<ReturnType<typeof render>> = [];

interface NotificationTestOptions {
  initError?: string | null;
  streamingState?: StreamingState;
  startupWarnings?: string[];
  pager?: ScrollbackPagerStore;
}

function renderNotifications(options: NotificationTestOptions = {}) {
  // Notifications reads initError from the settings/profile store and
  // streamingState from the turn store; seed exactly those slices.
  const rendered = render(
    <SettingsProfileProvider
      store={createSettingsProfileStore({
        initError: options.initError ?? null,
      })}
    >
      <TurnProvider
        store={createTurnStore({
          streamingState: options.streamingState ?? StreamingState.Idle,
        })}
      >
        <Notifications
          startupWarnings={options.startupWarnings ?? []}
          updateInfo={null}
          pager={options.pager}
        />
      </TurnProvider>
    </SettingsProfileProvider>,
  );
  activeRenders.push(rendered);
  return rendered;
}

describe('Notifications', () => {
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

  it('prefers the fuller matching error from the resident journal window', async () => {
    await withJournalTurn(async (turn, agent) => {
      const historyText = 'Provider error: Missing API key is not configured.';
      turn.commands.addItem({
        type: 'info',
        text: 'INFORMATION_DISTRACTOR mentions Missing API key',
      });
      turn.commands.addItem({
        type: 'error',
        text: 'UNRELATED_ERROR_DISTRACTOR: provider connection timed out.',
      });
      turn.commands.addItem({ type: 'error', text: historyText });
      await waitFor(async () => {
        const rows = await readJournalItems(agent);
        expect(
          rows.some((row) => row.type === 'error' && row.text === historyText),
        ).toBe(true);
      });
      const filePath = agent.session.getRecording().path;
      if (!filePath) throw new Error('Missing journal path');
      const pager = createScrollbackPagerStore({
        filePath,
        pageRows: 4,
        viewport: {
          visibleKeys: [],
          viewportLines: 4,
          rowHeightLines: () => 1,
        },
        settings: {
          marginViewports: 0,
          byteFloorBytes: 256,
          purgeDebounceMs: 0,
        },
      });
      try {
        await pager.resumeFromJournal();
        const rendered = renderNotifications({
          initError: 'Missing API key',
          pager,
        });
        const frame = rendered.lastFrame();
        expect(frame).toContain(historyText);
        expect(frame).not.toContain('INFORMATION_DISTRACTOR');
        expect(frame).not.toContain('UNRELATED_ERROR_DISTRACTOR');
        expect(frame).not.toContain('Please check API key and configuration.');
        rendered.unmount();
      } finally {
        await pager.close();
      }
    });
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
