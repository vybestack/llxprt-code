/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_DISPOSITION_STUB,
  FORWARDED_SIGNALS,
  HANDLED_EXIT_STATUS,
  SIGNAL_NUMBERS,
  SandboxHostHarness,
  TEST_TIMEOUT_MS,
  handlingStub,
  isAlive,
} from './__tests__/sandbox-host-harness.js';

/**
 * An ACP client stops an agent by signalling the process it started. With
 * --sandbox that process is the host half of the sandbox hop, and the agent
 * is its child. These tests run the real launch path in a host process
 * against a stand-in sandbox launcher and signal the host, so they observe
 * what a client observes: the host's exit status and whether the sandboxed
 * child is still running afterwards.
 */

const HOST_SCRIPT = fileURLToPath(
  new URL('./__tests__/sandbox-signal-forwarding-host.ts', import.meta.url),
);

const HANDLING_STUB = handlingStub();

/**
 * Holds the stand-in open after it has recorded the signal, so anything the
 * host does in response to the signal has time to happen first.
 */
const LINGERING_STUB = handlingStub('sleep 0.5;');

/**
 * The network proxy command: a long-lived process that publishes its pid.
 * The launcher runs it through a shell in its own process group.
 */
const PROXY_COMMAND = [
  'echo $$ > "$STUB_DIR/proxy.pid.tmp"',
  'mv "$STUB_DIR/proxy.pid.tmp" "$STUB_DIR/proxy.pid"',
  'exec sleep 600',
].join('; ');

// The stand-ins are POSIX shell scripts and Windows cannot deliver these
// signals to a process as signals.
describe('sandbox hop signal forwarding', () => {
  describe.skipIf(process.platform === 'win32')('on a POSIX host', () => {
    const harness = new SandboxHostHarness(HOST_SCRIPT);

    beforeEach(() => {
      harness.setUp();
    }, TEST_TIMEOUT_MS);

    afterEach(() => {
      harness.tearDown();
    }, TEST_TIMEOUT_MS);

    const startHost = (stubSource: string) =>
      harness.startHost({ stubs: { 'sandbox-exec': stubSource } });

    for (const signal of FORWARDED_SIGNALS) {
      it(
        `forwards ${signal} to the sandboxed child and exits with the child's status`,
        async () => {
          const { host, childPid, finished } = await startHost(HANDLING_STUB);

          host.kill(signal);
          const result = await finished;

          expect(harness.readText('received')).toBe(signal.slice('SIG'.length));
          expect(result.signal).toBeNull();
          expect(result.exitCode).toBe(HANDLED_EXIT_STATUS);
          expect(isAlive(childPid)).toBe(false);
        },
        TEST_TIMEOUT_MS,
      );

      it(
        `exits 128+signal and leaves no child when ${signal} kills the sandboxed child`,
        async () => {
          const { host, childPid, finished } = await startHost(
            DEFAULT_DISPOSITION_STUB,
          );

          host.kill(signal);
          const result = await finished;

          expect(result.signal).toBeNull();
          expect(result.exitCode).toBe(128 + SIGNAL_NUMBERS[signal]);
          expect(isAlive(childPid)).toBe(false);
        },
        TEST_TIMEOUT_MS,
      );
    }

    it(
      'removes its signal handlers once the sandboxed child has exited',
      async () => {
        const { host, finished } = await startHost(HANDLING_STUB);

        host.kill('SIGTERM');
        const { report } = await finished;

        expect(report).toBeDefined();
        expect(report?.after).toStrictEqual(report?.before ?? {});
      },
      TEST_TIMEOUT_MS,
    );

    it(
      'fails the launch with the spawn error when the sandbox launcher cannot be started',
      async () => {
        const missingLauncher = harness.file('no-such-launcher');

        const result = await harness.runToExit({
          env: { HOST_SANDBOX_COMMAND: missingLauncher },
        });

        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain(missingLauncher);
        expect(result.stderr).toContain('ENOENT');
      },
      TEST_TIMEOUT_MS,
    );

    describe('with a network proxy', () => {
      let proxyEndpoint: http.Server;
      let proxyEnv: Record<string, string>;

      beforeAll(async () => {
        proxyEndpoint = http.createServer((_request, response) => {
          response.end('ready');
        });
        await new Promise<void>((resolve) => {
          proxyEndpoint.listen(0, '127.0.0.1', resolve);
        });
        const { port } = proxyEndpoint.address() as AddressInfo;
        proxyEnv = {
          LLXPRT_SANDBOX_PROXY_COMMAND: PROXY_COMMAND,
          HTTPS_PROXY: `http://127.0.0.1:${port}`,
          NO_PROXY: '127.0.0.1',
        };
      }, TEST_TIMEOUT_MS);

      afterAll(async () => {
        await new Promise<void>((resolve) => {
          proxyEndpoint.close(() => resolve());
        });
      });

      const startProxiedHost = (stubSource: string) =>
        harness.startHost(
          { stubs: { 'sandbox-exec': stubSource }, env: proxyEnv },
          ['proxy.pid'],
        );

      // The host stops the proxy on these two signals while it forwards them,
      // so the proxy can close before the sandboxed child has finished
      // handling the signal. That is an intended shutdown, not a proxy failure.
      for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        it(
          `waits for the sandboxed child and exits with its status when ${signal} also stops the proxy`,
          async () => {
            const { host, childPid, finished } =
              await startProxiedHost(LINGERING_STUB);

            host.kill(signal);
            const result = await finished;

            expect(harness.readText('received')).toBe(
              signal.slice('SIG'.length),
            );
            expect(result.exitCode).toBe(HANDLED_EXIT_STATUS);
            expect(isAlive(childPid)).toBe(false);
            expect(isAlive(harness.readPid('proxy.pid'))).toBe(false);
          },
          TEST_TIMEOUT_MS,
        );
      }

      it(
        'stops the sandboxed child and exits 1 only after it has closed when the proxy dies while it is running',
        async () => {
          const { childPid, finished } = await startProxiedHost(LINGERING_STUB);

          process.kill(harness.readPid('proxy.pid'), 'SIGKILL');
          const result = await finished;

          expect(harness.readText('received')).toBe('TERM');
          expect(result.exitCode).toBe(1);
          // The host waited for the child, so it is already gone. Teardown
          // would kill a survivor and hide a host that left early.
          expect(isAlive(childPid)).toBe(false);
        },
        TEST_TIMEOUT_MS,
      );
    });
  });
});
