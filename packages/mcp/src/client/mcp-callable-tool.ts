/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type {
  CallToolResult,
  Tool as McpTool,
} from '@modelcontextprotocol/sdk/types.js';
import type {
  CallableTool,
  ToolCallRequest as FunctionCall,
  ContentPart as Part,
  ToolDeclarations as Tool,
} from '@vybestack/llxprt-code-tools';
import { createDefaultByteBudget } from '@vybestack/llxprt-code-tools/acquisition.js';
import { MCP_CAPABILITY_NOT_AUTHORIZED_MESSAGE } from './mcp-errors.js';
import { firstTruthyString } from '../utils/string-fallback.js';

const MCP_CONTENT_BUDGET = createDefaultByteBudget();

/** Content block element type derived from the SDK's CallToolResult. */
type McpContentBlock = CallToolResult['content'][number];

/** The full return type of Client.callTool (content variant ∪ task variant). */
type CallToolReturn = Awaited<ReturnType<Client['callTool']>>;

function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

/**
 * Compile-time exhaustiveness guard. If a new content block variant is added
 * to the SDK, this function's `never` parameter will fail to accept the
 * unhandled variant, producing a compile error at every switch site.
 */
function assertNeverContent(block: never): never {
  throw new Error(
    `Unrecognized MCP content block type: ${JSON.stringify(block)}`,
  );
}

function countContentBlockBytes(block: McpContentBlock): number {
  switch (block.type) {
    case 'text':
      return utf8ByteLength(block.text);
    case 'image':
      return utf8ByteLength(block.data);
    case 'audio':
      return utf8ByteLength(block.data);
    case 'resource': {
      if ('text' in block.resource) {
        return utf8ByteLength(block.resource.text);
      }
      return utf8ByteLength(block.resource.blob);
    }
    case 'resource_link': {
      const label = firstTruthyString(block.title, block.name);
      return utf8ByteLength(`Resource Link: ${label} at ${block.uri}`);
    }
    default:
      return assertNeverContent(block);
  }
}

function countAggregateContentBytes(
  content: readonly McpContentBlock[],
  limit: number,
): number {
  let total = 0;
  for (const block of content) {
    total += countContentBlockBytes(block);
    if (total > limit) return total;
  }
  return total;
}

/**
 * Narrows a callTool result to the standard variant carrying a `content`
 * array. The SDK also returns a compatibility/task variant with `toolResult`
 * and no `content` — that variant has nothing to count.
 */
function hasContentArray(
  result: CallToolReturn,
): result is CallToolReturn & { content: McpContentBlock[] } {
  return 'content' in result && Array.isArray(result.content);
}

/**
 * Adapts an MCP tool definition to the neutral CallableTool interface so it
 * can be invoked through DiscoveredMCPTool.
 */
export class McpCallableTool implements CallableTool {
  constructor(
    private readonly client: Client,
    private readonly toolDef: McpTool,
    private readonly timeout: number,
    private readonly isAuthorized: () => boolean = () => true,
  ) {}

  async tool(): Promise<Tool> {
    return {
      functionDeclarations: [
        {
          name: this.toolDef.name,
          description: this.toolDef.description,
          parametersJsonSchema: this.toolDef.inputSchema,
        },
      ],
    };
  }

  async callTool(functionCalls: FunctionCall[]): Promise<Part[]> {
    // We only expect one function call at a time for MCP tools in this context
    if (functionCalls.length !== 1) {
      throw new Error('McpCallableTool only supports single function call');
    }
    const call = functionCalls[0];
    if (typeof call.name !== 'string' || call.name.length === 0) {
      throw new Error('McpCallableTool requires a non-empty function name');
    }

    try {
      if (!this.isAuthorized()) {
        throw new Error(MCP_CAPABILITY_NOT_AUTHORIZED_MESSAGE);
      }
      const result = await this.client.callTool(
        {
          name: call.name,
          arguments: call.args ?? {},
        },
        undefined,
        { timeout: this.timeout },
      );
      if (!this.isAuthorized()) {
        throw new Error(MCP_CAPABILITY_NOT_AUTHORIZED_MESSAGE);
      }

      if (hasContentArray(result)) {
        const observedBytes = countAggregateContentBytes(
          result.content,
          MCP_CONTENT_BUDGET.bytes,
        );
        if (observedBytes > MCP_CONTENT_BUDGET.bytes) {
          throw new Error(
            `MCP tool result content (${observedBytes.toLocaleString('en-US')} bytes) exceeds the maximum allowed (${MCP_CONTENT_BUDGET.bytes.toLocaleString('en-US')} bytes)`,
          );
        }
      }

      return [
        {
          functionResponse: {
            name: call.name,
            response: result,
          },
        },
      ];
    } catch (error) {
      // Return error in the format expected by DiscoveredMCPTool
      return [
        {
          functionResponse: {
            name: call.name,
            response: {
              error: {
                message: error instanceof Error ? error.message : String(error),
                isError: true,
              },
            },
          },
        },
      ];
    }
  }
}
