/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for inferToolKind (issue #1605): every mapped internal tool
 * name must resolve to a valid ACP ToolKind, and unknown names must yield
 * undefined (rendered as an omitted kind — ACP's "other"-equivalent default)
 * rather than an invalid value on the wire.
 */

import { describe, it, expect } from 'vitest';
import { inferToolKind } from './zed-tool-handler.js';

const ACP_TOOL_KINDS = [
  'read',
  'edit',
  'delete',
  'move',
  'search',
  'execute',
  'think',
  'fetch',
  'switch_mode',
  'other',
] as const;

describe('inferToolKind (issue #1605: ToolKind mapping)', () => {
  it.each([
    ['read_file', 'read'],
    ['read_many_files', 'read'],
    ['list_directory', 'read'],
    ['glob', 'read'],
    ['search_file_content', 'read'],
    ['write_file', 'edit'],
    ['replace', 'edit'],
    ['apply_patch', 'edit'],
    ['delete_line_range', 'edit'],
    ['run_shell_command', 'execute'],
    ['direct_web_fetch', 'fetch'],
    ['exa_web_search', 'fetch'],
    ['web_fetch', 'fetch'],
    ['todo_write', 'think'],
    ['todo_read', 'think'],
    ['save_memory', 'think'],
  ])('maps %s -> %s', (name, expected) => {
    const kind = inferToolKind(name);
    expect(kind).toBe(expected);
    // Whatever the table says, the value must be a REAL ACP ToolKind.
    expect(ACP_TOOL_KINDS).toContain(kind);
  });

  it('returns undefined for an unknown tool name (kind omitted on the wire, never an invalid value)', () => {
    expect(inferToolKind('some_mcp_server_tool')).toBeUndefined();
    expect(inferToolKind('')).toBeUndefined();
  });
});
