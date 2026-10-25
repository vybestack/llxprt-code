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
import { z } from 'zod';
import type { Agent, AgentToolHandle } from '../../agent.js';
import type { AgentConfig } from '../../config-types.js';

const serverScript = fileURLToPath(
  new URL('./gated-recording-mcp-server.ts', import.meta.url),
);

const effectLine = z.discriminatedUnion('event', [
  z.object({
    event: z.literal('entered'),
    arguments: z.record(z.unknown()),
  }),
  z.object({ event: z.literal('finished') }),
  z.object({ event: z.literal('discovery-entered') }),
]);

export type RecordedMcpEffect = z.infer<typeof effectLine>;

export interface GatedRecordingMcpOptions {
  /** Name of the tool the server publishes (for example `external_record`). */
  readonly toolName: string;
  /** Key of the server in `mcpServers`. Defaults to `recording`. */
  readonly serverName?: string;
  /** When true, a call returns only after `release()`. Defaults to false. */
  readonly gated?: boolean;
  /** The server's `trust` setting. Defaults to true (no confirmation). */
  readonly trust?: boolean;
  /**
   * When true, the server's `tools/list` response is held until
   * `releaseDiscovery()`. Defaults to false (discovery answers at once).
   */
  readonly gateDiscovery?: boolean;
}

/**
 * A stdio MCP server that publishes one tool, appends an `entered` line (with
 * the call's arguments) to an effects file when the tool is called, and, when
 * gated, returns only after the test creates the release file. Pass
 * `mcpServers` to the agent through its production input.
 */
export interface GatedRecordingMcp {
  readonly serverName: string;
  readonly toolName: string;
  readonly mcpServers: NonNullable<AgentConfig['mcpServers']>;
  /** Every `entered` and `finished` line the server has written, in order. */
  readonly effects: () => Promise<readonly RecordedMcpEffect[]>;
  /** The agent's handle for this server's tool, once MCP discovery is ready. */
  readonly tool: (agent: Agent) => Promise<AgentToolHandle>;
  /** Resolves once the server has recorded `count` calls (default 1). */
  readonly entered: (count?: number) => Promise<void>;
  /** Lets every held and later call return. */
  readonly release: () => Promise<void>;
  /**
   * Resolves once the server has received `count` held `tools/list` requests
   * (default 1). Requires `gateDiscovery: true`.
   */
  readonly discoveryEntered: (count?: number) => Promise<void>;
  /** Lets every held and later `tools/list` request answer. Requires `gateDiscovery: true`. */
  readonly releaseDiscovery: () => Promise<void>;
  /** Removes the temporary directory. */
  readonly close: () => Promise<void>;
}

const ENTERED_TIMEOUT_MS = 30_000;
const DISCOVERY_TIMEOUT_MS = 30_000;

function discoveryReady(agent: Agent): Promise<void> {
  if (agent.mcp.discoveryState() === 'ready') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('MCP discovery did not become ready'));
    }, DISCOVERY_TIMEOUT_MS);
    const unsubscribe = agent.mcp.subscribeStatus(() => {
      if (agent.mcp.discoveryState() !== 'ready') return;
      clearTimeout(timer);
      unsubscribe();
      resolve();
    });
  });
}

export async function createGatedRecordingMcp(
  options: GatedRecordingMcpOptions,
): Promise<GatedRecordingMcp> {
  const serverName = options.serverName ?? 'recording';
  const directory = await mkdtemp(join(tmpdir(), 'gated-recording-mcp-'));
  const effectsFile = join(directory, 'effects.jsonl');
  const releaseFile = join(directory, 'release');
  const discoveryReleaseFile = join(directory, 'discovery-release');
  const gateDiscovery = options.gateDiscovery === true;
  await writeFile(effectsFile, '');
  const effects = async (): Promise<readonly RecordedMcpEffect[]> =>
    (await readFile(effectsFile, 'utf8'))
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => effectLine.parse(JSON.parse(line)));
  const waitForEffects = async (
    event: RecordedMcpEffect['event'],
    count: number,
    what: string,
  ): Promise<void> => {
    const deadline = Date.now() + ENTERED_TIMEOUT_MS;
    while (
      (await effects()).filter((effect) => effect.event === event).length <
      count
    ) {
      if (Date.now() > deadline)
        throw new Error(`${what} was not entered ${count} time(s)`);
      await sleep(10);
    }
  };
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
          ...(options.gated === true ? [releaseFile] : []),
          ...(gateDiscovery
            ? [`--discovery-release=${discoveryReleaseFile}`]
            : []),
        ],
        trust: options.trust ?? true,
      },
    },
    effects,
    tool: async (agent) => {
      await discoveryReady(agent);
      const info = agent.tools
        .list()
        .find(
          (entry) =>
            entry.server === serverName &&
            entry.serverToolName === options.toolName,
        );
      const handle = info && agent.tools.get(info.name);
      if (!handle)
        throw new Error(`MCP tool ${options.toolName} was not discovered`);
      return handle;
    },
    entered: (count = 1) => waitForEffects('entered', count, 'MCP tool'),
    discoveryEntered: (count = 1) => {
      if (!gateDiscovery)
        throw new Error('discoveryEntered requires gateDiscovery: true');
      return waitForEffects('discovery-entered', count, 'MCP discovery');
    },
    release: () => writeFile(releaseFile, ''),
    releaseDiscovery: () => {
      if (!gateDiscovery)
        throw new Error('releaseDiscovery requires gateDiscovery: true');
      return writeFile(discoveryReleaseFile, '');
    },
    close: () => rm(directory, { recursive: true, force: true }),
  };
}
