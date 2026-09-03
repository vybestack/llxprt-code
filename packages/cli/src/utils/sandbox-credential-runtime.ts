/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  FatalSandboxError,
  type SandboxConfig,
} from '@vybestack/llxprt-code-core';

const PODMAN_DARWIN_SOCKET_RUNTIME_ROOT = '/tmp';
const PODMAN_DARWIN_SOCKET_RUNTIME_PREFIX = 'lx-';
const DARWIN_UNIX_SOCKET_PATH_MAX_BYTES = 103;

export interface CredentialSocketRuntime {
  readonly path: string;
  readonly cleanup: () => void;
}

export function cleanupCredentialSocketRuntime(
  socketRuntime: CredentialSocketRuntime,
  sessionTmpdir: string,
): void {
  const errors: unknown[] = [];
  for (const cleanup of [
    socketRuntime.cleanup,
    () => fs.rmSync(sessionTmpdir, { recursive: true, force: true }),
  ]) {
    try {
      cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(
      errors,
      'Credential proxy session directory cleanup failed',
    );
  }
}

export function createCredentialSocketRuntime(
  config: SandboxConfig,
  sessionTmpdir: string,
): CredentialSocketRuntime {
  if (os.platform() !== 'darwin' || config.command !== 'podman') {
    return { path: sessionTmpdir, cleanup: () => {} };
  }

  let runtimePath = '';
  try {
    runtimePath = fs.mkdtempSync(
      path.join(
        PODMAN_DARWIN_SOCKET_RUNTIME_ROOT,
        PODMAN_DARWIN_SOCKET_RUNTIME_PREFIX,
      ),
    );
    fs.chmodSync(runtimePath, 0o700);
    const socketBasename = `${process.pid}-${'x'.repeat(22)}.sock`;
    const longestSocketPath = path.join(runtimePath, socketBasename);
    if (
      Buffer.byteLength(longestSocketPath) > DARWIN_UNIX_SOCKET_PATH_MAX_BYTES
    ) {
      throw new FatalSandboxError(
        `Podman macOS credential socket path '${longestSocketPath}' exceeds Darwin's ${DARWIN_UNIX_SOCKET_PATH_MAX_BYTES}-byte pathname limit.`,
      );
    }
  } catch (error) {
    if (runtimePath !== '') {
      fs.rmSync(runtimePath, { recursive: true, force: true });
    }
    if (error instanceof FatalSandboxError) throw error;
    throw new FatalSandboxError(
      `Failed to create a private Podman macOS credential socket runtime under '${PODMAN_DARWIN_SOCKET_RUNTIME_ROOT}': ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return {
    path: runtimePath,
    cleanup: () => {
      fs.rmSync(runtimePath, { recursive: true, force: true });
    },
  };
}
