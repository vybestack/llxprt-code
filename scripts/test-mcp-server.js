#!/usr/bin/env node

/**
 * Simple MCP Test Server for LLxprt
 * Properly implements MCP protocol using the official SDK
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Create the MCP server instance
const server = new Server(
  {
    name: 'llxprt-test-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// Define our test tools
const tools = [
  {
    name: 'get_current_time',
    description: 'Get the current time in various formats',
    inputSchema: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: ['iso', 'unix', 'locale'],
          description: 'Time format (iso, unix, or locale)',
          default: 'iso',
        },
        timezone: {
          type: 'string',
          description: 'Timezone (e.g., UTC, America/New_York)',
          default: 'UTC',
        },
      },
    },
  },
  {
    name: 'echo',
    description: 'Echo back the input message',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Message to echo back',
        },
      },
      required: ['message'],
    },
  },
  {
    name: 'random_number',
    description: 'Generate a random number',
    inputSchema: {
      type: 'object',
      properties: {
        min: {
          type: 'number',
          description: 'Minimum value',
          default: 0,
        },
        max: {
          type: 'number',
          description: 'Maximum value',
          default: 100,
        },
      },
    },
  },
];

// Handle tools/list request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools,
  };
});

// Handle tools/call request
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  switch (name) {
    case 'get_current_time': {
      const now = new Date();
      let timeString;

      switch (args.format || 'iso') {
        case 'unix':
          timeString = Math.floor(now.getTime() / 1000).toString();
          break;
        case 'locale':
          timeString = now.toLocaleString();
          break;
        case 'iso':
        default:
          timeString = now.toISOString();
      }

      return {
        content: [
          {
            type: 'text',
            text: `Current time: ${timeString}`,
          },
        ],
      };
    }

    case 'echo': {
      return {
        content: [
          {
            type: 'text',
            text: args.message || 'No message provided',
          },
        ],
      };
    }

    case 'random_number': {
      const min = args.min || 0;
      const max = args.max || 100;
      const random = Math.floor(Math.random() * (max - min + 1)) + min;

      return {
        content: [
          {
            type: 'text',
            text: `Random number between ${min} and ${max}: ${random}`,
          },
        ],
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr so it doesn't interfere with protocol
  console.error('MCP Test Server running...');
}

// Handle errors
main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});

// Handle shutdown
process.on('SIGINT', () => {
  console.error('Shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('Shutting down...');
  process.exit(0);
});
