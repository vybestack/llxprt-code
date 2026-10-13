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
import { createAgent, type Agent } from '@vybestack/llxprt-code-agents';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { resolveRepositoryFixture } from './helpers/fixtureRoot.js';
import { makeScratchDir } from './helpers/scratch-dir.js';
import {
  awaitShellGroupAbsence,
  deadline,
  shellOwnerGate,
  shellQuote,
} from './helpers/shell-owner-gate.js';

describe('public Agent shell ownership', () => {
  const credentials = useOwnedCredentials();
  it.skipIf(process.platform === 'win32')(
    'joins a real model-generated background shell process and removes its log on explicit Agent disposal',
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
      const previousFake = process.env.LLXPRT_FAKE_RESPONSES;
      let agent: Agent | undefined;
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
        process.env.LLXPRT_FAKE_RESPONSES = fixture;
        const created = await createAgent({
          credentialAuthority: credentials().authority,
          provider: 'fake',
          model: 'fake-model',
          workingDir: root,
          folderTrust: true,
          telemetry: { enabled: false },
          recording: { enabled: false },
          skillsSupport: false,
        });
        agent = created;
        created.tools.onConfirmationRequest((request) => {
          created.tools.respondToConfirmation(
            request.confirmationId,
            ToolConfirmationOutcome.ProceedOnce,
          );
        });
        const events = [];
        for await (const event of agent.stream(
          'Launch the shell background job.',
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
              event.type === 'tool-result' &&
              event.result.name === 'run_shell_command' &&
              event.result.isError === false,
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
        const job = events.find(
          (event) =>
            event.type === 'tool-result' &&
            event.result.name === 'run_shell_command' &&
            event.result.isError === false,
        );
        if (
          !job ||
          job.type !== 'tool-result' ||
          typeof job.result.display !== 'string'
        )
          throw new Error('Missing successful standalone shell response');
        const jobId = /Background job \*\*([a-zA-Z0-9_-]+)\*\*/.exec(
          job.result.display,
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
        await deadline(agent.dispose(), 'public Agent disposal');
        await awaitShellGroupAbsence(pgid);
        expect(existsSync(marker)).toBe(false);
        expect(existsSync(logDir)).toBe(false);
      } finally {
        try {
          await agent?.dispose();
        } finally {
          if (previousFake === undefined)
            delete process.env.LLXPRT_FAKE_RESPONSES;
          else process.env.LLXPRT_FAKE_RESPONSES = previousFake;
          await gate.stop();
          await rm(root, { recursive: true, force: true });
        }
      }
    },
    30_000,
  );
});
