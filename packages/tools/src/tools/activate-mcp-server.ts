/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ToolResult, ToolInvocation } from './tools.js';
import { BaseDeclarativeTool, BaseToolInvocation, Kind } from './tools.js';
import type { IToolMessageBus } from '../interfaces/IToolMessageBus.js';
import { ACTIVATE_MCP_SERVER_TOOL_NAME } from '../types/tool-names.js';
import { ToolErrorType } from '../types/tool-error.js';
import type { ToolRegistry } from './tool-registry.js';

const MAX_TOOL_NAMES_PER_SERVER = 12;

export interface ActivateMcpServerToolParams {
  name: string;
}

type RefreshMcpContextCallback = () => Promise<void>;

function buildDescription(
  deferredServers: readonly string[],
  toolsByServer: ReadonlyMap<string, readonly string[]>,
): string {
  if (deferredServers.length === 0) {
    return (
      'Activates a deferred MCP server so its tools become available to you. ' +
      'No servers are currently deferred.'
    );
  }

  const lines: string[] = [
    'Activates a deferred MCP server so its full tool schemas become available to you.',
    'Deferred servers (call this tool with the server name to activate):',
  ];

  for (const server of deferredServers) {
    const toolNames = toolsByServer.get(server) ?? [];
    const shown = toolNames.slice(0, MAX_TOOL_NAMES_PER_SERVER);
    const omitted = toolNames.length - shown.length;
    const namesPart =
      shown.length > 0 ? shown.join(', ') : '(no tools discovered)';
    const omittedPart = omitted > 0 ? ` (+${omitted} more)` : '';
    lines.push(
      `- ${server}: ${toolNames.length} tool(s) [${namesPart}${omittedPart}]`,
    );
  }

  lines.push(
    "Activation persists for the current session. After activation the server's tool schemas are published on the next model request.",
  );
  return lines.join('\n');
}

class ActivateMcpServerToolInvocation extends BaseToolInvocation<
  ActivateMcpServerToolParams,
  ToolResult
> {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly refreshMcpContext: RefreshMcpContextCallback,
    params: ActivateMcpServerToolParams,
    messageBus: IToolMessageBus,
  ) {
    super(params, messageBus);
  }

  getDescription(): string {
    return `activate MCP server "${this.params.name}"`;
  }

  async execute(_signal: AbortSignal): Promise<ToolResult> {
    const serverName = this.params.name;

    try {
      this.registry.activateMcpServer(serverName);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return {
        llmContent: `Error: ${message}`,
        returnDisplay: `Error: ${message}`,
        error: {
          message,
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }

    await this.refreshMcpContext();

    return {
      llmContent: `MCP server "${serverName}" is now activated and available. Its tool schemas have been published.`,
      returnDisplay: `MCP server **${serverName}** activated.`,
    };
  }
}

export class ActivateMcpServerTool extends BaseDeclarativeTool<
  ActivateMcpServerToolParams,
  ToolResult
> {
  static readonly Name = ACTIVATE_MCP_SERVER_TOOL_NAME;

  private readonly refreshMcpContext: RefreshMcpContextCallback;

  constructor(
    private readonly registry: ToolRegistry,
    messageBus: IToolMessageBus,
    refreshMcpContext: RefreshMcpContextCallback,
  ) {
    const deferredServers = registry.listDeferredMcpServers();
    const firstServer = deferredServers.shift();
    if (firstServer === undefined) {
      throw new Error(
        'ActivateMcpServerTool requires at least one deferred MCP server.',
      );
    }
    const availableServers = [firstServer, ...deferredServers];

    const toolsByServer = new Map<string, string[]>();
    for (const server of availableServers) {
      toolsByServer.set(
        server,
        registry.getToolsByServer(server).map((t) => t.name),
      );
    }

    const description = buildDescription(availableServers, toolsByServer);
    const schema = z.object({
      name: z
        .enum([firstServer, ...deferredServers])
        .describe('The name of the deferred MCP server to activate.'),
    });

    super(
      ActivateMcpServerTool.Name,
      'Activate MCP Server',
      description,
      Kind.Other,
      zodToJsonSchema(schema),
      true,
      false,
      messageBus,
    );

    this.refreshMcpContext = refreshMcpContext;
  }

  protected createInvocation(
    params: ActivateMcpServerToolParams,
    messageBus: IToolMessageBus,
  ): ToolInvocation<ActivateMcpServerToolParams, ToolResult> {
    return new ActivateMcpServerToolInvocation(
      this.registry,
      this.refreshMcpContext,
      params,
      messageBus,
    );
  }
}
