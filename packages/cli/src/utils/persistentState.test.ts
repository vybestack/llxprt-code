/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Mock Storage before importing PersistentState
vi.mock('@vybestack/llxprt-code-core', async () => {
  const actual = (await vi.importActual(
    '@vybestack/llxprt-code-core',
  )) as Record<string, unknown>;
  return {
    ...actual,
    Storage: {
      getGlobalLlxprtDir: vi.fn(() => '/tmp/llxprt-test-persistent-state'),
    },
  };
});

import { PersistentState } from './persistentState.js';

describe('PersistentState', () => {
  const testDir = '/tmp/llxprt-test-persistent-state';
  const testFile = path.join(testDir, 'state.json');

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('returns undefined for a key that has not been set', () => {
    const state = new PersistentState();
    expect(state.get('defaultBannerShownCount')).toBeUndefined();
  });

  it('roundtrips a value through set and get', () => {
    const state = new PersistentState();
    const counts = { abc123: 3 };
    state.set('defaultBannerShownCount', counts);
    expect(state.get('defaultBannerShownCount')).toEqual(counts);
  });

  it('persists to disk and survives a new instance', () => {
    const state1 = new PersistentState();
    state1.set('defaultBannerShownCount', { hash1: 2 });

    // New instance reads from disk
    const state2 = new PersistentState();
    expect(state2.get('defaultBannerShownCount')).toEqual({ hash1: 2 });
  });

  it('creates parent directory when it does not exist', () => {
    expect(fs.existsSync(testDir)).toBe(false);
    const state = new PersistentState();
    state.set('defaultBannerShownCount', { x: 1 });
    expect(fs.existsSync(testDir)).toBe(true);
    expect(fs.existsSync(testFile)).toBe(true);
  });

  it('handles corrupt JSON gracefully without throwing', () => {
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(testFile, '{not valid json!!!');

    const state = new PersistentState();
    // Should not throw, returns undefined for missing key
    expect(state.get('defaultBannerShownCount')).toBeUndefined();
  });

  it('overwrites previous value on subsequent set', () => {
    const state = new PersistentState();
    state.set('defaultBannerShownCount', { a: 1 });
    state.set('defaultBannerShownCount', { a: 5, b: 2 });
    expect(state.get('defaultBannerShownCount')).toEqual({ a: 5, b: 2 });
  });
});
