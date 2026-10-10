/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';

import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';

import { installZedFilesystemFixture } from './__tests__/zed-filesystem-fixture.js';
const fixtureFilesystem = installZedFilesystemFixture();

import { describe, expect, it } from 'bun:test';
import type * as acp from '@agentclientprotocol/sdk';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApprovalMode, DebugLogger } from '@vybestack/llxprt-code-core';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  fromConfig,
  toConfigParameters,
  type Agent,
} from '@vybestack/llxprt-code-agents';
import {
  deadline,
  shellOwnerGate,
  shellQuote,
} from '../../agents/src/api/__tests__/helpers/shell-owner-gate.js';
import { RecordingConnection } from './__tests__/zed-test-helpers.js';
import { ShellTool } from '@vybestack/llxprt-code-tools';
import { buildZedTerminalSetup } from './zed-terminal-setup.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('public ACP Agent shell dual mode (#2616)', () => {
  it.skipIf(process.platform === 'win32')(
    'uses TerminalManager for foreground and the same Agent owner for a real background process',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'acp-agent-shell-'));
      const gate = await shellOwnerGate();
      const config = new Config({
        ...toConfigParameters({
          provider: 'openai',
          model: 'acp-shell-model',
          workingDir: root,
          approvalMode: ApprovalMode.YOLO,
          folderTrust: true,
          interactive: false,
          coreTools: ['run_shell_command', 'check_async_tasks'],
          telemetry: { enabled: false },
          recording: { enabled: false },
        }),
        sessionId: 'acp-shell-session',
      });
      const settingsService = new SettingsService();
      const settingsOwner = new SessionSettingsOwner(settingsService);
      const connection = new RecordingConnection();
      connection.setTerminalOutput('terminal route\n');
      let setup: ReturnType<typeof buildZedTerminalSetup> | undefined;
      let agent: Agent | undefined;
      const trust = new WorkspaceTrustLifecycle({
        localTrust: config.initialWorkspaceTrust,
      });
      try {
        agent = await fromConfig({
          settingsService,
          trustPort: trust,
          config,
          prepareSessionTools: (sessionConfig, messageBus, tools) => {
            setup = buildZedTerminalSetup(
              'acp-shell-session',
              sessionConfig,
              tools,
              connection as unknown as acp.AgentSideConnection,
              new DebugLogger('llxprt:acp-shell-owner-test'),
              messageBus,
              fixtureFilesystem().paths,
              settingsOwner,
              trust,
            );
            const shell = setup.registry.getTool(ShellTool.Name);
            if (shell) tools.registerTool(shell);
          },
          activation: {
            provider: 'openai',
            model: 'acp-shell-model',
            cliOverrides: {
              key: 'local-test-key',
              baseUrl: 'http://127.0.0.1:1/v1',
            },
          },
        });
        const shell = agent.tools.get('run_shell_command');
        if (!shell) throw new Error('ACP Agent has no shell tool');
        const foreground = await deadline(
          shell.buildAndExecute(
            { command: 'echo terminal route' },
            new AbortController().signal,
          ),
          'ACP foreground terminal execution',
        );
        expect(JSON.stringify(foreground.llmContent)).toContain(
          'terminal route',
        );
        expect(connection.createTerminalCalls).toHaveLength(1);
        const marker = join(root, 'background.marker');
        const command = [
          'exec',
          shellQuote(process.execPath),
          shellQuote(
            resolve(
              REPO_ROOT,
              'packages/agents/src/api/__tests__/helpers/shell-owner-workload.ts',
            ),
          ),
          shellQuote(`${gate.url}/acp`),
          shellQuote(marker),
        ].join(' ');
        await deadline(
          shell.buildAndExecute(
            { command, is_background: true },
            new AbortController().signal,
          ),
          'ACP background shell launch',
        );
        await gate.entered('acp');
        const job = agent.tasks
          .list()
          .find(
            (candidate) =>
              candidate.kind === 'shell' && candidate.command === command,
          );
        if (!job) throw new Error('ACP background job absent from Agent');
        expect(job.status).toBe('running');
        expect(
          connection.createTerminalCalls.map((call) => call.args?.join(' ')),
        ).toStrictEqual([expect.stringContaining('echo terminal route')]);
        await deadline(agent.dispose(), 'ACP background owner disposal');
        expect(agent.tasks.get(job.id)).toBeUndefined();
        expect(existsSync(marker)).toBe(false);
      } finally {
        const cleanup = await Promise.allSettled([
          agent?.dispose(),
          config.dispose(),
          setup?.terminals.settleAll(),
        ]);
        await settingsOwner.dispose();
        await gate.stop();
        await rm(root, { recursive: true, force: true });
        expect(
          cleanup.filter((result) => result.status === 'rejected'),
        ).toStrictEqual([]);
      }
    },
    30_000,
  );
});
