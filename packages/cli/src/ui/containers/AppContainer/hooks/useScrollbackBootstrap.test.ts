/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260917-ISSUE854.P02e
 * @requirement G1,G2
 *
 * Behavioral tests for useScrollbackBootstrap (issue-854-design.md §8):
 * the flag is read once at boot, a pager store is constructed only when
 * ui.scrollbackPagerEnabled is on AND the session journal path resolves,
 * a missing journal falls back to the non-pager path with a one-line
 * notice and no throw, a mid-session flag toggle prompts restart without
 * hot-swapping the pager, and the residency knobs map into the store
 * settings (KiB → bytes).
 *
 * Since the end-of-P02 verification flip the schema default for
 * ui.scrollbackPagerEnabled is true; the "schema default" test proves the
 * default-on wiring end-to-end, and flag-off coverage passes the flag
 * explicitly.
 *
 * The store factory and JournalCursor run for real; the journal is a real
 * temp file, so the binding test proves the store reads the given file
 * path. LoadedSettings is the real class driven through its real
 * setValue() path for the live-toggle scenarios.
 */

import { afterEach, describe, expect, it, vi, type Mock } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { renderHook } from '../../../../test-utils/render.js';
import { LoadedSettings, SettingScope } from '../../../../config/settings.js';
import type { RecordingSwapCallbacks } from '../../../../services/performResume.js';
import type { SessionRecordingService } from '@vybestack/llxprt-code-core';
import type { HistoryItemWithoutId } from '../../../types.js';
import type { ScrollbackPagerSettings } from '../../../stores/turn/scrollbackPager.js';
import {
  scrollbackPagerSettingsFrom,
  useScrollbackBootstrap,
  type UseScrollbackBootstrapOptions,
} from './useScrollbackBootstrap.js';

const TS = '2026-01-01T00:00:00.000Z';

function userContent(text: string, seq: number): unknown {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    metadata: { chronology: { seq, userTurn: 1, step: 1, recordedAt: 0 } },
  };
}

interface JournalFixture {
  filePath: string;
  addUser(seq: number, text: string): Promise<void>;
}

const journalDirs: string[] = [];

async function makeJournalFixture(
  records: ReadonlyArray<readonly [number, string]> = [],
): Promise<JournalFixture> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scrollback-bootstrap-'));
  journalDirs.push(dir);
  const filePath = path.join(dir, 'session-under-test.jsonl');
  let content = '';
  for (const [seq, text] of records) {
    content += `${JSON.stringify({
      v: 1,
      seq,
      ts: TS,
      type: 'content',
      payload: { content: userContent(text, seq) },
    })}\n`;
  }
  if (content.length > 0) {
    await fs.appendFile(filePath, content, 'utf8');
  }
  return {
    filePath,
    async addUser(seq: number, text: string): Promise<void> {
      const line = JSON.stringify({
        v: 1,
        seq,
        ts: TS,
        type: 'content',
        payload: { content: userContent(text, seq) },
      });
      await fs.appendFile(filePath, `${line}\n`, 'utf8');
    },
  };
}

/** Removes temp journals created since the last cleanup; runs per test. */
async function cleanupJournalDirs(): Promise<void> {
  const dirs = journalDirs.splice(0);
  await Promise.all(
    dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
}

function makeSettings(ui: Record<string, unknown>): LoadedSettings {
  return new LoadedSettings(
    { settings: {}, path: '/tmp/system-settings.json' },
    { settings: {}, path: '/tmp/system-defaults.json' },
    { settings: {}, path: '/tmp/user-settings.json' },
    { settings: { ui }, path: '/tmp/workspace-settings.json' },
    true,
  );
}

function makeSwapCallbacks(
  recordingPath: string | null,
): RecordingSwapCallbacks {
  const recording = {
    getFilePath: () => recordingPath,
  } as unknown as SessionRecordingService;
  return {
    getCurrentRecording: () => recording,
    getCurrentIntegration: () => null,
    getCurrentLockHandle: () => null,
    setRecording: () => undefined,
  };
}

interface HarnessOptions {
  readonly ui: Record<string, unknown>;
  readonly recordingPath: string | null;
}

function makeHarness(options: HarnessOptions): {
  props: UseScrollbackBootstrapOptions;
  addItem: Mock<(item: HistoryItemWithoutId, timestamp?: number) => number>;
} {
  const addItem =
    vi.fn<(item: HistoryItemWithoutId, timestamp?: number) => number>();
  addItem.mockImplementation(() => 1);
  return {
    addItem,
    props: {
      settings: makeSettings(options.ui),
      recordingSwapCallbacks: makeSwapCallbacks(options.recordingPath),
      addItem,
    },
  };
}

describe('useScrollbackBootstrap', () => {
  afterEach(() => cleanupJournalDirs());

  it('flag off constructs no pager and emits no notice', () => {
    // The schema default is on since the P02e flip, so flag-off coverage
    // passes the setting explicitly.
    const { props, addItem } = makeHarness({
      ui: { scrollbackPagerEnabled: false },
      recordingPath: '/tmp/unused-session.jsonl',
    });
    const { result, unmount } = renderHook(
      (p: UseScrollbackBootstrapOptions) => useScrollbackBootstrap(p),
      { initialProps: props },
    );
    unmount();
    expect(result.current.pager).toBeNull();
    expect(result.current.restartNotice).toBeNull();
    expect(addItem).not.toHaveBeenCalled();
  });

  it('flag on binds the pager to the session journal file', async () => {
    const fixture = await makeJournalFixture([
      [1, 'r-01'],
      [2, 'r-02'],
      [3, 'r-03'],
    ]);
    const { props, addItem } = makeHarness({
      ui: { scrollbackPagerEnabled: true },
      recordingPath: fixture.filePath,
    });
    const { result, unmount } = renderHook(
      (p: UseScrollbackBootstrapOptions) => useScrollbackBootstrap(p),
      { initialProps: props },
    );
    const pager = result.current.pager;
    expect(pager).not.toBeNull();
    expect(result.current.restartNotice).toBeNull();
    expect(addItem).not.toHaveBeenCalled();
    expect(pager?.viewport.viewportLines).toBe(0);
    await pager?.store.pageBack();
    const state = pager?.store.getState();
    expect(state?.rows.map((row) => row.item.text)).toStrictEqual([
      'r-01',
      'r-02',
      'r-03',
    ]);
    unmount();
  });

  it('schema default (no explicit flag) constructs the pager from the journal', async () => {
    // Default-on wiring end-to-end: the flag value arrives purely through the
    // schema default merged into LoadedSettings — no explicit override.
    const fixture = await makeJournalFixture([[1, 'r-01']]);
    const { props } = makeHarness({
      ui: {},
      recordingPath: fixture.filePath,
    });
    const { result, unmount } = renderHook(
      (p: UseScrollbackBootstrapOptions) => useScrollbackBootstrap(p),
      { initialProps: props },
    );
    const pager = result.current.pager;
    expect(pager).not.toBeNull();
    expect(result.current.restartNotice).toBeNull();
    await pager?.store.pageBack();
    expect(
      pager?.store.getState().rows.map((row) => row.item.text),
    ).toStrictEqual(['r-01']);
    unmount();
  });

  it('flag on without a journal falls back with a one-line notice and no throw', () => {
    const { props, addItem } = makeHarness({
      ui: { scrollbackPagerEnabled: true },
      recordingPath: null,
    });
    const { result, unmount } = renderHook(
      (p: UseScrollbackBootstrapOptions) => useScrollbackBootstrap(p),
      { initialProps: props },
    );
    unmount();
    expect(result.current.pager).toBeNull();
    expect(result.current.restartNotice).toBeNull();
    expect(addItem).toHaveBeenCalledTimes(1);
    const [notice] = addItem.mock.calls[0];
    expect(notice.type).toBe('info');
    expect(notice.text).toBe('scrollback unavailable: no journal');
  });

  it('failed journal resolution emits the notice exactly once across renders', () => {
    const { props, addItem } = makeHarness({
      ui: { scrollbackPagerEnabled: true },
      recordingPath: null,
    });
    const { rerender, unmount } = renderHook(
      (p: UseScrollbackBootstrapOptions) => useScrollbackBootstrap(p),
      { initialProps: props },
    );
    rerender(props);
    rerender(props);
    unmount();
    expect(addItem).toHaveBeenCalledTimes(1);
  });

  it('live toggle to on prompts restart without constructing a pager', () => {
    const { props } = makeHarness({
      ui: { scrollbackPagerEnabled: false },
      recordingPath: '/tmp/unused-session.jsonl',
    });
    const { result, rerender, unmount } = renderHook(
      (p: UseScrollbackBootstrapOptions) => useScrollbackBootstrap(p),
      { initialProps: props },
    );
    expect(result.current.pager).toBeNull();
    props.settings.setValue(
      SettingScope.Workspace,
      'ui.scrollbackPagerEnabled',
      true,
    );
    rerender(props);
    expect(result.current.restartNotice).toBe(
      'scrollback pager setting changed: restart to apply',
    );
    expect(result.current.pager).toBeNull();
    unmount();
  });

  it('live toggle to off keeps the pager identity and prompts restart', async () => {
    const fixture = await makeJournalFixture([[1, 'r-01']]);
    const { props } = makeHarness({
      ui: { scrollbackPagerEnabled: true },
      recordingPath: fixture.filePath,
    });
    const { result, rerender, unmount } = renderHook(
      (p: UseScrollbackBootstrapOptions) => useScrollbackBootstrap(p),
      { initialProps: props },
    );
    const pagerBefore = result.current.pager;
    expect(pagerBefore).not.toBeNull();
    props.settings.setValue(
      SettingScope.Workspace,
      'ui.scrollbackPagerEnabled',
      false,
    );
    rerender(props);
    expect(result.current.restartNotice).toBe(
      'scrollback pager setting changed: restart to apply',
    );
    expect(result.current.pager).toBe(pagerBefore);
    unmount();
  });

  it('toggle back to the boot value clears the restart notice', async () => {
    const fixture = await makeJournalFixture();
    const { props } = makeHarness({
      ui: { scrollbackPagerEnabled: true },
      recordingPath: fixture.filePath,
    });
    const { result, rerender, unmount } = renderHook(
      (p: UseScrollbackBootstrapOptions) => useScrollbackBootstrap(p),
      { initialProps: props },
    );
    props.settings.setValue(
      SettingScope.Workspace,
      'ui.scrollbackPagerEnabled',
      false,
    );
    rerender(props);
    expect(result.current.restartNotice).not.toBeNull();
    props.settings.setValue(
      SettingScope.Workspace,
      'ui.scrollbackPagerEnabled',
      true,
    );
    rerender(props);
    expect(result.current.restartNotice).toBeNull();
    unmount();
  });

  it('unmount closes the pager store so paging becomes a no-op', async () => {
    const fixture = await makeJournalFixture([
      [1, 'r-01'],
      [2, 'r-02'],
    ]);
    const { props } = makeHarness({
      ui: { scrollbackPagerEnabled: true },
      recordingPath: fixture.filePath,
    });
    const { result, unmount } = renderHook(
      (p: UseScrollbackBootstrapOptions) => useScrollbackBootstrap(p),
      { initialProps: props },
    );
    const pager = result.current.pager;
    expect(pager).not.toBeNull();
    unmount();
    await pager?.store.pageBack();
    expect(pager?.store.getState().rows).toHaveLength(0);
  });
});

describe('scrollbackPagerSettingsFrom', () => {
  it('maps the residency knobs into store settings (KiB to bytes)', () => {
    const settings = makeSettings({
      scrollbackPagerEnabled: true,
      scrollbackMarginViewports: 3,
      scrollbackByteFloorKiB: 512,
    });
    const expected: ScrollbackPagerSettings = {
      marginViewports: 3,
      byteFloorBytes: 512 * 1024,
      purgeDebounceMs: 1500,
    };
    expect(scrollbackPagerSettingsFrom(settings)).toStrictEqual(expected);
  });

  it('falls back to schema defaults when the knobs are missing', () => {
    const settings = makeSettings({ scrollbackPagerEnabled: true });
    const expected: ScrollbackPagerSettings = {
      marginViewports: 2,
      byteFloorBytes: 256 * 1024,
      purgeDebounceMs: 1500,
    };
    expect(scrollbackPagerSettingsFrom(settings)).toStrictEqual(expected);
  });

  it('falls back to schema defaults when the knobs are not finite numbers', () => {
    const settings = makeSettings({
      scrollbackMarginViewports: 'many',
      scrollbackByteFloorKiB: Number.NaN,
    });
    const mapped = scrollbackPagerSettingsFrom(settings);
    expect(mapped.marginViewports).toBe(2);
    expect(mapped.byteFloorBytes).toBe(256 * 1024);
  });
});
