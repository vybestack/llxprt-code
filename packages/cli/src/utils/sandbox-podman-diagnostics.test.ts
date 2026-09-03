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
import { setupCredentialProxyPodmanMacOS } from './sandbox-podman.js';

const DARWIN_SOCKET_PATH_MAX_BYTES = 103;
const DIAGNOSTIC_MAX_BYTES = 4096;

function writeExecutable(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content);
  fs.chmodSync(filePath, 0o755);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function captureFailure(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('Expected action to fail');
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

function invokeCredentialBridgeInFreshBun(
  fixtureRoot: string,
  originalPath: string,
  socketPath: string,
): string {
  const runnerPath = path.join(fixtureRoot, 'invoke-credential-bridge.ts');
  const modulePath = path.join(import.meta.dirname, 'sandbox-podman.ts');
  fs.writeFileSync(
    runnerPath,
    [
      `import { setupCredentialProxyPodmanMacOS } from ${JSON.stringify(modulePath)};`,
      `const socketPath = ${JSON.stringify(socketPath)};`,
      'try {',
      '  await setupCredentialProxyPodmanMacOS([], socketPath, 1000);',
      "  console.log('unexpected success');",
      '} catch (error) {',
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

describe('#3534 Podman tunnel startup diagnostics', () => {
  let fixtureRoot = '';
  let originalPath = '';
  let podmanInvocationLog = '';
  let sshInvocationLog = '';

  beforeEach(() => {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issue3534-ssh-'));
    originalPath = process.env.PATH ?? '';
    podmanInvocationLog = path.join(fixtureRoot, 'podman-invocations.log');
    sshInvocationLog = path.join(fixtureRoot, 'ssh-invocations.log');
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
    process.env.PATH = `${fixtureRoot}${path.delimiter}${originalPath}`;
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it('surfaces a late OpenSSH forwarding failure after draining chatty output and reaping the child', async () => {
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

    const message = await captureFailure(() =>
      setupCredentialProxyPodmanMacOS([], '/tmp/cred-proxy.sock', 3000),
    );
    const sshPid = Number(fs.readFileSync(sshPidPath, 'utf8').trim());

    expect(message).toContain('late OpenSSH forwarding failure');
    expect(processExists(sshPid)).toBe(false);
  }, 10000);

  it('retains exactly 4096 encoded bytes from an oversized OpenSSH diagnostic', async () => {
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

    const message = await captureFailure(() =>
      setupCredentialProxyPodmanMacOS([], '/tmp/cred-proxy.sock'),
    );
    const diagnosticMarker = ' SSH diagnostic: ';
    const markerIndex = message.indexOf(diagnosticMarker);
    const diagnostic = message.slice(markerIndex + diagnosticMarker.length);

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
    expect(message).toMatch(/socket path.*104 bytes.*103-byte pathname limit/i);
    expect(fs.existsSync(podmanInvocationLog)).toBe(false);
    expect(fs.existsSync(sshInvocationLog)).toBe(false);
  });
});
