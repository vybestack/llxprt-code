/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { READ_ONLY_TOOL_NAMES } from '../toolGovernance.js';

describe('non-interactive approval defaults', () => {
  it('treats ls as a read-only tool', () => {
    expect(
      READ_ONLY_TOOL_NAMES.map((name) => name.trim().toLowerCase()),
    ).toContain('ls');
  });

  it('admits the code mode tools, whose scripts stay within the same allowed list (issue #4084)', () => {
    expect(READ_ONLY_TOOL_NAMES).toContain('execute_tool_script');
    expect(READ_ONLY_TOOL_NAMES).toContain('discover_tool_api');
    expect(READ_ONLY_TOOL_NAMES).not.toContain('run_shell_command');
  });
});
