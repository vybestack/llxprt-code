/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fc from 'fast-check';

export const nonBlankStringArbitrary = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((value) => value.trim() !== '');
