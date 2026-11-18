/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Host process for sandbox-container-signal-forwarding.test.ts. It wires the
 * container launch path's signal and cleanup handling around a stand-in
 * sandbox child, in the order executeContainerSandbox uses: proxy sidecar
 * first, then the child, the signal forwarder and the proxy close handler. Docker itself is
 * a stand-in `docker` on PATH, so the real startProxyContainer and
 * wireProxyContainerCloseHandler run unchanged.
 *
 * HOST_WITH_PROXY_SIDECAR=1 starts the proxy sidecar. The host writes `ready`
 * into STUB_DIR once everything is wired, and exits with the child's status.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  startProxyContainer,
  wireProxyContainerCloseHandler,
} from '../sandbox-containers.js';
import { normalizeExitCode } from '../sandbox-seatbelt.js';
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
wireProxyContainerCloseHandler(proxyContainer, sandboxProcess);

const exitCode = await new Promise<number>((resolve) => {
  sandboxProcess.on('close', (code, signal) => {
    resolve(normalizeExitCode(code, signal));
  });
  fs.writeFileSync(path.join(stubDir, 'ready'), '');
});
process.exit(exitCode);
