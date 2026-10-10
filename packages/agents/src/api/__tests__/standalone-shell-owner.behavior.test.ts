import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import { resolveShellJobSettings } from '@vybestack/llxprt-code-core/config/asyncTaskServices.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createAgenticLoop,
  TaskLaunchOwner,
} from '@vybestack/llxprt-code-agents';
import { AsyncTaskManager } from '@vybestack/llxprt-code-core/services/asyncTaskManager.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';
import { resolveRepositoryFixture } from './helpers/fixtureRoot.js';
import { makeScratchDir } from './helpers/scratch-dir.js';
import {
  awaitShellGroupAbsence,
  deadline,
  shellOwnerGate,
  shellQuote,
} from './helpers/shell-owner-gate.js';

describe('standalone createAgenticLoop shell ownership', () => {
  it.skipIf(process.platform === 'win32')(
    'joins a real model-generated background shell process and removes its log on explicit runner disposal',
    async () => {
      const root = await makeScratchDir('standalone-shell-owner-');
      const gate = await shellOwnerGate();
      const marker = join(root, 'standalone.marker');
      const command = [
        'exec',
        shellQuote(process.execPath),
        shellQuote(
          resolveRepositoryFixture(
            import.meta.url,
            'packages/agents/src/api/__tests__/helpers/shell-owner-workload.ts',
          ),
        ),
        shellQuote(`${gate.url}/standalone`),
        shellQuote(marker),
      ].join(' ');
      const fixture = join(root, 'shell.jsonl');
      let built: Awaited<ReturnType<typeof buildCliStyleConfig>> | undefined;
      let loop: ReturnType<typeof createAgenticLoop> | undefined;
      try {
        await writeFile(
          fixture,
          [
            JSON.stringify({
              chunks: [
                {
                  speaker: 'ai',
                  blocks: [
                    {
                      type: 'tool_call',
                      id: 'standalone-tool',
                      name: 'run_shell_command',
                      parameters: { command, is_background: true },
                    },
                  ],
                },
              ],
            }),
            JSON.stringify({
              chunks: [
                {
                  speaker: 'ai',
                  blocks: [{ type: 'text', text: 'shell started' }],
                },
              ],
            }),
          ].join('\n') + '\n',
        );
        built = await buildCliStyleConfig(fixture, {
          workingDir: root,
          folderTrust: true,
          telemetry: { enabled: false },
          recording: { enabled: false },
          skillsSupport: false,
        });
        const settingsRoot = built;
        loop = createAgenticLoop({
          telemetry: RootTelemetry.prepare({
            enabled: false,
            sessionId: 'isolated-caller-fixture',
            maxBytes: 1024,
            maxFiles: 1,
          }),
          readShellJobSettings: () =>
            resolveShellJobSettings(settingsRoot.settingsService),
          readExecutionPolicy: () =>
            settingsRoot.settingsOwner.readToolExecutionPolicy(),
          getToolGovernance: () =>
            settingsRoot.settingsOwner.readToolGovernance(
              settingsRoot.config.getExcludeTools() ?? [],
            ),
          agentClient: built.agentClient,
          config: built.config,
          messageBus: built.messageBus,
          interactiveMode: false,
          approvalHandler: async () => ({
            outcome: ToolConfirmationOutcome.ProceedOnce,
          }),
          displayCallbacks: {},
          taskLaunchOwner: new TaskLaunchOwner(new AsyncTaskManager(5)),
        });
        const events = [];
        for await (const event of loop.run(
          'Launch the shell background job.',
          new AbortController().signal,
        )) {
          events.push(event);
        }
        await deadline(
          gate.entered('standalone'),
          'standalone model shell launch',
        );
        expect(
          events.some(
            (event) =>
              event.kind === 'tools_complete' &&
              event.completed.some(
                (call) =>
                  call.request.name === 'run_shell_command' &&
                  call.status === 'success',
              ),
          ),
        ).toBe(true);
        expect(existsSync(`${marker}.pid`)).toBe(true);
        expect(gate.connected('standalone')).toBe(true);
        const pid = Number(await readFile(`${marker}.pid`, 'utf8'));
        const group = spawnSync('ps', ['-o', 'pgid=', '-p', String(pid)], {
          encoding: 'utf8',
        });
        const pgid = Number(group.stdout.trim());
        if (group.status !== 0 || !Number.isSafeInteger(pgid) || pgid <= 1)
          throw new Error(
            `Cannot identify standalone shell group: ${group.stderr}`,
          );
        const job = events
          .filter((event) => event.kind === 'tools_complete')
          .flatMap((event) => event.completed)
          .find(
            (call) =>
              call.request.name === 'run_shell_command' &&
              call.status === 'success',
          );
        if (
          !job ||
          job.status !== 'success' ||
          typeof job.response.resultDisplay !== 'string'
        )
          throw new Error('Missing successful standalone shell response');
        const jobId = /Background job \*\*([a-zA-Z0-9_-]+)\*\*/.exec(
          job.response.resultDisplay,
        )?.[1];
        if (!jobId) throw new Error('Standalone shell response omitted job id');
        const logParent = tmpdir();
        const directories = (await readdir(logParent)).filter(
          (entry) =>
            entry.startsWith('shell-jobs-') &&
            existsSync(join(logParent, entry, `${jobId}.log`)),
        );
        expect(directories).toHaveLength(1);
        const logDir = join(logParent, directories[0]);
        expect(await readFile(join(logDir, `${jobId}.log`), 'utf8')).toContain(
          'waiting for shell owner gate',
        );
        await deadline(loop.dispose(), 'standalone runner disposal');
        await awaitShellGroupAbsence(pgid);
        expect(existsSync(marker)).toBe(false);
        expect(existsSync(logDir)).toBe(false);
      } finally {
        await loop?.dispose();
        await built?.config.dispose();
        await built?.cleanup();
        await gate.stop();
        await rm(root, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
