/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function cleanupScenarioProcessGroup(directory: string): void {
  const file = path.join(directory, 'scenario-pgid');
  let pid: number;
  try {
    pid = Number(readFileSync(file, 'utf8'));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return;
    throw error;
  }
  if (!Number.isSafeInteger(pid) || pid <= 1)
    throw new Error(`Invalid scenario process group: ${pid}`);
  try {
    process.kill(-pid, 'SIGKILL');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH'))
      throw error;
  }
  rmSync(file, { force: true });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const directory = process.argv[2];
  const command = process.argv[3];
  if (!directory || !command)
    throw new Error('Expected artifact directory and command');
  const child = spawn('/bin/sh', ['-c', command], {
    detached: true,
    stdio: 'inherit',
  });
  if (child.pid === undefined) throw new Error('Scenario failed to spawn');
  writeFileSync(path.join(directory, 'scenario-pgid'), String(child.pid));
  const cleanup = (): void => cleanupScenarioProcessGroup(directory);
  process.on('exit', cleanup);
  process.on('SIGWINCH', () => {
    if (child.pid !== undefined) process.kill(-child.pid, 'SIGWINCH');
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  child.on('error', (error) => {
    console.error(error);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    writeFileSync(
      path.join(directory, 'scenario-exit-code'),
      signal ?? String(code),
    );
    cleanup();
    process.exitCode = code ?? 1;
  });
}
