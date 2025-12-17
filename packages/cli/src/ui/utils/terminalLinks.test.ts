/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { createOsc8Link } from './terminalLinks.js';

describe('createOsc8Link', () => {
  it('uses BEL terminators (not ST) for OSC-8 links', () => {
    const link = createOsc8Link('Click', 'https://example.com');

    expect(link).toBe('\x1b]8;;https://example.com\x07Click\x1b]8;;\x07');
    expect(link).not.toContain('\x1b\\');
  });
});
