/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { createMockConfig } from './testing_utils.js';

describe('createMockConfig', () => {
  it('includes disposeScheduler for scheduler cleanup', () => {
    const config = createMockConfig();
    expect(config.disposeScheduler).toBeTypeOf('function');
  });
});
