/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Static-item composition coverage for DefaultAppLayoutHelpers (issue #2025).
 *
 * `useStaticItems` decides what the standard-buffer layout commits to Ink's
 * static region. `LLXPRT_CODE_SUPPRESS_STATIC_HEADER` drops the app header so
 * a fresh session commits nothing at all, which is what lets the standard
 * buffer skip the static region entirely on a clean startup.
 */

import { restoreEnv, setEnv } from '@vybestack/llxprt-code-test-utils';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'bun:test';
import type React from 'react';
import { Config } from '@vybestack/llxprt-code-core';
import { renderHook } from '../../test-utils/render.js';
import { LoadedSettings } from '../../config/settings.js';
import { buildSlashCommandRuntime } from '../cliUiRuntime.js';
import { useStaticItems } from './DefaultAppLayoutHelpers.js';
import { AppHeader } from '../components/AppHeader.js';
import { HistoryItemDisplay } from '../components/HistoryItemDisplay.js';
import type { HistoryItem } from '../types.js';

const SUPPRESS_STATIC_HEADER = 'LLXPRT_CODE_SUPPRESS_STATIC_HEADER';

const config = buildSlashCommandRuntime(
  new Config({
    sessionId: 'default-app-layout-helpers-test',
    targetDir: tmpdir(),
    cwd: tmpdir(),
    debugMode: false,
    model: 'test-model',
  }),
);

const settings = new LoadedSettings(
  { path: '/system/settings.json', settings: {} },
  { path: '/system/defaults.json', settings: {} },
  { path: '/user/settings.json', settings: {} },
  { path: '/workspace/settings.json', settings: {} },
  true,
);

function buildHistory(...ids: number[]): HistoryItem[] {
  return ids.map((id) => ({ id, type: 'user', text: `item-${id}` }));
}

/** Drives the hook with the layout's real argument shape. */
function renderStaticItems(history: HistoryItem[]): React.ReactElement[] {
  const { result } = renderHook(() =>
    useStaticItems(
      config,
      settings,
      '1.0.0',
      false,
      100,
      history,
      100,
      100,
      undefined,
      false,
      null,
      false,
    ),
  );
  return result.current;
}

describe('useStaticItems', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('commits nothing when the header is suppressed and history is empty', () => {
    setEnv(SUPPRESS_STATIC_HEADER, 'true');

    expect(renderStaticItems([])).toStrictEqual([]);
  });

  it('commits history items but not the header when the header is suppressed', () => {
    setEnv(SUPPRESS_STATIC_HEADER, 'true');

    const items = renderStaticItems(buildHistory(1, 2));

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.type)).toStrictEqual([
      HistoryItemDisplay,
      HistoryItemDisplay,
    ]);
    expect(items.map((item) => item.key)).toStrictEqual(['1', '2']);
  });

  it('commits the header alone when suppression is off and history is empty', () => {
    setEnv(SUPPRESS_STATIC_HEADER, undefined);

    const items = renderStaticItems([]);

    expect(items).toHaveLength(1);
    expect(items[0]?.type).toBe(AppHeader);
    expect(items[0]?.key).toBe('header');
  });

  it('commits the header first, ahead of history, when suppression is off', () => {
    setEnv(SUPPRESS_STATIC_HEADER, undefined);

    const items = renderStaticItems(buildHistory(1, 2));

    expect(items).toHaveLength(3);
    expect(items.map((item) => item.type)).toStrictEqual([
      AppHeader,
      HistoryItemDisplay,
      HistoryItemDisplay,
    ]);
    expect(items.map((item) => item.key)).toStrictEqual(['header', '1', '2']);
  });

  it('commits the header when the suppression value is not the literal "true"', () => {
    setEnv(SUPPRESS_STATIC_HEADER, '1');

    const items = renderStaticItems([]);

    expect(items).toHaveLength(1);
    expect(items[0]?.type).toBe(AppHeader);
    expect(items[0]?.key).toBe('header');
  });
});
