/**
 * @plan:PLAN-20250212-LSP.P26
 * @requirement:REQ-ARCH-010
 * @requirement:REQ-ARCH-040
 * @requirement:REQ-LIFE-040
 * @requirement:REQ-LIFE-060
 * @requirement:REQ-CFG-070
 * @pseudocode main-entry.md lines 05-102
 */

import { createReadStream, createWriteStream } from 'node:fs';
import { stderr } from 'node:process';

import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from 'vscode-jsonrpc/node.js';

import { createMcpChannel } from './channels/mcp-channel.js';
import { setupRpcChannel } from './channels/rpc-channel.js';
import { createOrchestrator } from './service/orchestrator.js';
import {
  getBuiltinServers,
  mergeUserConfig,
} from './service/server-registry.js';

type LspServerConfig = {
  id: string;
  command: string;
  args?: string[];
  extensions?: string[];
};

type LspBootstrapConfig = {
  servers?: LspServerConfig[];
  diagnosticsTimeoutMs?: number;
  navigationTimeoutMs?: number;
  navigationTools?: boolean;
};

type LspBootstrap = {
  workspaceRoot: string;
  config: LspBootstrapConfig;
};

const defaultBootstrapConfig: LspBootstrapConfig = {};

const fatal = (message: string): never => {
  stderr.write(`${message}\n`);
  process.exit(1);
  throw new Error(message);
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const ensureStringArray = (
  value: unknown,
  fieldName: string,
): string[] | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    fatal(`${fieldName} must be an array of strings`);
  }
  return value as string[];
};

const validateServers = (
  serversInput: unknown,
): LspServerConfig[] | undefined => {
  if (serversInput === undefined) {
    return undefined;
  }

  if (!Array.isArray(serversInput)) {
    fatal('LSP_BOOTSTRAP.config.servers must be an array');
  }

  const servers = serversInput as unknown[];
  return servers.map((serverInput, index) => {
    if (!isObject(serverInput)) {
      fatal(`LSP_BOOTSTRAP.config.servers[${index}] must be an object`);
    }

    const serverRecord = serverInput as Record<string, unknown>;
    const id = serverRecord.id;
    const command = serverRecord.command;

    if (typeof id !== 'string' || id.length === 0) {
      fatal(
        `LSP_BOOTSTRAP.config.servers[${index}].id must be a non-empty string`,
      );
    }

    if (typeof command !== 'string' || command.length === 0) {
      fatal(
        `LSP_BOOTSTRAP.config.servers[${index}].command must be a non-empty string`,
      );
    }

    const validatedId = id as string;
    const validatedCommand = command as string;

    const args = ensureStringArray(
      serverRecord.args,
      `LSP_BOOTSTRAP.config.servers[${index}].args`,
    );
    const extensions = ensureStringArray(
      serverRecord.extensions,
      `LSP_BOOTSTRAP.config.servers[${index}].extensions`,
    );

    return {
      id: validatedId,
      command: validatedCommand,
      ...(args ? { args } : {}),
      ...(extensions ? { extensions } : {}),
    };
  });
};

const validateConfig = (configInput: unknown): LspBootstrapConfig => {
  if (configInput === undefined) {
    return { ...defaultBootstrapConfig };
  }

  if (!isObject(configInput)) {
    fatal('LSP_BOOTSTRAP.config must be an object');
  }

  const configRecord = configInput as Record<string, unknown>;

  const diagnosticsTimeoutMs = configRecord.diagnosticsTimeoutMs;
  if (
    diagnosticsTimeoutMs !== undefined &&
    typeof diagnosticsTimeoutMs !== 'number'
  ) {
    fatal('LSP_BOOTSTRAP.config.diagnosticsTimeoutMs must be a number');
  }

  const navigationTimeoutMs = configRecord.navigationTimeoutMs;
  if (
    navigationTimeoutMs !== undefined &&
    typeof navigationTimeoutMs !== 'number'
  ) {
    fatal('LSP_BOOTSTRAP.config.navigationTimeoutMs must be a number');
  }

  const navigationTools = configRecord.navigationTools;
  if (navigationTools !== undefined && typeof navigationTools !== 'boolean') {
    fatal('LSP_BOOTSTRAP.config.navigationTools must be a boolean');
  }

  const servers = validateServers(configRecord.servers);

  return {
    ...(typeof diagnosticsTimeoutMs === 'number'
      ? { diagnosticsTimeoutMs }
      : {}),
    ...(typeof navigationTimeoutMs === 'number' ? { navigationTimeoutMs } : {}),
    ...(typeof navigationTools === 'boolean' ? { navigationTools } : {}),
    ...(servers ? { servers } : {}),
  };
};

export const parseBootstrapFromEnv = (): LspBootstrap => {
  const raw = process.env.LSP_BOOTSTRAP;
  if (typeof raw !== 'string' || raw.length === 0) {
    fatal('LSP_BOOTSTRAP environment variable is required');
  }

  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(raw as string);
  } catch {
    fatal('LSP_BOOTSTRAP must be valid JSON');
  }

  if (!isObject(parsedUnknown)) {
    fatal('LSP_BOOTSTRAP must be a JSON object');
  }

  const parsed = parsedUnknown as Record<string, unknown>;
  const workspaceRootValue = parsed.workspaceRoot;
  if (
    typeof workspaceRootValue !== 'string' ||
    workspaceRootValue.length === 0
  ) {
    fatal('LSP_BOOTSTRAP.workspaceRoot must be a non-empty string');
  }

  const workspaceRoot = workspaceRootValue as string;
  return {
    workspaceRoot,
    config: validateConfig(parsed.config),
  };
};

const createRpcConnection = (): MessageConnection =>
  createMessageConnection(
    new StreamMessageReader(process.stdin),
    new StreamMessageWriter(process.stdout),
  );

function createReadStreamFromFd(fd: number) {
  return createReadStream('', { fd, autoClose: false });
}

function createWriteStreamFromFd(fd: number) {
  return createWriteStream('', { fd, autoClose: false });
}

export async function main(): Promise<void> {
  const bootstrap = parseBootstrapFromEnv();
  const mergedServers = mergeUserConfig(
    getBuiltinServers(),
    bootstrap.config.servers as any,
  ).map((s) => ({
    id: s.id,
    command: s.command,
    args: s.args ? [...s.args] : undefined,
    extensions: [...s.extensions],
  }));
  const orchestrator = createOrchestrator(
    { ...bootstrap.config, servers: mergedServers },
    bootstrap.workspaceRoot,
  );

  const rpcConnection = createRpcConnection();
  setupRpcChannel(rpcConnection, orchestrator);
  rpcConnection.listen();

  let mcpServer: { close: () => Promise<void> } | null = null;
  if (bootstrap.config.navigationTools !== false) {
    try {
      const mcpInput = createReadStreamFromFd(3);
      const mcpOutput = createWriteStreamFromFd(4);
      mcpServer = await createMcpChannel(
        orchestrator,
        bootstrap.workspaceRoot,
        mcpInput,
        mcpOutput,
      );
    } catch (error) {
      stderr.write(`MCP channel disabled: ${String(error)}\n`);
    }
  }

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    await orchestrator.shutdown();
    if (mcpServer) {
      await mcpServer.close();
    }
    rpcConnection.dispose();
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown();
  });

  process.on('SIGINT', () => {
    void shutdown();
  });

  process.on('uncaughtException', (error) => {
    stderr.write(`Uncaught exception in LSP service: ${String(error)}\n`);
    void shutdown();
  });

  process.on('unhandledRejection', (error) => {
    stderr.write(`Unhandled rejection in LSP service: ${String(error)}\n`);
  });

  rpcConnection.sendNotification('lsp/ready');
}

const isMainModule = (): boolean => {
  const argvEntry = process.argv[1];
  if (!argvEntry || !import.meta.url.startsWith('file://')) {
    return false;
  }

  try {
    return import.meta.url === new URL(argvEntry, 'file://').href;
  } catch {
    return false;
  }
};

if (isMainModule()) {
  void main().catch((error) => {
    stderr.write(`Fatal error in LSP service: ${String(error)}\n`);
    process.exit(1);
  });
}
