/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { FatalSandboxError } from '@vybestack/llxprt-code-core';
import { parseCustomMount } from './sandbox-containers.js';

describe('parseCustomMount', () => {
  it('preserves Windows drive letters in source and target paths', () => {
    expect(parseCustomMount('C:\\source:D:\\target:rw')).toEqual([
      'C:\\source',
      'D:\\target',
      'rw',
    ]);
    expect(parseCustomMount('C:\\source:D:\\target:ro')).toEqual([
      'C:\\source',
      'D:\\target',
      'ro',
    ]);
  });

  it('rejects an unsupported explicit mount mode', () => {
    expect(() => parseCustomMount('/src:/dst:invalid')).toThrow(
      FatalSandboxError,
    );
    expect(() => parseCustomMount('/src:/dst:invalid')).toThrow(
      "Unsupported mount mode 'invalid'",
    );
  });
});
