/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #2533 — SUBAGENT_EXCLUDED_TOOL_NAMES must stay in lockstep with the
 * Name constants of the tools it excludes. A spelling drift between the
 * manifest and the real tool names would silently let subagents spawn
 * nested subagents or list their siblings.
 */

import { describe, it, expect } from 'bun:test';
import { SUBAGENT_EXCLUDED_TOOL_NAMES } from './toolGovernance.js';
import { TaskTool } from '../tools/task.js';
import { ListSubagentsTool } from '@vybestack/llxprt-code-tools';

describe('SUBAGENT_EXCLUDED_TOOL_NAMES', () => {
  it('excludes exactly the task and list_subagents tool names', () => {
    expect([...SUBAGENT_EXCLUDED_TOOL_NAMES].sort()).toStrictEqual(
      [TaskTool.Name, ListSubagentsTool.Name].sort(),
    );
  });
});
