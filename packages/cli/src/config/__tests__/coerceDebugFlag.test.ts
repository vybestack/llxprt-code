/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { coerceDebugFlag } from '../yargsOptions.js';

describe('coerceDebugFlag', () => {
  it('returns undefined when the flag is absent', () => {
    expect(coerceDebugFlag(undefined)).toBeUndefined();
  });

  it('coerces a bare --debug (empty string value) to true', () => {
    expect(coerceDebugFlag('')).toBe(true);
  });

  it('coerces a boolean true (yargs short-circuit) to true', () => {
    expect(coerceDebugFlag(true)).toBe(true);
  });

  it.each(['false', '0', 'no', 'off'])(
    'normalizes false-like value %j to boolean false',
    (value) => {
      expect(coerceDebugFlag(value)).toBe(false);
    },
  );

  it.each(['FALSE', 'Off', 'No', ' 0 '])(
    'normalizes false-like value %j case-insensitively and trimmed',
    (value) => {
      expect(coerceDebugFlag(value)).toBe(false);
    },
  );

  it('preserves a namespace specifier string', () => {
    expect(coerceDebugFlag('llxprt:core:*')).toBe('llxprt:core:*');
  });

  it('preserves a comma-separated namespace list', () => {
    expect(coerceDebugFlag('llxprt:core:*,llxprt:openai:*')).toBe(
      'llxprt:core:*,llxprt:openai:*',
    );
  });

  it('is idempotent for already-coerced boolean results', () => {
    expect(coerceDebugFlag(coerceDebugFlag(''))).toBe(true);
    expect(coerceDebugFlag(coerceDebugFlag('false'))).toBe(false);
  });
});
