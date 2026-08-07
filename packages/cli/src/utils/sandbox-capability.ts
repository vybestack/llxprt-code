/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface HostOnlyCapabilityResult {
  readonly args: readonly string[];
  readonly envFilePath: string;
  readonly cleanup: () => void;
}

function isIdempotentCleanupError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'EBADF';
}

export function runCapabilityCleanupStep(
  step: () => void,
  errors: unknown[],
): void {
  try {
    step();
  } catch (err) {
    if (!isIdempotentCleanupError(err)) errors.push(err);
  }
}

function createHostOnlyDir(): string {
  const hostOnlyDir = path.join(
    os.homedir(),
    `.llxprt-code-cap-${process.pid}-${crypto.randomUUID()}`,
  );
  let dirCreated = false;
  try {
    fs.mkdirSync(hostOnlyDir, { mode: 0o700 });
    dirCreated = true;
    const dirFd = fs.openSync(hostOnlyDir, 'r');
    try {
      if (process.platform !== 'win32') fs.fchmodSync(dirFd, 0o700);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch (err) {
    const errors: unknown[] = [err];
    if (dirCreated) {
      runCapabilityCleanupStep(
        () => removePath(() => fs.rmdirSync(hostOnlyDir)),
        errors,
      );
    }
    if (errors.length === 1) {
      throw new Error(
        `Capability host-only directory could not be created: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    throw new AggregateError(
      errors,
      'Capability host-only directory could not be created',
    );
  }
  return hostOnlyDir;
}

function closeAfterWrite(fd: number, writeError?: unknown): void {
  try {
    fs.closeSync(fd);
  } catch (closeError) {
    if (isIdempotentCleanupError(closeError)) return;
    if (writeError === undefined) {
      throw new Error(
        `Capability env file could not be closed: ${closeError instanceof Error ? closeError.message : String(closeError)}`,
      );
    }
    throw new AggregateError(
      [writeError, closeError],
      'Capability env file could not be written and closed',
    );
  }
}

function writeCapabilityEnvFile(
  envFilePath: string,
  capabilityToken: string,
): void {
  const fd = fs.openSync(envFilePath, 'w', 0o600);
  let writeError: unknown;
  try {
    fs.writeSync(fd, `LLXPRT_CAPABILITY_TOKEN=${capabilityToken}\n`, 0, 'utf8');
    if (process.platform !== 'win32') fs.fchmodSync(fd, 0o600);
  } catch (err) {
    writeError = err;
  }
  closeAfterWrite(fd, writeError);
  if (writeError !== undefined) throw writeError;
}

function removePath(remove: () => void): void {
  try {
    remove();
  } catch (err) {
    if (!isIdempotentCleanupError(err)) throw err;
  }
}

export function createHostOnlyCapabilityEnvFile(
  capabilityToken: string | undefined,
): HostOnlyCapabilityResult | undefined {
  if (capabilityToken === undefined) return undefined;
  if (/[\r\n=]/.test(capabilityToken)) {
    throw new Error(
      'Capability token contains invalid characters for env file',
    );
  }
  const hostOnlyDir = createHostOnlyDir();
  const envFilePath = path.join(hostOnlyDir, 'capability.env');
  try {
    writeCapabilityEnvFile(envFilePath, capabilityToken);
  } catch (err) {
    const errors: unknown[] = [err];
    runCapabilityCleanupStep(
      () => removePath(() => fs.unlinkSync(envFilePath)),
      errors,
    );
    runCapabilityCleanupStep(
      () => removePath(() => fs.rmdirSync(hostOnlyDir)),
      errors,
    );
    throw errors.length === 1
      ? err
      : new AggregateError(errors, 'Capability env file creation failed');
  }
  let cleanedUp = false;
  const cleanup = (): void => {
    if (cleanedUp) return;
    const errors: unknown[] = [];
    runCapabilityCleanupStep(
      () => removePath(() => fs.unlinkSync(envFilePath)),
      errors,
    );
    runCapabilityCleanupStep(
      () => removePath(() => fs.rmdirSync(hostOnlyDir)),
      errors,
    );
    if (errors.length > 0) {
      throw new AggregateError(errors, 'Capability host-only cleanup failed');
    }
    cleanedUp = true;
  };
  return { args: ['--env-file', envFilePath], envFilePath, cleanup };
}
