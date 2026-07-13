/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import {
  buildEventsMockBody,
  type HoistedConfigMocks,
} from './configTestHarness.js';

function createHoistedMocks(): HoistedConfigMocks {
  return {
    loadJitSubdirectoryMemory: vi.fn(),
    coreEvents: {
      emitFeedback: vi.fn(),
      emitModelChanged: vi.fn(),
      emitConsoleLog: vi.fn(),
    },
    setGlobalProxy: vi.fn(),
  };
}

describe('buildEventsMockBody', () => {
  it('does not mutate the imported coreEvents object', () => {
    const originalEmit = vi.fn();
    const actual = {
      coreEvents: { emit: originalEmit, existing: true },
    };

    const mocked = buildEventsMockBody(actual, createHoistedMocks());

    expect(actual.coreEvents).toStrictEqual({
      emit: originalEmit,
      existing: true,
    });
    expect(mocked.coreEvents).not.toBe(actual.coreEvents);
    expect(mocked.coreEvents).toMatchObject({ existing: true });
    expect(mocked.coreEvents.emit).not.toBe(originalEmit);
  });
});
