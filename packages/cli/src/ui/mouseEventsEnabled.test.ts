/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { isMouseEventsEnabled } from './mouseEventsEnabled.js';

describe('isMouseEventsEnabled', () => {
  it('returns false when alternate buffer is disabled', () => {
    expect(
      isMouseEventsEnabled(
        { alternateBuffer: false },
        { merged: { ui: { enableMouseEvents: true } } },
      ),
    ).toBe(false);
  });

  it('returns false when enableMouseEvents is not true', () => {
    expect(
      isMouseEventsEnabled({ alternateBuffer: true }, { merged: { ui: {} } }),
    ).toBe(false);
  });

  it('returns false when enableMouseEvents is explicitly false', () => {
    expect(
      isMouseEventsEnabled(
        { alternateBuffer: true },
        { merged: { ui: { enableMouseEvents: false } } },
      ),
    ).toBe(false);
  });

  it('returns true when alternate buffer and enableMouseEvents are true', () => {
    expect(
      isMouseEventsEnabled(
        { alternateBuffer: true },
        { merged: { ui: { enableMouseEvents: true } } },
      ),
    ).toBe(true);
  });
});
