/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue('{}'),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('{}'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));
vi.mock('node:path');
vi.mock('node:os', () => ({
  default: {
    homedir: vi.fn().mockReturnValue('/tmp/test-home'),
    platform: vi.fn().mockReturnValue('linux'),
  },
  homedir: vi.fn().mockReturnValue('/tmp/test-home'),
  platform: vi.fn().mockReturnValue('linux'),
}));

import { Config } from '../config.js';

describe('Config.getPreviewFeatures()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults to false when not specified', () => {
    const config = new Config({});
    expect(config.getPreviewFeatures()).toBe(false);
  });

  it('returns true when previewFeatures is true', () => {
    const config = new Config({ previewFeatures: true });
    expect(config.getPreviewFeatures()).toBe(true);
  });

  it('returns false when previewFeatures is explicitly false', () => {
    const config = new Config({ previewFeatures: false });
    expect(config.getPreviewFeatures()).toBe(false);
  });
});
