/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// File for 'llxprt mcp list' command
import type { CommandModule } from 'yargs';
import { loadSettings } from '../../config/settings.js';
import { exitCli } from '../utils.js';
import type { MCPServerConfig } from '@vybestack/llxprt-code-core';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';
import { createTransport, MCPServerStatus } from '@vybestack/llxprt-code-mcp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ExtensionStorage, loadExtensions } from '../../config/extension.js';
import { ExtensionEnablementManager } from '../../config/extensions/extensionEnablement.js';
import { wireMcpAuthFactories } from '../../mcpHostWiring.js';

const COLOR_GREEN = '\u001b[32m';
const COLOR_YELLOW = '\u001b[33m';
const COLOR_RED = '\u001b[31m';
const RESET_COLOR = '\u001b[0m';

async function getMcpServersFromConfig(): Promise<
  Record<string, MCPServerConfig>
> {
  const settings = loadSettings();
  const extensions = loadExtensions(
    new ExtensionEnablementManager(ExtensionStorage.getUserExtensionsDir()),
  );

  const mcpServers = { ...(settings.merged.mcpServers ?? {}) };
  for (const extension of extensions) {
    Object.entries(extension.mcpServers ?? {}).forEach(([key, server]) => {
      if (Object.prototype.hasOwnProperty.call(mcpServers, key)) {
        return;
      }
      mcpServers[key] = {
        ...server,
        extensionName: extension.name,
      };
    });
  }
  return mcpServers;
}

/** Result of probing one configured server's connection. */
interface ServerStatusResult {
  status: MCPServerStatus;
  /** Why a Disconnected probe failed; actionable prose, never a stack trace. */
  failureReason?: string;
}

function toFailureReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function testMCPConnection(
  serverName: string,
  config: MCPServerConfig,
): Promise<ServerStatusResult> {
  const client = new Client({
    name: 'mcp-test-client',
    version: '0.0.1',
  });

  let transport;
  try {
    // Use the same transport creation logic as core
    transport = await createTransport(serverName, config, false);
  } catch (error) {
    // Transport creation failed (e.g. a required auth plugin is missing);
    // keep the Disconnected status but carry the reason so the user sees it.
    await client.close();
    return {
      status: MCPServerStatus.DISCONNECTED,
      failureReason: toFailureReason(error),
    };
  }

  try {
    // Attempt actual MCP connection with short timeout
    await client.connect(transport, { timeout: 5000 }); // 5s timeout

    // Test basic MCP protocol by pinging the server
    await client.ping();

    await client.close();
    return { status: MCPServerStatus.CONNECTED };
  } catch (error) {
    // Connection or ping failed
    await transport.close();
    return {
      status: MCPServerStatus.DISCONNECTED,
      failureReason: toFailureReason(error),
    };
  }
}

async function getServerStatus(
  serverName: string,
  server: MCPServerConfig,
): Promise<ServerStatusResult> {
  // Test all server types by attempting actual connection
  return testMCPConnection(serverName, server);
}

export async function listMcpServers(): Promise<void> {
  // This command runs in its own process without the session bootstrap, so
  // it wires the plugin-contributed MCP auth factories itself before testing
  // connections (#2764). Registration is startup-only: the single
  // listMcpServers run per process registers exactly once.
  const { loadInstalledRuntimePlugins } = await import(
    '@vybestack/llxprt-code-providers/composition.js'
  );
  wireMcpAuthFactories(await loadInstalledRuntimePlugins());

  const mcpServers = await getMcpServersFromConfig();
  const serverNames = Object.keys(mcpServers);

  if (serverNames.length === 0) {
    debugLogger.log('No MCP servers configured.');
    return;
  }

  debugLogger.log('Configured MCP servers:\n');

  for (const serverName of serverNames) {
    const server = mcpServers[serverName];

    const { status, failureReason } = await getServerStatus(serverName, server);

    let statusIndicator = '';
    let statusText = '';
    switch (status) {
      case MCPServerStatus.CONNECTED:
        statusIndicator = COLOR_GREEN + '✓' + RESET_COLOR;
        statusText = 'Connected';
        break;
      case MCPServerStatus.CONNECTING:
        statusIndicator = COLOR_YELLOW + '…' + RESET_COLOR;
        statusText = 'Connecting';
        break;
      case MCPServerStatus.DISCONNECTED:
      default:
        statusIndicator = COLOR_RED + '✗' + RESET_COLOR;
        statusText = 'Disconnected';
        break;
    }

    let serverInfo = `${serverName}: `;
    if (server.httpUrl) {
      serverInfo += `${server.httpUrl} (http)`;
      // Deprecation warning when both httpUrl and url are present
      if (server.url) {
        debugLogger.warn(
          `WARNING:  Warning: Server '${serverName}' has both 'httpUrl' (deprecated) and 'url'. ` +
            `Using 'httpUrl'. Please migrate to 'url' with 'type: "http"'.`,
        );
      }
    } else if (server.url) {
      const type = server.type ?? 'http';
      serverInfo += `${server.url} (${type})`;
    } else if (server.command) {
      serverInfo += `${server.command} ${server.args?.join(' ') ?? ''} (stdio)`;
    }

    debugLogger.log(`${statusIndicator} ${serverInfo} - ${statusText}`);
    if (status === MCPServerStatus.DISCONNECTED && failureReason) {
      debugLogger.log(`  ${COLOR_YELLOW}${failureReason}${RESET_COLOR}`);
    }
  }
}

export const listCommand: CommandModule = {
  command: 'list',
  describe: 'List all configured MCP servers',
  handler: async () => {
    await listMcpServers();
    await exitCli();
  },
};
