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
import { inferToolKind, TOOL_KIND_BY_NAME } from './zed-tool-handler.js';

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
  it.each([...TOOL_KIND_BY_NAME.entries()])(
    'maps %s -> %s',
    (name, expected) => {
      const kind = inferToolKind(name);
      expect(kind).toBe(expected);
      // Every table entry — including future additions — must be a REAL ACP
      // ToolKind, so an invalid wire value cannot hide in an untested entry.
      expect(ACP_TOOL_KINDS).toContain(kind);
    },
  );

  it('returns undefined for an unknown tool name (kind omitted on the wire, never an invalid value)', () => {
    expect(inferToolKind('some_mcp_server_tool')).toBeUndefined();
    expect(inferToolKind('')).toBeUndefined();
  });
});
