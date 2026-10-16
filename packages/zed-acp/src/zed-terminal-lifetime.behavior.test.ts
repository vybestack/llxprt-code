/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import * as acp from '@agentclientprotocol/sdk';
import { createAgent } from '@vybestack/llxprt-code-agents';
import { useOwnedCredentials } from '../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import { disposeZedSession } from './zed-session-agent.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DebugLogger,
  escapeShellArg,
  getShellConfiguration,
} from '@vybestack/llxprt-code-core';
import { createZedTerminalTransport } from './zed-terminal-setup.js';
import { PhysicalTerminalPeer } from './__tests__/physical-terminal-peer.js';
async function deadline<T>(operation: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out: ${label}`)),
          10000,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

describe('ACP physical terminal acceptance and mandatory release', () => {
  const credentials = useOwnedCredentials();
  const cleanup: Array<() => void | Promise<void>> = [];
  let peer: PhysicalTerminalPeer;
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "ACP terminal's-"));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    peer = new PhysicalTerminalPeer();
    cleanup.push(() => peer.dispose());
    await peer.initialize();
  });
  afterEach(async () => {
    const failures: unknown[] = [];
    for (const close of cleanup.splice(0).reverse()) {
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(failures, 'Terminal fixture cleanup failed');
  });
  async function command(name: string, held = false): Promise<string> {
    const script = join(directory, `${name}.ts`);
    await writeFile(
      script,
      `process.stdout.write(${JSON.stringify(name + ' physical output\n')});${held ? 'setInterval(() => {}, 1000);' : ''}`,
    );
    const shell = getShellConfiguration();
    return `${shell.shell === 'powershell' ? '&' : 'exec'} ${escapeShellArg(process.execPath, shell.shell)} ${escapeShellArg(script, shell.shell)}`;
  }
  function manager(session: string) {
    const terminals = createZedTerminalTransport(
      session,
      peer.connection,
      directory,
      new DebugLogger('physical-terminal-lifetime'),
      undefined,
    );
    cleanup.push(async () => {
      peer.releaseAcquisition();
      await terminals.settleAll();
    });
    return terminals;
  }
  function physicalAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ESRCH')
        return false;
      throw error;
    }
  }
  it('joins a terminal accepted before its real acquired-process response arrives, settles that wave, and allows a later wave', async () => {
    const terminals = manager('held-acquisition');
    peer.holdAcquisition();
    const execution = terminals.executeShellCommand(
      await command('held', true),
      directory,
      () => {},
      new AbortController().signal,
    );
    const outcome = Promise.allSettled([execution]);
    await deadline(peer.whenAcquired(), 'real terminal process acquired');
    const acquired = peer.snapshots().find((entry) => entry.pid !== undefined);
    if (acquired?.pid === undefined)
      throw new Error('Missing acquired physical PID');
    expect(physicalAlive(acquired.pid)).toBe(true);
    let settled = false;
    const closingWave = terminals.settleAll().then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    peer.releaseAcquisition();
    await deadline(closingWave, 'late acquisition wave joined');
    await deadline(outcome, 'accepted execution joined');
    expect(physicalAlive(acquired.pid)).toBe(false);
    expect(
      peer.snapshots().find((entry) => entry.id === acquired.id)?.released,
    ).toBe(1);
    const output: string[] = [];
    await deadline(
      terminals.executeShellCommand(
        await command('next-wave'),
        directory,
        (event) => {
          if (event.type === 'data' && typeof event.chunk === 'string')
            output.push(event.chunk);
        },
        new AbortController().signal,
      ),
      'next reusable prompt wave',
    );
    expect(output.join('')).toContain('next-wave physical output');
  }, 30000);
  it('permanently closes admission synchronously, caches dispose, joins late acquired processes and leaves a sibling usable', async () => {
    const terminals = manager('closing');
    const sibling = manager('surviving');
    peer.holdAcquisition();
    const execution = terminals.executeShellCommand(
      await command('late', true),
      directory,
      () => {},
      new AbortController().signal,
    );
    const outcome = Promise.allSettled([execution]);
    await deadline(
      peer.whenAcquired(),
      'late terminal acquired before dispose',
    );
    const pending = terminals.dispose();
    expect(
      new Set([pending, terminals.dispose(), terminals.dispose()]).size,
    ).toBe(1);
    await expect(
      terminals.executeShellCommand(
        'never acquired',
        directory,
        () => {},
        new AbortController().signal,
      ),
    ).rejects.toThrow(/disposed/);
    peer.releaseAcquisition();
    await deadline(pending, 'permanent terminal dispose');
    await deadline(outcome, 'closed accepted execution');
    expect(
      peer.snapshots().every((entry) => entry.exited && entry.released === 1),
    ).toBe(true);
    const result = await sibling.executeShellCommand(
      await command('sibling'),
      directory,
      () => {},
      new AbortController().signal,
    );
    expect(result.output).toContain('sibling physical output');
    await sibling.dispose();
  }, 30000);
  it('keeps local output failure first and reports both remote mandatory kill and release failures after physically stopping the process', async () => {
    const terminals = manager('failed-output');
    const primary = new Error('local output callback failed');
    peer.failKill = true;
    peer.failRelease = true;
    let failure: unknown;
    try {
      await terminals.executeShellCommand(
        await command('failure', true),
        directory,
        () => {
          throw primary;
        },
        new AbortController().signal,
      );
    } catch (error) {
      failure = error;
    }
    if (!(failure instanceof AggregateError))
      throw new Error('Missing exhaustive terminal failure aggregate');
    expect(failure.errors[0]).toBe(primary);
    expect(
      failure.errors
        .slice(1)
        .map((error: unknown) =>
          error instanceof Error ? error.message : String(error),
        ),
    ).toStrictEqual([
      'physical peer kill response failed',
      'physical peer release response failed',
    ]);
    expect(failure.errors.slice(1)).toMatchObject([
      { code: -32001, data: { phase: 'kill' } },
      { code: -32002, data: { phase: 'release' } },
    ]);
    expect(peer.snapshots()).toStrictEqual([
      expect.objectContaining({ exited: true, killed: 1, released: 1 }),
    ]);
  }, 30000);
  it('reports an explicitly undefined remote-exit rejection and still releases the physical process', async () => {
    const failure = vi
      .spyOn(acp.TerminalHandle.prototype, 'waitForExit')
      .mockRejectedValue(undefined);
    cleanup.push(() => failure.mockRestore());
    const terminals = manager('undefined-exit');
    const outcome = terminals
      .executeShellCommand(
        await command('undefined-exit', true),
        directory,
        () => {},
        new AbortController().signal,
      )
      .then(
        () => ({ rejected: false, reason: undefined }),
        (reason: unknown) => ({ rejected: true, reason }),
      );
    expect(await deadline(outcome, 'undefined exit rejection')).toStrictEqual({
      rejected: true,
      reason: undefined,
    });
    expect(peer.snapshots()).toStrictEqual([
      expect.objectContaining({ exited: true, killed: 1, released: 1 }),
    ]);
  }, 30000);

  it('releases a permanently closing terminal and actual Agent even when subscription detachment fails', async () => {
    const terminals = manager('session-disposal');
    const agent = await createAgent({
      provider: 'openai',
      model: 'terminal-lifetime-model',
      workingDir: directory,
      credentialAuthority: credentials().authority,
      telemetry: { enabled: false },
      recording: { enabled: false },
    });
    cleanup.push(() => agent.dispose());
    peer.holdAcquisition();
    const execution = terminals.executeShellCommand(
      await command('session-disposal', true),
      directory,
      () => {},
      new AbortController().signal,
    );
    const outcome = Promise.allSettled([execution]);
    await deadline(peer.whenAcquired(), 'session physical process acquired');
    const primary = new Error('subscription detach failed');
    const disposed = disposeZedSession(
      () => {
        throw primary;
      },
      terminals,
      new DebugLogger('terminal-disposal'),
      () => {},
      agent,
    );
    const result = Promise.allSettled([disposed]);
    peer.releaseAcquisition();
    await deadline(outcome, 'session execution joined despite detach failure');
    const [failure] = await deadline(
      result,
      'failed session disposal joins resources',
    );
    expect(failure).toStrictEqual({ status: 'rejected', reason: primary });
    expect(peer.snapshots()).toStrictEqual([
      expect.objectContaining({ exited: true, killed: 1, released: 1 }),
    ]);
    await expect(agent.chat('late work')).rejects.toThrow('Agent is closed');
    await expect(
      terminals.executeShellCommand(
        'late terminal',
        directory,
        () => {},
        new AbortController().signal,
      ),
    ).rejects.toThrow(/disposed/);
  }, 30000);
  it('joins late acquisition before reporting remote kill and release failures from cached permanent disposal', async () => {
    const terminals = manager('failed-disposal');
    peer.holdAcquisition();
    peer.failKill = true;
    peer.failRelease = true;
    const execution = terminals.executeShellCommand(
      await command('failed-disposal', true),
      directory,
      () => {},
      new AbortController().signal,
    );
    const outcome = Promise.allSettled([execution]);
    await deadline(peer.whenAcquired(), 'failing terminal acquired');
    const closing = terminals.dispose();
    const disposal = Promise.allSettled([closing]);
    expect(
      new Set([closing, terminals.dispose(), terminals.dispose()]).size,
    ).toBe(1);
    peer.releaseAcquisition();
    const [failure] = await deadline(
      disposal,
      'failed terminal disposal joined',
    );
    if (
      failure.status !== 'rejected' ||
      !(failure.reason instanceof AggregateError)
    )
      throw new Error('Missing mandatory remote cleanup failures');
    expect(failure.reason.errors).toMatchObject([
      {
        code: -32001,
        message: 'physical peer kill response failed',
        data: { phase: 'kill' },
      },
      {
        code: -32002,
        message: 'physical peer release response failed',
        data: { phase: 'release' },
      },
    ]);
    const [executionResult] = await deadline(
      outcome,
      'failed accepted execution joined',
    );
    expect(executionResult).toStrictEqual({
      status: 'rejected',
      reason: failure.reason,
    });
    expect(peer.snapshots()).toStrictEqual([
      expect.objectContaining({ exited: true, killed: 1, released: 1 }),
    ]);
  }, 30000);
});
