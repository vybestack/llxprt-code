/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Host process for sandbox-container-signal-forwarding.test.ts. It wires the
 * container launch path's signal and cleanup handling around a stand-in
 * sandbox child, in the order executeContainerSandbox uses: proxy sidecar
 * first, then the child, the signal forwarder, the proxy close handler, the
 * cleanup handlers and the wait for the child to close. Docker itself is a
 * stand-in `docker` on PATH, so the real startProxyContainer,
 * watchProxyContainer, wireCleanupHandlers and awaitSandboxExit
 * run unchanged.
 *
 * HOST_WITH_PROXY_SIDECAR=1 starts the proxy sidecar. HOST_WITH_BRIDGE=1
 * hands wireCleanupHandlers a credential bridge cleanup that records, in
 * `bridge-cleaned`, that it ran. The host records the dependency volume
 * release in `volumes-released`, writes `ready` into STUB_DIR once everything
 * is wired, and exits with the child's status, or with the status of the
 * fatal error the launch raised.
 */

import { spawn } from 'node:child_process';
import { FatalSandboxError } from '@vybestack/llxprt-code-core';
import fs from 'node:fs';
import path from 'node:path';
import {
  startProxyContainer,
  wireCleanupHandlers,
  watchProxyContainer,
} from '../sandbox-containers.js';
import { awaitSandboxExit } from '../sandbox-exec.js';
import { forwardSignalsToSandboxProcess } from '../sandbox-signal-forwarding.js';

const stubDir = process.env['STUB_DIR'] ?? '.';

// Node ends the process on an uncaught exception; Bun logs it and keeps
// running. A throw from a launch-path listener is a failure of the launch, so
// make it end this host under either runtime.
process.on('uncaughtException', (error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});

const proxyContainer =
  process.env['HOST_WITH_PROXY_SIDECAR'] === '1'
    ? await startProxyContainer(
        { command: 'docker', image: 'unused' },
        'unused-proxy-command',
        '',
        'unused',
        '/workspace',
      )
    : undefined;

const sandboxProcess = spawn(path.join(stubDir, 'sandbox-child'), [], {
  stdio: 'inherit',
});
forwardSignalsToSandboxProcess(sandboxProcess);
const proxyContainerWatch = watchProxyContainer(proxyContainer);
proxyContainerWatch.endOnFailure(sandboxProcess);

const bridgeCleanup =
  process.env['HOST_WITH_BRIDGE'] === '1'
    ? () => {
        fs.writeFileSync(path.join(stubDir, 'bridge-cleaned'), '');
      }
    : undefined;
wireCleanupHandlers(
  sandboxProcess,
  undefined,
  { tunnelProcess: undefined, cleanup: undefined, entrypointPrefix: undefined },
  undefined,
  bridgeCleanup,
  () => {},
);

fs.writeFileSync(path.join(stubDir, 'ready'), '');
try {
  const exitCode = await awaitSandboxExit(
    sandboxProcess,
    proxyContainerWatch,
    () => {
      fs.writeFileSync(path.join(stubDir, 'volumes-released'), '');
    },
  );
  process.exit(exitCode);
} catch (error) {
  process.stderr.write(`${String(error)}\n`);
  process.exit(error instanceof FatalSandboxError ? error.exitCode : 1);
}
