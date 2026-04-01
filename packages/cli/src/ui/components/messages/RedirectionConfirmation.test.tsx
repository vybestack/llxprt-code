/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { hasRedirection } from '@vybestack/llxprt-code-core';

describe('redirection warning detection', () => {
  it('detects redirection for command with > operator', () => {
    expect(hasRedirection('echo "hello" > test.txt')).toBe(true);
  });

  it('does not detect redirection for command without redirection', () => {
    expect(hasRedirection('git status')).toBe(false);
  });

  it('detects redirection for compound command with redirection', () => {
    expect(hasRedirection('git log && cat file.txt > out.txt')).toBe(true);
  });

  it('does not detect redirection for > inside double quotes', () => {
    expect(hasRedirection('echo "use > to redirect"')).toBe(false);
  });
});
