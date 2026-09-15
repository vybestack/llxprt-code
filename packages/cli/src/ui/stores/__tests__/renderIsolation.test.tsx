/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Render-isolation coverage for the UI stores (issue #2536 AC8).
 *
 * Each probe component subscribes to exactly one store through
 * useStoreSelector and counts its own renders. Tests drive store commands
 * inside act() and assert on the resulting render counts: an update to one
 * store must not rerender subscribers of the other stores, and a narrow
 * selector must not rerender for unrelated fields of the same store.
 */

import { act } from 'react';
import { describe, expect, it } from 'bun:test';
import { Text } from 'ink';
import {
  renderWithProviders,
  type RenderStoreSeeds,
} from '../../../test-utils/render.js';
import { useStoreSelector } from '../useStoreSelector.js';
import { useDialogStore } from '../dialog/DialogContext.js';
import { useTerminalStore } from '../terminal/TerminalContext.js';
import { useTurnStore } from '../turn/TurnContext.js';
import { useSettingsProfileStore } from '../settings/SettingsContext.js';
import type { DialogStore } from '../dialog/dialogStore.js';
import type { TerminalStore } from '../terminal/terminalStore.js';
import type { TurnStore } from '../turn/turnStore.js';
import type { SettingsProfileStore } from '../settings/settingsStore.js';
import type { HistoryItem } from '../../types.js';
import { StreamingState } from '../../types.js';

/** Render counts per probe, incremented in the probe bodies. */
interface RenderCounters {
  dialog: number;
  terminal: number;
  transcript: number;
  settings: number;
}

function createCounters(): RenderCounters {
  return { dialog: 0, terminal: 0, transcript: 0, settings: 0 };
}

/** The four store handles the tests drive commands through. */
interface StoreHandles {
  dialog: DialogStore;
  terminal: TerminalStore;
  turn: TurnStore;
  settings: SettingsProfileStore;
}

const MOUNTED: RenderCounters = {
  dialog: 1,
  terminal: 1,
  transcript: 1,
  settings: 1,
};

function DialogProbe({ counters }: { counters: RenderCounters }) {
  const { store } = useDialogStore();
  const openCount = useStoreSelector(store, (s) => s.requests.length);
  counters.dialog += 1;
  return <Text color="white">open dialogs: {openCount}</Text>;
}

function TerminalProbe({ counters }: { counters: RenderCounters }) {
  const { store } = useTerminalStore();
  const width = useStoreSelector(store, (s) => s.terminalWidth);
  counters.terminal += 1;
  return <Text color="white">terminal width: {width}</Text>;
}

/**
 * Transcript-shaped subscriber: reads the committed history array the same
 * way the <Static> region does, so it rerenders only when the committed set
 * changes (array identity), not for unrelated turn-store fields.
 */
function TranscriptProbe({ counters }: { counters: RenderCounters }) {
  const { store } = useTurnStore();
  const history = useStoreSelector(store, (s) => s.history);
  counters.transcript += 1;
  const text = history
    .map((item) => (typeof item.text === 'string' ? item.text : ''))
    .join(' | ');
  return <Text color="white">transcript: {text}</Text>;
}

function SettingsProbe({ counters }: { counters: RenderCounters }) {
  const { store } = useSettingsProfileStore();
  const providerCount = useStoreSelector(
    store,
    (s) => s.providerOptions.length,
  );
  counters.settings += 1;
  return <Text color="white">providers: {providerCount}</Text>;
}

/**
 * Mounts one probe per store through the standard provider stack and exposes
 * the render counters plus the live store handles captured from context.
 */
function renderIsolationHarness(seeds: RenderStoreSeeds = {}): {
  counters: RenderCounters;
  stores: StoreHandles;
  rendered: ReturnType<typeof renderWithProviders>;
} {
  const counters = createCounters();
  const handles: Partial<StoreHandles> = {};

  function StoreCapture(): null {
    handles.dialog = useDialogStore();
    handles.terminal = useTerminalStore();
    handles.turn = useTurnStore();
    handles.settings = useSettingsProfileStore();
    return null;
  }

  const rendered = renderWithProviders(
    <>
      <StoreCapture />
      <DialogProbe counters={counters} />
      <TerminalProbe counters={counters} />
      <TranscriptProbe counters={counters} />
      <SettingsProbe counters={counters} />
    </>,
    seeds,
  );

  if (
    handles.dialog === undefined ||
    handles.terminal === undefined ||
    handles.turn === undefined ||
    handles.settings === undefined
  ) {
    throw new Error('store contexts did not mount; probes cannot run');
  }

  return {
    counters,
    stores: {
      dialog: handles.dialog,
      terminal: handles.terminal,
      turn: handles.turn,
      settings: handles.settings,
    },
    rendered,
  };
}

describe('store render isolation', () => {
  it('a DialogStore update rerenders only dialog subscribers', () => {
    const { counters, stores, rendered } = renderIsolationHarness();
    expect(counters).toStrictEqual(MOUNTED);

    act(() => {
      stores.dialog.commands.openDialog({ kind: 'theme', payload: {} });
    });

    expect(counters.dialog).toBe(2);
    expect(counters.terminal).toBe(1);
    expect(counters.transcript).toBe(1);
    expect(counters.settings).toBe(1);

    act(() => {
      stores.dialog.commands.closeDialog('theme');
    });

    expect(counters.dialog).toBe(3);
    expect(counters.terminal).toBe(1);
    expect(counters.transcript).toBe(1);
    expect(counters.settings).toBe(1);

    rendered.unmount();
  });

  it('a TerminalStore resize rerenders only terminal subscribers', () => {
    const { counters, stores, rendered } = renderIsolationHarness();
    expect(counters).toStrictEqual(MOUNTED);

    act(() => {
      stores.terminal.commands.setDimensions({
        terminalWidth: 100,
        terminalHeight: 40,
        inputWidth: 90,
        suggestionsWidth: 80,
      });
    });
    expect(counters.terminal).toBe(2);
    expect(counters.dialog).toBe(1);
    expect(counters.transcript).toBe(1);
    expect(counters.settings).toBe(1);

    // A resize storm also rewrites fields the width probe does not select:
    // the narrow selector keeps the subscriber quiet, and the other stores'
    // subscribers stay quiet through every write.
    act(() => {
      stores.terminal.commands.setFooterHeight(2);
    });
    expect(counters.terminal).toBe(2);

    act(() => {
      stores.terminal.commands.setDimensions({
        terminalWidth: 120,
        terminalHeight: 40,
        inputWidth: 108,
        suggestionsWidth: 96,
      });
    });

    expect(counters.terminal).toBe(3);
    expect(counters.dialog).toBe(1);
    expect(counters.transcript).toBe(1);
    expect(counters.settings).toBe(1);

    rendered.unmount();
  });

  it('a TurnStore history append rerenders the transcript subscriber only', () => {
    const { counters, stores, rendered } = renderIsolationHarness();
    expect(counters).toStrictEqual(MOUNTED);

    act(() => {
      stores.turn.commands.addItem({ type: 'user', text: 'isolation probe' });
    });

    expect(counters.transcript).toBe(2);
    expect(counters.dialog).toBe(1);
    expect(counters.terminal).toBe(1);
    expect(counters.settings).toBe(1);
    expect(rendered.lastFrame()).toContain('isolation probe');

    // Streaming state changes ride the same store but must not rerender the
    // transcript region: the history array keeps its identity.
    act(() => {
      stores.turn.commands.setStreamingState(StreamingState.Responding);
    });

    expect(counters.transcript).toBe(2);
    expect(counters.dialog).toBe(1);
    expect(counters.terminal).toBe(1);
    expect(counters.settings).toBe(1);

    rendered.unmount();
  });

  it('opening a dialog does not rerender the history/transcript region', () => {
    const seededHistory: HistoryItem[] = [
      { id: 1, type: 'user', text: 'seeded transcript line' },
    ];
    const { counters, stores, rendered } = renderIsolationHarness({
      turn: { history: seededHistory },
    });
    expect(counters).toStrictEqual(MOUNTED);
    expect(rendered.lastFrame()).toContain('seeded transcript line');

    act(() => {
      stores.dialog.commands.openDialog({ kind: 'settings', payload: {} });
    });

    expect(counters.transcript).toBe(1);
    expect(counters.dialog).toBe(2);
    expect(rendered.lastFrame()).toContain('seeded transcript line');

    rendered.unmount();
  });

  it('a SettingsProfileStore update rerenders only settings subscribers', () => {
    const { counters, stores, rendered } = renderIsolationHarness();
    expect(counters).toStrictEqual(MOUNTED);

    act(() => {
      stores.settings.commands.setProviderOptions(['zai', 'anthropic']);
    });

    expect(counters.settings).toBe(2);
    expect(counters.dialog).toBe(1);
    expect(counters.terminal).toBe(1);
    expect(counters.transcript).toBe(1);

    rendered.unmount();
  });
});
