/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';

import { validateRuntimeId } from './runtimeIdValidation.js';

describe('runtime id validation', () => {
  it.each(['', '  ', '\t\n', null, undefined, 123, false])(
    'rejects invalid external runtime label %p',
    (runtimeId) => {
      expect(() => validateRuntimeId(runtimeId)).toThrow('Invalid runtimeId');
    },
  );
});
