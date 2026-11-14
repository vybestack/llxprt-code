/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'bun:test';

/**
 * A supervisor stops a worker by signalling the process it started, the host
 * half of the sandbox hop. These tests run the production bwrap launch
 * function in a host process, against a real bwrap sandbox whose payload
 * records the signal it receives, and observe from outside what the
 * supervisor observes: the host's exit status, whether the payload shut down
 * gracefully, and whether any process of the sandbox's PID namespace is left.
 */

const PAYLOAD_SCRIPT = fileURLToPath(
  new URL('./__tests__/sandbox-bwrap-signal-payload.ts', import.meta.url),
);
const HOST_SCRIPT = fileURLToPath(
  new URL('./__tests__/sandbox-bwrap-launch-host.ts', import.meta.url),
);

const bwrapProbe =
  process.platform === 'linux'
    ? spawnSync(
        'bwrap',
        [
          '--unshare-user',
          '--unshare-pid',
          '--disable-userns',
          '--ro-bind',
          '/',
          '/',
          '--',
          '/bin/true',
        ],
        { stdio: 'ignore', timeout: 1500 },
      )
    : undefined;
const skipBwrap =
  process.platform !== 'linux' ||
  (bwrapProbe?.status !== 0 &&
    process.env.LLXPRT_REQUIRE_BWRAP_TESTS !== 'true');

/**
 * Upper bounds, not expected durations. Each case starts a cold Bun host that
 * loads the launch modules and then a Bun payload inside the sandbox, which
 * can take minutes on a loaded shared machine. Readiness is awaited through
 * explicit markers, so a healthy run proceeds as soon as they appear.
 */
const LAUNCH_TIMEOUT_MS = 600_000;
const TEST_TIMEOUT_MS = 720_000;
const TEARDOWN_TIMEOUT_MS = 30_000;
/** Grace the launcher allows a payload after SIGTERM, shortened for tests. */
const STOP_GRACE_MS = 1_500;
/** Exit status the launcher reports when it has to SIGKILL the sandbox. */
const SIGKILL_EXIT_STATUS = 137;

const SIGNAL_NUMBERS = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 } as const;
type ForwardedSignal = keyof typeof SIGNAL_NUMBERS;
const FORWARDED_SIGNALS = Object.keys(SIGNAL_NUMBERS) as ForwardedSignal[];

/** Exit status the payload uses when it handles a forwarded signal. */
const HANDLED_EXIT_STATUS = 7;

const scratchRoot = path.resolve(process.cwd(), '..', '..', '.work', 'phase1b');

interface HostOptions {
  /** The payload ignores termination signals and keeps a tool subprocess. */
  readonly stubborn?: boolean;
  /** The client is gone: the host's stdin and stdout pipes are closed. */
  readonly closeStdio?: boolean;
}

interface RunningHost {
  readonly host: ChildProcess;
  readonly workspace: string;
  readonly sandboxPidNamespace: string;
  readonly exited: Promise<number | null>;
}

function readIfPresent(file: string): string | undefined {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
}

function processState(pid: string): string | undefined {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3);
  } catch {
    return undefined;
  }
}

/** Live processes (not zombies) that belong to the given PID namespace. */
function sandboxMembers(pidNamespace: string): string[] {
  return fs
    .readdirSync('/proc')
    .filter((entry) => /^\d+$/.test(entry))
    .filter((pid) => {
      try {
        return fs.readlinkSync(`/proc/${pid}/ns/pid`) === pidNamespace;
      } catch {
        return false;
      }
    })
    .filter((pid) => {
      const state = processState(pid);
      return state !== undefined && state !== 'Z';
    });
}

async function waitUntil(
  condition: () => boolean,
  description: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('bwrap sandbox host signals', () => {
  const startedHosts: ChildProcess[] = [];
  const startedNamespaces: string[] = [];
  const fixtures: string[] = [];

  // Scanning /proc takes seconds on a loaded shared machine, which exceeds
  // the default hook timeout.
  afterEach(() => {
    // Only what this test started: the host by handle and the sandbox by the
    // PID namespace its payload reported. A correct launcher leaves nothing.
    for (const host of startedHosts.splice(0)) {
      if (host.exitCode === null && host.signalCode === null) {
        host.kill('SIGKILL');
      }
    }
    for (const namespace of startedNamespaces.splice(0)) {
      for (const pid of sandboxMembers(namespace)) {
        try {
          process.kill(Number(pid), 'SIGKILL');
        } catch {
          // The member ended on its own between the scan and the kill.
        }
      }
    }
    for (const fixture of fixtures.splice(0)) {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  }, TEARDOWN_TIMEOUT_MS);

  async function startHost(options: HostOptions = {}): Promise<RunningHost> {
    fs.mkdirSync(scratchRoot, { recursive: true });
    const fixture = fs.mkdtempSync(path.join(scratchRoot, 'signals-'));
    fixtures.push(fixture);
    const workspace = path.join(fixture, 'workspace');
    const home = path.join(fixture, 'home');
    // The launcher mounts the entry point's directory and, when the grand-
    // parent of its parent has node_modules, the package tree. A private copy
    // three levels below the scratch root keeps the mounts to that directory.
    const entryDir = path.join(fixture, 'runtime', 'bin');
    const payload = path.join(entryDir, 'payload.ts');
    fs.mkdirSync(workspace);
    fs.mkdirSync(home);
    // The SIGKILL case leaves the host's session directory behind by design,
    // so the host gets a temp directory that is removed with the fixture.
    const tmp = path.join(fixture, 'tmp');
    fs.mkdirSync(tmp);
    fs.mkdirSync(entryDir, { recursive: true });
    fs.copyFileSync(PAYLOAD_SCRIPT, payload);
    if (options.stubborn === true) {
      fs.writeFileSync(path.join(workspace, 'stubborn'), '');
    }
    const log = fs.openSync(path.join(fixture, 'host.log'), 'w');
    const host = spawn(process.execPath, [HOST_SCRIPT], {
      cwd: workspace,
      // stdin stays open and unread, as for an ACP client holding the pipe.
      stdio: ['pipe', options.closeStdio === true ? 'pipe' : log, log],
      env: {
        ...process.env,
        HOME: home,
        TMPDIR: tmp,
        SANDBOX_PAYLOAD: payload,
        SANDBOX_STOP_GRACE_MS: String(STOP_GRACE_MS),
      },
    });
    fs.closeSync(log);
    startedHosts.push(host);
    const exited = new Promise<number | null>((resolve) => {
      host.once('exit', (code) => resolve(code));
    });
    const readyFile = path.join(workspace, 'ready');
    await waitUntil(
      () =>
        fs.existsSync(readyFile) ||
        host.exitCode !== null ||
        host.signalCode !== null,
      'the sandboxed payload to start',
      LAUNCH_TIMEOUT_MS,
    );
    if (!fs.existsSync(readyFile)) {
      throw new Error(
        `Host exited before the payload started (code=${String(host.exitCode)}): ${readIfPresent(path.join(fixture, 'host.log')) ?? ''}`,
      );
    }
    const sandboxPidNamespace = fs.readFileSync(
      path.join(workspace, 'pidns'),
      'utf8',
    );
    startedNamespaces.push(sandboxPidNamespace);
    if (options.closeStdio === true) {
      // The client died: both ends of its pipes to the agent are gone.
      host.stdin?.destroy();
      host.stdout?.destroy();
    }
    return { host, workspace, sandboxPidNamespace, exited };
  }

  it.skipIf(skipBwrap)(
    'runs the payload in a private PID namespace',
    async () => {
      const { sandboxPidNamespace } = await startHost();

      expect(sandboxPidNamespace).not.toBe(
        fs.readlinkSync('/proc/self/ns/pid'),
      );
      expect(sandboxMembers(sandboxPidNamespace).length).toBeGreaterThan(0);
    },
    TEST_TIMEOUT_MS,
  );

  for (const signal of FORWARDED_SIGNALS) {
    it.skipIf(skipBwrap)(
      `delivers ${signal} to the payload, exits with its status and leaves no sandbox process`,
      async () => {
        const { host, workspace, sandboxPidNamespace, exited } =
          await startHost();

        host.kill(signal);
        const exitCode = await exited;

        expect(readIfPresent(path.join(workspace, 'received'))).toBe(signal);
        expect(exitCode).toBe(HANDLED_EXIT_STATUS);
        await waitUntil(
          () => sandboxMembers(sandboxPidNamespace).length === 0,
          'the sandbox PID namespace to empty',
          TEARDOWN_TIMEOUT_MS,
        );
      },
      TEST_TIMEOUT_MS,
    );
  }

  for (const signal of ['SIGTERM', 'SIGHUP'] as const) {
    it.skipIf(skipBwrap)(
      `ends the whole sandbox within the grace period when the payload ignores ${signal} and the client is gone`,
      async () => {
        const { host, workspace, sandboxPidNamespace, exited } =
          await startHost({ stubborn: true, closeStdio: true });
        await waitUntil(
          () => fs.existsSync(path.join(workspace, 'tool')),
          'the payload tool subprocess',
          LAUNCH_TIMEOUT_MS,
        );

        host.kill(signal);
        await waitUntil(
          () => readIfPresent(path.join(workspace, 'received')) === signal,
          `the payload to receive ${signal}`,
          TEARDOWN_TIMEOUT_MS,
        );
        const outcome = await Promise.race([
          exited,
          new Promise<string>((resolve) =>
            setTimeout(
              () => resolve('host still running'),
              STOP_GRACE_MS + TEARDOWN_TIMEOUT_MS,
            ),
          ),
        ]);

        expect(outcome).toBe(SIGKILL_EXIT_STATUS);
        await waitUntil(
          () => sandboxMembers(sandboxPidNamespace).length === 0,
          'the sandbox PID namespace to empty',
          TEARDOWN_TIMEOUT_MS,
        );
      },
      TEST_TIMEOUT_MS,
    );
  }

  it.skipIf(skipBwrap)(
    'leaves a payload that is handling SIGINT running, because SIGINT is not a termination request',
    async () => {
      const { host, workspace, sandboxPidNamespace } = await startHost({
        stubborn: true,
      });

      host.kill('SIGINT');
      await waitUntil(
        () => readIfPresent(path.join(workspace, 'received')) === 'SIGINT',
        'the payload to receive SIGINT',
        TEARDOWN_TIMEOUT_MS,
      );
      await new Promise((resolve) => setTimeout(resolve, STOP_GRACE_MS * 2));

      expect(host.exitCode).toBeNull();
      expect(host.signalCode).toBeNull();
      expect(sandboxMembers(sandboxPidNamespace).length).toBeGreaterThan(0);
    },
    TEST_TIMEOUT_MS,
  );

  it.skipIf(skipBwrap)(
    'leaves no sandbox process when the host is killed with SIGKILL',
    async () => {
      const { host, sandboxPidNamespace, exited } = await startHost();

      host.kill('SIGKILL');
      await exited;

      await waitUntil(
        () => sandboxMembers(sandboxPidNamespace).length === 0,
        'the sandbox PID namespace to empty',
        TEARDOWN_TIMEOUT_MS,
      );
    },
    TEST_TIMEOUT_MS,
  );
});
