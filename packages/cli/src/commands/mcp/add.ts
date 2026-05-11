/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// File for 'llxprt mcp add' command
import type { ArgumentsCamelCase, CommandModule } from 'yargs';
import { loadSettings, SettingScope } from '../../config/settings.js';
import type { Settings } from '../../config/settings.js';
import type { MCPServerConfig } from '@vybestack/llxprt-code-core';
import { debugLogger } from '@vybestack/llxprt-code-core';
import { exitCli } from '../utils.js';

type AddCommandArgs = {
  name: string;
  commandOrUrl: string;
  args?: Array<string | number>;
  scope: string;
  transport: string;
  env?: string[];
  header?: string[];
  timeout?: number;
  trust?: boolean;
  description?: string;
  includeTools?: string[];
  excludeTools?: string[];
  '--'?: string[];
};

type AddMcpOptions = {
  scope: string;
  transport: string;
  env: string[] | undefined;
  header: string[] | undefined;
  timeout?: number;
  trust?: boolean;
  description?: string;
  includeTools?: string[];
  excludeTools?: string[];
};

type SharedServerOptions = Pick<
  AddMcpOptions,
  'timeout' | 'trust' | 'description' | 'includeTools' | 'excludeTools'
>;

function parseHeaderEntries(
  entries: string[] | undefined,
): Record<string, string> | undefined {
  return entries?.reduce(
    (acc, curr) => {
      const [key, ...valueParts] = curr.split(':');
      const value = valueParts.join(':').trim();
      if (key.trim() && value) {
        acc[key.trim()] = value;
      }
      return acc;
    },
    {} as Record<string, string>,
  );
}

function parseEnvEntries(
  entries: string[] | undefined,
): Record<string, string> | undefined {
  return entries?.reduce(
    (acc, curr) => {
      const [key, value] = curr.split('=');
      if (key && value) {
        acc[key] = value;
      }
      return acc;
    },
    {} as Record<string, string>,
  );
}

function createHttpServerConfig(
  commandOrUrl: string,
  type: 'sse' | 'http',
  headers: Record<string, string> | undefined,
  options: SharedServerOptions,
): Partial<MCPServerConfig> {
  return {
    url: commandOrUrl,
    type,
    headers,
    ...options,
  };
}

function createStdioServerConfig(
  commandOrUrl: string,
  args: Array<string | number> | undefined,
  env: string[] | undefined,
  options: SharedServerOptions,
): Partial<MCPServerConfig> {
  return {
    command: commandOrUrl,
    args: args?.map(String),
    env: parseEnvEntries(env),
    ...options,
  };
}

function createServerConfig(
  commandOrUrl: string,
  args: Array<string | number> | undefined,
  options: AddMcpOptions,
): Partial<MCPServerConfig> {
  const sharedOptions = {
    timeout: options.timeout,
    trust: options.trust,
    description: options.description,
    includeTools: options.includeTools,
    excludeTools: options.excludeTools,
  };
  const headers = parseHeaderEntries(options.header);
  if (options.transport === 'sse' || options.transport === 'http') {
    return createHttpServerConfig(
      commandOrUrl,
      options.transport,
      headers,
      sharedOptions,
    );
  }
  return createStdioServerConfig(
    commandOrUrl,
    args,
    options.env,
    sharedOptions,
  );
}

async function validateProjectScope(scope: string, inHome: boolean) {
  if (scope === 'project' && inHome) {
    debugLogger.error(
      'Error: Please use --scope user to edit settings in the home directory.',
    );
    await exitCli(1);
  }
}

function logServerMutation(
  name: string,
  scope: string,
  transport: string,
  exists: boolean,
) {
  if (exists) {
    debugLogger.log(
      `MCP server "${name}" is already configured within ${scope} settings.`,
    );
    debugLogger.log(`MCP server "${name}" updated in ${scope} settings.`);
    return;
  }
  debugLogger.log(
    `MCP server "${name}" added to ${scope} settings. (${transport})`,
  );
}

async function addMcpServer(
  name: string,
  commandOrUrl: string,
  args: Array<string | number> | undefined,
  options: AddMcpOptions,
) {
  const settings = loadSettings(process.cwd());
  const inHome = settings.workspace.path === settings.user.path;
  await validateProjectScope(options.scope, inHome);

  const settingsScope =
    options.scope === 'user' ? SettingScope.User : SettingScope.Workspace;
  const newServer = createServerConfig(commandOrUrl, args, options);

  const existingSettings = settings.forScope(settingsScope).settings;
  const mcpServers: Settings['mcpServers'] = existingSettings.mcpServers ?? {};

  const isExistingServer = Object.prototype.hasOwnProperty.call(
    mcpServers,
    name,
  );
  mcpServers[name] = newServer as MCPServerConfig;

  settings.setValue(settingsScope, 'mcpServers', mcpServers);
  logServerMutation(name, options.scope, options.transport, isExistingServer);
}

export const addCommand: CommandModule = {
  command: 'add <name> <commandOrUrl> [args...]',
  describe: 'Add a server',
  builder: (yargs) =>
    yargs
      .usage('Usage: llxprt mcp add [options] <name> <commandOrUrl> [args...]')
      .parserConfiguration({
        'unknown-options-as-args': true, // Pass unknown options as server args
        'populate--': true, // Populate server args after -- separator
      })
      .positional('name', {
        describe: 'Name of the server',
        type: 'string',
        demandOption: true,
      })
      .positional('commandOrUrl', {
        describe: 'Command (stdio) or URL (sse, http)',
        type: 'string',
        demandOption: true,
      })
      .option('scope', {
        alias: 's',
        describe: 'Configuration scope (user or project)',
        type: 'string',
        default: 'project',
        choices: ['user', 'project'],
      })
      .option('transport', {
        alias: ['t', 'type'],
        describe: 'Transport type (stdio, sse, http)',
        type: 'string',
        default: 'stdio',
        choices: ['stdio', 'sse', 'http'],
      })
      .option('env', {
        alias: 'e',
        describe: 'Set environment variables (e.g. -e KEY=value)',
        type: 'array',
        string: true,
      })
      .option('header', {
        alias: 'H',
        describe:
          'Set HTTP headers for SSE and HTTP transports (e.g. -H "X-Api-Key: abc123" -H "Authorization: Bearer abc123")',
        type: 'array',
        string: true,
      })
      .option('timeout', {
        describe: 'Set connection timeout in milliseconds',
        type: 'number',
      })
      .option('trust', {
        describe:
          'Trust the server (bypass all tool call confirmation prompts)',
        type: 'boolean',
      })
      .option('description', {
        describe: 'Set the description for the server',
        type: 'string',
      })
      .option('include-tools', {
        describe: 'A comma-separated list of tools to include',
        type: 'array',
        string: true,
      })
      .option('exclude-tools', {
        describe: 'A comma-separated list of tools to exclude',
        type: 'array',
        string: true,
      })
      .middleware((argv: ArgumentsCamelCase<AddCommandArgs>) => {
        // Handle -- separator args as server args if present
        const separatorArgs = argv['--'];
        if (separatorArgs !== undefined) {
          const existingArgs = argv.args ?? [];
          argv.args = [...existingArgs, ...separatorArgs];
        }
      }),
  handler: async (argv) => {
    await addMcpServer(
      argv.name as string,
      argv.commandOrUrl as string,
      argv.args as Array<string | number>,
      {
        scope: argv.scope as string,
        transport: argv.transport as string,
        env: argv.env as string[],
        header: argv.header as string[],
        timeout: argv.timeout as number | undefined,
        trust: argv.trust as boolean | undefined,
        description: argv.description as string | undefined,
        includeTools: argv.includeTools as string[] | undefined,
        excludeTools: argv.excludeTools as string[] | undefined,
      },
    );
    await exitCli();
  },
};
