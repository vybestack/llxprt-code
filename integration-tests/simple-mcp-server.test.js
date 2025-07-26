/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { test, describe, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { TestRig } from './test-helper.js';
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, unlinkSync, mkdirSync } from 'fs';

// Skip MCP tests in CI when using OpenRouter as tool extraction may vary by model
if (process.env.OPENAI_BASE_URL?.includes('openrouter')) {
  console.log('Skipping MCP server tests when using OpenRouter');
  test.skip('MCP server tests skipped for OpenRouter', () => {});
} else {
  const __dirname = fileURLToPath(new URL('.', import.meta.url));
  const serverScriptPath = join(__dirname, './temp-server.js');

  const serverScript = `
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({
  name: 'addition-server',
  version: '1.0.0',
});

server.registerTool(
  'add',
  {
    title: 'Addition Tool',
    description: 'Add two numbers',
    inputSchema: { a: z.number(), b: z.number() },
  },
  async ({ a, b }) => ({
    content: [{ type: 'text', text: String(a + b) }],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
`;

  describe('simple-mcp-server', () => {
    const rig = new TestRig();
    let child;

    before(() => {
      writeFileSync(serverScriptPath, serverScript);
      child = spawn('node', [serverScriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      child.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
      });
      // Wait for the server to be ready
      return new Promise((resolve) => setTimeout(resolve, 500));
    });

    after(() => {
      child.kill();
      unlinkSync(serverScriptPath);
    });

    test('should add two numbers', () => {
      rig.setup('should add two numbers');
      // Create a settings file with MCP server configuration
      const settingsPath = join(rig.testDir, '.llxprt', 'settings.json');
      mkdirSync(dirname(settingsPath), { recursive: true });
      writeFileSync(
        settingsPath,
        JSON.stringify(
          {
            mcpServers: {
              'addition-server': {
                command: 'node',
                args: [serverScriptPath],
              },
            },
          },
          null,
          2,
        ),
      );

      const output = rig.run('What is 5 + 10?');
      assert.ok(output.includes('15'));
    });
  });
} // End of else block for OpenRouter skip
