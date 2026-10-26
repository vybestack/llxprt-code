/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  Config,
  WorkspaceTrustLifecycle,
  WorkspaceFilesystemOwner,
  assembleWorkspaceMemory,
  type MCPServerConfig,
} from '@vybestack/llxprt-code-core';
import {
  SessionSettingsOwner,
  type WorkspaceMcpSettings,
} from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  prepareAgentPreflight,
  type Agent,
  type ProviderActivationIntent,
} from '@vybestack/llxprt-code-agents';
import { createForegroundAgent } from './cliAgentBootstrap.js';
import { waitFor } from './__tests__/async.js';
import {
  __resetCleanupStateForTesting,
  registerCleanup,
  runExitCleanup,
} from './utils/cleanup.js';

const fixture = resolve(
  import.meta.dir,
  '__tests__/mcp-reload-stdio-fixture.ts',
);

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Stopping a stdio server lets it exit gracefully before escalating to
// signals, and the runtime reaps the child asynchronously, so a stopped PID
// can stay signalable briefly. Poll well past both windows.
async function waitForExit(pid: number): Promise<void> {
  await waitFor(() => expect(isAlive(pid)).toBe(false), {
    timeout: 10_000,
    interval: 100,
  });
}

function settingsFor(
  servers: Record<string, MCPServerConfig>,
): WorkspaceMcpSettings {
  return {
    mcpServers: servers,
    blockedMcpServers: [],
    settingsMcpServers: servers,
  };
}

describe('foreground /mcp reload (issue #3937)', () => {
  const directories: string[] = [];
  const configs: Config[] = [];
  const previousEnv = { ...process.env };
  // The prompt service initializes once per process from the config home, so
  // the whole suite shares one home and each test gets its own workspace.
  let configHome = '';

  beforeAll(async () => {
    configHome = await mkdtemp(join(tmpdir(), 'cli-mcp-reload-home-'));
  });

  afterEach(async () => {
    await runExitCleanup();
    __resetCleanupStateForTesting();
    for (const config of configs.splice(0)) await config.dispose();
    for (const directory of directories.splice(0))
      await rm(directory, { recursive: true, force: true });
    process.env = { ...previousEnv };
  });

  afterAll(async () => {
    await rm(configHome, { recursive: true, force: true });
  });

  interface ForegroundFixture {
    readonly directory: string;
    /** Stands in for the CLI's persisted-settings loader. */
    readonly persisted: { current: WorkspaceMcpSettings };
    readonly agent: Agent;
  }

  async function buildForegroundWithEmptyMcpConfig(): Promise<ForegroundFixture> {
    const directory = await mkdtemp(join(tmpdir(), 'cli-mcp-reload-'));
    directories.push(directory);
    process.env.LLXPRT_CONFIG_HOME = configHome;
    process.env.LLXPRT_FAKE_RESPONSES = resolve(
      import.meta.dir,
      '../../agents/src/api/__tests__/fixtures/plain-text.jsonl',
    );
    const settingsService = new SettingsService();
    const settingsOwner = new SessionSettingsOwner(settingsService);
    // Every reload re-reads whatever the "disk" currently holds.
    const persisted = { current: settingsFor({}) };
    settingsOwner.bindMcpSettings(
      settingsFor({}),
      async () => persisted.current,
    );
    const config = new Config({
      cwd: directory,
      targetDir: directory,
      debugMode: false,
      sessionId: 'mcp-reload',
      provider: 'fake',
      model: 'fake-model',
      trustedFolder: true,
      mcpServers: {},
    });
    configs.push(config);
    const credentialAuthority = new CredentialAuthority();
    const preflight = await prepareAgentPreflight(
      { runtimeId: 'mcp-reload' },
      credentialAuthority,
      settingsService,
      settingsOwner,
    );
    registerCleanup(() => preflight.dispose());
    const trust = new WorkspaceTrustLifecycle({ localTrust: true });
    const filesystem = new WorkspaceFilesystemOwner({
      targetDir: directory,
      isTrusted: () => trust.isTrustedFolder(),
    });
    const memory = assembleWorkspaceMemory(config, filesystem, trust);
    await preflight.preparePostConfiguration(
      config,
      filesystem,
      memory,
      trust,
      () => trust.dispose(),
      settingsOwner,
    );
    const intent: ProviderActivationIntent = {
      provider: 'fake',
      model: 'fake-model',
      authMode: 'auto',
    };
    const result = await preflight.preflight(intent);
    if (result.token === undefined)
      throw new Error('Missing activation receipt');
    const agent = await createForegroundAgent(
      preflight,
      result.token,
      intent,
      credentialAuthority,
      {},
    );
    return { directory, persisted, agent };
  }

  function stdioServer(
    directory: string,
    name: string,
  ): { config: MCPServerConfig; pidFile: string } {
    const pidFile = join(directory, `${name}.pid`);
    return {
      config: {
        command: process.execPath,
        args: [fixture, pidFile, `${name}_tool`],
        trust: true,
      },
      pidFile,
    };
  }

  function serverNames(agent: Agent): string[] {
    return agent.mcp
      .listServers()
      .map((server) => server.name)
      .sort();
  }

  // Tools are grouped per server; a server with no live tools has no entry.
  function toolNames(agent: Agent, server: string): string[] {
    return Object.entries(agent.mcp.toolsByServer()).flatMap(([name, tools]) =>
      name === server ? tools.map((tool) => tool.name) : [],
    );
  }

  it('connects a server added after starting with no MCP configuration', async () => {
    const { directory, persisted, agent } =
      await buildForegroundWithEmptyMcpConfig();
    expect(serverNames(agent)).toStrictEqual([]);

    const alpha = stdioServer(directory, 'alpha');
    persisted.current = settingsFor({ alpha: alpha.config });
    await agent.mcp.reload();

    expect(serverNames(agent)).toStrictEqual(['alpha']);
    await waitFor(() =>
      expect(toolNames(agent, 'alpha')).toContain('mcp__alpha__alpha_tool'),
    );
  });

  it('replaces a renamed server and stops the old process', async () => {
    const { directory, persisted, agent } =
      await buildForegroundWithEmptyMcpConfig();
    const alpha = stdioServer(directory, 'alpha');
    persisted.current = settingsFor({ alpha: alpha.config });
    await agent.mcp.reload();
    await waitFor(() => expect(existsSync(alpha.pidFile)).toBe(true));
    const alphaPid = Number(readFileSync(alpha.pidFile, 'utf8'));

    const beta = stdioServer(directory, 'beta');
    persisted.current = settingsFor({ beta: beta.config });
    await agent.mcp.reload();

    expect(serverNames(agent)).toStrictEqual(['beta']);
    await waitFor(() =>
      expect(toolNames(agent, 'beta')).toContain('mcp__beta__beta_tool'),
    );
    const renamed = agent.tools.get('mcp__beta__beta_tool');
    if (!renamed) throw new Error('Reloaded MCP tool is not registered');
    const result = await renamed.buildAndExecute(
      {},
      new AbortController().signal,
    );
    expect(result.error).toBeUndefined();
    expect(JSON.stringify(result.llmContent)).toContain('beta_tool');
    expect(agent.tools.get('mcp__alpha__alpha_tool')).toBeUndefined();
    expect(toolNames(agent, 'alpha')).toStrictEqual([]);
    await waitForExit(alphaPid);
  });

  it('disconnects every server when the configuration is emptied', async () => {
    const { directory, persisted, agent } =
      await buildForegroundWithEmptyMcpConfig();
    const alpha = stdioServer(directory, 'alpha');
    persisted.current = settingsFor({ alpha: alpha.config });
    await agent.mcp.reload();
    await waitFor(() => expect(existsSync(alpha.pidFile)).toBe(true));
    const alphaPid = Number(readFileSync(alpha.pidFile, 'utf8'));
    await waitFor(() =>
      expect(toolNames(agent, 'alpha')).toContain('mcp__alpha__alpha_tool'),
    );

    persisted.current = settingsFor({});
    await agent.mcp.reload();

    expect(serverNames(agent)).toStrictEqual([]);
    expect(toolNames(agent, 'alpha')).toStrictEqual([]);
    await waitForExit(alphaPid);
  });
});
