/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { appReducer, initialAppState } from './appReducer.js';

describe('appReducer', () => {
  it('starts with relogin disabled and no theme refreshes', () => {
    expect(initialAppState).toStrictEqual({
      themeRevision: 0,
      needsRelogin: false,
    });
  });
  it('advances theme revision without changing the relogin gate or previous state', () => {
    const gated = appReducer(initialAppState, {
      type: 'SET_NEEDS_RELOGIN',
      payload: true,
    });
    const refreshed = appReducer(gated, { type: 'REFRESH_THEME' });
    expect(refreshed).toStrictEqual({ themeRevision: 1, needsRelogin: true });
    expect(gated).toStrictEqual({ themeRevision: 0, needsRelogin: true });
    expect(appReducer(refreshed, { type: 'REFRESH_THEME' }).themeRevision).toBe(
      2,
    );
  });
});
