/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { listCommand } from './list.js';

// The listing behavior (discovery, enabled/disabled markers, output) runs the
// real CLI entry in list.subprocess.test.ts.
describe('skills list command', () => {
  it('should have correct command and describe', () => {
    expect(listCommand.command).toBe('list [--all]');
    expect(listCommand.describe).toBe('Lists discovered skills.');
  });
});
