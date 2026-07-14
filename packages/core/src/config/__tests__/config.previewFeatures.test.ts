/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { Config } from '../config.js';

describe('config.ts previewFeatures removal', () => {
  it('does not expose getPreviewFeatures on Config anymore', () => {
    expect(
      Object.prototype.hasOwnProperty.call(
        Config.prototype,
        'getPreviewFeatures',
      ),
    ).toBe(false);
  });
});
