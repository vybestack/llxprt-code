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
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import {
  HANDLED_EXIT_STATUS,
  SandboxHostHarness,
  TEST_TIMEOUT_MS,
  handlingStub,
  isAlive,
} from './__tests__/sandbox-host-harness.js';

/**
 * The Docker and Podman launch path keeps resources alive next to the
 * sandboxed child: a proxy sidecar container and a credential bridge. When
 * the host receives a stop signal it relays it to the child and keeps waiting
 * for the child to close, so those resources must neither end the host early
 * nor disappear while the child is still running.
 *
 * Each case runs the real wiring in a host process against a stand-in
 * `docker` and a stand-in sandbox child, then signals the host.
 */

const HOST_SCRIPT = fileURLToPath(
  new URL('./__tests__/sandbox-container-signal-host.ts', import.meta.url),
);

/**
 * Stand-in `docker`. `run` is the sidecar's client process and stays up until
 * `rm -f` ends it, as `docker rm -f` ends the client of a removed container.
 */
const DOCKER_STUB = [
  '#!/bin/sh',
  'case "$1" in',
  '  run)',
  '    echo $$ > "$STUB_DIR/proxy.pid.tmp"',
  '    mv "$STUB_DIR/proxy.pid.tmp" "$STUB_DIR/proxy.pid"',
  '    exec sleep 600 ;;',
  '  rm)',
  '    kill "$(cat "$STUB_DIR/proxy.pid")" 2>/dev/null',
  '    exit 0 ;;',
  '  *) exit 0 ;;',
  'esac',
].join('\n');

/**
 * A sandboxed child that handles the stop signal without exiting at once. It
 * reports whether the credential bridge had already been cleaned up when it
 * finished handling the signal, which is the last moment it can still use it.
 */
const BRIDGE_WATCHING_STUB = handlingStub(
  [
    'sleep 0.5;',
    'if [ -e "$STUB_DIR/bridge-cleaned" ]; then',
    'echo cleaned > "$STUB_DIR/bridge-at-exit";',
    'else echo in-use > "$STUB_DIR/bridge-at-exit"; fi;',
  ].join(' '),
);

// The stand-ins are POSIX shell scripts and Windows cannot deliver these
// signals to a process as signals.
describe('container sandbox hop signal handling', () => {
  describe.skipIf(process.platform === 'win32')('on a POSIX host', () => {
    const harness = new SandboxHostHarness(HOST_SCRIPT);

    beforeEach(() => {
      harness.setUp();
    }, TEST_TIMEOUT_MS);

    afterEach(() => {
      harness.tearDown();
    }, TEST_TIMEOUT_MS);

    describe('with a proxy sidecar container', () => {
      let readinessEndpoint: http.Server;
      let sidecarEnv: Record<string, string>;

      beforeAll(async () => {
        readinessEndpoint = http.createServer((_request, response) => {
          response.end('ready');
        });
        await new Promise<void>((resolve) => {
          readinessEndpoint.listen(0, '127.0.0.1', resolve);
        });
        const { port } = readinessEndpoint.address() as AddressInfo;
        sidecarEnv = {
          HOST_WITH_PROXY_SIDECAR: '1',
          HTTPS_PROXY: `http://127.0.0.1:${port}`,
          NO_PROXY: '127.0.0.1',
        };
      }, TEST_TIMEOUT_MS);

      afterAll(async () => {
        await new Promise<void>((resolve) => {
          readinessEndpoint.close(() => resolve());
        });
      });

      const startHostWithSidecar = (childStub: string) =>
        harness.startHost(
          {
            stubs: { docker: DOCKER_STUB, 'sandbox-child': childStub },
            env: sidecarEnv,
          },
          ['proxy.pid'],
        );

      for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        it(
          `waits for the sandboxed child and exits with its status when ${signal} also removes the sidecar`,
          async () => {
            const { host, childPid, finished } = await startHostWithSidecar(
              handlingStub('sleep 0.5;'),
            );

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
        'still terminates the host when the sidecar exits while the sandboxed child is running',
        async () => {
          const { finished } = await startHostWithSidecar(handlingStub());

          process.kill(harness.readPid('proxy.pid'), 'SIGKILL');
          const result = await finished;

          expect(result.exitCode).toBe(1);
          expect(fs.existsSync(harness.file('received'))).toBe(false);
        },
        TEST_TIMEOUT_MS,
      );
    });

    describe('with a credential bridge', () => {
      for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        it(
          `keeps the bridge available until the sandboxed child exits after ${signal}`,
          async () => {
            const { host, finished } = await harness.startHost({
              stubs: { 'sandbox-child': BRIDGE_WATCHING_STUB },
              env: { HOST_WITH_BRIDGE: '1' },
            });

            host.kill(signal);
            const result = await finished;

            expect(harness.readText('bridge-at-exit')).toBe('in-use');
            expect(result.exitCode).toBe(HANDLED_EXIT_STATUS);
            expect(fs.existsSync(harness.file('bridge-cleaned'))).toBe(true);
          },
          TEST_TIMEOUT_MS,
        );
      }
    });
  });
});
