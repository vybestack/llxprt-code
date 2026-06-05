/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { appReducer, initialAppState, type AppAction } from './appReducer.js';

describe('appReducer needsRelogin', () => {
  it('initial state has needsRelogin false', () => {
    expect(initialAppState.needsRelogin).toBe(false);
  });

  it('SET_NEEDS_RELOGIN true sets needsRelogin to true', () => {
    const action: AppAction = {
      type: 'SET_NEEDS_RELOGIN',
      payload: true,
    };

    const result = appReducer(initialAppState, action);

    expect(result.needsRelogin).toBe(true);
  });

  it('SET_NEEDS_RELOGIN false clears needsRelogin', () => {
    const stateWithRelogin = appReducer(initialAppState, {
      type: 'SET_NEEDS_RELOGIN',
      payload: true,
    });

    const result = appReducer(stateWithRelogin, {
      type: 'SET_NEEDS_RELOGIN',
      payload: false,
    });

    expect(result.needsRelogin).toBe(false);
  });

  it('SET_NEEDS_RELOGIN maintains immutability', () => {
    const action: AppAction = {
      type: 'SET_NEEDS_RELOGIN',
      payload: true,
    };

    const result = appReducer(initialAppState, action);

    expect(result).not.toBe(initialAppState);
    expect(result.openDialogs).toBe(initialAppState.openDialogs);
    expect(result.errors).toBe(initialAppState.errors);
  });
});
