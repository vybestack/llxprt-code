/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * This test verifies we can provide MCP tools with recursive input schemas
 * (in JSON, using the $ref keyword) and both the GenAI SDK and the provider
 * API calls succeed. This ensures LLxprt can handle MCP tools with cyclic
 * schema definitions without rejecting them.
 *
 * If this test fails, it's likely because either the GenAI SDK or provider API
 * has become more restrictive about the type of tool parameter schemas that
 * are accepted.
 */

import { unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { TestRig } from './test-helper.js';

// Skip interactive MCP cyclic-schema test in CI for now:
// - It is PTY/TUI driven and flakes in hosted runners
// - It can also be affected by upstream provider/auth transient issues unrelated
//   to the cyclic schema behavior being validated.
// Keep it enabled locally for deterministic debugging and development.
const skipInCi = process.env.CI === 'true';

// Create a minimal MCP server that doesn't require external dependencies
// This implements the MCP protocol directly using Node.js built-ins
const serverScript = `#!/usr/bin/env node
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const readline = require('readline');
const fs = require('fs');

// Debug logging to stderr (only when MCP_DEBUG or VERBOSE is set)
const debugEnabled = process.env['MCP_DEBUG'] === 'true' || process.env['VERBOSE'] === 'true';
function debug(msg) {
  if (debugEnabled) {
    fs.writeSync(2, \`[MCP-DEBUG] \${msg}\\n\`);
  }
}

debug('MCP server starting...');

// Simple JSON-RPC implementation for MCP
class SimpleJSONRPC {
  constructor() {
    this.handlers = new Map();
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    });

    this.rl.on('line', (line) => {
      debug(\`Received line: \${line}\`);
      try {
        const message = JSON.parse(line);
        debug(\`Parsed message: \${JSON.stringify(message)}\`);
        this.handleMessage(message);
      } catch (e) {
        debug(\`Parse error: \${e.message}\`);
      }
    });
  }

  send(message) {
    const msgStr = JSON.stringify(message);
    debug(\`Sending message: \${msgStr}\`);
    process.stdout.write(msgStr + '\\n');
  }

  async handleMessage(message) {
    if (message.method && this.handlers.has(message.method)) {
      try {
        const result = await this.handlers.get(message.method)(message.params || {});
        if (message.id !== undefined) {
          this.send({
            jsonrpc: '2.0',
            id: message.id,
            result
          });
        }
      } catch (error) {
        if (message.id !== undefined) {
          this.send({
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32603,
              message: error.message
            }
          });
        }
      }
    } else if (message.id !== undefined) {
      this.send({
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32601,
          message: 'Method not found'
        }
      });
    }
  }

  on(method, handler) {
    this.handlers.set(method, handler);
  }
}

// Create MCP server
const rpc = new SimpleJSONRPC();

// Handle initialize
rpc.on('initialize', async (params) => {
  debug('Handling initialize request');
  return {
    protocolVersion: '2024-11-05',
    capabilities: {
      tools: {}
    },
    serverInfo: {
      name: 'cyclic-schema-server',
      version: '1.0.0'
    }
  };
});

// Handle tools/list
rpc.on('tools/list', async () => {
  debug('Handling tools/list request');
  return {
    tools: [{
      name: 'tool_with_cyclic_schema',
      inputSchema: {
        type: 'object',
        properties: {
          data: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                child: { $ref: '#/properties/data/items' },
              },
            },
          },
        },
      }
    }]
  };
});
`;

describe.skipIf(skipInCi)(
  'mcp server with cyclic tool schema is detected',
  () => {
    const rig = new TestRig();

    beforeAll(async () => {
      // Setup test directory with MCP server configuration
      await rig.setup('cyclic-schema-mcp-server', {
        settings: {
          mcpServers: {
            'cyclic-schema-server': {
              command: 'node',
              args: ['mcp-server.cjs'],
            },
          },
        },
      });

      process.env.LLXPRT_CODE_WELCOME_CONFIG_PATH = join(
        rig.testDir!,
        'welcome-config.json',
      );

      writeFileSync(
        process.env.LLXPRT_CODE_WELCOME_CONFIG_PATH,
        JSON.stringify({ welcomeCompleted: true }, null, 2),
      );

      // Create server script in the test directory
      const testServerPath = join(rig.testDir!, 'mcp-server.cjs');
      writeFileSync(testServerPath, serverScript);

      // Make the script executable (though running with 'node' should work anyway)
      if (process.platform !== 'win32') {
        const { chmodSync } = await import('node:fs');
        chmodSync(testServerPath, 0o755);
      }
    });

    afterAll(() => {
      if (process.env.LLXPRT_CODE_WELCOME_CONFIG_PATH) {
        try {
          unlinkSync(process.env.LLXPRT_CODE_WELCOME_CONFIG_PATH);
        } catch {
          // File may not exist or already cleaned up
        }
      }

      delete process.env.LLXPRT_CODE_WELCOME_CONFIG_PATH;
    });

    it('mcp tool list should include tool with cyclic tool schema', async () => {
      const run = await rig.runInteractive();

      try {
        // MCP discovery can be slow in sandbox/docker and on Windows. Retry `/mcp list`
        // until the tool appears (or we time out).
        const deadline = Date.now() + 120_000;
        while (Date.now() < deadline) {
          await run.type('/mcp list');
          await run.type('\r'); // Submit command with Enter key

          try {
            await run.expectText('tool_with_cyclic_schema', 2000);
            return;
          } catch {
            await new Promise((resolve) => setTimeout(resolve, 3000));
          }
        }

        // Final assertion with a longer timeout so failures show a clear error.
        await run.expectText('tool_with_cyclic_schema', 10_000);
      } finally {
        await run.kill();
      }
    });
  },
);
