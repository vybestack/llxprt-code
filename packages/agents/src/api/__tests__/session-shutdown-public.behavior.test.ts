/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { AggregateDisposeError } from '../disposeErrors.js';
import {
  buildAgent,
  drain,
  respondToFirstConfirmation,
  ToolConfirmationOutcome,
} from './helpers/agentHarness.js';
import { gate } from './helpers/recording-finalizer-join-fixture.js';
import { resolveRepositoryFixture } from './helpers/fixtureRoot.js';
import { deadline, shellQuote } from './helpers/shell-owner-gate.js';
import { setImmediate } from 'node:timers/promises';
import { createServer } from 'node:http';

async function physicalGate(): Promise<{
  url: string;
  entered(name: string): Promise<void>;
  connected(name: string): boolean;
  stop(): Promise<void>;
}> {
  const admitted = gate();
  let connected = false;
  const server = createServer((request) => {
    connected = true;
    request.socket.once('close', () => {
      connected = false;
    });
    admitted.release();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Missing gate port');
  return {
    url: `http://127.0.0.1:${address.port}`,
    entered: () => admitted.promise,
    connected: () => connected,
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    },
  };
}

async function physicalWorkStopped(
  pgid: number,
  connected: () => boolean,
): Promise<void> {
  const until = Date.now() + 7500;
  for (;;) {
    if (Date.now() >= until)
      throw new Error(`Shell group ${pgid} survived cancellation`);
    const groups = spawnSync('ps', ['-axo', 'pgid='], { encoding: 'utf8' });
    if (groups.status !== 0) throw new Error(groups.stderr);
    if (
      !groups.stdout.trim().split(/\s+/).map(Number).includes(pgid) &&
      !connected()
    )
      return;
    await setImmediate();
  }
}

async function shellTranscript(
  directory: string,
  url: string,
): Promise<string> {
  const command = [
    'exec',
    shellQuote(process.execPath),
    shellQuote(
      resolveRepositoryFixture(
        import.meta.url,
        'packages/agents/src/api/__tests__/helpers/shell-owner-workload.ts',
      ),
    ),
    shellQuote(`${url}/shutdown`),
    shellQuote(join(directory, 'shell')),
  ].join(' ');
  const fixture = join(directory, 'model.jsonl');
  await writeFile(
    fixture,
    [
      {
        chunks: [
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'tool_call',
                id: 'shell',
                name: 'run_shell_command',
                parameters: { command, is_background: true },
              },
            ],
          },
        ],
      },
      {
        chunks: [
          { speaker: 'ai', blocks: [{ type: 'text', text: 'shell admitted' }] },
        ],
      },
    ]
      .map((row) => JSON.stringify(row))
      .join('\n') + '\n',
  );
  return fixture;
}

describe('public Agent coordinated shutdown', () => {
  it.skipIf(process.platform === 'win32')(
    'cancels physical shell work before a held factory settles and joins its late resource once',
    async () => {
      const directory = await mkdtemp(
        join(tmpdir(), 'public-shutdown-factory-'),
      );
      const server = await physicalGate();
      const acquisition = gate();
      const acquired = gate();
      const descriptor = await open(join(directory, 'factory-resource'), 'w+');
      const factory = async () => {
        acquired.release();
        await acquisition.promise;
        return {
          dispose: async () => {
            await writeFile(
              join(directory, 'factory-retired'),
              String(descriptor.fd),
              { flag: 'wx' },
            );
            await descriptor.close();
          },
        };
      };
      const fixture = await shellTranscript(directory, server.url);
      const built = await buildAgent(fixture, {
        workingDir: directory,
        toolSchedulerFactory: factory,
        folderTrust: true,
        skillsSupport: false,
        mcpEnabled: false,
        recording: { enabled: false },
        telemetry: { enabled: false },
      });
      const responder = respondToFirstConfirmation(
        built.agent,
        ToolConfirmationOutcome.ProceedOnce,
      );
      try {
        const events = await drain(built.agent.stream('Start shell work'));
        expect(events.some((event) => event.type === 'tool-result')).toBe(true);
        await deadline(server.entered('shutdown'), 'physical shell start');
        await acquired.promise;
        const pid = Number(
          await readFile(join(directory, 'shell.pid'), 'utf8'),
        );
        const observed = spawnSync('ps', ['-o', 'pgid=', '-p', String(pid)], {
          encoding: 'utf8',
        });
        const pgid = Number(observed.stdout.trim());
        if (observed.status !== 0 || !Number.isSafeInteger(pgid) || pgid <= 1)
          throw new Error('Missing shell group');
        let finished = false;
        const closing = built.agent.dispose();
        void closing.then(
          () => {
            finished = true;
          },
          () => {
            finished = true;
          },
        );
        expect(new Set([closing, built.agent.dispose()]).size).toBe(1);
        expect(() => built.agent.tools.openClientChannel()).toThrow('disposed');
        await deadline(
          physicalWorkStopped(pgid, () => server.connected('shutdown')),
          'shell cancellation before factory settlement',
        );
        expect(server.connected('shutdown')).toBe(false);
        expect(finished).toBe(false);
        const resourceDescriptor = descriptor.fd;
        await descriptor.write('still owned before factory release');
        acquisition.release();
        await deadline(closing, 'late factory resource retirement');
        await expect(descriptor.write('after dispose')).rejects.toThrow(
          'Bad file descriptor',
        );
        await built.agent.dispose();
        expect(await readFile(join(directory, 'factory-retired'), 'utf8')).toBe(
          String(resourceDescriptor),
        );
      } finally {
        responder.unsubscribe();
        acquisition.release();
        await built.cleanup();
        await descriptor.close();
        await server.stop();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it('surfaces external factory and cleanup failures together after releasing a later physical resource', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'public-shutdown-failures-'),
    );
    const invalid = await open(join(directory, 'invalid'), 'w+');
    const later = await open(join(directory, 'later'), 'w+');
    await invalid.close();
    const primary = new Error('Factory transport closed');
    let cleanupFailure: unknown;
    let creations = 0;
    const built = await buildAgent('plain-text.jsonl', {
      toolSchedulerFactory: async () => {
        if (++creations === 1) {
          try {
            await invalid.write('unavailable');
          } catch (error) {
            cleanupFailure = error;
            throw new AggregateDisposeError([
              primary,
              new AggregateError([error]),
            ]);
          }
        }
        return { dispose: () => later.close() };
      },
    });
    try {
      const first = built.agent.tools.openClientChannel();
      const second = built.agent.tools.openClientChannel();
      await Promise.all([first.ready, second.ready]);
      const closing = built.agent.dispose();
      const failure = await closing.then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(AggregateDisposeError);
      if (!(failure instanceof AggregateDisposeError))
        throw new Error('Missing public disposal failure');
      expect(failure.errors).toStrictEqual([primary, cleanupFailure]);
      await expect(later.write('after cleanup failure')).rejects.toThrow(
        'Bad file descriptor',
      );
      expect(new Set([closing, built.agent.dispose()]).size).toBe(1);
      await expect(built.agent.dispose()).rejects.toBe(failure);
    } finally {
      await built.cleanup();
      await later.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
