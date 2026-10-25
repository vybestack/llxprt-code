/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import type { AgentConfig } from '../../config-types.js';
import type { RecordedMcpEffect } from './gated-recording-mcp.js';

const serverScript = fileURLToPath(
  new URL('./gated-echo-mcp-server.ts', import.meta.url),
);

const ENTERED_TIMEOUT_MS = 30_000;

export interface GatedEchoMcpOptions {
  /** Name of the tool the server publishes. */
  readonly toolName: string;
  /** Key of the server in `mcpServers`. Defaults to `echo`. */
  readonly serverName?: string;
  /** A call's result text is `<outputPrefix>:<arguments.invocation>`. */
  readonly outputPrefix: string;
  /** The server's `trust` setting. Defaults to false (calls ask for confirmation). */
  readonly trust?: boolean;
}

/**
 * A stdio MCP server that publishes one tool, records the call's arguments in
 * an effects file, holds the call until `release()`, and answers with
 * `<outputPrefix>:<arguments.invocation>`, so each caller's result can be told
 * apart. Pass `mcpServers` to the agent through its production input.
 */
export interface GatedEchoMcp {
  readonly serverName: string;
  readonly toolName: string;
  readonly mcpServers: NonNullable<AgentConfig['mcpServers']>;
  /** The `invocation` argument of every call the server received, in order. */
  readonly calls: () => Promise<readonly string[]>;
  /** Resolves once the server has recorded `count` calls (default 1). */
  readonly entered: (count?: number) => Promise<void>;
  /** Lets every held and later call return. */
  readonly release: () => Promise<void>;
  /** Removes the temporary directory. */
  readonly close: () => Promise<void>;
}

export async function createGatedEchoMcp(
  options: GatedEchoMcpOptions,
): Promise<GatedEchoMcp> {
  const serverName = options.serverName ?? 'echo';
  const directory = await mkdtemp(join(tmpdir(), 'gated-echo-mcp-'));
  const effectsFile = join(directory, 'effects.jsonl');
  const releaseFile = join(directory, 'release');
  await writeFile(effectsFile, '');
  const effects = async (): Promise<readonly RecordedMcpEffect[]> =>
    (await readFile(effectsFile, 'utf8'))
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as RecordedMcpEffect);
  const enteredCalls = async (): Promise<
    ReadonlyArray<Record<string, unknown>>
  > =>
    (await effects()).flatMap((effect) =>
      effect.event === 'entered' ? [effect.arguments] : [],
    );
  return {
    serverName,
    toolName: options.toolName,
    mcpServers: {
      [serverName]: {
        command: process.execPath,
        args: [
          serverScript,
          effectsFile,
          options.toolName,
          options.outputPrefix,
          releaseFile,
        ],
        trust: options.trust ?? false,
      },
    },
    calls: async () =>
      (await enteredCalls()).map((call) => String(call.invocation)),
    entered: async (count = 1) => {
      const deadline = Date.now() + ENTERED_TIMEOUT_MS;
      while ((await enteredCalls()).length < count) {
        if (Date.now() > deadline)
          throw new Error(`MCP tool was not entered ${count} time(s)`);
        await sleep(10);
      }
    },
    release: () => writeFile(releaseFile, ''),
    close: () => rm(directory, { recursive: true, force: true }),
  };
}
