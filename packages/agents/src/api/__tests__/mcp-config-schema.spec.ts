/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { McpServerConfigSchema } from '../config-schema.js';
import type { AgentMcpServerConfig } from '../config-types.js';

describe('McpServerConfigSchema', () => {
  it('accepts streamable-http as a public Agent API transport alias', () => {
    const config: AgentMcpServerConfig = {
      url: 'https://mcp.webflow.com/mcp',
      type: 'streamable-http',
    };

    expect(McpServerConfigSchema.parse(config)).toStrictEqual(config);
  });
});
