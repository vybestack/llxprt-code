/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Per-suite loopback port ownership (#3501).
 *
 * Suites that must name a port before the thing that binds it exists (a
 * child proxy process, a configured proxy endpoint) previously shared one
 * fixed number, so two test processes on the same machine collided and
 * failed each other with EADDRINUSE. Each suite now asks the kernel for a
 * port of its own instead.
 */

import net from 'node:net';

/**
 * Reserves a loopback TCP port by binding port 0, reading back the kernel's
 * assignment, and releasing it again. The caller owns the returned port for
 * the lifetime of its fixture.
 */
export async function allocateEphemeralPort(): Promise<number> {
  const probe = net.createServer();
  const port = await new Promise<number>((resolve, reject) => {
    probe.once('error', reject);
    probe.once('listening', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('ephemeral port probe did not bind a TCP port'));
        return;
      }
      resolve(address.port);
    });
    probe.listen(0, '127.0.0.1');
  });
  await new Promise<void>((resolve, reject) => {
    probe.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  return port;
}
