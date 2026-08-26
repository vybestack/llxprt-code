/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { makeFakeConfig } from '../test-utils/config.js';

describe('Config.getUtilityModel (interim setting read, issue #2627)', () => {
  it('returns undefined when no utilityModel is configured', () => {
    const config = makeFakeConfig();
    expect(config.getUtilityModel()).toBeUndefined();
  });

  it('returns the configured utilityModel', () => {
    const config = makeFakeConfig({
      ephemeralSettings: { utilityModel: 'utility-model-x' },
    });
    expect(config.getUtilityModel()).toBe('utility-model-x');
  });

  it('normalizes an empty string to undefined', () => {
    const config = makeFakeConfig({
      ephemeralSettings: { utilityModel: '' },
    });
    expect(config.getUtilityModel()).toBeUndefined();
  });

  it('normalizes a whitespace-only string to undefined', () => {
    const config = makeFakeConfig({
      ephemeralSettings: { utilityModel: '   ' },
    });
    expect(config.getUtilityModel()).toBeUndefined();
  });

  it('trims surrounding whitespace from a configured utilityModel', () => {
    const config = makeFakeConfig({
      ephemeralSettings: { utilityModel: '  utility-model-x  ' },
    });
    expect(config.getUtilityModel()).toBe('utility-model-x');
  });
});
