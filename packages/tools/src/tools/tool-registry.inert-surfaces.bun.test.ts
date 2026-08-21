/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Absence contract for the inert fully-qualified tool-name surface removed in the
 * 0.12.0 breaking cleanup. This is not a happy-path test: it asserts the
 * names are gone from the source so any re-introduction fails instantly.
 *
 * The removed members/helpers were never reachable: `DiscoveredMCPTool` stopped
 * providing a fully-qualified name, and `ToolRegistry.getTool` no longer falls
 * back through that name when a candidate contains an underscore pair. The names
 * are built from fragments below so the test never references removed production
 * code while still catching a future re-introduction.
 */

import { describe, it, expect } from 'bun:test';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';

const MCP_SRC = path.join(__dirname, '../../../mcp/src/client/mcp-tool.ts');

const QUALIFIED_NAME = 'getFully' + 'Qualified' + 'Name';
const QUALIFIED_PREFIX = 'getFully' + 'Qualified' + 'Prefix';
const QUALIFIED_TOOL = 'asFully' + 'Qualified' + 'Tool';
const SEPARATOR = '__';

describe('inert tool-name surface absence (0.12.0 breaking cleanup)', () => {
  it('does not re-introduce the removed MCP tool name helpers', async () => {
    const source = await readFile(MCP_SRC, 'utf-8');
    // The joined names never appear in production source. A future re-add of the
    // dead surface trips these assertions even if nothing exercises it.
    expect(source).not.toContain(QUALIFIED_NAME);
    expect(source).not.toContain(QUALIFIED_PREFIX);
    expect(source).not.toContain(QUALIFIED_TOOL);
  });

  it('does not re-introduce the underscore-pair fallback in the tool registry', async () => {
    const source = await readFile(
      path.join(__dirname, 'tool-registry.ts'),
      'utf-8',
    );
    // The normalized-name lookup is live; the fully-qualified fallback (never
    // reachable after the removal) must stay gone.
    expect(source).not.toContain(QUALIFIED_NAME);
    expect(source).not.toContain(SEPARATOR + QUALIFIED_NAME);
  });
});
