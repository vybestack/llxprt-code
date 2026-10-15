/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type * as acp from '@agentclientprotocol/sdk';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApprovalMode, DebugLogger } from '@vybestack/llxprt-code-core';
import { createAgent, type Agent } from '@vybestack/llxprt-code-agents';
import {
  deadline,
  shellOwnerGate,
  shellQuote,
} from '../../agents/src/api/__tests__/helpers/shell-owner-gate.js';
import { RecordingConnection } from './__tests__/zed-test-helpers.js';
import { createZedTerminalTransport } from './zed-terminal-setup.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

import { useOwnedCredentials } from '../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
describe('public ACP Agent shell dual mode (#2616)', () => {
  const credentials = useOwnedCredentials();
  it.skipIf(process.platform === 'win32')(
    'uses TerminalManager for foreground and the same Agent owner for a real background process',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'acp-agent-shell-'));
      const gate = await shellOwnerGate();
      const connection = new RecordingConnection();
      connection.setTerminalOutput('terminal route\n');
      const terminals = createZedTerminalTransport(
        'acp-shell-session',
        connection as unknown as acp.AgentSideConnection,
        root,
        new DebugLogger('llxprt:acp-shell-owner-test'),
        undefined,
      );
      let agent: Agent | undefined;
      try {
        agent = await createAgent({
          provider: 'openai',
          model: 'acp-shell-model',
          workingDir: root,
          sessionId: 'acp-shell-session',
          approvalMode: ApprovalMode.YOLO,
          folderTrust: true,
          interactive: false,
          coreTools: ['run_shell_command', 'check_async_tasks'],
          telemetry: { enabled: false },
          recording: { enabled: false },
          credentialAuthority: credentials().authority,
          executeShellCommand: terminals.executeShellCommand.bind(terminals),
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
          terminals.settleAll(),
        ]);
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
