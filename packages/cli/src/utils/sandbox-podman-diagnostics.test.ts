/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const isWindows = process.platform === 'win32';
const DARWIN_SOCKET_PATH_MAX_BYTES = 103;
const DIAGNOSTIC_MAX_BYTES = 4096;
// Tests that assert OpenSSH exit diagnostics are decided by the fixture ssh
// exiting, not by a wall-clock readiness deadline racing a loaded host. The
// deadline only ends those runs when a test asks for it explicitly.
const READINESS_DEADLINE_NOT_REACHED_MS = 60_000;

const FIRST_EXEC_WARMUP_ENV = 'ISSUE3534_FIXTURE_WARMUP';

/**
 * Writes a fixture executable and runs it once so the operating system's
 * first-execution check of a newly written file completes before the test
 * starts timing the bridge. On macOS that check takes seconds under load
 * (the same trivial script runs in about 5ms from its second execution on),
 * which otherwise lands inside the 1s readiness poll and the elapsed-time
 * assertions. The warm-up run exits before the fixture does anything else.
 */
function writeExecutable(filePath: string, content: string): void {
  const [shebang, ...body] = content.split('\n');
  fs.writeFileSync(
    filePath,
    [shebang, `[ -n "$${FIRST_EXEC_WARMUP_ENV}" ] && exit 0`, ...body].join(
      '\n',
    ),
  );
  fs.chmodSync(filePath, 0o755);
  const warmup = spawnSync(filePath, [], {
    env: { ...process.env, [FIRST_EXEC_WARMUP_ENV]: '1' },
    timeout: 30000,
  });
  if (warmup.error !== undefined || warmup.status !== 0) {
    throw new Error(`Fixture warm-up failed for ${filePath}`, {
      cause: warmup.error,
    });
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
      return false;
    }
    throw error;
  }
}

/**
 * Runs the real credential bridge in a fresh Bun process whose PATH is set
 * through the child `env` so the fixture `podman` and `ssh` are the only ones
 * reachable.
 *
 * Calling the bridge in-process instead is not deterministic: production
 * resolves both binaries through child processes it spawns without an
 * explicit `env` (`execSync` in `getPodmanMachineConnection`, `spawn('ssh')`),
 * and a `process.env.PATH` mutation made inside a Bun test process is not
 * guaranteed to reach them. On a host with a real Podman that reports no
 * machine connections, the in-process form reached that Podman and failed in
 * `getPodmanMachineConnection` before the fixture `ssh` ever ran.
 */
function invokeCredentialBridgeInFreshBun(
  fixtureRoot: string,
  originalPath: string,
  socketPath: string,
  pollTimeoutMs = READINESS_DEADLINE_NOT_REACHED_MS,
): string {
  const runnerPath = path.join(fixtureRoot, 'invoke-credential-bridge.ts');
  const modulePath = path.join(import.meta.dirname, 'sandbox-podman.ts');
  fs.writeFileSync(
    runnerPath,
    [
      `import { setupCredentialProxyPodmanMacOS } from ${JSON.stringify(modulePath)};`,
      "import fs from 'node:fs';",
      `const resultTimePath = ${JSON.stringify(path.join(fixtureRoot, 'bridge-result-time'))};`,
      `const socketPath = ${JSON.stringify(socketPath)};`,
      // Taken after the module import so bridge latency excludes the cost of
      // starting a fresh Bun process, which varies with host load.
      `fs.writeFileSync(${JSON.stringify(path.join(fixtureRoot, 'bridge-start-time'))}, String(Date.now()));`,
      'try {',
      `  await setupCredentialProxyPodmanMacOS([], socketPath, ${String(pollTimeoutMs)});`,
      "  console.log('unexpected success');",
      '} catch (error) {',
      '  fs.writeFileSync(resultTimePath, String(Date.now()));',
      `  const probePidPath = ${JSON.stringify(path.join(fixtureRoot, 'probe.pid'))};`,
      '  if (fs.existsSync(probePidPath)) {',
      '    const pid = Number(fs.readFileSync(probePidPath, "utf8"));',
      '    let alive = true;',
      '    try { process.kill(pid, 0); } catch (error) {',
      '      if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") throw error;',
      '      alive = false;',
      '    }',
      `    fs.writeFileSync(${JSON.stringify(path.join(fixtureRoot, 'probe-alive-at-result'))}, String(alive));`,
      '  }',
      '  console.log(error instanceof Error ? error.message : String(error));',
      '}',
    ].join('\n'),
  );
  const result = spawnSync(process.execPath, [runnerPath], {
    cwd: fixtureRoot,
    env: {
      ...process.env,
      PATH: `${fixtureRoot}${path.delimiter}${originalPath}`,
    },
    encoding: 'utf8',
    timeout: 10000,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Credential bridge runner failed with status ${String(result.status)}: ${result.stderr}`,
    );
  }
  return result.stdout.trim();
}

describe('Podman tunnel startup diagnostics', () => {
  describe.skipIf(isWindows)('#3534 Podman tunnel startup diagnostics', () => {
    let fixtureRoot = '';
    let originalPath = '';
    let podmanInvocationLog = '';
    let sshInvocationLog = '';

    beforeEach(() => {
      fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issue3534-ssh-'));
      // Only used to build the child PATH; the host PATH is never mutated, so
      // the fixture binaries are reachable exactly where they are needed.
      originalPath = process.env.PATH ?? '';
      podmanInvocationLog = path.join(fixtureRoot, 'podman-invocations.log');
      sshInvocationLog = path.join(fixtureRoot, 'ssh-invocations.log');
      // The connection lookup is answered by this fixture rather than the host
      // engine, so a machine-less environment (Linux CI) reaches the SSH path
      // instead of failing early with "No Podman machine connections found".
      writeExecutable(
        path.join(fixtureRoot, 'podman'),
        [
          '#!/bin/sh',
          `printf '%s\\n' "$*" >> ${shellQuote(podmanInvocationLog)}`,
          'case "$*" in',
          "  *'system connection list'*)",
          `    printf '%s\\n' '[{"Name":"default","URI":"ssh://core@localhost:12345/run/podman/podman.sock","Identity":"/tmp/key","Default":true}]'`,
          '    ;;',
          '  *)',
          '    exit 1',
          '    ;;',
          'esac',
        ].join('\n'),
      );
    });

    afterEach(() => {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    });

    it('surfaces a late OpenSSH forwarding failure after draining chatty output and reaping the child', () => {
      const sshPidPath = path.join(fixtureRoot, 'ssh.pid');
      writeExecutable(
        path.join(fixtureRoot, 'ssh'),
        [
          '#!/bin/sh',
          `printf '%s\\n' "$*" >> ${shellQuote(sshInvocationLog)}`,
          `printf '%s\\n' "$$" > ${shellQuote(sshPidPath)}`,
          'sleep 0.7',
          "yes 'chatty tunnel output' | head -c 524288",
          `printf 'late OpenSSH forwarding failure\\n' >&2`,
          'exit 23',
        ].join('\n'),
      );

      const message = invokeCredentialBridgeInFreshBun(
        fixtureRoot,
        originalPath,
        '/tmp/cred-proxy.sock',
      );
      const sshPid = Number(fs.readFileSync(sshPidPath, 'utf8').trim());

      // The fixture Podman answered the connection lookup, so the diagnostic
      // below came from the fixture ssh rather than an ambient host engine.
      expect(fs.readFileSync(podmanInvocationLog, 'utf8')).toContain(
        'system connection list',
      );
      expect(message).toContain('late OpenSSH forwarding failure');
      expect(processExists(sshPid)).toBe(false);
    }, 10000);

    it('surfaces SSH diagnostics when a readiness probe overlaps SSH exit', () => {
      const readinessStarted = path.join(fixtureRoot, 'readiness-started');
      const probePidPath = path.join(fixtureRoot, 'probe.pid');
      const sshPidPath = path.join(fixtureRoot, 'ssh.pid');
      writeExecutable(
        path.join(fixtureRoot, 'podman'),
        [
          '#!/bin/sh',
          `printf '%s\\n' "$*" >> ${shellQuote(podmanInvocationLog)}`,
          'case "$*" in',
          "  *'system connection list'*)",
          `    printf '%s\\n' '[{"Name":"default","URI":"ssh://core@localhost:12345/run/podman/podman.sock","Identity":"/tmp/key","Default":true}]'`,
          '    ;;',
          '  *)',
          `    while [ ! -s ${shellQuote(sshPidPath)} ]; do sleep 0.01; done`,
          '    sleep 1.5 &',
          `    printf '%s\n' "$!" > ${shellQuote(probePidPath)}`,
          `    ${shellQuote(process.execPath)} -e ${shellQuote(`require('node:fs').writeFileSync(${JSON.stringify(readinessStarted)}, String(Date.now()))`)}`,
          '    wait',
          '    exit 1',
          '    ;;',
          'esac',
        ].join('\n'),
      );
      writeExecutable(
        path.join(fixtureRoot, 'ssh'),
        [
          '#!/bin/sh',
          `printf '%s\\n' "$$" > ${shellQuote(sshPidPath)}`,
          `while [ ! -f ${shellQuote(readinessStarted)} ]; do sleep 0.01; done`,
          "printf 'probe-overlap diagnostic\\n' >&2",
          "yes 'chatty tunnel output' | head -c 8388608",
          'exit 23',
        ].join('\n'),
      );

      const message = invokeCredentialBridgeInFreshBun(
        fixtureRoot,
        originalPath,
        '/tmp/cred-proxy.sock',
      );
      const sshPid = Number(fs.readFileSync(sshPidPath, 'utf8').trim());

      expect(message).toContain('probe-overlap diagnostic');
      expect(processExists(sshPid)).toBe(false);
      expect(
        fs.readFileSync(
          path.join(fixtureRoot, 'probe-alive-at-result'),
          'utf8',
        ),
      ).toBe('false');
      const probePid = Number(fs.readFileSync(probePidPath, 'utf8'));
      expect(processExists(probePid)).toBe(false);
      const readinessStartTime = Number(
        fs.readFileSync(readinessStarted, 'utf8'),
      );
      const resultTime = Number(
        fs.readFileSync(path.join(fixtureRoot, 'bridge-result-time'), 'utf8'),
      );
      expect(resultTime - readinessStartTime).toBeLessThan(1000);
    }, 10000);

    it('surfaces SSH diagnostics when the readiness deadline elapses while OpenSSH has exited but is still draining output', () => {
      const readinessStarted = path.join(fixtureRoot, 'readiness-started');
      const sshPidPath = path.join(fixtureRoot, 'ssh.pid');
      // The first readiness probe starts only after the 500ms startup gate, so
      // OpenSSH is still running there. The probe then blocks until OpenSSH has
      // been reaped and outlives the readiness deadline, so the deadline error
      // is raised strictly after OpenSSH exited and before its stdio closed.
      writeExecutable(
        path.join(fixtureRoot, 'podman'),
        [
          '#!/bin/sh',
          `printf '%s\\n' "$*" >> ${shellQuote(podmanInvocationLog)}`,
          'case "$*" in',
          "  *'system connection list'*)",
          `    printf '%s\\n' '[{"Name":"default","URI":"ssh://core@localhost:12345/run/podman/podman.sock","Identity":"/tmp/key","Default":true}]'`,
          '    ;;',
          '  *)',
          `    while [ ! -s ${shellQuote(sshPidPath)} ]; do sleep 0.01; done`,
          `    printf started > ${shellQuote(readinessStarted)}`,
          `    while kill -0 "$(cat ${shellQuote(sshPidPath)})" 2>/dev/null; do sleep 0.01; done`,
          '    sleep 0.5',
          '    exit 1',
          '    ;;',
          'esac',
        ].join('\n'),
      );
      // The backgrounded sleep inherits OpenSSH's stdio, so the child emits
      // `exit` immediately while `close` is held back until the sleep ends.
      writeExecutable(
        path.join(fixtureRoot, 'ssh'),
        [
          '#!/bin/sh',
          `printf '%s\\n' "$$" > ${shellQuote(sshPidPath)}`,
          `while [ ! -f ${shellQuote(readinessStarted)} ]; do sleep 0.01; done`,
          "printf 'exited-before-deadline diagnostic\\n' >&2",
          'sleep 2 &',
          'exit 23',
        ].join('\n'),
      );

      const message = invokeCredentialBridgeInFreshBun(
        fixtureRoot,
        originalPath,
        '/tmp/cred-proxy.sock',
        300,
      );
      const sshPid = Number(fs.readFileSync(sshPidPath, 'utf8').trim());

      expect(message).toContain('OpenSSH exited with code 23');
      expect(message).toContain('exited-before-deadline diagnostic');
      expect(message).not.toContain('timed out waiting for TCP tunnel');
      expect(processExists(sshPid)).toBe(false);
    }, 10000);

    it('reports a bounded readiness timeout and reaps an SSH process that remains running', () => {
      const sshPidPath = path.join(fixtureRoot, 'ssh.pid');
      // The readiness probe cannot report until the fixture ssh is running, so
      // a slow process start cannot turn this into a deadline with no SSH to
      // reap.
      writeExecutable(
        path.join(fixtureRoot, 'podman'),
        [
          '#!/bin/sh',
          'case "$*" in',
          "  *'system connection list'*)",
          `    printf '%s\\n' '[{"Name":"default","URI":"ssh://core@localhost:12345/run/podman/podman.sock","Identity":"/tmp/key","Default":true}]'`,
          '    ;;',
          '  *)',
          `    while [ ! -s ${shellQuote(sshPidPath)} ]; do sleep 0.01; done`,
          '    exit 1',
          '    ;;',
          'esac',
        ].join('\n'),
      );
      writeExecutable(
        path.join(fixtureRoot, 'ssh'),
        [
          '#!/bin/sh',
          `printf '%s\n' "$$" > ${shellQuote(sshPidPath)}`,
          'exec sleep 30',
        ].join('\n'),
      );

      const message = invokeCredentialBridgeInFreshBun(
        fixtureRoot,
        originalPath,
        '/tmp/cred-proxy.sock',
        1000,
      );
      const sshPid = Number(fs.readFileSync(sshPidPath, 'utf8').trim());

      expect(message).toContain('timed out waiting for TCP tunnel');
      expect(message).not.toContain('OpenSSH exited from signal');
      expect(processExists(sshPid)).toBe(false);
      const bridgeStartTime = Number(
        fs.readFileSync(path.join(fixtureRoot, 'bridge-start-time'), 'utf8'),
      );
      const resultTime = Number(
        fs.readFileSync(path.join(fixtureRoot, 'bridge-result-time'), 'utf8'),
      );
      expect(resultTime - bridgeStartTime).toBeLessThan(5000);
    }, 10000);

    it('retains exactly 4096 encoded bytes from an oversized OpenSSH diagnostic', () => {
      writeExecutable(
        path.join(fixtureRoot, 'ssh'),
        [
          '#!/bin/sh',
          `printf '%s\\n' "$*" >> ${shellQuote(sshInvocationLog)}`,
          `printf 'Bad remote forwarding specification for credential socket\\n' >&2`,
          `printf '%05000d' 0 | tr '0' x >&2`,
          `printf 'UNBOUNDED-TAIL\\n' >&2`,
          'exit 23',
        ].join('\n'),
      );

      const message = invokeCredentialBridgeInFreshBun(
        fixtureRoot,
        originalPath,
        '/tmp/cred-proxy.sock',
      );
      const diagnosticMarker = ' SSH diagnostic: ';
      const markerIndex = message.indexOf(diagnosticMarker);
      const diagnostic = message.slice(markerIndex + diagnosticMarker.length);

      expect(fs.readFileSync(podmanInvocationLog, 'utf8')).toContain(
        'system connection list',
      );
      expect(message).toContain(
        'Bad remote forwarding specification for credential socket',
      );
      expect(message).not.toContain('UNBOUNDED-TAIL');
      expect(markerIndex).toBeGreaterThanOrEqual(0);
      expect(Buffer.byteLength(diagnostic)).toBe(DIAGNOSTIC_MAX_BYTES);
    }, 10000);

    it('accepts a Darwin socket path of exactly 103 encoded bytes and starts Podman and SSH', async () => {
      const socketPath = `/tmp/${'x'.repeat(DARWIN_SOCKET_PATH_MAX_BYTES - 5)}`;
      writeExecutable(
        path.join(fixtureRoot, 'ssh'),
        [
          '#!/bin/sh',
          `printf '%s\\n' "$*" >> ${shellQuote(sshInvocationLog)}`,
          `printf 'accepted-boundary reached OpenSSH\\n' >&2`,
          'exit 23',
        ].join('\n'),
      );

      const message = invokeCredentialBridgeInFreshBun(
        fixtureRoot,
        originalPath,
        socketPath,
      );

      expect(Buffer.byteLength(socketPath)).toBe(DARWIN_SOCKET_PATH_MAX_BYTES);
      expect(message).toContain('accepted-boundary reached OpenSSH');
      expect(fs.readFileSync(podmanInvocationLog, 'utf8')).toContain(
        'system connection list',
      );
      expect(fs.readFileSync(sshInvocationLog, 'utf8')).toContain(socketPath);
    }, 10000);

    it('rejects a Darwin socket path of 104 encoded bytes before starting Podman or SSH', async () => {
      const socketPath = `/tmp/${'x'.repeat(DARWIN_SOCKET_PATH_MAX_BYTES - 4)}`;
      writeExecutable(
        path.join(fixtureRoot, 'ssh'),
        [
          '#!/bin/sh',
          `printf '%s\\n' "$*" >> ${shellQuote(sshInvocationLog)}`,
          'exit 23',
        ].join('\n'),
      );

      const message = invokeCredentialBridgeInFreshBun(
        fixtureRoot,
        originalPath,
        socketPath,
      );

      expect(Buffer.byteLength(socketPath)).toBe(
        DARWIN_SOCKET_PATH_MAX_BYTES + 1,
      );
      expect(message).toMatch(
        /socket path.*104 bytes.*103-byte pathname limit/i,
      );
      expect(fs.existsSync(podmanInvocationLog)).toBe(false);
      expect(fs.existsSync(sshInvocationLog)).toBe(false);
    });
  });
});
