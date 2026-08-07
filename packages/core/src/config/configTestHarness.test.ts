/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'bun:test';
import {
  buildEventsMockBody,
  type HoistedConfigMocks,
} from './configTestHarness.js';
import { CoreEventEmitter } from '../utils/events.js';

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
  it('creates an independent event emitter with prototype methods', () => {
    const coreEvents = new CoreEventEmitter();
    const actual = { coreEvents };

    const mocked = buildEventsMockBody(actual, createHoistedMocks());

    expect(actual.coreEvents).toBe(coreEvents);
    expect(mocked.coreEvents).not.toBe(actual.coreEvents);
    expect(mocked.coreEvents).toBeInstanceOf(CoreEventEmitter);
    expect(mocked.coreEvents.emitFolderTrustChanged).toBeTypeOf('function');
  });

  it('preserves hoisted coreEvents mock method identity on the returned singleton', () => {
    const hoisted = createHoistedMocks();
    const actual = { coreEvents: new CoreEventEmitter() };

    const mocked = buildEventsMockBody(actual, hoisted);

    // The hoisted mock methods must be wired through to the mock singleton so
    // that test assertions against hoisted.coreEvents observe real calls.
    expect(mocked.coreEvents.emitFeedback).toBe(
      hoisted.coreEvents.emitFeedback,
    );
    expect(mocked.coreEvents.emitModelChanged).toBe(
      hoisted.coreEvents.emitModelChanged,
    );
    expect(mocked.coreEvents.emitConsoleLog).toBe(
      hoisted.coreEvents.emitConsoleLog,
    );
  });
});
