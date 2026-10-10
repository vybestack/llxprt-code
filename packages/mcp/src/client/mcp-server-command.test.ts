/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { populateMcpServerCommand } from './mcp-client.js';
describe('appendMcpServerCommand', () => {
  it('should do nothing if no MCP servers or command are configured', () => {
    const out = populateMcpServerCommand({}, undefined);
    expect(out).toStrictEqual({});
  });

  it('should discover tools via mcpServerCommand', () => {
    const commandString = 'command --arg1 value1';
    const out = populateMcpServerCommand({}, commandString);
    expect(out).toStrictEqual({
      mcp: {
        command: 'command',
        args: ['--arg1', 'value1'],
      },
    });
  });

  it('should handle error if mcpServerCommand parsing fails', () => {
    expect(() => populateMcpServerCommand({}, 'derp && herp')).toThrowError(
      /failed to parse mcpServerCommand/,
    );
  });
});
