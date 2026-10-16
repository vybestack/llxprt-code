/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgent, type Agent } from '@vybestack/llxprt-code-agents';
import {
  DebugLogger,
  coreEvents,
  escapeShellArg,
  getShellConfiguration,
} from '@vybestack/llxprt-code-core';
import { useOwnedCredentials } from '../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import { PhysicalTerminalPeer } from './__tests__/physical-terminal-peer.js';
import {
  projectZedSessionAgent,
  projectZedSessionSettings,
  type ZedSessionAgentPort,
} from './zed-session-ports.js';
import { Session } from './zed-session.js';
import { createZedTerminalTransport } from './zed-terminal-setup.js';

function gate(): { promise: Promise<void>; release(): void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('ACP Session accepted work across shutdown', () => {
  const credentials = useOwnedCredentials();
  const cleanup: Array<() => void | Promise<void>> = [];
  const releases: Array<() => void> = [];
  let directory: string;
  let peer: PhysicalTerminalPeer;
  let agent: Agent;
  let port: ZedSessionAgentPort;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'acp-accepted-work-'));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    peer = new PhysicalTerminalPeer();
    cleanup.push(() => peer.dispose());
    await peer.initialize();
    agent = await createAgent({
      provider: 'fake',
      model: 'accepted-work-model',
      workingDir: directory,
      credentialAuthority: credentials().authority,
    });
    cleanup.push(() => agent.dispose());
    port = projectZedSessionAgent(agent);
  });
  afterEach(async () => {
    for (const release of releases.splice(0)) release();
    const failures: unknown[] = [];
    for (const close of cleanup.splice(0).reverse()) {
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        'Accepted-work fixture cleanup failed',
      );
  });
  function session(
    terminals: ConstructorParameters<typeof Session>[5] = null,
    configOptionsEnabled = false,
  ): Session {
    const value = new Session(
      'accepted-work',
      port,
      projectZedSessionSettings(
        {
          projectRoot: directory,
          targetDir: directory,
          maxSessionTurns: 10,
          debugMode: false,
          recursiveFileSearch: true,
          fileFiltering: { respectGitIgnore: true, respectLlxprtIgnore: true },
        },
        agent,
        agent.workspace,
        agent.workspace,
        (listener) => agent.settings.subscribeModelChanges(listener),
      ),
      peer.connection,
      configOptionsEnabled,
      terminals,
    );
    cleanup.push(() => value.dispose());
    return value;
  }
  it('joins a real accepted history read before resolving Session disposal', async () => {
    const started = gate();
    const held = gate();
    releases.push(held.release);
    const read = port.getHistory;
    port.getHistory = async () => {
      const history = await read();
      started.release();
      await held.promise;
      return history;
    };
    const current = session();
    const replay = current.replayLiveHistory();
    const replayOutcome = Promise.allSettled([replay]);
    await started.promise;
    let closed = false;
    const closing = current.dispose().then(() => {
      closed = true;
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(closed).toBe(false);
    } finally {
      held.release();
    }
    const [[result]] = await Promise.all([replayOutcome, closing]);
    expect(result.status).toBe('fulfilled');
    await expect(current.replayLiveHistory()).rejects.toThrow(
      'ACP session is disposed',
    );
    await expect(agent.chat('late owner work')).rejects.toThrow(
      'Agent is closed',
    );
  }, 30000);
  it('does not start a command after shutdown wins a held real title-recording prefix', async () => {
    const started = gate();
    const held = gate();
    releases.push(held.release);
    const record = port.session.recordRecordingTitle;
    port.session.recordRecordingTitle = async (title) => {
      await record(title);
      started.release();
      await held.promise;
    };
    const current = session();
    const outcome = Promise.allSettled([
      current.prompt({
        sessionId: 'accepted-work',
        prompt: [{ type: 'text', text: '/model' }],
      }),
    ]);
    await started.promise;
    let closed = false;
    const closing = current.dispose().then(() => {
      closed = true;
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(closed).toBe(false);
    } finally {
      held.release();
    }
    const [[result]] = await Promise.all([outcome, closing]);
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected')
      throw new Error('Command ran after Session closed');
    expect(result.reason).toMatchObject({ message: 'ACP session is disposed' });
  }, 30000);
  it.each(['options', 'model-observer'])(
    'joins accepted %s model enumeration through actual owner reads',
    async (operation) => {
      const started = gate();
      const held = gate();
      releases.push(held.release);
      const list = port.listAvailableModels;
      port.listAvailableModels = async () => {
        const [result] = await Promise.allSettled([list()]);
        started.release();
        await held.promise;
        if (result.status === 'rejected') throw result.reason;
        return result.value;
      };
      const current = session(null, operation === 'model-observer');
      const accepted =
        operation === 'options'
          ? Promise.allSettled([current.setConfigOption('emojifilter', 'auto')])
          : Promise.resolve([]);
      if (operation === 'model-observer') {
        agent.setEphemeralSetting('emojifilter', 'warn');
        coreEvents.emitSettingsChanged();
      }
      await started.promise;
      let closed = false;
      const closing = current.dispose().then(() => {
        closed = true;
      });
      try {
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(closed).toBe(false);
      } finally {
        held.release();
      }
      await Promise.all([closing, accepted]);
      expect(closed).toBe(true);
      await expect(current.getConfigOptions()).rejects.toThrow(
        'ACP session is disposed',
      );
    },
    30000,
  );
  it('reports mandatory physical terminal-release failure from explicit prompt cancellation', async () => {
    const terminals = createZedTerminalTransport(
      'accepted-work',
      peer.connection,
      directory,
      new DebugLogger('accepted-cancel'),
      undefined,
    );
    const current = session(terminals);
    const script = join(directory, 'held-terminal.ts');
    await writeFile(script, 'setInterval(() => {}, 1000);');
    const shell = getShellConfiguration();
    const command = `${shell.shell === 'powershell' ? '&' : 'exec'} ${escapeShellArg(process.execPath, shell.shell)} ${escapeShellArg(script, shell.shell)}`;
    peer.holdAcquisition();
    const execution = Promise.allSettled([
      terminals.executeShellCommand(
        command,
        directory,
        () => {},
        new AbortController().signal,
      ),
    ]);
    await peer.whenAcquired();
    peer.failRelease = true;
    const cancelled = Promise.allSettled([current.cancelPendingPrompt()]);
    peer.releaseAcquisition();
    const [[result]] = await Promise.all([cancelled, execution]);
    peer.failRelease = false;
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected')
      throw new Error('Mandatory terminal failure was swallowed');
    expect(result.reason).toMatchObject({
      message: expect.stringContaining('physical peer release response failed'),
    });
    expect(peer.snapshots()).toStrictEqual([
      expect.objectContaining({ exited: true, released: 1 }),
    ]);
  }, 30000);
});
