/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { assembleSessionAuthentication } from './session-authentication.js';

describe('assembleSessionAuthentication without an OAuth manager', () => {
  it('reports the control as unavailable', () => {
    const control = assembleSessionAuthentication(undefined, () => {});

    expect(control.isAvailable()).toBe(false);
  });

  it('fails when the attempt outcome is requested instead of returning an empty outcome', () => {
    const control = assembleSessionAuthentication(undefined, () => {});

    expect(() => control.takeAuthOutcome()).toThrow(
      'OAuth runtime infrastructure is unavailable.',
    );
  });
});
