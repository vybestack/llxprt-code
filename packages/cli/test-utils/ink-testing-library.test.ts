/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { afterEach, describe, expect, it } from 'bun:test';
import { useStdin } from './ink-stub.js';
import { cleanup, render } from './ink-testing-library.js';

afterEach(() => {
  cleanup();
});

describe('ink-testing-library stdin ownership', () => {
  it('restores the most recent remaining render when an older render is cleaned up', () => {
    const first = render(React.createElement(React.Fragment));
    const second = render(React.createElement(React.Fragment));

    expect(useStdin().stdin).toBe(second.stdin);

    first.cleanup();

    expect(useStdin().stdin).toBe(second.stdin);
  });
});
