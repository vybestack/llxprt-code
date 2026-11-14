/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { waitFor } from '@vybestack/llxprt-code-test-utils';
import type { z } from 'zod';
import {
  type ProcessOutcome,
  installParityFixture,
  networkEventSchema,
  parityDescription,
  probeCredential,
} from './profile-parity-harness.js';

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe(`${parityDescription}: harness sensitivity`, () => {
  const fixture = installParityFixture();

  describe('subprocess outcome sensitivity', () => {
    it('rejects a parent-requested termination with the signal and captured stderr', async () => {
      await expect(
        fixture.runProcess(
          [
            '--eval',
            `process.stderr.write('Synthetic child interruption');
             setInterval(() => {}, 1000);`,
          ],
          { terminateWhenStderrContains: 'Synthetic child interruption' },
        ),
      ).rejects.toThrow(/SIGTERM[\s\S]*Synthetic child interruption/);
    });

    it('ends the whole process tree of a terminated child and reports how far the launch got', async () => {
      const marker = 'Synthetic tree ready';
      const pidFile = join(fixture.dir, 'grandchild.pid');
      const failure = await fixture
        .runProcess(
          [
            '--eval',
            `const { spawn } = await import('node:child_process');
             const { writeFileSync } = await import('node:fs');
             const grandchild = spawn(process.execPath, ['--eval', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
             writeFileSync(${JSON.stringify(pidFile)}, String(grandchild.pid));
             process.stderr.write(${JSON.stringify(marker)});
             setInterval(() => {}, 1000);`,
          ],
          { terminateWhenStderrContains: marker },
        )
        .then(
          () => undefined,
          (error: unknown) => error,
        );

      expect(failure).toBeInstanceOf(Error);
      expect(failure instanceof Error ? failure.message : '').toMatch(
        /stages since spawn: preload loaded \+\d+ms, first output \+\d+ms, last request logged not reached, exit \+\d+ms, close \+\d+ms\n/,
      );
      const grandchildPid = Number(await readFile(pidFile, 'utf8'));
      await waitFor(() => expect(isRunning(grandchildPid)).toBe(false), {
        timeout: 10000,
      });
    });

    it('does not mistake an ordinary non-zero exit status for an interruption', async () => {
      const outcome = await fixture.runProcess(
        [
          '--eval',
          `process.stderr.write('Synthetic status'); process.exit(1);`,
        ],
        { terminateWhenStderrContains: 'never-written-marker' },
      );
      expect(outcome).toStrictEqual({
        exitCode: 1,
        stdout: '',
        stderr: 'Synthetic status',
      });
    });

    for (const exitCode of [0, 23]) {
      it(`preserves actual exit status ${exitCode} and captured output`, async () => {
        const outcome = await fixture.runProcess([
          '--eval',
          `process.stdout.write('Synthetic child output');
           process.stderr.write('Synthetic child diagnostic');
           process.exit(${exitCode});`,
        ]);
        expect(outcome).toStrictEqual({
          exitCode,
          stdout: 'Synthetic child output',
          stderr: 'Synthetic child diagnostic',
        });
      });
    }
  });

  describe('test transport boundary sensitivity', () => {
    async function probe(source: string): Promise<{
      readonly outcome: ProcessOutcome;
      readonly events: ReadonlyArray<z.infer<typeof networkEventSchema>>;
      readonly requests: string;
    }> {
      await fixture.resetObservations();
      const outcome = await fixture.runProcess([
        '--eval',
        `try { ${source} } catch (error) {
          process.stderr.write((error instanceof Error ? error.message : 'Boundary rejection') + '\\n');
          process.exit(1);
        }`,
      ]);
      const events = await fixture.readBoundaryEvents(networkEventSchema);
      const requests = await fixture.readRequestLog();
      expect(JSON.stringify({ outcome, events, requests })).not.toContain(
        probeCredential,
      );
      return { outcome, events, requests };
    }

    const transports: ReadonlyArray<
      z.infer<typeof networkEventSchema>['transport']
    > = ['http', 'websocket'];

    for (const transport of transports) {
      it(`${transport}: rejects and records a wrong Codex endpoint before returning inference`, async () => {
        const endpoint =
          transport === 'http'
            ? 'https://chatgpt.com/not-codex/responses'
            : 'wss://chatgpt.com/not-codex/responses';
        const source =
          transport === 'http'
            ? `await fetch('${endpoint}', { method: 'POST', body: JSON.stringify({model: 'gpt-5.2-codex'}) });`
            : `const { default: WebSocket } = await import(${JSON.stringify(import.meta.resolve('../../../providers/src/openai-responses/responses-ws-module.js'))});
               const socket = new WebSocket('${endpoint}', { headers: { Authorization: 'Bearer ${probeCredential}' } });
               socket.on('open', () => socket.send(JSON.stringify({model: 'gpt-5.2-codex'})));`;
        const result = await probe(source);
        expect(result.outcome.exitCode).toBe(1);
        expect(result.outcome.stderr).toContain('Unexpected network endpoint');
        expect(result.events).toStrictEqual([
          {
            operation: 'unexpected-network',
            transport,
            method: transport === 'http' ? 'POST' : 'CONNECT',
            endpoint,
          },
        ]);
        expect(result.requests).toBe('');
      });
    }

    it('records an external GET before rejecting it without leaking URL credentials', async () => {
      const result = await probe(
        `await fetch('https://auth.openai.com/authorize?code=${probeCredential}');`,
      );
      expect(result.outcome.exitCode).toBe(1);
      expect(result.outcome.stderr).toContain('Unexpected network request');
      expect(result.events).toStrictEqual([
        {
          operation: 'unexpected-network',
          transport: 'http',
          method: 'GET',
          endpoint: 'https://auth.openai.com/authorize',
        },
      ]);
      expect(result.requests).toBe('');
    });

    it('records an OAuth POST before attempting inference model parsing', async () => {
      const result = await probe(
        `await fetch('https://auth.openai.com/oauth/token?code=${probeCredential}', {
          method: 'POST',
          headers: { Authorization: 'Bearer ${probeCredential}' },
          body: JSON.stringify({grant_type: 'refresh_token', refresh_token: '${probeCredential}'})
        });`,
      );
      expect(result.outcome.exitCode).toBe(1);
      expect(result.outcome.stderr).toContain('Unexpected network endpoint');
      expect(result.outcome.stderr).not.toContain('ZodError');
      expect(result.events).toStrictEqual([
        {
          operation: 'unexpected-network',
          transport: 'http',
          method: 'POST',
          endpoint: 'https://auth.openai.com/oauth/token',
        },
      ]);
      expect(result.requests).toBe('');
    });

    it('reads a local data URL without classifying it as an external network attempt', async () => {
      const result = await probe(
        `const response = await fetch('data:text/plain,local-fixture');
         if (response.status !== 200 || await response.text() !== 'local-fixture') throw new Error('Local data URL failed');`,
      );
      expect(result.outcome.exitCode).toBe(0);
      expect(result.outcome.stderr).toBe('');
      expect(result.events).toStrictEqual([]);
      expect(result.requests).toBe('');
    });
  });
});
