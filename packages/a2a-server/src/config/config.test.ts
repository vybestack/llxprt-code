/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
// The legacy loadConfig / createCoderConfig entry points were deleted in #3221:
// the A2A host builds Agents via createTaskAgent (covered by
// config.createTaskAgent.test.ts). This file pins the surviving pure config
// helpers against real inputs.
import { setTargetDir, mergeMcpServers } from './config.js';
import type { AgentSettings } from '../types.js';
import type {
  LlxprtExtension,
  MCPServerConfig,
} from '@vybestack/llxprt-code-core';

describe('setTargetDir', () => {
  const prevWorkspaceEnv = process.env['CODER_AGENT_WORKSPACE_PATH'];
  const suiteCwd = process.cwd();
  afterEach(() => {
    if (prevWorkspaceEnv === undefined) {
      delete process.env['CODER_AGENT_WORKSPACE_PATH'];
    } else {
      process.env['CODER_AGENT_WORKSPACE_PATH'] = prevWorkspaceEnv;
    }
    process.chdir(suiteCwd);
  });

  it('resolves the agentSettings workspacePath to an absolute path', () => {
    delete process.env['CODER_AGENT_WORKSPACE_PATH'];
    const workspace = mkdtempSync(join(tmpdir(), 'set-target-dir-'));
    const agentSettings = {
      kind: 'agent-settings' as const,
      workspacePath: workspace,
    } as AgentSettings;
    try {
      expect(setTargetDir(agentSettings)).toBe(workspace);
    } finally {
      // setTargetDir chdir'd into the workspace; leave it before removing
      // the directory (rmSync of the CWD fails on Windows).
      process.chdir(suiteCwd);
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('falls back to the current working directory when agentSettings is undefined', () => {
    delete process.env['CODER_AGENT_WORKSPACE_PATH'];
    expect(setTargetDir(undefined)).toBe(process.cwd());
  });

  it('prefers CODER_AGENT_WORKSPACE_PATH over the agentSettings workspacePath', () => {
    const envWorkspace = mkdtempSync(join(tmpdir(), 'set-target-env-'));
    const settingsWorkspace = mkdtempSync(join(tmpdir(), 'set-target-lost-'));
    process.env['CODER_AGENT_WORKSPACE_PATH'] = envWorkspace;
    const agentSettings = {
      kind: 'agent-settings' as const,
      workspacePath: settingsWorkspace,
    } as AgentSettings;
    try {
      expect(setTargetDir(agentSettings)).toBe(envWorkspace);
    } finally {
      delete process.env['CODER_AGENT_WORKSPACE_PATH'];
      process.chdir(suiteCwd);
      rmSync(envWorkspace, { recursive: true, force: true });
      rmSync(settingsWorkspace, { recursive: true, force: true });
    }
  });

  it('resolves a relative agentSettings workspacePath against the current directory', () => {
    delete process.env['CODER_AGENT_WORKSPACE_PATH'];
    const workspace = mkdtempSync(join(tmpdir(), 'set-target-rel-'));
    const agentSettings = {
      kind: 'agent-settings' as const,
      workspacePath: basename(workspace),
    } as AgentSettings;
    try {
      process.chdir(tmpdir());
      // process.chdir realpaths the cwd (macOS /var -> /private/var), and
      // setTargetDir resolves the relative path against it; compare against
      // the workspace's realpath.
      expect(setTargetDir(agentSettings)).toBe(realpathSync(workspace));
    } finally {
      process.chdir(suiteCwd);
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

describe('mergeMcpServers', () => {
  it('merges settings and extension MCP servers; settings win on key collision', () => {
    const settingsServer: MCPServerConfig = {
      command: 'node',
      args: ['settings-server.js'],
    };
    const collidingServer: MCPServerConfig = {
      command: 'node',
      args: ['extension-loses.js'],
    };
    const extensionServer: MCPServerConfig = {
      command: 'node',
      args: ['ext-server.js'],
    };
    const extension: LlxprtExtension = {
      name: 'ext',
      version: '1.0.0',
      isActive: true,
      path: '/ext',
      contextFiles: [],
      mcpServers: {
        'ext-server': extensionServer,
        'settings-server': collidingServer,
      },
    };
    const merged = mergeMcpServers(
      { mcpServers: { 'settings-server': settingsServer } },
      [extension],
    );
    expect(merged['settings-server']).toBeDefined();
    expect(merged['ext-server']).toBeDefined();
    // The precedence invariant: a same-key extension server is skipped in
    // favor of the settings-declared one.
    expect(merged['settings-server']).toBe(settingsServer);
    expect(merged['settings-server'].args).toStrictEqual([
      'settings-server.js',
    ]);
  });

  it('returns an empty map when neither settings nor extensions declare MCP servers', () => {
    const merged = mergeMcpServers({}, []);
    expect(merged).toStrictEqual({});
  });
});
